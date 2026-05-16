# 第2章：Agent 编排引擎——LangGraph 状态机

> 上一章我们看到了请求从前端到后端的全景旅程，现在深入这趟旅程的「心脏」——Lead Agent 的 LangGraph 状态机。这正是「将不确定性封装在确定性框架中」的核心体现：LLM 的输出不可预测，但状态机的节点流转、中间件执行顺序、工具调用协议是完全确定的。

---

## 2.1 LangGraph 核心心智模型

LangGraph 是什么？用一句话概括：**一个让你用状态机（State Machine）编排 LLM 行为的框架**。

传统 LLM 调用是「发一次请求，得一次回复」。但真实场景中，Agent 需要：
- 多轮思考（推理 → 行动 → 观察 → 再推理）
- 调用工具（搜索、执行代码、读写文件）
- 维护状态（记住之前做了什么）

LangGraph 把这些抽象为一个**有向图**：

```
         ┌─────────────┐
         │   START      │
         └──────┬──────┘
                ↓
         ┌─────────────┐
    ┌───→│   Agent Node │←──────────────────┐
    │    │  (LLM 决策)   │                    │
    │    └──────┬──────┘                    │
    │           ↓                           │
    │    ┌─────────────┐     有工具调用      │
    │    │ 条件路由      │──────────────┐     │
    │    │ (应该结束?)   │              │     │
    │    └──┬───────┬──┘              ↓     │
    │       │       │          ┌──────────┐  │
    │    结束    继续思考       │Tool Node │──┘
    │       │                  │(执行工具) │
    │       ↓                  └──────────┘
    │  ┌─────────┐
    │  │   END    │
    │  └─────────┘
    └→ (循环)
```

**关键概念**：
- **State**（状态）：贯穿整个图的共享数据结构，节点可以读写
- **Node**（节点）：执行具体逻辑的函数（如调用 LLM、执行工具）
- **Edge**（边）：节点之间的转移，可以是条件性的
- **Reducer**：定义状态如何合并更新（如 artifacts 列表的去重合并）

## 2.2 DeerFlow 的 Lead Agent 构建

入口函数在 [agent.py](backend/packages/harness/deerflow/agents/lead_agent/agent.py)：

```python
# 对外入口（LangGraph Server 注册用）
def make_lead_agent(config: RunnableConfig):
    return _make_lead_agent(config, app_config=get_app_config())

# 内部实现
def _make_lead_agent(config: RunnableConfig, *, app_config: AppConfig):
    # 1. 解析运行时配置（模型名、Agent名、模式等）
    runtime_config = _get_runtime_config(config)

    # 2. 解析模型名（带 fallback）
    model_name = _resolve_model_name(runtime_config.get("model_name"), app_config=app_config)

    # 3. 创建 LangChain Chat 模型实例
    model = create_chat_model(model_name, thinking_enabled=..., app_config=app_config)

    # 4. 加载所有可用工具（sandbox + 内置 + MCP + 社区 + 子Agent）
    tools = get_available_tools(...)

    # 5. 生成系统提示词（注入技能描述 + 用户记忆）
    system_prompt = apply_prompt_template(...)

    # 6. 构建中间件链（20个中间件，严格排序）
    middlewares = _build_middlewares(config, model_name, ...)

    # 7. 创建带中间件的 Agent 实例
    return create_react_agent(model, tools, prompt=system_prompt, middleware=middlewares)
```

`create_react_agent` 是 LangGraph 提供的高阶函数，它自动构建了上面心智模型中的循环图（Agent Node → 条件路由 → Tool Node → 回到 Agent Node）。DeerFlow 的定制点在于：**模型、工具、提示词、中间件全部可配置**。

## 2.3 ThreadState：状态的数据结构

[ThreadState](backend/packages/harness/deerflow/agents/thread_state.py) 是贯穿整个 Agent 执行的状态对象：

```python
class ThreadState(AgentState):        # 继承 LangGraph 基础状态
    sandbox: NotRequired[SandboxState | None]        # 沙箱 ID
    thread_data: NotRequired[ThreadDataState | None]  # 工作目录路径
    title: NotRequired[str | None]                    # 对话标题
    artifacts: Annotated[list[str], merge_artifacts]  # 产物列表（去重合并）
    todos: NotRequired[list | None]                   # 任务列表
    uploaded_files: NotRequired[list[dict] | None]    # 上传的文件
    viewed_images: Annotated[dict, merge_viewed_images] # 已查看的图片
```

