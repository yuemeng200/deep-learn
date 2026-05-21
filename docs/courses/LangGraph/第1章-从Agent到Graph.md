# 第1章：从 Agent 到 Graph——为什么需要 LangGraph

## 回扣本质

你已经构建过基本的 Agent，知道 Prompt + Tools + Memory 能让 LLM "自主行动"。但你大概也体会过那种不安感——Agent 跑起来后，你其实不太确定它下一步会干什么。本章我们要揭示的正是 LangGraph 的核心命题：**用图夺回控制权，让 Agent 的行为可预测、可调试、可干预**。

---

## 传统 Agent 的困境

你用过的 ReAct 模式（Reasoning + Acting）大概长这样：

```python
while not done:
    thought = llm.think(prompt + history)
    action = llm.choose_tool(thought)
    result = execute_tool(action)
    history.append(result)
    if llm.thinks_done(history):
        done = True
```

这个循环能工作，但在生产环境中暴露出三个致命问题：

### 问题一：控制流是隐式的

LLM 在一个大循环里既决定"做什么"又决定"什么时候停"。你无法说"搜索完之后必须经过人工审核再继续"——因为没有显式的流程节点可以插入逻辑。

### 问题二：状态管理是临时的

所有中间状态都塞在一个越来越长的 `history` 列表里。你没有结构化的方式来说"当前规划是什么"、"已搜索了哪些资源"、"报告写到哪了"。

### 问题三：失败不可恢复

如果 Agent 在第 5 步挂了，你只能从头来。没有 checkpoint，没有断点续传。对于一个可能运行几分钟的研究任务，这是不可接受的。

---

## LangGraph 的解法：显式建模为图

LangGraph 的核心思想极其简单——**把 Agent 的推理流程画成一张图**：

```
┌─────────┐      ┌─────────┐      ┌─────────┐
│  规划   │ ──→  │  搜索   │ ──→  │  分析   │
└─────────┘      └─────────┘      └─────────┘
                       ↑                │
                       └── 不够好 ──────┘
```

- **节点（Node）**：每个节点是一个函数，做一件明确的事
- **边（Edge）**：定义节点之间的流转关系
- **状态（State）**：一个结构化的数据对象，在节点间传递和演变
- **条件边**：根据状态决定走哪条路（图的分支能力）
- **循环**：边可以指回之前的节点（图天然支持环）

这样一来，上面三个问题全部迎刃而解：
- 控制流是**显式的**——你画出来的就是它会走的路
- 状态是**结构化的**——TypedDict，字段清晰，类型安全
- 每个节点执行后状态可**持久化**——挂了从上次 checkpoint 恢复

---

## LangGraph 核心概念速览

| 概念 | 对应物 | 作用 |
|------|--------|------|
| `StateGraph` | 图的容器 | 定义整张图的结构 |
| `State` | TypedDict | 在节点间流转的结构化数据 |
| Node | Python 函数 | 接收 State，返回 State 的更新 |
| Edge | 连接关系 | 定义节点执行顺序 |
| `START` / `END` | 特殊节点 | 图的入口和出口 |
| Conditional Edge | 条件分支 | 根据 State 内容决定下一步去哪 |

---

## 动手：搭建项目骨架

让我们建立 Deep Research Agent 的第一个版本——只有一个节点，但已经是一个完整的 LangGraph 应用。

### 安装

```bash
pip install langgraph langchain-openai
```

### 最简单的 Graph

```python
from typing import TypedDict
from langgraph.graph import StateGraph, START, END

# 1. 定义状态：图的血液
class ResearchState(TypedDict):
    topic: str          # 研究主题
    report: str         # 最终报告

# 2. 定义节点：一个函数就是一个节点
def researcher(state: ResearchState) -> dict:
    """最简单的研究节点——直接生成报告"""
    topic = state["topic"]
    # 后续会替换为真正的 LLM 调用
    return {"report": f"关于「{topic}」的研究报告：这是一个值得深入探讨的主题。"}

# 3. 构建图
graph_builder = StateGraph(ResearchState)

# 添加节点
graph_builder.add_node("researcher", researcher)

# 添加边：START → researcher → END
graph_builder.add_edge(START, "researcher")
graph_builder.add_edge("researcher", END)

# 4. 编译：从"图纸"变成"可执行引擎"
graph = graph_builder.compile()

# 5. 运行
result = graph.invoke({"topic": "LangGraph 的设计哲学"})
print(result["report"])
```

