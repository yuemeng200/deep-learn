# 第4章：循环与反思——让 Agent 自我修正

## 回扣本质

前三章我们构建了一个能从 START 走到 END 的线性流程（带条件分支）。但真正强大的 Agent 需要**自我修正的能力**——搜索结果不够好就再搜一轮，分析有漏洞就重新分析。这种"循环"是 LangGraph 区别于大多数工作流引擎的核心特性。传统的 DAG（有向无环图）框架做不到这一点，而 LangGraph 显式支持环——这正是"用图夺回控制权"的高级体现：**你不仅控制流程走向，还控制它何时回头、回头几次、什么条件下停止。**

---

## 为什么 Agent 需要循环？

### 人类解决问题的模式

```
想一想 → 试一试 → 看结果 → 不满意？→ 换个方式再试
```

这不是线性的，是循环的。一个没有循环能力的 Agent，只能"一枪命中"——做不到就算了。而生产级 Agent 需要的是**渐进式逼近**：

- 第一轮搜索太宽泛 → 收窄关键词再搜
- 分析不够深入 → 补充额外资料再分析
- 报告缺少某个角度 → 针对性补充

### DAG 的局限 vs Graph 的优势

```
DAG（有向无环图）：
A → B → C → D    只能往前走，不能回头

Graph（允许环）：
A → B → C ─┐
    ↑       │
    └───────┘    可以回到之前的节点
```

LangGraph 的名字里有"Graph"而不是"DAG"，这不是偶然——支持循环是它的一等公民特性。

---

## 循环的三种模式

### 模式一：固定次数循环

```python
def should_continue_fixed(state: ResearchState) -> str:
    if state["iteration_count"] >= 3:
        return "done"
    return "repeat"
```

适用场景：多轮信息补充（"搜3轮不同角度的资料"）

### 模式二：条件退出循环

```python
def should_continue_quality(state: ResearchState) -> str:
    if state["quality_score"] >= 7:
        return "done"
    if state["iteration_count"] >= 5:
        return "done"        # 安全阀
    return "improve"
```

适用场景：结果质量驱动的迭代优化

### 模式三：自适应循环（Reflection Loop）

```python
def reflector(state: ResearchState) -> dict:
    """反思节点：分析不足，给出改进方向"""
    response = llm.invoke([
        SystemMessage(content="""评估当前分析质量。指出：
1. 缺少什么信息？
2. 哪些论点需要更多证据？
3. 应该搜索什么新的关键词？"""),
        HumanMessage(content=f"主题：{state['topic']}\n分析：{state['analysis']}")
    ])
    return {
        "feedback": response.content,
        "search_queries": extract_new_queries(response.content),
    }
```

适用场景：复杂任务的自我改进

---

## 实战：为研究助手添加反思循环

### 完整的循环架构

```
START → planner → searcher → analyzer → reflector ─┐
                     ↑                              │
                     │         质量 < 7             │
                     │         且次数 < 3           │
                     └──────────────────────────────┘
                                                    │
                                  质量 >= 7         │
                                  或次数 >= 3       │
                                                    ▼
                                                reporter → END
```

### 完整实现

