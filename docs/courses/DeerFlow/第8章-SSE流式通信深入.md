# 第8章：SSE 流式通信深入

> 上一章我们浏览了前端集成的全貌。本章我们聚焦于前后端通信的核心通道——SSE（Server-Sent Events），深入理解数据是如何在前后端之间流动的。你将看到：前后端共享哪些实体？SSE 事件的线格式是什么样的？一个完整的问答背后，网络层到底发生了什么？

---

## 8.1 核心通信实体

在理解 SSE 通信之前，先定义三个核心实体：**Thread**、**Run**、**Message**。它们是前后端沟通的"共同语言"——前端 TypeScript 类型与后端 Python 模型一一对应。

### Thread（会话线程）

Thread 是一个完整的对话容器。一个用户可以创建多个 Thread，每个 Thread 保持独立的对话上下文。

**后端**：`ThreadState`（`packages/harness/deerflow/agents/thread_state.py`）

```python
class ThreadState(AgentState):  # 继承 LangGraph 的 AgentState
    sandbox: NotRequired[SandboxState | None]       # 沙箱信息
    thread_data: NotRequired[ThreadDataState | None] # 线程目录路径
    title: NotRequired[str | None]                   # 对话标题
    artifacts: Annotated[list[str], merge_artifacts] # 产物文件列表
    todos: NotRequired[list | None]                   # 任务清单
    uploaded_files: NotRequired[list[dict] | None]    # 上传文件
    viewed_images: Annotated[dict, merge_viewed_images] # 已查看的图片
    # 继承自 AgentState 的核心字段：
    # messages: list[BaseMessage]  — 对话消息列表
```

**前端**：`AgentThreadState`（`frontend/src/core/threads/types.ts`）

```typescript
interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];   // LangGraph SDK 的 Message 类型
  artifacts: string[];
  todos?: Todo[];
}
```

**对比**：

| 字段 | 后端 ThreadState | 前端 AgentThreadState | 说明 |
|------|-----------------|---------------------|------|
| messages | `list[BaseMessage]` | `Message[]` | 对话消息（核心） |
| title | `str \| None` | `string` | 对话标题 |
| artifacts | `list[str]`（去重合并） | `string[]` | 输出文件路径列表 |
| todos | `list \| None` | `Todo[] \| undefined` | 任务清单 |
| sandbox | `SandboxState` | *(不传前端)* | 沙箱状态（后端内部） |
| thread_data | `ThreadDataState` | *(不传前端)* | 目录路径（后端内部） |

注意：`sandbox`、`thread_data`、`uploaded_files`、`viewed_images` 是后端内部字段，不会出现在 SSE 事件中。`serialization.py` 在序列化 `values` 事件时会跳过 `__pregel_*` 等内部键，前端接收到的只是干净的 `title`、`messages`、`artifacts`、`todos`。

### Run（执行回合）

Run 是 Thread 中的一次 Agent 执行。用户每发送一条消息，就触发一次 Run。

**后端**：`RunRecord`（运行时状态）+ `RunCreateRequest` / `RunResponse`（API 层模型）

```python
# API 请求体 — backend/app/gateway/routers/thread_runs.py
class RunCreateRequest(BaseModel):
    assistant_id: str | None        # 使用的 Agent（默认 lead_agent）
    input: dict | None              # 图输入，如 {messages: [...]}
    metadata: dict | None           # Run 元数据
    config: dict | None             # RunnableConfig 覆盖
    context: dict | None            # DeerFlow 上下文（model_name 等）
    stream_mode: list[str] | str | None  # 流模式
    stream_subgraphs: bool          # 是否包含子图事件
    # ... 还有 interrupt_before/after, on_disconnect 等控制字段

# API 响应体
class RunResponse(BaseModel):
    run_id: str
    thread_id: str
    status: str        # pending / running / success / error / interrupted
    metadata: dict
    created_at: str
    updated_at: str
```

**状态流转**：

