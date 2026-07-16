---
title: 第3章 React Server Components，组件模型的边界重划
date: 2026-07-15
course: 现代服务端渲染与 React 全栈架构
summary: 从 Server Component 与 Client Component 的组合关系出发，理解 RSC 如何改变数据获取、bundle 边界、组件依赖方向和交互设计。
---

# 第3章：React Server Components，组件模型的边界重划

现代 SSR 解决的是“HTML 怎样更早到达浏览器”，而 React Server Components 进一步追问的是：这棵 React 组件树里，哪些组件根本不应该进入浏览器。RSC 的本质不是取消客户端交互，而是把“服务端结构层”和“客户端交互层”变成显式架构边界。

这一章的目标是让你真正掌握 RSC 的心智模型：它和传统 SSR 有什么区别，Server Component 和 Client Component 如何组合，`use client` 到底标记了什么，为什么 props 必须可序列化，以及什么时候应该主动缩小客户端边界。

## 1. 先把三个概念分开

RSC 最容易混淆的地方，是它经常和 SSR、Server Functions、Next.js App Router 一起出现。先拆开：

```txt
SSR:
  服务端生成初始 HTML，然后客户端 hydration。

RSC:
  一部分 React 组件只在服务端运行，不进入浏览器 bundle。

Server Functions / Server Actions:
  从客户端触发、但在服务端执行的函数，常用于 mutation。
```

React 官方文档把 Server Components 定义为一种提前渲染的组件类型，它运行在独立于客户端应用或传统 SSR server 的环境中；可以在构建时运行，也可以在每次请求时运行。