```python
from typing import TypedDict, Annotated
from operator import add
from langgraph.graph import StateGraph, START, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)


class ResearchState(TypedDict):
    topic: str
    plan: list[str]
    search_queries: list[str]
    sources: Annotated[list[dict], add]
    analysis: str
    quality_score: int
    feedback: str
    iteration_count: int
    report: str


def planner(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="你是研究规划专家。生成3-5个研究步骤，每行一个。"),
        HumanMessage(content=f"研究主题：{state['topic']}")
    ])
    plan = [s.strip() for s in response.content.split("\n") if s.strip()]
    query_resp = llm.invoke([
        SystemMessage(content="生成2-3个搜索查询词，每行一个。"),
        HumanMessage(content=f"研究计划：\n" + "\n".join(plan))
    ])
    queries = [q.strip() for q in query_resp.content.split("\n") if q.strip()]
    return {"plan": plan, "search_queries": queries, "iteration_count": 0}


def searcher(state: ResearchState) -> dict:
    results = []
    for query in state["search_queries"][:3]:
        response = llm.invoke([
            SystemMessage(content="模拟搜索引擎，返回2条结果（标题+摘要）。"),
            HumanMessage(content=f"搜索：{query}")
        ])
        results.append({"query": query, "content": response.content})
    return {"sources": results}


def analyzer(state: ResearchState) -> dict:
    sources_text = "\n\n".join([
        f"[{s['query']}]\n{s['content']}" for s in state["sources"]
    ])
    response = llm.invoke([
        SystemMessage(content="综合所有搜索结果进行深度分析。如有反馈，针对性改进。"),
        HumanMessage(content=f"主题：{state['topic']}\n反馈：{state.get('feedback', '无')}\n\n资料：\n{sources_text}")
    ])
    score_resp = llm.invoke([
        SystemMessage(content="评估分析质量(1-10)。考虑：覆盖面、深度、论据充分性。只输出数字。"),
        HumanMessage(content=response.content)
    ])
    try:
        score = int(score_resp.content.strip())
    except ValueError:
        score = 5
    return {
        "analysis": response.content,
        "quality_score": score,
        "iteration_count": state["iteration_count"] + 1,
    }


def reflector(state: ResearchState) -> dict:
    """反思节点——循环的核心驱动力"""
    response = llm.invoke([
        SystemMessage(content="""你是研究质量审查员。指出：
1. 缺少什么关键信息
2. 哪些观点缺乏支撑
3. 建议补充搜索的关键词（2-3个，每行一个）

格式：
## 不足
...
## 建议搜索
关键词1
关键词2
"""),
        HumanMessage(content=f"主题：{state['topic']}\n当前分析：\n{state['analysis']}")
    ])
    content = response.content
    new_queries = []
    if "## 建议搜索" in content:
        queries_section = content.split("## 建议搜索")[1]
        new_queries = [q.strip() for q in queries_section.strip().split("\n") if q.strip()]
    return {
        "feedback": content,
        "search_queries": new_queries if new_queries else [f"{state['topic']} 深入分析"],
    }


def reporter(state: ResearchState) -> dict:
    response = llm.invoke([
        SystemMessage(content="撰写结构化研究报告。包含：摘要、主要发现、结论。"),
        HumanMessage(content=f"主题：{state['topic']}\n分析：{state['analysis']}\n迭代次数：{state['iteration_count']}")
    ])
    return {"report": response.content}


def route_after_analysis(state: ResearchState) -> str:
    if state["quality_score"] >= 7:
        return "reporter"
    if state["iteration_count"] >= 3:
        return "reporter"
    return "reflector"


builder = StateGraph(ResearchState)
builder.add_node("planner", planner)
builder.add_node("searcher", searcher)
builder.add_node("analyzer", analyzer)
builder.add_node("reflector", reflector)
builder.add_node("reporter", reporter)

builder.add_edge(START, "planner")
builder.add_edge("planner", "searcher")
builder.add_edge("searcher", "analyzer")
builder.add_conditional_edges("analyzer", route_after_analysis)
builder.add_edge("reflector", "searcher")  # 循环！
builder.add_edge("reporter", END)

graph = builder.compile()
```

### 关键理解：循环的"齿轮组"

```
┌─────────────────────────────────────────────┐
│  analyzer: 评估质量 → 写入 quality_score    │  ← 发现问题
├─────────────────────────────────────────────┤
│  route: 读取 quality_score → 决定去哪       │  ← 决策
├─────────────────────────────────────────────┤
│  reflector: 分析不足 → 生成新 queries       │  ← 制定改进方案
├─────────────────────────────────────────────┤
│  searcher: 执行新 queries → 补充 sources    │  ← 执行改进
└─────────────────────────────────────────────┘
```

---

## 安全阀：防止无限循环

### 策略一：硬性次数上限

```python
if state["iteration_count"] >= 3:
    return "reporter"  # 强制退出
```

### 策略二：递减的质量要求

```python
def route_after_analysis(state: ResearchState) -> str:
    threshold = max(5, 8 - state["iteration_count"])  # 8, 7, 6, 5...
    if state["quality_score"] >= threshold:
        return "reporter"
    if state["iteration_count"] >= 4:
        return "reporter"
    return "reflector"
```

