# 第2章：从零搭建 SSE 服务端

> 上一章我们理解了 SSE 的本质——把 HTTP 响应变成无限数据流。本章我们站到服务端的视角，亲手搭建一个完整的 SSE 服务端，看看这个"无限数据流"究竟是怎么管理的。

---

## 1. 服务端的核心职责

SSE 服务端要做的事情可以归结为三件：

1. **设置正确的响应头**，告诉客户端"这是一个 SSE 流"
2. **按照协议格式写入事件**，`data`/`id`/`event`/`retry`
3. **管理连接的生命周期**——谁连上来了、谁断开了、资源怎么清理

第1章的 demo 只做到了前两件，而且是单客户端。本章我们把第三件补齐，做一个**支持多客户端、多事件类型**的完整 SSE 服务端。

---

## 2. 响应头 — SSE 的"身份证"

每个 SSE 响应都必须包含这三个响应头：

```javascript
res.writeHead(200, {
  'Content-Type': 'text/event-stream',  // MIME 类型，浏览器据此识别 SSE
  'Cache-Control': 'no-cache',           // 禁止任何层级的缓存
  'Connection': 'keep-alive'             // 告诉中间代理：不要断开这个连接
});
```

逐个理解：

- **`Content-Type: text/event-stream`**：这是 SSE 的注册 MIME 类型。浏览器看到它，`EventSource` 才会按 SSE 协议解析。如果你写成 `text/plain`，`EventSource` 仍然能连上，但不会触发 `onmessage`。
- **`Cache-Control: no-cache`**：SSE 是实时流，缓存毫无意义。如果中间代理缓存了响应，客户端只会收到一份"快照"，之后的实时更新全丢了。
- **`Connection: keep-alive`**：HTTP/1.1 默认就是 keep-alive，但显式声明可以防止某些旧代理或配置把它改成 close。

另外，强烈建议加这个头：

```javascript
'X-Accel-Buffering': 'no'  // 专给 Nginx 看的：别缓冲我的响应
```

这是 Nginx 的特殊指令，等价于在该 location 块中设置 `proxy_buffering off;`。后面第6章会详细解释为什么需要它。

---

## 3. 写入事件 — 三种写法

SSE 协议极其简单，但"怎么写"有讲究。

### 写法一：手动拼接（理解原理）

```javascript
// 最基础的方式，逐行写入
res.write('id: 1\n');
res.write('event: notification\n');
res.write('data: {"title": "新消息", "content": "你有一条未读通知"}\n');
res.write('\n'); // 空行 = 事件结束
```

### 写法二：封装工具函数（推荐）

```javascript
function sendSSE(res, { id, event, data, retry }) {
  if (retry !== undefined) res.write(`retry: ${retry}\n`);
  if (id !== undefined) res.write(`id: ${id}\n`);
  if (event !== undefined) res.write(`event: ${event}\n`);

  // data 可能是多行字符串
  const lines = typeof data === 'string' ? data.split('\n') : [JSON.stringify(data)];
  for (const line of lines) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n'); // 空行结束
}
```

使用：

```javascript
sendSSE(res, {
  id: 42,
  event: 'price-update',
  data: { symbol: 'AAPL', price: 189.5 }
});
```

### 写法三：心跳 — 保活的关键

```javascript
// 每 30 秒发一个注释行，防止连接被中间层超时掐断
setInterval(() => {
  res.write(': heartbeat\n\n'); // 以 : 开头 = 注释，客户端会忽略
}, 30000);
```

**为什么心跳用注释？** 因为心跳的目的不是传递数据，而是"让连接看起来还活着"。注释行不会触发客户端的任何回调，零干扰。

---

## 4. 连接管理 — 从"能跑"到"能上线"

单客户端的 demo 不需要管理连接。但在生产环境中，你的服务端需要知道：

- 当前有多少客户端连着？
- 某个客户端断开了没有？
- 断开后资源有没有清理？

### 完整示例：多客户端 SSE 服务端

