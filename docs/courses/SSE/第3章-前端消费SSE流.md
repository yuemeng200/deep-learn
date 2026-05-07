# 第3章：前端消费 SSE 流

> 前两章我们理解了 SSE 的协议本质，也搭好了服务端。现在回到浏览器端，深入 `EventSource` 的每一个细节——不只是"能跑"，而是真正理解它的状态机、事件模型和生命周期，为后续章节的重连、心跳和框架集成打好基础。

---

## 1. EventSource 的状态机

`EventSource` 有三个状态，对应 `readyState` 属性：

```
CONNECTING (0) → OPEN (1) → CLOSED (2)
      ↑              │
      └──────────────┘  断线后自动重连
```

```javascript
const es = new EventSource('/sse');

es.onopen = () => {
  console.log('状态:', es.readyState); // 1 = OPEN
};

es.onerror = () => {
  // readyState 可能是 0（正在重连）或 2（永久关闭）
  console.log('状态:', es.readyState);
  if (es.readyState === EventSource.CLOSED) {
    console.log('连接永久关闭，不会重连');
  }
};

// 手动关闭 → 状态变为 CLOSED，不再重连
es.close();
```

关键认知：

- `new EventSource(url)` 创建后**立即开始连接**，不需要调用 `connect()` 之类的方法
- 断线后 `readyState` 回到 `0 (CONNECTING)`，浏览器自动重连
- 只有两种方式进入 `CLOSED`：调用 `es.close()`，或服务端返回非 200 状态码
- **`onerror` 不等于"连接失败"**——它只是"出了问题"，可能是正在重连

---

## 2. 事件模型 — 四个回调

```javascript
const es = new EventSource('/sse');

// ① 连接建立
es.onopen = (event) => {
  console.log('连接已建立');
};

// ② 收到默认 message 事件（服务端没有指定 event 字段时）
es.onmessage = (event) => {
  console.log(event.data);         // 数据内容（字符串）
  console.log(event.lastEventId);  // 最后的事件 ID
  console.log(event.origin);       // 服务端来源（用于安全校验）
};

// ③ 收到指定类型的事件
es.addEventListener('notification', (event) => {
  console.log(event.data);
});

// ④ 出错了（连接断开、重连失败、服务端错误...）
es.onerror = (event) => {
  console.log('出错了');
};
```

### event 对象的关键属性

| 属性 | 说明 |
|------|------|
| `data` | 事件数据，字符串类型。如果服务端写了多行 `data:`，浏览器会自动用 `\n` 拼接 |
| `lastEventId` | 最后收到的事件 ID。浏览器内部维护，重连时自动通过 `Last-Event-ID` 请求头发给服务端 |
| `type` | 事件类型字符串，如 `"message"` 或 `"notification"` |
| `origin` | 服务端来源，如 `"http://localhost:3000"`。可用于防止恶意服务端的 SSE 注入 |

### onmessage vs addEventListener

```javascript
// 这两个不等价！

// onmessage 只能收到"没有 event 字段的默认事件"
es.onmessage = (e) => { /* ... */ };

// addEventListener 可以监听任何具名事件
es.addEventListener('notification', (e) => { /* ... */ });

// 如果服务端发了 event: notification，onmessage 不会触发
// 只有 addEventListener('notification', ...) 能收到
```

**最佳实践**：服务端始终指定 `event` 字段，客户端始终用 `addEventListener`。这样做的好处是事件类型在代码中显式声明，可读性和可维护性都更好。

---

## 3. 构造函数参数

```javascript
const es = new EventSource(url, {
  withCredentials: true  // 跨域时发送 Cookie
});
```

`EventSource` 只有一个配置项：`withCredentials`。

- 默认 `false`：跨域请求不发送 Cookie
- 设为 `true`：跨域请求会带上 Cookie（服务端需要配合设置 `Access-Control-Allow-Credentials: true`）

注意：**无法设置自定义请求头**。这是 `EventSource` 的硬限制，也是第4章要讲 fetch 方案的核心动机。

---

## 4. 实战：前端 Dashboard 框架

将第2章的服务端事件集成到一个完整的前端框架中。

### 4.1 SSE 连接封装