```
pending ──→ running ──→ success
    │           │
    │           ├──→ interrupted（用户取消）
    │           └──→ error（执行异常）
    └──→ cancelled（并发冲突被拒绝）
```

**前端**：`Run` 类型（来自 `@langchain/langgraph-sdk`），通过 `useStream` hook 的 `onCreated` 回调获取 `run_id` 和 `thread_id`。

### Message（消息）

Message 是对话中的单条消息，是前后端通信的最小单位。

**三种消息类型**：

| 类型 | 后端类 | 前端 `type` 字段 | 含义 |
|------|-------|----------------|------|
| 用户消息 | `HumanMessage` | `"human"` | 用户输入 |
| AI 消息 | `AIMessage` | `"ai"` | AI 回复（可能包含 tool_calls） |
| 工具结果 | `ToolMessage` | `"tool"` | 工具执行结果 |

**消息的关键字段**（前后端通用）：

```
Message
├── id: string                    # 消息唯一标识（跨 SSE 事件追踪同一消息）
├── type: "human" | "ai" | "tool" # 消息类型
├── content: string | ContentPart[] # 消息内容（文本或结构化内容）
├── name?: string                 # 工具名（仅 tool 类型）
├── tool_calls?: ToolCall[]       # 工具调用（仅 ai 类型）
├── tool_call_id?: string         # 关联的工具调用 ID（仅 tool 类型）
└── additional_kwargs?: dict      # 附加数据（文件、自定义元数据等）
```

**AI 消息的 `tool_calls` 字段**：

```json
{
  "type": "ai",
  "content": "",
  "tool_calls": [
    {
      "name": "bash",
      "args": { "command": "pip install langgraph" },
      "id": "call_abc123"
    }
  ]
}
```

AI 消息可以同时包含 `content`（文本回复）和 `tool_calls`（工具调用），也可以只有其中之一。

**工具结果消息**：

```json
{
  "type": "tool",
  "content": "Successfully installed langgraph-0.3.0",
  "name": "bash",
  "tool_call_id": "call_abc123"
}
```

`tool_call_id` 将工具结果与 AI 消息中的 `tool_calls[].id` 关联起来。

### 三者关系

```
Thread（会话线程）
  │
  ├── Run 1（第1次执行）
  │     ├── HumanMessage: "你好"
  │     └── AIMessage: "你好！有什么可以帮你的？"
  │
  ├── Run 2（第2次执行）
  │     ├── HumanMessage: "帮我研究 LangGraph"
  │     ├── AIMessage + tool_calls: [bash, web_search]
  │     ├── ToolMessage: (bash 结果)
  │     ├── ToolMessage: (web_search 结果)
  │     └── AIMessage: "根据研究，LangGraph 是..."
  │
  └── Run 3（第3次执行）
        └── ...
```

- 一个 Thread 可以有多次 Run
- 一次 Run 包含一组消息（用户输入 → AI 回复 + 工具调用 → 工具结果 → 最终回复）
- 消息按时间顺序排列，`tool_call_id` 建立工具调用与结果的关联

---

## 8.2 SSE 协议基础

### SSE 线格式

SSE（Server-Sent Events）是一种基于 HTTP 的单向推送协议。服务端通过 `Content-Type: text/event-stream` 保持长连接，持续发送文本帧。

每一帧的格式是固定的：

```
event: <事件名>
data: <JSON 数据>
id: <事件 ID>（可选，用于断线重连）

```

以 DeerFlow 为例，一个真实的 SSE 帧长这样：

```
event: metadata
data: {"run_id":"run-a1b2c3","thread_id":"thread-x9y8z7"}
id: 1

event: messages
data: [{"type":"ai","content":"你","id":"msg-001","additional_kwargs":{},"response_metadata":{},"type":"ai"},{"langgraph_node":"lead_agent","langgraph_step":3,"langgraph_triggers":["start:lead_agent"]}]
id: 2

event: messages
data: [{"type":"ai","content":"好","id":"msg-001","additional_kwargs":{},"response_metadata":{},"type":"ai"},{"langgraph_node":"lead_agent","langgraph_step":3,"langgraph_triggers":["start:lead_agent"]}]
id: 3

```

