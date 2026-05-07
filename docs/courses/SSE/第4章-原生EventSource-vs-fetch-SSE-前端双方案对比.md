# 第4章：原生 EventSource vs fetch SSE — 前端双方案对比（重点章）

> SSE 的核心本质是"用最简单的方式做对的事"。原生 `EventSource` 就是这个哲学的极致体现——但它的"简单"也成了天花板：只支持 GET、不能自定义请求头、不能发请求体。当业务需求超出这个天花板时，我们需要另一种方式来"做对的事"。本章全面对比两种前端 SSE 消费方案，帮你做出正确的技术选型。

---

## 1. 原生 EventSource 的能力边界

先明确 `EventSource` 能做什么、不能做什么：

```javascript
const es = new EventSource('/api/sse');

// ✅ 能做的
// - 发 GET 请求建立 SSE 连接
// - 自动解析 SSE 协议（data/id/event/retry）
// - 自动重连（断线后按 retry 间隔重试）
// - 重连时自动发送 Last-Event-ID 请求头
// - 跨域时可通过 withCredentials 发 Cookie
```

```javascript
// ❌ 做不到的
// 1. 发 POST 请求
new EventSource('/api/sse', { method: 'POST' }); // 报错，没有 method 选项

// 2. 自定义请求头（如 Authorization）
new EventSource('/api/sse', {
  headers: { 'Authorization': 'Bearer xxx' } // 报错，没有 headers 选项
});

// 3. 发送请求体
new EventSource('/api/sse', {
  body: JSON.stringify({ query: '...' }) // 报错，没有 body 选项
});

// 4. 处理非 200 响应
// 服务端返回 401 → EventSource 直接 CLOSED，不再重连
// 你无法拦截响应、读取错误信息、或刷新 token 后重试
```

这在实际业务中意味着什么？三个真实场景：

| 场景 | 为什么 EventSource 搞不定 |
|------|--------------------------|
| **AI 对话** | 需要 POST body 传聊天历史和 prompt |
| **带认证的 API** | 需要 `Authorization: Bearer xxx` 请求头 |
| **复杂查询条件** | 参数太多太复杂，URL query string 放不下或暴露敏感信息 |

---

## 2. fetch SSE — 用 fetch 手动消费 SSE 流

核心思路：用 `fetch` 发请求（可以是 POST，可以带 headers 和 body），然后用 `ReadableStream` 逐块读取响应体，手动解析 SSE 协议文本。

### 2.1 最小实现

```javascript
async function fetchSSE(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 按空行拆分事件
    const parts = buffer.split('\n\n');
    buffer = parts.pop(); // 最后一段可能不完整

    for (const part of parts) {
      const event = parseSSE(part);
      if (event) options.onMessage?.(event);
    }
  }

  // 处理 buffer 中剩余的内容
  if (buffer.trim()) {
    const event = parseSSE(buffer);
    if (event) options.onMessage?.(event);
  }
}

function parseSSE(text) {
  const lines = text.split('\n');
  const event = {};

  for (const line of lines) {
    // 跳过注释行
    if (line.startsWith(':')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const field = line.slice(0, colonIndex);
    let value = line.slice(colonIndex + 1);
    if (value.startsWith(' ')) value = value.slice(1); // 去掉冒号后的空格

    switch (field) {
      case 'data':
        event.data = event.data ? event.data + '\n' + value : value;
        break;
      case 'id':
        event.id = value;
        break;
      case 'event':
        event.event = value;
        break;
      case 'retry':
        event.retry = parseInt(value, 10);
        break;
    }
  }

  // 至少要有 data 字段才算有效事件
  if (event.data === undefined) return null;
  return event;
}
```

使用：

```javascript
await fetchSSE('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer my-token'
  },
  body: {
    messages: [
      { role: 'user', content: '解释一下 SSE' }
    ]
  },
  onMessage(event) {
    if (event.event === 'token') {
      process.stdout.write(event.data); // 逐 token 输出
    }
    if (event.event === 'done') {
      console.log('\n--- 完成 ---');
    }
  }
});
```

### 2.2 AI 对话场景的典型用法

