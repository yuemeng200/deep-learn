# 第2章：三大 API 体系深度拆解

> **开篇回扣**：上一章我们用 `aiInput`、`aiTap`、`aiAssert` 写出了第一个脚本，直观感受了视觉驱动的自动化。但那只是浅尝辄止。Midscene 的 API 设计分为三大体系——交互、数据提取、工具——每一类都有丰富的选项和技巧。本章将逐一拆解，并用 TodoMVC 完整测试套件作为实战载体。

---

## 2.1 Interaction API — 交互体系

交互 API 负责"操作页面"——点击、输入、滚动、按键等。

### 2.1.1 `aiTap(locate, options?)` — 点击

最常用的交互方法。用自然语言描述要点击的元素：

```typescript
// 基础用法
await agent.aiTap('the "Active" filter button');

// 开启 deepLocate，对小元素/相似元素更精确（调用两次 VLM）
await agent.aiTap('the small delete icon on the first todo item', { deepLocate: true });

// 使用图片提示定位（适合无文字的图标）
await agent.aiTap({
  prompt: 'the GitHub logo in the footer',
  images: [{ name: 'GitHub logo', url: 'https://github.githubassets.com/favicons/favicon.svg' }],
  convertHttpImage2Base64: true,
});
```

**相关变体**：
- `aiDoubleClick(locate)` — 双击
- `aiRightClick(locate)` — 右键点击（仅 Web，注意：无法操作浏览器原生右键菜单）
- `aiHover(locate)` — 悬停（仅 Web）

### 2.1.2 `aiInput(locate, options)` — 输入

```typescript
// 基础：定位元素并输入文本
await agent.aiInput('Buy groceries', 'the todo input box');

// 替换已有内容（默认行为是 replace）
await agent.aiInput('Updated task name', 'the todo input being edited', {
  mode: 'replace',  // 'replace' | 'clear' | 'typeOnly'
});

// clear 模式：先清空再输入
await agent.aiInput('New content', 'the search box', { mode: 'clear' });

// typeOnly 模式：直接逐字输入，不清除已有内容
await agent.aiInput(' appended text', 'the text area', { mode: 'typeOnly' });
```

**三种输入模式**：
| 模式 | 行为 | 适用场景 |
|------|------|---------|
| `replace`（默认） | 全选已有内容后输入 | 大多数场景 |
| `clear` | 先清空字段再输入 | 搜索框等需要清空的场景 |
| `typeOnly` | 直接输入，不触碰已有内容 | 追加内容、需要触发逐字事件 |

### 2.1.3 `aiKeyboardPress(locate, options)` — 按键

```typescript
await agent.aiKeyboardPress('the todo input', { keyName: 'Enter' });
await agent.aiKeyboardPress('the text editor', { keyName: 'Tab' });
await agent.aiKeyboardPress('the selected item', { keyName: 'Escape' });
```

> **注意**：键盘组合键（如 Ctrl+A）目前**不支持**。如果需要组合键操作，应回退到 Playwright 原生：`await page.keyboard.press('Control+a')`。

### 2.1.4 `aiScroll(locate, options)` — 滚动

```typescript
// 在指定元素上滚动
await agent.aiScroll('the todo list', {
  direction: 'down',    // 'up' | 'down' | 'left' | 'right'
  scrollType: 'once',   // 'once' | 'untilBottom' | 'untilTop' | 'untilLeft' | 'untilRight'
  distance: 300,         // 像素距离（可选）
});

// 滚动到底部
await agent.aiScroll('the page', {
  scrollType: 'untilBottom',
});
```

### 2.1.5 `aiAct(prompt)` — 自动规划

Auto Planning 模式，将复杂操作交给 VLM 自主规划：

```typescript
// VLM 会自动拆解为：定位输入框 → 输入文本 → 按回车 → 重复三次
await agent.aiAct('Add three todo items: "Buy milk", "Read book", "Exercise"');

// 带条件的复杂操作
await agent.aiAct('Click each uncompleted todo item one by one and mark them as done');
```

**关键配置**：
- `replanningCycleLimit`：最大规划循环数，默认 20（UI-TARS 模型默认 40）
- `aiActContext`：为 VLM 提供背景知识，帮助规划

```typescript
const agent = new PlaywrightAgent(page, {
  aiActContext: '这是一个中文界面的待办应用，所有按钮文案是中文',
  replanningCycleLimit: 10,
});
```

---

## 2.2 Data Extraction API — 数据提取体系

数据提取 API 负责"从页面读取信息"，是 Midscene 相比传统方案最具差异化的能力之一。