关键细节：
- `event:` 字段标识事件类型，前端根据它分发到不同的处理逻辑
- `data:` 字段是 JSON 字符串，包含实际数据
- `id:` 字段单调递增，浏览器断线重连时通过 `Last-Event-ID` 头告知服务端从哪里续传
- 每帧以空行结束（`\n\n`）

### DeerFlow 的 SSE 架构

DeerFlow 的 SSE 系统由三个层次组成：

```
┌─────────────────────────────────────────────────────────┐
│                  Agent 执行层                              │
│  agent.astream(stream_mode=["values","messages","custom"])│
│  → 产出 LangGraph 原始事件流                               │
└───────────────────────┬─────────────────────────────────┘
                        │
                        │ serialize() 序列化
                        ↓
┌─────────────────────────────────────────────────────────┐
│              StreamBridge（解耦层）                        │
│  packages/harness/deerflow/runtime/stream_bridge/         │
│                                                          │
│  StreamEvent(id, event, data) — 统一事件模型              │
│  publish(run_id, event, data) — 生产者接口                │
│  subscribe(run_id) → AsyncIterator — 消费者接口           │
│  publish_end(run_id) — 终止信号                           │
└───────────────────────┬─────────────────────────────────┘
                        │
                        │ sse_consumer() 格式化
                        ↓
┌─────────────────────────────────────────────────────────┐
│              HTTP 传输层                                   │
│  app/gateway/services.py                                  │
│                                                          │
│  format_sse(event, data, event_id) → SSE 帧文本           │
│  sse_consumer() → AsyncGenerator → StreamingResponse      │
│  POST /api/threads/{id}/runs/stream                       │
└─────────────────────────────────────────────────────────┘
```

**核心代码路径**：

1. `StreamEvent`（`runtime/stream_bridge/base.py`）— 事件的数据类，包含 `id`、`event`（名称）、`data`（JSON 载荷）
2. `StreamBridge`（抽象基类）— `publish()` 由 Worker 调用写入事件，`subscribe()` 由 SSE Consumer 调用读取事件。解耦了生产者和消费者
3. `format_sse()`（`app/gateway/services.py`）— 将 `StreamEvent` 转为 SSE 帧文本
4. `sse_consumer()`（`app/gateway/services.py`）— 异步生成器，从 Bridge 订阅事件并 yield SSE 帧。还负责心跳（`": heartbeat\n\n"`）和断线检测
5. `serialize()`（`runtime/serialization.py`）— 将 LangChain 对象转为 JSON 可序列化结构，按 mode 区分处理

### Stream Mode 映射

前端请求的 `stream_mode` 参数决定 SSE 事件的类型。LangGraph 的 `astream()` 方法支持多种流模式，DeerFlow 在前后端之间做了一层映射：

| 前端请求的 stream_mode | LangGraph 内部模式 | SSE event 字段 | 含义 | 数据格式 |
|----------------------|------------------|---------------|------|---------|
| `"values"` | `"values"` | `values` | 每个 node 执行后的完整状态快照 | `{title, messages, artifacts, ...}` |
| `"messages-tuple"` | `"messages"` | `messages` | 消息级增量（token-by-token） | `[MessageChunk, metadata]` |
| `"custom"` | `"custom"` | `custom` | 应用自定义事件 | `{type: "task_running", ...}` |
| `"updates"` | `"updates"` | `updates` | node 写入的增量 | `{node_name: {writes}}` |

注意 `"messages-tuple"` 是前端请求的名称，在 Worker 中被映射为 LangGraph 的 `"messages"` 模式（`worker.py` 中的 `_lg_mode_to_sse_event()`）。这个映射是 DeerFlow 的一个设计决策，目的是在 SSE 事件名中区分「消息流」和「其他流」。

