# 第5章：生产级 SSE — 错误处理、重连与心跳

> 前四章我们从协议到服务端到前端，把 SSE 的骨架搭好了。但 demo 和生产之间隔着一道墙——网络会抖、代理会断、服务会重启。本章专注 SSE 在真实环境中"活下来"的关键技术：错误分类与处理策略、可靠的重连机制、心跳保活，以及服务端优雅关闭。学完本章，你会有一个生产可用的 SSE 连接管理层。

---

## 1. 先搞清楚：SSE 会遇到哪些错误

不是所有错误都应该用同一种方式处理。生产环境下的 SSE 错误可以分为四类：

```
┌─────────────────────────────────────────────────────┐
│                   SSE 错误分类                        │
├──────────────┬──────────────────────────────────────┤
│ 可恢复       │ 网络波动、代理超时、服务端短暂重启       │
│ (应重连)     │ → 自动重连即可                         │
├──────────────┼──────────────────────────────────────┤
│ 需人工介入   │ Token 过期、认证失败 (401/403)          │
│ (不应盲目重连)│ → 先刷新凭证，再重连                   │
├──────────────┼──────────────────────────────────────┤
│ 不可恢复     │ 端点不存在 (404)、服务端逻辑错误 (500)   │
│ (应停止)     │ → 停止重连，提示用户                    │
├──────────────┼──────────────────────────────────────┤
│ 隐性错误     │ 连接还"活着"但不再收到数据              │
│ (最难发现)   │ → 心跳检测 + 超时判断                   │
└──────────────┴──────────────────────────────────────┘
```

### 1.1 原生 EventSource 的错误处理缺陷

```javascript
const es = new EventSource('/sse');

es.onerror = (event) => {
  // 你只能拿到这些信息：
  console.log(event.type);     // 永远是 "error"
  console.log(es.readyState);  // 0=重连中, 2=已关闭

  // 你拿不到：
  // - HTTP 状态码（401? 500?）
  // - 响应体（服务端返回的错误信息）
  // - 断开原因（网络？代理？服务端？）
};
```

原生 `EventSource` 把所有错误都压缩成一个 `error` 事件，你无法区分"该重连"还是"该放弃"。这是第4章讲 fetch 方案的重要原因之一。

### 1.2 错误处理策略矩阵

| 错误类型 | HTTP 状态码 | EventSource 行为 | 正确处理 |
|---------|------------|-----------------|---------|
| 网络断开 | 无响应 | readyState=0，自动重连 | 让它重连 |
| 代理超时 | 502/504 | readyState=0，自动重连 | 让它重连 |
| 认证失败 | 401/403 | readyState=2，停止重连 | 刷新 token 后手动新建连接 |
| 端点不存在 | 404 | readyState=2，停止重连 | 检查 URL，不重连 |
| 服务端错误 | 500 | readyState=0，自动重连 | 限次重连，持续失败则停止 |
| 连接建立但无数据 | 200 | 看起来正常 | 心跳超时检测 |

---

## 2. 可靠的重连机制

### 2.1 原生 EventSource 的重连

原生 `EventSource` 的重连是自动的，你不需要写代码。但你**需要知道它在做什么**：

```
连接断开
  → 触发 onerror
  → readyState 变为 0 (CONNECTING)
  → 等待 retry 毫秒（默认 ~3 秒，服务端可通过 retry: 字段指定）
  → 自动重新请求 URL
  → 如果成功 → onopen
  → 如果失败 → 继续等待 retry 毫秒再试
  → 如果服务端返回非 200 → readyState 变为 2 (CLOSED)，停止重连
```

你能控制的部分：

```javascript
// 1. 服务端指定重连间隔
res.write('retry: 5000\n\n'); // 告诉客户端 5 秒后重连

// 2. 客户端在特定错误时主动关闭（避免无意义重连）
es.onerror = () => {
  // 但你无法知道具体错误类型...这是 EventSource 的痛点
};

// 3. 手动重连：关闭旧的，创建新的
es.close();
es = new EventSource(url);
```