### 关键理解

注意 `compile()` 这一步——它是 LangGraph 设计中很精妙的一点：

- **构建阶段**（`StateGraph` + `add_node` + `add_edge`）：你在画图纸，声明结构
- **编译阶段**（`compile()`）：框架校验图的合法性（有没有孤立节点、有没有从 START 到 END 的路径），然后生成执行引擎
- **运行阶段**（`invoke()`）：引擎按图执行，状态在节点间流转

这个"声明→编译→执行"的三段式，和 TensorFlow 的静态图、React 的 Virtual DOM 是同一设计哲学：**先描述意图，再优化执行**。LangGraph 可以在编译阶段做校验、注入 checkpoint、设置中断点——这些都是"显式图"带来的红利。

---

## 对比：为什么不直接用 LangChain 的 AgentExecutor？

| 维度 | AgentExecutor | LangGraph |
|------|--------------|-----------|
| 控制流 | 黑盒循环，LLM 决定一切 | 显式图，开发者定义流程 |
| 状态 | 扁平的 message history | 结构化 TypedDict |
| 循环 | 只有"继续/停止" | 任意节点间可以成环 |
| 人类介入 | 难以插入 | 任意节点前后可中断 |
| 持久化 | 需要自己实现 | 内建 Checkpointer |
| 流式 | 仅支持 token 流 | 支持节点级事件流 |

LangChain 官方自己也承认：AgentExecutor 适合原型，LangGraph 才是生产级方案。

---

## 章末思考题

**题目一：图 vs 代码——什么时候用 LangGraph 是过度设计？**

如果你的 Agent 只是"调用一个工具然后返回结果"（比如一个简单的 RAG 问答），用 LangGraph 建模值得吗？判断标准是什么？

> **参考答案**：判断标准是**流程中是否存在分支、循环或需要干预的点**。如果你的 Agent 是线性的（输入→处理→输出，没有条件分支，不需要重试，不需要人工审核），那么一个简单的函数调用链就够了，LangGraph 是过度设计。但只要出现以下任一情况，Graph 就开始有价值：需要根据中间结果走不同路径、需要"不满意就重来"的循环、需要在某步暂停等人确认、需要故障后从中间恢复。生产环境中，大多数有价值的 Agent 最终都会遇到这些需求。

**题目二：compile() 的价值是什么？**

为什么 LangGraph 要设计一个显式的 `compile()` 步骤，而不是直接在 `invoke()` 时动态执行？这个设计给框架带来了什么能力？

> **参考答案**：`compile()` 将"声明"和"执行"解耦，给框架一个**静态分析和增强的窗口**。在编译时，框架可以：①校验图结构的合法性（检测无法到达的节点、缺失的边）；②注入 Checkpointer（自动在每个节点后保存状态）；③设置中断点（Human-in-the-loop）；④优化执行路径。如果没有 compile，这些能力要么做不到，要么只能在运行时以更高代价实现。这和 SQL 的查询优化器、编译型语言的 AOT 编译是同一思路：提前知道全貌，才能做全局优化。

**题目三：状态的结构化意味着什么？**

对比"把所有信息塞进 message history"和"用 TypedDict 定义明确字段"，后者在实际开发中带来哪些具体好处？

> **参考答案**：结构化状态至少带来三个好处：①**可读性**——`state["search_results"]` 比从 50 条 message 中 parse 出搜索结果清晰得多；②**条件分支的依据**——条件边需要读取状态字段来做路由，结构化字段让路由逻辑简单且确定；③**选择性持久化与恢复**——你可以只 checkpoint 关键字段，恢复时精确还原到某个业务状态，而不是重放所有消息。本质上，结构化状态是将 Agent 的"工作记忆"从非结构化文本升级为数据库式的结构化存储。

---

> 准备好了就说「继续」进入第二章：State——图的血液系统。
