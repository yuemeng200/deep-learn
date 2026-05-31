---
title: 第3章：spec-kit 深度解析——完整走一遍
date: 2026-05-31
course: SDD开发
---

# 第3章：spec-kit 深度解析——完整走一遍

> 第2章建立了五层结构的框架认知，本章把这个框架跑起来——选一个真实的小功能，展示每个阶段实际输入什么、输出什么。这是 Power Inversion 从理念变成具体操作的关键一步。

---

## 3.0 准备：安装 spec-kit

```bash
# 依赖 uv（Python 包管理器）
brew install uv

# 安装 specify CLI
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.10.0

# 在项目目录初始化，指定集成的 AI 工具
specify init my-project --integration claude
cd my-project
```

初始化后，项目目录会出现 `.specify/` 文件夹，包含所有模板和命令定义。Claude Code 会自动识别 `/speckit.*` 系列命令。

---

## 3.1 贯穿本章的示例功能

> **需求**：用户可以为文章添加/取消书签，并在个人收藏页查看所有收藏的文章。

这个功能足够小（2-3天工作量），但足够完整——它涉及前端交互、后端 API、数据持久化，能把每一层的文档内容都撑起来。

技术栈：React + Node.js/Express + PostgreSQL + Prisma

---

## 3.2 第零层：Constitution

**命令**：
```bash
/speckit.constitution Create principles focused on type safety, test-first development, API-first design, and independent deployability of frontend and backend
```

**输出文档** `specs/constitution.md`：

```markdown
# MyApp Constitution

## Core Principles

### I. Type Safety (NON-NEGOTIABLE)
TypeScript strict mode across all packages. No `any` types.
All API request/response shapes must have explicit type definitions.

### II. Test-First (NON-NEGOTIABLE)
TDD mandatory: tests written → verified failing → then implement.
Red-Green-Refactor cycle strictly enforced.
No PR merges without passing tests covering acceptance scenarios.

### III. API-First
All features expose REST API before frontend integration.
Frontend and backend share type contracts via a shared `types/` package.

### IV. Independent Deployability
Backend and frontend deploy independently.
No shared runtime state between services.

## Governance
Constitution supersedes all other practices.
All PRs must verify constitutional compliance before merge.

Version: 1.0.0 | Ratified: 2026-05-31
```

**注意这里发生了什么**：Constitution 的内容在后续每一层都会被引用——Plan 生成时 AI 会自动检查 "Constitution Check"，确保技术选型不违反这些原则。

---

## 3.3 第一层：Specify

**命令输入**（你只需要说这一句话）：
```bash
/speckit.specify Build a bookmark feature so users can save articles for later
reading and view all their saved articles on a dedicated bookmarks page
```

**输出文档** `specs/001-bookmark-articles/spec.md`：

