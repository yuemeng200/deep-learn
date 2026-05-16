# 前置知识：Python 最小工具箱

> 阅读和参与 DeerFlow 项目所需的 Python 知识，精确到**项目实际用到的特性**。你已经会写代码，这里只需要补上 Python 特有的思维模式。

**项目环境**：Python 3.12+，核心库 LangGraph / FastAPI / Pydantic / SQLAlchemy / asyncio

---

## 1. 类型系统（Type Hints）

**其他语言类比**：类似 TypeScript 的类型注解，但 Python 的类型系统更灵活——`Annotated` 可以把任意元数据"贴"在类型上，在 LangGraph 状态定义中至关重要。

### 1.1 基础类型注解

```python
# 变量注解
name: str = "deer-flow"
count: int = 0

# 函数签名
def get_model(name: str) -> ModelConfig | None:
    ...
```

项目示例 —— `backend/app/gateway/routers/models.py:99`：
```python
async def get_model(model_name: str, config: AppConfig = Depends(get_config)) -> ModelResponse:
    ...
```

### 1.2 容器类型

Python 3.9+ 直接用 `list[str]`、`dict[str, Any]`，不再需要 `List[str]`、`Dict[str, Any]`。

```python
models: list[ModelConfig]          # ModelConfig 的列表
tools: dict[str, BaseTool]         # str → BaseTool 的映射
result: tuple[list[str], bool]     # 返回两个元素的元组
```

项目示例 —— `backend/packages/harness/deerflow/agents/thread_state.py:21`：
```python
def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    ...
```

### 1.3 联合类型 `X | None`

Python 3.10+ 用 `X | None` 替代 `Optional[X]`，更直观。

```python
# 以下两种写法等价，项目统一用 | 风格
title: str | None = None           # 推荐
title: Optional[str] = None        # 旧写法
```

### 1.4 `Annotated` — LangGraph 的核心技巧

`Annotated[类型, 元数据]` 在类型上附加额外的信息。DeerFlow 用它来定义**状态 Reducer**——告诉 LangGraph "当多个子 Agent 同时更新同一个字段时，如何合并结果"。

项目示例 —— `backend/packages/harness/deerflow/agents/thread_state.py:52`：
```python
class ThreadState(AgentState):
    # artifacts 字段是 list[str] 类型，合并时用 merge_artifacts 函数
    artifacts: Annotated[list[str], merge_artifacts]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]
```

对应的 reducer 函数（同文件第 21 行）：
```python
def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    if existing is None:
        return new or []
    if new is None:
        return existing
    return list(dict.fromkeys(existing + new))  # 去重但保序
```

### 1.5 `TypedDict` — 灵活的字典结构

当你需要"一个有固定 key 的字典"，但又不想写完整类时，用 `TypedDict`。LangGraph 的 Agent State 就基于它。

项目示例 —— `backend/packages/harness/deerflow/agents/thread_state.py:6`：
```python
class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]   # 可选字段

class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]
```

`NotRequired[...]` 表示这个 key 可以不存在（Python 3.11+）。

### 1.6 `Protocol` — Python 的接口

Python 没有传统 `interface` 关键字，用 `Protocol` 替代。任何拥有同名方法的类自动"实现"了这个协议，不需要显式继承。

项目示例 —— `backend/packages/harness/deerflow/guardrails/provider.py:40`：
```python
@runtime_checkable  # 允许 isinstance() 检查
class GuardrailProvider(Protocol):
    name: str

    def evaluate(self, request: GuardrailRequest) -> GuardrailDecision: ...
    async def aevaluate(self, request: GuardrailRequest) -> GuardrailDecision: ...
```

`...`（Ellipsis）表示"这里只声明签名，不实现"。

### 1.7 泛型函数

Python 3.12 引入了简洁的泛型语法 `def func[T](...)`。

项目示例 —— `backend/packages/harness/deerflow/reflection/resolvers.py:25`：
```python
def resolve_variable[T](
    variable_path: str,
    expected_type: type[T] | tuple[type, ...] | None = None,
) -> T:
    ...
```

