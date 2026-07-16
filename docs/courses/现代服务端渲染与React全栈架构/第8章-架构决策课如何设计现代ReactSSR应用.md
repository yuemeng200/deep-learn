---
title: 第8章 架构决策课，如何设计一个现代 React SSR 应用
date: 2026-07-16
course: 现代服务端渲染与 React 全栈架构
summary: 用一个中等复杂度应用贯穿 Next App Router、React Router Framework Mode 与 TanStack Query 的架构推演，沉淀现代 SSR/RSC 技术选型 checklist。
---

# 第8章：架构决策课，如何设计一个现代 React SSR 应用

现代 SSR/RSC 架构的目标，不是把所有东西都服务端化，也不是用最新框架 API 重写 CSR。它真正要求你做的是：把页面里的内容、数据、交互、缓存、mutation 和部署运行时逐块拆开，再为每一块选择合适的位置。

这一章是课程的合成章。我们不再单独讲 SSR、RSC、App Router、React Router、TanStack Query 或缓存，而是用一个中等复杂度应用做架构推演，训练你在真实项目中做技术选型和架构评审。

## 1. 案例：一个知识产品应用

假设我们要做一个知识产品应用，包含这些页面和能力：

```txt
公开页面:
  /articles
  /articles/[slug]
  /courses
  /courses/[slug]

登录后页面:
  /dashboard
  /dashboard/courses
  /dashboard/notes
  /dashboard/settings

核心功能:
  文章阅读
  课程详情
  学习进度
  收藏文章
  创建笔记
  搜索课程和文章
  dashboard 统计
  通知铃铛
```

数据特征：

```txt
文章正文:
  公开，SEO 重要，低频变化

课程详情:
  公开主体 + 登录后学习状态

学习进度:
  用户私有，写入较频繁

收藏:
  用户私有，交互频繁

搜索:
  用户输入驱动，结果可缓存但变化较多

dashboard 统计:
  用户私有，可接受分钟级陈旧

通知:
  用户私有，需要后台刷新
```

现在的问题不是“这个应用要不要 SSR”，而是：

```txt
每一类页面和数据分别应该怎么渲染、怎么取、怎么缓存、怎么更新？
```

## 2. 第一步：先按页面类型分层

先不要选框架，先划分页面类型。

| 页面/区域 | SEO | 个性化 | 交互 | 新鲜度 | 初步策略 |
| --- | --- | --- | --- | --- | --- |
| 文章详情 | 高 | 低 | 低 | 低频 | 静态/可再验证 + 少量客户端交互 |
| 课程详情公开主体 | 高 | 低 | 中 | 低频 | 静态/可再验证 |
| 课程学习状态 | 低 | 高 | 中 | 中频 | 动态服务端或客户端 Query |
| Dashboard | 低 | 高 | 高 | 中频 | SSR shell + 客户端活跃数据 |
| 通知铃铛 | 低 | 高 | 中 | 高频 | TanStack Query / SSE |
| 搜索结果 | 中 | 可选 | 高 | 中频 | URL 驱动 + Query 或 loader |
| 设置页 | 低 | 高 | 中 | 强一致 | 私有动态 + mutation |

这张表比框架名更重要。因为它把架构判断从“技术偏好”拉回“数据和交互事实”。

## 3. 第二步：设计渲染边界

公开文章详情页：

```txt
ArticlePage:
  文章标题、正文、作者、发布时间、metadata
  -> 早期 HTML / Server Component / loader

RelatedArticles:
  相关推荐
  -> Suspense / streaming / 可缓存

LikeButton:
  收藏或点赞
  -> Client Component / Query mutation / action

Comments:
  非 SEO 主体
  -> streaming 或客户端分页加载
```

课程详情页：

```txt
CoursePublicInfo:
  课程标题、介绍、大纲
  -> 静态或 revalidate

EnrollmentStatus:
  用户是否已加入、进度
  -> 动态私有数据

ContinueButton:
  浏览器交互
  -> Client Component
```

Dashboard：

