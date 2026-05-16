# 第3章：子 Agent 系统与任务分解

> 上一章我们理解了 Lead Agent 的状态机编排和中间件管道——这是「确定性框架」的骨架。本章我们将看到 Lead Agent 如何突破单个 LLM 的能力瓶颈，将复杂任务分解为可并行的子任务——这正是「编排优于单体智能」的直接体现。

---

## 3.1 为什么需要子 Agent？

单个 LLM 调用有三个根本限制：

1. **串行瓶颈**：一次只能做一件事，复杂任务耗时长
2. **上下文窗口有限**：信息越多，推理质量越下降
3. **单次推理深度有限**：复杂推理链容易漂移或遗漏

DeerFlow 的解法：**把大任务拆成小任务，交给独立的子 Agent 并行执行**。

```
Lead Agent 收到：「研究 2026 年三个主流 AI 框架的对比」
    ↓ 分解
    ├── 子 Agent A：「研究 LangGraph 的架构和生态」
    ├── 子 Agent B：「研究 CrewAI 的架构和生态」
    └── 子 Agent C：「研究 AutoGen 的架构和生态」
    ↓ 并行执行（最多 3 个）
    ↓ 结果汇总
Lead Agent：「综合三个子 Agent 的结果，生成对比报告」
```

## 3.2 内置子 Agent 类型

DeerFlow 预装了两种子 Agent：

### general-purpose（通用型）
- **工具**：继承 Lead Agent 的所有工具（除了 task 和 ask_clarification）
- **最大轮次**：100
- **适用场景**：需要搜索、分析、生成内容的复杂任务
- **系统提示词**：引导自主完成任务的详细指导

### bash（命令行专家）
- **工具**：仅限沙箱工具（bash、ls、read_file、write_file、str_replace）
- **最大轮次**：60
- **适用场景**：执行命令、安装依赖、运行脚本
- **限制**：仅在 `sandbox.allow_host_bash: true` 时可用

**关键设计决策**：子 Agent **不能嵌套**——task 工具在子 Agent 中被禁用。这防止了无限递归和资源耗尽。

## 3.3 双线程池架构

子 Agent 的执行使用了精心设计的**双线程池**：

```
                    ┌─────────────────┐
                    │  Lead Agent      │
                    │  (主线程)        │
                    └────────┬────────┘
                             │ 提交任务
                             ↓
                    ┌─────────────────┐
                    │  Scheduler Pool  │  ← 3 个 worker
                    │  (调度线程池)     │    负责任务提交和后台管理
                    └────────┬────────┘
                             │ 分发执行
                             ↓
                    ┌─────────────────┐
                    │  Execution Pool  │  ← 3 个 worker
                    │  (执行线程池)     │    负责实际运行子 Agent
                    └─────────────────┘
```

**为什么要两个池？**
- **Scheduler Pool**：管理任务生命周期（提交、状态追踪、结果收集）
- **Execution Pool**：运行实际的 LLM 推理和工具调用

分离的目的是**隔离关注点**——即使某个子 Agent 执行超时或崩溃，调度器仍然可以正常管理其他任务。

### 事件循环管理

异步执行使用了**持久化独立事件循环**：

```python
# 不是每次创建新的事件循环（开销大），而是复用一个长生命周期的循环
_persistent_loop = asyncio.new_event_loop()
```

- 避免了每次创建/销毁事件循环的资源开销
- 使用 `copy_context()` 保持父线程的上下文变量
- 优雅关闭时正确清理资源

## 3.4 并发控制：硬限制 vs 软限制

DeerFlow 对并发子 Agent 有**两层控制**：

### 硬限制：SubagentLimitMiddleware
```python
MAX_CONCURRENT_SUBAGENTS = 3  # 硬编码上限
```

这个中间件在 **before_agent()** 阶段截断 LLM 的工具调用列表：
- 如果 LLM 在一次响应中生成了 5 个 task 工具调用
- 中间件保留前 3 个，丢弃多余的
- 比提示词层面的「最多 3 个」更可靠（LLM 不一定遵守提示词）

### 软限制：提示词引导
系统提示词中明确说明并发限制，引导 LLM 主动控制任务数量。

**设计哲学**：不信任 LLM 的行为约束——用代码强制执行，而非只靠提示词。

## 3.5 结果收集与错误处理

### SubagentResult 数据结构
```python
@dataclass
class SubagentResult:
    task_id: str
    trace_id: str
    status: str           # PENDING → RUNNING → COMPLETED/FAILED/TIMED_OUT/CANCELLED
    result: str | None    # 最终输出
    error: str | None     # 错误信息
    ai_messages: list     # 完整的 AI 消息历史
    token_usage: dict     # Token 消耗统计
```

### 状态流转
```
PENDING → RUNNING → COMPLETED     （成功完成）
                  → FAILED         （执行出错）
                  → TIMED_OUT      （超过 15 分钟）
                  → CANCELLED      （被取消）
```

