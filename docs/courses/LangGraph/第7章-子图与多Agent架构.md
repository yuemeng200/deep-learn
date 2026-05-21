# 第7章：子图与多 Agent 架构——规模化的设计模式

## 回扣本质

前六章我们构建了一个功能完整的单体 Agent。但当 Agent 的职责越来越多、图的节点越来越复杂时，你会遇到和传统软件一样的问题——**一个巨大的单体系统无法维护**。子图（Sub-graph）和多 Agent 架构就是 LangGraph 的模块化方案：用"图中嵌套图"实现关注点分离，用"多个 Agent 协作"解决单一 Agent 能力瓶颈。这是"把 Agent 当软件工程来做"这一核心哲学在架构层面的体现——**Agent 也需要分层、解耦、单一职责。**

---

## 为什么需要子图？

### 单体图的痛点

20+ 节点、条件边交织的图没人看得懂。

### 子图的解法

```
START → planner → [搜索子图] → [分析子图] → [写作子图] → END
```

每个子图独立开发、独立测试、可复用。

---

## 子图的实现方式

### 方式一：编译后的图作为节点

```python
# 搜索子图
class SearchState(TypedDict):
    queries: list[str]
    results: Annotated[list[dict], add]

search_builder = StateGraph(SearchState)
search_builder.add_node("expand", query_expander)
search_builder.add_node("execute", web_searcher)
search_builder.add_node("deduplicate", ranker)
search_builder.add_edge(START, "expand")
search_builder.add_edge("expand", "execute")
search_builder.add_edge("execute", "deduplicate")
search_builder.add_edge("deduplicate", END)
search_graph = search_builder.compile()

# 在主图中调用
def search_node(state: MainState) -> dict:
    result = search_graph.invoke({"queries": state["search_queries"]})
    return {"sources": result["results"]}
```

### 方式二：直接传入编译后的图

```python
main_builder.add_node("search", search_graph)  # 同名字段自动映射
```

---

## 状态传递策略

| 策略 | 适用场景 |
|------|----------|
| 同名字段自动映射 | 子图和主图 State 字段名一致 |
| 函数手动转换 | 字段名不匹配 |
| 共享 State Schema | 子图是主图的内聚模块 |

---

## 多 Agent 协作模式

### Supervisor（主管模式）

```python
# supervisor 决定分配给谁
def supervisor(state) -> dict:
    if not state.get("search_result"):
        return {"next_agent": "searcher"}
    elif not state.get("analysis_result"):
        return {"next_agent": "analyzer"}
    else:
        return {"next_agent": "FINISH"}

# 每个 agent 完成后回到 supervisor
builder.add_edge("searcher", "supervisor")
builder.add_edge("analyzer", "supervisor")
```

### Hierarchical（层级模式）

多层 supervisor，子图嵌套子图：
```
总监 → [搜索团队子图] → [分析团队子图] → [报告团队子图]
```

### Swarm（群体模式）

Agent 之间通过 Command 直接交接：

```python
from langgraph.types import Command

def search_agent(state):
    result = do_search(state["topic"])
    return Command(
        update={"search_result": result},
        goto="analysis_agent",
    )
```

---

## 重构 Deep Research Agent

```python
# 搜索子图
search_builder = StateGraph(SearchSubState)
search_builder.add_node("expand", expand_queries)
search_builder.add_node("execute", execute_search)
search_builder.add_node("deduplicate", deduplicate)
# ... 内部线性流程
search_subgraph = search_builder.compile()

# 分析子图（含内部反思循环）
analysis_builder = StateGraph(AnalysisSubState)
analysis_builder.add_node("analyze", analyze)
analysis_builder.add_node("evaluate", evaluate)
analysis_builder.add_node("reflect", reflect)
analysis_builder.add_conditional_edges("evaluate", analysis_route)
analysis_builder.add_edge("reflect", "analyze")  # 内部循环
analysis_subgraph = analysis_builder.compile()

# 主图
main_builder = StateGraph(ResearchState)
main_builder.add_node("planner", plan_research)
main_builder.add_node("search_team", search_phase)      # 封装子图调用
main_builder.add_node("analysis_team", analysis_phase)  # 封装子图调用
main_builder.add_node("reporter", write_report)
main_builder.add_edge(START, "planner")
main_builder.add_edge("planner", "search_team")
main_builder.add_edge("search_team", "analysis_team")
main_builder.add_edge("analysis_team", "reporter")
main_builder.add_edge("reporter", END)
```

---

## 模式选择指南

| 判断维度 | Supervisor | Hierarchical | Swarm |
|----------|-----------|--------------|-------|
| 任务类型 | 流水线式 | 大型复杂项目 | 对话式协作 |
| 控制方式 | 集中 | 分层集中 | 去中心化 |
| Agent 数量 | 3-5 | 10+ | 2-5 |
| 适合场景 | 步骤明确 | 企业级系统 | 专家会诊 |

**建议**：从 Supervisor 开始，只在必要时升级复杂度。

---

## 子图注意事项

### Checkpoint 穿透

子图内部状态不会被主图 checkpointer 保存。子图对主图来说是一个"原子操作"。

### 流式输出嵌套

```python
# subgraphs=True 可以看到子图内部节点的进度
for namespace, event in graph.stream(input, config, stream_mode="updates", subgraphs=True):
    print(f"[{namespace}] {event}")
```

### 避免过度嵌套

最多两层（主图 → 子图）。更深的嵌套用函数抽象替代。

---

## 章末思考题

**题目一：子图 vs 函数抽象**

搜索逻辑用子图 vs 普通函数，本质区别是什么？

> **参考答案**：区别在于**可观测性和可中断性**。子图内部每个节点可被 stream、checkpoint、interrupt；函数是黑盒。需要中间观测或中间暂停时用子图，否则函数更简洁。

**题目二：Supervisor 的单点瓶颈**

所有决策经过 supervisor，它挂了怎么办？

> **参考答案**：①确定性 supervisor（不用 LLM，状态检查做路由）；②降级策略（LLM 失败时回退默认流程）；③有限自治（worker 自己能决定的不要经过 supervisor）。核心：不要让 LLM 做确定性工作。

**题目三：状态隔离 vs 共享**

共享 State vs 独立 State + 消息通信，各自优缺点？

> **参考答案**：共享简单但耦合紧密；独立松耦合但有转换开销。小团队用共享，大系统用独立。折中：共享精简的通信 State，Agent 内部维护 private state。

---

> 准备好了就说「继续」进入第八章（终章）：整合与复盘——从 Demo 到 Production。