```javascript
const http = require('http');
const { randomUUID } = require('crypto');

// ==================== 连接管理器 ====================
class SSEManager {
  constructor() {
    // Map<clientId, { res, connectedAt, lastEventId }>
    this.clients = new Map();
  }

  // 注册新客户端
  add(res, lastEventId) {
    const clientId = randomUUID();

    // 设置 SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    // 建议客户端 3 秒后重连
    res.write('retry: 3000\n\n');

    const client = {
      res,
      connectedAt: new Date(),
      lastEventId: lastEventId ? parseInt(lastEventId) : 0
    };

    this.clients.set(clientId, client);
    console.log(`[+] 客户端 ${clientId.slice(0, 8)} 已连接 (总计: ${this.clients.size})`);

    // 断开检测
    res.on('close', () => {
      this.clients.delete(clientId);
      console.log(`[-] 客户端 ${clientId.slice(0, 8)} 已断开 (剩余: ${this.clients.size})`);
    });

    return clientId;
  }

  // 向所有客户端广播
  broadcast(event, data) {
    const id = Date.now(); // 用时间戳作为事件 ID
    for (const [clientId, client] of this.clients) {
      sendSSE(client.res, { id, event, data });
      client.lastEventId = id;
    }
    console.log(`[广播] event=${event}, 客户端数=${this.clients.size}`);
  }

  // 向指定客户端发送（断点续传场景）
  sendTo(clientId, events) {
    const client = this.clients.get(clientId);
    if (!client) return;
    for (const evt of events) {
      sendSSE(client.res, evt);
    }
  }

  get count() {
    return this.clients.size;
  }
}

// ==================== 工具函数 ====================
function sendSSE(res, { id, event, data, retry }) {
  if (retry !== undefined) res.write(`retry: ${retry}\n`);
  if (id !== undefined) res.write(`id: ${id}\n`);
  if (event !== undefined) res.write(`event: ${event}\n`);
  const lines = typeof data === 'string' ? data.split('\n') : [JSON.stringify(data)];
  for (const line of lines) {
    res.write(`data: ${line}\n`);
  }
  res.write('\n');
}

// ==================== 启动服务 ====================
const manager = new SSEManager();
let eventCounter = 0;

const server = http.createServer((req, res) => {
  if (req.url === '/sse') {
    // 读取客户端最后收到的事件 ID（重连时会带）
    const lastEventId = req.headers['last-event-id'];
    const clientId = manager.add(res, lastEventId);

    // 如果是重连，补发缺失的事件（简化示例）
    if (lastEventId) {
      sendSSE(res, {
        id: eventCounter,
        event: 'reconnected',
        data: { message: `欢迎回来，你上次收到的事件 ID 是 ${lastEventId}` }
      });
    } else {
      sendSSE(res, {
        id: eventCounter,
        event: 'connected',
        data: { message: '连接成功', clientId }
      });
    }

  } else if (req.url === '/stats') {
    // 管理接口：查看当前连接数
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connections: manager.count }));

  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

// 模拟三种业务事件
setInterval(() => {
  eventCounter++;
  const types = [
    { event: 'notification', data: { title: '系统通知', message: `消息 #${eventCounter}` } },
    { event: 'metrics', data: { cpu: Math.random() * 100, mem: Math.random() * 100 } },
    { event: 'task-progress', data: { taskId: 'build-001', progress: Math.min(100, eventCounter * 2) } }
  ];
  const chosen = types[eventCounter % 3];
  manager.broadcast(chosen.event, chosen.data);
}, 3000);

// 心跳：每 30 秒给所有连接发注释
setInterval(() => {
  for (const [, client] of manager.clients) {
    client.res.write(': heartbeat\n\n');
  }
}, 30000);

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('\n服务端正在关闭...');
  for (const [, client] of manager.clients) {
    sendSSE(client.res, { event: 'server-shutdown', data: { reason: '服务端正在关闭' } });
    client.res.end();
  }
  server.close(() => {
    console.log('服务端已关闭');
    process.exit(0);
  });
});

