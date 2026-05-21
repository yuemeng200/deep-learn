# 第5章：Human-in-the-Loop——生产级 Agent 的安全阀

## 回扣本质

前面四章我们一直在让 Agent 变得更"自主"——自动规划、自动搜索、自动反思。但在生产环境中，**完全自主的 Agent 是危险的**。Human-in-the-Loop（HITL）正是 LangGraph "用图夺回控制权"的终极体现：**不仅控制 Agent 走什么路，还能随时暂停它、审查它、修改它的状态，然后再放它继续走。**

---

## 为什么生产级 Agent 必须有 HITL？

### 三个真实场景

**场景一：敏感操作审批**
Agent 要发邮件、调用付费 API、写入数据库——不可逆操作必须人工确认。

**场景二：质量把关**
Agent 生成的报告要发给客户——发出前需过一眼。

**场景三：方向修正**
Agent 的研究规划偏了，需要直接修改它的计划。

### HITL 的三种模式

| 模式 | 场景 | 人类操作 |
|------|------|----------|
| **审批（Approve）** | 敏感操作前暂停 | "继续"或"取消" |
| **编辑（Edit）** | 修改中间结果 | 修改 State 后恢复 |
| **输入（Input）** | Agent 需要更多信息 | 补充信息后恢复 |

---

## 前置知识：Checkpointer 基础

HITL 依赖 Checkpointer——"暂停"意味着保存当前状态，等人类响应后恢复。

```python
from langgraph.checkpoint.memory import MemorySaver

checkpointer = MemorySaver()

graph = builder.compile(
    checkpointer=checkpointer,
    interrupt_before=["reporter"],
)
```

**关键概念：thread_id**

```python
config = {"configurable": {"thread_id": "research-session-001"}}

# 第一次：执行到中断点暂停
result = graph.invoke({"topic": "AI Agents"}, config=config)

# 第二次：从中断点恢复
result = graph.invoke(None, config=config)
```

---

## 模式一：审批门控（Interrupt Before）

```python
graph = builder.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["reporter"],
)

config = {"configurable": {"thread_id": "session-1"}}

# 启动，在 reporter 前暂停
result = graph.invoke({"topic": "LangGraph 生产实践"}, config=config)

# 检查状态
state = graph.get_state(config)
print(f"暂停在: {state.next}")
print(f"分析结果: {state.values['analysis'][:200]}...")

# 满意，继续
result = graph.invoke(None, config=config)
```

### interrupt_before vs interrupt_after

```python
# interrupt_before：节点执行前暂停（确认后才执行）
graph = builder.compile(checkpointer=cp, interrupt_before=["send_email"])

# interrupt_after：节点执行后暂停（审查执行结果）
graph = builder.compile(checkpointer=cp, interrupt_after=["searcher"])
```

---

## 模式二：编辑状态（State Modification）

```python
config = {"configurable": {"thread_id": "session-2"}}

graph = builder.compile(
    checkpointer=MemorySaver(),
    interrupt_before=["searcher"],
)

# 执行到 searcher 前暂停
graph.invoke({"topic": "微服务架构"}, config=config)

# 查看并修改 Agent 的计划
state = graph.get_state(config)
print("Agent 的搜索词:", state.values["search_queries"])

# 直接修改 State
graph.update_state(config, values={
    "search_queries": ["Istio vs Linkerd 生产对比", "微服务分布式追踪最佳实践"],
})

# 用修改后的 State 恢复执行
result = graph.invoke(None, config=config)
```

---

## 模式三：动态中断（Interrupt 函数）

运行时动态决定是否中断：

```python
from langgraph.types import interrupt

def searcher(state: ResearchState) -> dict:
    results = search_api.search(state["search_queries"])

    sensitive_results = [r for r in results if contains_sensitive(r)]
    if sensitive_results:
        human_decision = interrupt({
            "message": "搜索结果包含敏感内容，是否继续？",
            "sensitive_items": sensitive_results,
        })
        if human_decision == "skip":
            results = [r for r in results if r not in sensitive_results]

    return {"sources": results}
```

### 恢复时传入人类响应

```python
from langgraph.types import Command

config = {"configurable": {"thread_id": "session-3"}}

# 执行到 interrupt() 暂停
graph.invoke({"topic": "某敏感话题"}, config=config)

# 人类决定：跳过敏感内容
result = graph.invoke(Command(resume="skip"), config=config)
```

---

## 为 Deep Research Agent 添加 HITL

在两个关键点添加人类干预：

