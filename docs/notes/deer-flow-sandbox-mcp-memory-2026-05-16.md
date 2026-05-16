# DeerFlow 深度问答：MCP、记忆系统与沙箱机制

> 来源：DeerFlow 源码研究对话 | 2026-05-16

---

**Q1：DeerFlow 的 MCP 工具"延迟加载"是什么机制？和按需发现工具有什么区别？**

DeerFlow 的"延迟加载"（Lazy Initialization）仅指 MCP 工具的**加载时机**优化：不在应用启动时连接 MCP 服务器，而是推迟到第一次创建 Agent 时才一次性拉取所有 MCP 服务器的全部工具并缓存。这纯粹是启动优化，加载后所有工具的完整 schema 都通过 `bind_tools` 注入 LLM 上下文。

真正实现"先注册名字、按需加载参数"的是另一个独立功能 **Deferred Tool Search**（`tool_search` 配置开关控制）。开启后：系统提示词只注入工具名列表（`<available-deferred-tools>`），`DeferredToolFilterMiddleware` 过滤掉延迟工具的 schema，LLM 通过 `tool_search` 按需搜索获取完整参数定义，获取后该工具被"提升"(promote) 即可正常调用。

| | Lazy Initialization | Deferred Tool Search |
|---|---|---|
| 目的 | 启动速度 | 节省 context token |
| 加载粒度 | 一次性全量 | 按需逐个 promote |

> 💡 **Tips**：`tool_search`、`DeferredToolRegistry` 等命名看似通用，实际只服务于 MCP 工具。代码注释写明 "Source-agnostic: no mention of MCP or tool origin"，是预留扩展但未实现。

---

**Q2：DeerFlow 记忆系统的数据结构是什么？per-agent 记忆和 subagent 什么关系？**

记忆存储为 JSON，包含三层：`user`（工作/个人/当前关注上下文）、`history`（近期/早期/长期背景）、`facts`（离散事实列表，含 id/content/category/confidence）。存储路径按 `(user_id, agent_name)` 二维索引：

- 用户全局：`{base_dir}/users/{user_id}/memory.json`
- 用户+Agent 专属：`{base_dir}/users/{user_id}/agents/{agent_name}/memory.json`

**Per-agent 记忆和 subagent 完全无关。** Subagent 是临时的（通过 `task` 创建，跑完即销毁，无记忆）。Per-agent 记忆服务于用户通过 `setup_agent` 创建的**自定义 Lead Agent 人格**（如 "code-reviewer"、"translator"），各自独立记忆空间，互不共享，跨会话持久存在。

---

**Q3：DeerFlow 默认有几种 Agent 类型？**

- **Lead Agent**：固定入口，仅 1 个。默认无名字，用户可通过 `setup_agent` 创建自定义人格（独立 SOUL.md + config.yaml + 专属记忆）。
- **Subagent**：内置 2 种 + 可扩展。`general-purpose`（继承父 Agent 全部工具，复杂多步任务）和 `bash`（仅沙箱工具，命令执行）。可在 `config.yaml` 的 `custom_agents` 中扩展。
- **ACP Agent**：外部 Agent 协议适配（如 Codex），不算内部类型。

---

**Q4：Docker 沙箱是否每个 Thread 开一个容器？底层隔离用了哪些 OS 机制？**

**每个 Thread 对应一个容器**（sandbox_id 由 thread_id 确定性哈希生成），但有 Warm Pool 复用：容器 release 后不销毁进入 Warm Pool，同 Thread 下次可直接 reclaim 免冷启动；超过 `replicas`（默认 3）时 LRU 驱逐最旧的 Warm Pool 容器。

底层隔离依赖 Docker 默认的 **Linux Namespaces**（PID/Mount/Network/UTS/IPC 各自独立）+ **Bind Mount 控制文件访问范围**。但安全配置偏宽松：`seccomp=unconfined` 禁用了系统调用过滤，未设 CPU/内存 cgroup 限制，未 drop Linux capabilities。适合开发/研究，离生产级安全沙箱有距离。