```javascript
// sse-client.js — 可复用的 SSE 连接管理器
class SSEClient {
  constructor(url, options = {}) {
    this.url = url;
    this.handlers = new Map(); // event → callback[]
    this.es = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.onStateChange = options.onStateChange ?? (() => {});
  }

  connect() {
    this.onStateChange('connecting');
    this.es = new EventSource(this.url);

    this.es.onopen = () => {
      this.reconnectAttempts = 0;
      this.onStateChange('open');
    };

    this.es.onerror = () => {
      if (this.es.readyState === EventSource.CLOSED) {
        this.onStateChange('closed');
        return;
      }
      this.reconnectAttempts++;
      this.onStateChange('connecting');
    };

    // 注册所有已添加的事件监听器
    for (const [event, callbacks] of this.handlers) {
      for (const cb of callbacks) {
        this.es.addEventListener(event, cb);
      }
    }
  }

  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(callback);

    // 如果已经连接，立即注册
    if (this.es) {
      this.es.addEventListener(event, callback);
    }
  }

  off(event, callback) {
    const callbacks = this.handlers.get(event);
    if (!callbacks) return;

    if (callback) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
      if (this.es) this.es.removeEventListener(event, callback);
    } else {
      // 移除该事件的所有监听器
      if (this.es) {
        for (const cb of callbacks) {
          this.es.removeEventListener(event, cb);
        }
      }
      this.handlers.delete(event);
    }
  }

  disconnect() {
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.onStateChange('closed');
  }

  get state() {
    if (!this.es) return 'closed';
    return ['connecting', 'open', 'closed'][this.es.readyState];
  }
}
```

