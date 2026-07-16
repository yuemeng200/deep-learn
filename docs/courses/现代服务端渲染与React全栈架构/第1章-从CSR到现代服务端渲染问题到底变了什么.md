---
title: 第1章 从 CSR 到现代服务端渲染，问题到底变了什么
date: 2026-07-15
course: 现代服务端渲染与 React 全栈架构
summary: 用一个统一模型理解 CSR、SSR、SSG、ISR、Streaming SSR 与 RSC 的演化关系，并建立页面级渲染策略判断力。
---

# 第1章：从 CSR 到现代服务端渲染，问题到底变了什么

现代服务端渲染解决的根本问题，不只是首屏 HTML 更快，而是重新分配 Web 应用的计算、数据、缓存和交互边界。对一个长期写 CSR 的前端来说，最重要的第一步不是学习某个框架 API，而是先看清：过去默认放在浏览器里的工作，现在可以被拆到构建期、服务端、边缘、CDN、客户端和组件边界之间。

## 1. CSR 的默认世界观

典型 CSR 应用的运行模型是：

```txt
Browser requests /dashboard
  -> CDN/server returns index.html
  -> Browser downloads JS bundle
  -> React starts
  -> Client router matches route
  -> Components mount
  -> useEffect / query hooks request data
  -> Data returns
  -> UI becomes meaningful
```

这个模型的好处非常明显：

1. 工程心智统一：几乎所有页面逻辑都在浏览器中。
2. 交互体验强：页面切换、局部状态、复杂表单、富交互都很自然。
3. 部署简单：静态资源 + API 后端即可。
4. 前后端边界清晰：前端消费 API，后端提供数据。

但它也有几个结构性代价：

1. 首屏内容依赖 JS 下载、解析、执行。
2. 数据请求容易在组件挂载后才开始，形成瀑布。
3. HTML 初始内容少，不利于搜索引擎、社交分享和低端设备。
4. 所有参与首屏的组件代码默认都要进入浏览器 bundle。
5. 浏览器离数据源远，很多可提前完成的工作被推迟到用户设备上。

所以 CSR 不是“落后”，而是一种明确的分工策略：把应用控制权最大化交给客户端。现代 SSR/RSC 的出现，是在挑战这个默认分工。

## 2. SSR 最早想解决什么

传统 SSR 的核心动作是：请求到达服务端后，服务端先运行 React，把组件树渲染成 HTML，再把 HTML 发给浏览器。

```txt
Browser requests /dashboard
  -> Server fetches data
  -> Server renders React to HTML
  -> Browser receives meaningful HTML
  -> Browser downloads JS
  -> React hydrates existing DOM
  -> UI becomes interactive
```

它主要改善了三件事：

1. 用户更早看到有意义的内容。
2. 搜索引擎和爬虫更容易读取页面。
3. 数据获取可以更靠近服务端资源，减少客户端瀑布。

但传统 SSR 并不免费。它引入了新的复杂度：

1. 每次请求可能都要占用服务端计算资源。
2. 服务端渲染出来的 HTML 仍然需要客户端 hydration 才能交互。
3. 组件必须在服务端和客户端都能安全执行，容易遇到 `window`、时间、随机数、用户态差异导致的 mismatch。
4. 数据要在服务端渲染和客户端 hydration 之间保持一致。
5. 如果服务端必须等所有数据都返回再发 HTML，慢数据会阻塞整个页面。

React 官方的 `hydrateRoot` 文档明确指出：hydration 的作用是在浏览器中接管之前由 `react-dom/server` 生成的 HTML，让它变成可交互的 React 应用。也就是说，SSR 不是替代客户端 React，而是把“首次生成 DOM”前移到服务端，然后再由客户端恢复交互。

官方参考：[React hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)

## 3. 渲染模式不是二选一，而是一条谱系

现代 Web 框架不再只问“CSR 还是 SSR”。更准确的问题是：

> 这部分 UI 的 HTML、数据、组件代码和交互，分别应该在什么时候、在哪里完成？

可以把主流模式放到一条谱系上：

```txt
越早完成 / 越容易缓存                                      越晚完成 / 越个性化

Build-time SSG
  -> ISR / Revalidation
  -> Request-time SSR
  -> Streaming SSR
  -> RSC mixed rendering
  -> CSR island / Client-only interaction
```

每种模式不是互斥的。一个现代页面往往会混合它们：