### 策略三：改进幅度检测

```python
class ResearchState(TypedDict):
    score_history: Annotated[list[int], add]

def route_after_analysis(state: ResearchState) -> str:
    scores = state["score_history"]
    if len(scores) >= 2 and scores[-1] <= scores[-2]:
        return "reporter"  # 没有提升，停止
    if state["quality_score"] >= 7:
        return "reporter"
    return "reflector"
```

---

## 反思模式的设计变体

### 变体一：批判者模式（Critic）

```python
def critic(state: ResearchState) -> dict:
    strong_llm = ChatOpenAI(model="gpt-4o", temperature=0)
    response = strong_llm.invoke([
        SystemMessage(content="你是严格的研究审稿人。评分标准：..."),
        HumanMessage(content=state["analysis"])
    ])
    return {"quality_score": parse_score(response.content), "feedback": response.content}
```

### 变体二：多维度评估

```python
def route_by_weakness(state: ResearchState) -> str:
    metrics = state["quality_metrics"]
    if min(metrics.values()) >= 6 and sum(metrics.values()) >= 28:
        return "reporter"
    weakest = min(metrics, key=metrics.get)
    if weakest == "completeness":
        return "broad_search"
    elif weakest == "depth":
        return "deep_dive"
    else:
        return "verify"
```

### 变体三：Plan-and-Solve 循环

```python
# reflector → query_generator → searcher → analyzer → ...
# 反思和执行进一步解耦
```

---

## 运行时观测

```python
for event in graph.stream({"topic": "AI Agent 架构设计"}, stream_mode="updates"):
    for node_name, state_update in event.items():
        if node_name == "analyzer":
            score = state_update.get("quality_score", "?")
            iteration = state_update.get("iteration_count", "?")
            print(f"  [第{iteration}轮] 质量评分: {score}/10")
        elif node_name == "reflector":
            print(f"  [反思] {state_update.get('feedback', '')[:100]}...")
        elif node_name == "reporter":
            print(f"  [完成] 报告已生成")
```

---

## 循环 vs 递归

| 维度 | 递归 | LangGraph 循环 |
|------|------|----------------|
| 状态管理 | 调用栈 | 共享 State |
| 历史累积 | 需显式传递 | reducer 自动累积 |
| 可中断性 | 只能在函数边界 | 每个节点后都可 checkpoint |
| 可观测性 | 需额外日志 | 框架自动记录 |
| 栈溢出 | 有风险 | 无（迭代式） |

---

## 章末思考题

**题目一：自我评分的偏见问题**

同一个 LLM 既写分析又给自己评分。这有什么问题？如何解决"自我感觉良好"导致评分虚高？

> **参考答案**：同模型评估自己的输出，天然倾向给高分。解决方案：①**用不同模型评分**——偏见不同可互相制衡；②**用结构化评分标准**——检查具体条件（"是否包含至少3个案例？"），可验证的标准比模糊的"质量"更可靠；③**外部验证**——通过工具调用验证事实声称。生产环境通常结合②和③。

**题目二：循环中 sources 的膨胀问题**

每轮循环 searcher 都往 sources（add reducer）追加结果。3轮后 sources 膨胀3倍，analyzer 传给 LLM 的 context 可能超窗口。如何处理？

> **参考答案**：三层方案：①**即时方案**——analyzer 内对 sources 做 top-K 筛选；②**架构方案**——加 ranker 节点做相关性排序和去重；③**State 设计方案**——拆分为 `all_sources`（add reducer 完整记录）和 `active_sources`（覆盖式，当轮使用）。核心思想：**累积是为了记录，使用时需要筛选。**

**题目三：如何测试含循环的图？**

执行路径动态变化（1轮或3轮），如何写单元测试？

> **参考答案**：分层策略：①**节点级测试**——独立测试每个函数；②**路由函数测试**——枚举边界 State 验证路由正确性；③**集成测试**——用 mock LLM（第一轮返回低分、第二轮返回高分）运行整图，验证循环正好执行预期轮数。关键：mock 让测试确定性可控。

---

> 准备好了就说「继续」进入第五章：Human-in-the-Loop——生产级 Agent 的安全阀。
