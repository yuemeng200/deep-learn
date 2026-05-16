# 前置知识：LangChain 与 LangGraph 最小工具箱

> 深度理解 DeerFlow 项目所需的 LangChain/LangGraph 知识。只覆盖**项目实际用到的 API 和模式**，每个概念都指向项目中的真实代码。

**版本上下文**：项目使用 `langgraph>=1.1.9`、`langchain>=1.2.15`，依赖 LangGraph 的 `create_agent` 高级 API（而非手动拼装 `StateGraph`）。

---

## 1. 核心概念：Agent = 状态机 + LLM + 工具 + 中间件

**一句话理解**：DeerFlow 的 Lead Agent 本质上是 LangGraph 的 `create_agent()` 创建的一个 **ReAct 循环状态机**——LLM 思考 → 调用工具 → 观察结果 → 再思考，直到得出最终答案。

```
用户消息
  ↓
┌──────────────────────────────────────────────┐
│  LangGraph Agent (create_agent 创建)          │
│                                              │
│  ┌─────────┐   ┌─────────┐   ┌──────────┐  │
│  │ 中间件链  │ → │  LLM    │ → │ 工具执行  │  │
│  │ (18个)   │   │ 思考    │   │ bash/搜索 │  │
│  └─────────┘   └────┬────┘   └─────┬────┘  │
│                     │               │        │
│                     └─── tool_calls ─┘        │
│                     (循环直到无工具调用)        │
└──────────────────────────────────────────────┘
  ↓
最终响应
```

项目入口 —— `backend/langgraph.json:8`：
```json
{
  "graphs": {
    "lead_agent": "deerflow.agents:make_lead_agent"
  }
}
```

这意味着 LangGraph Server 启动时，会调用 `deerflow.agents.make_lead_agent` 来创建图。

---

## 2. 图的构建：`create_agent()`

**核心洞察**：DeerFlow 不手动调用 `StateGraph.add_node()` / `add_edge()`，而是用 LangChain 的 `create_agent()` 高级 API。它内部自动构建 ReAct 循环（LLM → 工具 → LLM → ...），你只需要提供组件。

项目示例 —— `backend/packages/harness/deerflow/agents/lead_agent/agent.py:434`：
```python
from langchain.agents import create_agent

return create_agent(
    model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled),
    tools=filter_tools_by_skill_allowed_tools(tools + extra_tools, skills_for_tool_policy),
    middleware=_build_middlewares(config, model_name=model_name, app_config=resolved_app_config),
    system_prompt=apply_prompt_template(
        subagent_enabled=subagent_enabled,
        agent_name=agent_name,
        ...
    ),
    state_schema=ThreadState,
)
```

5 个参数决定了 Agent 的全部行为：

| 参数 | 类型 | 作用 | 项目中从哪来 |
|------|------|------|------------|
| `model` | `BaseChatModel` | LLM 实例 | `create_chat_model()` 工厂 |
| `tools` | `list[BaseTool]` | 可调用的工具列表 | `get_available_tools()` |
| `middleware` | `list[AgentMiddleware]` | 拦截器链 | `_build_middlewares()` |
| `system_prompt` | `str` | 系统提示词 | `apply_prompt_template()` |
| `state_schema` | `TypedDict` | 状态结构 | `ThreadState` |

---

## 3. 状态（State）

### 3.1 `AgentState` — LangGraph 内置状态

LangGraph 的 `AgentState` 已经定义了核心字段：

```python
class AgentState(TypedDict):
    messages: list[BaseMessage]   # 对话历史
```

### 3.2 `ThreadState` — DeerFlow 扩展状态

DeerFlow 通过继承 `AgentState` 添加自定义字段：

`backend/packages/harness/deerflow/agents/thread_state.py:48`：
```python
class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]           # 沙箱 ID
    thread_data: NotRequired[ThreadDataState | None]     # 线程工作目录
    title: NotRequired[str | None]                       # 对话标题
    artifacts: Annotated[list[str], merge_artifacts]     # 产物文件列表（带去重 Reducer）
    todos: NotRequired[list | None]                      # 待办事项
    uploaded_files: NotRequired[list[dict] | None]       # 上传文件
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]
```