server.listen(3000, () => {
  console.log('SSE 服务端启动: http://localhost:3000/sse');
  console.log('连接统计: http://localhost:3000/stats');
});
```

### 客户端：消费多事件类型

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SSE 多事件类型 Demo</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #e0e0e0; }
    .panel { border: 1px solid #333; padding: 16px; margin: 8px 0; border-radius: 8px; }
    .notification { border-color: #ff9800; }
    .metrics { border-color: #4caf50; }
    .progress { border-color: #2196f3; }
    h3 { margin: 0 0 8px 0; }
  </style>
</head>
<body>
  <h2>SSE 多事件类型 Dashboard</h2>
  <div id="status">未连接</div>

  <div class="panel notification">
    <h3>📢 通知</h3>
    <div id="notifications">等待中...</div>
  </div>
  <div class="panel metrics">
    <h3>📊 系统指标</h3>
    <div id="metrics">等待中...</div>
  </div>
  <div class="panel progress">
    <h3>⏳ 任务进度</h3>
    <div id="progress">等待中...</div>
  </div>

  <script>
    const es = new EventSource('http://localhost:3000/sse');

    es.onopen = () => {
      document.getElementById('status').textContent = '✓ 已连接';
      document.getElementById('status').style.color = '#4caf50';
    };

    // 方式一：监听具体的事件类型（推荐）
    es.addEventListener('notification', (e) => {
      const data = JSON.parse(e.data);
      document.getElementById('notifications').textContent =
        `${data.title}: ${data.message}`;
    });

    es.addEventListener('metrics', (e) => {
      const data = JSON.parse(e.data);
      document.getElementById('metrics').innerHTML =
        `CPU: ${data.cpu.toFixed(1)}% | 内存: ${data.mem.toFixed(1)}%`;
    });

    es.addEventListener('task-progress', (e) => {
      const data = JSON.parse(e.data);
      document.getElementById('progress').innerHTML =
        `任务 ${data.taskId}: ${data.progress}% <progress value="${data.progress}" max="100"></progress>`;
    });

    // 方式二：onmessage 只会收到没有 event 字段的默认事件
    // 我们的服务端所有事件都指定了 event，所以 onmessage 不会被触发

    // 特殊事件
    es.addEventListener('connected', (e) => {
      const data = JSON.parse(e.data);
      console.log('连接成功:', data.message);
    });

    es.addEventListener('reconnected', (e) => {
      const data = JSON.parse(e.data);
      console.log('重连成功:', data.message);
    });

    es.onerror = () => {
      document.getElementById('status').textContent = '✗ 断开，自动重连中...';
      document.getElementById('status').style.color = '#f44336';
    };
  </script>
</body>
</html>
```

---

## 5. 关键设计点解读

### 5.1 为什么用 Map 而不是数组管理连接？

```javascript
this.clients = new Map(); // clientId → { res, connectedAt, lastEventId }
```

- **O(1) 查找**：需要向特定客户端发送消息时，用 ID 直接定位
- **安全删除**：`res.on('close')` 触发时，用 clientId 从 Map 中移除，不会出现数组 splice 导致的索引错乱
- **自带 size 属性**：随时知道当前连接数

### 5.2 事件 ID 的设计

```javascript
const id = Date.now(); // 用时间戳作为事件 ID
```

事件 ID 是 SSE 重连机制的关键。客户端重连时会通过 `Last-Event-ID` 请求头告诉服务端"我最后收到了什么"，服务端据此补发缺失事件。

生产环境中的 ID 设计有两种常见策略：
- **递增整数**：简单可靠，但需要持久化（服务重启后计数器归零）
- **时间戳**：无需持久化，但同一毫秒内的事件 ID 会重复
- **雪花 ID / ULID**：生产级方案，有序且不重复

### 5.3 `res.on('close')` — 连接管理的基石

```javascript
res.on('close', () => {
  this.clients.delete(clientId);
});
```

这个回调在以下情况都会触发：
- 用户关闭浏览器标签
- 网络断开
- 客户端调用 `es.close()`
- 中间代理主动断开