### 1.8 `Self` 类型

用于 `classmethod` 返回自身类型。

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:142`：
```python
from typing import Self

class AppConfig(BaseModel):
    @classmethod
    def from_file(cls, config_path: str | None = None) -> Self:
        ...
```

### 项目实战速查

| 特性 | 在哪里看到 | 作用 |
|------|-----------|------|
| `list[str]` | 几乎所有文件 | 容器类型注解 |
| `X \| None` | 几乎所有文件 | 可空类型 |
| `Annotated[T, reducer]` | `thread_state.py` | LangGraph 状态合并 |
| `TypedDict + NotRequired` | `thread_state.py` | 灵活的字典结构 |
| `Protocol` | `guardrails/provider.py`, `sandbox/sandbox.py` | 接口定义 |
| `type[T]` 泛型 | `reflection/resolvers.py` | 类型安全的通用函数 |
| `Self` | `app_config.py` | classmethod 返回自身类型 |

---

## 2. 异步编程（async/await）

**其他语言类比**：类似 JavaScript 的 async/await，但 Python 的协程更明确——你必须用 `await` 来调用 async 函数，直接调用只会返回一个 coroutine 对象而不执行。也类似 C# 的 async/await 或 Rust 的 `.await`。

### 2.1 基础 async/await

```python
async def fetch_data(url: str) -> str:
    response = await httpx.get(url)   # await 挂起协程，等待结果
    return response.text
```

### 2.2 `async with` — 异步上下文管理器

用于需要异步初始化/清理的资源。

项目示例 —— `backend/app/gateway/app.py:177`：
```python
async with langgraph_runtime(app):
    # runtime 初始化（异步）
    await _ensure_admin_user(app)
    yield  # FastAPI lifespan：这里 app 开始接收请求
# 退出 async with 时自动清理
```

### 2.3 `async for` — 异步迭代

遍历异步数据源（如流式响应）。

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:471`：
```python
async for chunk in agent.astream(state, config=run_config, context=context, stream_mode="values"):
    final_state = chunk
    messages = chunk.get("messages", [])
    ...
```

### 2.4 异步生成器 `async def + yield`

结合 `AsyncIterator[T]` 返回类型，用于逐个产生异步结果。

项目示例 —— `backend/app/gateway/app.py:123`：
```python
async def _iter_store_items(store, namespace, *, page_size: int = 500):
    offset = 0
    while True:
        batch = await store.asearch(namespace, limit=page_size, offset=offset)
        if not batch:
            return
        for item in batch:
            yield item       # 逐个产出
        if len(batch) < page_size:
            return
        offset += page_size
```

调用方用 `async for` 消费：
```python
async for item in _iter_store_items(store, ("threads",)):
    ...
```

### 2.5 `asyncio.to_thread()` — 在异步中调用同步代码

当异步代码需要调用阻塞的同步函数时，用 `to_thread` 把它丢到线程池执行，不阻塞事件循环。

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:311`：
```python
# storage.load_skills 是同步函数，在异步上下文中用 to_thread 包装
all_skills = await asyncio.to_thread(storage.load_skills, enabled_only=True)
```

### 2.6 线程与锁

DeerFlow 的子 Agent 系统混合使用 asyncio 和 threading：

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:86-97`：
```python
# 全局状态 + 线程锁保护
_background_tasks: dict[str, SubagentResult] = {}
_background_tasks_lock = threading.Lock()

# 线程池执行后台任务
_scheduler_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="subagent-scheduler-")

# 使用 with 获取锁
with _background_tasks_lock:
    _background_tasks[task_id] = result
```

### 2.7 `@asynccontextmanager` — 异步生命周期管理

用装饰器把 async generator 变成异步上下文管理器。

项目示例 —— `backend/app/gateway/app.py:160`：
```python
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # 启动逻辑
    app.state.config = get_app_config()
    async with langgraph_runtime(app):
        yield  # ← app 运行中
    # 关闭逻辑（yield 之后）
```

