# 第2章：State——图的血液系统

## 回扣本质

上一章我们理解了"把 Agent 建模为图"的动机。但图只是骨架，**State 才是让图活起来的血液**——它携带着信息在节点间流转，每个节点读取它、加工它、把结果写回去。State 的设计质量直接决定了你的 Agent 是"能跑"还是"好用"。这正是 LangGraph "用工程手段驯服 Agent"这一核心本质的数据层体现。

---

## State 的运作机制

### 基本流转

```
invoke({"topic": "AI Agents"})
        │
        ▼
   ┌─────────┐  state = {"topic": "AI Agents", "plan": "", "report": ""}
   │  规划   │  → 返回 {"plan": "1. 搜索定义 2. 找案例"}
   └────┬────┘
        │  state = {"topic": "AI Agents", "plan": "1. 搜索定义 2. 找案例", "report": ""}
        ▼
   ┌─────────┐
   │  搜索   │  → 返回 {"sources": [...]}
   └────┬────┘
        │  state 持续演变...
        ▼
```

核心规则：**节点函数返回的 dict 不是替换整个 State，而是与当前 State 合并（merge）**。你只需要返回你修改的字段。

### 一个常见误解

```python
# ❌ 错误理解：节点需要返回完整 State
def planner(state: ResearchState) -> ResearchState:
    return {"topic": state["topic"], "plan": "...", "sources": state["sources"], ...}

# ✅ 正确理解：只返回你要更新的字段
def planner(state: ResearchState) -> dict:
    return {"plan": "1. 搜索定义 2. 找案例"}
```

---

## Reducer：State 更新的核心机制

这是 LangGraph 状态系统中最精妙的设计。

### 问题场景

假设你有一个 `messages` 字段，多个节点都会往里追加消息。如果用默认的 merge（覆盖），后一个节点的消息会冲掉前一个：

```python
# 默认行为：覆盖
# 节点A返回 {"messages": ["你好"]}
# 节点B返回 {"messages": ["世界"]}
# 最终 state["messages"] = ["世界"]  ← "你好"丢了！
```

### Reducer 解法

```python
from typing import Annotated
from operator import add

class ResearchState(TypedDict):
    topic: str                                    # 普通字段：覆盖式更新
    messages: Annotated[list, add]                # Reducer字段：追加式更新
```

`Annotated[list, add]` 告诉 LangGraph：当节点返回 `{"messages": ["新消息"]}` 时，不要覆盖，而是**追加**到现有列表后面。

### Reducer 的本质

Reducer 就是一个函数 `(旧值, 新值) -> 合并后的值`。`operator.add` 对列表来说就是拼接。你也可以自定义：

```python
def deduplicated_add(existing: list, new: list) -> list:
    """追加但去重"""
    return list(dict.fromkeys(existing + new))

class ResearchState(TypedDict):
    sources: Annotated[list[str], deduplicated_add]  # 搜索结果去重追加
```

### 何时用 Reducer，何时用覆盖？

| 场景 | 策略 | 原因 |
|------|------|------|
| `topic`（研究主题） | 覆盖 | 只有一个值，不会追加 |
| `messages`（对话历史） | `add` reducer | 多个节点都会产生消息 |
| `plan`（当前计划） | 覆盖 | 计划可能被修订，新的替代旧的 |
| `sources`（搜索结果） | `add` reducer | 多轮搜索的结果需要累积 |
| `current_step`（当前步骤） | 覆盖 | 是一个游标，总是最新值 |

**判断标准：这个字段的语义是"替换"还是"累积"？**

---

## 为 Deep Research Agent 设计完整的 State

现在我们来做一件真正的工程决策——为研究助手设计状态 Schema。这是整个项目的"数据库表设计"，后续所有节点都围绕它工作。