**如果没有这个清理**：断开的客户端仍然留在 Map 里，服务端继续往已关闭的 `res` 里 `write()`，最终导致内存泄漏和进程崩溃。这是 SSE 服务端最常见的 bug 之一。

---

## 章末思考题

### 思考题 1

上面的代码中，广播函数 `broadcast()` 对所有客户端用了同一个 `id = Date.now()`。如果两个客户端的连接质量不同——客户端 A 即时收到，客户端 B 因为网络抖动还没收到上一个事件——这会有什么问题？你会怎么改进？

<details>
<summary>参考答案</summary>

问题在于：**所有客户端共享同一个事件 ID，但它们的接收进度不同步**。

假设广播了 id=1000 和 id=1001 两个事件：
- 客户端 A 都收到了，lastEventId = 1001
- 客户端 B 只收到了 id=1000 就断线了

重连时 B 带着 `Last-Event-ID: 1000` 回来。但服务端无法判断"这个 ID 之后发了哪些事件"——因为 ID 是广播时临时生成的，没有按客户端维度记录。

改进方案：
1. **维护事件历史队列**：服务端保留最近 N 个事件的环形缓冲区，重连时按 `Last-Event-ID` 查找补发
2. **每个客户端独立跟踪 lastEventId**：虽然 Map 中已经存了，但广播时没有按客户端维度检查是否写入成功

**启示**：SSE 的重连看似简单（浏览器自动发 `Last-Event-ID`），但服务端要真正用好这个 ID，需要额外的事件存储和查询机制。这是从 demo 到生产的关键一步。
</details>

### 思考题 2

心跳间隔设成 30 秒。如果部署在某个云服务商的负载均衡器后面，负载均衡器的空闲连接超时是 60 秒。这个心跳能"保活"吗？如果超时是 25 秒呢？

<details>
<summary>参考答案</summary>

- **超时 60 秒，心跳 30 秒**：能保活。每 30 秒有一次数据传输，连接永远不会空闲超过 60 秒。
- **超时 25 秒，心跳 30 秒**：**不能保活**。两次心跳之间有 30 秒的空窗期，超过了 25 秒的空闲阈值，负载均衡器会在第 25 秒时主动断开连接。

解决方法：心跳间隔必须**小于**中间层最短超时时间的一半左右（留安全余量）。如果不确定中间层的超时配置，10-15 秒是比较安全的心跳间隔。

**启示**：心跳不是"加上就行了"，它的间隔取决于整个链路中最短的超时时间。部署到不同环境可能需要不同的心跳策略。
</details>

### 思考题 3

服务端优雅关闭时，先给客户端发了 `server-shutdown` 事件，然后 `res.end()`。客户端收到 `server-shutdown` 事件后会怎样？`EventSource` 会自动重连吗？

<details>
<summary>参考答案</summary>

**会自动重连。** `res.end()` 对客户端来说就是连接断开，`EventSource` 会触发 `onerror`，然后在 retry 间隔后自动重连。但服务端已经关闭了，所以重连会失败。

这暴露了一个设计问题：**"优雅关闭"到底应该让客户端做什么？**

1. 如果期望客户端**停止重连**：`server-shutdown` 事件中应该包含一个指令，客户端收到后调用 `es.close()` 主动关闭
2. 如果期望客户端**等服务端重启后重连**：当前行为就是对的——重连会持续失败，直到服务端重新上线

更好的做法是 `server-shutdown` 事件中带一个标志：
```javascript
data: {"reason": "维护中", "shouldReconnect": false}
```
客户端代码：
```javascript
es.addEventListener('server-shutdown', (e) => {
  const data = JSON.parse(e.data);
  if (!data.shouldReconnect) es.close();
});
```

**启示**：SSE 的自动重连是双刃剑——它在网络故障时是救命稻草，在服务端主动关闭时却可能造成无意义的重连风暴。生产环境需要一种机制让服务端告诉客户端"别再连了"。
</details>

---

> 准备好了就说「继续」进入下一章。