### 项目实战速查

| 模式 | 在哪里看到 | 作用 |
|------|-----------|------|
| `async def / await` | 所有 API 路由、Agent 执行 | 异步 I/O |
| `async with` | `app.py` lifespan | 异步资源管理 |
| `async for` | `executor.py` astream | 流式数据消费 |
| `async def + yield` | `app.py` _iter_store_items | 异步生成器 |
| `asyncio.to_thread()` | `executor.py` | 同步→异步桥接 |
| `threading.Lock` | `executor.py` | 保护共享状态 |
| `ThreadPoolExecutor` | `executor.py` | 后台任务线程池 |
| `@asynccontextmanager` | `app.py` lifespan | FastAPI 生命周期 |

---

## 3. 数据模型（Pydantic + dataclass）

**其他语言类比**：
- Pydantic ≈ Java record + Bean Validation，或 Rust 的 serde + validator
- dataclass ≈ Kotlin data class，或 C# record

### 3.1 `@dataclass` — 轻量数据容器

适合纯数据持有者，不需要验证逻辑。

项目示例 —— `backend/packages/harness/deerflow/guardrails/provider.py:9`：
```python
from dataclasses import dataclass, field

@dataclass
class GuardrailRequest:
    tool_name: str
    tool_input: dict[str, Any]
    agent_id: str | None = None       # 有默认值的字段放在后面
    thread_id: str | None = None
    is_subagent: bool = False
    timestamp: str = ""

@dataclass
class GuardrailDecision:
    allow: bool
    reasons: list[GuardrailReason] = field(default_factory=list)  # 可变默认值
    metadata: dict[str, Any] = field(default_factory=dict)
```

**关键陷阱**：可变默认值（list、dict）必须用 `field(default_factory=list)` 而不是 `= []`，否则所有实例共享同一个列表。

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:51`：
```python
@dataclass
class SubagentResult:
    task_id: str
    trace_id: str
    status: SubagentStatus
    result: str | None = None
    token_usage_records: list[dict[str, int | str]] = field(default_factory=list)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def __post_init__(self):
        """dataclass 实例化后自动执行的初始化逻辑"""
        if self.ai_messages is None:
            self.ai_messages = []
```

### 3.2 Pydantic `BaseModel` — 带验证的数据模型

DeerFlow 的配置系统核心。与 dataclass 的关键区别：自动类型转换、验证、序列化。

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:83`：
```python
from pydantic import BaseModel, ConfigDict, Field

class AppConfig(BaseModel):
    log_level: str = Field(default="info", description="Logging level")
    models: list[ModelConfig] = Field(default_factory=list, description="Available models")
    sandbox: SandboxConfig = Field(description="Sandbox configuration")  # 无默认值 = 必填

    model_config = ConfigDict(extra="allow")  # 允许未定义的字段
```

### 3.3 Pydantic 常用操作

```python
# 从字典创建（自动验证）
config = AppConfig.model_validate(data_dict)

# 转为字典
data = config.model_dump()

# 访问字段
config.log_level           # "info"
config.models[0].name      # 第一个模型的名字
```

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:171`：
```python
result = cls.model_validate(config_data)         # 从 YAML 数据创建
config.title.model_dump()                         # 导出为字典
```

### 3.4 `Field(default=...)` vs `Field(default_factory=...)`

```python
# 不可变类型（str, int, bool）→ 用 default
name: str = Field(default="gpt-4")

# 可变类型（list, dict）→ 用 default_factory
models: list[ModelConfig] = Field(default_factory=list)
```

### 3.5 API 响应模型

FastAPI 用 Pydantic 模型定义请求/响应结构，自动生成 OpenAPI 文档。

项目示例 —— `backend/app/gateway/routers/models.py:10`：
```python
class ModelResponse(BaseModel):
    name: str = Field(..., description="Unique identifier")  # ... 表示必填
    model: str = Field(..., description="Provider model ID")
    display_name: str | None = Field(None, description="Human-readable name")
    supports_thinking: bool = Field(default=False)
