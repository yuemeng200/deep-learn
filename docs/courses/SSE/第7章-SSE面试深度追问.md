# 第7章：SSE 面试深度追问 — 从原理到实战

> 这一章换一种形式。不再是讲解，而是面试追问——从一个基础问题开始，逐步深入，每个回答都可能触发下一个追问。题目全部来自真实项目踩坑点，涵盖前后端。建议你先尝试自己回答，再看参考答案。

---

## 追问链一：SSE 的本质与选型

### Q1.1：SSE 和 WebSocket 有什么区别？什么场景该用 SSE？

**参考答案：**

核心区别是**通信方向**。SSE 是单向的（服务端→客户端），基于普通 HTTP；WebSocket 是双向的，需要协议升级（HTTP→WS）。

SSE 适用于：AI 流式输出、实时通知推送、日志流、任务进度更新——本质上是"服务端持续产数据，客户端只需要消费"的场景。WebSocket 适用于：聊天室、协作编辑、在线游戏——需要双向实时交互的场景。

SSE 的优势在于极低的实现复杂度（浏览器原生 API、服务端几行代码）和天然兼容 HTTP 基础设施（代理、CDN、负载均衡都不需要特殊配置）。当你不需要双向通信时，用 WebSocket 就像用大炮打蚊子。

---

### Q1.2：那 SSE 只能用原生的 EventSource 吗？有没有替代方案？

**参考答案：**

不是。原生 `EventSource` 有三个硬限制：只能 GET、不能自定义请求头、不能发请求体。这在实际业务中经常不够用——比如 AI 对话需要 POST body 传聊天历史，或者需要在请求头带 `Authorization` 做 Bearer Token 认证。

替代方案是用 `fetch` + `ReadableStream` 手动消费 SSE 流，或者用社区库 `@microsoft/fetch-event-source`。后者的本质是在 JS 层模拟了一个 SSE 解析器——通过 `response.body.getReader()` 逐块读取字节，手动按 `\n\n` 切割，解析 `data:`/`event:`/`id:` 字段。

两者不只是 API 差异，而是**架构层面完全不同**：原生 EventSource 由浏览器内核（C++ 网络层）管理连接和协议解析，JS 拿到的只是一个句柄；fetch 方案则是全部在 JS 运行时（用户空间）完成，包括重连逻辑也需要自己控制。

---

### Q1.3：既然 fetch 方案需要自己做这么多事，为什么不直接用 WebSocket？WebSocket 不也能做流式输出吗？

**参考答案：**

技术上 WebSocket 当然也能做，但有几个关键劣势：

1. **基础设施兼容性**：WebSocket 需要协议升级（101 Switching Protocols），中间的代理、CDN、企业防火墙可能不支持或干扰这个升级过程。SSE 只是普通 HTTP 响应不结束，任何能处理 HTTP 的基础设施都能透明代理。

2. **重连机制的完备性**：SSE 的重连是协议内建的——浏览器自动重连，自动带上 `Last-Event-ID`，服务端可以据此断点续传。WebSocket 没有这个机制，需要应用层从头实现。

3. **调试透明度**：SSE 是纯文本协议，浏览器 DevTools 直接可见，curl 也能直接调试。WebSocket 是二进制帧，调试需要专门工具。

4. **服务端复杂度**：WebSocket 需要维护有状态的长连接、实现心跳、处理连接生命周期。SSE 在服务端就是普通的 HTTP 请求处理，不结束响应就行。

一句话：当你只需要服务端推数据时，WebSocket 的全双工能力是过剩的成本，SSE 的简单性才是工程上的正确选择。

---

### Q1.4：你提到 SSE 基于普通 HTTP，那 SSE 连接会占用浏览器的 6 连接配额吗？怎么解决？

**参考答案：**

会。HTTP/1.1 规范限制浏览器对同一域名最多 6 个并发 TCP 连接。每个 SSE 连接都是持久的，会一直占一个配额。如果一个页面开了 4 个 EventSource，只剩 2 个连接给其他所有 HTTP 请求（API 调用、图片加载等），页面可能会明显卡顿。

解决方案有三层：

1. **合并 SSE 流（推荐）**：用一个连接传输多种事件类型，通过 `event` 字段区分，这就是"多路复用"
2. **独立子域名**：给 SSE 用单独的子域名（如 `ws.example.com`），这样 SSE 和主站各有 6 个配额。实际项目中就是这样做的——用 `VITE_SSE_BASE_URL` 配置独立的 SSE 域名
3. **升级 HTTP/2**：HTTP/2 多路复用没有 6 连接限制，所有请求共享一个 TCP 连接