前端 `useStream` hook 默认请求的模式由 `@langchain/langgraph-sdk` 决定。在 DeerFlow 的 `sendMessage` 中，实际传入的选项是：

```typescript
await thread.submit(
  { messages: [{ type: "human", content: [...] }] },
  {
    threadId: threadId,
    streamSubgraphs: true,       // 包含子图事件
    streamResumable: true,       // 支持断线续传
    config: { recursion_limit: 1000 },
    context: { ... },            // DeerFlow 上下文
  }
);
```

SDK 内部会根据 `useStream` 的参数自动设置 `stream_mode`。

---

## 8.3 完整通信案例

以用户发送「**帮我研究 LangGraph 的流式架构**」为例，完整追踪从键盘输入到 AI 回复渲染的每一步网络通信。

### Step 1：前端发起请求

用户点击发送后，前端做三件事：

**1a. 立即显示乐观消息**（不等后端确认）：

```typescript
// frontend/src/core/threads/hooks.ts — sendMessage()
const newOptimistic: Message[] = [{
  type: "human",
  id: `opt-human-${Date.now()}`,   // 临时 ID
  content: [{ type: "text", text: "帮我研究 LangGraph 的流式架构" }],
  additional_kwargs: { ... },
}];
setOptimisticMessages(newOptimistic);
```

**1b. 上传文件**（如果有附件，通过 REST API）：

```
POST /api/threads/{thread_id}/uploads
Content-Type: multipart/form-data
```

**1c. 通过 LangGraph SDK 提交 Run 并建立 SSE 连接**：

SDK 内部会发送如下请求：

```http
POST /api/threads/{thread_id}/runs/stream HTTP/1.1
Content-Type: application/json
Accept: text/event-stream

{
  "assistant_id": "lead_agent",
  "input": {
    "messages": [{
      "type": "human",
      "content": [{ "type": "text", "text": "帮我研究 LangGraph 的流式架构" }],
      "additional_kwargs": {}
    }]
  },
  "stream_mode": ["values", "messages-tuple", "custom"],
  "stream_subgraphs": true,
  "stream_resumable": true,
  "config": {
    "recursion_limit": 1000
  },
  "context": {
    "model_name": "glm-4.7",
    "thinking_enabled": true,
    "is_plan_mode": false,
    "subagent_enabled": false,
    "reasoning_effort": "low",
    "thread_id": "thread-x9y8z7"
  }
}
```

请求体的关键字段：

| 字段 | 含义 |
|------|------|
| `assistant_id` | 要使用的 Agent 名称（默认 `lead_agent`） |
| `input.messages` | 用户消息（LangChain 格式） |
| `stream_mode` | 请求哪些类型的 SSE 事件 |
| `stream_subgraphs` | 是否包含子 Agent 的事件 |
| `context` | DeerFlow 运行时上下文（模型、模式等） |

### Step 2：后端创建 Run

Gateway 收到请求后，`start_run()`（`app/gateway/services.py`）执行以下步骤：

```
1. 验证 model_name 是否在允许列表中
2. 创建 RunRecord（状态: pending）
3. 构建 RunnableConfig（合并 context、configurable）
4. 注入认证用户信息
5. 启动 asyncio.Task 执行 agent（后台任务）
6. 返回 StreamingResponse（Content-Type: text/event-stream）
```

此时 SSE 连接已建立，前端开始接收事件。

### Step 3：Agent 执行 → SSE 事件流

Agent 在后台 Task 中执行 `agent.astream()`，每产出一个事件就通过 `StreamBridge.publish()` 推送到 SSE 连接。

以下是按时间顺序出现的典型 SSE 事件：

#### 事件 1：metadata — 初始化

```
event: metadata
data: {"run_id":"run-a1b2c3","thread_id":"thread-x9y8z7"}
id: 1

```

这是第一个事件，告知前端当前 Run 的 ID。前端 `useStream` 的 `onCreated` 回调在此触发，提取 `run_id` 和 `thread_id`。

