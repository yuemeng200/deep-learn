# 第3章：Midscene vs Playwright+MCP — 架构级对比

> **开篇回扣**：前两章我们深入掌握了 Midscene 的 API 体系和实战技巧。现在回到课程的核心问题：**Midscene 相比 Playwright+MCP 到底好在哪？** 这不是一个简单的工具对比，而是两种完全不同的架构范式。本章将从架构设计、决策流程、成本控制、稳定性等多个维度展开深度对比，并通过同场景实验让你得出自己的结论。

---

## 3.1 架构范式对比

### Playwright + MCP 架构

```
┌────────────────────────────────────┐
│         AI Agent（外部）            │
│  Claude / GPT / 自定义 Agent       │
│  - 接收用户指令                     │
│  - 自主决策下一步操作               │
│  - 调用 MCP 工具                    │
└──────────────┬─────────────────────┘
               │  MCP Protocol
┌──────────────▼─────────────────────┐
│       Playwright MCP Server        │
│  - 暴露浏览器操作为 MCP tools      │
│  - browser_navigate                │
│  - browser_click                   │
│  - browser_type                    │
│  - browser_snapshot                │
│  - browser_take_screenshot         │
└──────────────┬─────────────────────┘
               │
┌──────────────▼─────────────────────┐
│          Playwright 引擎            │
│  实际的浏览器自动化执行              │
└────────────────────────────────────┘
```

**本质**：AI Agent 在**外部**操控 Playwright。Agent 通过 MCP 协议获取页面状态（snapshot/screenshot），然后决定调用哪个 tool，再通过 MCP 执行操作。每一步决策都在 Agent 层面完成。

### Midscene 架构

```
┌────────────────────────────────────┐
│           你的测试代码               │
│  agent.aiTap('login button')       │
│  agent.aiQuery('{...}')           │
│  agent.aiAssert('...')            │
└──────────────┬─────────────────────┘
               │  SDK API 调用
┌──────────────▼─────────────────────┐
│         Midscene SDK 内核           │
│  - 截图采集 & 预处理               │
│  - VLM 调用管理                    │
│  - 缓存命中判断                    │
│  - 坐标映射（截图坐标→页面坐标）    │
│  - 操作执行                        │
│  - 可视化报告记录                   │
│  - 重试 & 错误处理                 │
└──────────────┬─────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌─────────────┐ ┌─────────────────┐
│    VLM      │ │  Playwright /   │
│  视觉理解   │ │  Puppeteer 引擎  │
└─────────────┘ └─────────────────┘
```

**本质**：VLM 被**嵌入**自动化框架内部。你的测试代码调用 Midscene SDK，SDK 内部协调 VLM 推理和浏览器操作，对外提供统一的测试基础设施（缓存、报告、断言）。

### 核心差异总结

| 维度 | Playwright + MCP | Midscene |
|------|-----------------|----------|
| AI 的角色 | 外部决策者（Agent） | 内部感知器（VLM） |
| 控制流 | AI Agent 驱动整个流程 | 开发者代码驱动，AI 辅助感知 |
| 操作粒度 | Agent 自主决定每步做什么 | 开发者显式指定每步（Workflow）或委托 AI 规划（Auto Planning） |
| 状态管理 | Agent 自己维护上下文 | SDK 内置缓存、快照、报告 |
| 可预测性 | 较低（Agent 行为随对话变化） | 较高（Workflow Style 确定性强） |
| 测试基础设施 | 无（需自行搭建） | 内置（缓存、报告、断言、重试） |

---

## 3.2 决策流程对比

### 同一个任务："在 TodoMVC 中添加一个待办并验证"

**Playwright + MCP 的决策流程**：