### 3.3 Reducer — 状态合并策略

当多个子 Agent 同时更新 `artifacts` 时，如何合并？`Annotated[list[str], merge_artifacts]` 就是答案——`merge_artifacts` 函数定义了合并逻辑：

`backend/packages/harness/deerflow/agents/thread_state.py:21`：
```python
def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    if existing is None:
        return new or []
    if new is None:
        return existing
    return list(dict.fromkeys(existing + new))  # 合并 + 去重保序
```

**类比其他框架**：类似 Redux 的 reducer 函数——`(oldState, update) => newState`。

---

## 4. 消息（Messages）

LangChain 定义了一套消息类型体系，DeerFlow 大量使用：

### 4.1 消息类型一览

```
BaseMessage                  # 所有消息的基类
├── HumanMessage             # 用户消息
├── AIMessage                # AI 回复（含 tool_calls）
├── SystemMessage            # 系统提示词
└── ToolMessage              # 工具执行结果
```

### 4.2 `AIMessage` 的 `tool_calls` — 工具调用请求

LLM 决定调用工具时，`AIMessage` 上会携带 `tool_calls` 字段：

```python
# LLM 返回的 AIMessage 中
message = AIMessage(
    content="",  # 可能为空
    tool_calls=[
        {
            "name": "bash",             # 工具名
            "args": {"command": "ls"},   # 参数
            "id": "call_abc123",         # 调用 ID（用于匹配结果）
        }
    ]
)
```

### 4.3 `ToolMessage` — 工具执行结果

工具执行后，结果以 `ToolMessage` 返回，通过 `tool_call_id` 与原始调用配对：

`backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py:32`：
```python
return ToolMessage(
    content=f"Error: Tool '{tool_name}' failed with {exc.__class__.__name__}: {detail}",
    tool_call_id=tool_call_id,   # 必须与 AIMessage.tool_calls[].id 匹配
    name=tool_name,
    status="error",
)
```

### 4.4 消息流（一次工具调用的完整生命周期）

```
HumanMessage(content="列出当前目录文件")
    ↓
AIMessage(tool_calls=[{"name":"bash","args":{"command":"ls"},"id":"call_1"}])
    ↓ 工具执行
ToolMessage(content="file1.txt\nfile2.py", tool_call_id="call_1", name="bash")
    ↓
AIMessage(content="当前目录包含以下文件：file1.txt 和 file2.py")  ← 最终回复
```

---

## 5. 工具（Tools）

### 5.1 `@tool` 装饰器 — 定义工具

LangChain 用 `@tool` 装饰器把普通函数变成 LLM 可调用的工具。docstring 和类型注解自动生成工具的 JSON Schema（供 LLM 理解工具能力）。

`backend/packages/harness/deerflow/sandbox/tools.py:1223`：
```python
from langchain.tools import tool

@tool("bash", parse_docstring=True)
def bash_tool(runtime: Runtime, description: str, command: str) -> str:
    """Execute a bash command in a Linux environment.

    Args:
        description: Explain why you are running this command.
        command: The bash command to execute.
    """
    sandbox = ensure_sandbox_initialized(runtime)
    ...
    return sandbox.execute_command(command)
```

**关键点**：
- `parse_docstring=True`：从 Google 风格 docstring 的 `Args:` 部分提取参数描述
- `runtime: Runtime`：特殊参数，LangChain 自动注入当前运行时上下文（不会暴露给 LLM）
- `-> str`：返回值类型告诉 LLM 工具返回什么

### 5.2 `Runtime` / `ToolRuntime` — 注入运行时状态

工具需要访问当前沙箱、线程数据等状态。LangChain 的 `ToolRuntime` 机制自动注入这些信息。

`backend/packages/harness/deerflow/tools/types.py:1`：
```python
from langchain.tools import ToolRuntime
from deerflow.agents.thread_state import ThreadState

# DeerFlow 定义的 Runtime 类型
Runtime = ToolRuntime[dict[str, Any], ThreadState]
```

