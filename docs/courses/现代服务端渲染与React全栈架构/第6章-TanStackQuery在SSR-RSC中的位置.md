---
title: 第6章 TanStack Query 在 SSR/RSC 中的位置，客户端缓存不是过时了
date: 2026-07-16
course: 现代服务端渲染与 React 全栈架构
summary: 理解 TanStack Query 作为 server state 管理工具，在 SSR、RSC、loader/action 和框架数据层之间的补位边界。
---

# 第6章：TanStack Query 在 SSR/RSC 中的位置，客户端缓存不是过时了

现代 SSR 和 RSC 把很多首屏数据获取前移到了服务端，但这并不意味着客户端 server state 管理消失了。TanStack Query 解决的核心问题不是“怎么 SSR”，而是浏览器中的远程数据如何缓存、同步、刷新、去重、乐观更新和失效。

这一章要回答一个实际工程里最容易摇摆的问题：有了 Server Components、loader/action、Server Actions 之后，React Query 还需要吗？答案不是简单的是或否，而是取决于这份数据的生命周期主要属于“页面渲染输入”，还是属于“客户端交互中的远程状态”。

## 1. 先校准 TanStack Query 的定位

TanStack Query 官方文档把它描述为 server state 管理工具。它处理的是那些存在于远端、异步获取、可能被别人修改、会过期、需要缓存和同步的数据。

官方参考：[TanStack Query Overview](https://tanstack.com/query/latest/docs/framework/react/overview)

server state 和 client state 不一样：

```txt
Client state:
  当前 tab、弹窗开关、表单草稿、局部 UI 状态

Server state:
  用户资料、商品列表、订单状态、评论、通知、远程搜索结果
```

TanStack Query 擅长处理：

1. 请求缓存。
2. 请求去重。
3. stale/fresh 判断。
4. 后台刷新。
5. 分页和无限滚动。
6. mutation 与乐观更新。
7. 窗口聚焦后重新获取。
8. 网络恢复后重新获取。
9. 多组件共享同一份远程数据。
10. 查询取消、重试、错误状态和 Devtools。

所以它不是“SSR 框架”，而是远程数据状态管理层。

## 2. 框架数据层已经解决了什么

前面两章已经看到，Next App Router 和 React Router 都在把首屏数据前移。

Next App Router：

```tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)
  return <ProductView product={product} />
}
```

React Router：

```tsx
export async function loader({ params }) {
  return { product: await getProduct(params.id) }
}

export default function ProductPage({ loaderData }) {
  return <ProductView product={loaderData.product} />
}
```

这些框架数据层已经很好地解决了：

1. 首屏数据不必等客户端 mount 后再请求。
2. SSR 时 HTML 可以直接包含数据结果。
3. 404、redirect、headers、metadata 等和路由更自然地结合。
4. mutation 后可以通过框架机制 revalidate path、tag 或 loader。
5. SEO 主体内容更容易进入早期 HTML。

所以如果一份数据只是“渲染当前路由所需的主要内容”，优先用框架数据层通常更简单。

## 3. Query 还补什么位

TanStack Query 的优势会在这些场景出现：

```txt
同一份远程数据被多个客户端组件共享
数据需要在页面停留期间后台刷新
用户会做乐观更新
数据会分页、无限滚动、局部筛选
页面内有多个独立小组件各自请求
客户端导航后希望复用缓存
需要窗口聚焦、网络恢复后的自动同步
需要精细控制 staleTime、gcTime、retry、refetchOnWindowFocus
```

例如一个 dashboard：

```txt
首屏用户信息:
  Server Component / loader 获取

通知列表:
  Query，后台刷新

任务列表:
  Query，筛选、分页、乐观更新

统计图:
  Query，按时间范围切换

设置表单:
  mutation + invalidateQueries
```

这里如果全部塞进 Server Component 或 loader，用户每做一个局部交互都可能变成路由级刷新，体验和代码都会变重。Query 的价值在于把这些“页面已经打开以后仍然活跃的远程数据”管理起来。

## 4. SSR hydration：服务端先预取，客户端接管缓存

TanStack Query 可以和 SSR 配合。基本模式是：

```txt
server:
  create QueryClient
  prefetchQuery
  dehydrate query cache
  send dehydrated state to client

client:
  HydrationBoundary receives state
  useQuery reads hydrated cache
  later refetch according to staleTime/refetch rules
```

官方参考：[TanStack Query Server Rendering & Hydration](https://tanstack.com/query/v5/docs/framework/react/guides/ssr)、[TanStack Query Hydration](https://tanstack.com/query/v5/docs/framework/react/reference/hydration)

简化示例：

```tsx
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query'

export default async function ProjectsPage() {
  const queryClient = new QueryClient()

  await queryClient.prefetchQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ProjectsClient />
    </HydrationBoundary>
  )
}
```

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'

export function ProjectsClient() {
  const { data } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  })

  return <ProjectList projects={data} />
}
```

这里发生了三件事：

1. 服务端预先把 `['projects']` 查询放进 Query cache。
2. `dehydrate` 把成功查询的缓存快照传给客户端。
3. 客户端 `useQuery` 先读 hydrated cache，不必首屏重复 loading。

这不是让 Query 取代 SSR，而是让 Query 的客户端缓存从服务端预热。

## 5. 在 RSC 里，Server Component 可以被看作一种 loader

TanStack Query 的 Advanced Server Rendering 文档给了一个很有用的心智：在 Next App Router/RSC 场景里，可以把 Server Components 理解成另一种 framework loader。

官方参考：[TanStack Query Advanced Server Rendering](https://tanstack.com/query/v5/docs/framework/react/guides/advanced-ssr)

这句话的意思是：

```txt
React Router loader:
  在路由渲染前运行，准备数据