注意 `Annotated[list[str], merge_artifacts]`——这是 LangGraph 的 **Reducer 模式**。当多个节点往 artifacts 列表追加内容时，`merge_artifacts` 函数负责去重合并：

```python
def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    # 合并 + 去重 + 保持顺序
    return list(dict.fromkeys((existing or []) + (new or [])))
```

这种设计让中间件和工具可以独立地往状态中追加数据，而不用担心重复。

## 2.4 中间件管道：20 个中间件的严格编排

DeerFlow 的中间件链是整个框架最精密的部分。它们按以下顺序执行：

### 阶段一：环境准备（1-3）
| # | 中间件 | 职责 |
|---|--------|------|
| 1 | **ThreadDataMiddleware** | 为每个线程创建独立工作目录 |
| 2 | **UploadsMiddleware** | 注入用户上传的文件信息 |
| 3 | **SandboxMiddleware** | 获取沙箱执行环境（延迟初始化） |

### 阶段二：健壮性保障（4-8）
| # | 中间件 | 职责 |
|---|--------|------|
| 4 | **DanglingToolCallMiddleware** | 修补缺失的 ToolMessage（LLM 有时会漏掉） |
| 5 | **LLMErrorHandlingMiddleware** | 模型调用失败时的重试/熔断/降级 |
| 6 | **GuardrailMiddleware** | 工具调用授权检查（可选） |
| 7 | **SandboxAuditMiddleware** | Bash 命令安全审计日志 |
| 8 | **ToolErrorHandlingMiddleware** | 将工具异常转换为 ToolMessage |

### 阶段三：上下文增强（9-12）
| # | 中间件 | 职责 |
|---|--------|------|
| 9 | **DynamicContextMiddleware** | 注入当前日期等信息 |
| 10 | **SummarizationMiddleware** | 上下文过长时自动压缩 |
| 11 | **TodoListMiddleware** | Plan 模式下的任务跟踪 |
| 12 | **TokenUsageMiddleware** | Token 消耗统计 |

### 阶段四：副作用处理（13-18）
| # | 中间件 | 职责 |
|---|--------|------|
| 13 | **TitleMiddleware** | 自动生成对话标题 |
| 14 | **MemoryMiddleware** | 将对话加入记忆更新队列 |
| 15 | **ViewImageMiddleware** | 注入图片 base64 数据 |
| 16 | **DeferredToolFilterMiddleware** | 隐藏延迟加载的工具 schema |
| 17 | **SubagentLimitMiddleware** | 强制限制并发子 Agent 数量 |
| 18 | **LoopDetectionMiddleware** | 检测并打断重复循环 |

### 阶段五：拦截处理（19-20）
| # | 中间件 | 职责 |
|---|--------|------|
| 19 | **Custom Middlewares** | 用户自定义中间件 |
| 20 | **ClarificationMiddleware** | **必须在最后**——拦截澄清请求 |

中间件的执行模型是**洋葱模型**（类似 Koa/Express 中间件）：

```
请求 → [1→2→3→...→20] → Agent 执行 → [20→19→...→3→2→1] → 响应
         before_agent()                  after_agent()
```

- `before_agent()`：在 LLM 调用前执行（注入上下文、获取资源）
- `after_agent()`：在 LLM 调用后执行（提取信息、释放资源）

**ClarificationMiddleware 必须在最后**的原因：它需要拦截 Agent 的 `ask_clarification` 工具调用，将其转化为对用户的提问。如果后面还有中间件处理这个调用，就会产生冲突。

## 2.5 模型工厂：如何适配任意 LLM

[factory.py](backend/packages/harness/deerflow/models/factory.py) 的 `create_chat_model()` 是模型适配层：

```
config.yaml 中的配置
    ↓
create_chat_model(name="glm-4.7", thinking_enabled=False)
    ↓
从 AppConfig 中找到对应模型配置
    ↓
resolve_variable("langchain_openai:ChatOpenAI")  → 动态加载 Python 类
    ↓
合并配置参数（api_key, temperature, max_tokens...）
    ↓
处理 thinking 模式（不同提供商实现不同）
    ↓
附加 tracing callbacks
    ↓
返回 BaseChatModel 实例
```

