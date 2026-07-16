---
title: 第7章 缓存、运行时与部署，现代 SSR 的真正复杂度
date: 2026-07-16
course: 现代服务端渲染与 React 全栈架构
summary: 建立多层缓存与运行时地图，理解 Next cache、Query cache、HTTP/CDN cache、revalidation、Node/Edge runtime 和部署形态如何共同决定现代 SSR 的性能与复杂度。
---

# 第7章：缓存、运行时与部署，现代 SSR 的真正复杂度

现代 SSR 的性能上限，不只取决于 React 渲染得快不快。真正决定用户体验和系统成本的，往往是缓存层、运行时边界和部署形态：哪些结果可以复用，复用多久，谁负责失效，请求落在哪个区域，服务端是否冷启动，数据库连接能不能撑住。

这一章的目标是把前面分散出现的概念放进一张完整地图。你会看到：Next cache、TanStack Query cache、HTTP cache、CDN cache、浏览器 cache、revalidation、Node runtime、Edge runtime 不是同一个东西。现代 SSR 的难点，正是这些层的职责经常被混在一起。

## 1. 先建立多层缓存地图

一个现代 React SSR 应用里，至少可能同时存在这些缓存：

```txt
Browser HTTP cache
  浏览器按 HTTP header 缓存静态资源或响应

TanStack Query cache
  浏览器运行时内存里的 server state 缓存

Next / framework server cache
  服务端或平台侧缓存数据、组件、路由结果

CDN / edge cache
  离用户更近的共享缓存

Database / API cache
  数据服务内部缓存、Redis、materialized view
```

它们解决的问题不同：

| 缓存层 | 位置 | 主要解决什么 | 典型失效方式 |
| --- | --- | --- | --- |
| Browser HTTP cache | 用户浏览器 | 静态资源复用、减少网络请求 | URL hash、Cache-Control、ETag |
| Query cache | 浏览器 JS 内存 | 页面运行期 server state 复用和同步 | staleTime、invalidateQueries、refetch |
| Framework cache | 服务端/平台 | SSR 数据或渲染结果复用 | revalidatePath、revalidateTag、TTL |
| CDN cache | 边缘节点 | 降低 TTFB 和源站压力 | Cache-Control、purge、surrogate key |
| DB/API cache | 数据层 | 减少昂贵查询或外部 API 调用 | TTL、写后删除、事件驱动失效 |

所以当你说“缓存没更新”时，第一步不是找 API，而是问：

```txt
到底是哪一层缓存没更新？
```

## 2. HTTP 缓存：最底层但最容易被忽略

HTTP 缓存由响应头控制。MDN 对 HTTP caching 的定义很直接：HTTP cache 会把响应和请求关联起来，后续请求可以复用已存响应。

官方参考：[MDN HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching)、[MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)

常见 header：

```http
Cache-Control: public, max-age=3600, stale-while-revalidate=60
```

含义：

```txt
public:
  共享缓存可以存，比如 CDN

max-age=3600:
  3600 秒内响应是 fresh

stale-while-revalidate=60:
  过期后 60 秒内可以先返回旧响应，同时后台重新验证
```

`stale-while-revalidate` 很重要。它不是 React Query 的 stale，也不是 Next revalidate，而是 HTTP 缓存语义：允许缓存先返回旧响应，同时异步更新。MDN 明确说明，该指令允许 cache 在 revalidate 时复用 stale response。

这能避免一种常见问题：

```txt
缓存刚过期
  -> 所有请求同时打到源站
  -> 源站压力飙升
```

有了 stale-while-revalidate：

```txt
缓存刚过期
  -> 用户先拿到旧响应
  -> 缓存在后台刷新
  -> 下一个用户拿到新响应
```

这和 ISR、Next revalidate、Query staleTime 都像，但不是同一层机制。

## 3. 浏览器静态资源缓存：最适合激进缓存

前端构建产物通常有内容 hash：

```txt
app.8f3a1c.js
styles.31ab9.css
```

这类资源适合：

```http
Cache-Control: public, max-age=31536000, immutable
```

因为内容变了，文件名也变。旧文件可以长期缓存，新部署会引用新 URL。

但 HTML 通常不适合这样缓存：

```http
Cache-Control: public, max-age=31536000, immutable
```

因为 HTML 是应用入口，里面引用了新的 JS/CSS 文件。如果 HTML 被浏览器长时间缓存，用户可能拿到旧入口，导致资源版本错乱。

