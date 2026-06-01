---
title: 扩展 Skill 设计：PRD Review / Bug Fix / Change Request
date: 2026-06-01
course: SDD开发
---

# 3.1 扩展 Skill 设计：PRD Review / Bug Fix / Change Request

> spec-kit 的核心五层（Constitution → Spec → Plan → Tasks → Implement）覆盖了"从意图到代码"的完整路径。但在真实开发场景中，还有三个关键环节没有被覆盖：**需求澄清**（在 Spec 前）、**Bug 修复**（在 Implement 后）、**需求变更**（在任意阶段）。本节设计三个扩展 Skill，补齐这些环节。

---

## 概览：三个 Skill 的定位

```
                    ┌─────────────────────────────────┐
                    │   PRD Review (需求澄清 Skill)    │
                    │   在 Spec 之前，发现 PRD 问题   │
                    └────────────┬────────────────────┘
                                 │ 修正后的 PRD
                                 ↓
    ┌─────────────────────────────────────────────────────────────┐
    │              原有五层：Constitution → Spec → Plan → Tasks    │
    └─────────────────────────────────────────────────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
         ↓                       ↓                       ↓
┌──────────────┐      ┌──────────────────┐    ┌──────────────────┐
│ Bug Fix      │      │ Change Request   │    │  (任意阶段都可能)│
│ (问题修复)    │      │ (需求变更)       │    │                  │
│ Implement 后 │      │ 任意阶段         │    │                  │
└──────────────┘      └──────────────────┘    └──────────────────┘
```

**设计原则**：这三个 Skill 不改变核心五层的结构，而是在其前后或旁路提供**辅助决策**和**变更管理**能力。

---

## Skill 1：PRD Review（需求澄清 Skill）

### 目标

在 SDD 流程启动前，系统化地发现 PRD 中的潜在问题，避免"带着问题做需求"。

**触发时机**：PM 提交 PRD 后、开发开始前（在 `/speckit.specify` 之前）

**输入**：PRD 文档（可以是任何格式）
**输出**：结构化的问题清单 + 改进建议

---

### 命令接口

```bash
/speckit.prd-review <prd-path> [选项]
```

**选项**：
- `--focus <area>`: 指定检查重点（completeness / consistency / testability / edge-cases / dependencies / all）
- `--severity <level>`: 指定问题严重级别（critical / high / medium / low / all）
- `--template <type>`: PRD 模板类型（default / lean / detailed）

---

### 检查维度

#### 1. 需求完整性（Completeness）

**检查内容**：
- 用户故事是否覆盖所有目标用户角色？
- 是否有缺失的核心交互场景？
- 是否遗漏了关键的反向操作（如"添加"后有"删除"，"收藏"后有"取消收藏"）？

**典型问题模式**：
```markdown
## ❌ 缺失的用户故事

**问题**：PRD 描述了"用户可以收藏文章"，但没有描述"用户查看收藏列表"的场景。

**影响**：根据 Spec 生成的 Plan 可能遗漏 /bookmarks 页面和数据查询接口。

**建议补充**：
### User Story 3 - View Bookmarks Page (Priority: P2)
用户可以在专属页面查看所有收藏的文章。
**Acceptance Scenarios**：
1. Given 已登录用户有3篇收藏，When 访问 /bookmarks，Then 看到3篇文章...
```

#### 2. 需求一致性（Consistency）

**检查内容**：
- 同一术语在不同位置的描述是否一致？
- 是否有矛盾的验收场景？
- 状态机是否完整（如订单状态：待支付 → 已支付 → 发货 → 完成，是否每个状态都有转换路径）？

**典型问题模式**：
```markdown
## ❌ 矛盾的验收场景

**问题**：US1 要求"未登录用户点击收藏应跳转登录页"，但 US3 要求"游客可以临时收藏，登录后同步"。

**影响**：实现时无法同时满足两个场景，需要与 PM 确认优先级。

**建议澄清**：
请确认产品意图：
- 选项A：严格登录模式（未登录点击 → 跳转登录）
- 选项B：临时收藏模式（未登录点击 → 本地存储，登录后同步）
```

#### 3. 需求可测性（Testability）

**检查内容**：
- 每个 User Story 是否有明确的 Acceptance Scenarios？
- 验收标准是否可观察/可验证？
- 是否有主观/模糊的描述（如"体验流畅"、"界面美观"）？

**典型问题模式**：
```markdown
## ⚠️ 不可验证的验收标准

**问题**：Success Criteria 包含"页面加载体验流畅"。

**影响**：AI 无法将此转化为测试用例，无法验证实现是否达标。

**建议量化**：
### SC-003: /bookmarks 页面首屏加载时间 < 1.5s（3G 网络）
### SC-004: 书签切换操作响应时间 < 200ms（乐观更新）
```

#### 4. 边界条件（Edge Cases）

**检查内容**：
- 是否考虑了零数据状态（空列表、无权限）？
- 是否考虑了并发冲突（多标签页操作、网络延迟）？
- 是否考虑了数据一致性（关联数据被删除后的处理）？