### 2.2 fetch SSE 的重连 — 完全可控

第4章的 `FetchSSE` 实现了基础重连，但生产环境需要更精细的策略：

```javascript
class ProductionSSE {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.abortController = null;
    this.handlers = new Map();
    this.lastEventId = null;
    this._closed = false;
    this._retryCount = 0;
    this._maxRetries = options.maxRetries ?? 10;
    this._baseDelay = options.baseRetryDelay ?? 1000;
    this._maxDelay = options.maxRetryDelay ?? 30000;
    this._heartbeatTimer = null;
    this._lastMessageTime = Date.now();
    this._heartbeatTimeout = options.heartbeatTimeout ?? 45000; // 45 秒没消息视为断开
    this.onStateChange = options.onStateChange ?? (() => {});
  }

  on(event, callback) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(callback);
    return this;
  }

  _emit(event, data) {
    for (const cb of this.handlers.get(event) || []) cb(data);
  }

  async connect() {
    this._closed = false;
    this.onStateChange('connecting');

    try {
      this.abortController = new AbortController();

      const headers = { ...this.options.headers };

      // 断点续传：带上最后收到的事件 ID
      if (this.lastEventId) {
        headers['Last-Event-ID'] = this.lastEventId;
      }

      const response = await fetch(this.url, {
        method: this.options.method || 'GET',
        headers,
        body: this.options.body ? JSON.stringify(this.options.body) : undefined,
        signal: this.abortController.signal
      });

      // === 关键：根据状态码决定行为 ===
      if (response.status === 401 || response.status === 403) {
        // 认证失败：尝试刷新凭证
        const refreshed = await this._tryRefreshAuth();
        if (refreshed) {
          this._retryCount = 0;
          return this.connect(); // 用新 token 重试
        }
        this._emit('auth-error', { status: response.status });
        this.onStateChange('closed');
        return; // 刷新失败，不重连
      }

      if (response.status === 404) {
        this._emit('error', { type: 'not-found', status: 404 });
        this.onStateChange('closed');
        return; // 端点不存在，不重连
      }

      if (!response.ok) {
        // 其他 HTTP 错误：限次重连
        this._emit('error', { type: 'http', status: response.status });
        this.onStateChange('closed');
        return this._scheduleReconnect();
      }

      // 连接成功
      this._retryCount = 0;
      this.onStateChange('open');
      this._startHeartbeatMonitor();

      // 消费 SSE 流
      await this._consumeStream(response);

    } catch (err) {
      if (err.name === 'AbortError') return;

      this._stopHeartbeatMonitor();
      this._emit('error', { type: 'network', error: err });
      this.onStateChange('closed');
      this._scheduleReconnect();
    }
  }

  async _consumeStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this._lastMessageTime = Date.now(); // 收到任何数据都算存活

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const event = this._parseSSE(part);
          if (event) {
            if (event.id) this.lastEventId = event.id;
            this._emit(event.event || 'message', event);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    }

    // 流正常结束（服务端主动关闭了响应）
    this._stopHeartbeatMonitor();
    if (!this._closed) {
      this.onStateChange('closed');
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._closed) return;
    if (this._retryCount >= this._maxRetries) {
      this._emit('error', { type: 'max_retries', attempts: this._retryCount });
      this.onStateChange('dead');
      return;
    }

    this._retryCount++;

    // 指数退避 + 随机抖动
    const exponentialDelay = this._baseDelay * Math.pow(2, this._retryCount - 1);
    const capped = Math.min(exponentialDelay, this._maxDelay);
    const jitter = capped * (0.5 + Math.random() * 0.5); // 50%~100% 的抖动
    const delay = Math.round(jitter);

    console.log(`[SSE] ${delay}ms 后重连 (第 ${this._retryCount}/${this._maxRetries} 次)`);

    setTimeout(() => {
      if (!this._closed) this.connect();
    }, delay);
  }

  async _tryRefreshAuth() {
    try {
      if (this.options.onAuthError) {
        return await this.options.onAuthError();
      }
      return false;
    } catch {
      return false;
    }
  }

  disconnect() {
    this._closed = true;
    this._stopHeartbeatMonitor();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onStateChange('closed');
  }

  // === 心跳监控 ===
  _startHeartbeatMonitor() {
    this._lastMessageTime = Date.now();
    this._heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - this._lastMessageTime;
      if (elapsed > this._heartbeatTimeout) {
        console.log(`[SSE] ${this._heartbeatTimeout}ms 未收到数据，视为断开`);
        this._stopHeartbeatMonitor();
        this.abortController?.abort();
      }
    }, 10000); // 每 10 秒检查一次
  }

  _stopHeartbeatMonitor() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _parseSSE(text) {
    const lines = text.split('\n');
    const event = {};
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const field = line.slice(0, idx);
      let val = line.slice(idx + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      switch (field) {
        case 'data': event.data = event.data ? event.data + '\n' + val : val; break;
        case 'id': event.id = val; break;
        case 'event': event.event = val; break;
        case 'retry': event.retry = parseInt(val, 10); break;
      }
    }
    return event.data !== undefined ? event : null;
  }
}
```