```python
from typing import TypedDict, Annotated
from operator import add
from langchain_core.messages import BaseMessage


class ResearchState(TypedDict):
    # ===== 输入 =====
    topic: str                          # 用户的研究主题

    # ===== 规划 =====
    plan: list[str]                     # 研究步骤列表，如 ["搜索定义", "找案例", "对比分析"]

    # ===== 搜索 =====
    search_queries: list[str]           # 当前要执行的搜索查询
    sources: Annotated[list[dict], add] # 累积的搜索结果 [{title, url, content}]

    # ===== 分析 =====
    analysis: str                       # 当前的分析结论

    # ===== 反思 =====
    quality_score: int                  # 质量评分 1-10
    feedback: str                       # 反思反馈（如果质量不够）
    iteration_count: int                # 当前迭代次数

    # ===== 输出 =====
    report: str                         # 最终报告

    # ===== 消息轨迹 =====
    messages: Annotated[list[BaseMessage], add]  # LLM 交互记录
```

### 设计决策解读

**为什么 `plan` 用覆盖而不是 reducer？**
因为计划可能被反思环节推翻重做。如果用 `add`，旧计划和新计划会混在一起。覆盖语义意味着"最新的计划就是当前计划"。

**为什么 `sources` 用 `add` reducer？**
研究助手可能多轮搜索（第一轮搜基础概念，第二轮搜进阶案例），每轮结果都应该保留。

**为什么要有 `iteration_count`？**
这是循环的安全阀。没有它，质量永远不达标的情况下 Agent 会无限循环。后续会用它实现"最多重试 3 次"的硬性约束。

**为什么 `messages` 单独出来？**
这是一个关键的架构决策。结构化字段（plan、sources、analysis）负责业务逻辑；messages 负责记录 LLM 交互轨迹，用于调试和可观测性。两者职责分离。

---

## State 设计的三条原则

从这个例子中提炼出通用原则：

### 原则一：为条件边服务

每个可能影响流程走向的判断依据，都应该是 State 的一个字段。

```python
# 条件边会这样用你的 State：
def should_continue(state: ResearchState) -> str:
    if state["quality_score"] >= 7:
        return "generate_report"
    if state["iteration_count"] >= 3:
        return "generate_report"  # 强制结束
    return "search"  # 继续搜索
```

如果 `quality_score` 不是 State 字段，条件边就无从判断。

### 原则二：最小化但完备

只放真正需要跨节点共享的信息。节点内部的临时变量不要塞进 State。

```python
# ❌ 过度设计
class BadState(TypedDict):
    topic: str
    llm_temperature: float    # 这是配置，不是状态
    is_processing: bool       # 这是运行时临时标记
    debug_logs: list[str]     # 这应该用日志系统

# ✅ 恰到好处
class GoodState(TypedDict):
    topic: str
    plan: list[str]
    sources: Annotated[list[dict], add]
    quality_score: int
```

### 原则三：考虑持久化恢复

State 的每一个字段都可能被 checkpoint 保存。当从 checkpoint 恢复时，State 应该包含**足够的信息让后续节点正确运行**，而不需要重新执行之前的节点。

问自己：如果 Agent 在第 3 步挂了，从 State 恢复后第 4 步能拿到它需要的所有输入吗？

---

## 进阶：MessagesState 快捷方式

LangGraph 对最常见的 "带消息历史的 Agent" 提供了一个开箱即用的基类：

```python
from langgraph.graph import MessagesState

# MessagesState 等价于：
# class MessagesState(TypedDict):
#     messages: Annotated[list[BaseMessage], add_messages]

# 你可以继承它，添加自己的字段：
class ResearchState(MessagesState):
    topic: str
    plan: list[str]
    sources: Annotated[list[dict], add]
    quality_score: int
    # messages 字段已经有了，自带 add_messages reducer
```

`add_messages` 比普通的 `add` 更智能——它会根据 message ID 去重，支持消息更新（同 ID 的新消息覆盖旧消息）。

---

## 动手：验证 State 机制

