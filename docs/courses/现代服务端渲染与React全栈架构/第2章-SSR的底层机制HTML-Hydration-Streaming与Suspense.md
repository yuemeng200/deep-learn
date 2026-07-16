---
title: 第2章 SSR 的底层机制，HTML、Hydration、Streaming 与 Suspense
date: 2026-07-15
course: 现代服务端渲染与 React 全栈架构
summary: 理解服务端 HTML、客户端 hydration、Suspense 边界和 Streaming SSR 的协作时序，建立判断 SSR 工程风险的基础模型。
---

# 第2章：SSR 的底层机制，HTML、Hydration、Streaming 与 Suspense

现代服务端渲染不是“服务端生成 HTML 就结束了”。它真正要解决的是：用户怎样尽早看到内容，浏览器怎样逐步恢复交互，慢数据怎样不阻塞整页，以及服务端和客户端怎样在同一棵 React 树上保持一致。

这一章先不进入 Next.js 或 Remix 的文件约定，而是把 SSR 的底层链路拆开。只要你理解了 HTML、hydration、Suspense、streaming 的时序，后面再看 App Router、React Router data APIs、TanStack Query hydration，就不会把它们混成一团。

## 1. 普通 SSR 的五步链路

传统 SSR 可以拆成五步：

```txt
1. Server fetches all required data
2. Server renders React tree to HTML
3. Server sends HTML/CSS/JS references to browser
4. Browser displays non-interactive HTML
5. Browser downloads JS and hydrates the page
```

Next.js 官方文档也用类似链路解释无 streaming 的 SSR：先在服务端获取页面所有数据，再生成 HTML，然后把 HTML、CSS、JavaScript 发送到客户端，用户先看到不可交互 UI，最后 React hydration 让它可交互。