---

## 3. 心跳保活 — 防止"假连接"

### 3.1 为什么需要心跳

网络链路中有很多"中间人"会悄悄掐断空闲连接：

```
浏览器 ←→ CDN ←→ 负载均衡器 ←→ Nginx ←→ Node.js
  │         │         │          │         │
  │    空闲超时60s  空闲超时120s  空闲30s    │
  │         │         │          │         │
  └─────────┴─────────┴──────────┘ 每一层都可能杀掉你的连接
```

如果服务端 30 秒没有任何数据写入，Nginx 可能认为连接已死，默默关掉它。浏览器端的 `EventSource` 并不知道——它以为连接还在，只是没有新消息。

### 3.2 服务端心跳

```javascript
// 方案一：注释心跳（推荐，客户端零感知）
setInterval(() => {
  for (const [, client] of clients) {
    client.res.write(': heartbeat\n\n');
  }
}, 15000); // 15 秒，小于链路中最短超时

// 方案二：带数据的心跳（客户端可以用来检测延迟）
setInterval(() => {
  broadcast('ping', { timestamp: Date.now() });
}, 15000);
```

客户端对应的心跳检测：

```javascript
// 方案二的心跳延迟检测
client.on('ping', (event) => {
  const latency = Date.now() - event.data.timestamp;
  console.log(`心跳延迟: ${latency}ms`);
  if (latency > 10000) {
    console.warn('连接可能不稳定');
  }
});
```

### 3.3 心跳间隔怎么选

```
心跳间隔 < min(链路中所有超时时间) / 2
```

| 环境 | 建议心跳间隔 |
|------|------------|
| 内网（直连） | 30 秒 |
| 有 Nginx（默认 60s 超时） | 15 秒 |
| 有 CDN / 云负载均衡器 | 10-15 秒 |
| 经过多层代理 | 10 秒 |

**宁可频繁一点，也不要因为省心跳导致连接被掐。** 注释心跳的开销极小（每 10 秒几十字节）。

---

## 4. Last-Event-ID — 断点续传

### 4.1 原理

```
正常流程：
  服务端发送 id:1 → id:2 → id:3 → [网络断开] → id:4 → id:5

客户端视角：
  收到 1, 2, 3 → 断开 → 自动重连（请求头带 Last-Event-ID: 3）
  → 服务端知道客户端最后收到了 3，从 id:4 开始补发
  → 客户端无感，没有丢失任何消息
```

### 4.2 服务端实现