---

## 追问链二：连接管理与重连策略

### Q2.1：原生 EventSource 断线后会自动重连，那 fetch-event-source 呢？在 `onerror` 中 throw 是什么意思？

**参考答案：**

原生 EventSource 的重连由浏览器内核自动处理，JS 层无感知也无法阻止。`fetch-event-source` 的重连则是库在 JS 层实现的——本质是重新调用一次 `fetch()`。

`onerror` 中 `throw error` 是**唯一阻止自动重连的手段**。`fetch-event-source` 的 Promise 链大致是：`fetch → 读流 → 出错 → 调用 onerror → 如果没有 throw → 自动重连`。`throw` 会打断这个 Promise 链，阻止库发起下一次 `fetch()`。

所以在实际项目中，`onerror` 里每个分支都 `throw error`——这不是 bug，而是有意为之：重连策略由业务层控制，不让库自动重试。

---

### Q2.2：项目中 SSEClient 的 `onerror` 有两个分支，一个是 `abortController.signal.aborted`，一个是普通错误。为什么要区分？

**参考答案：**

因为"谁触发的断开"决定了后续行为：

- **用户主动 abort**（用户点了"停止生成"）：这是预期的正常行为，不应该通知业务层出错，不需要重连
- **网络错误/服务端异常**：这是意外断开，需要通知业务层（显示"连接断开，点击重试"），由用户决定是否重连

如果不区分，用户每次点"停止"都会弹出一个错误提示，体验很差。

实际代码中的处理是：

```typescript
onerror: (error) => {
  this.isConnected = false;
  if (this.abortController?.signal.aborted) {
    throw error;  // 主动中断：不通知业务层，不重连
  }
  onError(error as Error);  // 网络错误：通知业务层
  throw error;  // 阻止库自动重试
}
```

两个分支都 `throw`，但意图不同：abort 分支是"我知道断开了，别管了"；普通错误分支是"出错了，我已经通知业务层了，别自动重连"。

---

### Q2.3：项目中还有一个 `timeout` 事件的重连机制——收到 timeout 后自动重发最后一条用户消息。这个设计有什么风险？

**参考答案：**

这个设计的风险是**没有频率限制和退避策略**。如果后端持续超时，客户端会进入：

```
timeout → 重发 → 立刻超时 → 重发 → 立刻超时 → ...
```

的死循环。每次重发都是一次完整的 AI 推理请求（按 token 计费），短时间内可能消耗大量配额和后端资源。

更安全的设计是加重试上限和指数退避：

```typescript
const maxRetries = 3;
const backoff = Math.min(1000 * 2 ** retryCount, 10000); // 2s → 4s → 8s，上限 10s

if (retryCount >= maxRetries) {
  setError('连接超时，请手动重试');
  return;
}

setTimeout(() => sendMessage(/* ... */, true), backoff);
```

另外，多个 `timeout` 事件可能在短时间内连续到达（SSE 重放），没有防抖的话会触发多次并发的 `sendMessage`，产生重复请求。

---

### Q2.4：页面刷新后，如何恢复正在进行的 SSE 会话？项目中的 `read_head` 机制是怎么工作的？

**参考答案：**

页面刷新会丢失所有内存中的 SSE 状态。恢复流程：

1. **前端**：加载历史消息列表，检查最后一条消息的状态。如果 `status === 1`（处理中），说明 AI 还没回复完
2. **前端**：从历史消息中提取最后一条用户消息的 `message_id` 和 `read_head`（已读位置），静默重发请求
3. **后端**：识别到 `message_id` + `read_head`，不走正常的"从头开始推理"流程，而是从 `read_head` 位置继续推送后续事件

这本质上是一种**应用层的断点续传**，替代了 SSE 协议层的 `Last-Event-ID` 机制（因为用了 fetch-event-source，原生的 Last-Event-ID 不再生效）。

风险点：`read_head` 是历史接口返回时的快照值，而历史入库是延迟的（后端每分钟批量入库一次）。这导致两个问题：

