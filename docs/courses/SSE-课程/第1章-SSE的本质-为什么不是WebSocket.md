# 第1章：SSE 的本质 — 为什么不是 WebSocket？

> SSE 的核心本质是"用最简单的方式做对的事"。本章我们从根本问题出发——服务端如何主动推数据给客户端？——搞清楚 SSE 在众多方案中的定位，理解它为什么存在、什么时候该用它。

---

## 1. 先建立心智模型：三种实时通信方案

假设你在做一个股票行情页面，价格每秒都在变。怎么做？

### 方案一：轮询（Polling）

```
客户端：有新数据吗？
服务端：没有。
客户端：有新数据吗？
服务端：没有。
客户端：有新数据吗？
服务端：有，价格涨了 0.5。
客户端：有新数据吗？
服务端：没有。
```

**问题显而易见**：大量无效请求，浪费带宽和服务器资源。延迟取决于轮询间隔——间隔短了浪费资源，间隔长了信息不及时。

### 方案二：长轮询（Long Polling）

```
客户端：有新数据吗？（hang 住不返回）
         ... 等 30 秒 ...
服务端：有，价格涨了 0.5。
客户端：有新数据吗？（立刻发下一个请求）
```

比普通轮询好一些，但每次推送都要重新建立 HTTP 连接。本质上还是"客户端问，服务端答"的模式，只是把"答"延迟了。

### 方案三：WebSocket — 全双工通道

```
客户端 ←→ 服务端（建立一次 TCP 连接，双方随时互发消息）
```

WebSocket 打开一条持久化的双向通道。客户端可以随时发消息，服务端也可以随时推送。听起来很完美？

**但问题是**：如果你只是想让服务端推数据给客户端（通知、日志流、实时数据），WebSocket 的全双工能力是**过剩的**。你为此付出了代价：

- 协议升级（从 HTTP 到 WS），中间代理可能不支持
- 需要自己实现心跳、重连
- 二进制协议，调试不透明
- 服务端实现复杂度高得多

### 方案四：SSE — 单向推送，刚刚好

```
客户端 → 服务端：建立普通 HTTP 请求
服务端 → 客户端：不结束响应，持续发送事件流
```

SSE 的思路极其朴素：

> 既然 HTTP 响应可以 chunked transfer（分块传输），那服务端为什么不一直发下去？

客户端发一个**普通 HTTP GET 请求**，服务端**不关闭响应**，而是持续往里写数据。浏览器端用 `EventSource` API 接收，就这么简单。

| 特性 | 轮询 | 长轮询 | WebSocket | SSE |
|------|------|--------|-----------|-----|
| 方向 | 客户端→服务端 | 客户端→服务端 | 双向 | 服务端→客户端 |
| 协议 | HTTP | HTTP | WS（升级） | HTTP |
| 自动重连 | 无 | 无 | 需自己实现 | **内置** |
| 浏览器 API | fetch/XHR | fetch/XHR | WebSocket | **EventSource** |
| 实现复杂度 | 低 | 低 | 高 | **极低** |
| 调试 | 容易 | 容易 | 较难 | **容易（纯文本）** |
| 代理/CDN 兼容 | 好 | 好 | 可能有问题 | **好** |

**一句话决策**：
- 只需服务端推数据 → **SSE**
- 需要双向实时通信（聊天、游戏）→ **WebSocket**
- 能接受延迟、请求不频繁 → **轮询**

---

## 2. SSE 协议格式 — 简单到可以用肉眼读

SSE 的数据格式是纯文本，字段之间用换行分隔。完整的事件格式：

```
id: 42\n
event: price-update\n
data: {"symbol": "AAPL", "price": 189.50}\n
\n
```

四个字段：

| 字段 | 作用 | 是否必须 |
|------|------|----------|
| `data` | 事件的数据内容 | **必须** |
| `id` | 事件唯一标识，用于断线重连时告知服务端最后收到的事件 | 可选 |
| `event` | 事件类型，默认是 `message` | 可选 |
| `retry` | 建议客户端的重连间隔（毫秒） | 可选 |

几个细节：

1. **每个字段一行**，`字段名: 值`，注意冒号后有一个空格
2. **一个空行** 表示一个事件结束
3. `data` 可以多行，多行 `data` 之间用 `\n` 拼接
4. 以 `:` 开头的行是**注释**，服务端常用它做心跳：`: keep-alive\n\n`

这就是 SSE 的全部协议。没有帧、没有掩码、没有 opcode。一个事件就是几行文本，一个空行结束。

---

## 3. 动手：最小 SSE Demo

### 服务端（Node.js）

创建 `server.js`：

```javascript
const http = require('http');

const server = http.createServer((req, res) => {
  // 1. 设置 SSE 必需的响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',  // 告诉浏览器这是 SSE 流
    'Cache-Control': 'no-cache',           // 禁止缓存
    'Connection': 'keep-alive'             // 保持连接
  });

  // 2. 每 2 秒推送一次当前时间
  let eventId = 0;
  const interval = setInterval(() => {
    eventId++;
    // 按照 SSE 协议格式写入
    res.write(`id: ${eventId}\n`);
    res.write(`data: ${new Date().toISOString()}\n`);
    res.write('\n'); // 空行 = 事件结束
  }, 2000);

  // 3. 客户端断开时清理资源
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

server.listen(3000, () => {
  console.log('SSE server running at http://localhost:3000');
});
```

### 客户端（浏览器）