### 2.2.1 `aiQuery<T>(dataDemand)` — 结构化数据提取

这是最强大的数据提取方法。你用类型描述的方式告诉 VLM 你想要什么数据：

```typescript
// 提取简单数组
const todoTexts = await agent.aiQuery<string[]>(
  'string[], all todo item texts displayed on the page'
);
// 结果: ["Buy groceries", "Learn Midscene"]

// 提取结构化对象数组
interface TodoItem {
  text: string;
  completed: boolean;
}
const todos = await agent.aiQuery<TodoItem[]>(
  '{text: string, completed: boolean}[], all todo items with their completion status'
);
// 结果: [{text: "Buy groceries", completed: true}, {text: "Learn Midscene", completed: false}]

// 提取单个对象
const stats = await agent.aiQuery<{ total: number; active: number; completed: number }>(
  '{total: number, active: number, completed: number}, the todo statistics from the footer'
);
```

**高级选项**：

```typescript
// 启用 DOM 辅助（提高文本提取准确性）
const data = await agent.aiQuery<string[]>(
  'string[], all todo texts',
  { domIncluded: true }
);

// 禁用截图（纯 DOM 提取，速度更快但精度可能降低）
const data = await agent.aiQuery<string[]>(
  'string[], all todo texts',
  { domIncluded: true, screenshotIncluded: false }
);
```

### 2.2.2 快捷提取方法

除了通用的 `aiQuery`，Midscene 提供了类型化的快捷方法：

```typescript
// aiBoolean — 返回布尔值
const hasItems = await agent.aiBoolean('are there any todo items on the page?');
// true

// aiNumber — 返回数字
const count = await agent.aiNumber('how many active (uncompleted) todo items are there?');
// 2

// aiString — 返回字符串
const footerText = await agent.aiString('what does the todo counter say?');
// "2 items left"

// aiAsk — 通用问答，返回字符串
const answer = await agent.aiAsk('what is the current filter mode? (All, Active, or Completed)');
// "All"
```

### 2.2.3 提取 vs 断言：何时用哪个？

| 场景 | 用 `aiQuery`/`aiString` 等 | 用 `aiAssert` |
|------|---------------------------|---------------|
| 需要拿到具体值做后续计算 | ✅ | ❌ |
| 只需要验证某个条件为真 | ❌ | ✅ |
| 验证失败时需要具体的期望值 vs 实际值 | ✅ 先提取再用 `expect` 断言 | ❌ 只能知道断言失败 |
| 简洁性优先 | ❌ | ✅ |

```typescript
// 方式1：提取 + 传统断言（更精确的错误信息）
const count = await agent.aiNumber('how many todos are shown?');
expect(count).toBe(3); // 错误信息: Expected 3, received 2

// 方式2：视觉断言（更简洁但错误信息较模糊）
await agent.aiAssert('there are exactly 3 todo items'); // 错误信息: Assertion failed
```

---

## 2.3 Utility API — 工具体系

### 2.3.1 `aiAssert(assertion, errorMsg?)` — 视觉断言

```typescript
// 基础断言
await agent.aiAssert('the page title contains "TodoMVC"');

// 带自定义错误消息
await agent.aiAssert(
  'the completed items have a strikethrough style',
  'Completed todos should show strikethrough text decoration'
);
```

断言失败时会抛出异常，中断测试执行。

### 2.3.2 `aiLocate(locate)` — 元素定位

返回元素的位置信息，不执行任何操作：

```typescript
const location = await agent.aiLocate('the "Clear completed" button');
console.log(location);
// { rect: { x: 450, y: 520, width: 120, height: 30 }, center: { x: 510, y: 535 }, dpr: 2 }
```

适用场景：需要获取元素坐标做自定义操作，或验证元素位置关系。

### 2.3.3 `aiWaitFor(assertion, options?)` — 等待条件

```typescript
// 默认超时 15 秒，每 3 秒检查一次
await agent.aiWaitFor('the todo list has finished loading');

// 自定义超时和检查间隔
await agent.aiWaitFor('search results appear on the page', {
  timeoutMs: 30000,    // 最多等 30 秒
  checkIntervalMs: 2000, // 每 2 秒检查一次
});
```

### 2.3.4 其他实用方法

```typescript
// 冻结页面快照（批量查询时避免重复截图，提升性能）
await agent.freezePageContext();
const title = await agent.aiString('page title');
const count = await agent.aiNumber('todo count');
await agent.unfreezePageContext();

// 执行页面内 JavaScript
const scrollTop = await agent.evaluateJavaScript('document.documentElement.scrollTop');

// 记录截图到报告（调试用）
await agent.recordToReport('After adding todos', {
  content: 'Added 3 items, about to verify count',
});

// 设置/更新 aiAct 上下文
agent.setAIActContext('The app is now in dark mode, buttons may have different colors');
```