Next Server Component:
  在服务端运行，准备组件结果和数据

TanStack Query prefetch:
  可以发生在这些服务端阶段，用来预热客户端 Query cache
```

所以 RSC + Query 的常见组合不是“在 Server Component 里用 `useQuery`”。Server Component 本身不能使用客户端 hook。更合理的是：

```txt
Server Component:
  prefetchQuery
  dehydrate
  render HydrationBoundary

Client Component:
  useQuery
  获得 hydrated data
  后续负责后台刷新、交互和 mutation
```

这和第 3 章的边界一致：Server Component 负责服务端准备，Client Component 负责浏览器里的活跃状态。

## 6. Client Component 不等于只在客户端运行

TanStack Query 官方 Advanced Server Rendering 文档也特别提醒：这里的 “server/client” 运行环境，不要和 Server Component/Client Component 一一对应。

原因是：

```txt
Server Component:
  保证只在服务端运行

Client Component:
  首次 SSR 时也可能在服务端渲染 HTML preview
  浏览器再 hydration
```

这和第 3 章、第 4 章讲的 Next 模型一致。

所以当你看到：

```tsx
'use client'

function ProjectsClient() {
  const { data } = useQuery(...)
}
```

不要立刻理解成：

```txt
这块首屏一定完全 CSR
```

更准确的是：

```txt
这个组件需要进入浏览器 bundle
它可以在首次 SSR 中生成 HTML preview
它可以通过 HydrationBoundary 读取服务端预取的 Query cache
hydration 后继续管理客户端 server state
```

只有当你使用 `dynamic(..., { ssr: false })` 或其他方式跳过服务端渲染时，它才更接近纯 CSR。

## 7. Query、Loader、RSC 怎么选

可以先用这张表判断：

| 数据类型 | 优先方案 | 原因 |
| --- | --- | --- |
| SEO 主体内容 | Server Component / loader | 需要进入早期 HTML |
| 当前路由的主数据 | Server Component / loader | 路由级数据边界更简单 |
| 表单提交后的路由数据刷新 | Server Action / route action + revalidation | 写后读由框架接管 |
| 页面内高频筛选列表 | TanStack Query | 客户端缓存、分页、刷新更自然 |
| 通知、消息、任务状态 | TanStack Query | 后台刷新、窗口聚焦刷新、共享缓存 |
| 无限滚动 | TanStack Query | infinite query 模型成熟 |
| 乐观更新 | TanStack Query mutation | 客户端体验更直接 |
| 强实时数据 | WebSocket/SSE + Query 或专用状态层 | Query 可做缓存，但实时通道另行设计 |
| 只用于一次 HTML 渲染的数据 | Server Component / loader | 不需要客户端长期缓存 |

更短的判断：

```txt
数据主要服务于“这次路由渲染”？
  -> Server Component / loader