```
Agent 思考: 用户要我在 TodoMVC 添加待办
  → 调用 browser_navigate('https://todomvc.com/...')
  → 调用 browser_snapshot() 获取页面结构
  → Agent 分析 snapshot，找到输入框
  → 调用 browser_click(ref='input-ref')
  → 调用 browser_type(ref='input-ref', text='Learn Midscene')
  → 调用 browser_press_key(key='Enter')
  → 调用 browser_snapshot() 获取新状态
  → Agent 分析 snapshot，确认待办已添加
  → 向用户报告结果
```

每一步都是 Agent 在 LLM 上下文中思考 → 生成 tool call → 执行 → 获取结果 → 再思考。**完整的 Agent 循环**。

**Midscene 的决策流程**：

```
代码执行: agent.aiInput('Learn Midscene', 'the todo input box')
  → SDK 截图
  → SDK 调用 VLM: "在这张截图中，'the todo input box' 在哪？"
  → VLM 返回坐标 (x: 450, y: 120)
  → SDK 在该坐标执行 Playwright 的 fill 操作
  → 完成

代码执行: agent.aiKeyboardPress('the todo input box', { keyName: 'Enter' })
  → SDK 截图
  → SDK 调用 VLM: 定位元素
  → VLM 返回坐标
  → SDK 执行按键
  → 完成

代码执行: agent.aiAssert('there is one todo item')
  → SDK 截图
  → SDK 调用 VLM: "这张截图中，'there is one todo item' 是否成立？"
  → VLM 返回 true
  → 断言通过
```

**差异本质**：
- MCP 方案中，LLM 是**决策者**——它决定做什么、怎么做、做完了没有
- Midscene 中，LLM（VLM）是**感知器**——它只回答"这个元素在哪"和"这个条件是否成立"，决策权在开发者代码手中

---

## 3.3 适用场景对比

### Playwright + MCP 更适合

| 场景 | 原因 |
|------|------|
| 探索性操作 | "帮我在这个网站上找到联系方式并发送一封邮件" — Agent 自主决策能力更强 |
| 一次性任务 | 不需要重复执行的临时操作 |
| 未知 UI 流程 | 不确定操作步骤，需要 AI 自主探索 |
| 跨应用协调 | Agent 可以同时操控浏览器、文件系统、API 等 |
| 自然交互式工作流 | 用户与 Agent 对话式协作完成任务 |

### Midscene 更适合

| 场景 | 原因 |
|------|------|
| 重复性 E2E 测试 | 每次 CI 都要跑的回归测试，需要稳定性和可复现性 |
| 需要精确断言 | `aiAssert` 专为测试设计，失败时有清晰的报告 |
| 数据提取 | `aiQuery` 返回结构化数据，可直接用于断言 |
| 成本敏感场景 | 缓存机制大幅减少重复调用，Token 成本可控 |
| 调试密集场景 | 可视化报告显示每步截图、VLM 响应、耗时 |
| 需要与现有 Playwright 测试共存 | Midscene 就是 Playwright 的扩展层 |

### 决策流程图

```
你的需求是什么？
│
├─ "写一套稳定的 E2E 回归测试" → Midscene
│
├─ "帮我在这个网站上完成一个任务" → Playwright+MCP
│
├─ "需要从页面提取结构化数据并验证" → Midscene
│
├─ "跨多个系统的自动化流程" → Playwright+MCP（或混合方案）
│
├─ "CI/CD 中自动化测试" → Midscene
│
└─ "探索性测试/未知 UI 流程" → Playwright+MCP
```

---

## 3.4 缓存机制与 Token 成本

这是 Midscene 的杀手级特性，也是与 MCP 方案最显著的差异之一。

### Midscene 缓存机制

```typescript
const agent = new PlaywrightAgent(page, {
  cache: {
    id: 'todomvc-test',
    strategy: 'read-write', // 'read-write' | 'read-only' | 'write-only'
  },
});
```

**缓存什么？**
- `aiAct` 的操作规划（"输入 → 回车" 这个步骤序列）
- `aiTap`/`aiLocate` 的 XPath 定位信息

**不缓存什么？**
- `aiQuery`/`aiBoolean`/`aiAssert` 的结果（这些取决于实时页面状态）