---

## 2.4 Playwright 集成方式

Midscene 与 Playwright 有两种集成模式：

### 模式一：直接脚本集成

适合独立脚本、快速原型：

```typescript
import { chromium } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://todomvc.com/examples/react/dist/');

const agent = new PlaywrightAgent(page, {
  generateReport: true,
  cache: { id: 'todomvc-test', strategy: 'read-write' },
});

// 使用 agent 的 AI 方法
await agent.aiTap('...');

// 也可以直接使用 page 的 Playwright 原生方法
await page.waitForTimeout(1000);

await browser.close();
```

### 模式二：Playwright Test 集成

适合正式测试套件，与 Playwright Test Runner 深度集成：

**`playwright.config.ts`**：

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90 * 1000, // Midscene 测试需要更长超时
  use: {
    baseURL: 'https://todomvc.com/examples/react/dist/',
    viewport: { width: 1280, height: 720 },
  },
  reporter: [
    ['list'],
    ['@midscene/web/playwright-reporter', { type: 'merged' }],
  ],
});
```

**`e2e/fixture.ts`**：

```typescript
import { test as base } from '@playwright/test';
import type { PlayWrightAiFixtureType } from '@midscene/web/playwright';
import { PlaywrightAiFixture } from '@midscene/web/playwright';

export const test = base.extend<PlayWrightAiFixtureType>(
  PlaywrightAiFixture({ waitForNetworkIdleTimeout: 2000 })
);

export { expect } from '@playwright/test';
```

**`e2e/todomvc.spec.ts`**：

```typescript
import { test, expect } from './fixture';

test('can add and complete todos', async ({
  page,
  ai,
  aiInput,
  aiTap,
  aiQuery,
  aiAssert,
  aiWaitFor,
}) => {
  await page.goto('/');

  // Midscene AI 方法与 Playwright 原生方法可以混用
  await aiInput('Learn Midscene', 'the new todo input');
  await page.keyboard.press('Enter'); // 原生 Playwright 方法

  await aiAssert('there is one todo item showing "Learn Midscene"');
});
```

注意：Fixture 方式中，`ai` 对应 `aiAct`，其余方法名与 Agent 方法一致。

---

## 2.5 实战：TodoMVC 完整测试套件

下面是一个覆盖 TodoMVC 核心功能的完整测试套件，展示三大 API 体系的综合运用。

### 项目结构

```
midscene-todomvc/
├── package.json
├── playwright.config.ts
├── .env                      # VLM 配置
└── e2e/
    ├── fixture.ts
    └── todomvc.spec.ts
```

### `e2e/todomvc.spec.ts`

```typescript
import { test, expect } from './fixture';