工具函数中通过 `runtime` 参数访问状态：
```python
@tool("bash", parse_docstring=True)
def bash_tool(runtime: Runtime, description: str, command: str) -> str:
    # runtime.state 就是当前的 ThreadState
    sandbox = ensure_sandbox_initialized(runtime)
    thread_data = get_thread_data(runtime)  # 从 state 中取 thread_data
```

### 5.3 工具注册流程

DeerFlow 的工具收集是一个多层组合过程：

`backend/packages/harness/deerflow/tools/tools.py:44`：
```python
def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    *,
    app_config: AppConfig | None = None,
) -> list[BaseTool]:
```

工具来源优先级：
1. **配置工具** — `config.yaml` 中定义的 `tools:`，通过 `resolve_variable()` 动态加载
2. **内置工具** — `present_files`、`ask_clarification`
3. **MCP 工具** — 外部 MCP 服务器的工具，通过 `langchain-mcp-adapters` 加载
4. **视觉工具** — 如果模型支持 vision，添加 `view_image`
5. **子 Agent 工具** — 如果启用，添加 `task`

最终去重后传给 `create_agent(tools=...)`。

### 5.4 MCP 工具集成

`backend/packages/harness/deerflow/mcp/tools.py:16`：
```python
from langchain_mcp_adapters.client import MultiServerMCPClient

async def get_mcp_tools() -> list[BaseTool]:
    client = MultiServerMCPClient(servers_config, ...)
    tools = await client.get_tools()
    # MCP 工具自动转为 LangChain BaseTool
    return tools
```

MCP 工具和内置工具是同一个 `BaseTool` 类型，对 Agent 来说完全透明。

---

## 6. 中间件（Middleware）— 拦截器模式

**核心洞察**：DeerFlow 最独特的设计就是 18 个中间件组成的处理管道。理解中间件就理解了整个请求处理流程。

### 6.1 中间件基类

`AgentMiddleware[T]` 提供了 4 个可重写的钩子方法：

```python
from langchain.agents.middleware import AgentMiddleware

class MyMiddleware(AgentMiddleware[AgentState]):

    def after_model(self, state, runtime) -> dict | None:
        """LLM 返回后、工具执行前。可以修改 LLM 输出。"""
        ...

    def after_agent(self, state, runtime) -> dict | None:
        """Agent 完整执行后。适合做副作用（如记忆更新）。"""
        ...

    def wrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """包裹单个工具调用。可以拦截/修改/替换工具执行。"""
        ...

    async def awrap_tool_call(self, request, handler) -> ToolMessage | Command:
        """wrap_tool_call 的异步版本。"""
        ...
```

每个方法返回 `dict`（状态更新）或 `None`（不更新状态）。

### 6.2 中间件执行顺序

`backend/packages/harness/deerflow/agents/lead_agent/agent.py:240` 的注释清楚说明了顺序和原因：

```
ThreadDataMiddleware      → 1. 创建线程目录（后续中间件依赖 thread_id）
UploadsMiddleware          → 2. 处理上传文件（依赖 thread_id）
SandboxMiddleware          → 3. 获取沙箱（依赖线程目录）
DanglingToolCallMiddleware → 4. 修补缺失的 ToolMessage
LLMErrorHandlingMiddleware → 5. LLM 错误处理
GuardrailMiddleware        → 6. 安全审计
SandboxAuditMiddleware     → 7. 沙箱操作审计
ToolErrorHandlingMiddleware→ 8. 工具错误 → ToolMessage
SummarizationMiddleware    → 9. 上下文压缩
TodoListMiddleware         → 10. 待办事项管理
TokenUsageMiddleware       → 11. Token 用量统计
TitleMiddleware            → 12. 自动标题
MemoryMiddleware           → 13. 记忆更新（必须晚于 TitleMiddleware）
ViewImageMiddleware        → 14. 图片注入
SubagentLimitMiddleware    → 15. 子 Agent 并发限制
LoopDetectionMiddleware    → 16. 循环检测
ClarificationMiddleware    → 17. 澄清请求拦截（必须最后！）
```

