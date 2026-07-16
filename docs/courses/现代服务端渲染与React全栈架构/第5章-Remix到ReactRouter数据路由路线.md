---
title: 第5章 Remix 到 React Router，另一条以 Web 与数据路由为中心的路线
date: 2026-07-15
course: 现代服务端渲染与 React 全栈架构
summary: 对照 Next.js App Router，理解 Remix/React Router 如何用 nested routes、loader、action、Form、pending state 和 revalidation 组织现代 SSR 应用。
---

# 第5章：Remix 到 React Router，另一条以 Web 与数据路由为中心的路线

Next.js App Router 的核心路线，是把 React Server Components 放到架构中心：组件树本身跨越服务端和客户端。Remix/React Router 这条路线则不同，它更强调 Web 标准和数据路由：URL、HTTP method、loader、action、form submission、redirect、headers、cache-control、pending state 和 revalidation。

这一章的目标不是让你在 Next 和 React Router 之间站队，而是理解现代 SSR 的另一种高水平答案：不把数据获取塞进组件副作用，也不一定把 RSC 作为中心，而是让“路由”成为数据读取和写入的协议边界。

## 1. 先校准版本现状

Remix 的很多框架能力已经进入 React Router 的 Framework Mode。React Router 官方文档现在把它描述为一个 multi-strategy router：Declarative Mode、Data Mode、Framework Mode 分别覆盖不同复杂度。