test.describe('TodoMVC E2E with Midscene', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  // ========== 创建待办 ==========

  test('should add a new todo item', async ({ aiInput, aiTap, aiAssert, aiQuery }) => {
    await aiInput('Buy groceries', 'the new todo input field');
    await aiTap('the new todo input field'); // 确保焦点
    await page.keyboard.press('Enter');

    await aiAssert('there is exactly one todo item on the list');

    const todos = await aiQuery<string[]>('string[], all visible todo item texts');
    expect(todos).toEqual(['Buy groceries']);
  });

  test('should add multiple todos', async ({ page, aiInput, aiQuery }) => {
    const items = ['Buy groceries', 'Cook dinner', 'Do laundry'];

    for (const item of items) {
      await aiInput(item, 'the new todo input field');
      await page.keyboard.press('Enter');
    }

    const todos = await aiQuery<string[]>('string[], all visible todo item texts');
    expect(todos).toHaveLength(3);
    expect(todos).toEqual(items);
  });

  // ========== 完成/取消完成 ==========

  test('should toggle todo completion', async ({ page, aiInput, aiTap, aiAssert, aiNumber }) => {
    // 添加两个待办
    await aiInput('Task A', 'the new todo input field');
    await page.keyboard.press('Enter');
    await aiInput('Task B', 'the new todo input field');
    await page.keyboard.press('Enter');

    // 完成 Task A
    await aiTap('the checkbox next to "Task A"');

    // 验证状态
    await aiAssert('"Task A" appears completed (strikethrough or different style)');
    await aiAssert('"Task B" does not appear completed');

    const activeCount = await aiNumber('the number shown in the items-left counter');
    expect(activeCount).toBe(1);
  });

  test('should toggle all todos at once', async ({ page, aiInput, aiTap, aiAssert }) => {
    await aiInput('Task 1', 'the new todo input');
    await page.keyboard.press('Enter');
    await aiInput('Task 2', 'the new todo input');
    await page.keyboard.press('Enter');

    // 点击 "toggle all" 控件
    await aiTap('the toggle-all checkbox or arrow to mark all as complete');

    await aiAssert('all todo items appear completed');
  });

  // ========== 过滤 ==========

  test('should filter by active/completed', async ({ page, aiInput, aiTap, aiAssert, aiQuery }) => {
    // 准备数据
    await aiInput('Active task', 'the new todo input');
    await page.keyboard.press('Enter');
    await aiInput('Done task', 'the new todo input');
    await page.keyboard.press('Enter');
    await aiTap('the checkbox next to "Done task"');

    // 过滤：Active
    await aiTap('the "Active" filter link');
    const activeOnly = await aiQuery<string[]>('string[], all visible todo item texts');
    expect(activeOnly).toEqual(['Active task']);

    // 过滤：Completed
    await aiTap('the "Completed" filter link');
    const completedOnly = await aiQuery<string[]>('string[], all visible todo item texts');
    expect(completedOnly).toEqual(['Done task']);

    // 过滤：All
    await aiTap('the "All" filter link');
    const all = await aiQuery<string[]>('string[], all visible todo item texts');
    expect(all).toHaveLength(2);
  });

  // ========== 删除 ==========

  test('should delete a todo item', async ({ page, aiInput, aiTap, aiAssert, aiHover }) => {
    await aiInput('To be deleted', 'the new todo input');
    await page.keyboard.press('Enter');

    // 悬停以显示删除按钮（TodoMVC 的删除按钮在 hover 时才显示）
    await aiHover('the todo item "To be deleted"');
    await aiTap('the delete button (×) on "To be deleted"');

    await aiAssert('there are no todo items on the page');
  });

  test('should clear all completed todos', async ({ page, aiInput, aiTap, aiAssert }) => {
    await aiInput('Keep this', 'the new todo input');
    await page.keyboard.press('Enter');
    await aiInput('Remove this', 'the new todo input');
    await page.keyboard.press('Enter');

    await aiTap('the checkbox next to "Remove this"');
    await aiTap('the "Clear completed" button');

    await aiAssert('only "Keep this" remains in the todo list');
  });

  // ========== 编辑 ==========

  test('should edit a todo by double-clicking', async ({ page, ai, aiInput, aiAssert }) => {
    await aiInput('Original text', 'the new todo input');
    await page.keyboard.press('Enter');

    // 双击进入编辑模式
    await ai('double-click on the todo item text "Original text" to enter edit mode');

    // 清空并输入新文本
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Edited text');
    await page.keyboard.press('Enter');

    await aiAssert('the todo item now shows "Edited text" instead of "Original text"');
  });

  // ========== 数据提取综合 ==========

  test('should extract structured data from todo list', async ({ page, aiInput, aiTap, aiQuery }) => {
    // 创建多个待办并完成部分
    const items = ['Buy milk', 'Read book', 'Exercise', 'Clean house'];
    for (const item of items) {
      await aiInput(item, 'the new todo input');
      await page.keyboard.press('Enter');
    }
    await aiTap('the checkbox next to "Buy milk"');
    await aiTap('the checkbox next to "Exercise"');

    // 结构化提取
    interface TodoData {
      text: string;
      completed: boolean;
    }
    const todos = await aiQuery<TodoData[]>(
      '{text: string, completed: boolean}[], all todo items with their text and completion status'
    );

    expect(todos).toHaveLength(4);

    const completed = todos.filter(t => t.completed);
    expect(completed.map(t => t.text)).toEqual(
      expect.arrayContaining(['Buy milk', 'Exercise'])
    );

    const active = todos.filter(t => !t.completed);
    expect(active).toHaveLength(2);
  });
});
```

### 运行测试

```bash
# 运行全部测试（有头模式，方便观察）
npx playwright test --headed

# 运行单个测试
npx playwright test -g "should add a new todo item" --headed