```javascript
// 打字机效果：逐 token 显示 AI 回复
async function chat(prompt) {
  let fullResponse = '';
  const outputEl = document.getElementById('output');

  await fetchSSE('/api/ai/chat', {
    headers: {
      'Authorization': `Bearer ${getToken()}`
    },
    body: {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: '你是一个有帮助的助手' },
        { role: 'user', content: prompt }
      ],
      stream: true
    },
    onMessage(event) {
      if (event.event === 'token') {
        fullResponse += event.data;
        outputEl.textContent = fullResponse;
      }
      if (event.event === 'done') {
        outputEl.textContent = fullResponse;
      }
    }
  });

  return fullResponse;
}
```

---

## 3. 完整的 fetch SSE 工具类

最小实现没有重连、没有取消、没有错误处理。下面是一个生产可用的版本：

```javascript
class FetchSSE {
  constructor(url, options = {}) {
    this.url = url;
    this.options = options;
    this.abortController = null;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.reconnectInterval = options.reconnectInterval ?? 3000;
    this.onStateChange = options.onStateChange ?? (() => {});
    this._closed = false;
    this._retryTimer = null;
  }

  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);
    return this;
  }

  off(event, callback) {
    if (!callback) {
      this.handlers.delete(event);
    } else {
      const callbacks = this.handlers.get(event);
      if (callbacks) {
        const idx = callbacks.indexOf(callback);
        if (idx > -1) callbacks.splice(idx, 1);
      }
    }
    return this;
  }

  _emit(event, data) {
    const callbacks = this.handlers.get(event) || [];
    for (const cb of callbacks) cb(data);
  }

  async connect() {
    this._closed = false;
    this.onStateChange('connecting');

    try {
      this.abortController = new AbortController();

      const fetchOptions = {
        method: this.options.method || 'GET',
        headers: {
          ...(this.options.headers || {})
        },
        signal: this.abortController.signal
      };

      // 有 body 时加 Content-Type
      if (this.options.body) {
        fetchOptions.headers['Content-Type'] =
          fetchOptions.headers['Content-Type'] || 'application/json';
        fetchOptions.body = JSON.stringify(this.options.body);
      }

      const response = await fetch(this.url, fetchOptions);

      if (!response.ok) {
        this._emit('error', { type: 'http', status: response.status });
        this.onStateChange('closed');
        return; // HTTP 错误不重连
      }

      this.reconnectAttempts = 0;
      this.onStateChange('open');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          const event = this._parseSSE(part);
          if (event) {
            this._emit(event.event || 'message', event);
          }
        }
      }

      // 流正常结束（服务端主动关闭）
      if (!this._closed) {
        this._emit('end', {});
        this.onStateChange('closed');
        this._tryReconnect();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        // 用户主动取消，不重连
        return;
      }
      this._emit('error', { type: 'network', error: err });
      this.onStateChange('closed');
      this._tryReconnect();
    }
  }

  _tryReconnect() {
    if (this._closed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._emit('error', { type: 'max_retries', attempts: this.reconnectAttempts });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * this.reconnectAttempts; // 指数退避简化版
    console.log(`[FetchSSE] ${delay}ms 后重连 (第 ${this.reconnectAttempts} 次)...`);

    this._retryTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this._closed = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onStateChange('closed');
  }

  _parseSSE(text) {
    const lines = text.split('\n');
    const event = {};

    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.slice(0, colonIndex);
      let value = line.slice(colonIndex + 1);
      if (value.startsWith(' ')) value = value.slice(1);

      switch (field) {
        case 'data':
          event.data = event.data ? event.data + '\n' + value : value;
          break;
        case 'id':
          event.id = value;
          break;
        case 'event':
          event.event = value;
          break;
        case 'retry':
          event.retry = parseInt(value, 10);
          break;
      }
    }

    return event.data !== undefined ? event : null;
  }
}
```

使用示例：

```javascript
const client = new FetchSSE('/api/ai/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: {
    messages: [{ role: 'user', content: 'Hello' }]
  },
  maxReconnectAttempts: 5,
  reconnectInterval: 2000,
  onStateChange(state) {
    console.log('连接状态:', state);
  }
});

client
  .on('message', (event) => {
    console.log('收到消息:', event.data);
  })
  .on('error', (err) => {
    console.error('错误:', err);
  });

client.connect();

// 需要时断开
// client.disconnect();
```

---

## 4. 双方案全面对比