```txt
UserHeader:
  用户基础信息
  -> 服务端读取，避免首屏空白

ProgressSummary:
  可接受短暂陈旧
  -> 服务端缓存或 Query 预取

NotificationBell:
  页面停留期间持续刷新
  -> TanStack Query

RecentNotes:
  分页、编辑、删除
  -> Query 或 route loader + fetcher/action
```

这一步要形成一个基本原则：

> SEO 主体和路由主数据优先服务端；页面打开后持续变化的远程状态优先客户端 server-state 工具；交互边界尽量小。

## 4. 方案 A：Next.js App Router 设计

如果选择 Next App Router，整体结构可以是：

```txt
app/
  layout.tsx
  articles/
    page.tsx
    [slug]/
      page.tsx
  courses/
    page.tsx
    [slug]/
      page.tsx
  dashboard/
    layout.tsx
    page.tsx
    courses/
      page.tsx
    notes/
      page.tsx
    settings/
      page.tsx
  actions/
    progress.ts
    notes.ts
```

文章详情：

```tsx
export default async function ArticlePage({ params }) {
  const article = await getArticle(params.slug)

  return (
    <main>
      <ArticleHeader article={article} />
      <ArticleBody content={article.content} />
      <ArticleActions articleId={article.id} />

      <Suspense fallback={<RelatedSkeleton />}>
        <RelatedArticles articleId={article.id} />
      </Suspense>
    </main>
  )
}
```

这里：

```txt
ArticleHeader / ArticleBody:
  Server Component

ArticleActions:
  Client Component，收藏、分享、阅读进度

RelatedArticles:
  Server Component + Suspense，可缓存
```

课程详情：

```tsx
export default async function CoursePage({ params }) {
  const course = await getCourse(params.slug)
  const viewer = await getOptionalViewer()

  return (
    <main>
      <CourseOverview course={course} />
      <CourseSyllabus courseId={course.id} />
      <EnrollmentPanel courseId={course.id} viewer={viewer} />
    </main>
  )
}
```

这里要小心：如果 `getOptionalViewer()` 读取 cookie，可能让整个页面动态化。更好的设计可能是：

```txt
CourseOverview / CourseSyllabus:
  保持公开可缓存

EnrollmentPanel:
  下沉到动态私有边界，或客户端请求
```

Next 方案的优势：

1. RSC-first，适合大量服务端展示组件。
2. SEO 页面和公开内容缓存能力强。
3. 可以细粒度缩小客户端 bundle。
4. Server Actions 与 revalidation 能直接串起 mutation。
5. Suspense/streaming 与路由段整合好。

Next 方案的风险：

1. 缓存模型复杂，团队需要纪律。
2. `use client` 放错位置会吞掉 RSC 收益。
3. 动态 API 放在高层 layout 会扩大动态范围。
4. Server Actions、Route Handlers、Query mutation 容易职责重叠。
5. 平台绑定和部署运行时要提前评估。

## 5. 方案 B：React Router Framework Mode 设计

如果选择 React Router Framework Mode，整体结构更像 route modules：

```txt
routes/
  root.tsx
  articles.tsx
  articles.$slug.tsx
  courses.tsx
  courses.$slug.tsx
  dashboard.tsx
  dashboard.courses.tsx
  dashboard.notes.tsx
  dashboard.settings.tsx
```

文章详情：

```tsx
export async function loader({ params }) {
  const article = await getArticle(params.slug)

  if (!article) {
    throw new Response('Not Found', { status: 404 })
  }

  return { article }
}

export default function ArticlePage({ loaderData }) {
  const { article } = loaderData

  return (
    <main>
      <ArticleHeader article={article} />
      <ArticleBody content={article.content} />
      <FavoriteFetcher articleId={article.id} />
    </main>
  )
}
```

收藏：

```tsx
export async function action({ request, params }) {
  const formData = await request.formData()
  const intent = String(formData.get('intent'))

  if (intent === 'favorite') {
    await favoriteArticle(params.slug)
  }

  return null
}
```

Dashboard notes：

```tsx
export async function loader() {
  return {
    notes: await getMyNotes(),
  }
}

export async function action({ request }) {
  const formData = await request.formData()
  await createNote({
    title: String(formData.get('title')),
  })
  return null
}
```