**典型问题模式**：
```markdown
## ⚠️ 缺失的边界场景

**问题**：PRD 没有说明"文章被删除后，对应的书签记录如何处理"。

**建议补充**：
### Edge Cases
- **E001**: 文章被删除后，用户收藏列表中的该书签如何处理？
  - 选项A：级联删除书签记录（ON DELETE CASCADE）
  - 选项B：保留书签，访问时显示"文章已删除"
  - 选项C：软删除文章，书签保持可见但标记为不可用
```

#### 5. 依赖关系（Dependencies）

**检查内容**：
- 是否明确了外部依赖（认证系统、支付网关、第三方 API）？
- 是否有假设但没有验证的内容（如"假设用户系统已有标签功能"）？
- 依赖的稳定性如何评估？

**典型问题模式**：
```markdown
## ⚠️ 未验证的依赖假设

**问题**：PRD 提到"用户标签系统已存在"，但项目中未找到相关实现。

**建议澄清**：
### Dependencies
- **D001**: 用户标签系统
  - 当前状态：❓ 未确认
  - 验证方式：请确认是否需要本功能包含标签表的创建
  - 影响范围：如果不存在，data-model 需要新增 tags 表和 user_tags 关联表
```

---

### 输出格式

PRD Review 生成 `specs/<feature-name>/prd-review.md`：

```markdown
# PRD Review: Bookmark Articles

**Reviewed**: 2026-06-01
**Reviewer**: AI Agent (spec-kit/prd-review)
**Severity Summary**: 0 Critical | 2 High | 3 Medium | 1 Low

---

## 🔴 Critical Issues (阻塞开发，必须解决)

*(如果发现 Critical 问题，强烈建议在开始 `/speckit.specify` 前与 PM 对齐)*

---

## 🟠 High Priority Issues (高优先级，建议优先解决)

### H-001: 缺失用户故事 - 查看收藏列表

**Location**: User Stories 章节
**Impact**: Plan 层可能遗漏 /bookmarks 页面和 GET /api/bookmarks 端点

**Current State**:
- ✅ US1: Toggle Bookmark
- ❌ 缺失: View Bookmarks Page

**Recommended Addition**:
```markdown
### User Story 2 - View Bookmarks Page (Priority: P2)
用户可以在专属页面查看所有收藏的文章。
**Acceptance Scenarios**：
1. Given 已登录用户有3篇收藏，When 访问 /bookmarks，Then 看到3篇文章...
```

---

### H-002: 矛盾的未登录处理

**Location**: US1 vs US3
**Impact**: 实现时无法同时满足两个场景

**Conflict Details**:
- US1 要求：未登录点击 → 跳转登录页
- US3 要求：未登录点击 → 临时收藏，登录后同步

**Clarification Needed**: 请确认产品意图（选项A/B）

---

## 🟡 Medium Priority Issues (中等优先级，建议在 Plan 阶段考虑)

### M-001: 缺少边界场景描述

**Current State**: 未说明"文章删除后书签如何处理"

**Recommendation**: 补充 Edge Cases 章节，明确级联删除策略

### M-002: 验收标准不可验证

**Current State**: SC-003 "页面加载体验流畅"

**Recommendation**: 量化为具体性能指标（如 < 1.5s）

### M-003: 依赖假设未验证

**Current State**: 假设"用户标签系统已存在"，但未确认

**Recommendation**: 请与后端团队确认标签系统状态，或在 Plan 中包含标签表创建

---

## 🟢 Low Priority Issues (低优先级，可选优化)

### L-001: 术语不统一

**Current State**: "收藏"/"书签"/"bookmark" 混用

**Recommendation**: 统一术语（建议使用"收藏"/"bookmark"）

---

## ✅ Passed Checks

- ✅ 所有 User Story 都有 Given/When/Then 格式的 Acceptance Scenarios
- ✅ Key Entities 章节完整
- ✅ 明确了优先级（P1/P2）

---

## Next Steps

1. **立即行动**：解决 High Priority 问题（H-001/H-002）
2. **Plan 阶段前**：确认 Medium Priority 问题的处理方式
3. **可选**：统一术语（L-001）

**阻塞判断**：当前 PRD 有 2 个 High Priority 问题，建议修复后再执行 `/speckit.specify`。
```

---

### 与核心五层的集成

```
PM 提交 PRD
    ↓
/speckit.prd-review (生成 prd-review.md)
    ↓
根据 Review 结果修改 PRD
    ↓
/speckit.specify (基于修正后的 PRD 生成 Spec)
    ↓
... (原有流程)
```

**价值**：在意图进入技术翻译前，确保意图本身的质量。这避免了"在错误的方向上走得很快"。

---

## Skill 2：Bug Fix（问题修复 Skill）

### 目标

为 Bug 修复提供与 SDD 核心流程同等的**可追溯性**和**结构化文档**。不要让 Bug 修复成为"打补丁的黑洞"。