### 6.3 实战示例：`ToolErrorHandlingMiddleware`

`backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py:21`：

```python
class ToolErrorHandlingMiddleware(AgentMiddleware[AgentState]):

    @override
    def wrap_tool_call(self, request, handler):
        try:
            return handler(request)           # 执行原始工具
        except GraphBubbleUp:
            raise                              # LangGraph 控制流信号，不要吞掉
        except Exception as exc:
            # 把异常转成 ToolMessage，让 LLM 知道工具失败了
            return ToolMessage(
                content=f"Error: Tool failed with {exc.__class__.__name__}",
                tool_call_id=request.tool_call["id"],
                status="error",
            )
```

**设计精髓**：工具异常不会导致 Agent 崩溃，而是变成一条错误 `ToolMessage`，LLM 收到后可以换一个工具或调整策略。

### 6.4 `Command` — 中间件控制流

LangGraph 的 `Command` 对象让中间件可以控制图的执行走向：

`backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py:153`：
```python
from langgraph.types import Command, END

return Command(
    update={"messages": [tool_message]},  # 更新状态
    goto=END,                             # 跳转到结束节点（中断执行）
)
```

`Command` 的能力：
- `update={}`：更新 state 中的字段
- `goto=END`：跳转到指定节点（`END` 表示结束）
- 同时更新状态并跳转

### 6.5 `ToolCallRequest` — 工具调用请求对象

`wrap_tool_call` 接收的 `request` 对象：

```python
from langgraph.prebuilt.tool_node import ToolCallRequest

request.tool_call = {
    "name": "bash",
    "args": {"command": "ls"},
    "id": "call_abc123",
}
```

---

## 7. 模型工厂（Model Factory）

### 7.1 `create_chat_model()` — 动态创建 LLM 实例

`backend/packages/harness/deerflow/models/factory.py:50`：
```python
from langchain.chat_models import BaseChatModel

def create_chat_model(
    name: str | None = None,
    thinking_enabled: bool = False,
    *,
    app_config: AppConfig | None = None,
    **kwargs,
) -> BaseChatModel:
    config = app_config or get_app_config()
    model_config = config.get_model_config(name)

    # 动态加载模型类，如 "langchain_openai:ChatOpenAI"
    model_class = resolve_class(model_config.use, BaseChatModel)

    # 从 config.yaml 构造参数
    model_settings = model_config.model_dump(exclude_none=True, exclude={...})

    # 实例化模型
    return model_class(**kwargs, **model_settings)
```

`config.yaml` 中的配置：
```yaml
models:
  - name: gpt-4
    use: "langchain_openai:ChatOpenAI"  # 类路径，通过反射加载
    model: "gpt-4o"
    api_key: "$OPENAI_API_KEY"           # $ 前缀 → 环境变量
    supports_thinking: false
    supports_vision: true
```

**关键点**：`use` 字段是 `"模块路径:类名"` 格式，通过 `resolve_class()` 动态导入。这意味着你可以在不修改代码的情况下切换模型提供商。

### 7.2 `BaseChatModel` — 所有 LLM 的基类

```python
from langchain.chat_models import BaseChatModel

# 调用 LLM
response = await model.ainvoke([HumanMessage(content="Hello")])
# response 是 AIMessage

# 流式调用
async for chunk in model.astream([HumanMessage(content="Hello")]):
    # chunk 是 AIMessageChunk
```

在 Agent 中，模型通过 `bind_tools()` 绑定工具 schema，LLM 就知道可以调用哪些工具。

---

## 8. 流式处理（Streaming）

### 8.1 `agent.astream()` — 流式执行

LangGraph Agent 支持多种流式模式，DeerFlow 使用了三种：

```python
# 多模式组合流式
async for item in agent.astream(
    state,                          # 初始状态
    config=runnable_config,         # 运行时配置
    context=context,                # 上下文（DeerFlow 扩展）
    stream_mode=["values", "messages", "custom"],
):
    mode, chunk = item  # stream_mode 返回 (mode, data) 元组
```