```python
from typing import TypedDict, Annotated
from operator import add
from langgraph.graph import StateGraph, START, END


class ResearchState(TypedDict):
    topic: str
    sources: Annotated[list[str], add]
    plan: list[str]


def planner(state: ResearchState) -> dict:
    """生成研究计划"""
    return {"plan": ["搜索基础概念", "找实际案例", "对比分析"]}


def searcher(state: ResearchState) -> dict:
    """模拟搜索——注意 sources 用的是 add reducer"""
    step = state["plan"][0] if state["plan"] else "通用搜索"
    return {"sources": [f"来源: 关于「{step}」的搜索结果"]}


def analyzer(state: ResearchState) -> dict:
    """模拟分析"""
    return {"sources": [f"分析结论: 基于 {len(state['sources'])} 条来源"]}


graph_builder = StateGraph(ResearchState)
graph_builder.add_node("planner", planner)
graph_builder.add_node("searcher", searcher)
graph_builder.add_node("analyzer", analyzer)

graph_builder.add_edge(START, "planner")
graph_builder.add_edge("planner", "searcher")
graph_builder.add_edge("searcher", "analyzer")
graph_builder.add_edge("analyzer", END)

graph = graph_builder.compile()
result = graph.invoke({"topic": "LangGraph State 机制"})

print(f"Plan: {result['plan']}")
print(f"Sources ({len(result['sources'])} 条):")
for s in result["sources"]:
    print(f"  - {s}")
```

输出：
```
Plan: ['搜索基础概念', '找实际案例', '对比分析']
Sources (2 条):
  - 来源: 关于「搜索基础概念」的搜索结果
  - 分析结论: 基于 1 条来源
```

注意 `sources` 是**累积**的——searcher 加了一条，analyzer 又加了一条，最终有 2 条。而 `plan` 是**覆盖**的——只保留 planner 设置的值。

---

## 章末思考题

**题目一：Reducer 的陷阱**

如果你不小心给 `plan` 字段加了 `Annotated[list[str], add]`，而你的反思节点在质量不合格时会重新生成计划 `{"plan": ["新步骤1", "新步骤2"]}`，会发生什么？这个 bug 在运行时会如何表现？

> **参考答案**：旧计划和新计划会拼接在一起，变成 `["旧步骤1", "旧步骤2", "新步骤1", "新步骤2"]`。后续如果有节点按 index 遍历 plan，它会执行所有步骤（包括已经被否决的旧计划），导致重复劳动和不一致的结果。更隐蔽的是，这个 bug 在第一次运行时不会暴露（因为只有一份计划），只有在触发反思循环后才会出现——这类"只在特定路径下出现"的 bug 是最难排查的。**设计原则：语义是"替换"的字段绝对不要加 reducer。**

**题目二：State 设计与图的拓扑的关系**

假设你的图有两个并行分支（节点 A 和节点 B 同时执行），它们都想更新 `analysis` 字段。如果 `analysis` 是普通的覆盖式字段，会发生什么？你会如何设计来避免这个问题？

> **参考答案**：并行节点的执行顺序不确定，最后写入的值会覆盖前一个——这是数据竞争。解决方案有两种：①将 `analysis` 改为 `Annotated[list[str], add]`，让两个分支的分析结果都保留，后续节点负责整合；②更好的方案是从架构层面避免——让并行分支写入不同的字段（如 `analysis_a` 和 `analysis_b`），再用一个汇合节点整合。后者更清晰，因为它让数据的来源可追溯。**核心认知：State 设计和图的拓扑必须协同考虑——并行路径不应写同一个覆盖式字段。**

**题目三：为什么选择 TypedDict 而不是 Pydantic Model？**

LangGraph 用 TypedDict 定义 State 而不是 Pydantic BaseModel。你觉得这个选择背后的考量是什么？（提示：想想 State 更新的 merge 语义和 Pydantic 的验证行为）

> **参考答案**：两个关键原因：①**部分更新友好**——TypedDict 天然支持"只返回部分字段"的 dict merge，而 Pydantic Model 的实例化要求提供所有必填字段（或设置默认值），对"节点只更新自己关心的字段"这一核心模式不友好；②**轻量**——State 在每个节点都会被读写，甚至被序列化做 checkpoint，Pydantic 的验证开销在高频场景下是不必要的负担。不过 LangGraph 也支持 Pydantic，但你需要给每个字段设默认值，且在 reducer 场景下行为不如 TypedDict 直观。实际上，LangGraph 内部会把 Pydantic Model 转换为 TypedDict 来处理。

---

> 准备好了就说「继续」进入第三章：节点与边——构建可控的推理流。