**触发时机**：测试/生产发现 Bug 后
**输入**：Bug 报告
**输出**：Bug 分析 + 修复方案 + 验证计划

---

### 命令接口

```bash
/speckit.bug-fix <bug-id> [选项]
```

**选项**：
- `--type <category>`: Bug 类型（logic / ui / performance / security / data / integration）
- `--severity <level>`: 严重级别（critical / high / medium / low）
- `--source <stage>`: Bug 来源（unit-test / integration-test / qa / production / user-report）

---

### 工作流程

#### 阶段 1：Bug Report 完整性检查

```markdown
## Bug Report Checklist

- [ ] Bug ID 和简短描述
- [ ] 复现步骤（Given/When/Then 格式）
- [ ] 预期行为 vs 实际行为
- [ ] 环境信息（浏览器/OS/设备）
- [ ] 严重级别（P0-阻塞 / P1-高 / P2-中 / P3-低）
- [ ] 截图/录屏（UI Bug 必需）
- [ ] 日志/错误信息（如果有）
```

如果 Bug Report 不完整，Skill 会生成**信息补充请求**：

```markdown
## ⚠️ Bug Report 信息不足

**缺失信息**：
1. 复现步骤（当前只有"登录失败"的描述，没有具体操作）
2. 预期行为（未说明"登录后应该跳转到哪里"）

**请补充以下信息**：
- 请提供完整的复现步骤（Given/When/Then 格式）
- 请说明预期行为

**模板**：
```
Given: 用户在登录页面，输入正确邮箱和密码
When: 点击登录按钮
Then: 预期跳转到首页，实际停留在登录页并显示"网络错误"
```
```

#### 阶段 2：根因分析（Root Cause Analysis）

生成 `specs/bugs/<bug-id>/root-cause.md`：

```markdown
# Root Cause Analysis: BUG-001

**Bug**: 用户在两个标签页同时取消收藏后，另一个标签页状态不同步

---

## 复现验证

✅ 已验证可稳定复现

**复现步骤**：
1. Given: 用户在标签页A收藏文章X
2. And: 用户打开标签页B（同一文章）
3. When: 在标签页B取消收藏
4. Then: 标签页A的图标仍显示"已收藏"（❌ 实际）
5. Expected: 标签页A的图标应变为"未收藏"

---

## 问题定位

### 现象
多标签页状态下，书签状态不一致。

### 直接原因
前端使用本地状态管理书签，没有跨标签页同步机制。

### 根本原因
**架构决策缺失**：Plan 层未考虑"多标签页并发"场景。

**对应文档**：
- `specs/001-bookmark-articles/plan.md` → Architecture Decision 章节
- 该章节讨论了"乐观更新"，但未讨论"多标签页状态同步"

---

## 分类

| 维度 | 分类 |
|------|------|
| 类型 | Logic / Data Race |
| 来源 | QA 测试 |
| 严重级别 | P1（高） |
| 影响范围 | 前端 BookmarkButton 组件 |

---

## 相关代码

**文件**: `frontend/src/components/BookmarkButton.tsx:42-58`

```typescript
// 当前实现：只更新本地 state
const handleToggle = async () => {
  const newState = !bookmarked;
  setBookmarked(newState); // ❌ 不跨标签页
  await api.toggleBookmark(articleId);
};
```

---

## 修复策略

### 选项 A：BroadcastChannel API（推荐）

**方案**: 使用 BroadcastChannel 在标签页间通信

**优点**:
- 原生 API，无需依赖
- 性能好，延迟低
- 可以传递完整事件数据

**缺点**:
- 需要处理连接/断开逻辑
- 不支持跨浏览器（同源限制）

**复杂度**: 中等

---

### 选项 B：轮询服务器状态

**方案**: 每次标签页 focus 时查询书签状态

**优点**:
- 实现简单
- 自然处理跨标签页
- 状态始终与服务器一致

**缺点**:
- 增加服务器负载
- 延迟较高
- 不实时

**复杂度**: 低

---

### 选项 C：localStorage 事件监听

**方案**: 监听 'storage' 事件

**优点**:
- 原生支持
- 兼容性好

**缺点**:
- 只在同源不同页面触发
- 事件触发时机不稳定
- 需要序列化/反序列化数据

**复杂度**: 中等

---

## 推荐方案

**选项 A（BroadcastChannel）**

**理由**:
1. 性能最优，用户体验最佳
2. 符合 SC-001（< 200ms 响应）要求
3. 与现有"乐观更新"架构一致
4. 复杂度可控（约 50 行代码）

**风险评估**:
- 低风险：原生 API，向后兼容
- 边界情况：标签页关闭时需要清理 channel

---

## 修复范围

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `BookmarkButton.tsx` | 修改 | 添加 BroadcastChannel 逻辑 |
| `bookmarkApi.ts` | 不变 | 无需修改 |
| 相关测试 | 新增 | 跨标签页同步测试 |

---

## 验证计划

### V1: 单标签页功能回归
- Given: 单标签页，When 切换收藏，Then 状态正确更新

### V2: 双标签页同步
- Given: 两个标签页打开同一文章，When 标签页B切换收藏，Then 标签页A同步更新

### V3: 多标签页并发
- Given: 三个标签页，当标签页A/B/C 同时切换，Then 最终状态一致

### V4: 边界 - 标签页关闭
- Given: 两个标签页，When 标签页B关闭后标签页A切换，Then 无错误抛出
```