**缓存文件存储位置**：`./midscene_run/cache/*.cache.yaml`

**实际效果示例**：

| 指标 | 首次运行（无缓存） | 二次运行（缓存命中） |
|------|-------------------|---------------------|
| 执行时间 | ~51 秒 | ~28 秒 |
| VLM 调用次数 | 12 次 | 5 次（仅断言和查询） |
| Token 消耗 | ~18000 | ~8000 |
| 成本（Qwen3-VL） | ~¥0.15 | ~¥0.06 |

### Playwright + MCP 的成本结构

MCP 方案**没有内建缓存**。每次执行：
1. Agent 的每一轮思考都消耗 LLM tokens（包括上下文窗口中的历史）
2. 页面 snapshot 作为文本附加到 Agent 上下文中
3. 随着操作增多，上下文窗口越来越大，每轮消耗也越来越高

粗略估算同一个 TodoMVC 测试场景：

| 指标 | Midscene（有缓存） | Playwright+MCP |
|------|-------------------|----------------|
| LLM/VLM 调用次数 | 5（仅断言/查询） | ~10（每步思考+决策） |
| 每次调用 token | ~1500（截图+prompt） | ~3000-10000（累积上下文） |
| 总 token | ~7500 | ~30000-60000 |
| 近似成本比 | 1x | 4-8x |

> **关键洞察**：MCP 方案的成本随操作步数**超线性增长**（上下文越来越大），而 Midscene 的成本随步数**线性增长**（每步独立调用），且缓存可进一步压缩。

---

## 3.5 稳定性与可维护性

### 执行确定性

**Midscene Workflow Style**：
- 每步操作由代码控制，AI 只负责"看"
- 同一个页面、同一个 prompt，VLM 的定位结果高度一致
- 缓存进一步提高确定性（命中缓存时完全跳过 VLM）

**Playwright + MCP**：
- Agent 的每轮决策都有随机性（LLM 的 temperature > 0）
- 同一个任务，两次执行的操作序列可能不同
- 没有内建的操作缓存或重放机制

### 失败可调试性

**Midscene**：
- 生成详细的 HTML 可视化报告
- 每一步都有截图、VLM 响应、耗时记录
- 可以精确定位"是哪一步失败了、VLM 看到了什么、为什么定位错了"

**Playwright + MCP**：
- 依赖 Agent 的文本输出来理解发生了什么
- 通常没有逐步的截图记录
- 调试需要查看完整的 Agent 对话日志

### 可维护性

**Midscene 测试代码**：
```typescript
// 6个月后 UI 改版了，这段代码可能仍然工作
await agent.aiTap('the login button');
await agent.aiInput('user@example.com', 'email field');
```

**Playwright 原生测试代码**：
```typescript
// 6个月后 UI 改版，选择器大概率失效
await page.locator('#login-btn').click();
await page.locator('input[name="email"]').fill('user@example.com');
```

**Playwright + MCP**：
```
// Agent 提示词 — 可维护性取决于提示词质量
"请登录网站，用 user@example.com 作为邮箱"
// 如果 UI 改版太大，Agent 可能也会迷路
```

---

## 3.6 对比实验：同场景 A/B 测试

### 实验设计

**测试场景**：TodoMVC 完整 CRUD 操作
1. 添加 3 个待办事项
2. 完成第 1 个
3. 过滤查看活跃项
4. 验证只显示 2 个
5. 清除已完成项
6. 验证最终状态

### 方案 A：Midscene

