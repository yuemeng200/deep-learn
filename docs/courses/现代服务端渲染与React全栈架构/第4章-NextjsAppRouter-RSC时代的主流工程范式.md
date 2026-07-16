---
title: 第4章 Next.js App Router，RSC 时代的主流工程范式
date: 2026-07-15
course: 现代服务端渲染与 React 全栈架构
summary: 理解 Next.js App Router 如何把路由、布局、RSC、数据获取、缓存、Streaming 和 mutation 组织成一套端到端工程模型。
---

# 第4章：Next.js App Router，RSC 时代的主流工程范式

React Server Components 改变的是组件运行边界；Next.js App Router 则把这套边界落成了一个完整应用框架：路由段决定页面结构，layout 决定共享 UI，Server Component 决定数据和展示边界，Client Component 决定交互边界，Suspense 决定 streaming 边界，缓存和 revalidation 决定性能与新鲜度。

这一章的重点不是背 Next 文件名，而是理解 App Router 的设计哲学：它把“路由”升级成了渲染、数据、缓存、错误、加载态和 mutation 的组织单元。

## 1. App Router 解决的不是“换一种路由写法”

Pages Router 时代，你经常围绕页面级函数组织 SSR/SSG：

```txt
pages/blog/[slug].tsx
  getStaticProps
  getStaticPaths
  getServerSideProps
```

App Router 的中心不再是这些页面级数据函数，而是：

```txt
app/
  layout.tsx
  page.tsx
  loading.tsx
  error.tsx
  route.ts
  actions.ts
```

它的核心变化是：

1. 路由段变成 UI、数据和缓存边界。
2. 默认使用 Server Components。
3. 数据获取可以发生在 Server Component 中。
4. loading/error 可以自然嵌入嵌套路由结构。
5. Streaming 和 Suspense 成为页面渲染的默认思路。
6. mutation 可以通过 Server Functions/Server Actions 与缓存失效联动。