#### 阶段 3：修复执行

生成 `specs/bugs/<bug-id>/fix-plan.md`：

```markdown
# Fix Plan: BUG-001

**Strategy**: 选项 A - BroadcastChannel API
**Estimated Complexity**: 中等（~50行代码）
**Breaking Changes**: 无

---

## Implementation Tasks

### Phase 1: 建立 BroadcastChannel 通信

- [ ] F001: 创建 channelName 常量（格式: `bookmark-toggle-{articleId}`）
- [ ] F002: 在 BookmarkButton mount 时订阅 channel
- [ ] F003: 在 BookmarkButton unmount 时取消订阅

### Phase 2: 实现消息收发

- [ ] F004: 点击时发送消息 { type: 'TOGGLE', articleId, newState: true/false }
- [ ] F005: 接收消息时更新本地 state

### Phase 3: 测试

- [ ] F006: 单元测试 - 消息发送
- [ ] F007: 集成测试 - 跨标签页同步（需要 Playwright multi-page context）

---

## Code Changes Preview

**文件**: `frontend/src/components/BookmarkButton.tsx`

```diff
+ const CHANNEL_NAME = `bookmark-toggle-${articleId}`;

  const BookmarkButton = ({ articleId, initialBookmarked }) => {
    const [bookmarked, setBookmarked] = useState(initialBookmarked);

+   useEffect(() => {
+     const channel = new BroadcastChannel(CHANNEL_NAME);
+
+     const handleMessage = (event) => {
+       if (event.data.type === 'TOGGLE' && event.data.articleId === articleId) {
+         setBookmarked(event.data.newState);
+       }
+     };
+
+     channel.addEventListener('message', handleMessage);
+
+     return () => {
+       channel.removeEventListener('message', handleMessage);
+       channel.close();
+     };
+   }, [articleId]);

    const handleToggle = async () => {
      const newState = !bookmarked;
      setBookmarked(newState);
+     // 通知其他标签页
+     const channel = new BroadcastChannel(CHANNEL_NAME);
+     channel.postMessage({ type: 'TOGGLE', articleId, newState });
+     channel.close();

      await api.toggleBookmark(articleId);
    };

    // ... rest
  };
```

---

## Rollback Plan

如果修复引入新问题：
1. Revert commit
2. 临时方案：在页面 focus 时轮询服务器状态（选项 B）

**Rollback 命令**:
```bash
git revert <fix-commit-hash>
```

---

## 手动验证步骤

1. 打开文章页（标签页A）
2. 收藏文章（标签页A）
3. 打开同一文章（标签页B，Ctrl+Click 或 Cmd+Click）
4. 在标签页B取消收藏
5. 切换回标签页A
6. **验证**：标签页A的图标应显示"未收藏"

---

## 自动化测试

**新文件**: `frontend/tests/integration/bookmark-cross-tab.test.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Bookmark cross-tab sync', () => {
  test('should sync bookmark state across tabs', async ({ browser }) => {
    // 创建两个 context（模拟两个标签页）
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // 导航到同一文章
    await page1.goto('/articles/article-123');
    await page2.goto('/articles/article-123');

    // 在 page1 收藏
    await page1.click('[data-testid="bookmark-button"]');
    await expect(page1.locator('[data-testid="bookmark-icon"]'))
      .toHaveAttribute('data-state', 'bookmarked');

    // 在 page2 验证状态
    await expect(page2.locator('[data-testid="bookmark-icon"]'))
      .toHaveAttribute('data-state', 'bookmarked', { timeout: 2000 });

    // 在 page2 取消收藏
    await page2.click('[data-testid="bookmark-button"]');

    // 在 page1 验证状态
    await expect(page1.locator('[data-testid="bookmark-icon"]'))
      .toHaveAttribute('data-state', 'unbookmarked', { timeout: 2000 });
  });
});
```
```

#### 阶段 4：文档更新

修复完成后，更新原始 Spec/Plan 文档，确保未来不会出现同样问题：

```markdown
# 更新 specs/001-bookmark-articles/spec.md

## Edge Cases

+ - **E003**: 多标签页并发操作
+   Given 用户在两个标签页打开同一文章，When 在标签页B切换收藏，Then 标签页A的状态应同步更新
```

```markdown
# 更新 specs/001-bookmark-articles/plan.md

## Architecture Decisions

+ ### Decision 3: 跨标签页状态同步（BroadcastChannel）
+ **选择原因**: SC-001 要求 < 200ms 响应，轮询方案延迟过高。
+ **风险**: 需要处理标签页关闭时的清理逻辑。
+ **实现**: 使用 BroadcastChannel API，每个文章 ID 独立 channel。
```