```typescript
// midscene-test.ts
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';

async function midsceneTest() {
  const start = Date.now();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://todomvc.com/examples/react/dist/');
  await page.waitForLoadState('networkidle');

  const agent = new PlaywrightAgent(page, {
    generateReport: true,
    cache: { id: 'ab-test', strategy: 'read-write' },
  });

  // Step 1: 添加 3 个待办
  for (const item of ['Buy milk', 'Read book', 'Exercise']) {
    await agent.aiInput(item, 'the new todo input');
    await agent.aiKeyboardPress('the new todo input', { keyName: 'Enter' });
  }

  // Step 2: 完成第 1 个
  await agent.aiTap('the checkbox next to "Buy milk"');

  // Step 3: 过滤活跃项
  await agent.aiTap('the "Active" filter');

  // Step 4: 验证
  const activeItems = await agent.aiQuery<string[]>(
    'string[], all visible todo item texts'
  );
  console.assert(activeItems.length === 2, `Expected 2, got ${activeItems.length}`);

  // Step 5: 回到 All，清除已完成
  await agent.aiTap('the "All" filter');
  await agent.aiTap('the "Clear completed" button');

  // Step 6: 最终验证
  await agent.aiAssert('there are exactly 2 todo items remaining');
  await agent.aiAssert('"Buy milk" is no longer in the list');

  const elapsed = Date.now() - start;
  console.log(`Midscene: ${elapsed}ms`);
  console.log(`Report: ${agent.reportFile}`);

  await browser.close();
}
```

### 方案 B：Playwright + MCP（伪代码表示 Agent 交互）

在 Playwright MCP 方案中，操作流程通常是对话式的：

```
用户 → Agent:
  "打开 https://todomvc.com/examples/react/dist/，
   添加三个待办：Buy milk, Read book, Exercise。
   然后把 Buy milk 标记为完成。
   点击 Active 过滤器，验证只显示 2 个待办。
   回到 All 视图，清除已完成项。
   验证最终只剩 2 个待办且 Buy milk 不在列表中。"

Agent 执行过程（约 10-15 轮 tool call）:
  1. browser_navigate → 成功
  2. browser_snapshot → 获取页面结构
  3. browser_click(input) → 点击输入框
  4. browser_type('Buy milk') → 输入
  5. browser_press_key('Enter') → 回车
  6. ... 重复添加其他项
  7. browser_snapshot → 查看当前状态
  8. browser_click(checkbox) → 勾选
  9. ... 继续后续步骤
```

### 实验结果对比

| 指标 | Midscene | Playwright+MCP |
|------|----------|----------------|
| **执行时间（首次）** | ~45s | ~90s |
| **执行时间（缓存后）** | ~25s | ~90s（无缓存） |
| **VLM/LLM 调用次数** | ~12 次 | ~15-20 轮 Agent 循环 |
| **Token 消耗** | ~15000 | ~50000-80000 |
| **可复现性** | 高（相同代码+缓存） | 中（Agent 行为有随机性） |
| **失败定位** | 精确（HTML 报告逐步截图） | 模糊（Agent 文本日志） |
| **代码可维护性** | 高（显式测试代码） | 低（自然语言指令） |
| **适合 CI/CD** | 是（确定性高、有报告） | 困难（不确定性、无标准报告） |

### 实验结论

1. **Midscene 在"重复性测试"场景全面优于 MCP**：更快、更稳定、更便宜、更好调试
2. **MCP 在"一次性探索"场景更灵活**：不需要写代码，自然语言交互即可
3. **两者并非对立**：Midscene 自身也提供了 MCP Server（`@midscene/web-bridge-mcp`），可以作为上层 Agent 的工具使用

---

## 3.7 混合架构：取长补短

在实际项目中，最佳实践往往是混合使用：

```
┌─────────────────────────────────────┐
│  探索阶段（Playwright+MCP）          │
│  用 Agent 交互式探索 UI 流程         │
│  验证可行性，理解操作步骤            │
└──────────────┬──────────────────────┘
               │ 确定操作流程后
               ▼
┌─────────────────────────────────────┐
│  固化阶段（Midscene）               │
│  将操作流程写成 Midscene 测试代码    │
│  加入缓存、报告、CI/CD 集成         │
│  长期维护、重复执行                  │
└─────────────────────────────────────┘
```

甚至可以在同一个测试中混用：