```txt
Product page
  - 商品标题、描述、图片：静态或可再验证
  - 库存和价格：请求时动态或短缓存
  - 推荐列表：streaming 延迟加载
  - 加入购物车按钮：client component
  - 用户专属优惠：登录后客户端或动态服务端片段
```

Next.js 当前的渲染哲学也在走这个方向：静态和动态不是只能以整页为单位二选一，而是可以在组件和 Suspense 边界上组合。它的官方文档把 Partial Prerendering、Cache Components、on-demand revalidation 等能力描述为一种把 static/dynamic 视为谱系的模型。

官方参考：[Next.js Rendering Philosophy](https://nextjs.org/docs/app/guides/rendering-philosophy)

## 4. SSG：把请求时工作提前到构建期

SSG，Static Site Generation，是在构建阶段生成 HTML。

```txt
Build time:
  -> fetch content
  -> render HTML
  -> deploy static files

Request time:
  -> CDN returns cached HTML
```

适合 SSG 的页面：

1. 文档页。
2. 博客文章。
3. 营销页。
4. 商品详情中变化不频繁的部分。
5. 帮助中心、公开知识库。

SSG 的强项是性能和缓存。请求时几乎不需要服务端计算，CDN 可以直接返回 HTML。

但 SSG 的问题也清楚：

1. 数据变化后，旧 HTML 会过期。
2. 页面数量非常大时，构建成本会上升。
3. 用户个性化内容不适合纯 SSG。
4. 如果所有变化都靠重新部署，内容更新链路会很重。

所以 SSG 解决的是“提前算好”的问题，而不是“所有页面都静态化”的问题。

## 5. ISR / Revalidation：静态结果可以被更新

ISR 可以理解为“静态生成 + 按需或定时再生成”。它试图保留 SSG 的缓存收益，同时降低内容更新成本。

```txt
First build:
  -> generate cached HTML

Request:
  -> serve cached HTML
  -> if stale, trigger regeneration
  -> next request receives fresh result
```

更抽象地说，ISR 引入了一个重要心智：

> 页面不必在每次请求时重新渲染，动态数据也不必等于完全实时。

很多业务页面的真实需求不是“绝对实时”，而是“足够新”。例如：

1. 商品详情可以接受 30 秒或 5 分钟延迟。
2. 博客、文档可以按发布事件 revalidate。
3. 首页榜单可以每分钟更新。
4. 活动页可以在运营修改后按需刷新。

这会直接影响架构判断：当你看到“数据来自数据库”时，不应该立刻推导出“必须 SSR”。你应该先问：这份数据的可接受陈旧时间是多少？

## 6. Streaming SSR：不再让最慢的数据阻塞整个页面

传统 SSR 容易出现一个问题：服务端要等页面所需数据全部准备好，才能把完整 HTML 发出去。

```txt
Header data: 20ms
Main data: 80ms
Sidebar data: 1200ms

Traditional SSR:
  wait 1200ms -> send HTML
```

Streaming SSR 允许服务端把页面拆成多个 chunk，准备好的部分先发给浏览器，慢的部分后续再补上。Next.js 官方文档把 streaming 描述为把 route 拆成更小的块，并在它们准备好时逐步从服务端发送到客户端。

```txt
Streaming SSR:
  20ms  -> send shell/header
  80ms  -> send main content
  1200ms -> stream sidebar into Suspense boundary
```

Streaming 的核心价值不是让慢数据变快，而是改变阻塞关系：

1. 快的区域不必等待慢的区域。
2. 用户可以更早看到页面骨架和主要内容。
3. Suspense 边界变成加载和传输边界。
4. 服务端可以持续输出，而不是憋出一个完整字符串。

官方参考：[Next.js Streaming](https://nextjs.org/learn/dashboard-app/streaming)、[React renderToPipeableStream](https://react.dev/reference/react-dom/server/renderToPipeableStream)

## 7. RSC：问题从“在哪里生成 HTML”变成“哪些组件进入客户端”

React Server Components 容易被误解成“更强的 SSR”，或者“只能用来做静态展示的组件”。这两个理解都不够准确。

更简单的理解是：

> RSC 允许你把一部分 React 组件只放在服务端运行，不把它们打包进浏览器 JS；需要点击、输入、状态和浏览器 API 的地方，再显式切到 Client Component。

React 官方文档对 Server Components 的定义很关键：它们是在独立于客户端应用或传统 SSR server 的环境中提前渲染的组件类型，可以在构建时运行，也可以在每次请求时运行。

官方参考：[React Server Components](https://react.dev/reference/rsc/server-components)

先看一个文章详情页的结构：

```tsx
// ArticlePage.tsx
// 默认是 Server Component
async function ArticlePage({ id }) {
  const article = await db.article.findUnique({ where: { id } })

  return (
    <main>
      <h1>{article.title}</h1>
      <ArticleBody content={article.content} />
      <LikeButton articleId={article.id} />
    </main>
  )
}
```

这里 `ArticlePage` 可以是 Server Component。它负责查数据库、组装页面结构、渲染标题和正文。因为它只在服务端运行，所以 `db.article.findUnique` 这种服务端依赖不会进入浏览器 bundle。

但点赞按钮需要点击事件和客户端状态，所以它应该是 Client Component：

```tsx
'use client'

import { useState } from 'react'

export function LikeButton({ articleId }) {
  const [liked, setLiked] = useState(false)

  return (
    <button onClick={() => setLiked(true)}>
      {liked ? '已点赞' : '点赞'}
    </button>
  )
}
```

所以，一个使用 RSC 的页面并不要求整页都是静态展示。更常见的结构是：

```txt
<ArticlePage />              Server Component
  <ArticleHeader />          Server Component
  <ArticleBody />            Server Component
  <RelatedArticles />        Server Component
  <LikeButton />             Client Component
  <ShareMenu />              Client Component
```

Server Component 负责：

1. 读取服务端数据。
2. 组合页面结构。
3. 渲染不需要浏览器状态的内容。
4. 把可序列化的 props 传给 Client Component。
5. 让服务端依赖、数据访问逻辑和大块展示组件留在浏览器 bundle 之外。

Client Component 负责：

1. 点击、输入、拖拽、弹窗等交互。
2. `useState`、`useEffect`、`useReducer` 等客户端状态和副作用。
3. `window`、`document`、localStorage 等浏览器 API。
4. 复杂表单、实时预览、编辑器、图表交互等客户端循环。

这带来的真正变化是：过去 CSR 里整棵组件树默认都发到浏览器；RSC 让你可以把页面拆成“服务端结构层”和“客户端交互岛”。

```txt
页面结构、数据读取、静态内容、服务端依赖
  -> Server Component

按钮、输入框、弹窗、筛选器、局部状态
  -> Client Component
```

传统 SSR 的关注点是：

```txt
Can server generate initial HTML?
```

RSC 的关注点是：

```txt
Can this component and its dependencies stay out of the client bundle?
Can this data access happen as part of server component rendering?
Where should the interactive boundary begin?
```

所以 RSC 让“组件”从纯浏览器抽象，变成一种跨服务端和客户端的架构单元。它不是要求你放弃交互，而是要求你明确交互边界：能留在服务端的留在服务端，必须在浏览器里动的部分再进入客户端。

## 8. 现代渲染模式选择矩阵

下面这张表是本章最重要的产出。它不是死规则，而是第一轮判断框架。

| 页面/区域类型 | 首选策略 | 原因 | 风险 |
| --- | --- | --- | --- |
| 文档、博客、营销页 | SSG / 静态渲染 | 内容稳定，CDN 友好，首屏快 | 内容更新链路要设计好 |
| 商品详情、公开内容详情 | SSG + Revalidation / ISR | 多数内容可缓存，允许一定陈旧 | 价格、库存、权限片段要拆开 |
| SEO 强相关列表页 | SSR / 可缓存动态渲染 | URL 内容需要可索引，筛选条件多 | 请求量大时服务端成本高 |
| 登录后 dashboard | SSR + Client Components / Query | 首屏需要个性化，后续交互强 | 缓存边界复杂，容易过度动态 |
| 高交互后台应用 | CSR / SSR shell + CSR content | 交互和状态复杂，SEO 不重要 | 首屏和低端设备性能要控制 |
| 慢数据组成的复合页面 | Streaming SSR + Suspense | 避免慢区域阻塞快区域 | loading 边界和布局稳定性要设计 |
| 需要隐藏服务端依赖的内容区域 | RSC / Server Component | 不把服务端依赖和敏感逻辑发到客户端 | server/client 边界需要清晰 |
| 实时协作、编辑器、画布类应用 | CSR 为主 | 主要价值在客户端交互循环 | 可用 SSR 提供外壳和元信息 |

你可以把选择过程简化成 6 个问题：

1. 这个页面是否需要被搜索引擎或社交平台正确读取？
2. 首屏有意义内容是否必须在 JS 执行前出现？
3. 数据的新鲜度要求是实时、秒级、分钟级，还是发布后更新？
4. 内容是否按用户强个性化？
5. 交互状态是否复杂到主要逻辑必须留在浏览器？
6. 页面中是否有明显的快慢区域，可以用 streaming 拆开？

## 9. 轻量验证：三个页面怎么选

假设你要设计一个知识产品站点，有三个页面。

### 页面 A：公开文章详情页

特征：

1. 需要 SEO。
2. 内容发布后很少修改。
3. 评论数可以延迟更新。
4. 收藏按钮需要登录后交互。

合理方案：

```txt
文章主体：SSG / revalidation
评论数：短缓存动态数据或客户端请求
收藏按钮：Client Component
元信息：构建期或 revalidation 时生成
```

不要因为页面里有一个收藏按钮，就把整页变成纯 CSR。也不要因为评论数会变化，就让整篇文章每次请求都 SSR。

### 页面 B：登录后的个人学习面板

特征：

1. 强用户个性化。
2. 首屏需要展示用户课程进度。
3. 有筛选、标记完成、继续学习等交互。
4. SEO 不重要。

合理方案：

```txt
页面 shell：SSR 或 RSC
用户基础数据：服务端读取，减少首屏瀑布
交互列表：Client Component + TanStack Query 或框架数据层
mutation：server action / route action / API endpoint
```

这里完全 SSG 不合适。纯 CSR 可以做，但首屏会更依赖客户端请求。如果产品很重视首次进入 dashboard 的速度，可以用服务端先把关键数据送到页面。

### 页面 C：数据很慢的公开分析页

特征：

1. 标题、说明、基础信息很快。
2. 主图表数据 500ms。
3. 侧边推荐 2s。
4. 页面需要公开访问。

合理方案：

```txt
静态 shell：立即返回
主图表：Suspense boundary 内 streaming
侧边推荐：更低优先级 streaming 或客户端加载
可缓存数据：按数据源设置 revalidation
```

这里的关键不是“SSR 还是 CSR”，而是不要让 2 秒的推荐模块阻塞整页。

## 10. 本章小结

现代服务端渲染的演化，不是一条从 CSR 到 SSR 的单向替代路线，而是把过去默认堆在客户端的工作重新拆分：

1. 能提前算好的，放到构建期或静态缓存。
2. 需要请求上下文的，放到服务端请求时。
3. 可以逐步到达的，用 streaming 和 Suspense 拆开。
4. 不需要进入浏览器的组件，留在 Server Component 边界内。
5. 必须交互和持有浏览器状态的部分，明确标为 Client Component 或 CSR 区域。

这就是从 CSR 工程师升级到现代 SSR/RSC 架构视角的第一层变化：你不再问“页面用不用 SSR”，而是问“这部分 UI 的计算、数据、缓存、代码和交互，应该分别放在哪里”。

## 思考题

### 题 1：为什么“需要登录”不等于“不能缓存”？

参考答案：

因为登录态页面通常由多个区域组成，不是所有区域都强个性化。比如 dashboard 的导航、课程元信息、公开推荐内容可以缓存；用户姓名、进度、权限按钮等区域需要动态读取。现代架构会把页面拆成不同缓存和渲染边界，而不是因为局部个性化就放弃整页缓存。

### 题 2：RSC 和传统 SSR 最大的概念差异是什么？

参考答案：

传统 SSR 主要解决“服务端能否先生成 HTML”，客户端仍然需要下载对应组件代码并 hydration。RSC 主要解决“哪些组件和依赖不需要进入客户端 bundle”，并允许组件树跨服务端和客户端边界组合。RSC 可以和 SSR 一起使用，但它不是 SSR 的同义词。

### 题 3：一个商品详情页有价格、库存、评论、推荐、加入购物车按钮，为什么不应该简单选择“全 SSR”？

参考答案：

因为这些区域的新鲜度、缓存性和交互需求不同。商品描述和图片可能适合静态生成或 revalidation；价格和库存可能需要短缓存或请求时动态；评论可以延迟加载或分页；推荐可以低优先级 streaming；加入购物车按钮必须是客户端交互。全 SSR 会把所有区域绑到同一个请求时延和缓存策略上，反而降低性能和可控性。

## 下一章预告

下一章会进入 SSR 的底层机制：服务端 HTML 到达浏览器后，React 为什么还要 hydration；Streaming SSR 和 Suspense 在时序上到底如何协作；以及为什么 hydration mismatch 是理解 SSR 工程风险的第一道门槛。