1. **入库延迟导致历史数据不完整**：后端实际已生成到第 60 条消息，但历史 API 只入库到第 50 条。用 `read_head=50` 重连后，SSE 从第 51 条开始推是正确的——不会有重复消息。但历史消息中第 41-50 条可能是"半成品"（比如 text 消息只入库了一半 token），前端需要用 SSE 重连后的完整数据覆盖历史数据
2. **Tab 切回时的历史领先检测**：用户切到其他标签页再切回来，React Query 的 `refetchOnWindowFocus` 会重新拉取历史。此时后端可能已经把之前 SSE 推送的结果入库了，历史消息的 `message_id` 领先于前端当前内存中的消息。项目中的做法是弹窗提示用户"历史已更新，是否刷新"，而不是静默覆盖——因为用户可能正在编辑中

---

## 追问链三：消息去重与状态管理

### Q3.1：项目中 `appendSSEMessage` 的去重逻辑是怎么设计的？为什么需要 `batch` 字段？

**参考答案：**

SSE 消息流中，同一类消息可能分多次到达（比如 text 类型是逐 token 推送的）。`batch` 是消息的唯一标识，格式为 `{agent_message_id}|{suffix}`，比如 `msg123|text:1`。

去重逻辑：

1. **text 类型**：相同 `batch` 的消息做**拼接**（`existing.data + incoming.data`），不是替换。因为 text 消息是增量推送的，每个新消息只包含新产生的 token
2. **loading_list 类型**：相同 `batch` 的消息做**替换**，但有一个关键约束：`status` 只允许向前推进（1→2），禁止回退。这是为了防止重连时重放旧事件导致进度条倒退
3. **其他类型**：相同 `batch` 直接忽略（去重）

这个设计解决了三个问题：
- **流式拼接**：AI 的逐 token 输出被正确拼接成完整文本
- **重放去重**：重连时可能收到重复的历史事件，batch 去重避免重复渲染
- **状态保护**：进度状态只能前进不能后退，防止异常重放

---

### Q3.2：`batch` 的格式是 `{agent_message_id}|{suffix}`，为什么要加 `agent_message_id` 前缀？直接用 `suffix` 不行吗？

**参考答案：**

不行。因为 `suffix`（如 `text:1`、`loading_list:2`）在同一会话的不同对话轮次中会重复。

假设用户进行了两轮对话：
- 第一轮：agent 推送了 `batch: "text:1"` 的消息
- 第二轮：agent 又推送了 `batch: "text:1"` 的消息

如果只靠 `suffix` 去重，第二轮的 `text:1` 会被误认为是第一轮的重复消息，被 `appendSSEMessage` 忽略或错误拼接。

加上 `agent_message_id` 前缀后变成 `msg_abc|text:1` 和 `msg_def|text:1`，不同轮次的消息就不会互相干扰了。

`agent_message_id` 来自 `start` 事件（服务端在每次新对话轮次开始时发送），前端收到后存入 `currentAgentMessageIdRef`，后续所有消息的 batch 都带上这个前缀。

---

### Q3.3：这个 `appendSSEMessage` 是在 React 的 `setMessages(prev => ...)` 中以函数式调用的。为什么必须用函数式更新，不能直接 `setMessages([...messages, newMsg])`？

**参考答案：**

因为 SSE 消息回调是一个**异步闭包**，它捕获的 `messages` 可能是旧的。

SSE 消息到达的频率可能很高（AI 流式输出时每秒几十个 token），React 的状态更新是异步批处理的。如果在 `onmessage` 回调中直接读 `messages`，拿到的可能不是最新值，导致：
1. 去重判断失效（基于旧列表判断，新消息没被看到）
2. 拼接丢失（基于旧的 `existing.data` 拼接，中间状态被覆盖）

函数式更新 `setMessages(prev => appendSSEMessage(prev, incoming))` 保证了 `prev` 始终是最新状态，即使多个更新排队也能正确链式执行。

项目中还有一个 `messagesRef` 模式——`const messagesRef = useRef(messages); messagesRef.current = messages;`。这是为了在**非 setMessages 的闭包**（如 `sendMessage` 内部）中读取最新消息。比如 timeout 重连时需要找到最后一条用户消息，这时用的是 `messagesRef.current` 而不是 `messages`。

---

### Q3.4：那 `displayMessages` 的过滤逻辑为什么要用 `useMemo` 而不是直接在 `setMessages` 时就过滤掉？

**参考答案：**

这是**数据源与展示层分离**的设计原则。