### 实时事件流
子 Agent 执行过程中会发射三种事件：

| 事件类型 | 时机 | 前端展示 |
|---------|------|---------|
| `task_started` | 任务开始 | 显示任务卡片 |
| `task_running` | 每条新 AI 消息 | 更新进度 |
| `task_completed/failed/timed_out` | 任务结束 | 显示结果或错误 |

### 错误处理策略

**超时控制**：
- 默认 15 分钟（可按 Agent 类型覆盖）
- 线程池级别的超时 + 轮询级别的超时，双重保障

**协作式取消**：
- 不是强制杀死（force-stopped futures 不可靠）
- 在迭代边界检测取消信号，优雅退出

**防御性清理**：
- 终态（COMPLETED/FAILED/TIMED_OUT）后自动清理资源
- Token 统计从子 Agent 转移到父 Agent 的 RunJournal

## 3.6 自定义子 Agent

可以通过 `config.yaml` 定义自定义子 Agent：

```yaml
subagents:
  custom_agents:
    web-researcher:
      description: "专门做网络调研的 Agent"
      system_prompt: "你是一个网络调研专家..."
      tools: ["web_search", "web_fetch", "read_file"]
      model: "inherit"        # 继承父 Agent 的模型
      max_turns: 80
      timeout_seconds: 600
```

### 工具过滤机制

子 Agent 的工具访问有**三层控制**：

| 层级 | 机制 | 示例 |
|------|------|------|
| **白名单** | `tools: [...]` | 只允许指定的工具 |
| **黑名单** | `disallowed_tools: [...]` | 总是排除的工具 |
| **强制禁用** | 代码硬编码 | `task` 工具永远不可用 |

### 模型继承

子 Agent 默认继承 Lead Agent 的模型，但也可以指定不同的模型：

```yaml
subagents:
  custom_agents:
    quick-helper:
      model: "gpt-4o-mini"    # 使用更便宜的模型
      tools: ["bash"]
```

---

## 思考题

**题 1**：DeerFlow 限制最多 3 个并发子 Agent，而不是让 LLM 自己决定创建多少个。如果将这个限制提高到 10，可能会遇到什么问题？如果完全去掉限制呢？

> **参考答案**：提高到 10 的问题：1）**LLM API 并发限制**——大多数提供商对同一 API Key 有速率限制（如 5 RPM），10 个并发会频繁触发 429 错误；2）**上下文爆炸**——每个子 Agent 的结果最终都要汇总到 Lead Agent 的上下文中，10 个详细结果可能超出窗口；3）**资源消耗**——每个子 Agent 独立持有沙箱连接和线程资源。完全去掉限制更危险：LLM 可能在一个请求中生成几十个 task 调用（尤其是复杂任务分解时），导致资源耗尽和级联超时。DeerFlow 选择 3 是一个工程权衡——足够并行化以提升效率，又不至于压垮基础设施。

**题 2**：子 Agent 的 task 工具被硬性禁用，防止嵌套。但某些场景下「让子 Agent 自己创建子任务」似乎很有用（比如研究一个大课题时，子 Agent 可以进一步分解）。你会如何设计一个支持受控嵌套的方案？

> **参考答案**：核心挑战是**递归深度控制**和**资源预算分配**。方案：1）**深度令牌**——在创建子 Agent 时传入一个 `max_depth` 参数，每嵌套一层减 1，到 0 时禁用 task 工具；2）**预算继承**——父 Agent 的总预算（token、时间）被子 Agent 按比例瓜分，越深层预算越少；3）**汇报而非执行**——子 Agent 可以「建议」分解任务，但最终决策权回到 Lead Agent（类似组织架构中的「建议权 vs 决策权」分离）。实际工程中，DeerFlow 不采用嵌套的原因是复杂性收益比不高——3 个子 Agent 已经能覆盖大部分并行场景，更深的嵌套增加的调试难度远大于效率提升。

**题 3**：子 Agent 的结果最终要汇总到 Lead Agent 的上下文中。如果 3 个子 Agent 各返回了 5000 token 的结果，Lead Agent 需要处理 15000 token 的输入。在上下文窗口有限的情况下，你会如何优化这个汇总过程？

> **参考答案**：几种策略可以组合使用：1）**子 Agent 端压缩**——要求子 Agent 在返回结果时先做摘要（如限制输出不超过 2000 token），而非返回完整过程；2）**渐进式汇总**——Lead Agent 不等所有子 Agent 完成，而是每完成一个就先处理一个，避免一次性加载全部结果；3）**分层汇总**——如果子 Agent 结果过长，先用一次 LLM 调用做中间压缩，再把压缩结果喂给最终汇总；4）**选择性保留**——根据任务需要，只保留关键结论和引用，丢弃中间推理过程。DeerFlow 实际采用了策略 1 的思路——子 Agent 的系统提示词引导其输出结构化的最终结果，而非冗长的过程描述。

---

准备好就说「继续」进入第四章——技能与工具系统。
