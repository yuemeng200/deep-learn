# 第6章：SSE 的坑与填坑指南（重点章）

> 前五章我们搭起了 SSE 的完整知识体系。但"知道怎么写"和"能在线上稳定跑"之间，隔着无数个坑。本章系统梳理 SSE 在生产环境中最常见的陷阱，每个坑都有现象、原因、解决方案。学完本章，你会拿到一份避坑检查清单，作为日后开发的速查手册。

---

## 坑 1：Nginx 代理缓冲 — 事件不实时

### 现象

本地开发一切正常，部署到线上后 SSE 事件"攒一阵子才一次性到达"。比如服务端每 2 秒推一个事件，客户端却是每 30 秒收到 15 个事件的批量。

### 原因

Nginx 默认开启 `proxy_buffering on`。它会把上游的响应攒在缓冲区里，等缓冲区满了或者响应结束了才一次性转发给客户端。对于普通 HTTP 响应这没问题（甚至能提升性能），但对于 SSE 这种"持续不断吐数据"的流式响应，缓冲就是灾难。

```
服务端每 2s write 一次：
  event1 → event2 → event3 → event4 → event5 → ...

Nginx 缓冲区（默认 4K-8K）：
  [等缓冲区满] → [等缓冲区满] → 一次性转发一批

客户端收到的：
  ---- 30s 无数据 ---- 批量到达 15 个 ---- 30s 无数据 ----
```

### 解决方案

**方案一：服务端响应头（推荐，侵入性最小）**

```javascript
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'  // ← 这一行搞定
});
```

`X-Accel-Buffering: no` 是 Nginx 识别的特殊响应头，等价于在该请求的 location 块中设置 `proxy_buffering off;`。不需要改 Nginx 配置，不需要重启。

**方案二：Nginx 配置**

```nginx
location /sse {
    proxy_pass http://backend;
    proxy_buffering off;           # 关键：关闭缓冲
    proxy_cache off;               # 关闭缓存
    proxy_set_header Connection ''; # 清理 hop-by-hop 头
    proxy_http_version 1.1;        # 使用 HTTP/1.1 保持长连接
}
```

**方案三：如果用了 CDN**

Cloudflare 等 CDN 也会缓冲响应。需要在 CDN 控制面板中关闭该路径的响应缓冲，或设置合适的 Cache-Control 头。

### 验证方法

```bash
# 直接请求服务端（不经过 Nginx）
curl -N http://localhost:3000/sse
# 应该每 2 秒收到一个事件

# 经过 Nginx
curl -N http://your-domain.com/sse
# 如果攒批到达 → 缓冲问题
```

`-N` 参数禁用 curl 自身的缓冲，确保你看到的是服务端的真实行为。

---

## 坑 2：浏览器 6 连接限制

### 现象

页面上打开了 5 个 `EventSource` 连接后，其他所有网络请求（fetch、图片加载、CSS/JS）全部卡住，页面"冻结"。

### 原因

HTTP/1.1 规范规定浏览器对同一域名最多同时建立 **6 个 TCP 连接**。`EventSource` 占用的连接是持久的，不会被释放。6 个 SSE 连接 = 6 个连接全被占满 = 其他请求排队等待。

```
域名 example.com 的 6 个连接：
  [SSE-1] [SSE-2] [SSE-3] [SSE-4] [SSE-5] [SSE-6]
  全部被 EventSource 占满

新的 fetch('/api/data') → 排队等待... → 超时
```

### 解决方案

**方案一：合并 SSE 流（推荐）**

用一个连接传输多种事件类型：

```javascript
// 服务端：一个连接，多种事件
manager.broadcast('notification', { msg: '新消息' });
manager.broadcast('metrics', { cpu: 45.2 });
manager.broadcast('task-progress', { taskId: 'A1', progress: 60 });

// 客户端：按 event 字段分发
es.addEventListener('notification', handleNotification);
es.addEventListener('metrics', handleMetrics);
es.addEventListener('task-progress', handleProgress);
```

一条连接，通过 `event` 字段多路复用。这是最根本的解决方案。

**方案二：用不同子域名分流**

```
sse1.example.com → EventSource 连接 1-3
sse2.example.com → EventSource 连接 4-6
www.example.com  → 普通 API 请求
```

每个子域名各自享有 6 个连接。但增加了 DNS 解析和证书管理的复杂度。

**方案三：升级 HTTP/2**