---

### 与核心五层的集成

```
Bug Report
    ↓
/speckit.bug-fix (生成 root-cause.md + fix-plan.md)
    ↓
执行修复（遵循 Implement 层的验证标准）
    ↓
更新原始 Spec/Plan（防止同类 Bug 再次出现）
    ↓
/speckit.implement (可选：如果修复需要重新生成部分代码)
```

**价值**：Bug 修复不再是"打补丁"，而是：
1. 可追溯（每个 Bug 都有文档）
2. 可验证（有明确的验证计划）
3. 可学习（修复后更新原始文档，防止重犯）

---

## Skill 3：Change Request（需求变更 Skill）

### 目标

为需求变更提供**结构化的影响分析**和**变更路径**。避免"直接改代码"导致的文档-代码不一致。

**触发时机**：产品功能变更、技术栈调整、架构重构
**输入**：变更描述
**输出**：影响分析 + 变更路径

---

### 命令接口

```bash
/speckit.change-request <change-id> [选项]
```

**选项**：
- `--type <category>`: 变更类型（feature-add / feature-remove / feature-modify / tech-stack / refactor / security）
- `--urgency <level>`: 紧急程度（immediate / soon / scheduled）
- `--impact-scope <level>`: 影响范围（single-spec / multi-spec / constitution）

---

### 变更类型与路径

#### 类型 1：功能增量（Feature Add）

**场景**：在现有功能上增加新用户故事

**变更路径**：
```
变更描述
    ↓
分析影响：涉及哪些 Spec？是否需要新的数据表？
    ↓
更新 Spec（新增 User Story）
    ↓
/speckit.plan (重新生成 Plan)
    ↓
/speckit.tasks (重新生成 Tasks)
    ↓
/speckit.implement (执行增量任务)
```

**示例**：
```markdown
# Change Request: CHANGE-001

**Type**: Feature Add
**Affected Spec**: 001-bookmark-articles

---

## 变更描述

为书签功能添加"收藏夹分类"能力：
- 用户可以创建收藏夹（如"技术文章"、"设计资源"）
- 收藏文章时可以选择收藏夹
- 用户可以查看指定收藏夹的内容

---

## 影响分析

### Spec 层变更

**新增 User Story**:
- US4: Create Bookmark Folder (Priority: P2)
- US5: Select Folder when Bookmarking (Priority: P2)
- US6: View Bookmarks by Folder (Priority: P3)

**修改 User Story**:
- US1: Toggle Bookmark - 需要增加"选择收藏夹"的交互

---

### Plan 层影响

**数据模型变更**:
- 新增表: `bookmark_folders`
- 修改表: `bookmarks` (增加 folder_id 外键)

**API 契约变更**:
- 新增: POST /api/bookmark-folders
- 新增: GET /api/bookmark-folders
- 修改: POST /api/bookmarks/toggle (增加 folderId 参数)

**前端组件**:
- 新增: BookmarkFolderSelector
- 新增: FolderListSidebar
- 修改: BookmarkButton (增加文件夹选择逻辑)

---

### Constitution 检查

✅ Type Safety: 新增类型定义
✅ Test-First: 新增测试覆盖
✅ API-First: 先实现后端 API
✅ Independent Deployability: 前后端分离

---

## 变更路径

### Step 1: 更新 Spec
```bash
# 手动编辑 specs/001-bookmark-articles/spec.md
# 在 User Stories 章节追加 US4/US5/US6
```

### Step 2: 重新生成 Plan
```bash
/speckit.plan 001-bookmark-articles
# AI 会检测到 Spec 变更，增量生成 Plan
```

### Step 3: 重新生成 Tasks
```bash
/speckit.tasks 001-bookmark-articles
# AI 会识别新增的任务，保留已完成任务的状态
```

### Step 4: 执行增量任务
```bash
/speckit.implement
# 只执行未完成的任务
```

---

## 风险评估

**兼容性风险**: 低
- 现有 bookmarks 表增加可选字段 folder_id
- 现有 API 增加可选参数，向后兼容

**数据迁移**: 需要
- SQL: ALTER TABLE bookmarks ADD COLUMN folder_id UUID REFERENCES bookmark_folders(id);
- 迁移策略: 逐步迁移，允许 folder_id 为 NULL（未分类）

**测试覆盖**: 需要
- 回归测试: 确保原有收藏功能不受影响
- 新功能测试: 收藏夹 CRUD

---

## 时间估算

- Spec 更新: 30分钟（PM + Engineer 对齐）
- Plan 重新生成: 5分钟（AI 自动）
- 数据迁移开发: 2小时
- API 开发: 4小时
- 前端开发: 6小时
- 测试: 3小时
- **总计**: 约 1-2 天
```

---

#### 类型 2：功能削减（Feature Remove）

**场景**：移除某个 User Story 或整个功能