**Thinking 模式的提供商差异**是个很好的工程案例：

| 提供商 | Thinking 实现 |
|--------|-------------|
| OpenAI 兼容 | `extra_body.thinking.type = "enabled"` |
| Anthropic 原生 | 直接传 `thinking` 参数 |
| vLLM | `chat_template_kwargs.enable_thinking` |
| DeepSeek | 通过 PatchedChatDeepSeek 处理 |

这就是为什么你会看到 `Patched*` 系列适配器类——它们是 DeerFlow 对 LangChain 标准接口的**修正层**，处理各提供商的 quirks。

## 2.6 系统提示词：Agent 的「身份卡」

[prompt.py](backend/packages/harness/deerflow/agents/lead_agent/prompt.py) 的 `apply_prompt_template()` 动态组装提示词：

```
基础身份描述（你是 DeerFlow，一个超级 Agent）
    + 可用技能描述（从 skills/public/ 动态加载）
    + 用户记忆（从 memory.json 注入）
    + 子 Agent 说明（如果启用，包含并发限制）
    + 工具搜索说明（如果启用延迟加载）
```

提示词的**动态性**是关键——不同用户、不同配置、不同线程，Agent 的提示词可能完全不同。

---

## 思考题

**题 1**：DeerFlow 使用 LangGraph 的 `create_react_agent` 而不是手动构建状态图。这意味着 DeerFlow 放弃了什么能力？在什么场景下你可能需要绕过 `create_react_agent` 直接构建自定义图？

> **参考答案**：`create_react_agent` 封装了标准的 ReAct 循环（推理-行动-观察），放弃的是**非标准流转模式**的控制力。例如：多 Agent 协作中需要「路由到不同专家 Agent」的条件分支、需要「并行执行两个工具然后汇总」的 fork-join 模式、或者需要「回滚到之前状态」的撤销机制。DeerFlow 通过中间件管道和子 Agent 系统弥补了部分灵活性——中间件可以在不改变图结构的情况下注入行为，子 Agent 系统处理并行。但如果要实现完全自定义的工作流（如「先做 A，如果 B 则做 C，否则做 D 和 E 并行」），就需要直接使用 LangGraph 的低级 API（`StateGraph`）构建自定义图。

**题 2**：中间件顺序是硬编码的。如果两个中间件之间存在隐式依赖（比如 MemoryMiddleware 需要读取 SummarizationMiddleware 的输出），当前设计如何保证正确性？这种硬编码顺序有什么潜在的维护风险？

> **参考答案**：正确性由**执行顺序本身**保证——中间件列表是一个严格的有序数组，`_build_middlewares()` 按固定顺序 append。SummarizationMiddleware（#10）在 MemoryMiddleware（#14）之前，所以 summarization 的输出在 memory 处理时已经可用。潜在风险：1）**隐式耦合**——如果有人调换中间件顺序，可能引发难以调试的 bug；2）**扩展成本**——新增中间件需要理解全部已有中间件的依赖关系。缓解手段包括：代码注释中标注关键约束（如 "ClarificationMiddleware MUST BE LAST"）、以及中间件之间的通信通过 State 对象而非直接引用，降低耦合度。

**题 3**：`ThreadState` 中的 `artifacts` 使用 `Annotated[list[str], merge_artifacts]` 自定义 Reducer，而 `title` 只用 `NotRequired[str | None]`。为什么这两个字段的设计不同？这反映了什么架构决策？

> **参考答案**：`artifacts` 是**累加型**数据——多个工具和中间件可能在同一次执行中各自添加产物，需要合并去重。如果用默认的「覆盖」行为，后写入的会覆盖先写入的，丢失数据。`title` 是**设置型**数据——标题只需要一个值，后设置的自然覆盖前面的（标题最终由 TitleMiddleware 统一设置）。这反映了 LangGraph 状态管理的核心设计：**不是所有状态都应该用 Reducer，只有需要合并语义的字段才用**。错误使用 Reducer 会导致意外行为（如 title 变成列表），不使用 Reducer 的累加型字段则会导致数据丢失。

---

准备好就说「继续」进入第三章——子 Agent 系统与任务分解。