官方参考：[Next.js Loading UI and Streaming](https://nextjs.org/docs/14/app/building-your-application/routing/loading-ui-and-streaming)

这个链路里有两个容易被忽略的事实：

1. **HTML 可见不等于页面可交互。**
2. **服务端渲染和客户端 hydration 是两次不同环境下的 React 工作。**

SSR 改善的是“用户更早看到有意义内容”，但只要页面需要客户端交互，浏览器仍然要下载 JS、执行 JS、绑定事件、恢复状态。

## 2. Hydration 到底在做什么

React 官方的 `hydrateRoot` 用来把服务端已经生成的 HTML 接管成一个可交互的 React 应用。它不是重新创建一棵 DOM，而是在已有 DOM 上建立 React 的事件、状态和组件关联。

官方参考：[React hydrateRoot](https://react.dev/reference/react-dom/client/hydrateRoot)

可以把 hydration 理解成：

```txt
Server HTML:
  <button>点赞</button>

Client React:
  <LikeButton />

Hydration:
  React recognizes this button
  React attaches event handlers
  React connects it to component state
```

如果没有 hydration，用户可能看得到按钮，但点了没有 React 交互。HTML 只是“画面”，hydration 之后才变成“应用”。

这也是 SSR 工程里常见误区的来源：

```txt
SSR improves first meaningful pixels.
Hydration determines when those pixels become interactive.
```

首屏内容快，不代表交互快。如果页面把大量组件都做成 Client Component，或者客户端 bundle 很大，用户可能很早看到 HTML，但很晚才能真正操作。

## 3. Hydration mismatch 为什么麻烦

hydration 要求服务端生成的 HTML 和客户端第一次渲染的结果匹配。否则 React 接管 DOM 时会发现：服务端说这里是 A，客户端第一次算出来是 B。

典型 mismatch 来源：

```tsx
function TimeLabel() {
  return <span>{new Date().toLocaleString()}</span>
}
```

服务端渲染时间和客户端 hydration 时间不同，结果可能不一致。

再比如：

```tsx
function WidthLabel() {
  return <span>{window.innerWidth}</span>
}
```

服务端没有 `window`，这段代码本身就不能安全跑在服务端。

还有更隐蔽的：

```tsx
function Greeting() {
  const name = localStorage.getItem('name')
  return <p>Hello {name}</p>
}
```

localStorage 只存在于浏览器，服务端不知道它的值。如果第一次客户端渲染依赖 localStorage，就容易和服务端 HTML 不一致。

实际工程里，hydration mismatch 通常来自这些类型：

1. 时间、随机数、浏览器环境。
2. 服务端和客户端读取的数据不是同一份。
3. 根据屏幕宽度、localStorage、cookie 做了不一致的首次渲染。
4. 第三方组件内部使用浏览器 API。
5. HTML 结构不合法，浏览器自动修正 DOM 后和 React 预期不一致。

SSR 不是简单地“代码跑两边”。你要保证：参与服务端渲染的组件，在服务端和客户端首次渲染时能得到同样的结构。

## 4. 普通 SSR 的阻塞问题

普通 SSR 的最大问题不是“服务端慢”，而是“慢的部分阻塞快的部分”。

假设一个页面由三块组成：

```txt
Header:     20ms
Article:    80ms
Comments: 1200ms
```

普通 SSR 往往会变成：

```txt
wait Header
wait Article
wait Comments
render full HTML
send response
```

用户等到 1200ms 之后才能看到完整 HTML。即使 Header 和 Article 很快，它们也被 Comments 拖住了。

这就是 Streaming SSR 要解决的问题。

## 5. Streaming SSR 的时序模型

Streaming SSR 允许服务端把 HTML 拆成多个 chunk，准备好的部分先发，慢的部分后发。

React 的服务端 renderer 可以围绕 `<Suspense>` 边界生成分块 HTML。Next.js App Router 进一步把这个能力接到路由、`loading.tsx`、布局和异步 Server Component 上。

官方参考：[Next.js Streaming Guide](https://nextjs.org/docs/app/guides/streaming)、[React renderToPipeableStream](https://react.dev/reference/react-dom/server/renderToPipeableStream)

时序大致是：

```txt
Request arrives
  -> Server renders layout and fast content
  -> Server sends first HTML chunk
  -> Browser paints shell
  -> Slow Suspense boundary is still pending
  -> Server sends fallback or keeps placeholder
  -> Slow data resolves
  -> Server streams completed HTML chunk
  -> Browser patches the streamed content into page
  -> Client JS hydrates relevant boundaries
```

关键变化是：

```txt
普通 SSR:
  slowest part decides when the whole page appears

Streaming SSR:
  each Suspense boundary decides when that part appears
```

这不是让慢接口变快，而是改变用户等待的形状。

## 6. Suspense 在 CSR 和 Streaming SSR 中有什么不同

你前面问到这个点，它非常关键。

CSR 里的 Suspense 主要是客户端渲染期间的等待边界：

```txt
Browser loads JS
  -> React starts rendering
  -> Component suspends
  -> Browser shows fallback
  -> Data/code ready
  -> Browser renders real UI
```

Streaming SSR 里的 Suspense 同时是服务端响应流的切片边界：

```txt
Request reaches server
  -> Server renders fast parts first
  -> Server sends HTML shell immediately
  -> Suspense fallback can be part of server HTML
  -> Slow data ready
  -> Server streams real HTML chunk later
  -> Browser patches content into page
  -> Client hydrates interactive parts
```

差异可以压缩成一张表：

| 维度 | CSR Suspense | Streaming SSR Suspense |
| --- | --- | --- |
| fallback 由谁产生 | 浏览器里的 React | 服务端可以先输出 fallback HTML |
| 真实内容在哪里生成 | 多数在浏览器生成 | 可以在服务端生成并流式发送 |
| 是否依赖 JS 启动后才可见 | 通常依赖 | 不一定，HTML chunk 可先到 |
| 边界作用 | 客户端加载状态边界 | 服务端渲染切片 + 网络传输边界 + hydration 边界 |
| SEO 影响 | 弱，核心内容可能晚到 | 取决于核心内容是否在早期 HTML/chunk 中 |

所以，Streaming SSR 不是“CSR Suspense 换个名字”。它用同一个 Suspense 抽象，把等待状态从浏览器内部扩展到了服务端响应流。

## 7. Streaming 和 SEO 的边界

Streaming SSR 不是不能 SEO，但 SEO 效果取决于关键内容什么时候进入 HTML。

可以分三类：

```txt
SEO 核心内容在首个 HTML chunk:
  通常较稳

SEO 核心内容在后续较早 chunk:
  可能可行，但要控制延迟和爬虫表现

SEO 核心内容只在客户端 JS 请求后生成:
  风险最高，更接近 CSR
```

实战规则是：

```txt
SEO-critical:
  title, h1, canonical, meta, structured data, article body, product main info
  -> 放在早期 HTML 或稳定 server render 中

SEO-secondary:
  related posts, reviews, recommendations, comments, ads
  -> 可以 streaming 或客户端延迟加载

Personalized:
  user coupon, private state, dashboard widgets
  -> 不作为公开 SEO 主体
```

所以文章页不应该这样设计：

```tsx
<Suspense fallback={<ArticleSkeleton />}>
  <EntireArticleBody />
</Suspense>
```

如果 `EntireArticleBody` 是 SEO 主体，而且很晚才流回来，就会削弱页面可索引稳定性。

更合理的是：

```tsx
<ArticleHeader />
<ArticleBody />

<Suspense fallback={<RelatedSkeleton />}>
  <RelatedArticles />
</Suspense>
```

让正文尽早进入 HTML，把慢的推荐、评论、广告放到后面的边界。

## 8. Hydration 也可以被拆分

Streaming SSR 解决“HTML 何时到达”，但页面交互还取决于 hydration。

React 和框架可以围绕 Suspense 边界更细粒度地组织 hydration。一个页面不必等所有 JS 都下载完、所有区域都 ready，才开始接管已经到达的部分。

可以这样理解：

```txt
HTML streaming:
  Which visual parts can arrive first?

Selective / boundary hydration:
  Which interactive parts can become usable first?
```

这对复杂页面很重要。例如：

```txt
Header navigation:
  应该尽快可交互

Article body:
  主要是阅读，可先 HTML 可见

Comment editor:
  需要交互，但可以晚一点 hydrate

Recommendation list:
  可以更低优先级
```

现代 SSR 的性能优化不是单一指标，而是同时控制：

1. TTFB：服务器多久开始返回响应。
2. FCP：用户多久看到第一批内容。
3. LCP：主要内容多久出现。
4. TTI / INP：用户多久能稳定交互，交互延迟如何。
5. JavaScript bundle：为了交互必须下载和执行多少代码。

## 9. 轻量验证：一个博客详情页怎么拆

假设你有一个博客详情页：

```txt
ArticleLayout
  Header
  ArticleTitle
  AuthorInfo
  ArticleBody
  TableOfContents
  RelatedPosts
  CommentList
  CommentEditor
```

第一轮拆分可以是：

```txt
早期 HTML:
  Header
  ArticleTitle
  AuthorInfo
  ArticleBody
  TableOfContents

Streaming Suspense:
  RelatedPosts
  CommentList

Client Components:
  CommentEditor
  LikeButton
  ShareMenu
```

如果文章正文来自 CMS 且读取很快，可以让它参与早期 server render。RelatedPosts 和 CommentList 慢一些也没关系，因为它们不是 SEO 主体。CommentEditor 需要输入状态、提交、错误提示，应该是 Client Component 或包含 Client Component。

一个简化结构：

```tsx
export default async function ArticlePage({ params }) {
  const article = await getArticle(params.slug)

  return (
    <main>
      <ArticleHeader article={article} />
      <ArticleBody content={article.content} />

      <Suspense fallback={<RelatedPostsSkeleton />}>
        <RelatedPosts articleId={article.id} />
      </Suspense>

      <Suspense fallback={<CommentsSkeleton />}>
        <CommentList articleId={article.id} />
      </Suspense>

      <CommentEditor articleId={article.id} />
    </main>
  )
}
```

这里的判断逻辑是：

1. SEO 主体优先稳定输出。
2. 慢但次要的区域用 Suspense/streaming。
3. 需要浏览器状态的编辑器放进客户端边界。
4. 不让评论和推荐决定整页何时可见。

## 10. 本章小结

SSR 的底层模型可以总结成四句话：

1. SSR 先解决 HTML 可见，不直接等于交互可用。
2. Hydration 是客户端把服务端 HTML 接管成 React 应用的过程。
3. Suspense 在 Streaming SSR 中不仅是 loading 边界，也是服务端响应流的切片边界。
4. 现代 SSR 的关键不是“整页服务端渲染”，而是用边界控制哪些内容先到、哪些内容后到、哪些内容需要交互。

到这里，你应该能看出：Next.js App Router、React Router loader/action、TanStack Query hydration 其实都绕不开这组底层问题。它们只是把数据、HTML、JS 和交互边界组织成了不同框架模型。

## 思考题

### 题 1：为什么 SSR 页面已经显示了按钮，按钮却可能点不了？

参考答案：

因为服务端 HTML 只是静态 DOM。按钮要可交互，需要客户端下载对应 JavaScript，并通过 hydration 把事件处理函数和组件状态接到已有 DOM 上。在 hydration 完成前，用户可能看得到按钮，但 React 事件还没有接管。

### 题 2：Streaming SSR 为什么不等于“SEO 自动更好”？

参考答案：

Streaming 只是让 HTML 分块到达。如果 SEO 主体内容在首个或早期 chunk 中，通常有利；如果正文、商品主信息等核心内容被放进很晚才 resolve 的 Suspense 边界，爬虫可能更难稳定获取。Streaming 的正确用法是让核心内容尽早输出，把慢的次要内容延后。

### 题 3：Hydration mismatch 的本质是什么？

参考答案：

本质是服务端生成的 HTML 和客户端第一次 React 渲染结果不一致。常见原因包括时间、随机数、浏览器 API、localStorage、屏幕宽度、cookie 差异、数据源不一致或非法 HTML 结构。解决思路是让首次渲染在服务端和客户端得到一致结构，把浏览器专属逻辑放到客户端边界或 effect 中。

## 下一章预告

下一章会深入 React Server Components。我们会从“Server Component 和 Client Component 到底怎么组合”开始，进一步讲 RSC payload、`use client` 边界、props 传递限制、server/client 依赖方向，以及为什么 RSC 会重塑 React 应用的数据获取方式。