**变更路径**：
```
变更描述
    ↓
分析影响：哪些代码可以删除？是否有外部依赖？
    ↓
更新 Spec（移除 User Story）
    ↓
/speckit.plan (重新生成 Plan，识别可删除代码)
    ↓
执行删除（含测试、文档、API）
    ↓
验证：确保没有遗漏的引用
```

**示例**：
```markdown
# Change Request: CHANGE-002

**Type**: Feature Remove
**Affected Spec**: 001-bookmark-articles

---

## 变更描述

移除"收藏文章"功能（业务调整，书签功能下线）

---

## 影响分析

### 需要删除的代码

**后端**:
- `backend/src/routes/bookmarks.ts`
- `backend/src/services/bookmarkService.ts`
- `backend/tests/integration/bookmark-*.test.ts`

**前端**:
- `frontend/src/components/BookmarkButton.tsx`
- `frontend/src/pages/BookmarksPage.tsx`
- `frontend/src/services/bookmarkApi.ts`

**数据库**:
- `bookmarks` 表（含数据）

---

### 需要移除的引用

**ArticlePage 组件**: 移除 BookmarkButton 的导入和使用
**路由配置**: 移除 /bookmarks 路由

---

### 数据迁移

**选项 A: 硬删除**
```sql
DROP TABLE bookmarks CASCADE;
```
- 风险: 数据永久丢失
- 适用: 测试环境或明确不需要保留数据

**选项 B: 软删除**
```sql
-- 保留表，但标记为废弃
COMMENT ON TABLE bookmarks IS 'DEPRECATED - Bookmarks feature removed';
```
- 风险: 占用存储
- 适用: 生产环境，可能需要数据恢复

**推荐**: 选项 B（先软删除，观察30天后再硬删除）

---

## 验证清单

- [ ] 后端代码已删除
- [ ] 前端代码已删除
- [ ] 测试文件已删除
- [ ] 路由配置已更新
- [ ] 数据库已标记废弃（或删除）
- [ ] 搜索代码库，确认没有遗漏引用
- [ ] 部署后验证: /bookmarks 返回 404
- [ ] 部署后验证: 文章页面无书签按钮

---

## 回滚计划

如果需要恢复功能：
1. 从 git 历史恢复代码文件
2. 如果选择硬删除，从数据库备份恢复 bookmarks 表
```

---

#### 类型 3：技术栈变更（Tech Stack Change）

**场景**：更换框架、数据库、或其他基础设施

**变更路径**：
```
变更描述
    ↓
Constitution 检查：变更是否违反原则？
    ↓
影响分析：哪些 Spec 会受影响？是否需要重新生成所有 Plan？
    ↓
更新 Constitution（如果原则变了）
    ↓
/speckit.plan (为受影响的 Spec 重新生成 Plan)
    ↓
迁移执行（含数据迁移、API 迁移）
```

**示例**：
```markdown
# Change Request: CHANGE-003

**Type**: Tech Stack Change
**Impact Scope**: Multi-Spec

---

## 变更描述

将数据库从 PostgreSQL 迁移到 MySQL

---

## Constitution 检查

### 受影响原则

**原则 II: Test-First**
- ✅ 不影响，测试框架不变

**原则 III: API-First**
- ✅ 不影响，API 契约保持不变

**原则 IV: Independent Deployability**
- ✅ 不影响，仍是独立部署

### 需要更新

**技术栈文档**（如果有）
- 更新数据库选型说明

---

## 影响分析

### 受影响的 Spec

| Spec | 数据表 | 迁移复杂度 |
|------|--------|-----------|
| 001-bookmark-articles | bookmarks | 低（单表，无复杂关系） |
| 002-user-auth | users, sessions | 中（有加密字段，有索引） |
| 003-article-cms | articles, tags, article_tags | 高（多表关系，有全文搜索） |

---

### 迁移路径

#### Phase 1: Schema 转换

使用工具转换 Schema：
- Prisma: 更新 `datasource` 配置
- Index: 转换 PostgreSQL 索引到 MySQL 等效语法
- Constraints: 转换外键语法

#### Phase 2: 数据迁移

使用数据迁移工具：
- 选项 A: pg_dump + 导入脚本（手动）
- 选项 B: Airbyte / Fivetran（自动化）
- 选项 C: 双写验证（先双写，验证后切换）

#### Phase 3: 重新生成 Plan

```bash
# 为每个受影响的 Spec 重新生成 Plan
/speckit.plan 001-bookmark-articles
/speckit.plan 002-user-auth
/speckit.plan 003-article-cms
```

#### Phase 4: 验证

- 数据一致性检查（行数、校验和）
- API 契约验证（确保响应不变）
- 性能基准测试（对比迁移前后）

---

## 风险评估

**数据丢失风险**: 中
- 缓解: 迁移前备份，使用事务确保原子性

**性能回退风险**: 低-中
- 缓解: 性能基准测试，必要时优化索引

**停机时间**: 视数据量而定
- 小数据量（< 10GB）: 可接受的停机窗口
- 大数据量（> 10GB）: 需要双写/灰度方案

---

## 时间估算

- Schema 转换: 4小时
- 数据迁移（测试）: 8小时
- Plan 重新生成: 1小时（AI 自动）
- 代码调整（Prisma 客户端）: 4小时
- 测试验证: 8小时
- **总计**: 约 3-5 天

---

## 回滚计划

如果迁移失败：
1. 停止 MySQL 实例
2. 启动 PostgreSQL 备份实例
3. 回滚代码到迁移前版本
4. 验证服务恢复

**回滚时间目标**: < 30 分钟
```