`messages`（原始数据）保持 SSE 推送的所有消息，不做任何丢弃。这样做是因为：

1. **过滤规则依赖上下文**：比如 `loading` 消息"最后一条保留，其余过滤"——这个规则取决于消息列表的当前状态，如果在 `setMessages` 时过滤，后续状态变化时无法恢复被过滤的消息
2. **状态回溯**：重连、历史同步等场景需要完整的原始消息列表来判断状态
3. **调试和排查**：出问题时可以查看完整的原始消息流

`displayMessages`（展示数据）通过 `useMemo` 基于 `messages` 和 `isGenerating` 实时计算过滤结果。当 `isGenerating` 从 true 变 false 时，过滤规则会变化（比如所有进行中的 loading_list 强制标记为完成），如果原始数据已经被丢弃，这种动态过滤就不可能实现。

---

## 追问链四：生产环境部署

### Q4.1：SSE 部署到生产环境，Nginx 需要什么特殊配置？

**参考答案：**

核心配置是**关闭响应缓冲**：

```nginx
location /api/chat/completion {
    proxy_pass http://backend;
    proxy_buffering off;      # 关键：不缓冲，立即转发
    proxy_cache off;           # 不缓存
    proxy_set_header Connection '';
    chunked_transfer_encoding on;
    proxy_http_version 1.1;
}
```

`proxy_buffering off` 是最重要的。Nginx 默认开启缓冲，会把服务端的小块 SSE 数据攒起来，等缓冲区满了再一次性转发。对普通 HTTP 响应这能提升性能，但对 SSE 来说这完全破坏了实时性——用户看到的是事件"攒一批才到达"。

也可以在服务端响应头中加 `X-Accel-Buffering: no`，Nginx 会识别这个头并关闭该请求的缓冲，不需要改 Nginx 配置。

---

### Q4.2：如果 SSE 经过 CDN（如 Cloudflare），会有什么问题？

**参考答案：**

CDN 同样会缓冲响应。解决方案：

1. 在 CDN 控制面板中为 SSE 路径关闭响应缓冲
2. 设置正确的 `Cache-Control: no-cache, no-store` 头
3. 某些 CDN 需要配置 `Transfer-Encoding: chunked`

另一个问题是 CDN 的连接超时。CDN 节点通常有连接最大存活时间（如 100 秒），超过后强制断开。这就是为什么服务端需要心跳——在 CDN 超时之前发一个心跳包，重置超时计时器。

---

### Q4.3：如果用负载均衡（如 AWS ALB），SSE 长连接有什么特殊要求？

**参考答案：**

关键是**粘性会话（Sticky Session）**。

SSE 是有状态的长连接。负载均衡器必须将同一连接的所有数据包路由到同一后端实例。如果重连后被路由到不同实例：

1. 新实例找不到旧会话状态
2. `read_head` 恢复失败
3. 客户端收到"会话不存在"之类的错误

解决方案：
- **L7 负载均衡（ALB）**：配置 sticky session（基于 Cookie 或 IP）
- **L4 负载均衡（NLB）**：天然基于连接，不需要额外配置
- **Service Mesh（如 Istio）**：配置一致性哈希路由

另一个考虑：负载均衡器自身的空闲超时。AWS ALB 默认 60 秒，如果 SSE 连接 60 秒没数据就会被掐断。需要调高超时，或确保心跳间隔小于超时时间。

---

### Q4.4：Kubernetes 环境中 Pod 滚动更新时，SSE 连接会怎样？怎么做到无损？

**参考答案：**

滚动更新时，旧 Pod 收到 SIGTERM，新 Pod 启动。如果处理不当：

1. 旧 Pod 被杀 → 所有 SSE 连接断开 → 客户端触发 error
2. 客户端重连 → 可能路由到新 Pod → 找不到旧会话 → 失败

无损更新策略：

1. **preStop hook**：给旧 Pod 一段缓冲时间（`sleep 10`），让它从 Service 的 Endpoints 中摘除，不再接收新连接，但已有连接继续服务
2. **优雅关闭**：收到 SIGTERM 后先通知所有 SSE 客户端（发 `server-shutdown` 事件），等客户端主动断开或超时后再退出
3. **客户端自愈**：重连时如果后端返回"会话不存在"，客户端用 `message_id` + `read_head` 从历史接口恢复状态，不需要旧会话
4. **terminationGracePeriodSeconds**：设够长（如 60 秒），给优雅关闭足够时间