数据在页面打开后还会持续变化、刷新、共享、乐观更新？
  -> TanStack Query

写操作完成后只是让当前路由重新拿新数据？
  -> 框架 action + revalidation

写操作需要即时局部反馈、回滚、复杂缓存同步？
  -> Query mutation
```

## 8. 和 React Router loader/action 的边界

React Router 官方 state management 文档强调，loader/action/form/revalidation 已经覆盖了很多常见 server state 场景。

官方参考：[React Router State Management](https://reactrouter.com/explanation/state-management)

比如普通 CRUD：

```txt
loader:
  读取项目列表

action:
  创建项目

automatic revalidation:
  重新读取列表
```

这种情况下，引入 Query 可能只是重复维护一套缓存。

但如果列表有这些需求：

1. 不随路由切换而丢失缓存。
2. 多个页面共享同一份项目列表缓存。
3. 后台每 30 秒刷新。
4. 离开再回来不想重新 loading。
5. 乐观创建项目，失败回滚。
6. 无限滚动和局部筛选状态复杂。

Query 就开始有价值。

所以 React Router + Query 的正确关系不是谁替代谁，而是：

```txt
loader/action:
  路由级首屏数据和提交协议

TanStack Query:
  客户端长期活跃的 server state 缓存和同步
```

## 9. 和 Next App Router 的边界

Next App Router 里，常见误用是把 Query 当成所有数据获取的默认入口：

```tsx
'use client'

function ProductPage() {
  const { data } = useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProduct(id),
  })

  return <ProductView product={data} />
}
```

如果这是 SEO 重要的商品详情主体，这样会让首屏更接近 CSR。更好的做法通常是：

```tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)

  return (
    <main>
      <ProductView product={product} />
      <BuyControls productId={product.id} />
      <RelatedProductsBoundary productId={product.id} />
    </main>
  )
}
```

然后把 Query 用在适合它的部分：

```tsx
'use client'

function BuyControls({ productId }: { productId: string }) {
  const mutation = useMutation({
    mutationFn: addToCart,
  })

  return <button onClick={() => mutation.mutate({ productId })}>加入购物车</button>
}
```

或者：

```tsx
'use client'

function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: 30_000,
  })

  return <Bell count={data.unreadCount} />
}
```

Next 的 Server Component 更适合首屏主体和服务端展示；Query 更适合浏览器里持续活跃的远程状态。

## 10. 常见误区

### 误区一：用了 RSC 就不需要 Query

不对。RSC 可以减少首屏客户端请求和 bundle，但它不负责浏览器中长期缓存、后台刷新、乐观更新、窗口聚焦刷新、无限滚动这些客户端 server state 问题。

### 误区二：用了 Query 就不需要框架数据层

不对。SEO 主体内容、路由级首屏数据、redirect、404、headers、metadata 等仍然更适合框架数据层。否则容易把 SSR 应用退回 CSR 数据瀑布。

### 误区三：所有服务端预取都值得做

不一定。prefetch/dehydrate 会增加服务端工作和 HTML/RSC payload 中的数据体积。只对首屏需要、能减少 loading 或避免瀑布的数据预取。非首屏、低优先级或很大的数据可以延迟到客户端。

### 误区四：Query cache 和 Next cache 是同一个东西

不是。Query cache 是客户端应用运行时的远程数据缓存，也可以被服务端预热后 hydrate。Next cache 是框架层面的服务端数据、路由、组件或 fetch 缓存。它们的生命周期、失效方式和作用位置不同。

### 误区五：HydrationBoundary 会自动解决所有重复请求

不一定。hydration 只是把服务端预取的查询状态注入客户端 QueryClient。之后是否 refetch，取决于 `staleTime`、query 是否 stale、组件挂载时机和配置。如果 `staleTime` 太短，客户端可能很快重新请求。

## 11. 轻量验证：Dashboard 数据如何分层

假设你要做一个登录后的 dashboard：

```txt
页面内容：
  用户基础信息
  团队列表
  通知铃铛
  最近任务
  可筛选项目列表
  创建项目表单