---

#### 类型 4：Constitution 变更

**场景**：修改项目级工程原则

**变更路径**：
```
变更描述
    ↓
影响分析：哪些现有 Spec/Plan 违反了新原则？
    ↓
更新 Constitution
    ↓
/speckit.plan (为所有受影响的 Spec 重新生成 Plan)
    ↓
代码重构（使现有代码符合新原则）
```

**示例**：
```markdown
# Change Request: CHANGE-004

**Type**: Constitution Update
**Impact Scope**: All Specs

---

## 变更描述

新增原则：**所有 API 必须有速率限制（Rate Limiting）**

---

## Constitution 更新

**新增原则 V**:
```markdown
### V. Rate Limiting (NON-NEGOTIABLE)
All public API endpoints MUST implement rate limiting:
- Unauthenticated users: 100 requests/hour
- Authenticated users: 1000 requests/hour
- Webhook endpoints: 10 requests/minute

Implementation: Use express-rate-limit middleware
```

---

## 影响分析

### 需要更新的 Plan

| Spec | API 端点 | 当前状态 |
|------|---------|---------|
| 001-bookmark-articles | POST /toggle, GET /bookmarks | ❌ 无速率限制 |
| 002-user-auth | POST /login, POST /register | ❌ 无速率限制 |
| 003-article-cms | CRUD 端点 | ❌ 无速率限制 |

### 需要添加的基础设施

- 共享中间件: `backend/src/middleware/rateLimit.ts`
- 配置管理: 不同环境的速率限制配置

---

## 变更路径

### Step 1: 更新 Constitution
```bash
# 编辑 specs/constitution.md
# 追加原则 V
```

### Step 2: 重新生成所有 Plan
```bash
/speckit.plan 001-bookmark-articles
/speckit.plan 002-user-auth
/speckit.plan 003-article-cms
# AI 会自动检测 Constitution 变更，在 Plan 中添加速率限制决策
```

### Step 3: 实现共享中间件
```typescript
// backend/src/middleware/rateLimit.ts
import rateLimit from 'express-rate-limit';

export const unauthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  message: 'Too many requests from this IP'
});

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: 'Too many requests'
});
```

### Step 4: 在各路由中应用
```typescript
// 每个生成的 Plan 都会包含这个 Task
// TXXX: 在路由中应用速率限制中间件
```

---

## 验证

- [ ] 所有 Plan 都包含速率限制决策
- [ ] 共享中间件已实现
- [ ] 所有 API 端点已应用中间件
- [ ] 测试：发送 101 个请求，第 101 个返回 429
```

---

### 输出格式

Change Request 生成 `specs/changes/<change-id>/impact-analysis.md`：

```markdown
# Change Request Impact Analysis: CHANGE-001

**Type**: Feature Add
**Created**: 2026-06-01
**Status**: Pending Approval

---

## 变更摘要

为书签功能添加"收藏夹分类"能力。

---

## 影响矩阵

| 维度 | 影响 | 说明 |
|------|------|------|
| Spec 层 | ✏️ 需要修改 | 新增 3 个 User Story |
| Plan 层 | ✏️ 需要重新生成 | 新增数据表和 API |
| Tasks 层 | ✏️ 需要重新生成 | 新增 15-20 个任务 |
| Implement 层 | ✏️ 需要执行 | 约 1-2 天工作量 |
| Constitution | ✅ 不违反 | 所有原则仍然满足 |

---

## 风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 向后兼容性 | 🟡 低 | 新增可选参数 |
| 数据迁移 | 🟢 无 | folder_id 可为 NULL |
| 性能影响 | 🟢 无 | 新表独立查询 |

---

## 推荐行动

1. ✅ 批准变更（风险可控）
2. 与 PM 确认新 User Story 的优先级
3. 更新 Spec 文档
4. 执行 `/speckit.plan` 重新生成
```

---

### 与核心五层的集成

```
变更请求
    ↓
/speckit.change-request (生成影响分析)
    ↓
决策：批准 / 拒绝 / 延后
    ↓
如果批准：
  ├─ Spec 层变更 → 更新 spec.md → /speckit.plan
  ├─ Plan 层变更 → 更新 plan.md → /speckit.tasks
  ├─ Constitution 变更 → 更新 constitution.md → 所有 Plan 重新生成
  └─ 直接代码修复（Bug Fix 场景）→ 更新 Spec/Plan（反向同步文档）
```

**价值**：
1. 变更影响可见（不是"改一行代码"那么简单）
2. 变更路径清晰（知道每一步要做什么）
3. 文档-代码一致性（变更后同步更新文档）