```javascript
// 事件存储：环形缓冲区，保留最近 1000 个事件
class EventBuffer {
  constructor(maxSize = 1000) {
    this.events = [];
    this.maxSize = maxSize;
  }

  push(event) {
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.shift(); // 移除最旧的
    }
  }

  // 获取指定 ID 之后的所有事件
  getEventsAfter(lastId) {
    const idx = this.events.findIndex(e => e.id === lastId);
    if (idx === -1) return []; // 太旧了，缓冲区已经没有
    return this.events.slice(idx + 1);
  }
}

const buffer = new EventBuffer(1000);

// SSE 端点
app.get('/sse', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const lastEventId = req.headers['last-event-id'];

  if (lastEventId) {
    // 重连：补发缺失的事件
    const missed = buffer.getEventsAfter(lastEventId);
    console.log(`[重连] 补发 ${missed.length} 个事件`);
    for (const evt of missed) {
      sendSSE(res, evt);
    }
  }

  // ... 正常的 SSE 连接管理
});
```

### 4.3 边界情况

**缓冲区没有该 ID 的事件了**（太久没重连）：

```javascript
const missed = buffer.getEventsAfter(lastEventId);
if (missed.length === 0 && lastEventId) {
  // 太旧了，无法补发，通知客户端做全量同步
  sendSSE(res, {
    id: lastEventId,
    event: 'sync-required',
    data: { message: '事件历史过长，请全量同步' }
  });
}
```

**EventSource 重连时 `Last-Event-ID` 是自动的，fetch 需要手动**：

```javascript
// ProductionSSE 中已实现
if (this.lastEventId) {
  headers['Last-Event-ID'] = this.lastEventId;
}
```

---

## 5. 服务端优雅关闭

### 5.1 为什么要优雅关闭

如果直接 `process.exit()`：
- 所有客户端的连接被硬切断
- 客户端触发 `onerror`，开始重连
- 重连到已经关闭的服务端，失败
- 反复重试，产生大量无效请求

### 5.2 正确的关闭流程

```javascript
function gracefulShutdown(server, sseManager) {
  console.log('\n收到关闭信号，开始优雅关闭...');

  // 1. 停止接收新连接
  server.close(() => {
    console.log('HTTP 服务器已停止接收新连接');
  });

  // 2. 通知所有 SSE 客户端
  for (const [clientId, client] of sseManager.clients) {
    sendSSE(client.res, {
      event: 'server-shutdown',
      data: {
        reason: '服务器维护中',
        estimatedRecovery: '60 秒',
        shouldReconnect: true
      }
    });
    client.res.end();
  }

  // 3. 给客户端一点时间处理关闭消息
  setTimeout(() => {
    console.log('所有连接已关闭');
    process.exit(0);
  }, 2000);
}

process.on('SIGTERM', () => gracefulShutdown(server, manager));
process.on('SIGINT', () => gracefulShutdown(server, manager));
```

### 5.3 客户端配合

```javascript
client.on('server-shutdown', (event) => {
  const data = JSON.parse(event.data);
  if (data.shouldReconnect) {
    console.log(`服务端维护中，预计 ${data.estimatedRecovery} 后恢复`);
    // 延迟重连，避免在服务端关闭期间无意义地反复请求
    setTimeout(() => client.connect(), parseDuration(data.estimatedRecovery));
  } else {
    client.disconnect();
  }
});
```

---

## 6. 完整生产级示例

把上面所有技术整合在一起：

### 服务端