HTTP/2 的多路复用机制没有 6 连接限制，所有请求共享一个 TCP 连接。但前提是你的整个链路（CDN、Nginx、客户端）都支持 HTTP/2。

### 检查清单

```javascript
// 开发时监控连接数
document.querySelectorAll('link[rel="stylesheet"], script[src], img[src]').length;
// 如果页面有很多资源，谨慎使用多个 EventSource
```

---

## 坑 3：内存泄漏 — 断开的连接没人管

### 现象

服务端内存持续增长，几天后 OOM 崩溃。日志显示连接数不断攀升，但实际客户端早已断开。

### 原因

```javascript
// ❌ 典型的内存泄漏代码
const clients = [];

app.get('/sse', (req, res) => {
  clients.push(res);  // 加入列表
  // ... 没有清理逻辑 ...
});
```

客户端断开后，`res` 对象仍然在数组中。服务端继续往已关闭的 `res` 里 `write()`，写入的数据堆积在内核缓冲区，直到缓冲区满了才报错（可能很久之后）。同时 `clients` 数组无限增长。

### 解决方案

```javascript
// ✅ 正确做法：断开时清理
const clients = new Map();

app.get('/sse', (req, res) => {
  const id = generateId();
  res.writeHead(200, { /* SSE headers */ });

  clients.set(id, { res, connectedAt: Date.now() });

  // 关键：监听 close 事件
  req.on('close', () => {
    clients.delete(id);
  });
});
```

### 调试技巧

```javascript
// 定期打印连接状态
setInterval(() => {
  for (const [id, client] of clients) {
    const age = (Date.now() - client.connectedAt) / 1000;
    // 检查 res 是否已关闭但还在 Map 中
    if (client.res.writableEnded || client.res.destroyed) {
      console.warn(`僵尸连接: ${id}, 存活 ${age}s`);
      clients.delete(id);
    }
  }
  console.log(`当前连接数: ${clients.size}, 内存: ${process.memoryUsage().heapUsed / 1024 / 1024}MB`);
}, 60000);
```

---

## 坑 4：跨域问题

### 现象

前端在 `http://localhost:5173`（Vite 开发服务器），SSE 服务端在 `http://localhost:3000`。`EventSource` 连接被浏览器 CORS 策略阻止。

### 原因

`EventSource` 发的是普通 HTTP 请求，受 CORS 限制。服务端必须返回正确的 CORS 头。

### 解决方案

```javascript
// 服务端：处理 CORS 预检和简单请求
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // 或指定域名
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.end(); // 预检请求直接返回
  }
  next();
});
```

**如果用了 `withCredentials: true`**：

```javascript
// 客户端
const es = new EventSource('http://localhost:3000/sse', {
  withCredentials: true
});

// 服务端：不能再用 *，必须指定具体域名
res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
res.setHeader('Access-Control-Allow-Credentials', 'true');
```

### 开发环境快速方案

Vite/Webpack 的代理配置：

```javascript
// vite.config.js
export default {
  server: {
    proxy: {
      '/sse': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
};
```

这样前端可以直接 `new EventSource('/sse')`，由开发服务器代理到后端，不存在跨域问题。

---

## 坑 5：服务端 write 报错 — 往已关闭的连接写数据

### 现象

服务端日志中偶尔出现 `Error: Cannot write after end` 或 `This socket has been ended by the other party`。

### 原因

`req.on('close')` 是异步触发的。在 close 回调执行之前，广播循环可能还在往这个 `res` 里写数据。

```javascript
// ❌ 竞态条件
setInterval(() => {
  for (const [, client] of clients) {
    client.res.write(data); // client 可能已经断开，但 close 还没触发
  }
}, 2000);
```

### 解决方案

```javascript
// ✅ 安全写入：检查连接状态 + try-catch
function safeWrite(res, data) {
  try {
    if (!res.writableEnded && !res.destroyed) {
      res.write(data);
      return true;
    }
  } catch (e) {
    // 连接已关闭，忽略写入错误
  }
  return false;
}

// 使用
setInterval(() => {
  for (const [id, client] of clients) {
    if (!safeWrite(client.res, eventData)) {
      clients.delete(id); // 写入失败，清理连接
    }
  }
}, 2000);
```

---

## 坑 6：EventSource 的 `onmessage` 不触发

### 现象

连接建立成功（`onopen` 触发），服务端确实在发数据（抓包能看到），但 `onmessage` 不触发。

### 原因

服务端发送的事件指定了 `event` 字段：