官方参考：[React Router Picking a Mode](https://reactrouter.com/start/modes)

到 2026 年，React Router 官方站点已经以 v8 作为当前入口，并说明 v8 是一次非破坏性升级；但 Remix 并入 React Router、Framework Mode 成为主线框架能力这个关键转折，发生在 React Router v7。因此本章沿用课程大纲里的“Remix 到 React Router v7”这个历史脉络，但你在真实项目里应按当前 React Router v8 文档理解。

官方参考：[React Router](https://reactrouter.com/)

## 2. 这条路线的核心问题

CSR 常见数据流是：

```txt
route renders component
  -> component mounts
  -> useEffect / query hook fetches data
  -> component renders data
```

React Router Data/Framework Mode 的核心思想是：

```txt
route match happens
  -> route loaders run
  -> data is ready for route components
  -> components render with loader data
```

也就是说，数据获取从“组件副作用”提升到了“路由匹配的一部分”。

mutation 也类似。CSR 常见写法是：

```txt
button click
  -> fetch POST /api
  -> manually update local state or invalidate query
```

React Router/Remix 路线是：

```txt
form submits
  -> route action handles mutation
  -> router automatically revalidates affected loader data
  -> UI updates from server truth
```

这就是它和 Next App Router 最大的哲学差异：Next 用组件边界和 RSC 重构数据获取；React Router 用路由数据协议和 Web 表单语义重构数据获取与提交。

## 3. Nested Routes：不只是嵌套路由，也是嵌套数据

React Router 的 nested routes 不只是 UI 嵌套，也意味着每个路由模块都可以声明自己的 loader/action。

一个典型结构：

```txt
routes/
  root.tsx
  dashboard.tsx
  dashboard.projects.tsx
  dashboard.projects.$id.tsx
```

URL `/dashboard/projects/123` 命中时，不只是渲染一个叶子页面，而是形成嵌套路由树：

```txt
root
  dashboard
    dashboard.projects
      dashboard.projects.$id
```

每一层都可以有自己的数据：

```txt
root loader:
  当前用户、全局配置

dashboard loader:
  dashboard 权限、团队信息

projects loader:
  项目列表

project detail loader:
  项目详情
```

这和 Next App Router 的 route segment 有相似点：它们都不只是 URL 映射，而是在用路由层级组织 UI 和数据。但 React Router 的中心概念不是 Server Component，而是 route module 的 loader/action。

## 4. Loader：路由级数据读取

一个 loader 负责在路由渲染前准备数据。

```tsx
import type { Route } from './+types/project'

export async function loader({ params }: Route.LoaderArgs) {
  const project = await getProject(params.id)

  if (!project) {
    throw new Response('Not Found', { status: 404 })
  }

  return { project }
}

export default function ProjectPage({ loaderData }: Route.ComponentProps) {
  const { project } = loaderData

  return (
    <main>
      <h1>{project.name}</h1>
      <p>{project.description}</p>
    </main>
  )
}
```

这个模型有几个重要特点：

1. 数据读取和 URL 匹配绑定。
2. 组件不需要在 mount 后再请求首屏数据。
3. 404、redirect、headers 等可以用 HTTP 语义表达。
4. SSR 和客户端导航可以复用同一套路由数据模型。

React Router 官方文档把 Data Mode 描述为通过把 route config 移到 React render 之外，增加 loader、action、pending state 等能力。

官方参考：[React Router Picking a Mode](https://reactrouter.com/start/modes)

## 5. Action：路由级 mutation

action 负责处理写操作，尤其是表单提交。

```tsx
export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData()

  await updateProject(params.id, {
    name: String(formData.get('name')),
  })

  return redirect(`/projects/${params.id}`)
}

export default function EditProject({ loaderData }: Route.ComponentProps) {
  const { project } = loaderData

  return (
    <Form method="post">
      <input name="name" defaultValue={project.name} />
      <button type="submit">保存</button>
    </Form>
  )
}
```

这里最值得注意的是 `<Form>`。它不是普通 React 组件包一层 `fetch` 而已，它继承了 Web 表单的语义：

```txt
method="post"
  -> route action handles mutation

redirect(...)
  -> browser/router follows navigation semantics

loader revalidation
  -> mutation 后重新读取相关数据
```

这条路线的核心收益是：mutation 不再只是“客户端发一个 API 请求，然后你手动维护缓存”，而是重新回到 Web 的 request/response 模型，同时保留 React 应用的客户端导航体验。

## 6. Progressive Enhancement：没有 JS 也应该有基本语义

Remix/React Router 路线非常强调 progressive enhancement。一个 `<Form method="post">` 即使在 JavaScript 失效或还没加载完成时，也应该尽量保留基本提交语义。

这和很多 CSR 应用的心智不同。CSR 常常默认：

```txt
没有 JS，应用基本不可用
```

Remix/React Router 更倾向：

```txt
HTML 和 HTTP 先成立
JS 再增强体验
```

这不是说所有应用都必须无 JS 可用。复杂后台、编辑器、实时协作当然离不开 JS。但这个设计哲学会影响架构质量：

1. 表单提交更接近原生 Web。
2. redirect、status、headers 更自然。
3. 加载态和 pending state 由路由器感知。
4. 浏览器和服务器的职责更清晰。

## 7. Pending State 与 Optimistic UI

在 CSR 里，pending state 通常由组件自己维护：

```tsx
const [isSaving, setIsSaving] = useState(false)

async function onSubmit() {
  setIsSaving(true)
  await fetch('/api/save', { method: 'POST' })
  setIsSaving(false)
}
```

React Router 中，路由器知道当前是否在导航、提交、重新验证数据。你可以用相关 hooks 读取这个状态，例如 navigation、fetcher 等。

抽象上是：

```txt
router knows:
  current navigation
  current form submission
  pending loader/action
  revalidation state
```

这让 pending UI 不再散落在每个组件里，而是由路由数据流驱动。

比如：

```tsx
function SaveButton() {
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  return (
    <button disabled={isSubmitting}>
      {isSubmitting ? '保存中' : '保存'}
    </button>
  )
}
```

更复杂的局部提交可以用 `useFetcher`，它适合不触发完整导航的局部 mutation，例如收藏、删除列表项、添加到购物车。

## 8. Revalidation：框架自动帮你把写和读接起来

React Router 官方 state management 文档里有一个很强的观点：React Router 通过 loaders、actions、forms 和自动 revalidation，把后端和前端连接起来，很多典型的客户端缓存需求会变得多余。

官方参考：[React Router State Management](https://reactrouter.com/explanation/state-management)

这句话不能机械理解成“永远不需要 React Query”。它真正表达的是：

```txt
如果一份 server state 的读取和写入都在 route loader/action 体系内，
router 可以在 action 后自动 revalidate loader，
你就不一定需要再手写一层客户端缓存失效逻辑。
```

比如项目编辑：

```txt
GET /projects/123:
  loader reads project

POST /projects/123:
  action updates project

after action:
  router revalidates loaders
  page receives fresh project data
```

在这种模型下，server state 的来源更清晰：服务端 loader 是真相，客户端 UI 订阅路由数据。

## 9. 和 Next App Router 的核心对照

可以用这张表建立第一层判断：

| 维度 | Next App Router | React Router Framework/Data Mode |
| --- | --- | --- |
| 中心抽象 | RSC + route segments | route modules + loaders/actions |
| 数据读取 | Server Component 中 async/await，或 fetch/cache | route loader |
| 写操作 | Server Actions / Route Handlers | route action / Form / fetcher |
| 交互边界 | Server/Client Component 边界 | 普通 React 组件 + 路由 pending/fetcher |
| 渲染思路 | RSC payload + HTML + hydration | SSR + route data hydration + client navigation |
| Web 标准倾向 | 框架抽象更强 | Form、Request、Response、redirect、headers 更显式 |
| 缓存中心 | component/route/fetch/cache/revalidation | HTTP/cache-control + loader revalidation + framework data |
| 学习难点 | RSC 边界和缓存模型 | loader/action 数据流和嵌套路由心智 |

一个更直接的对比：

```tsx
// Next App Router
export default async function ProjectPage({ params }) {
  const project = await getProject(params.id)
  return <ProjectView project={project} />
}
```

```tsx
// React Router Framework Mode
export async function loader({ params }) {
  const project = await getProject(params.id)
  return { project }
}

export default function ProjectPage({ loaderData }) {
  return <ProjectView project={loaderData.project} />
}
```

Next 把数据读取放进 Server Component 渲染过程。React Router 把数据读取放进 route module 的 loader，然后组件消费 loaderData。

## 10. RSC 在 React Router 路线里的位置

React Router 现在也在支持 RSC Framework Mode。官方 RSC 文档说明，在 RSC Framework Mode 中，loaders 和 actions 可以返回 React elements，这些 elements 只会在服务端渲染。

官方参考：[React Router React Server Components](https://reactrouter.com/how-to/react-server-components)

这说明生态正在融合：RSC 不再只属于 Next。但对理解路线差异来说，仍然要记住：

```txt
Next App Router:
  从 RSC-first 的应用模型出发

React Router:
  从 route loader/action 的 Web 数据模型出发
  再逐步接入 RSC 能力
```

这也意味着未来高阶 React SSR 架构不会是“Next 有 RSC，React Router 没 RSC”这么简单，而会变成不同框架如何把 RSC、路由数据、缓存和 mutation 组合起来。

## 11. 什么时候更喜欢 React Router 这条路线

React Router/Remix 路线适合这些团队或场景：

1. 团队非常重视 Web 标准、HTTP 语义、表单和 progressive enhancement。
2. 业务以 CRUD、嵌套路由、表单提交、redirect、权限、资源编辑为主。
3. 希望数据读取和 mutation 明确围绕 route module 组织。
4. 不想过早进入 RSC-first 的复杂组件边界。
5. 已有 React Router 应用，希望逐步采用 framework/data 能力。

Next App Router 更适合这些情况：

1. 需要强 RSC 生态和 Vercel/Next 平台能力。
2. 需要细粒度控制服务端组件、客户端 bundle 和 partial rendering。
3. 需要大量 server-only 展示组件和组件级数据读取。
4. 团队接受 Next 的约束和缓存复杂度。

注意，这不是绝对选型。两者都能做 SSR、数据获取、mutation、pending state 和部署优化。区别在于默认心智模型和复杂度位置。

## 12. 轻量验证：项目管理页面的两种写法

需求：

```txt
/projects
  展示项目列表
  支持新建项目
  新建后列表更新
  点击项目进入详情
```

React Router 路线：

```tsx
export async function loader() {
  return {
    projects: await getProjects(),
  }
}

export async function action({ request }) {
  const formData = await request.formData()
  await createProject({
    name: String(formData.get('name')),
  })
  return redirect('/projects')
}

export default function ProjectsPage({ loaderData }) {
  const navigation = useNavigation()
  const isSubmitting = navigation.state === 'submitting'

  return (
    <main>
      <Form method="post">
        <input name="name" />
        <button disabled={isSubmitting}>
          {isSubmitting ? '创建中' : '创建项目'}
        </button>
      </Form>

      <ul>
        {loaderData.projects.map(project => (
          <li key={project.id}>
            <Link to={`/projects/${project.id}`}>{project.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

你不需要在组件里手写：

```txt
fetch projects
setProjects
post project
invalidate projects
refetch projects
```

因为 loader/action/revalidation 已经组成了一个 route data cycle。

Next App Router 路线则更可能是：

```tsx
export default async function ProjectsPage() {
  const projects = await getProjects()

  return (
    <main>
      <CreateProjectForm />
      <ProjectList projects={projects} />
    </main>
  )
}
```

```tsx
'use server'

export async function createProjectAction(formData: FormData) {
  await createProject({
    name: String(formData.get('name')),
  })

  revalidatePath('/projects')
}
```

两者都能做好。差异在于：React Router 把它表述为 route action 之后 revalidate loader；Next 把它表述为 server action 之后 revalidate path/cache。

## 13. 本章小结

Remix/React Router 路线的核心不是“它也能 SSR”，而是它用 Web 和路由数据模型重构了 React 应用的数据流。

你可以用四句话记住：

1. loader 负责路由级读取。
2. action 负责路由级写入。
3. Form/fetcher/pending state 让 mutation 和 UI 状态回到路由器控制下。
4. revalidation 把写操作后的新数据重新接回页面。

和 Next App Router 相比，这条路线少一些 RSC-first 的组件边界复杂度，多一些 HTTP、Form、Request/Response 和嵌套路由数据流的清晰性。它代表的是现代 SSR 的另一种答案：不是把所有能力都塞进组件，而是让 URL 和 route module 成为应用数据协议。

## 思考题

### 题 1：为什么 loader/action 比组件里的 `useEffect(fetch)` 更适合首屏数据？

参考答案：

因为 loader 在路由匹配后、组件渲染前运行，SSR 和客户端导航都可以复用这套数据模型。组件不需要先 mount 再请求数据，减少首屏瀑布，也让 404、redirect、headers 等 HTTP 语义更自然。

### 题 2：React Router 说很多客户端缓存会变得多余，这句话的边界是什么？

参考答案：

如果数据读取在 loader，写入在 action，mutation 后 router 自动 revalidate loader，那么很多 CRUD 型 server state 不需要额外手写客户端缓存失效。但高频后台刷新、跨页面复杂缓存、乐观更新、实时数据、离线能力等场景仍可能需要 TanStack Query 或其他客户端状态工具。

### 题 3：Next App Router 和 React Router Framework Mode 的根本差异是什么？

参考答案：

Next App Router 以 RSC 和 route segment 为中心，把数据获取、组件边界、缓存和 streaming 组合在组件树中。React Router Framework Mode 以 route module 的 loader/action 为中心，把读取、写入、pending state 和 revalidation 组织成 Web 数据流。两者都能 SSR，但复杂度放置的位置不同。

## 下一章预告

下一章会进入 TanStack Query。我们会回答一个实际工程里很常见的问题：有了 Server Components、loader/action、Server Actions 之后，React Query 还需要吗？它到底应该补位在哪里，什么时候又会和框架数据层重复？