#### 事件 2-3：values — 用户消息进入 State

Agent 的第一个 node 处理用户输入，将 `HumanMessage` 加入 state。`values` 事件发送完整的状态快照：

```
event: values
data: {
  "title": null,
  "messages": [
    {
      "type": "human",
      "id": "msg-human-001",
      "content": "帮我研究 LangGraph 的流式架构",
      "additional_kwargs": {}
    }
  ],
  "artifacts": []
}
id: 2

```

注意 `values` 事件每次发送的是**完整状态**（而非增量）。这意味着随着对话变长，每个 `values` 事件会越来越大。DeerFlow 用 `SummarizationMiddleware` 来控制消息列表的长度。

#### 事件 4-8：messages — AI 流式回复

AI 开始生成回复。`messages` 模式下，每个 token 增量都会发送一个事件：

```
event: messages
data: [
  {
    "type": "ai",
    "content": "我",
    "id": "msg-ai-002",
    "additional_kwargs": {},
    "response_metadata": {},
    "tool_calls": []
  },
  {
    "langgraph_node": "lead_agent",
    "langgraph_step": 3,
    "langgraph_triggers": ["start:lead_agent"]
  }
]
id: 3

event: messages
data: [
  {
    "type": "ai",
    "content": "来",
    "id": "msg-ai-002",
    "tool_calls": []
  },
  {...}
]
id: 4

event: messages
data: [
  {
    "type": "ai",
    "content": "帮",
    "id": "msg-ai-002",
    "tool_calls": []
  },
  {...}
]
id: 5

```

关键点：
- 同一条 AI 消息的 `id`（`"msg-ai-002"`）在多个事件中保持不变
- `content` 是**增量**（delta），不是累积文本。前端需要按 `id` 拼接同一消息的所有 delta
- 第二个数组元素是 LangGraph 的 metadata，包含 node 名、step 编号等

#### 事件 9-10：messages — 工具调用

AI 决定调用工具（如 `web_search`），通过 `tool_calls` 字段传递：

```
event: messages
data: [
  {
    "type": "ai",
    "content": "",
    "id": "msg-ai-002",
    "tool_calls": [
      {
        "name": "web_search",
        "args": { "query": "LangGraph streaming architecture" },
        "id": "call_ws_001"
      }
    ]
  },
  {...}
]
id: 9

```

随后工具执行完成，发送 ToolMessage：

```
event: messages
data: [
  {
    "type": "tool",
    "content": "LangGraph 是一个用于构建有状态多参与者应用的框架...",
    "name": "web_search",
    "tool_call_id": "call_ws_001",
    "id": "msg-tool-003"
  },
  {...}
]
id: 10

```

`tool_call_id: "call_ws_001"` 将工具结果与之前 AI 消息中的 `tool_calls[0].id` 关联。

#### 事件 11：custom — 子 Agent 状态（如果启用了子 Agent）

如果用户使用 Ultra 模式（`subagent_enabled: true`），AI 可能通过 `task` 工具委派子 Agent。子 Agent 的状态通过 `custom` 事件推送：

```
event: custom
data: {
  "type": "task_started",
  "task_id": "task-p1q2r3",
  "message": {
    "type": "ai",
    "content": "正在启动研究任务...",
    "id": "msg-sub-001"
  }
}
id: 11

event: custom
data: {
  "type": "task_running",
  "task_id": "task-p1q2r3",
  "message": {
    "type": "ai",
    "content": "正在搜索 LangGraph 文档...",
    "id": "msg-sub-002"
  }
}
id: 12

event: custom
data: {
  "type": "task_completed",
  "task_id": "task-p1q2r3",
  "message": {
    "type": "ai",
    "content": "研究完成。LangGraph 的流式架构基于...",
    "id": "msg-sub-003"
  }
}
id: 13

```

前端在 `onCustomEvent` 回调中处理这些事件，更新子 Agent 任务卡片的显示。

#### 事件 14：values — 最终状态快照