| 维度 | 原生 EventSource | fetch + ReadableStream |
|------|-----------------|----------------------|
| **请求方法** | 仅 GET | GET / POST / PUT / DELETE 任意 |
| **自定义请求头** | 不支持 | 完全支持 |
| **请求体** | 不支持 | 支持任意 body |
| **认证** | 仅 Cookie（withCredentials） | Cookie / Bearer Token / API Key 等 |
| **协议解析** | 浏览器自动解析 | **需要自己实现** |
| **自动重连** | **内置**，自动发 Last-Event-ID | **需要自己实现** |
| **Last-Event-ID** | 浏览器自动在请求头带上 | 需要自己存储并在重连时带上 |
| **连接状态** | `readyState` 属性实时可查 | 需要自己维护状态 |
| **浏览器兼容** | IE 不支持，其他主流都支持 | 需要 Streams API 支持（IE 不支持） |
| **错误处理** | `onerror`，无法读取 HTTP 响应体 | 可以读取完整的 HTTP 状态码和响应体 |
| **中断控制** | `es.close()` | `AbortController.abort()` |
| **实现复杂度** | 极低（浏览器原生） | 中等（需要手动解析 + 重连） |
| **典型场景** | 实时通知、数据监控、日志流 | AI 对话、复杂查询、需要认证的 API |

### 决策流程图

```
需要 POST 或自定义请求头？
  ├── 否 → 只需要 GET + 简单参数
  │         └── 用原生 EventSource（简单可靠）
  └── 是 → 需要重连吗？
            ├── 是 → 用 FetchSSE 工具类（已实现重连）
            └── 否 → 一次性消费（如 AI 对话流式响应）
                      └── 用简单版 fetchSSE 函数即可
```

---

## 5. 用 `@microsoft/fetch-event-source` 省力

如果你不想自己维护 `FetchSSE` 类，微软开源的 `@microsoft/fetch-event-source` 是社区最成熟的选择：

```bash
npm install @microsoft/fetch-event-source
```

```javascript
import { fetchEventSource } from '@microsoft/fetch-event-source';

const ctrl = new AbortController();

await fetchEventSource('/api/ai/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: '解释 SSE' }]
  }),
  signal: ctrl.signal,

  // 连接成功
  async onopen(response) {
    if (response.ok) {
      console.log('连接成功');
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  },

  // 收到消息
  onmessage(event) {
    console.log(event.event, event.data);
  },

  // 流正常结束
  onclose() {
    console.log('流结束');
  },

  // 出错
  onerror(err) {
    console.error(err);
    // 返回 undefined 或不 throw → 自动重连
    // throw err → 不重连
  },

  // 重连间隔（毫秒）
  // 默认 1000，每次重连翻倍（指数退避）
});
```

它帮你处理了：
- SSE 协议解析（包括 `data`/`id`/`event`/`retry`）
- 指数退避重连
- 可中断（AbortController）
- 响应状态码检查

**但要注意它的限制**：它不维护 `Last-Event-ID`，如果需要断点续传要自己实现。

---

## 6. 服务端如何适配两种客户端

服务端不需要区分客户端用哪种方式连接。SSE 的协议格式是一样的，区别只在客户端怎么消费。

```javascript
// 服务端代码 — 同时支持 EventSource 和 fetch 两种客户端
app.post('/api/chat', (req, res) => {
  // fetch SSE 客户端
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // 从请求体读取参数
  const { messages } = req.body;

  // 流式返回 AI 响应
  streamAIResponse(messages, (token) => {
    res.write(`event: token\ndata: ${JSON.stringify({ content: token })}\n\n`);
  }).then(() => {
    res.write('event: done\ndata: [DONE]\n\n');
    res.end();
  });
});

app.get('/sse', (req, res) => {
  // 原生 EventSource 客户端
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  // ...
});
```

关键区别只在于路由：`POST /api/chat` vs `GET /sse`。

---

## 章末思考题

### 思考题 1

`FetchSSE` 的 `_tryReconnect` 方法中，重连间隔用了 `delay = reconnectInterval * reconnectAttempts`（线性退避）。对比原生 `EventSource` 的重连策略（固定间隔，由服务端 `retry:` 字段指定），两种策略各适合什么场景？有没有更好的退避策略？

<details>
<summary>参考答案</summary>

**固定间隔（EventSource 方式）**：
- 优点：简单可预测，服务端可控
- 缺点：如果服务端宕机需要长时间恢复，所有客户端会以相同频率不断重试，形成"重连风暴"
- 适合：短时网络波动、服务端快速重启的场景