| stream_mode | 返回内容 | DeerFlow 用途 |
|-------------|---------|-------------|
| `"values"` | 完整状态快照 | 获取最终结果、标题、artifacts |
| `"messages"` | 增量消息块（delta） | 实时显示 AI 输出、工具调用 |
| `"custom"` | 自定义事件 | 中间件推送的自定义数据 |

### 8.2 StreamBridge — 生产者/消费者解耦

`backend/packages/harness/deerflow/runtime/stream_bridge/base.py:37`：

```python
class StreamBridge(abc.ABC):
    async def publish(self, run_id: str, event: str, data: Any) -> None:
        """Agent worker（生产者）推送事件"""

    def subscribe(self, run_id: str) -> AsyncIterator[StreamEvent]:
        """SSE 端点（消费者）消费事件"""
```

流程：
```
agent.astream() → publish() → 内存队列 → subscribe() → SSE → 前端
```

### 8.3 嵌入式客户端的流式消费

`backend/packages/harness/deerflow/client.py` 用同步生成器封装流式输出：

```python
for item in self._agent.stream(state, config=config, stream_mode=["values", "messages", "custom"]):
    if isinstance(item, tuple):
        mode, chunk = item

    if mode == "messages":
        # AIMessage delta → 实时文本
        yield StreamEvent(type="messages-tuple", data=...)
    elif mode == "values":
        # 完整状态快照
        yield StreamEvent(type="values", data=...)
    elif mode == "custom":
        # 自定义事件
        yield StreamEvent(type="custom", data=chunk)
```

---

## 9. 检查点（Checkpointer）— 状态持久化

### 9.1 为什么需要 Checkpointer

LangGraph 的 Checkpointer 在**每次图执行步骤后**保存状态。这意味着：
- 用户关闭浏览器，对话不会丢失
- Agent 中断后可以恢复
- 多轮对话的 messages 历史得以保留

### 9.2 DeerFlow 支持的后端

`backend/packages/harness/deerflow/runtime/checkpointer/async_provider.py:43`：

```python
@contextlib.asynccontextmanager
async def _async_checkpointer(config) -> AsyncIterator[Checkpointer]:
    if config.type == "memory":
        from langgraph.checkpoint.memory import InMemorySaver
        yield InMemorySaver()           # 开发用，重启即丢失

    elif config.type == "sqlite":
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        async with AsyncSqliteSaver.from_conn_string(conn_str) as saver:
            await saver.setup()
            yield saver                  # 单机部署

    elif config.type == "postgres":
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        async with AsyncPostgresSaver.from_conn_string(conn_str) as saver:
            await saver.setup()
            yield saver                  # 生产环境
```

### 9.3 配置入口

`backend/langgraph.json:14`：
```json
{
  "checkpointer": {
    "path": "./packages/harness/deerflow/runtime/checkpointer/async_provider.py:make_checkpointer"
  }
}
```

---

## 10. `RunnableConfig` — 运行时配置

`RunnableConfig` 是 LangChain 的配置传递机制，在整个调用链中透传。

### 10.1 核心结构

```python
from langchain_core.runnables import RunnableConfig

config: RunnableConfig = {
    "configurable": {                    # 用户可配置项
        "thread_id": "abc123",           # LangGraph 线程 ID
        "thinking_enabled": True,        # 是否启用思维模式
        "model_name": "gpt-4",           # 模型选择
        "is_plan_mode": False,           # 是否计划模式
        "subagent_enabled": True,        # 是否启用子 Agent
    },
    "context": {                         # DeerFlow 扩展的运行时上下文
        "thread_id": "...",
        "run_id": "...",
        "app_config": AppConfig(...),
    },
    "metadata": {                        # LangSmith 追踪元数据
        "agent_name": "default",
        "model_name": "gpt-4",
    },
    "callbacks": [...],                  # 回调处理器
}
```

### 10.2 项目中的使用

`backend/packages/harness/deerflow/agents/lead_agent/agent.py:29`：
```python
def _get_runtime_config(config: RunnableConfig) -> dict:
    """合并 configurable 和 context"""
    cfg = dict(config.get("configurable", {}) or {})
    context = config.get("context", {}) or {}
    if isinstance(context, dict):
        cfg.update(context)
    return cfg
```