```

### 项目实战速查

| 模式 | 在哪里看到 | 作用 |
|------|-----------|------|
| `@dataclass` | `guardrails/provider.py`, `executor.py` | 轻量数据容器 |
| `field(default_factory=...)` | 同上 | 可变默认值 |
| `__post_init__` | `executor.py` SubagentResult | dataclass 初始化钩子 |
| `BaseModel` | `app_config.py`, `routers/models.py` | 带验证的数据模型 |
| `Field(default=...)` | 所有 Pydantic 模型 | 字段定义 + 文档 |
| `model_validate()` | `app_config.py` | 字典→模型（带验证） |
| `model_dump()` | `app_config.py` | 模型→字典 |
| `ConfigDict(extra="allow")` | `AppConfig` | 允许未定义字段 |

---

## 4. 装饰器与上下文管理器

**其他语言类比**：
- 装饰器 ≈ Java 注解 + AOP（但更灵活，本质是高阶函数）
- 上下文管理器 ≈ Java try-with-resources / C# using / Rust 的 Drop

### 4.1 装饰器原理

装饰器就是一个**接受函数、返回新函数**的函数。`@decorator` 语法只是语法糖。

```python
# 这两种写法等价
@my_decorator
def func(): ...

func = my_decorator(func)
```

### 4.2 项目中常见的内置装饰器

```python
# @property — 把方法变成属性访问
class Sandbox(ABC):
    _id: str

    @property
    def id(self) -> str:     # sandbox.id 而不是 sandbox.id()
        return self._id

# @override — 标记重写父类方法（Python 3.12+，编译期检查）
class MemoryMiddleware(AgentMiddleware):
    @override
    def after_agent(self, state, runtime) -> dict | None:
        ...

# @classmethod / @staticmethod
class AppConfig(BaseModel):
    @classmethod
    def from_file(cls, config_path: str | None = None) -> Self:
        ...  # cls 是类本身，可以调用 cls.model_validate()
```

项目示例 —— `backend/packages/harness/deerflow/sandbox/sandbox.py:14`：
```python
class Sandbox(ABC):
    _id: str

    @property
    def id(self) -> str:
        return self._id

    @abstractmethod
    def execute_command(self, command: str) -> str: ...
```

### 4.3 `with` 语句 — 资源自动清理

```python
# 文件操作 — 自动关闭
with open("config.yaml") as f:
    data = yaml.safe_load(f)

# 线程锁 — 自动释放
with _background_tasks_lock:
    _background_tasks[task_id] = result
```

### 4.4 `Depends()` — FastAPI 的依赖注入

项目示例 —— `backend/app/gateway/routers/models.py:40`：
```python
async def list_models(config: AppConfig = Depends(get_config)) -> ModelsListResponse:
    # FastAPI 自动调用 get_config() 并把结果注入 config 参数
    ...
```

### 项目实战速查

| 装饰器/模式 | 在哪里看到 | 作用 |
|------------|-----------|------|
| `@property` | `sandbox.py` | 方法变属性 |
| `@override` | `memory_middleware.py` | 标记重写 |
| `@classmethod` | `app_config.py` | 类方法（工厂模式） |
| `@abstractmethod` | `sandbox.py` | 抽象方法 |
| `@asynccontextmanager` | `app.py` | 异步生命周期 |
| `with` + Lock | `executor.py` | 线程安全 |
| `Depends()` | 所有 API 路由 | FastAPI 依赖注入 |

---

## 5. 模块与导入系统

**其他语言类比**：类似 JavaScript 的 ES Modules，但 Python 的**包**概念更严格——目录下必须有 `__init__.py` 才算包。

### 5.1 绝对导入 vs 相对导入

```python
# 绝对导入 — 从项目根开始
from deerflow.agents.thread_state import ThreadState
from app.gateway.deps import get_config