---

## 三个 Skill 的协作

### 典型工作流

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  PM 提交 PRD                                                 │
│      ↓                                                       │
│  /speckit.prd-review ← 发现问题，修正 PRD                     │
│      ↓                                                       │
│  /speckit.specify ← 生成 Spec                                │
│      ↓                                                       │
│  /speckit.plan ← 生成 Plan                                   │
│      ↓                                                       │
│  /speckit.tasks ← 生成 Tasks                                 │
│      ↓                                                       │
│  /speckit.implement ← 执行开发                               │
│      ↓                                                       │
│  ┌─────────────────┬─────────────────┬─────────────────┐     │
│  │ QA 发现 Bug      │  PM 提出变更     │  技术债需要还    │     │
│  ↓                 ↓                 ↓                 │     │
│  /speckit.bug-fix   /speckit.change   /speckit.change    │     │
│  ↓                 ↓                 ↓                 │     │
│  更新 Spec/Plan    更新 Spec/Plan    更新 Plan          │     │
│  ↓                 ↓                 ↓                 │     │
│  重新 Implement    重新 Implement    重新 Implement    │     │
│  └─────────────────┴─────────────────┴─────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键设计原则

1. **文档优先**: 任何变更（Bug/Change）都先更新文档，再改代码
2. **可追溯性**: 每个变更都有对应的文档（bug-fix/impact-analysis）
3. **最小惊讶**: PRD Review 在开发前发现问题，避免"做到一半发现需求不对"

---

## 章末思考题

**Q1（批判型）**：这三个 Skill 中，PRD Review 可能被诟病为"增加流程开销"。如果一个 PM 总是写出高质量的 PRD，这个 Skill 是否还有价值？如何平衡"流程严格性"和"开发速度"？

> **参考答案**：PRD Review 的价值不在于"每次都跑一遍"，而在于**提供一个质量基准**。对于高质量 PRD，Review 会快速通过（10分钟内完成所有检查）。对于低质量 PRD，Review 避免了"带着问题开发"的更大浪费。平衡方式：① 可以跳过非 Critical 的检查项；② 可以用 `--focus` 只检查特定维度；③ 对信任的 PM，可以设置"白名单模式"（只检查 Edge Cases 等容易被忽略的项）。流程严格性的投入是线性的，但避免的返工成本可能是指数级的（越晚发现需求问题，修复成本越高）。

**Q2（应用型）**：Bug Fix Skill 要求修复后"更新原始 Spec/Plan"。如果一个 Bug 是因为代码实现错误（而非 Spec/Plan 问题），是否也需要更新文档？

> **参考答案**：需要。但更新的内容不同：如果 Spec/Plan 本身正确，只是代码实现错了，文档更新应该是"增加一个 Edge Case 或 Acceptance Scenario"，把这个容易被踩坑的场景明确记录下来。例如：多标签页同步的 Bug，即使 Plan 原本没有讨论这个场景，修复后也应该在 Plan 的 Architecture Decision 中追加这个决策。这样 future 的工程师（或 AI）在阅读 Plan 时，会知道"这个场景已经被考虑过"。这是"把经验固化为文档"的关键动作——否则，同样的坑可能会被不同的人反复踩。

**Q3（综合型）**：Change Request Skill 识别了四种变更类型（Feature Add/Remove、Tech Stack Change、Constitution Update）。是否还有其他常见的变更类型没有被覆盖？如果有的话，应该如何扩展这个 Skill？

> **参考答案**：还有几种常见变更类型：① **依赖升级**（如升级 React 版本、Node.js 版本）——这介于 Tech Stack Change 和 Feature Add 之间，通常需要兼容性测试和渐进式迁移；② **合规/安全变更**（如 GDPR 要求删除用户数据）——这类似于 Feature Add，但驱动来自外部而非产品需求；③ **性能优化**（如添加缓存、索引）——这通常是 Plan 层的变更，不改变 Spec。扩展方式：在 `--type` 选项中增加新类型，并为每种类型定义标准的影响分析模板（现有四种类型都有各自的模板，新类型只需要增加对应的模板章节）。

---

## 下一步

这三个 Skill 的设计完成，但实现需要：
1. **Prompt 工程**: 将每个检查维度转化为 AI 可执行的 prompt
2. **模板定义**: 为每种输出格式定义模板（prd-review.md、root-cause.md、impact-analysis.md）
3. **工具集成**: 将这些 Skill 集成到 spec-kit 的命令体系中

如果要在实际项目中使用，建议：
1. 先手动跑一遍每个 Skill 的流程（不用命令，用文档模板）
2. 根据实际情况调整检查项和输出格式
3. 再自动化（集成到 spec-kit 或团队内部的工具链）

**核心价值主张**: 这三个 Skill 不改变 SDD 的核心五层，而是在其周围建立"质量护城河"——在需求进入前过滤问题（PRD Review），在实现后快速定位修复（Bug Fix），在变更时控制影响范围（Change Request）。