最佳实践是：preStop sleep + 优雅关闭 + 客户端自愈能力，三层保障。

---

## 追问链五：服务端架构

### Q5.1：Node.js 服务端实现 SSE 时，`res.write()` 后数据一定会立刻发到客户端吗？

**参考答案：**

不一定。`res.write()` 只是把数据写入 Node.js 的内部缓冲区，不保证立刻发送到网络层。以下情况会导致延迟：

1. **Nagle 算法**：TCP 层可能把小包攒成大包再发送
2. **压缩中间件**：Express 的 `compression()` 中间件会缓冲数据，等够一定量再压缩发送
3. **内核缓冲区**：如果内核的 TCP 发送缓冲区满了（客户端处理慢），数据会在内核层排队

解决方案：
- SSE 路由排除压缩中间件：`res.setHeader('Content-Encoding', 'identity')`
- 小数据包场景可以设 `res.socket.setNoDelay(true)` 禁用 Nagle
- 确保 `res.flushHeaders()` 被调用，响应头不缓冲

---

### Q5.2：SSE 服务端需要维护大量长连接，Node.js 单线程能扛住吗？怎么扩展？

**参考答案：**

Node.js 单线程处理长连接没问题——长连接本身不消耗 CPU，只是占用内存（每个连接的 socket 对象大约几十 KB）。1 万个 SSE 连接大约占用几百 MB 内存，单个 Node.js 实例完全可以扛住。

真正的瓶颈是**事件推送的 CPU 开销**。如果 1 万个连接每秒都要广播一次，就是每秒 1 万次 `res.write()`，序列化和 I/O 开销才是问题。

扩展策略：

1. **横向扩展**：多实例 + 负载均衡（需 sticky session）
2. **连接分片**：不同类型的 SSE 流分配到不同实例（通知服务器、指标服务器分开）
3. **Redis Pub/Sub**：多实例间通过 Redis 同步事件，每个实例只负责自己管理的连接
4. **无状态设计**：如果 SSE 是"请求-响应"模式（如 AI 对话），每次请求是独立的，天然支持水平扩展

---

### Q5.3：Redis Pub/Sub 的方案具体怎么设计？事件丢了怎么办？

**参考答案：**

架构：

```
业务服务 → Redis Pub/Sub → SSE 网关（多实例）→ 客户端
```

1. 业务服务产生事件后 `PUBLISH` 到 Redis 频道
2. 每个 SSE 网关实例 `SUBSCRIBE` 该频道
3. 收到消息后，只推送给本实例管理的连接

事件丢失的风险点：

1. **Redis Pub/Sub 是 fire-and-forget**：如果网关实例在那个瞬间断线，消息会丢
2. **解决方案**：不用纯 Pub/Sub，改用 Redis Stream（`XADD`/`XREAD`）。Stream 是持久化的，消费者可以指定上次读取的位置，断线后从断点继续读
3. **兜底**：客户端有重连 + read_head 机制，即使丢了几条，重连时可以从历史接口恢复

---

## 追问链六：安全与认证

### Q6.1：SSE 的认证怎么做？原生 EventSource 无法设置 Authorization 头怎么办？

**参考答案：**

三种方案，安全性递增：

**方案一：URL 携带 Token（不推荐）**

```
new EventSource('/sse?token=xxx')
```

Token 暴露在：浏览器历史、服务器 access log、Referer 头、代理日志。安全隐患大。

**方案二：Cookie 认证（原生 EventSource 可用）**

```javascript
new EventSource('/sse', { withCredentials: true })
```

服务端通过 Cookie 验证身份。但只适合同源或 CORS 配置完善的场景。而且 Cookie 有 CSRF 风险。

**方案三：fetch-event-source + Bearer Token（推荐）**

```typescript
fetchEventSource('/api/chat', {
  headers: { 'Authorization': `Bearer ${getToken()}` }
})
```

Token 在请求头中，不暴露在 URL。而且通过 getter 函数（`() => getToken()`）而非 token 字符串传入，确保每次重连都获取最新 token，避免 token 过期后重连失败。

---

### Q6.2：你提到用 getter 函数获取 token。如果 token 在 SSE 连接过程中过期了怎么办？连接已经建立了，没法再改请求头了。

**参考答案：**