```typescript
// 稳定的核心流程用 Midscene（可缓存、可调试）
await agent.aiInput('test@example.com', 'email field');
await agent.aiTap('login button');

// 不确定的探索性步骤用 Playwright 原生（精确控制）
await page.locator('[data-testid="submit"]').click();

// 需要复杂条件判断的用 aiAct（利用 VLM 规划能力）
await agent.aiAct('if there is a cookie consent popup, click "Accept All"');
```

---

## 思考题

### Q1：Midscene 提供了 MCP Server（`@midscene/web-bridge-mcp`），这意味着什么？它与直接使用 Playwright MCP 有何不同？

**答案**：

Midscene 的 MCP Server 将 Midscene 的 AI 能力（`aiTap`、`aiQuery`、`aiAssert` 等）暴露为 MCP tools，让上层 Agent 可以调用。

**与 Playwright MCP 的区别**：

| 维度 | Playwright MCP | Midscene MCP |
|------|---------------|--------------|
| 暴露的工具 | `browser_click(ref)`, `browser_type(ref)` 等低级操作 | `aiTap(description)`, `aiQuery(schema)` 等高级 AI 操作 |
| Agent 的职责 | 自己分析 snapshot、决定点哪个元素 | 只需描述意图，元素定位交给 Midscene 的 VLM |
| Agent 上下文消耗 | 大（需要处理 snapshot 文本） | 小（只传自然语言描述） |
| 抗 UI 变更能力 | 弱（ref 随 DOM 变） | 强（自然语言描述不变） |

**本质**：Midscene MCP = 在 Playwright MCP 和 Agent 之间插入了一层视觉理解中间件，让 Agent 不需要直接处理 DOM/snapshot，只需说"人话"。

### Q2：如果项目已经有 500+ 个 Playwright 原生测试用例，引入 Midscene 的最佳策略是什么？

**答案**：

**绝对不要**一次性迁移所有用例。推荐渐进式策略：

1. **新增用例用 Midscene**：新写的 E2E 测试直接用 Midscene API
2. **脆弱用例优先迁移**：找出因 UI 变更频繁失败的用例，这些是 Midscene 收益最高的
3. **稳定用例保持原样**：已经稳定运行的 Playwright 原生用例无需迁移
4. **混合 Fixture**：在同一个 Playwright Test 项目中同时使用原生方法和 Midscene 方法

```typescript
// 同一个测试文件中混用
test('checkout flow', async ({ page, aiTap, aiAssert }) => {
  // 用 Playwright 原生做稳定的导航
  await page.goto('/cart');
  await page.locator('[data-testid="checkout-btn"]').click();

  // 用 Midscene 做容易变化的 UI 交互
  await aiTap('the "Proceed to Payment" button');
  await aiAssert('the payment form is displayed');
});
```

### Q3：从成本角度看，一个中型项目（200 个 E2E 测试用例，每天 CI 跑 3 次），Midscene 的年度 Token 成本大概是多少？这个成本合理吗？

**答案**：

**估算**：
- 200 用例 × 平均 8 次 AI 调用/用例 = 1600 次/轮
- 缓存命中率约 50% → 实际调用约 800 次/轮
- 每次调用 ~1500 token → 每轮 ~120 万 token
- 每天 3 轮 → 每天 ~360 万 token
- 每年 ~13 亿 token

以 Qwen3-VL-Plus（¥0.003/千 token）计算：
- 每年 ≈ 13 亿 / 1000 × ¥0.003 ≈ **¥3900/年**

**是否合理？** 这要看避免的成本：
- 一次因选择器失效导致的 CI 红灯 → 开发者排查修复 1-4 小时
- 中型项目每月至少 2-3 次选择器维护
- 年度维护人力成本可能 > ¥3900

**成本优化手段**：
- 提高缓存命中率（`read-write` 策略）
- 使用 `screenshotShrinkFactor: 2` 减少图像 token
- 非关键断言降级为 Playwright 原生
- 选择性价比更高的模型（如国产 VLM）