```markdown
# Feature Specification: Bookmark Articles

**Feature Branch**: `001-bookmark-articles`
**Created**: 2026-05-31
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Toggle Bookmark on Article (Priority: P1)

用户可以在文章页面直接收藏/取消收藏一篇文章。

**Why this priority**: 核心交互——没有这个，整个功能不存在。

**Independent Test**: 进入任意文章页，点击书签图标，
验证图标状态变化，刷新页面后状态仍然保持。

**Acceptance Scenarios**:

1. **Given** 已登录用户在某篇文章页面，
   **When** 点击书签图标（未收藏状态），
   **Then** 图标变为"已收藏"样式，文章被加入该用户的收藏列表

2. **Given** 已登录用户已收藏某篇文章，
   **When** 再次点击书签图标，
   **Then** 图标恢复"未收藏"样式，文章从收藏列表移除

3. **Given** 未登录用户在某篇文章页面，
   **When** 点击书签图标，
   **Then** 跳转至登录页，登录成功后返回该文章

### User Story 2 - View Bookmarks Page (Priority: P2)

用户可以在专属页面查看所有收藏的文章。

**Independent Test**: 已收藏3篇文章的用户访问 /bookmarks，
应看到3篇文章的标题、摘要和日期。

**Acceptance Scenarios**:

1. **Given** 已登录用户有3篇收藏，
   **When** 访问 /bookmarks，
   **Then** 看到3篇文章，每篇显示标题、摘要、发布日期

2. **Given** 已登录用户没有任何收藏，
   **When** 访问 /bookmarks，
   **Then** 显示空状态提示："你还没有收藏任何文章"

### Edge Cases

- 用户在两个标签页同时打开同一篇文章，一个标签页取消收藏后，另一个标签页的状态如何？
- 文章被删除后，对应的书签记录如何处理？

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 允许已认证用户收藏任意文章
- **FR-002**: 系统 MUST 允许已认证用户取消收藏
- **FR-003**: 系统 MUST 在跨 session 之间持久化书签数据
- **FR-004**: 系统 MUST 在文章页面展示当前书签状态
- **FR-005**: 用户 MUST 能在 /bookmarks 页面查看所有收藏

### Key Entities

- **Bookmark**: 用户与文章的关联关系，包含创建时间戳
- **Article**: 已有实体（本功能引用，不拥有）
- **User**: 已有实体（本功能引用，不拥有）

## Success Criteria

- **SC-001**: 书签切换操作响应时间 < 200ms（乐观更新）
- **SC-002**: /bookmarks 页面在 100 条收藏内加载时间 < 1s

## Assumptions

- 用户认证系统已存在
- 文章系统已存在
- 移动端响应式在本功能范围内
```

**观察**：这份文档没有任何技术词汇——没有数据库表名、没有 API 路径、没有框架选择。它只描述**用户行为和系统应有的表现**。这是"What"层。

---

## 3.4 第二层：Plan

**命令输入**：
```bash
/speckit.plan React frontend, Node.js/Express backend, PostgreSQL database with Prisma ORM. Monorepo structure.
```

AI 读取 Spec + Constitution，输出以下文件群：

---

**主文档** `specs/001-bookmark-articles/plan.md`（关键部分）：

```markdown
# Implementation Plan: Bookmark Articles

**Branch**: `001-bookmark-articles` | **Spec**: specs/001-bookmark-articles/spec.md

## Constitution Check ✅

- Type Safety: 所有 API 契约将使用 shared types 包 ✓
- Test-First: 每个 Acceptance Scenario 对应一个测试文件 ✓
- API-First: 先实现后端 API，再集成前端 ✓
- Independent Deployability: backend/frontend 分离 ✓

## Architecture Decisions

### Decision 1: 乐观 UI 更新（Optimistic Update）
**选择原因**: SC-001 要求 < 200ms 响应，等待服务器确认会有明显延迟感。
**风险**: 需要处理 API 失败时的状态回滚。
**实现**: 点击后立即切换图标状态，后台发请求，失败时 toast 提示并回滚。

### Decision 2: 单一 toggle 端点（不分 add/remove）
**选择原因**: 前端无需管理"当前是已收藏还是未收藏"的状态来决定调用哪个接口，
服务端处理幂等逻辑更简洁。
**实现**: POST /api/bookmarks/toggle，服务端根据是否已存在决定创建还是删除。

## Project Structure

backend/src/
├── routes/bookmarks.ts
├── services/bookmarkService.ts
└── middleware/auth.ts (已有)

frontend/src/
├── components/BookmarkButton.tsx
├── pages/BookmarksPage.tsx
└── services/bookmarkApi.ts
```

---

**数据模型** `specs/001-bookmark-articles/data-model.md`：

```markdown
# Data Model: Bookmark Articles

## New Tables

### bookmarks

| Column     | Type      | Constraints                                       |
|------------|-----------|---------------------------------------------------|
| id         | UUID      | PRIMARY KEY, DEFAULT gen_random_uuid()            |
| user_id    | UUID      | NOT NULL, FK → users(id) ON DELETE CASCADE        |
| article_id | UUID      | NOT NULL, FK → articles(id) ON DELETE CASCADE     |
| created_at | TIMESTAMP | DEFAULT NOW()                                     |

UNIQUE(user_id, article_id)  ← 防止重复收藏
INDEX ON user_id             ← /bookmarks 页面按用户查询

## Prisma Schema

model Bookmark {
  id        String   @id @default(uuid())
  userId    String
  articleId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  article   Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@unique([userId, articleId])
  @@index([userId])
}
```