官方参考：[React Server Components](https://react.dev/reference/rsc/server-components)

这句话里最重要的是“独立环境”。RSC 不是普通 React 组件在 Node 里跑一遍这么简单，而是引入了一条新的组件编译和传输路径。

## 2. Server Component 不是“静态组件”

Server Component 可以是静态的，也可以是动态的。关键不在于内容会不会变，而在于它是否需要浏览器能力。

Server Component 可以做：

1. `async/await` 读取数据。
2. 访问数据库、文件系统、内部服务。
3. 使用只应该留在服务端的依赖。
4. 渲染普通 HTML 和其他 Server Component。
5. 把可序列化数据传给 Client Component。

Server Component 不能做：

1. 使用 `useState`、`useEffect`、`useReducer` 等客户端状态和副作用。
2. 绑定 `onClick`、`onChange` 这类浏览器事件处理。
3. 直接访问 `window`、`document`、localStorage。
4. 使用依赖浏览器环境的第三方组件。
5. 在用户点击后直接在组件内部改变本地状态。

一个 Server Component 可以每次请求都读数据库：

```tsx
async function UserSummary({ userId }) {
  const user = await db.user.findUnique({ where: { id: userId } })

  return (
    <section>
      <h2>{user.name}</h2>
      <p>{user.bio}</p>
    </section>
  )
}
```

它不是静态的，但它仍然是 Server Component。因为它不需要浏览器状态，也不需要事件处理。

## 3. Client Component 是交互边界，不是“整个页面”

需要交互时，不是把整页改成客户端组件，而是把交互部分切出来。

```tsx
// app/articles/[id]/page.tsx
// Server Component
export default async function ArticlePage({ params }) {
  const article = await db.article.findUnique({
    where: { id: params.id },
  })

  return (
    <main>
      <h1>{article.title}</h1>
      <ArticleBody content={article.content} />
      <LikeButton articleId={article.id} />
    </main>
  )
}
```

```tsx
// LikeButton.tsx
'use client'

import { useState } from 'react'

export function LikeButton({ articleId }: { articleId: string }) {
  const [liked, setLiked] = useState(false)

  return (
    <button onClick={() => setLiked(true)}>
      {liked ? '已点赞' : '点赞'}
    </button>
  )
}
```

这里页面是 Server Component，但页面仍然有交互。真正进入浏览器 bundle 的，是 `LikeButton` 以及它导入的客户端依赖。

Next 官方文档也强调：默认情况下，App Router 使用 Server Components；当你需要 state、effects、事件处理或浏览器 API 时，再使用 Client Components。

官方参考：[Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)

## 4. `use client` 标记的是模块边界

`'use client'` 不是写在每个客户端组件里的装饰器，而是一个模块边界声明。

```tsx
'use client'

import { useState } from 'react'
import HeavyChart from './HeavyChart'

export function DashboardChart() {
  const [range, setRange] = useState('7d')

  return <HeavyChart range={range} onRangeChange={setRange} />
}
```

一旦某个文件顶部写了 `'use client'`，这个模块和它导入的依赖会进入客户端组件图。它的子组件如果被它导入，也会成为客户端 bundle 的一部分。

这会带来一个重要工程原则：

> `'use client'` 放得越高，客户端 bundle 边界越大；放得越低，RSC 的收益越明显。

错误倾向：

```tsx
'use client'

export default function ProductPage() {
  // 整个页面都变成客户端边界
}
```

更好的倾向：

```tsx
export default async function ProductPage() {
  const product = await getProduct()

  return (
    <>
      <ProductInfo product={product} />
      <BuyBox productId={product.id} />
    </>
  )
}
```

```tsx
'use client'

export function BuyBox({ productId }: { productId: string }) {
  // 只有购买交互进入客户端边界
}
```

React 官方 `use client` 文档也把它描述为标记哪些代码在客户端运行的边界。

官方参考：[React use client](https://react.dev/reference/rsc/use-client)

这里要特别澄清一个常见误解：在 Next.js App Router 中，Client Component 不等于纯 CSR。

首次页面加载时，Next 会在服务端完成两类工作：

```txt
Server Components:
  渲染成 RSC Payload

Client Components:
  也会参与生成初始 HTML preview
```

到浏览器后：

```txt
HTML:
  先展示一个快速但不可交互的预览

RSC Payload:
  用来对齐 Server/Client Component 树

Client Component JS:
  下载后 hydrate，让 Client Component 可交互
```

所以，一个 `LikeButton` 虽然是 Client Component，但首次访问时它通常仍然可以有服务端预渲染出来的按钮 HTML。它被称为 Client Component，是因为它需要进入浏览器 bundle，并在浏览器里 hydration 后处理点击、状态和副作用，不是因为它一定只在浏览器里从零渲染。

真正的纯 CSR 组件，是明确跳过服务端渲染的组件。在 Next 中常见写法是：

```tsx
import dynamic from 'next/dynamic'

const RichEditor = dynamic(() => import('./RichEditor'), {
  ssr: false,
})
```

这表示 `RichEditor` 的真实内容不参与服务端 HTML 生成，只在浏览器加载对应 JS 后渲染。适合富文本编辑器、地图、Canvas/WebGL、强依赖 `window` 的第三方库等非 SEO 主体区域。

因此在 Next App Router 里可以同时存在三类东西：

```txt
Server Component:
  只在服务端运行，不进浏览器 JS

Client Component with SSR preview:
  首次加载有服务端 HTML preview，随后 hydration

Pure CSR component:
  服务端跳过真实渲染，只在浏览器加载后出现
```

Next 官方文档也明确区分了首次加载和后续导航：首次加载时 HTML 会用于立即展示不可交互预览，JavaScript 再 hydrate Client Components；后续导航时，Client Components 会完全在客户端渲染，不再使用服务端生成的 HTML。

官方参考：[Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)、[Next.js Lazy Loading: Skipping SSR](https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr)

## 5. Server 到 Client 的 props 必须可序列化

Server Component 可以渲染 Client Component，也可以向它传 props。但这些 props 要能从服务端传到客户端，所以必须可序列化。

可以传：

```tsx
<LikeButton articleId={article.id} initialLiked={article.liked} />
```

通常可以传：

1. string、number、boolean。
2. plain object。
3. array。
4. null。
5. 可以序列化的日期字符串或结构化数据。

不应该传：

```tsx
<ClientWidget db={db} />
<ClientWidget onSave={() => saveToDatabase()} />
<ClientWidget formatter={new Intl.DateTimeFormat()} />
```

原因很直接：客户端拿不到数据库连接，也不能接收服务端闭包。Server Component 到 Client Component 的边界不是普通函数调用，而是跨运行时传输。

如果客户端需要触发服务端修改，有两类常见方案：

1. 调用 API route / route action。
2. 使用 Server Function / Server Action。

Server Function 是另一个概念，它解决“客户端事件如何触发服务端代码”，不等于 Server Component。

官方参考：[React Server Functions](https://react.dev/reference/rsc/server-functions)

## 6. 依赖方向：Server 可以包 Client，但 Client 不能随便拉 Server

RSC 架构里有一个核心依赖方向：

```txt
Server Component
  -> can render Server Component
  -> can render Client Component

Client Component
  -> can render Client Component
  -> should not directly import Server Component as executable code
```

但有一个重要模式：Server Component 的渲染结果可以作为 `children` 传给 Client Component。

```tsx
// Server Component
export default async function NotesPage() {
  const notes = await getNotes()

  return (
    <ExpandablePanel>
      <NotesList notes={notes} />
    </ExpandablePanel>
  )
}
```

```tsx
'use client'

export function ExpandablePanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <section>
      <button onClick={() => setOpen(!open)}>切换</button>
      {open ? children : null}
    </section>
  )
}
```

这里 `ExpandablePanel` 是 Client Component，但 `NotesList` 的内容可以由 Server Component 先算好，再作为 children 传进去。React 官方文档也用类似例子说明：Server Component 可以组合需要状态的 Client Component。

这个模式很重要，因为它让你不用为了一个展开/收起按钮，就把整个列表数据获取和渲染都搬进客户端。

更精确地说，Client Component 的“导入依赖树”里不能直接包含 Server Component，但它的 JSX 子树里可以出现已经由服务端渲染好的 Server Component 结果。

不能这样：

```tsx
'use client'

import ServerNotesList from './ServerNotesList'

export function Panel() {
  return (
    <section>
      <ServerNotesList />
    </section>
  )
}
```

这不成立的原因不是风格问题，而是技术边界问题。`Panel` 是客户端模块入口，它 import 的依赖会进入客户端模块图；但 `ServerNotesList` 可能包含数据库查询、文件系统、内部服务、密钥或只能在服务端执行的 async 逻辑。浏览器既不能执行这些代码，也不应该拿到这些依赖。

可以这样：

```tsx
// Server Component
export default async function Page() {
  const notes = await getNotes()

  return (
    <Panel>
      <NotesList notes={notes} />
    </Panel>
  )
}
```

```tsx
'use client'

export function Panel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true)

  return (
    <section>
      <button onClick={() => setOpen(!open)}>切换</button>
      {open ? children : null}
    </section>
  )
}
```

这时 `Panel` 没有获得 `NotesList` 的执行权。`NotesList` 已经在服务端渲染完成，它的结果作为 `children` 传给了客户端边界。

可以把规则记成：

```txt
Client Component 可以接收 Server Component 的渲染结果
Client Component 不能直接 import 并执行 Server Component
```

原因是 RSC 有两张模块图：

```txt
Server module graph:
  可以包含数据库、文件系统、server-only 代码、async Server Components

Client module graph:
  必须能被浏览器打包和执行
  不能包含 server-only 代码
```

`'use client'` 声明的是客户端模块图入口。它的直接 import 依赖必须能进浏览器；而通过 `children` 或 props 传入的 Server Component 结果，不属于这个客户端 import 图。Next 官方文档也明确说明：`'use client'` 影响 Client Component 的 module graph，但不影响作为 children 或其他 props 传入的 Server Component，它们在服务端渲染后作为结果传入。

## 7. RSC Payload：客户端收到的不是原始 Server Component

浏览器不会收到 Server Component 的源码，也不会执行它。

一个 Server Component：

```tsx
async function ArticleTitle({ id }) {
  const article = await db.article.findUnique({ where: { id } })
  return <h1>{article.title}</h1>
}
```

浏览器看到的不是：

```txt
ArticleTitle function + db query
```

而是类似：

```txt
rendered result:
  <h1>文章标题</h1>

client references:
  LikeButton module id
  LikeButton props
```

框架会把 Server Components 的渲染结果、Client Component 的模块引用和 props 编成 React 能理解的数据流。Next 文档里通常把这个称为 RSC Payload。

这解释了 RSC 的几个收益：

1. 数据库查询代码不进浏览器。
2. Markdown parser、HTML sanitizer 等服务端展示依赖不进浏览器。
3. 大量纯展示组件不需要 hydration。
4. 首屏数据可以在服务端组件渲染时直接准备。

也解释了它的限制：

1. Server Component 不能保存浏览器状态。
2. 不能把服务端函数随意传给客户端。
3. 组件边界会影响 bundle 和数据传输。
4. 框架和 bundler 必须理解 RSC 协议。

## 8. 一个页面如何做 RSC 边界设计

假设你要做一个商品详情页：

```txt
ProductPage
  ProductGallery
  ProductTitle
  ProductDescription
  PriceBox
  InventoryStatus
  QuantitySelector
  AddToCartButton
  RecommendationList
  ReviewList
```

第一轮边界可以这样划：

```txt
Server Component:
  ProductPage
  ProductTitle
  ProductDescription
  PriceBox
  InventoryStatus
  RecommendationList
  ReviewList

Client Component:
  ProductGallery if it has carousel interactions
  QuantitySelector
  AddToCartButton
```

注意这里 `PriceBox` 和 `InventoryStatus` 不一定是 Client Component。它们可能是动态数据，但动态不等于客户端。只要它们不需要浏览器状态，可以在服务端读取并渲染。

更合理的组件树：

```tsx
export default async function ProductPage({ params }) {
  const product = await getProduct(params.id)

  return (
    <main>
      <ProductTitle product={product} />
      <ProductDescription product={product} />
      <ProductGallery images={product.images} />
      <PriceBox productId={product.id} />
      <InventoryStatus productId={product.id} />
      <BuyControls productId={product.id} />
      <RecommendationList productId={product.id} />
    </main>
  )
}
```

```tsx
'use client'

export function BuyControls({ productId }: { productId: string }) {
  const [quantity, setQuantity] = useState(1)

  return (
    <section>
      <QuantityStepper value={quantity} onChange={setQuantity} />
      <AddToCartButton productId={productId} quantity={quantity} />
    </section>
  )
}
```

这时浏览器只需要为购买控件、图库交互等部分下载和 hydration JS。商品标题、描述、价格展示、库存展示、推荐列表都可以尽量留在服务端边界。

## 9. 常见误区

### 误区一：用了 RSC 就不需要 SSR

不对。RSC 和 SSR 是不同层面的机制。RSC 负责组件运行边界和 payload；SSR 负责把初始结果渲染成 HTML。它们经常一起使用。

### 误区二：Server Component 就是静态页面

不对。Server Component 可以按请求读取动态数据。它只是不能使用浏览器交互能力。

### 误区三：有一个按钮就要把整页写成 Client Component

不对。按钮本身做 Client Component 即可。页面结构、数据获取、展示内容仍然可以留在 Server Component。

### 误区四：`use server` 是声明 Server Component

不对。React 官方文档明确说明，没有用于 Server Component 的 directive。`'use server'` 用于 Server Functions。Server Component 通常是框架默认环境，例如 Next App Router 中默认就是 Server Component。

### 误区五：RSC 会自动让应用变快

不一定。RSC 可以减少客户端 JS 和数据瀑布，但如果你把 `'use client'` 放得过高、服务端数据请求串行、缓存策略混乱，仍然会得到复杂且慢的应用。

## 10. 轻量验证：把一个 CSR 页面改成 RSC 思维

原始 CSR 页面：

```tsx
function ArticlePage({ id }) {
  const [article, setArticle] = useState(null)
  const [related, setRelated] = useState([])

  useEffect(() => {
    fetch(`/api/articles/${id}`).then(r => r.json()).then(setArticle)
  }, [id])

  useEffect(() => {
    if (!article) return
    fetch(`/api/articles/${id}/related`).then(r => r.json()).then(setRelated)
  }, [id, article])

  if (!article) return <ArticleSkeleton />

  return (
    <main>
      <h1>{article.title}</h1>
      <ArticleBody content={article.content} />
      <LikeButton articleId={article.id} />
      <RelatedArticles items={related} />
    </main>
  )
}
```

问题：

1. 首屏内容必须等 JS 启动。
2. article 请求在组件 mount 后才开始。
3. related 请求依赖 article，容易形成瀑布。
4. 文章正文和相关依赖都可能进入客户端 bundle。

RSC 思维版本：

```tsx
export default async function ArticlePage({ params }) {
  const article = await getArticle(params.id)

  return (
    <main>
      <h1>{article.title}</h1>
      <ArticleBody content={article.content} />
      <LikeButton articleId={article.id} />

      <Suspense fallback={<RelatedArticlesSkeleton />}>
        <RelatedArticles articleId={article.id} />
      </Suspense>
    </main>
  )
}
```

```tsx
async function RelatedArticles({ articleId }: { articleId: string }) {
  const related = await getRelatedArticles(articleId)
  return <RelatedArticlesList items={related} />
}
```

```tsx
'use client'

function LikeButton({ articleId }: { articleId: string }) {
  const [liked, setLiked] = useState(false)
  return <button onClick={() => setLiked(true)}>点赞</button>
}
```

这里不是把一切都搬到服务端，而是重新分配：

1. 文章主体：服务端读取并渲染。
2. 相关推荐：服务端异步渲染，可以配合 Suspense/streaming。
3. 点赞按钮：客户端交互边界。
4. 浏览器 bundle：只包含真正需要交互的部分。

## 11. 本章小结

RSC 的核心不是“服务端渲染 HTML”，而是“组件是否需要进入客户端运行时”。它让 React 应用从过去的默认客户端组件树，变成一棵跨服务端和客户端的组件树。

你可以用三句话记住：

1. Server Component 负责数据、结构、展示和服务端依赖。
2. Client Component 负责状态、事件、浏览器 API 和交互循环。
3. 优秀的 RSC 架构不是没有客户端，而是客户端边界足够小、足够明确。

理解这一点后，Next.js App Router 的很多设计就会变得自然：为什么默认是 Server Component，为什么 `use client` 要谨慎放置，为什么 fetch/cache 和 route segment 变得重要，为什么 Server Actions 会出现在这个体系里。

## 思考题

### 题 1：为什么“动态数据”不等于“必须 Client Component”？

参考答案：

动态数据只说明数据会变化，不说明它必须在浏览器里获取。只要组件不需要浏览器状态、事件或浏览器 API，它就可以在服务端读取动态数据并渲染。比如价格、库存、用户资料摘要都可以是 Server Component。

### 题 2：为什么不应该随手把页面顶层标成 `'use client'`？

参考答案：

`'use client'` 标记的是模块边界。放在页面顶层会让整页及其导入依赖进入客户端组件图，扩大 bundle 和 hydration 成本，也会失去 RSC 留在服务端读取数据、隐藏依赖、减少客户端 JS 的收益。更好的做法是只把按钮、表单、筛选器等交互边界做成 Client Component。

### 题 3：Server Component 可以包 Client Component，为什么 Client Component 不能随便直接 import Server Component？

参考答案：

因为 Server Component 可能包含数据库、文件系统、服务端依赖和 async 数据读取逻辑，不能作为浏览器可执行代码被导入。Client Component 可以接收 Server Component 已经渲染好的结果作为 `children`，但不能把服务端组件当作普通客户端函数来执行。

## 下一章预告

下一章会进入 Next.js App Router。我们会把本章的 RSC 边界放进 Next 的文件系统路由、layout、page、loading、error、route handlers、server actions、fetch cache 和 revalidation 中，理解为什么 App Router 是 RSC 时代最典型也最复杂的工程范式。