官方参考：[Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

## 2. 路由段是 App Router 的基本架构单元

App Router 的目录结构不是纯粹的 URL 映射。每一级目录都是一个 route segment，也是一层可组合的 UI 边界。

```txt
app/
  layout.tsx
  page.tsx
  dashboard/
    layout.tsx
    loading.tsx
    error.tsx
    page.tsx
    settings/
      page.tsx
```

访问 `/dashboard/settings` 时，组件结构大致是：

```txt
RootLayout
  DashboardLayout
    SettingsPage
```

这带来的直接结果是：

1. 父 layout 可以保持稳定，不必在子页面切换时重建。
2. 每个 route segment 可以有自己的 loading 和 error 边界。
3. 数据、缓存和动态性可以沿路由树逐层组合。
4. Streaming 可以按 segment 和 Suspense 边界逐步输出。

所以 App Router 的心智不是“URL 对应一个页面文件”，而是“URL 对应一棵嵌套路由组件树”。

## 3. `layout.tsx` 和 `page.tsx` 的分工

`page.tsx` 是某个路由可访问的叶子页面：

```tsx
// app/products/[id]/page.tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)
  return <ProductDetail product={product} />
}
```

`layout.tsx` 是一层共享外壳：

```tsx
// app/products/layout.tsx
export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <section>
      <ProductsNav />
      {children}
    </section>
  )
}
```

这和 CSR 里的 layout route 看起来类似，但在 App Router 中更强：

1. layout 默认也是 Server Component。
2. layout 可以自己读取数据。
3. layout 可以包裹 Suspense、error、loading 边界。
4. layout 的缓存和动态性会影响下面的 route tree。

设计 layout 时要避免一个常见错误：把太多用户强个性化或高频变化的数据放在很高层的 layout。越高层越容易影响更多子路由的缓存和重渲染行为。

## 4. 数据获取：从组件副作用变成渲染输入

CSR 里常见模型是：

```txt
component mounts
  -> useEffect / query hook fetches data
  -> setState
  -> rerender
```

App Router 的 Server Component 模型更像：

```txt
request or prerender starts
  -> Server Component awaits data
  -> rendered result becomes part of RSC payload / HTML
```

例如：

```tsx
export default async function ProductPage({ params }) {
  const product = await db.product.findUnique({
    where: { id: params.id },
  })

  return (
    <main>
      <h1>{product.name}</h1>
      <ProductDescription product={product} />
      <BuyControls productId={product.id} />
    </main>
  )
}
```

这里数据获取不是组件挂载后的副作用，而是渲染这棵 Server Component 树的输入。Next 官方数据获取文档也明确说明，在 Server Components 中可以使用 `fetch`、ORM 或数据库等异步 I/O。

官方参考：[Next.js Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data)

这会改变你的架构直觉：

```txt
CSR:
  组件先出现，再获取数据

App Router:
  服务端组件可以先获取数据，再形成页面结构
```

但这不意味着所有数据都应该放到 Server Component。高频交互、后台刷新、乐观更新、局部筛选等仍然可能更适合 Client Component + TanStack Query 或框架 mutation。

## 5. Client Component 在 App Router 中的位置

App Router 默认是 Server Component，但 Client Component 仍然非常重要。它负责浏览器里真正会变的部分：

1. 点击、输入、拖拽。
2. 本地状态。
3. 浏览器 API。
4. 第三方客户端库。
5. 富交互图表、编辑器、地图。

推荐结构不是：

```tsx
'use client'

export default function ProductPage() {
  // 整页客户端化
}
```

而是：

```tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)

  return (
    <main>
      <ProductInfo product={product} />
      <BuyControls productId={product.id} />
    </main>
  )
}
```

```tsx
'use client'

export function BuyControls({ productId }: { productId: string }) {
  const [quantity, setQuantity] = useState(1)

  return (
    <>
      <QuantityStepper value={quantity} onChange={setQuantity} />
      <AddToCartButton productId={productId} quantity={quantity} />
    </>
  )
}
```

第 3 章已经讲过：Client Component 首次加载时通常仍然可以有服务端 HTML preview，不等于纯 CSR。纯 CSR 要用类似 `dynamic(..., { ssr: false })` 的方式明确跳过服务端渲染。

## 6. `loading.tsx`、Suspense 与 Streaming

App Router 把 loading UI 做成路由段能力：

```txt
app/dashboard/loading.tsx
app/dashboard/page.tsx
```

当 `dashboard/page.tsx` 或它下面的异步内容还没准备好时，`loading.tsx` 可以先作为 fallback。它本质上是 Suspense 边界的框架化表达。

你也可以手动使用 Suspense：

```tsx
export default async function DashboardPage() {
  return (
    <main>
      <Summary />

      <Suspense fallback={<ChartSkeleton />}>
        <SlowChart />
      </Suspense>

      <Suspense fallback={<ActivitySkeleton />}>
        <ActivityFeed />
      </Suspense>
    </main>
  )
}
```

这里 `Summary` 可以先输出，`SlowChart` 和 `ActivityFeed` 各自等待。第 2 章讲过，Streaming 的价值是改变阻塞关系，而不是让慢数据变快。

官方参考：[Next.js Streaming](https://nextjs.org/docs/app/guides/streaming)

## 7. 缓存：Next 当前有新旧两套心智

Next 的缓存是 App Router 最复杂的部分之一。到 2026 年，官方文档已经把 `Cache Components` 作为当前起步路径，同时仍保留以前的 `fetch` cache/revalidation 模型。

官方参考：[Next.js Caching](https://nextjs.org/docs/app/getting-started/caching)、[Next.js Caching and Revalidating Previous Model](https://nextjs.org/docs/app/guides/caching-without-cache-components)

你需要先掌握两层判断：

```txt
这段内容能不能缓存？
  -> 如果能，缓存多久或由什么事件失效？

这个路由是不是必须按请求动态渲染？
  -> 如果必须，哪些子区域仍然可以缓存？
```

上一代模型里，常见写法是：

```tsx
await fetch('https://api.example.com/products', {
  next: { revalidate: 3600 },
})
```

或者：

```tsx
await fetch('https://api.example.com/user', {
  cache: 'no-store',
})
```

Next 扩展了服务端 `fetch`，让它可以声明持久缓存和 revalidation 语义。官方 `fetch` 文档明确说明：在服务端，`cache` 选项表示请求如何与框架的持久缓存交互，而不是浏览器 HTTP cache。

官方参考：[Next.js fetch](https://nextjs.org/docs/app/api-reference/functions/fetch)

当前 `Cache Components` 模型则进一步把“哪些内容可缓存、哪些内容动态”推向组件边界。对你现在的学习目标，先不用急着死记 API，而要记住这个判断：

> App Router 的性能不是靠“整页静态”或“整页动态”，而是靠 route segment、component、fetch/cache、Suspense 和 revalidation 的组合边界。

## 8. Revalidation：mutation 之后如何让页面更新

只会读取数据不够，真实应用还要修改数据。Next 的当前文档把 mutation 主要放在 React Server Functions / Server Actions 语境里。

官方参考：[Next.js Mutating Data](https://nextjs.org/docs/app/getting-started/mutating-data)、[Next.js revalidatePath](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)

典型结构：

```tsx
// app/actions.ts
'use server'

import { revalidatePath } from 'next/cache'

export async function updateProduct(id: string, formData: FormData) {
  await db.product.update({
    where: { id },
    data: {
      name: String(formData.get('name')),
    },
  })

  revalidatePath(`/products/${id}`)
}
```

页面中：

```tsx
export function ProductForm({ productId }: { productId: string }) {
  return (
    <form action={updateProduct.bind(null, productId)}>
      <input name="name" />
      <button type="submit">保存</button>
    </form>
  )
}
```

这里要理解三件事：

1. Server Action 在服务端执行，不是把数据库逻辑发到浏览器。
2. mutation 后需要让相关缓存失效，否则页面可能继续显示旧数据。
3. `revalidatePath`、`revalidateTag`、`refresh` 等能力都是为了把“写操作”和“读缓存”重新接起来。

这也是 App Router 复杂度的来源：它不是只给你一个请求接口，而是在管理读、写、缓存、重新渲染和客户端路由状态之间的关系。

## 9. Route Handlers：不是所有服务端逻辑都要写成 Server Action

`route.ts` 用来定义 HTTP route handler：

```tsx
// app/api/products/route.ts
export async function GET() {
  const products = await db.product.findMany()
  return Response.json(products)
}
```

它适合：

1. 给第三方系统提供 HTTP API。
2. webhook。
3. 文件上传或下载。
4. 非 React 客户端也要调用的接口。
5. 需要明确 HTTP 方法、header、status、stream response 的场景。

Server Action 更适合 React 应用内部的 form mutation 或客户端触发服务端函数。Route Handler 更像传统 HTTP 边界。二者都能访问服务端资源，但语义不同。

一个实用判断：

```txt
这个操作是 React UI 内部的一次 mutation？
  -> Server Action 可以优先考虑

这个能力需要作为稳定 HTTP API 暴露？
  -> Route Handler 更合适
```

## 10. App Router 的收益和代价

收益：

1. 默认 Server Component，减少不必要客户端 JS。
2. 数据获取靠近组件和服务端资源。
3. 路由段天然支持 layout、loading、error、streaming。
4. 缓存和 revalidation 能和页面结构联动。
5. mutation 可以直接进入服务端函数语义。

代价：

1. 心智模型复杂，不再是单纯 CSR。
2. Server/Client 边界设计不当会造成 bundle 膨胀或运行时错误。
3. 缓存规则需要系统管理，否则容易出现旧数据、过度动态或难以调试。
4. Server Actions、Route Handlers、Client Query、RSC 数据获取之间需要清晰分工。
5. 部署环境会影响行为，例如 Node runtime、Edge runtime、serverless cold start、数据库连接。

所以 Next App Router 不是“更简单的 React”，而是一个更完整也更有约束的全栈 React 应用模型。

## 11. 轻量验证：设计一个商品详情页

需求：

```txt
商品标题、描述、图片：
  公开内容，SEO 重要，变化不频繁

价格、库存：
  变化较频繁，但不一定秒级实时

购买控件：
  需要数量选择、加入购物车、错误提示

推荐商品：
  慢查询，非 SEO 主体

评论：
  可以分页或延迟加载
```

一种 App Router 结构：

```txt
app/products/[id]/
  page.tsx
  loading.tsx
  error.tsx
  components/
    ProductInfo.tsx
    PriceBox.tsx
    BuyControls.tsx
    Recommendations.tsx
```

页面：

```tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)

  return (
    <main>
      <ProductInfo product={product} />
      <PriceBox productId={product.id} />
      <BuyControls productId={product.id} />

      <Suspense fallback={<RecommendationsSkeleton />}>
        <Recommendations productId={product.id} />
      </Suspense>
    </main>
  )
}
```

边界判断：

```txt
ProductInfo:
  Server Component，可缓存或 revalidate

PriceBox:
  Server Component，短缓存或按需 revalidate

BuyControls:
  Client Component，处理数量和按钮状态

Recommendations:
  Server Component + Suspense/streaming，避免阻塞主体

Add to cart:
  Server Action 或 Route Handler，mutation 后按需 refresh/revalidate
```

这就是 App Router 的典型工程范式：不是问“这个页面 SSR 还是 CSR”，而是把页面拆成数据、缓存、交互和 streaming 边界。

## 12. 本章小结

Next.js App Router 的核心不是文件系统路由，而是把 React Server Components 的边界扩展成完整应用架构。

你可以用五句话记住：

1. Route segment 是 UI、数据、加载态、错误和缓存的组织单元。
2. Server Component 默认负责数据、结构和非交互展示。
3. Client Component 负责浏览器交互，但不等于纯 CSR。
4. Suspense/loading 把慢内容从整页阻塞中拆出来。
5. 缓存与 revalidation 是 App Router 真正的复杂度中心。

到这里，你应该已经能看懂 Next App Router 为什么强大，也能看出它为什么容易让团队心智过载。它要求前端工程师同时理解 React 组件树、HTTP、缓存、服务端运行时和部署约束。

## 思考题

### 题 1：为什么 App Router 中的 `layout.tsx` 不应该随便读取强个性化数据？

参考答案：

layout 位于路由树较高层，会包裹多个子页面。如果高层 layout 读取强个性化或高频动态数据，可能让更多子路由受到动态渲染和缓存失效影响。更好的做法是把个性化区域下沉到需要它的路由段或组件边界中。

### 题 2：Client Component 和 `dynamic(..., { ssr: false })` 的区别是什么？

参考答案：

Client Component 表示组件需要进入浏览器 bundle 并 hydration，但首次加载时通常仍可由服务端生成 HTML preview。`dynamic(..., { ssr: false })` 明确跳过服务端真实渲染，这块内容只在浏览器加载 JS 后出现，更接近纯 CSR。

### 题 3：为什么 mutation 之后要考虑 revalidation？

参考答案：

因为 App Router 中很多读取结果可能被缓存。写入数据库后，如果不让相关 path、tag 或缓存条目失效，页面可能继续展示旧数据。Server Action 或 Route Handler 负责修改数据，`revalidatePath`、`revalidateTag` 或 `refresh` 负责让读侧重新获得新结果。

## 下一章预告

下一章会进入 Remix 到 React Router v7 的路线。我们会对照 Next App Router，理解另一种以 Web 标准、nested routes、loader/action、form mutation 和 progressive enhancement 为中心的现代 SSR 架构。