---

**API 契约** `specs/001-bookmark-articles/contracts/bookmarks.md`：

```markdown
# API Contracts: Bookmarks

## POST /api/bookmarks/toggle

**Auth**: Required (Bearer token)

Request:
{ "articleId": "uuid" }

Response 200:
{ "bookmarked": true, "bookmarkId": "uuid" }  // 收藏成功
{ "bookmarked": false }                         // 取消收藏成功

Response 401: { "error": "Unauthorized" }
Response 404: { "error": "Article not found" }

## GET /api/bookmarks

**Auth**: Required (Bearer token)

Response 200:
{
  "bookmarks": [
    {
      "id": "uuid",
      "createdAt": "2026-05-31T10:00:00Z",
      "article": {
        "id": "uuid",
        "title": "文章标题",
        "summary": "摘要...",
        "publishedAt": "2026-05-20T08:00:00Z"
      }
    }
  ]
}
```

**观察**：Plan 层出现了第一批技术决策——数据库表结构、API 路径、架构选型。每个决策都有明确的理由，可以被 review，可以被质疑，可以被替换。

---

## 3.5 第三层：Tasks

**命令**：
```bash
/speckit.tasks
```

AI 读取 plan.md + data-model.md + contracts/，输出：

**`specs/001-bookmark-articles/tasks.md`**（节选）：

```markdown
# Tasks: Bookmark Articles

## Phase 1: Setup（共享基础设施）

- [ ] T001 创建 Prisma migration：bookmarks 表（含 UNIQUE 约束和索引）
  验证：npx prisma migrate dev 成功，表结构与 data-model.md 一致

## Phase 2: User Story 1 - Toggle Bookmark (P1) 🎯 MVP

**Independent Test**: 任意文章页点击书签图标，刷新后状态保持

### 测试（先写，确认 FAIL 后再实现）

- [ ] T002 [P] [US1] 集成测试：POST /toggle 收藏成功
  文件：backend/tests/integration/bookmark-add.test.ts
- [ ] T003 [P] [US1] 集成测试：POST /toggle 取消收藏
  文件：backend/tests/integration/bookmark-remove.test.ts
- [ ] T004 [P] [US1] 集成测试：未登录 → 401
  文件：backend/tests/integration/bookmark-unauth.test.ts

### 实现

- [ ] T005 [US1] 实现 bookmarkService.toggle()
  文件：backend/src/services/bookmarkService.ts
  依赖：T001
- [ ] T006 [US1] 实现 POST /api/bookmarks/toggle 路由
  文件：backend/src/routes/bookmarks.ts
  依赖：T005
- [ ] T007 [P] [US1] 实现前端 BookmarkButton 组件（含乐观更新逻辑）
  文件：frontend/src/components/BookmarkButton.tsx
  依赖：T006
- [ ] T008 [US1] 在 ArticlePage 集成 BookmarkButton
  依赖：T007

**Checkpoint**: US1 完整可测试 → 可独立演示

## Phase 3: User Story 2 - Bookmarks Page (P2)

- [ ] T009 [P] [US2] 集成测试：GET /bookmarks 返回收藏列表
  文件：backend/tests/integration/bookmark-list.test.ts
- [ ] T010 [P] [US2] 集成测试：GET /bookmarks 空列表
  文件：backend/tests/integration/bookmark-empty.test.ts
- [ ] T011 [US2] 实现 GET /api/bookmarks 路由
  文件：backend/src/routes/bookmarks.ts
  依赖：T001
- [ ] T012 [US2] 实现前端 BookmarksPage 组件
  文件：frontend/src/pages/BookmarksPage.tsx
  依赖：T011
```