React Router 方案的优势：

1. loader/action 心智清晰，读写围绕路由组织。
2. Form、Request、Response、redirect、headers 等 Web 语义强。
3. progressive enhancement 更自然。
4. CRUD 和表单密集应用很顺。
5. 相比 RSC-first，组件边界复杂度较低。

React Router 方案的风险：

1. 组件级服务端边界不如 Next RSC-first 细。
2. 如果需要强 RSC 能力，要关注当前 RSC Framework Mode 成熟度。
3. 复杂客户端 server state 仍需要 Query 等工具。
4. 缓存和部署能力更多取决于具体运行平台。
5. 团队要接受 route module 组织方式，而不是组件内随处取数。

## 6. 方案 C：框架数据层 + TanStack Query 组合

现实项目里，最常见的不是纯框架数据层，也不是纯 Query，而是组合。

推荐分工：

```txt
框架数据层:
  SEO 主体
  路由主数据
  404/redirect/metadata
  首屏关键内容
  表单提交后的简单 revalidation

TanStack Query:
  通知
  无限滚动
  复杂筛选
  后台刷新
  乐观更新
  多组件共享远程状态
```

例如 dashboard：

```tsx
// Server Component or loader
const user = await getCurrentUser()
const summary = await getProgressSummary(user.id)

return (
  <main>
    <DashboardHeader user={user} summary={summary} />
    <NotificationBell />
    <TaskBoard />
    <NotesExplorer />
  </main>
)
```

其中：

```txt
NotificationBell:
  Query，30 秒刷新

TaskBoard:
  Query，拖拽和乐观更新

NotesExplorer:
  Query，筛选、分页、删除后 invalidate

DashboardHeader:
  服务端首屏数据
```

这种组合通常是生产项目最务实的形态。框架负责“第一次正确出现”，Query 负责“页面活着时保持同步”。

## 7. 架构评审 checklist

评审一个现代 SSR/RSC 设计时，按这个顺序问。

### 页面和 SEO

```txt
哪些页面需要 SEO？
SEO 主体是否在早期 HTML 中？
metadata、canonical、structured data 是否由服务端稳定生成？
是否把正文、商品主信息等核心内容放进了过慢 Suspense 边界？
```

### 数据边界

```txt
哪些数据是路由主数据？
哪些数据是页面打开后的活跃远程状态？
哪些数据是用户私有？
哪些数据允许陈旧，允许多久？
```

### 组件边界

```txt
哪些组件可以是 Server Component？
哪些组件必须是 Client Component？
是否把 'use client' 放得过高？
Client Component 是否直接 import 了 server-only 依赖？
是否需要纯 CSR 组件，还是普通 Client Component 就够？
```

### 缓存与失效

```txt
每份数据缓存在哪一层？
Query cache、framework cache、HTTP cache、CDN cache 是否分清？
mutation 后谁负责 revalidation？
按 path 失效还是按 tag/entity 失效？
是否可能 public cache 用户私有内容？
```

### 交互与 mutation

```txt
简单表单是否可以用 Server Action 或 route action？
复杂乐观更新是否应该用 Query mutation？
提交后是 refresh 整个路由，还是局部更新缓存？
失败回滚和错误提示在哪里处理？
```

### 运行时与部署

```txt
哪些逻辑必须 Node runtime？
哪些逻辑适合 Edge runtime？
数据库连接是否适合当前部署形态？
是否有冷启动风险？
昂贵查询是否有服务端缓存或物化结果？
```

## 8. 技术选型决策模板

可以用这个模板做选型文档。

```md
## 背景

应用类型：
目标用户：
SEO 要求：
个性化程度：
交互复杂度：

## 页面分类

- 公开内容页：
- 登录后私有页：
- 高交互工具页：
- 搜索/列表页：

## 数据分类

- 路由主数据：
- 客户端活跃 server state：
- 高频 mutation：
- 可缓存公开数据：
- 私有敏感数据：

## 推荐架构

框架：
渲染策略：
数据获取策略：
mutation 策略：
缓存策略：
部署运行时：

## 风险

- 缓存失效：
- RSC/Client 边界：
- SEO：
- 数据一致性：
- 部署约束：

## 验证计划

- 首屏 HTML 检查：
- bundle 分析：
- hydration 错误检查：
- 缓存 header 检查：
- mutation 后数据刷新检查：
- 低端设备交互性能检查：
```