Agent 执行完成后，最后一个 `values` 事件包含完整的状态：

```
event: values
data: {
  "title": "LangGraph 流式架构研究",
  "messages": [
    { "type": "human", "content": "帮我研究 LangGraph 的流式架构", ... },
    { "type": "ai", "content": "我来帮你研究...\n\nLangGraph 的流式架构...", ... }
  ],
  "artifacts": []
}
id: 14

```

注意 `title` 已被 `TitleMiddleware` 自动生成为 `"LangGraph 流式架构研究"`。

#### 事件 15：end — 流结束

```
event: end
data: null
id: 15

```

`end` 事件表示本次 Run 的所有事件已发送完毕。前端 `useStream` 的 `onFinish` 回调在此触发。

### Step 4：前端处理事件

前端通过 `useStream` hook（`frontend/src/core/threads/hooks.ts`）接收 SSE 事件，不同类型的回调负责不同的处理：

```typescript
const thread = useStream<AgentThreadState>({
  client: getAPIClient(),
  assistantId: "lead_agent",
  threadId: threadId,
  reconnectOnMount: true,           // 断线重连

  onCreated(meta) {
    // metadata 事件到达 → 记录 run_id、thread_id
    handleStreamStart(meta.thread_id, meta.run_id);
  },

  onUpdateEvent(data) {
    // updates 事件 → 处理标题变更、摘要中间件等
    if (data.title) {
      // 更新 TanStack Query 缓存中的线程标题
    }
  },

  onLangChainEvent(event) {
    // LangChain 内部事件 → 工具调用完成
    if (event.event === "on_tool_end") {
      // 通知 UI 更新工具状态
    }
  },

  onCustomEvent(event) {
    // custom 事件 → 子 Agent 状态
    if (event.type === "task_running") {
      updateSubtask({ id: event.task_id, latestMessage: event.message });
    }
  },

  onFinish(state) {
    // end 事件 → 刷新缓存、清理状态
    // state.values 包含最终状态
  },

  onError(error) {
    // error 事件 → 清理乐观消息、显示错误
    setOptimisticMessages([]);
    toast.error(getStreamErrorMessage(error));
  },
});
```

`useStream` hook（来自 `@langchain/langgraph-sdk/react`）内部负责：
- 解析 SSE 帧的 `event` 和 `data` 字段
- 对 `messages` 事件中的 delta 按消息 ID 进行拼接，还原完整的 AI 回复
- 将 `values` 事件的完整状态与 delta 累积的状态进行合并
- 通过 `reconnectOnMount: true` 在组件重新挂载时自动重连

### Step 5：消息合并与渲染

前端最终显示的消息列表来自三个数据源的合并：

```typescript
// frontend/src/core/threads/hooks.ts — mergeMessages()
const mergedMessages = mergeMessages(
  history,            // 1. 历史消息（通过 REST API 分页加载）
  thread.messages,    // 2. SSE 实时消息（useStream 维护）
  optimisticMessages, // 3. 乐观消息（用户发送后立即显示）
);
```

合并逻辑：

```
历史消息 [msg-1, msg-2, msg-3, ...msg-N]
                           ↑ 与 SSE 消息可能有重叠
SSE 消息           [msg-N-2, msg-N-1, msg-N, msg-N+1, msg-N+2]
                                              ↑ 优先使用 SSE 版本
乐观消息                                              [opt-msg-1]
                                                    ↑ 临时占位，服务端消息到达后被替换
```

`mergeMessages()` 的去重策略：
1. 从 `history` 的末尾开始向前扫描
2. 如果 `history` 中的消息 ID 已经出现在 `thread.messages` 中，则跳过
3. 合并结果：`[不重叠的历史] + [SSE 消息] + [乐观消息]`

当服务端的 `HumanMessage` 到达后（通过 `values` 事件），前端的 `humanMessageCount` 增加，触发乐观消息的清理：