# 相对导入 — 从当前包开始（. = 当前目录, .. = 上一层）
from .middlewares.memory_middleware import MemoryMiddleware
from ..config.app_config import AppConfig
```

**项目约定**：`deerflow` 包内部用相对导入；`app` 包内部也用相对导入。跨包用绝对导入。

### 5.2 `__init__.py` 的作用

控制包的公开 API：
```python
# deerflow/config/__init__.py
from deerflow.config.app_config import AppConfig, get_app_config

__all__ = ["AppConfig", "get_app_config"]  # 明确导出
```

### 5.3 动态导入 — 反射系统

DeerFlow 的工具和模型都通过字符串路径动态加载。这是整个插件系统的基石。

项目示例 —— `backend/packages/harness/deerflow/reflection/resolvers.py:25`：
```python
from importlib import import_module

def resolve_variable[T](variable_path: str, expected_type: type[T] | None = None) -> T:
    # "langchain_openai:ChatOpenAI" → 导入 langchain_openai 模块，取 ChatOpenAI
    module_path, variable_name = variable_path.rsplit(":", 1)
    module = import_module(module_path)      # 动态导入
    variable = getattr(module, variable_name)  # 动态获取属性
    return variable
```

这在 `config.yaml` 中的使用：
```yaml
models:
  - use: "langchain_openai:ChatOpenAI"  # → resolve_variable 动态加载
```

### 5.4 `TYPE_CHECKING` — 避免循环导入

当代码只需要类型注解但不需要运行时导入时，把导入放在 `if TYPE_CHECKING` 里。

项目示例 —— `backend/packages/harness/deerflow/agents/middlewares/memory_middleware.py:4`：
```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from deerflow.config.memory_config import MemoryConfig
    # 这段代码只在类型检查工具（mypy/pyright）中执行
    # 运行时不导入，避免循环依赖
```

### 项目实战速查

| 模式 | 在哪里看到 | 作用 |
|------|-----------|------|
| `from .xxx import` | 几乎所有包内文件 | 相对导入 |
| `__all__` | `__init__.py` | 控制公开 API |
| `import_module()` | `reflection/resolvers.py` | 动态导入（插件系统） |
| `TYPE_CHECKING` | `memory_middleware.py` | 避免循环导入 |
| `getattr(module, name)` | `reflection/resolvers.py` | 运行时获取属性 |

---

## 6. 函数式工具

**其他语言类比**：推导式类似 JS 的 `map` + `filter` 但语法更紧凑；海象运算符类似 C 赋值表达式。

### 6.1 推导式（Comprehension）

DeerFlow 中**极其常见**的模式：

```python
# 列表推导式 — 筛选 + 转换
tool_configs = [tool for tool in config.tools if groups is None or tool.group in groups]
# 等价于 JS: config.tools.filter(t => groups === null || groups.includes(t.group))

# 字典推导式 — 转换键值对
return {k: cls.resolve_env_variables(v) for k, v in config.items()}
# 等价于 JS: Object.fromEntries(Object.entries(config).map(([k,v]) => [k, resolve(v)]))

# 集合推导式
allowed_set = set(allowed)  # 虽然这里用 set() 构造函数更直接
```

项目示例 —— `backend/app/gateway/routers/models.py:76`：
```python
models = [
    ModelResponse(
        name=model.name,
        model=model.model,
        display_name=model.display_name,
    )
    for model in config.models
]
```

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:324`：
```python
allowed = set(self.config.skills)
return [s for s in all_skills if s.name in allowed]
```

### 6.2 海象运算符 `:=` — 边赋值边判断

在 `if` 或 `while` 条件中同时赋值和判断，避免重复计算。

项目示例 —— `backend/packages/harness/deerflow/config/skills_config.py:48`：
```python
# 如果环境变量存在，赋值给 env_path 并进入 if 分支
if env_path := os.getenv("DEER_FLOW_SKILLS_PATH"):
    return Path(env_path)
```

项目示例 —— `backend/packages/harness/deerflow/sandbox/tools.py:992`：
```python
if thread_data and (workspace := thread_data.get("workspace_path")):
    # workspace 被赋值且非空时才进入
    ...
```