这是一个很好的问题。对于已建立的 SSE 连接，token 过期不会立即影响数据接收——连接已经建好了，后续是数据流推送，不涉及认证。

真正的问题是**重连时**。如果连接断开后 token 已过期，用旧 token 重连会被拒绝（401），原生 EventSource 会直接进入 CLOSED 状态不再重连。

用 getter 函数的精妙之处就在这里：重连时调用的是 `getToken()`，这个函数每次执行都会从本地存储或内存中读取最新的 token。如果 token 被刷新过（比如 silent refresh），getter 返回的就是新 token。

更完善的方案是在 `onopen` 中检查响应状态：

```typescript
onopen: async (response) => {
  if (response.status === 401) {
    // token 过期，先刷新
    await refreshToken();
    // throw 让 fetch-event-source 触发重试（如果没设上限）
    // 但更好的做法是手动重试，不用库的自动重试
    throw new Error('Token expired, will retry with new token');
  }
}
```

---

### Q6.3：SSE 有没有安全风险？比如 XSS、注入之类的？

**参考答案：**

有，主要是两个方面：

**1. SSE 注入（服务端漏洞）**

如果服务端把用户输入直接写入 SSE 事件数据，攻击者可以注入 SSE 协议字符：

```
用户输入: "hello\ndata: injected\nid: 999\n\n"
服务端直接拼接:
  data: hello
  data: injected
  id: 999

```

防御：服务端写入 SSE 数据时，对 `data` 字段中的换行符进行转义或过滤。

**2. 跨域 SSE 窃取**

恶意网站可以 `new EventSource('https://your-api.com/sse')` 连接你的 SSE 端点，如果服务端没有 CORS 校验，敏感数据会被窃取。

防御：
- 服务端校验 `Origin` 头，只允许可信来源
- 要求认证（token/Cookie），不提供匿名 SSE 端点
- 使用 `credentials: 'include'` 时，CORS 头必须指定具体域名，不能用 `*`

---

## 追问链七：性能与边界

### Q7.1：AI 流式输出场景下，每秒可能产生几十个 SSE 消息（每个 token 一条），高频的 `JSON.parse` 会不会有性能问题？

**参考答案：**

会有。每秒 30-50 次 `JSON.parse` + `setState` + DOM 更新，在低端设备上可能导致丢帧。

优化思路：

1. **合并渲染频率**：SSE 消息到达频率高，但渲染频率不需要同步。用 `requestAnimationFrame` 或 `setTimeout(16)` 做节流，攒 16ms 内的所有 token 再一次性渲染
2. **Web Worker 解析**：把 `JSON.parse` 放到 Worker 线程，不阻塞主线程
3. **减少 setState 频率**：不是每个 token 都触发 `setMessages`，而是攒到一定量再更新

项目中的 `appendSSEMessage` 函数式更新天然支持批处理——React 18 的自动批处理（Automatic Batching）会将同一个事件循环中的多个 `setState` 合并为一次渲染。但 SSE 的消息到达是异步的，可能跨越多个微任务，不一定能被批处理覆盖。

---

### Q7.2：fetch-event-source 的 ReadableStream buffer 有没有内存问题？

**参考答案：**

有潜在风险。fetch-event-source 内部维护一个 buffer 字符串，用于拼接未完成的 SSE 消息（还没遇到 `\n\n` 的部分）。在极端情况下：

1. **网络分片**：一个 SSE 消息被 TCP 拆成多个小包，`\n\n` 在下一个包才到，buffer 持续增长
2. **恶意服务端**：持续发送不带 `\n\n` 的数据，buffer 无限增长
3. **长连接累积**：正常使用中，如果消息频率极高，每次解析后的残余 buffer 也在增长

防护措施：
- 给 SSE 连接设最大存活时间（如 10 分钟），超时强制断开
- 监控 buffer 长度，超过阈值（如 1MB）视为异常，断开连接
- 原生 EventSource 由浏览器内核管理，不存在这个 JS 堆内存问题

---

### Q7.3：项目中用了 `openWhenHidden: true`，让后台标签页的 SSE 连接不被挂起。这有什么副作用？你怎么判断要不要开？

**参考答案：**

`openWhenHidden: true` 绕过了 Page Visibility API，即使标签页在后台，SSE 连接也保持活跃。

副作用：