**观察**：Tasks 层和 Plan 层的粒度差异一目了然。Plan 说"实现书签功能"，Tasks 说"先写 T002 的测试，确认它 FAIL，再写 T005 的 service 函数，再写 T006 的路由，最后写 T007 的前端组件"。这是 AI 可以逐条执行的序列。

---

## 3.6 第四层：Implement

**命令**：
```bash
/speckit.implement
```

AI 按 Tasks 清单顺序执行，每完成一个 Task 后：
1. 运行对应测试
2. 对照 Acceptance Scenario 验证行为
3. 标记 Task 为完成，进入下一个

你在这个阶段的工作：review 生成的代码，验收 Checkpoint。

---

## 3.7 文件目录的最终形态

走完整个流程后，项目里多了这些文件：

```
specs/
├── constitution.md                    ← 项目治理（一次性，长期复用）
└── 001-bookmark-articles/
    ├── spec.md                        ← 用户意图（What）
    ├── plan.md                        ← 技术架构（How）
    ├── data-model.md                  ← 数据结构
    ├── contracts/bookmarks.md         ← API 契约
    ├── quickstart.md                  ← 验证指南
    └── tasks.md                       ← 执行序列
```

**这个目录本身就是价值**：6个月后来看这个功能，你不需要读代码去猜"当初为什么要这样做"。Plan 里有决策理由，Spec 里有用户故事，Constitution 里有不可违反的原则。

---

## 章末思考题

**Q1（追问型）**：Spec 里的 Acceptance Scenarios 用了 Given/When/Then 格式，而不是普通的描述文字。这个格式的设计有什么深意？它在整个工作流后续的哪些环节起到了关键作用？

> **参考答案**：Given/When/Then（也叫 Gherkin 格式）的核心价值是**机器可读性**。"Given 已登录用户，When 点击书签，Then 图标变为已收藏"这个格式，可以被 AI 直接转化为测试用例骨架：setup（Given）→ action（When）→ assertion（Then）。在工作流中它起到了三次作用：① Plan 层：AI 从它生成测试文件列表（T002/T003/T004）；② Tasks 层：每个测试 Task 直接对应一个 Scenario；③ Implement 层：AI 生成的测试代码结构与 Scenario 一一对应。如果用普通描述文字，这三次转化都需要人工解析，精度会下降。

**Q2（批判型）**：Plan 里的"Architecture Decision"记录了为什么选择乐观更新和单一 toggle 端点。但这些决策如果是错的怎么办？在 SDD 工作流里，发现 Plan 层决策错误后，修改路径是什么？

> **参考答案**：这正是分层的价值——发现 Plan 层决策错误，**只需要改 Plan，不需要改 Spec**。修改路径：① 更新 plan.md 中的 Architecture Decision（改选项、改理由）；② 如果数据模型变了，更新 data-model.md；③ 如果 API 契约变了，更新 contracts/；④ 重新运行 `/speckit.tasks` 生成新的任务清单；⑤ 重新执行 Implement。Spec 层（用户故事和验收场景）完全不需要动。这和"在代码里直接修"的区别在于：修改的影响范围被隔离在 Plan 层，而不是蔓延到整个代码库。

**Q3（实操型）**：如果你现在把书签功能的 Spec 给两个不同的 AI（比如 Claude 和 Cursor），用同样的技术栈让它们各自生成 Plan，结果很可能不一样。这是 SDD 的漏洞还是特性？

> **参考答案**：这是一个**受控的特性**，不是漏洞。SDD 的设计意图是：Spec 层（What）是唯一的真相，Plan 层（How）允许有多种合理实现。不同 AI 生成不同 Plan，代表了不同的技术权衡——这些差异都应该被 review，人类选择最适合当前 context 的那个。spec-kit 的文档甚至明确提到"Branching for Exploration"——可以从同一份 Spec 生成多个 Plan，用于探索不同的优化目标（性能 vs 可维护性 vs 开发速度）。这反而体现了分层的优势：如果 Spec 和 Plan 是同一份文档，就无法做这种探索。