创建 `index.html`：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SSE Demo - 实时时间</title>
  <style>
    body { font-family: monospace; padding: 40px; background: #1a1a2e; color: #e0e0e0; }
    #time { font-size: 48px; color: #00d4ff; }
    #status { font-size: 14px; color: #888; margin-top: 10px; }
  </style>
</head>
<body>
  <h2>SSE 实时时间</h2>
  <div id="time">等待连接...</div>
  <div id="status">未连接</div>

  <script>
    // 1. 创建 EventSource 连接
    const es = new EventSource('http://localhost:3000');

    const timeEl = document.getElementById('time');
    const statusEl = document.getElementById('status');

    // 2. 监听连接打开
    es.onopen = () => {
      statusEl.textContent = '✓ 已连接';
      statusEl.style.color = '#4caf50';
    };

    // 3. 监听消息（默认事件类型是 message）
    es.onmessage = (event) => {
      timeEl.textContent = event.data;
      console.log('事件 ID:', event.lastEventId);
    };

    // 4. 监听错误
    es.onerror = () => {
      statusEl.textContent = '✗ 连接断开，自动重连中...';
      statusEl.style.color = '#f44336';
    };
  </script>
</body>
</html>
```

### 运行

```bash
node server.js
# 浏览器打开 index.html（或用 Live Server）
```

你会看到页面上每 2 秒更新一次时间。如果重启服务端，浏览器会**自动重连**——这就是 SSE 内置的重连机制。

---

## 4. 为什么这个 demo 能跑起来？— 回扣本质

回顾一下我们做了什么：

- 服务端：一个普通 HTTP 响应，只是没调用 `res.end()`，而是持续 `res.write()`
- 客户端：`new EventSource(url)`，一个原生浏览器 API
- 协议：几行文本 + 一个空行

**没有协议升级，没有握手，没有第三方库。** 一个 HTTP 连接，服务端持续写入，客户端持续读取。这就是 SSE 的本质——**把 HTTP 响应变成了一个无限的数据流**。

这就是"用最简单的方式做对的事"。

---

## 章末思考题

### 思考题 1

如果 SSE 连接过程中，中间经过了一个 Nginx 反向代理，代理有 `proxy_buffering on`（默认行为）。服务端每隔 2 秒 write 一个事件，客户端会怎样？为什么？

<details>
<summary>参考答案</summary>

客户端**不会每 2 秒收到一个事件**。Nginx 默认开启响应缓冲，它会攒够一定量数据或等响应结束后才一次性转发给客户端。结果是：事件被"攒"在一起，批量到达，实时性大打折扣。

解决方案是在 Nginx 配置中关闭缓冲：`proxy_buffering off;`，或者在 SSE 响应头中加 `X-Accel-Buffering: no`。这是 SSE 在生产环境中最常见的坑之一，我们在第 5 章会详细讨论。

**启示**：SSE 看起来只是普通 HTTP，但它依赖"响应不被缓冲"这个前提。每一层中间件都可能破坏这个前提。
</details>

### 思考题 2

SSE 协议规定浏览器对同一域名最多同时建立 **6 个 HTTP 连接**（HTTP/1.1 规范）。如果你在同一个页面上打开了 6 个 `EventSource` 连接，再发起一个普通 `fetch` 请求会怎样？这对架构设计有什么启示？

<details>
<summary>参考答案</summary>

第 7 个请求（包括那个 fetch）会被**排队等待**，直到前面某个 SSE 连接释放。这意味着如果一个页面打开了太多 SSE 连接，页面上所有的网络请求（API 调用、图片加载等）都会被阻塞。

架构启示：
1. **合并 SSE 流**：不要每个数据类型开一个连接，而是用一个连接传输多种事件类型（用 `event` 字段区分），即"多路复用"
2. 或者升级到 HTTP/2，它没有 6 连接限制
3. 第 5 章我们会专门讨论这个坑的解决方案

**启示**：SSE 看似轻量，但它确实占用了一个 HTTP/1.1 连接。在设计时要有"连接预算"意识。
</details>

### 思考题 3

观察 demo 中 `EventSource` 的 `onerror` 回调——连接断开后我们没有写任何重连代码，但刷新页面后发现连接自动恢复了。这个自动重连是怎么实现的？它的边界在哪里（什么情况下不会自动重连）？

<details>
<summary>参考答案</summary>

**自动重连的机制**：`EventSource` 规范要求，当连接中断时（网络波动、服务端重启等），浏览器**必须自动尝试重连**。重连间隔由服务端通过 `retry:` 字段指定，默认约 3 秒。

**更妙的是 Last-Event-ID**：重连时，浏览器会自动在请求头中带上 `Last-Event-ID: 42`（最后收到的事件 ID）。服务端可以据此从断点续传，避免丢消息。

**不会自动重连的情况**：
1. 服务端返回的 HTTP 状态码不是 200（比如 404、500）—— `EventSource` 会触发 error 并设置 `readyState` 为 `CLOSED`，不再重连
2. 调用了 `es.close()` 手动关闭
3. 服务端在响应中设置了特定的重连次数限制（需要自己实现）

**启示**：SSE 的自动重连是协议层面的保障，不是应用层的。但服务端返回错误状态码会终止重连——这意味着如果你的 SSE 端点做了认证，token 过期返回 401 会直接"杀死"重连。这是需要注意的设计点。
</details>

---

> 准备好了就说「继续」进入下一章。