实战规则：

```txt
带 hash 的静态资源:
  长缓存 + immutable

HTML:
  短缓存、no-cache 或由框架/CDN 控制

用户私有 API:
  private 或 no-store
```

## 4. Query cache：不是 HTTP cache

第 6 章讲过，TanStack Query cache 是浏览器 JS 运行时里的 server state 缓存。

它的关键参数是：

```tsx
useQuery({
  queryKey: ['notifications'],
  queryFn: getNotifications,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
})
```

含义：

```txt
staleTime:
  多久内认为数据 fresh，不主动 refetch

gcTime:
  查询不用后多久从内存中回收
```

这和 HTTP `Cache-Control: max-age` 不是一回事：

```txt
HTTP cache:
  浏览器/代理/CDN 是否重新发网络请求

Query cache:
  React 应用运行期是否复用内存中的 server state
```

它们可以叠加：

```txt
useQuery 触发 fetch
  -> fetch 可能命中 browser HTTP cache
  -> 返回后写入 Query cache
  -> 后续组件先读 Query cache
```

如果把这两层混淆，调试会非常痛苦。你看到数据没更新，可能是：

1. Query 认为数据还 fresh。
2. fetch 命中了 HTTP cache。
3. CDN 返回了旧响应。
4. 服务端框架 cache 没 revalidate。
5. 数据库读副本延迟。

## 5. Next cache：框架层缓存

Next App Router 的缓存模型一直在演进。到 2026 年，官方文档已经把 `Cache Components` 作为当前起步路径，并说明需要在 `next.config.ts` 中开启 `cacheComponents: true`。如果没有使用 Cache Components，则参考上一代 caching/revalidating 模型。