```javascript
res.write('event: notification\n');
res.write('data: 你好\n');
res.write('\n');
```

`onmessage` **只处理没有 `event` 字段的默认事件**。指定了 `event: notification` 的事件不会触发 `onmessage`。

### 解决方案

```javascript
// ❌ 错误：onmessage 收不到具名事件
es.onmessage = (e) => {
  console.log(e.data); // 不会触发
};

// ✅ 正确：用 addEventListener 监听具体事件类型
es.addEventListener('notification', (e) => {
  console.log(e.data); // 正常触发
});
```

---

## 坑 7：Node.js 响应缓冲 — flush 不及时

### 现象

服务端 `res.write()` 之后，客户端没有立即收到。尤其在高并发或数据量小的场景下明显。

### 原因

Node.js 的 HTTP 响应有内部缓冲。`res.write()` 只是把数据写入 Node.js 的缓冲区，不保证立刻发送到网络层。在某些情况下（如 Nagle 算法），小包会被攒成大包再发送。

### 解决方案

在 Express 中：

```javascript
// Express 响应对象上可以直接设置
app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  // ...
  res.flushHeaders(); // 立即发送响应头，不等待第一次 write

  // 每次 write 后如果需要立即发送
  res.write(data);
  if (typeof res.flush === 'function') {
    res.flush(); // 某些 Node.js 版本和压缩中间件支持
  }
});
```

在原生 Node.js `http` 模块中：

```javascript
res.writeHead(200, headers);
// write 后数据会自动 flush，不需要额外操作
// 但如果用了 gzip 压缩中间件，需要特殊处理
```

**注意压缩中间件**：

```javascript
// ❌ 如果用了 compression 中件，SSE 会被压缩导致延迟
app.use(require('compression')()); // 会缓冲 SSE 数据

// ✅ SSE 路由排除压缩
app.get('/sse', (req, res) => {
  res.setHeader('Content-Encoding', 'identity'); // 禁用压缩
  // ...
});
```

---

## 避坑检查清单

每次上线 SSE 功能前，过一遍这张清单：

```
□ Nginx / CDN 缓冲
    → 响应头加了 X-Accel-Buffering: no
    → Nginx 配置了 proxy_buffering off
    → CDN 关闭了该路径的响应缓冲

□ 连接数
    → 同一页面 EventSource 连接不超过 2 个（HTTP/1.1）
    → 多种事件用 event 字段多路复用

□ 内存泄漏
    → req.on('close') 中清理了连接引用
    → write 前检查 res.writableEnded / res.destroyed
    → 有定期清理僵尸连接的机制

□ 跨域
    → 服务端返回了正确的 CORS 头
    → withCredentials 时不用 Access-Control-Allow-Origin: *
    → 开发环境配了代理

□ 心跳
    → 心跳间隔 < 链路最短超时 / 2
    → 客户端有心跳超时检测

□ 错误处理
    → 区分可恢复错误和不可恢复错误
    → 认证失败（401/403）不盲目重连
    → 重连有退避策略和上限

□ 压缩
    → SSE 路由排除 gzip/deflate 压缩
    → 或者在 SSE 响应中禁用压缩

□ 优雅关闭
    → SIGTERM 时先通知客户端再关闭连接
    → K8s 环境配了合理的 terminationGracePeriodSeconds

□ 监控
    → 有连接数监控
    → 有内存使用监控
    → 有事件推送延迟监控
```

---

## 章末思考题

### 思考题 1

如果 SSE 同时遇到了坑 1（Nginx 缓冲）和坑 7（Node.js 响应缓冲），但现象都是"事件延迟到达"。你怎么快速判断是哪一层的问题？能设计一个排查步骤吗？

<details>
<summary>参考答案</summary>

**分层排查法**：

```
第1步：curl -N 直接请求 Node.js 服务（绕过 Nginx）
  → 如果延迟消失 → 问题在 Nginx 层 → 检查 proxy_buffering
  → 如果仍有延迟 → 问题在 Node.js 层 → 继续第2步

第2步：检查 Node.js 是否用了压缩中间件
  → 临时移除 compression() 中间件
  → 如果延迟消失 → 压缩缓冲问题
  → 如果仍有延迟 → 继续第3步

第3步：检查 res.flushHeaders() 和数据包大小
  → 用 Wireshark/tcpdump 抓包看实际发送时间
  → 如果数据在 Node.js 缓冲区停留很久 → Nagle 算法问题
  → 可以用 res.socket.setNoDelay(true) 禁用 Nagle
```