**线性退避（FetchSSE 方式）**：
- 优点：随着失败次数增加，重试间隔逐渐拉长，减轻服务端压力
- 缺点：恢复时间不确定
- 适合：服务端可能需要较长时间恢复的场景

**更好的策略 — 指数退避 + 抖动**：
```javascript
const baseDelay = 1000;
const delay = Math.min(
  baseDelay * Math.pow(2, attempts), // 指数增长
  30000                              // 上限 30 秒
);
const jitter = delay * Math.random() * 0.3; // 加 0~30% 的随机抖动
```

抖动（jitter）是关键：如果 1000 个客户端同时断线，没有抖动的话它们会在同一时刻重连，造成"惊群效应"。加上随机抖动后，重连请求会被打散到不同时间点。

**启示**：重连策略不只是"多久试一次"的技术问题，而是一个分布式系统问题——当大量客户端同时断线又同时重连时，策略的选择直接决定服务端能否扛住。
</details>

### 思考题 2

原生 `EventSource` 重连时自动在请求头中带上 `Last-Event-ID`。但 `FetchSSE` 没有实现这个功能。如果要加上，需要改动哪些地方？服务端又需要怎么配合？

<details>
<summary>参考答案</summary>

客户端改动：

1. **存储 lastEventId**：每收到一个带 `id` 字段的事件就更新
```javascript
// 在 _parseSSE 后
if (event.id) {
  this.lastEventId = event.id;
}
```

2. **重连时带上**：在 `connect()` 的请求头中加上
```javascript
if (this.lastEventId) {
  fetchOptions.headers['Last-Event-ID'] = this.lastEventId;
}
```

服务端配合：

```javascript
app.post('/api/chat', (req, res) => {
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    // 从 lastEventId 之后的事件开始补发
    const missed = eventStore.getEventsAfter(parseInt(lastEventId));
    for (const evt of missed) {
      sendSSE(res, evt);
    }
  }
  // ... 继续正常推送
});
```

但这里有一个**隐藏问题**：`FetchSSE` 的 `connect()` 每次重新执行时会用**同一个 body**。对于 POST 请求，这意味着重连时会重新发送相同的请求体。如果请求体中有时间戳或 nonce，可能导致服务端拒绝。

**启示**：`EventSource` 的 `Last-Event-ID` 看起来是个简单的功能，但完整的断点续传需要客户端和服务端协同——客户端要存 ID，服务端要存事件历史。生产环境中通常用事件历史队列（环形缓冲区）来实现。
</details>

### 思考题 3

EventSource 和 fetch SSE 都可以用作持久连接或单次请求。但同一个前端应用中，如果同时需要一个持久的通知推送连接和一个 AI 对话的流式请求，你会怎么设计？它们可以共用一个连接吗？

<details>
<summary>参考答案</summary>

**两种技术、两种模式，是两个正交的维度**：

| | 持久连接 | 单次请求 |
|---|---|---|
| **EventSource** | 经典通知推送 | 收到特定事件后 `close()` |
| **fetch SSE** | 带认证的持久连接（配合重连机制） | AI 对话流式输出 |

所以选型的依据是**能力需求**（要不要 POST/自定义 headers），而不是使用时长。

**能不能共用一个连接？**

技术上可以——用一个持久 SSE 连接，通过 `event` 字段多路复用，同时传输通知和 AI 对话 token。但这不是一个好设计：

1. **生命周期冲突**：AI 对话的流是"请求-响应"模式（用户提问才产生），而通知是"随时推送"模式。强行复用连接会让服务端逻辑变得复杂
2. **背压不同**：AI 对话可能产生大量 token 需要快速渲染，通知频率低但需要可靠送达。复用连接无法分别控制流控
3. **错误隔离**：AI 流出错不应该影响通知推送，反之亦然

**推荐设计**：

```
EventSource → GET /sse/notifications     → 持久连接，接收通知/指标
fetch SSE   → POST /api/ai/chat          → 每次对话一个请求，流式返回
```

两条连接，各管各的。EventSource 处理不需要认证（或只需 Cookie）的持久推送，fetch SSE 处理需要 POST body + Bearer Token 的流式请求。

**启示**：EventSource 和 fetch SSE 不是"非此即彼"的替代关系，而是可以共存的互补工具。按能力需求选型，按业务特征设计连接策略，不要把所有场景塞进一个连接里。
</details>

---

> 准备好了就说「继续」进入下一章。