```typescript
// 检测到服务端的用户消息已到达 → 清除乐观消息
if (humanMessageCount > prevHumanMsgCountRef.current) {
  setOptimisticMessages([]);
}
```

---

## 8.4 消息渲染管线

前端将 AI 的流式输出分为**四种渲染组**：

```
AI 回复流
    ↓
消息分组逻辑 (message-grouping)
    ↓
┌────────────────┐
│ processing 组   │ ← AI 正在推理/调用工具
│ (推理中 + 工具) │    显示：思考动画 + 工具调用卡片
└────────────────┘
┌────────────────┐
│ subagent 组     │ ← 子 Agent 执行中
│ (子任务卡片)    │    显示：任务名称 + 状态 + 进度
└────────────────┘
┌────────────────┐
│ present-files组 │ ← 文件产物展示
│ (文件列表)      │    显示：文件名 + 下载链接
└────────────────┘
┌────────────────┐
│ clarification组 │ ← 需要用户澄清
│ (提问)          │    显示：选择项或输入框
└────────────────┘
```

### 工具调用的检测与分类

```typescript
// src/core/messages/utils.ts
hasToolCalls(message)         // 检查是否有工具调用
hasSubagent(message)          // 检查是否是 task 工具调用
hasPresentFiles(message)      // 检查是否是 present_files 调用
hasClarificationToolMessage(message)  // 检查是否是澄清请求
```

这些检测函数决定了消息的**渲染模板**——不同类型的工具调用有不同的 UI 组件。

### 流式文本渲染

AI 的流式文本通过 `streamdown` 库实现 Markdown 实时渲染：

```typescript
// 逐词动画 + Markdown 解析
const plugins = {
  remarkPlugins: [remarkGfm, [remarkMath, { singleDollarTextMath: true }]],
  rehypePlugins: [
    [rehypeKatex, { output: "html" }],
    rehypeSplitWordsIntoSpans,  // 逐词动画
  ],
};
```

支持的 Markdown 特性：表格、代码块、数学公式（KaTeX）、列表、链接等。

---

## 8.5 乐观更新（Optimistic UI）

乐观更新让用户发送消息后**立即看到自己的消息**，而不需要等待后端确认：

```
用户点击发送
    ↓
1. 立即在消息列表中显示用户消息（乐观消息，临时 ID: opt-human-xxx）
2. 如果有文件附件，显示「上传中」状态
    ↓
3. SSE 连接建立，服务端消息开始到达
    ↓
4. 服务端的 HumanMessage 到达（通过 values 事件，含真实 ID）
5. 前端检测到 humanMessageCount 增加
6. 清除乐观消息（服务端消息已替代它）
```

**错误回滚**：如果上传失败或 SSE 连接出错，乐观消息会被立即清除：

```typescript
onError(error) {
  setOptimisticMessages([]);  // 清除乐观消息
  toast.error(getStreamErrorMessage(error));
}
```

---

## 8.6 SSE 事件速查表

| 事件 | SSE event 字段 | data 示例 | 前端处理 | 说明 |
|------|---------------|----------|---------|------|
| 元数据 | `metadata` | `{"run_id":"...","thread_id":"..."}` | `onCreated` | 第一个事件，标识 Run |
| 状态快照 | `values` | `{"title":"...","messages":[...],"artifacts":[...]}` | 内部合并 | 每个 node 执行后的完整状态 |
| 消息增量 | `messages` | `[{"type":"ai","content":"delta","id":"..."}, {...}]` | 内部累积 | token-by-token 流式文本 |
| 自定义事件 | `custom` | `{"type":"task_running","task_id":"...","message":{...}}` | `onCustomEvent` | 子 Agent 状态 |
| 更新 | `updates` | `{"node_name":{"key":"value"}}` | `onUpdateEvent` | node 写入增量 |
| 错误 | `error` | `{"message":"...","name":"ValueError"}` | `onError` | 执行异常 |
| 心跳 | (注释行) | `": heartbeat\n\n"` | (忽略) | 保持连接活跃 |
| 结束 | `end` | `null` | `onFinish` | Run 完成 |