# 无头模式运行（CI 场景）
npx playwright test
```

运行完成后，在 `midscene_run/report/` 下查看合并后的 HTML 可视化报告。

---

## 2.6 API 选择速查表

| 你想做什么 | 使用方法 | 类别 |
|-----------|---------|------|
| 点击某个元素 | `aiTap` | Interaction |
| 在输入框输入文字 | `aiInput` | Interaction |
| 按键盘按键 | `aiKeyboardPress` | Interaction |
| 滚动页面/元素 | `aiScroll` | Interaction |
| 悬停在元素上 | `aiHover` | Interaction |
| 执行复杂多步操作 | `aiAct` / `ai` | Interaction |
| 提取结构化数据 | `aiQuery` | Data Extraction |
| 判断是/否 | `aiBoolean` | Data Extraction |
| 获取一个数字 | `aiNumber` | Data Extraction |
| 获取一段文字 | `aiString` | Data Extraction |
| 通用问答 | `aiAsk` | Data Extraction |
| 验证页面状态 | `aiAssert` | Utility |
| 获取元素位置 | `aiLocate` | Utility |
| 等待某个条件 | `aiWaitFor` | Utility |
| 执行 YAML 脚本 | `runYaml` | Utility |

---

## 思考题

### Q1：在 TodoMVC 测试中，"删除待办"需要先 hover 再点击删除按钮。如果不用 `aiHover`，直接 `aiTap` 删除按钮会怎样？

**答案**：

TodoMVC 的 UI 设计是：删除按钮（×）只在鼠标悬停在待办项上时才显示。如果直接 `aiTap('the delete button')` 而不先 hover：

1. Midscene 截取当前页面截图
2. 截图中删除按钮**不可见**（CSS `display: none` 或 `opacity: 0`）
3. VLM 在截图中找不到删除按钮
4. 操作失败，抛出定位异常

这揭示了视觉驱动方案的一个核心特性：**Midscene 只能操作视觉上可见的元素**。DOM 中存在但视觉上不可见的元素（隐藏的、透明的、在视口之外的）无法被定位。

解决方案：
```typescript
// 先 hover 使按钮显示，再点击
await agent.aiHover('the todo item "To be deleted"');
await agent.aiTap('the delete button (×) on "To be deleted"');
```

或者用 `aiAct` 自动规划：
```typescript
await agent.aiAct('hover over "To be deleted" and click its delete button');
```

### Q2：`aiQuery` 提取数据时，`domIncluded: true` 和默认的纯截图模式有什么区别？什么场景下该用哪个？

**答案**：

| 模式 | 信息来源 | 文本准确性 | 速度 | Token 消耗 |
|------|---------|-----------|------|-----------|
| 默认（纯截图） | 仅页面截图 | 依赖 VLM OCR 能力 | 较快 | 较低 |
| `domIncluded: true` | 截图 + DOM 文本 | 精确（直接读 DOM） | 稍慢 | 稍高 |

**选择策略**：
- **需要精确文本**（价格、ID、链接等）：用 `domIncluded: true`，因为 VLM 的 OCR 可能把 `$19.99` 读成 `$19.98`
- **需要理解视觉布局**（元素位置关系、颜色、图标含义）：用默认纯截图
- **混合场景**：默认就好，`domIncluded: true` 是在精确性要求高时的保险选项

```typescript
// 提取价格信息 — 建议开启 DOM 辅助
const prices = await agent.aiQuery<number[]>(
  'number[], all product prices',
  { domIncluded: true }
);

// 判断布局关系 — 纯截图就够了
const layout = await agent.aiQuery<{ position: string }>(
  '{position: string}, where is the search box relative to the logo'
);
```

### Q3：`freezePageContext()` 和 `unfreezePageContext()` 的实际价值在哪里？不用它们会怎样？

**答案**：

每次调用 AI 方法时，Midscene 都会：
1. 截取一张当前页面的截图
2. 将截图发送给 VLM

如果你连续调用多个 `aiQuery`/`aiString`/`aiBoolean`：
```typescript
const title = await agent.aiString('page title');        // 截图1 + VLM调用
const count = await agent.aiNumber('item count');         // 截图2 + VLM调用
const hasFooter = await agent.aiBoolean('footer exists'); // 截图3 + VLM调用
```

三次截图 + 三次 VLM 调用，而页面状态并没有变化。

使用 `freezePageContext()`：
```typescript
await agent.freezePageContext();
const title = await agent.aiString('page title');        // 共用截图1
const count = await agent.aiNumber('item count');         // 共用截图1
const hasFooter = await agent.aiBoolean('footer exists'); // 共用截图1
await agent.unfreezePageContext();
```

只截一次图，三次 VLM 调用共用同一张截图。**减少截图开销，保证数据一致性**。

但要注意：如果在 freeze 期间页面发生了变化（动画、异步加载），AI 看到的仍然是冻结时的旧截图。所以只在"确认页面不会变"时使用。