### 6.3 `dict.fromkeys()` — 保序去重

Python 中优雅的去重技巧，项目用它来合并 artifacts。

项目示例 —— `backend/packages/harness/deerflow/agents/thread_state.py:28`：
```python
# dict.fromkeys 保持插入顺序且自动去重，再转回 list
return list(dict.fromkeys(existing + new))
```

### 6.4 字典展开 `{**a, **b}`

合并字典，后者覆盖前者的同名 key。

项目示例 —— `backend/packages/harness/deerflow/agents/thread_state.py:45`：
```python
return {**existing, **new}  # new 中的值覆盖 existing 中的同名 key
```

### 6.5 生成器 `yield`

`yield` 让函数变成生成器，逐个产出值而不是一次性返回列表。

```python
def count_up(n):
    for i in range(n):
        yield i  # 每次产出一个值，暂停执行

# 使用
for num in count_up(5):
    print(num)  # 0, 1, 2, 3, 4
```

### 6.6 `lambda` — 匿名函数

项目中常见于 `default_factory` 和回调：

```python
timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

# 提交到线程池时的回调
future = context.run(
    lambda: asyncio.run_coroutine_threadsafe(coro_factory(), loop)
)
```

### 项目实战速查

| 模式 | 在哪里看到 | 作用 |
|------|-----------|------|
| `[x for x in ... if ...]` | 几乎所有文件 | 筛选+转换 |
| `{k: v for k, v in ...}` | `app_config.py` | 字典转换 |
| `:=` 海象运算符 | `sandbox/tools.py`, `config/skills_config.py` | 条件赋值 |
| `dict.fromkeys()` | `thread_state.py` | 保序去重 |
| `{**a, **b}` | `thread_state.py` | 字典合并 |
| `yield` | `app.py`, executor stream | 生成器 |
| `lambda` | `executor.py`, dataclass field | 匿名函数 |

---

## 7. 错误处理与其他特性

### 7.1 `raise X from Y` — 异常链

保留原始异常的上下文，调试时能看到完整链路。

**其他语言类比**：类似 Java 的 `new Exception("msg", cause)` 或 C# 的 `new Exception("msg", innerException)`。

项目示例 —— `backend/packages/harness/deerflow/reflection/resolvers.py:46`：
```python
try:
    module_path, variable_name = variable_path.rsplit(":", 1)
except ValueError as err:
    # from err 保留原始异常信息
    raise ImportError(f"{variable_path} doesn't look like a variable path") from err
```

### 7.2 自定义异常

项目在 API 层使用 FastAPI 的 `HTTPException`：

项目示例 —— `backend/app/gateway/routers/models.py:122`：
```python
from fastapi import HTTPException

if model is None:
    raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")
```

### 7.3 f-string

项目**无处不在**的字符串格式化方式：

```python
# 基础
f"Model '{model_name}' not found"

# 表达式
f"[trace={self.trace_id}] Subagent {self.config.name} starting"

# 调试（Python 3.8+）
f"{admin_count=}"  # 输出 "admin_count=0"
```

### 7.4 `next()` 与生成器表达式

从迭代器中取第一个匹配项，找不到返回默认值。

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:302`：
```python
def get_model_config(self, name: str) -> ModelConfig | None:
    # next(生成器, 默认值) — 找第一个匹配的，没有则返回 None
    return next((model for model in self.models if model.name == name), None)
```

### 7.5 `Enum` — 枚举类型

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:40`：
```python
from enum import Enum

class SubagentStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"

# 使用
result.status == SubagentStatus.COMPLETED
result.status.value  # "completed"
```

### 7.6 `ContextVar` — 协程安全的上下文变量

比 `threading.local()` 更现代，在 async 代码中传播请求上下文。

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:334`：
```python
from contextvars import ContextVar

_current_app_config: ContextVar[AppConfig | None] = ContextVar(
    "deerflow_current_app_config", default=None
)

# 设置
_current_app_config.set(config)

