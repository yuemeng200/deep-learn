# DeerFlow 前端流式架构与断线重连

> 来源：DeerFlow 代码深度研读对话（2026-05-16）

---

**Q1：DeerFlow 前端同时用了哪两个 SDK，各自职责是什么？**

LangGraph SDK（`@langchain/langgraph-sdk`）是数据层核心，负责与后端 LangGraph Server 通信：API 客户端、SSE 实时流式传输（`useStream`）、线程管理、消息类型定义（`Message`, `AIMessage`, `Run`, `Thread`）。Vercel AI SDK（`ai` 包）只用于 UI 层辅助，在 `ai-elements/` 自动生成组件中引用了几个类型（`UIMessage`, `ChatStatus`, `LanguageModelUsage`），不参与数据流。如果替换掉 `ai-elements/` 目录的自定义组件，可以完全移除 `ai` 包依赖。

**Q2：Agent 的多轮工具调用循环，前端如何展示？**

后端 Agent 的工具调用是循环的：AI → tool_calls → Tool 结果 → AI（可能再调工具）→ ... → AI 最终回复。前端 `getMessageGroups()` 把所有中间轮次（AI reasoning + tool calls + tool results）合并为一个 `assistant:processing` 组，渲染为 Chain-of-Thought 折叠面板：最近的 tool call 步骤默认展开，更早的步骤折叠（点击"显示更多"展开）。最终 AI 回复（有内容、无 tool_calls）单独成 `assistant` 组，显示为正常聊天气泡。

**Q3：重新进入历史 Thread 时，消息从哪里加载？**

两条并行路径：
- **LangGraph SDK 内置历史**：`client.threads.getHistory({limit:1})` 获取最新 checkpoint 状态快照（含完整消息），作为实时数据源
- **DeerFlow 自定义 useThreadHistory**：`GET /api/threads/{id}/runs/{runId}/messages` 从 Gateway 事件存储加载，按 Run 粒度分页，包含所有历史消息且不受上下文压缩（summarization）影响

两者的重叠部分通过 `mergeMessages()` 去重：从 history 尾部向前扫描，跳过与 `thread.messages` 重复的消息，最终拼接为 `[不重叠的旧历史] + [SDK 实时数据] + [乐观更新消息]`。

> 💡 **Tips**：`thread.messages` 来自 LangGraph SDK（SSE 实时推送或最新 checkpoint），覆盖范围受 summarization 影响；`history` 来自 Gateway 事件存储（按 Run 分页的原始日志），不受 summarization 影响。前者负责实时性，后者负责完整性。

**Q4：SSE 事件和消息的关系是什么？**

SSE 有两种核心事件类型配合工作：`messages` 事件是增量 delta，多个相同 `id` 的 delta 通过 `MessageTupleManager.concat()` 拼接成一条逐步增长的 Message（AI 打字时 ~1 token/事件）；`values` 事件是完整状态快照，直接替换整个状态。`messages` 提供逐字流式体验，`values` 提供状态最终化保证。Tool Message 和 Human Message 通常只发一个完整事件。高频的 AI 文本生成阶段（~1 token/事件）不是性能瓶颈，带宽主要消耗在 `values` 的完整状态快照上。

> 💡 **Tips**：这和 OpenAI 官方 streaming API 的设计一致——1 token/chunk 是 LLM streaming 的行业标准，不是 DeerFlow 的特殊选择。React 18 的自动批处理会合并多次 setState，实际渲染频率远低于事件频率。

**Q5：流式中退出页面，重连怎么保证不错过事件？**

三层保证机制：
1. **StreamBridge 事件缓冲区**（后端内存，最多 256 个事件）：submit 时设了 `streamResumable: true`，断线后 run 不取消继续执行。每个事件带单调递增 ID
2. **LangGraph Checkpointer**（持久化）：每个节点完成后保存完整状态快照
3. **Gateway 事件存储**（数据库）：所有消息的原始日志

重连流程：`sessionStorage` 存储 run_id → 页面重载时检测到 → `joinStream(runId)` 带 `Last-Event-ID` → 后端从 StreamBridge 缓冲区重放未读事件 → `values` 事件纠正完整状态 → 最终 `history.mutate()` 从 checkpointer 拿权威最终状态。即使缓冲区溢出或重放有重复，`values` 的全量替换和最终 `mutate()` 会纠正一切。

> 💡 **Tips**：重连依赖 `sessionStorage`，这是标签页级别的存储。跨浏览器/设备打开同一 Thread 不会自动重连——SDK 虽然能从 `getHistory` 的 `next` 字段检测到有活跃 run，但当前没有利用这个信息自动重连，这是一个可改进的方向。

**Q6：Python 是弱类型语言吗？为什么变量和函数能写类型？**

Python 不是弱类型，是**强类型 + 动态类型**。强类型指不做隐式类型转换（`"1"+1` 报 TypeError，不像 JS 返回 `"11"`）；动态类型指变量没有固定类型，运行时才检查（`x=1; x="hello"` 合法）。Python 3.5+ 的类型标注（type hints）不影响运行时行为，是给静态检查工具（mypy, pyright）和 IDE 用的，类似 TypeScript 之于 JavaScript。