这个模板的价值不是文档化，而是逼迫团队先做边界判断，而不是直接开始写框架代码。

## 9. 最终判断：什么时候选哪条路线

更偏 Next App Router：

```txt
内容和展示组件多
SEO 要求强
希望减少客户端 JS
需要 RSC-first 架构
接受 Next 缓存和部署模型
团队愿意学习 server/client 边界
```

更偏 React Router Framework Mode：

```txt
CRUD、表单、嵌套路由很多
团队重视 Web 标准和 progressive enhancement
希望 loader/action 数据流清晰
不想把 RSC 作为第一复杂度中心
部署平台希望更自由
```

更偏 CSR + Query：

```txt
SEO 不重要
应用是高交互后台、编辑器、工作台
主要复杂度在浏览器交互状态
首屏可接受应用壳模式
后端 API 已经稳定
```

混合策略：

```txt
公开内容:
  SSR/SSG/RSC/loader

私有 dashboard:
  SSR shell + Query

强交互工具:
  Client Component / CSR island

慢的次要内容:
  Suspense/streaming

公开可复用数据:
  framework/CDN cache
```

大多数成熟应用最后都会走混合策略。

## 10. 本章小结

现代 React SSR/RSC 架构不是一个单选题，而是一组边界设计：

1. 渲染边界：哪些内容先进入 HTML，哪些延后。
2. 组件边界：哪些组件只在服务端，哪些需要客户端。
3. 数据边界：哪些是路由主数据，哪些是客户端活跃 server state。
4. 缓存边界：哪些层缓存，如何失效。
5. 运行时边界：哪些逻辑在 Node、Edge、浏览器。

你现在应该能把这些技术放进同一张图里：

```txt
SSR:
  让首屏 HTML 更早可见

Streaming:
  让慢区域不阻塞快区域

RSC:
  让不需要浏览器的组件留在服务端

Next App Router:
  RSC-first 的完整应用框架

React Router:
  loader/action-first 的 Web 数据路由框架

TanStack Query:
  客户端运行期 server state 管理

缓存和运行时:
  决定性能、成本和一致性的生产边界
```

最终能力不是“会用某个框架”，而是能解释：

> 为什么这个页面这样渲染，这份数据这样获取，这个组件放在客户端，这个结果缓存 5 分钟，这个 mutation 用 action，这个列表用 Query，这段逻辑不能跑在 Edge。

这就是现代 SSR/RSC 架构判断力。

## 思考题

### 题 1：为什么现代 SSR 选型不能只看“首屏快不快”？

参考答案：

首屏只是一个维度。还要看 SEO、交互恢复时间、客户端 bundle、数据一致性、缓存失效、mutation 复杂度、部署运行时、数据库连接和团队心智成本。一个首屏很快但缓存不可控、交互很慢、边界混乱的系统，生产质量仍然很差。

### 题 2：什么时候应该把数据交给 Query，而不是继续放在 Server Component 或 loader？

参考答案：

当数据在页面打开后仍然活跃，例如需要后台刷新、窗口聚焦刷新、分页、无限滚动、乐观更新、多组件共享缓存、复杂筛选或局部 mutation 时，Query 更合适。Server Component 和 loader 更适合路由主数据和首屏 SEO 主体。

### 题 3：技术选型时，为什么“团队心智成本”是架构因素？

参考答案：

现代 SSR/RSC 框架把前端、服务端、缓存和部署边界揉在一起。如果团队不理解 Server/Client 边界、缓存失效和运行时限制，就容易写出能跑但难维护、难调试、易泄漏数据或性能不稳定的系统。框架能力越强，对团队纪律要求越高。

## 课程收束

到这里，8 章主线已经完成。下一步不是继续堆 API，而是把这套框架用于具体项目或代码库：选择一个页面，画出渲染、数据、缓存、交互和运行时边界，再对照 checklist 评审它是否合理。