```

第一版分层：

```txt
Server Component / loader:
  用户基础信息
  团队列表

TanStack Query:
  通知铃铛，定时刷新
  最近任务，后台刷新
  可筛选项目列表，分页和筛选

Action / mutation:
  创建项目
```

如果用 Next：

```tsx
export default async function DashboardPage() {
  const user = await getCurrentUser()
  const teams = await getTeams(user.id)

  return (
    <main>
      <UserHeader user={user} teams={teams} />
      <NotificationBell />
      <RecentTasks />
      <ProjectExplorer />
      <CreateProjectForm />
    </main>
  )
}
```

其中：

```txt
UserHeader:
  Server Component，首屏结构数据

NotificationBell:
  Client Component + Query，后台刷新

RecentTasks:
  Client Component + Query，用户操作后可 invalidate

ProjectExplorer:
  Client Component + Query，筛选、分页、缓存

CreateProjectForm:
  Server Action 或 Query mutation，视体验需求决定
```

如果创建项目只是提交后刷新整个项目列表，Server Action + revalidate 可能够用。如果要立即把新项目插入当前筛选列表、失败回滚、同时更新多个缓存视图，Query mutation 更合适。

## 12. 本章小结

TanStack Query 在现代 SSR/RSC 体系里的位置，可以用三句话概括：

1. 框架数据层负责路由级首屏数据、SEO 主体、HTTP 语义和服务端边界。
2. TanStack Query 负责客户端长期活跃的 server state：缓存、同步、刷新、分页、乐观更新和共享状态。
3. SSR/RSC 场景下，Query 可以通过 prefetch + dehydrate + HydrationBoundary 被服务端预热，但它的核心价值仍然在客户端运行期。

所以问题不是“有了 RSC 还要不要 Query”，而是：

```txt
这份数据是页面渲染输入，还是页面打开后的活跃远程状态？
```

前者优先用框架；后者 Query 仍然非常有价值。

## 思考题

### 题 1：为什么商品详情主体不适合默认用 `useQuery` 在客户端请求？

参考答案：

商品详情主体通常是 SEO 和首屏核心内容。如果默认用客户端 `useQuery` 请求，首屏 HTML 可能缺少主体内容，更接近 CSR 数据瀑布。更合理的是用 Server Component 或 loader 先把主体内容渲染出来，再把购买控件、通知、相关推荐等适合客户端活跃状态的区域交给 Query。

### 题 2：React Router loader/action 已经能 revalidate，什么时候还需要 Query？

参考答案：

当数据超出单个路由首屏读取和提交循环，比如需要跨页面共享缓存、后台刷新、窗口聚焦刷新、分页、无限滚动、乐观更新、局部缓存失效或复杂客户端筛选时，Query 更合适。普通 CRUD 路由数据则可以优先用 loader/action。

### 题 3：`HydrationBoundary` 的作用是什么，它不负责什么？

参考答案：

`HydrationBoundary` 把服务端 dehydrate 出来的 Query cache 状态注入客户端 QueryClient，让客户端 `useQuery` 可以从预取缓存开始。它不自动决定数据是否永远新鲜，也不替代 `staleTime`、refetch、invalidateQueries 等缓存策略。

## 下一章预告

下一章会进入缓存、运行时与部署。我们会把 Next cache、Query cache、HTTP cache、CDN cache、request memoization、revalidation、Node runtime、Edge runtime 和 serverless 约束放到同一张地图里，理解现代 SSR 真正的复杂度为什么经常不在 React 本身。