```python
from langgraph.types import interrupt


def planner(state: ResearchState) -> dict:
    """规划后请求人类确认"""
    response = llm.invoke([...])
    plan = parse_plan(response.content)
    queries = parse_queries(response.content)

    human_feedback = interrupt({
        "message": "请确认研究计划，或提供修改意见",
        "plan": plan,
        "queries": queries,
    })

    if isinstance(human_feedback, dict):
        plan = human_feedback.get("plan", plan)
        queries = human_feedback.get("queries", queries)

    return {"plan": plan, "search_queries": queries, "iteration_count": 0}


def pre_report_check(state: ResearchState) -> dict:
    """报告前审查"""
    approval = interrupt({
        "message": "分析完成，是否生成报告？",
        "analysis_preview": state["analysis"][:500],
        "quality_score": state["quality_score"],
        "options": ["approve", "revise", "abort"],
    })

    if approval == "abort":
        return {"report": "[用户取消]"}
    return {}
```

### 完整交互流程

```python
from langgraph.types import Command

config = {"configurable": {"thread_id": "research-001"}}

# 1. 启动，planner 中 interrupt() 暂停
graph.invoke({"topic": "2024年大模型Agent框架对比"}, config=config)

# 2. 人类修改计划后恢复
result = graph.invoke(
    Command(resume={"plan": ["对比 LangGraph/CrewAI/AutoGen", "分析设计哲学", "评估生产就绪度"]}),
    config=config,
)

# 3. 到达 pre_report_check，再次暂停
state = graph.get_state(config)
print(f"评分: {state.values['quality_score']}")

# 4. 审批通过
result = graph.invoke(Command(resume="approve"), config=config)
print(result["report"])
```

---

## HITL 与 Web 应用集成

```python
from fastapi import FastAPI
from langgraph.checkpoint.postgres import PostgresSaver

app = FastAPI()
checkpointer = PostgresSaver(conn_string="postgresql://...")
graph = builder.compile(checkpointer=checkpointer)


@app.post("/research/start")
async def start_research(topic: str, user_id: str):
    thread_id = f"{user_id}-{uuid4()}"
    config = {"configurable": {"thread_id": thread_id}}
    result = await graph.ainvoke({"topic": topic}, config=config)
    state = graph.get_state(config)
    return {
        "thread_id": thread_id,
        "status": "waiting_for_approval" if state.next else "completed",
        "pending_interrupt": state.tasks[0].interrupts if state.tasks else None,
    }


@app.post("/research/resume")
async def resume_research(thread_id: str, response: dict):
    config = {"configurable": {"thread_id": thread_id}}
    result = await graph.ainvoke(Command(resume=response), config=config)
    state = graph.get_state(config)
    return {
        "status": "waiting_for_approval" if state.next else "completed",
        "result": result if not state.next else None,
    }
```

---

## HITL 设计原则

### 原则一：中断点 = 决策点

只在人类能做出有意义决策的地方中断。

### 原则二：提供足够的决策上下文

```python
# ✅ 恰到好处
interrupt({
    "message": "分析完成，是否生成报告？",
    "quality_score": state["quality_score"],
    "key_findings": state["analysis"][:300],
    "iterations_used": state["iteration_count"],
})
```

### 原则三：支持多种响应方式

```python
interrupt({
    "options": {
        "approve": "确认执行",
        "modify": "修改后执行",
        "abort": "取消任务",
    }
})
```

---

## 章末思考题

**题目一：HITL 的延迟容忍**

图在 interrupt 暂停后，人类可能 5 分钟或 5 天后才响应。这对系统设计有什么影响？Checkpointer 的选择为什么重要？

> **参考答案**：①**状态必须持久化到可靠存储**——MemorySaver 进程重启就丢了，必须用 PostgresSaver 等持久化方案；②**不能持有长连接等待**——必须是"中断→保存→释放→响应时重新加载→恢复"的异步模式；③**可能需要超时机制**——7天没响应应自动取消或提醒。核心认知：**HITL 把同步执行变成异步的跨时间协作，基础设施从"内存计算"升级到"持久化+异步消息"。**

**题目二：interrupt 的位置选择**

编译时 `interrupt_before=["reporter"]` vs 节点内 `interrupt()` 动态中断，各适合什么场景？

> **参考答案**：编译时固定中断：每次必须审批的场景（合规要求），更显式。运行时动态中断：需要条件判断的场景（"评分>9就不审了"），更灵活，且可传递结构化上下文。**生产建议**：必须中断用编译配置；有条件中断用 `interrupt()`。

**题目三：update_state 的风险**

人类设了不合法值（如 `quality_score = "很好"`），会怎样？如何防御？

> **参考答案**：TypedDict 运行时不做校验，非法值直接写入，后续节点报错。防御：①API 层用 Pydantic 验证输入；②节点开头做防御性转换；③封装 update_state，提供语义化操作（"approve"/"reject"），后端翻译为安全更新。

---

> 准备好了就说「继续」进入第六章：持久化与流式输出——部署前的最后一公里。