```javascript
// production-server.js
const http = require('http');
const { randomUUID } = require('crypto');

class EventBuffer {
  constructor(max = 1000) {
    this.events = [];
    this.max = max;
  }
  push(evt) {
    this.events.push(evt);
    if (this.events.length > this.max) this.events.shift();
  }
  getAfter(id) {
    const i = this.events.findIndex(e => e.id === id);
    return i === -1 ? [] : this.events.slice(i + 1);
  }
}

class SSEManager {
  constructor() {
    this.clients = new Map();
    this.buffer = new EventBuffer(500);
    this.eventCounter = 0;
    this.heartbeatInterval = null;
  }

  add(res, lastEventId) {
    const id = randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');

    const client = { res, connectedAt: new Date(), lastEventId: 0 };
    this.clients.set(id, client);

    // 重连补发
    if (lastEventId) {
      const missed = this.buffer.getAfter(lastEventId);
      for (const evt of missed) sendSSE(res, evt);
      if (missed.length > 0) client.lastEventId = missed[missed.length - 1].id;
    }

    sendSSE(res, { id: ++this.eventCounter, event: 'connected', data: { clientId: id } });

    res.on('close', () => {
      this.clients.delete(id);
      console.log(`[-] ${id.slice(0, 8)} 断开 (剩余: ${this.clients.size})`);
    });

    console.log(`[+] ${id.slice(0, 8)} 连接 (总计: ${this.clients.size})`);
    return id;
  }

  broadcast(event, data) {
    const id = ++this.eventCounter;
    const evt = { id: String(id), event, data };
    this.buffer.push(evt);
    for (const [, client] of this.clients) {
      sendSSE(client.res, evt);
    }
  }

  startHeartbeat(interval = 15000) {
    this.heartbeatInterval = setInterval(() => {
      for (const [, client] of this.clients) {
        client.res.write(': heartbeat\n\n');
      }
    }, interval);
  }

  shutdown() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const [, client] of this.clients) {
      sendSSE(client.res, {
        event: 'server-shutdown',
        data: { reason: '维护中', shouldReconnect: true }
      });
      client.res.end();
    }
    this.clients.clear();
  }

  get count() { return this.clients.size; }
}

function sendSSE(res, { id, event, data }) {
  if (id !== undefined) res.write(`id: ${id}\n`);
  if (event !== undefined) res.write(`event: ${event}\n`);
  const lines = typeof data === 'string' ? data.split('\n') : [JSON.stringify(data)];
  for (const line of lines) res.write(`data: ${line}\n`);
  res.write('\n');
}

// --- 启动 ---
const manager = new SSEManager();
const server = http.createServer((req, res) => {
  if (req.url === '/sse') {
    manager.add(res, req.headers['last-event-id']);
  } else if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connections: manager.count,
      bufferedEvents: manager.buffer.events.length
    }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// 模拟业务推送
setInterval(() => {
  const events = [
    { event: 'notification', data: { msg: `通知 #${Date.now()}` } },
    { event: 'metrics', data: { cpu: +(Math.random() * 100).toFixed(1) } },
  ];
  const e = events[Math.floor(Math.random() * events.length)];
  manager.broadcast(e.event, e.data);
}, 5000);

manager.startHeartbeat(15000);

server.listen(3000, () => console.log('SSE server :3000/sse'));