### 4.2 Dashboard 页面

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>实时通知 Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      padding: 24px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
    }
    .status-dot.open { background: #4caf50; }
    .status-dot.connecting { background: #ff9800; animation: pulse 1s infinite; }
    .status-dot.closed { background: #f44336; }
    @keyframes pulse { 50% { opacity: 0.4; } }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }
    .panel {
      border: 1px solid #2a2a3a;
      border-radius: 12px;
      padding: 20px;
      background: #16162a;
    }
    .panel h3 { font-size: 16px; margin-bottom: 12px; color: #aaa; }
    .panel .value { font-size: 32px; font-weight: 700; }
    .panel .sub { font-size: 13px; color: #666; margin-top: 4px; }

    .log {
      grid-column: 1 / -1;
      max-height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 13px;
      line-height: 1.8;
    }
    .log-entry { padding: 2px 0; border-bottom: 1px solid #1a1a2a; }
    .log-entry .time { color: #555; margin-right: 8px; }
    .log-entry .event-type { color: #00d4ff; margin-right: 8px; }

    .btn {
      padding: 8px 16px;
      border: 1px solid #333;
      border-radius: 6px;
      background: transparent;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 14px;
    }
    .btn:hover { background: #222; }
  </style>
</head>
<body>
  <header>
    <h1>实时通知 Dashboard</h1>
    <div>
      <span class="status">
        <span class="status-dot" id="statusDot"></span>
        <span id="statusText">未连接</span>
      </span>
      <button class="btn" id="toggleBtn" style="margin-left: 16px;">连接</button>
    </div>
  </header>

  <div class="grid">
    <div class="panel">
      <h3>📢 最新通知</h3>
      <div class="value" id="notification">-</div>
      <div class="sub" id="notificationDetail"></div>
    </div>
    <div class="panel">
      <h3>📊 CPU / 内存</h3>
      <div class="value" id="metrics">- / -</div>
      <div class="sub" id="metricsTime"></div>
    </div>
    <div class="panel">
      <h3>⏳ 任务进度</h3>
      <div class="value" id="taskProgress">-</div>
      <div class="sub" id="taskId"></div>
    </div>
    <div class="panel log">
      <h3>事件日志</h3>
      <div id="log"></div>
    </div>
  </div>

  <script src="sse-client.js"></script>
  <script>
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleBtn');
    const logEl = document.getElementById('log');

    let client = null;

    function updateStatus(state) {
      statusDot.className = 'status-dot ' + state;
      const labels = { open: '已连接', connecting: '重连中...', closed: '已断开' };
      statusText.textContent = labels[state] || state;
      toggleBtn.textContent = state === 'open' ? '断开' : '连接';
    }

    function addLog(type, data) {
      const time = new Date().toLocaleTimeString();
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = `<span class="time">${time}</span><span class="event-type">[${type}]</span>${typeof data === 'object' ? JSON.stringify(data) : data}`;
      logEl.prepend(entry);
      // 最多保留 50 条
      while (logEl.children.length > 50) {
        logEl.removeChild(logEl.lastChild);
      }
    }

    function connect() {
      client = new SSEClient('http://localhost:3000/sse', {
        onStateChange: updateStatus
      });

      // 监听各类事件
      client.on('connected', (e) => {
        const data = JSON.parse(e.data);
        addLog('connected', data.message);
      });

      client.on('notification', (e) => {
        const data = JSON.parse(e.data);
        document.getElementById('notification').textContent = data.title;
        document.getElementById('notificationDetail').textContent = data.message;
        addLog('notification', data);
      });

      client.on('metrics', (e) => {
        const data = JSON.parse(e.data);
        document.getElementById('metrics').textContent =
          `${data.cpu.toFixed(1)}% / ${data.mem.toFixed(1)}%`;
        document.getElementById('metricsTime').textContent =
          `更新于 ${new Date().toLocaleTimeString()}`;
        addLog('metrics', data);
      });

      client.on('task-progress', (e) => {
        const data = JSON.parse(e.data);
        document.getElementById('taskProgress').textContent = `${data.progress}%`;
        document.getElementById('taskId').textContent = data.taskId;
        addLog('task-progress', data);
      });

      client.connect();
    }

    // 连接/断开按钮
    toggleBtn.addEventListener('click', () => {
      if (client && client.state === 'open') {
        client.disconnect();
        client = null;
      } else {
        connect();
      }
    });

    // 页面卸载时主动断开
    window.addEventListener('beforeunload', () => {
      if (client) client.disconnect();
    });
  </script>
</body>
</html>
```

---

## 5. 与 React/Vue 集成的模式

### React — 自定义 Hook

```jsx
import { useEffect, useRef, useState, useCallback } from 'react';

function useSSE(url, eventHandlers = {}) {
  const esRef = useRef(null);
  const [state, setState] = useState('closed');

  const connect = useCallback(() => {
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setState('open');
    es.onerror = () => {
      setState(es.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };

    // 注册事件监听
    for (const [event, handler] of Object.entries(eventHandlers)) {
      es.addEventListener(event, (e) => handler(JSON.parse(e.data), e));
    }
  }, [url]); // 注意：eventHandlers 的依赖问题

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setState('closed');
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { state, connect, disconnect };
}

// 使用
function Dashboard() {
  const [notifications, setNotifications] = useState([]);

  const { state } = useSSE('http://localhost:3000/sse', {
    notification: (data) => {
      setNotifications(prev => [data, ...prev].slice(0, 20));
    },
    metrics: (data) => {
      // 直接更新 DOM 或用 setState
      console.log('指标更新:', data);
    }
  });

  return (
    <div>
      <p>连接状态: {state}</p>
      {notifications.map((n, i) => (
        <div key={i}>{n.title}: {n.message}</div>
      ))}
    </div>
  );
}
```

### Vue 3 — Composable

```javascript
// useSSE.js
import { ref, onMounted, onUnmounted } from 'vue';

export function useSSE(url) {
  const state = ref('closed');
  const es = ref(null);
  const handlers = {};

  function on(event, callback) {
    handlers[event] = callback;
    if (es.value) {
      es.value.addEventListener(event, callback);
    }
  }

  function connect() {
    es.value = new EventSource(url);
    state.value = 'connecting';

    es.value.onopen = () => { state.value = 'open'; };
    es.value.onerror = () => {
      state.value = es.value.readyState === EventSource.CLOSED
        ? 'closed' : 'connecting';
    };

    for (const [event, cb] of Object.entries(handlers)) {
      es.value.addEventListener(event, cb);
    }
  }

  function disconnect() {
    if (es.value) {
      es.value.close();
      es.value = null;
      state.value = 'closed';
    }
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return { state, on, connect, disconnect };
}
```

```vue
<!-- Dashboard.vue -->
<script setup>
import { ref } from 'vue';
import { useSSE } from './useSSE.js';

const notifications = ref([]);
const metrics = ref({ cpu: 0, mem: 0 });

const { state, on } = useSSE('http://localhost:3000/sse');

on('notification', (e) => {
  notifications.value.unshift(JSON.parse(e.data));
  if (notifications.value.length > 20) notifications.value.pop();
});

on('metrics', (e) => {
  metrics.value = JSON.parse(e.data);
});
</script>

<template>
  <div>
    <p>状态: {{ state }}</p>
    <p>CPU: {{ metrics.cpu.toFixed(1) }}%</p>
    <div v-for="n in notifications" :key="n.message">
      {{ n.title }}: {{ n.message }}
    </div>
  </div>
</template>
```

---

## 6. 框架集成的关键原则

不管用什么框架，SSE 集成有两条不变的原则：

### 原则一：生命周期绑定

SSE 连接必须在组件卸载时关闭。否则：
- 组件销毁后 `EventSource` 还在后台运行
- 回调函数持有对已销毁组件的引用 → 内存泄漏
- 重连时反复创建新连接

```
React: useEffect 的 cleanup 函数中 close
Vue:   onUnmounted 中 close
```

### 原则二：事件处理函数要稳定引用

```javascript
// ❌ 错误：每次渲染都创建新函数 → 旧的监听器不会被移除
useEffect(() => {
  es.addEventListener('notification', (e) => {
    setNotifications(prev => [...prev, JSON.parse(e.data)]);
  });
}, []); // 闭包捕获了初始的 notifications

// ✅ 正确：用 useCallback 稳定引用，或用 ref 存储最新数据
const handlerRef = useRef();
handlerRef.current = (data) => {
  setNotifications(prev => [...prev, data]);
};
```

---

## 章末思考题

### 思考题 1

React 的 `useEffect` cleanup 函数在组件卸载时调用 `es.close()`。但如果组件因为路由切换被卸载又立刻重新挂载（比如快速前进/后退），会发生什么？旧连接的 `onerror` 回调还会触发吗？

<details>
<summary>参考答案</summary>

执行顺序大致是：

1. 路由切换，旧组件卸载 → cleanup 调用 `es.close()` → 旧连接 CLOSED
2. 新组件挂载 → `useEffect` 创建新的 `EventSource` → 新连接 CONNECTING

关键问题：**旧 `EventSource` 的 `onerror` 回调中如果引用了 `setState`，它指向的是已卸载组件的 state setter**。React 18+ 对此有保护（不会抛错），但这仍然是一次无意义的执行。

更严重的情况：如果 cleanup 中忘记调用 `es.close()`，或者 close 和新连接之间有竞态——你会同时有两个 `EventSource`，同一个事件被处理两次。

解决方案：用 `useRef` 保存 `EventSource` 实例，在 cleanup 中不仅 close，还要**把 ref 置空**，新连接创建时检查 ref 是否为空。或者用 `AbortController` 的模式——给每次连接分配一个 token，回调中检查 token 是否匹配再执行。

```javascript
useEffect(() => {
  let alive = true;
  const es = new EventSource(url);

  es.addEventListener('notification', (e) => {
    if (!alive) return; // 组件已卸载，忽略
    setNotifications(prev => [...prev, JSON.parse(e.data)]);
  });

  return () => {
    alive = false;
    es.close();
  };
}, [url]);
```

**启示**：SSE 是有状态的长期连接，和 React/Vue 的"每次渲染都是新的"理念天然冲突。需要一个"保鲜"机制来处理组件生命周期和连接生命周期的不同步。
</details>

### 思考题 2

在 `SSEClient` 封装中，`connect()` 方法每次都会 `new EventSource(url)`。如果用户快速点击"断开"再"连接"多次，会出现什么问题？如何防止？

<details>
<summary>参考答案</summary>

每次点击"连接"都创建一个新的 `EventSource`，但之前的连接可能还没有完全关闭。结果：
- 多个 `EventSource` 同时存在
- 同一个事件被多个连接接收，处理多次
- 服务端看到一个客户端开了多个连接

防御方案：

```javascript
connect() {
  // 先关闭旧连接
  this.disconnect();
  // 再创建新连接
  this.es = new EventSource(this.url);
  // ...
}
```

或者用防抖/节流限制按钮点击频率，或在 connecting 状态时禁用按钮。本质问题是：**连接创建是异步的，但用户操作是同步的**。需要在状态机中正确处理"正在断开时又请求连接"的中间态。

**启示**：任何涉及异步操作的 UI 交互都需要考虑"快速操作"的边界情况。连接管理是一个有限状态机，状态转换必须有守卫条件。
</details>

### 思考题 3

在 Vue composable 示例中，`onMounted` 里调用 `connect()`。如果这个 composable 是在 Vue 的 `setup()` 中使用的，但对应的组件被 `v-if="false"` 隐藏后又显示（不是 `v-show`），SSE 连接会怎样？

<details>
<summary>参考答案</summary>

`v-if` 会真正销毁和重建组件，`v-show` 只是 CSS 隐藏。

所以 `v-if="false"` 时：
1. 组件卸载 → `onUnmounted` 触发 → `es.close()` → 连接断开
2. `v-if="true"` 时组件重新创建 → `onMounted` 触发 → 新的 `EventSource` 连接

这会导致：每次 `v-if` 从 false 变 true，都会经历一次完整的断开 → 重连。如果有大量状态数据在组件本地（如日志列表），切换时数据会丢失。

解决方案：
1. 用 `v-show` 替代 `v-if`（如果组件只是视觉隐藏）
2. 把 SSE 连接和关键状态提升到父组件或 Pinia store 中，子组件只负责展示
3. 使用 `keep-alive` 缓存组件，避免卸载

**启示**：SSE 连接的生命周期应该和"数据需求"对齐，而不是和"UI 可见性"对齐。如果一个数据流需要持续存在，它的连接管理就不应该绑在可能被销毁的组件上。这也是为什么复杂项目通常把 SSE 连接放在全局状态管理（Redux/Pinia）或专门的 Context/Provider 中。
</details>

---

> 准备好了就说「继续」进入下一章。