核心思路是**从外到内、逐层绕过**：先绕过 Nginx 直连 Node.js，再绕过中间件裸跑，最后抓包看内核层。每一层的问题定位后单独解决。

**启示**：SSE 的"延迟"可能发生在链路的任何一层。排查时不要猜测，而是逐层隔离。这就是为什么第1章的 demo 用 `curl -N` 验证——它是最简单直接的"绕过所有中间层"的方式。
</details>

### 思考题 2

检查清单中有一条"同一页面 EventSource 连接不超过 2 个"。假设你的应用确实需要 3 种不同类型的数据流（通知、实时指标、任务进度），你会怎么设计？如果未来可能增加到 5-6 种呢？

<details>
<summary>参考答案</summary>

**当前 3 种流的方案**：

用一个 `EventSource` 连接，`event` 字段区分类型：

```javascript
// 服务端
broadcast('notification', { msg: '新订单' });
broadcast('metrics', { cpu: 45 });
broadcast('task-progress', { id: 'A1', progress: 80 });

// 客户端
es.addEventListener('notification', handleNotification);
es.addEventListener('metrics', handleMetrics);
es.addEventListener('task-progress', handleProgress);
```

一个连接，三种事件，完全没有 6 连接限制的问题。

**未来扩展到 5-6 种的考虑**：

继续用 `event` 字段多路复用仍然可行，但需要在架构层面做更好的设计：

```javascript
// 服务端：消息总线模式
const eventBus = new Map();
eventBus.set('notification', notificationHandler);
eventBus.set('metrics', metricsHandler);
eventBus.set('task-progress', taskHandler);
eventBus.set('log', logHandler);
eventBus.set('config-update', configHandler);

// 客户端可以"订阅"自己关心的事件
// 连接时通过 URL query 或 body 告诉服务端要哪些事件
// GET /sse?events=notification,metrics,task-progress

// 服务端只推送客户端订阅的事件
function broadcast(event, data, subscribedEvents) {
  if (!subscribedEvents.includes(event)) return;
  sendSSE(res, { event, data });
}
```

这种"发布-订阅"模式的好处：
1. 客户端只收自己需要的事件，减少无用数据传输
2. 未来增加新事件类型不需要新建连接
3. 服务端可以按事件类型做权限控制

**启示**：多路复用不只是把多个流塞进一个连接，更是一种架构模式。设计得好，新增事件类型是"加一行 addEventListener"的事，而不是"加一个 EventSource 连接"的事。
</details>

### 思考题 3

避坑清单中有一条"有连接数监控"。假设你的服务端管理着 1000 个 SSE 连接，你会监控哪些指标？如果某个指标异常（比如连接数突然从 1000 涨到 5000），你怎么判断是正常流量增长还是出了问题？

<details>
<summary>参考答案</summary>

**关键监控指标**：

```
1. 当前活跃连接数（实时）
2. 连接创建速率（每分钟新建连接数）
3. 连接断开原因分布（客户端主动关闭 vs 网络断开 vs 服务端关闭）
4. 平均连接存活时间
5. 事件推送延迟（write 到客户端实际收到的时间差）
6. 写入失败次数
7. 内存使用量（与连接数的相关性）
```

**判断"突然增长"是否正常**：

关键看**连接创建速率 vs 断开速率的差值**：

```javascript
// 正常流量增长：创建和断开同步增加，净增长平缓
创建: 50/min, 断开: 40/min, 净增: 10/min → 正常

// 异常情况：大量创建，极少断开
创建: 500/min, 断开: 10/min, 净增: 490/min → 异常

// 可能的原因：
// 1. 客户端重连风暴（服务端刚重启）
// 2. 客户端 bug（没调用 es.close() 就反复 new EventSource）
// 3. 恶意连接攻击
// 4. 僵尸连接堆积（close 回调没触发）
```

进一步排查：看**连接的 User-Agent 和 IP 分布**。

- 如果来自少数几个 IP → 可能是某个客户端 bug 或攻击
- 如果均匀分布 → 可能是正常流量增长或重连风暴

**启示**：监控不只是"看数字"，更重要的是看**变化趋势和关联关系**。连接数增长本身不是问题，增长速度和断开速度不匹配才是问题。好的监控应该能帮你区分"为什么涨"而不仅仅是"涨了"。
</details>

---

> 准备好了就说「继续」进入最后一章。