官方参考：[Next.js Caching](https://nextjs.org/docs/app/getting-started/caching)、[Next.js Caching and Revalidating Previous Model](https://nextjs.org/docs/app/guides/caching-without-cache-components)

你现在不需要死记所有 API，但必须理解 Next cache 的目标：

```txt
缓存数据获取结果
缓存计算结果
缓存页面或组件渲染结果
让动态和静态内容可以在同一个路由树里组合
```

上一代模型里，常见的是扩展 `fetch`：

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

当前 Cache Components 模型则更强调显式缓存边界，例如用 `"use cache"` 这类指令缓存 pages、components 或 functions。Next 16 发布说明把 Cache Components 描述为让缓存更显式、更灵活的一组能力。

官方参考：[Next.js 16 Cache Components](https://nextjs.org/blog/next-16)

核心判断仍然不变：

```txt
这段计算或数据是否可复用？
复用范围是用户无关、用户相关、请求相关，还是完全不可缓存？
复用后如何失效？
```

## 6. revalidatePath 和 revalidateTag：路径失效 vs 标签失效

Next 提供按路径或标签失效缓存的能力。

官方参考：[Next.js revalidatePath](https://nextjs.org/docs/app/api-reference/functions/revalidatePath)、[Next.js revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)

`revalidatePath`：

```tsx
import { revalidatePath } from 'next/cache'

export async function updateProduct(id: string) {
  await db.product.update(...)
  revalidatePath(`/products/${id}`)
}
```

适合：

```txt
这个 mutation 明确影响某个页面路径
```

`revalidateTag`：

```tsx
import { revalidateTag } from 'next/cache'

export async function updateProduct(id: string) {
  await db.product.update(...)
  revalidateTag(`product:${id}`)
  revalidateTag('product-list')
}
```

适合：

```txt
同一份数据被多个页面或组件使用
你希望按数据实体失效，而不是按 URL 猜测
```

可以这样理解：

```txt
revalidatePath:
  URL 视角

revalidateTag:
  数据依赖视角
```

真实项目里，tag 往往更适合复杂内容系统、商品系统、知识库，因为同一个实体可能出现在详情页、列表页、搜索页、推荐页。

## 7. CDN cache：离用户近，但要小心个性化

CDN cache 的价值是让响应在离用户更近的位置返回，减少源站压力和 TTFB。

适合 CDN cache 的内容：

1. 静态资源。
2. 公开文章页。
3. 文档页。
4. 商品目录和分类页。
5. 公开 API 且允许短暂陈旧的数据。

不适合直接 public CDN cache 的内容：

1. 用户私有 dashboard。
2. 带权限的数据。
3. 购物车。
4. 账号设置。
5. 明确依赖 cookie 的个性化 HTML。

一个严重错误是：

```http
Cache-Control: public, max-age=600
```

但响应里包含用户私有信息。这可能导致共享缓存把 A 用户页面发给 B 用户。

对于用户相关响应，应考虑：

```http
Cache-Control: private, no-store
```

或者把页面拆开：

```txt
公开主体:
  CDN cache

用户个性化片段:
  动态服务端渲染或客户端请求
```

这就是为什么第 1 章说“需要登录不等于不能缓存”。不是整页 public cache，而是拆出可缓存的公开部分。

## 8. Node runtime 与 Edge runtime

现代 SSR 还要选择运行时。

Node runtime 的特点：

1. Node API 完整。
2. NPM 生态兼容性强。
3. 更适合数据库驱动、复杂服务端逻辑、文件系统、长任务。
4. 部署在 serverless 时可能有冷启动和连接管理问题。

Edge runtime 的特点：

1. 更靠近用户，理论延迟低。
2. 基于 Web API 模型，Node API 受限。
3. 适合轻量鉴权、重定向、A/B、地理位置、header/cookie 处理、边缘缓存逻辑。
4. 不适合直接跑重型 ORM、长计算、依赖 Node 原生模块的库。

Next 官方文档区分 Edge 和 Node runtime；选择 runtime 会影响可用 API、包兼容性和部署行为。

官方参考：[Next.js Edge Runtime](https://nextjs.org/docs/app/api-reference/edge)、[Next.js Runtime Config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#runtime)

一个实用判断：

```txt
需要低延迟、轻逻辑、靠近用户:
  Edge runtime

需要完整 Node 生态、数据库驱动、复杂服务端逻辑:
  Node runtime
```

不要把 Edge 当成“更快的 Node”。它是不同运行时，不是免费加速开关。

## 9. Serverless、冷启动与数据库连接

很多 SSR 应用部署在 serverless 或类似弹性环境。它带来的问题不是 React 特有，但会直接影响 SSR。

典型链路：

```txt
request arrives
  -> platform starts function instance
  -> app code loads
  -> DB connection initializes
  -> server renders HTML
  -> response returns
```

冷启动会增加首个请求延迟。数据库连接也可能成为瓶颈：

```txt
高并发 serverless instances
  -> 每个 instance 建连接
  -> 数据库连接数爆掉
```

解决方向：

1. 使用连接池或数据库代理。
2. 避免在 Edge runtime 里使用不兼容的数据库驱动。
3. 对可缓存页面减少请求时数据库访问。
4. 对昂贵查询用服务端缓存或物化结果。
5. 明确哪些页面必须动态，哪些可以静态或 revalidate。

SSR 不是“每次请求查数据库然后 render”。生产级 SSR 必须把数据库访问纳入缓存和部署设计。

## 10. 一个页面的缓存推演

以商品详情页为例：

```txt
商品标题、描述、图片:
  公开，变化低频，SEO 主体

价格:
  变化中频，允许 30 秒陈旧

库存:
  变化较频繁，购买时必须最终校验

推荐:
  慢查询，非 SEO 主体

用户优惠:
  个性化，不能 public cache

购买按钮:
  客户端交互
```

可以设计成：

```txt
ProductInfo:
  Server Component / Cache Components / revalidate by product tag

PriceBox:
  短 TTL 或 tag revalidation

InventoryStatus:
  短缓存展示，提交订单时服务端强校验

Recommendations:
  Suspense + streaming + 可缓存推荐结果

UserCoupon:
  动态私有数据，或客户端请求

BuyControls:
  Client Component
```

缓存层：

```txt
Static assets:
  browser/CDN long cache + immutable

Product HTML / RSC result:
  framework cache / CDN depending on personalization

Product data:
  tag-based revalidation

Notifications/cart:
  Query cache + private API no-store
```

这个例子说明：现代 SSR 的设计单位不是“页面”，而是“页面里的数据与交互区域”。

## 11. 常见故障模式

### 故障一：数据更新了，页面还是旧的

可能原因：

1. Next cache 没 revalidate。
2. CDN cache 还在返回旧响应。
3. Browser HTTP cache 命中旧资源。
4. Query cache 认为数据 fresh。
5. 数据库读副本延迟。

排查顺序：

```txt
确认响应来自哪一层 cache
检查 Cache-Control / Age / x-cache 等 header
检查框架 revalidation 是否触发
检查 Query staleTime 和 invalidation
检查数据源读写一致性
```

### 故障二：页面总是动态，缓存不生效

可能原因：

1. 高层 layout 读取了 cookie/header。
2. 使用了 no-store。
3. 服务端组件读了请求级个性化数据。
4. 动态 API 泄漏到整棵路由树。
5. 缓存边界放得太高或太低。

解决方向：

```txt
把个性化区域下沉
把公开区域拆成可缓存组件
用 Suspense 或动态片段隔离慢/私有数据
```

### 故障三：Edge 部署后某些包不可用

原因：

```txt
Edge runtime 不是 Node runtime
Node built-in API、原生模块、某些 ORM 或驱动可能不可用
```

解决方向：

```txt
把重服务端逻辑放回 Node runtime
Edge 只做轻量逻辑
或使用支持 Edge 的数据访问方案
```

### 故障四：缓存导致权限泄漏

原因：

```txt
把含用户私有信息的响应 public cache 了
或 CDN 没有正确 vary by cookie/header
```

解决方向：

```txt
私有响应使用 private/no-store
公开主体和用户片段拆开
谨慎使用 Vary
避免把用户 HTML 放进共享缓存
```

## 12. 轻量验证：给页面设计缓存策略

假设你有一个 SaaS 产品站：

```txt
/pricing:
  公开价格页，偶尔调整

/blog/[slug]:
  公开文章页，SEO 重要

/dashboard:
  登录后私有数据

/dashboard/reports:
  图表数据昂贵，可接受 5 分钟陈旧

/settings:
  用户私有设置
```

策略：

```txt
/pricing:
  静态或 revalidate by tag
  CDN cache 可用

/blog/[slug]:
  静态或按文章 tag revalidate
  HTML/metadata 尽早输出

/dashboard:
  私有动态页面
  不 public CDN cache
  可拆出公开或团队共享配置缓存

/dashboard/reports:
  服务端缓存昂贵报表 5 分钟
  Client Component 用 Query 管理筛选和刷新

/settings:
  no-store/private
  mutation 后更新私有数据或 refresh
```

这比“全站 SSR”或“全站 CDN cache”更接近真实工程。

## 13. 本章小结

现代 SSR 的复杂度，主要来自多层缓存和运行时边界：

1. Query cache 是客户端运行时 server state 缓存。
2. Next/framework cache 是服务端渲染和数据计算复用。
3. HTTP cache 是浏览器和代理按响应头复用响应。
4. CDN cache 是共享边缘缓存，必须小心个性化和权限。
5. Node runtime 和 Edge runtime 不是性能等级差异，而是能力模型差异。

你可以用一个问题链做架构判断：

```txt
这份内容是否用户相关？
它允许多旧？
它应该在哪一层缓存？
谁负责让它失效？
失效后用户是否能先看到旧内容？
它应该运行在 Node、Edge，还是客户端？
```

只有回答完这些问题，现代 SSR 的性能优化才不是玄学。

## 思考题

### 题 1：为什么 Query cache 和 Next cache 不能混为一谈？

参考答案：

Query cache 位于浏览器 JS 运行时，管理客户端 server state 的 fresh/stale、后台刷新、mutation 和共享缓存。Next cache 位于服务端或平台层，复用数据获取、计算、组件或路由渲染结果。二者生命周期、失效方式和作用位置不同，可以叠加但不能互相替代。

### 题 2：为什么登录页面里的某些内容仍然可以缓存？

参考答案：

“需要登录”只说明页面包含私有上下文，不说明所有区域都私有。公开配置、产品信息、团队共享但低频变化的数据、静态资源都可以缓存；用户姓名、权限、购物车、私有通知等不能 public cache。关键是拆分缓存边界，而不是整页一刀切。

### 题 3：为什么 Edge runtime 不是所有 SSR 页面的默认最优解？

参考答案：

Edge runtime 更靠近用户，适合轻量逻辑和低延迟响应，但它不是完整 Node。许多 Node API、原生模块、ORM、数据库驱动或长任务不适合 Edge。复杂服务端逻辑、数据库连接和重计算通常更适合 Node runtime，再通过缓存/CDN/streaming 优化用户体验。

## 下一章预告

下一章是架构决策课。我们会把前面所有概念合起来，对一个中等复杂度应用分别用 Next App Router、React Router Framework Mode、TanStack Query 组合方案做推演，最后沉淀成 SSR/RSC 技术选型 checklist。