// 优雅关闭
const shutdown = () => {
  console.log('\n优雅关闭中...');
  manager.shutdown();
  server.close(() => {
    console.log('已关闭');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000); // 最多等 5 秒
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

---

## 章末思考题

### 思考题 1

`ProductionSSE` 中的心跳监控是客户端的"被动检测"——等待服务端数据，超时则认为断开。而服务端也发心跳。如果客户端的检测超时是 45 秒，服务端心跳间隔是 15 秒，那么在什么情况下客户端会在 45 秒内都收不到心跳、但实际上连接并没有断？

<details>
<summary>参考答案</summary>

**TCP 层面连接已断，但双方都不知道。**

这种"半开连接"（half-open connection）的典型场景：

1. 客户端的网线被拔了（不是浏览器关闭，而是物理断网）
2. NAT 设备的映射表超时被清除
3. 防火墙悄悄丢弃了空闲连接的数据包

在这些情况下：
- 服务端 `res.write(': heartbeat\n\n')` 不会报错——数据只是写入了内核的 TCP 缓冲区
- 客户端根本收不到数据
- 45 秒后客户端的心跳检测触发，`abort()` 掉连接，开始重连

但如果不是物理断网，而是中间代理的缓冲问题——心跳注释行 `: heartbeat\n\n` 只有 16 字节，代理可能把多个小包攒成大包再转发，导致心跳到达延迟。如果延迟超过 45 秒（极端情况），客户端会误判为断开。

**启示**：心跳检测的阈值应该远大于心跳间隔。15 秒心跳 + 45 秒超时 = 允许丢 2 个心跳。生产中一般允许丢 2-3 个心跳再判断断开，避免网络抖动导致的误判。
</details>

### 思考题 2

`EventBuffer` 的环形缓冲区大小设为 1000。假设每秒产生 10 个事件（高负载），客户端断线后多久回来才不会丢事件？如果把缓冲区改为持久化存储（Redis/数据库），会带来什么新的问题？

<details>
<summary>参考答案</summary>

1000 个事件 / 10 个每秒 = **100 秒**。客户端断线超过 100 秒后重连，缓冲区中最早的事件已经被挤出去了，无法补发。

持久化存储的问题：
1. **延迟增加**：内存中读取是纳秒级，Redis 是亚毫秒级，数据库是毫秒级。补发 100 个事件的总耗时可能影响正常推送的实时性
2. **存储成本**：如果每个事件平均 1KB，每秒 10 个 = 每天 ~860MB。保留 7 天就是 ~6GB
3. **清理策略**：需要定期清理过期事件，否则存储会无限增长
4. **竞态条件**：事件写入存储和客户端读取之间可能有延迟，导致"明明存了但读不到"

实际上，大多数生产系统采用折中方案：
- 内存环形缓冲区保留最近 N 个事件（覆盖 99% 的重连场景）
- 关键事件（如交易通知、订单状态变更）写入数据库做持久化
- 重连时先从内存补发，如果 `Last-Event-ID` 太旧，从数据库查询

**启示**：断点续传的"完整性"是一个成本问题。你能承受多大的内存/存储开销，决定了客户端能离线多久还能无损恢复。大多数场景下，内存缓冲区覆盖几分钟的断线就足够了。
</details>

### 思考题 3

在 Kubernetes 环境中，Pod 重启时 SIGTERM 信号可能只给你 30 秒（terminationGracePeriodSeconds）来做优雅关闭。如果此时有 10000 个 SSE 客户端连接着，逐一发送 shutdown 消息 + 关闭连接可能来不及。你会怎么设计？

<details>
<summary>参考答案</summary>

30 秒内关闭 10000 个连接，逐一操作可能来不及。策略：

**方案一：批量关闭 + 只发一次通知**

```javascript
shutdown() {
  // 先广播一次 shutdown 事件（只写一次，TCP 会复制给所有连接）
  // 实际上 HTTP 响应是独立的，需要逐个写...所以还是要循环
  // 但可以并行处理

  const start = Date.now();
  for (const [, client] of this.clients) {
    try {
      sendSSE(client.res, { event: 'server-shutdown', data: { shouldReconnect: true } });
      client.res.end();
    } catch (e) {
      // 已经断开的连接，跳过
    }
  }
  console.log(`关闭 ${this.clients.size} 个连接，耗时 ${Date.now() - start}ms`);
}
```

对 10000 个连接来说，`res.write` + `res.end` 是内存操作，通常几百毫秒就能完成。

**方案二：依赖客户端自我保护（更可靠）**

不在关闭时逐个通知，而是让客户端具备"服务端不可用"的自愈能力：

1. 客户端的重连策略本身就能处理服务端重启（指数退避）
2. 配合 Kubernetes 的 readiness probe——新 Pod 就绪后才接受流量
3. 前面有 Service/Ingress 做负载均衡，重连会路由到健康的 Pod

**方案三：先摘流量，再关闭**

```yaml
# Kubernetes preStop hook
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
```

`preStop` + `sleep` 让 Pod 从 Service 的 Endpoints 中摘除（不再接收新连接），等 10 秒让现有请求处理完毕，然后再发 SIGTERM。

**启示**：在大规模部署中，优雅关闭不是一个"逐个通知"的问题，而是一个"流量调度"问题。客户端的重连策略 + 基础设施的流量管理，比服务端的关闭逻辑更重要。
</details>

---

> 准备好了就说「继续」进入下一章。