1. **资源浪费**：用户切到其他标签页，SSE 连接还在接收数据，消耗带宽和服务端连接数
2. **状态漂移**：用户回到标签页时，UI 状态可能已经和实际数据不一致（AI 已经回答完了，但用户没看到过程）
3. **永远保活风险**：如果后端崩溃或网络割裂，没有发送 `end` 消息，连接可能永远不断开

要不要开取决于业务场景：

- **AI 对话生成视频**（本项目的场景）：应该开。因为视频生成可能需要几分钟，用户切标签页时不能断连，否则任务中断
- **实时通知推送**：不需要开。后台时缓存通知，回到前台时批量显示即可
- **数据监控**：看需求。如果需要后台报警，开；如果只是展示用，不开

如果开了，一定要配合**最大会话时长**兜底：

```typescript
const MAX_SESSION_DURATION = 10 * 60 * 1000; // 10 分钟
const sessionTimer = setTimeout(() => {
  if (this.isConnected) this.disconnect();
}, MAX_SESSION_DURATION);
```

---

## 追问链八：综合设计题

### Q8.1：如果要你从零设计一个支持 10 万并发 SSE 连接的系统，你会怎么设计？

**参考答案：**

分层架构：

```
客户端 → CDN（边缘节点，缓存静态资源）→ L4 负载均衡（连接级路由）
  → SSE 网关集群（管理连接）→ Redis Stream（事件总线）
  → 业务服务（产生事件）
```

关键设计点：

**1. SSE 网关层**
- 用 Go 或 Rust 实现（协程/async，内存占用远低于 Node.js）
- 每个实例管理 1-2 万连接，10 万连接需要 5-10 个实例
- 连接管理用 epoll/kqueue，单线程事件循环

**2. 事件分发**
- 业务服务写事件到 Redis Stream（持久化，可回溯）
- 每个网关实例作为 Consumer Group 的消费者
- 断线重连时通过 `XREAD` 从上次位置继续读

**3. 连接认证**
- JWT token 在建立连接时校验一次
- token 过期不中断连接，只在重连时校验
- 高权限操作走单独的 API（不走 SSE）

**4. 监控**
- Prometheus 采集：连接数、事件推送延迟、错误率
- 告警：连接数突增（可能是攻击）、推送延迟 > 1s（可能是缓冲问题）、错误率 > 5%

**5. 滚动更新**
- preStop sleep 30s + 优雅关闭
- 客户端重连时自动恢复

---

### Q8.2：最后一问——你觉得 SSE 最大的局限性是什么？未来可能怎么演进？

**参考答案：**

**最大局限性：HTTP/1.1 下的 6 连接限制。**

一个页面只能开几个 SSE 连接，多了就抢占其他请求的配额。虽然 HTTP/2 解决了这个问题，但现实中很多环境（企业代理、旧 CDN）仍然走 HTTP/1.1。

**其他局限性：**

1. **原生 API 太简陋**：只能 GET、不能自定义头、错误处理能力弱。导致实际项目中几乎没人用原生 EventSource，都要上 fetch 方案，但又失去了浏览器内建的重连和协议解析
2. **没有标准的多路复用机制**：WebSocket 有子协议（subprotocol），SSE 没有类似机制，多路复用完全靠应用层的 `event` 字段
3. **浏览器兼容性的隐性问题**：虽然主流浏览器都支持 EventSource，但 DevTools 对 SSE 的调试支持远不如 WebSocket（Chrome 的 EventStream 面板经常不显示）

**可能的演进方向：**

1. **WebTransport**（HTTP/3）：兼顾了 WebSocket 的双向性和 HTTP/3 的多路复用，浏览器已经开始支持
2. **Fetch API 的流式增强**：如果未来 Fetch API 原生支持 SSE 协议解析（类似 `response.body.toEventStream()`），就能在保持 fetch 灵活性的同时获得原生解析能力
3. **AI 时代的协议适配**：随着 AI 流式输出成为标配，可能出现专门优化的协议（如 OpenAI 的 streaming protocol 已经在影响行业标准）

但短期内，SSE 仍然是"服务端单向推送"场景的最优解——简单、可靠、与 HTTP 生态完美兼容。

---

> 这就是全部面试追问链。覆盖了：选型决策 → 连接管理 → 消息去重 → 生产部署 → 服务端架构 → 安全认证 → 性能优化 → 系统设计。每条追问链都可以持续深入，但到了 Q8.1/Q8.2 这个深度，基本足以应对绝大多数 SSE 相关的面试考察了。