`config` 参数从 LangGraph Server 传递到 `make_lead_agent(config)`，然后流经中间件和工具。

### 10.3 工具中获取配置

在工具函数内部，通过 `runtime` 参数访问：

```python
@tool("bash", parse_docstring=True)
def bash_tool(runtime: Runtime, ...):
    # runtime.state → ThreadState
    # runtime.context → dict with thread_id, app_config etc.
```

---

## 11. `BaseCallbackHandler` — 追踪与监控

LangChain 的回调系统用于监控 LLM 调用。DeerFlow 用它来追踪 token 用量。

`backend/packages/harness/deerflow/subagents/token_collector.py`：

```python
from langchain_core.callbacks import BaseCallbackHandler

class SubagentTokenCollector(BaseCallbackHandler):
    def on_llm_end(self, response, *, run_id, **kwargs):
        for generation in response.generations:
            for gen in generation:
                usage = getattr(gen.message, "usage_metadata", None)
                if usage:
                    record = {
                        "input_tokens": usage.get("input_tokens", 0),
                        "output_tokens": usage.get("output_tokens", 0),
                    }
                    self._records.append(record)
```

回调方法一览：

| 方法 | 触发时机 | DeerFlow 用途 |
|------|---------|-------------|
| `on_llm_start` | LLM 调用开始 | — |
| `on_llm_end` | LLM 调用结束 | Token 用量采集 |
| `on_tool_start` | 工具执行开始 | — |
| `on_tool_end` | 工具执行结束 | — |

项目还支持 LangSmith 和 Langfuse 追踪：
```python
# 追踪回调自动附加到模型
callbacks = build_tracing_callbacks()  # → [LangChainTracer, LangfuseCallbackHandler]
model.callbacks = [*existing, *callbacks]
```

---

## 12. Store — LangGraph 的键值存储

`BaseStore` 是 LangGraph 提供的持久化键值存储，与 Checkpointer 互补：
- **Checkpointer**：保存 Agent 的完整状态快照
- **Store**：保存结构化的元数据（如线程信息）

```python
# 写入
await store.aput(("threads",), thread_id, {"metadata": {"user_id": "..."}})

# 读取
item = await store.aget(("threads",), thread_id)

# 搜索
results = await store.asearch(("threads",), limit=100)
```

DeerFlow 用它来存储线程元数据（如 `user_id`），支持按用户隔离数据。

---

## 速查清单：读代码时最可能困惑的 10 个点

| 看到这个 | 它是什么 | 关键理解 |
|---------|---------|---------|
| `create_agent(model, tools, middleware, ...)` | 创建 Agent 图 | 不需要手动 `add_node`/`add_edge`，ReAct 循环自动构建 |
| `Annotated[list[str], merge_artifacts]` | 带Reducer的状态字段 | 多个更新合并时调用 `merge_artifacts(old, new)` |
| `AIMessage(tool_calls=[...])` | LLM 请求调用工具 | `tool_calls` 是 LLM 输出，不是函数调用 |
| `ToolMessage(tool_call_id=...)` | 工具执行结果 | 必须通过 `tool_call_id` 与 `AIMessage` 配对 |
| `AgentMiddleware[T]` | 中间件基类 | 4 个钩子：`after_model`、`after_agent`、`wrap_tool_call`、`awrap_tool_call` |
| `Command(update={...}, goto=END)` | 控制图执行 | 更新状态 + 跳转节点，类似 Redux 的 dispatch |
| `Runtime = ToolRuntime[...]` | 工具运行时注入 | 工具函数的 `runtime` 参数，自动注入，不暴露给 LLM |
| `RunnableConfig` | 配置透传机制 | `configurable` 放用户选项，`context` 放运行时数据 |
| `stream_mode=["values","messages"]` | 多模式流式输出 | 返回 `(mode, chunk)` 元组，每种模式数据不同 |
| `resolve_class("pkg:Class")` | 动态加载类 | 从字符串路径加载 Python 类，config.yaml 驱动 |