### 断线重连

SSE 协议原生支持断线重连。浏览器的 `EventSource` API 在连接断开后会自动重连，并通过 `Last-Event-ID` 请求头告知服务端最后一个收到的事件 ID：

```http
GET /api/threads/{thread_id}/runs/{run_id}/stream
Last-Event-ID: 8
```

DeerFlow 的 `MemoryStreamBridge` 会保留事件历史，收到 `Last-Event-ID` 后从该 ID 之后继续推送，避免前端丢失事件。

`useStream` hook 的 `reconnectOnMount: true` 参数确保组件重新挂载时自动恢复 SSE 连接。

---

## 思考题

**题 1**：`values` 事件每次发送完整的状态快照（包括所有消息），这在长对话中会不会成为性能瓶颈？DeerFlow 是如何缓解这个问题的？

> **参考答案**：是的，`values` 事件会随对话增长而变大。DeerFlow 有两个缓解措施：1）**SummarizationMiddleware** — 当消息接近 token 上限时，自动将旧消息摘要为一条 summary 消息，控制 `messages` 列表的长度；2）前端通过 `messages` 模式的 delta 事件获取增量文本，不完全依赖 `values` 事件来显示 AI 回复。`values` 事件主要用于获取完整的状态（如标题变更、artifacts 列表更新）。

**题 2**：`messages` 事件中的 AI 消息 `content` 是增量（delta），前端需要按 `id` 拼接。如果某个 delta 事件因为网络问题丢失了，会发生什么？前端如何检测和处理这种情况？

> **参考答案**：如果 delta 丢失，拼接后的文本会出现缺失。`useStream` hook（来自 `@langchain/langgraph-sdk/react`）内部会按消息 ID 累积 delta，但不做完整性校验。DeerFlow 的安全网是 `values` 事件——它包含完整的消息列表，可以覆盖 delta 拼接的结果。另外，SSE 的 `id` 字段和 `Last-Event-ID` 重连机制确保短暂断线不会丢失事件。如果重连失败，用户可以刷新页面，前端会通过 REST API 加载最新的完整消息历史。

**题 3**：乐观消息的 ID 格式是 `opt-human-{timestamp}`，而服务端消息有真实 ID。如果用户在网络慢的情况下连续发送两条消息，乐观消息的去重逻辑会不会出错？

> **参考答案**：不会出错。去重逻辑不是基于 ID 匹配乐观消息和服务端消息的。它的工作方式是：记录发送前的 `humanMessageCount`（服务端消息中的 human 消息数量），然后监控这个计数。当服务端的 human 消息到达（通过 `values` 事件），计数增加，前端就清除乐观消息。每条乐观消息的清理都独立于其他乐观消息。不过，如果两次发送太快（前一条还没被服务端确认就发第二条），`sendInFlightRef` 会阻止并发发送。

**题 4**：DeerFlow 使用 `StreamBridge` 解耦了 Agent 执行（生产者）和 SSE 传输（消费者）。这种解耦带来了哪些好处？如果直接在 Agent 执行中 yield SSE 帧会有什么问题？

> **参考答案**：解耦的好处：1）**多订阅者**——StreamBridge 支持多个消费者同时订阅同一个 Run（如前端和 IM 通道）；2）**生命周期独立**——客户端断线时，Agent 可以继续执行（`on_disconnect: "continue"`），不需要在 Agent 代码中处理连接状态；3）**可测试性**——可以单独测试 Agent 逻辑（用内存 Bridge）和 SSE 传输逻辑；4）**延迟清理**——Bridge 可以在 Run 完成后保留事件 60 秒（`cleanup(run_id, delay=60)`），给迟到的订阅者一个追赶的机会。如果直接 yield：Agent 代码会被 HTTP 细节污染，无法支持多订阅者，断线时 Agent 会崩溃。

---

准备好就说「继续」进入第九章——贡献实战。