# 获取
runtime_override = _current_app_config.get()
```

### 7.7 `atexit` — 程序退出钩子

项目示例 —— `backend/packages/harness/deerflow/subagents/executor.py:147`：
```python
import atexit

atexit.register(_shutdown_isolated_subagent_loop)  # 进程退出时自动调用
```

### 7.8 `@pytest.fixture` — 测试夹具

DeerFlow 测试中大量使用 pytest fixture：

```python
import pytest

@pytest.fixture(autouse=True)  # autouse = 自动应用到所有测试
def _auto_user_context(request):
    """每个测试自动注入用户上下文"""
    ...

@pytest.mark.parametrize("status,expected", [   # 参数化测试
    (SubagentStatus.COMPLETED, True),
    (SubagentStatus.FAILED, True),
    (SubagentStatus.RUNNING, False),
])
def test_terminal_status(status, expected):
    assert is_terminal(status) == expected
```

### 项目实战速查

| 特性 | 在哪里看到 | 作用 |
|------|-----------|------|
| `raise X from Y` | `reflection/resolvers.py` | 异常链 |
| f-string | 几乎所有文件 | 字符串格式化 |
| `next(gen, default)` | `app_config.py` | 取第一个匹配项 |
| `Enum` | `executor.py` | 状态枚举 |
| `ContextVar` | `app_config.py`, `user_context.py` | 请求上下文传递 |
| `atexit` | `executor.py` | 退出清理 |
| `@pytest.fixture` | `tests/` | 测试数据注入 |

---

## 8. 项目中"不常见但会碰到"的 Python 写法

### 8.1 `if isinstance(x, type) | `hasattr(x, "attr")`

运行时类型检查，在处理 LLM 返回的动态数据时常用：

```python
# 判断消息类型
if isinstance(last_message, AIMessage):
    ...

# 安全获取属性
raw_content = last_message.content if hasattr(last_message, "content") else str(last_message)
```

### 8.2 `isinstance` 配合 `tuple`

一次检查多种类型：

```python
isinstance(config, (dict, list))  # 是 dict 或 list
```

### 8.3 全局状态 + `global` 关键字

项目配置缓存使用了模块级全局变量：

项目示例 —— `backend/packages/harness/deerflow/config/app_config.py:346`：
```python
_app_config: AppConfig | None = None  # 模块级全局变量

def _load_and_cache_app_config(config_path: str | None = None) -> AppConfig:
    global _app_config  # 声明要修改全局变量
    _app_config = AppConfig.from_file(str(resolved_path))
    return _app_config
```

### 8.4 关键字参数 `*` 分隔符

`*` 后面的参数必须用关键字传递，提高可读性：

```python
def grep(self, path: str, pattern: str, *, glob: str | None = None):
    # 调用时必须写 grep(path, pattern, glob="*.py")
    # 不能写 grep(path, pattern, "*.py")
```

### 8.5 `__name__ == "__main__"` 入口

Python 没有 `main()` 函数约定，用这个判断是否直接运行：

```python
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

---

## 速查清单：读代码时最可能困惑的 10 个点

| 看到这个 | 它是什么 | 类比你熟悉的东西 |
|---------|---------|---------------|
| `Annotated[list[str], func]` | 类型 + 元数据 | TypeScript 装饰器类型 |
| `async for x in stream` | 异步迭代 | JS `for await (x of stream)` |
| `@override` | 重写标记 | Java `@Override` |
| `field(default_factory=list)` | 可变默认值 | 必须这么写，否则所有实例共享 |
| `X \| None` | 可空类型 | TypeScript `X \| null` |
| `from .xxx import` | 相对导入 | JS 相对路径 import |
| `:=` | 条件赋值 | C 的赋值表达式 `if (x = foo())` |
| `{**a, **b}` | 字典合并 | JS `{...a, ...b}` |
| `raise X from Y` | 异常链 | Java `new X("msg", cause)` |
| `yield` | 生成器 | JS `function*` + `yield` |
