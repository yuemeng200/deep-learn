# 第5章：行为型模式 II——观察者与事件驱动

## 回扣本质

上一章的策略模式解决了"一对一"的行为协作（选一个算法），中间件链解决了"链式"的行为协作（多步串行）。本章要解决行为型模式中最核心的协作形式——**一对多**：一件事发生后，多个模块需要各自响应，但它们之间不应该互相知道对方的存在。观察者模式是行为型分类中最具代表性的模式——策略是"一对一"，观察者是"一对多"，后者更能体现对象间协作的本质。

---

## 一、问题：短链被点击后，要做的事越来越多

LinkFlow 目前短链被访问时只做一件事：统计计数。但产品需求在增长：

- 记录点击日志（已有）
- 发送 Webhook 通知（运营要看实时数据）
- 更新缓存热度排名
- 检测恶意链接（点击频率异常时告警）

如果继续在 `Redirect` 方法里加逻辑：

```go
func (s *LinkService) Redirect(code string, ip, ua string) (*domain.Link, error) {
    link, err := s.store.FindByCode(code)
    if err != nil {
        return nil, err
    }

    // 越来越长的"后续处理"列表...
    s.recorder.Record(...)
    s.webhook.Send(...)
    s.cache.UpdateRank(...)
    s.detector.Check(...)

    return link, nil
}
```

每加一个下游处理器，都要改 `LinkService`。`LinkService` 变成了一个知道所有下游细节的"上帝对象"。

---

## 二、观察者模式的心智模型

观察者模式的本质：**发布者只负责"喊一声发生了什么"，不关心谁在听、听了之后干什么**。

```
                    ┌──────────────┐
                    │  EventBus    │
                    │  (调度中心)   │
                    └──────┬───────┘
                           │ 分发事件
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐
    │ LogHandler │  │WebhookSender│  │CacheUpdater│
    └────────────┘  └────────────┘  └────────────┘
```

`LinkService` 只需要：`bus.Publish(event)`。谁订阅了这个事件、怎么处理，它完全不知道。

---

## 三、实现 LinkFlow 的事件总线

### 事件定义

```go
package event

import "time"

// Type 是事件类型的枚举
type Type string

const (
    LinkCreated Type = "link.created"
    LinkClicked Type = "link.clicked"
)

// Event 是所有事件的通用结构
type Event struct {
    Type      Type
    Timestamp time.Time
    Payload   interface{}
}

// ClickPayload 是点击事件的具体数据
type ClickPayload struct {
    Code      string
    IP        string
    UserAgent string
}

// CreatePayload 是创建事件的具体数据
type CreatePayload struct {
    Code        string
    OriginalURL string
}
```

### EventBus 实现

```go
package event

import (
    "log"
    "sync"
)

// Handler 是事件处理函数的签名
type Handler func(Event)

// Bus 是事件总线
type Bus struct {
    mu       sync.RWMutex
    handlers map[Type][]Handler
}

func NewBus() *Bus {
    return &Bus{
        handlers: make(map[Type][]Handler),
    }
}

// Subscribe 订阅某类事件
func (b *Bus) Subscribe(eventType Type, handler Handler) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.handlers[eventType] = append(b.handlers[eventType], handler)
}

// Publish 发布事件——通知所有订阅者
func (b *Bus) Publish(e Event) {
    b.mu.RLock()
    handlers := b.handlers[e.Type]
    b.mu.RUnlock()

    for _, h := range handlers {
        h(e) // 同步调用
    }
}

// PublishAsync 异步发布——不阻塞发布者
func (b *Bus) PublishAsync(e Event) {
    b.mu.RLock()
    handlers := b.handlers[e.Type]
    b.mu.RUnlock()

    for _, h := range handlers {
        go func(handler Handler) {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("event handler panic: %v", r)
                }
            }()
            handler(e)
        }(h)
    }
}
```

**设计决策**：
- `Publish` 同步调用：简单可靠，handler 出错调用者能感知
- `PublishAsync` 异步调用：handler 不阻塞主流程，但需要 recover 防止 panic 传播
- 生产环境通常用异步 + worker pool，这里先保持简单

---

## 四、编写事件处理器

### 日志处理器

```go
package handlers

import (
    "log"
    "linkflow/event"
)

func LogHandler(e event.Event) {
    switch p := e.Payload.(type) {
    case event.ClickPayload:
        log.Printf("[click] code=%s ip=%s ua=%s", p.Code, p.IP, p.UserAgent)
    case event.CreatePayload:
        log.Printf("[create] code=%s url=%s", p.Code, p.OriginalURL)
    }
}
```

### Webhook 处理器

```go
package handlers

import (
    "bytes"
    "encoding/json"
    "log"
    "net/http"
    "time"
    "linkflow/event"
)

type WebhookSender struct {
    url    string
    client *http.Client
}

func NewWebhookSender(url string) *WebhookSender {
    return &WebhookSender{
        url: url,
        client: &http.Client{Timeout: 5 * time.Second},
    }
}

func (w *WebhookSender) Handle(e event.Event) {
    body, err := json.Marshal(map[string]interface{}{
        "type":      e.Type,
        "timestamp": e.Timestamp,
        "payload":   e.Payload,
    })
    if err != nil {
        log.Printf("webhook marshal error: %v", err)
        return
    }

    resp, err := w.client.Post(w.url, "application/json", bytes.NewReader(body))
    if err != nil {
        log.Printf("webhook send error: %v", err)
        return
    }
    resp.Body.Close()
}
```

### 缓存热度处理器

```go
package handlers

import (
    "sync"
    "sort"
    "linkflow/event"
)

type HotRank struct {
    mu    sync.RWMutex
    ranks map[string]int64
}

func NewHotRank() *HotRank {
    return &HotRank{ranks: make(map[string]int64)}
}

func (h *HotRank) Handle(e event.Event) {
    if p, ok := e.Payload.(event.ClickPayload); ok {
        h.mu.Lock()
        h.ranks[p.Code]++
        h.mu.Unlock()
    }
}

// TopN 返回点击量最高的 N 个短码
func (h *HotRank) TopN(n int) []string {
    h.mu.RLock()
    defer h.mu.RUnlock()

    type kv struct {
        Code   string
        Clicks int64
    }
    var pairs []kv
    for k, v := range h.ranks {
        pairs = append(pairs, kv{k, v})
    }
    sort.Slice(pairs, func(i, j int) bool {
        return pairs[i].Clicks > pairs[j].Clicks
    })

    result := make([]string, 0, n)
    for i := 0; i < n && i < len(pairs); i++ {
        result = append(result, pairs[i].Code)
    }
    return result
}
```

---

## 五、改造 LinkService：发布事件而非直接调用

```go
type LinkService struct {
    store    store.Store
    bus      *event.Bus
    // recorder 可以去掉了——变成 bus 的一个 subscriber
    // ...
}

func WithEventBus(bus *event.Bus) Option {
    return func(s *LinkService) {
        s.bus = bus
    }
}

func (s *LinkService) CreateLink(originalURL string) (*domain.Link, error) {
    existing, err := s.store.FindByURL(originalURL)
    if err == nil {
        return existing, nil
    }
    if !errors.Is(err, store.ErrNotFound) {
        return nil, fmt.Errorf("check existing: %w", err)
    }

    link := &domain.Link{
        Code:        s.generateCode(),
        OriginalURL: originalURL,
        CreatedAt:   time.Now(),
    }
    if err := s.store.Save(link); err != nil {
        return nil, fmt.Errorf("save link: %w", err)
    }

    // 发布事件——不关心谁在听
    if s.bus != nil {
        s.bus.PublishAsync(event.Event{
            Type:      event.LinkCreated,
            Timestamp: time.Now(),
            Payload:   event.CreatePayload{Code: link.Code, OriginalURL: originalURL},
        })
    }

    return link, nil
}

func (s *LinkService) Redirect(code string, ip, ua string) (*domain.Link, error) {
    link, err := s.store.FindByCode(code)
    if err != nil {
        return nil, err
    }

    // 一行代码替代了之前的 N 行直接调用
    if s.bus != nil {
        s.bus.PublishAsync(event.Event{
            Type:      event.LinkClicked,
            Timestamp: time.Now(),
            Payload:   event.ClickPayload{Code: code, IP: ip, UserAgent: ua},
        })
    }

    return link, nil
}
```

**对比之前**：`Redirect` 方法从"知道所有下游"变成了"只知道发一个事件"。从 5 行下游调用变成 1 行 Publish。

---

## 六、组装：在 main.go 注册事件处理器

```go
func main() {
    cfg := config.Get()
    s, _ := store.NewStore(cfg.StoreType, cfg.DSN)

    // 创建事件总线
    bus := event.NewBus()

    // 注册处理器——想加新的？这里加一行就行
    bus.Subscribe(event.LinkClicked, handlers.LogHandler)

    webhook := handlers.NewWebhookSender(cfg.WebhookURL)
    bus.Subscribe(event.LinkClicked, webhook.Handle)

    hotRank := handlers.NewHotRank()
    bus.Subscribe(event.LinkClicked, hotRank.Handle)

    // 创建事件也可以有处理器
    bus.Subscribe(event.LinkCreated, handlers.LogHandler)

    // 构造服务
    svc := service.NewLinkService(s,
        service.WithEventBus(bus),
    )

    // ... 路由组装
}
```

**核心收益**：明天产品说"点击时要发邮件通知"——你只需要写一个 `EmailNotifier`，在 main.go 加一行 `bus.Subscribe`，`LinkService` 一个字都不用改。

---

## 七、同步 vs 异步的权衡

| 场景 | 选同步 Publish | 选异步 PublishAsync |
|------|---------------|-------------------|
| handler 失败需要回滚主逻辑 | ✅ | ❌ |
| handler 耗时长（HTTP 调用） | ❌ | ✅ |
| 需要保证处理顺序 | ✅ | ❌ |
| 主流程性能敏感 | ❌ | ✅ |

LinkFlow 的选择：
- 点击统计用 `PublishAsync`（不能因为 Webhook 超时就让用户跳转变慢）
- 如果未来有"创建链接时必须同步生成二维码"的需求，那部分用 `Publish`

---

## 八、事件驱动的边界在哪里

事件驱动不是万能的。当这些情况出现时，它可能不是最佳选择：

1. **需要返回值**：事件是"射后不管"的，如果你需要处理器的结果，直接调用更简单
2. **调试困难**：事件流是隐式的，一个 bug 可能要跨多个 handler 追踪
3. **顺序依赖**：如果 handler A 必须在 handler B 之前执行，事件总线的"无序"特性反而是负担

经验法则：**核心业务流程用直接调用，副作用和通知用事件**。

---

## 章末思考题

**Q1：** 现在 `Event.Payload` 是 `interface{}`，handler 里需要类型断言。有什么方式能让事件系统更类型安全？

> **参考答案**：方案一：用泛型（Go 1.18+），定义 `type TypedBus[T any]` 或 `type TypedHandler[T any] func(T)`，为每种事件类型创建专属的总线实例。方案二：为每种事件定义独立的 handler 接口（`ClickHandler`、`CreateHandler`），在 Bus 中按类型分别存储。方案三：用 struct 标签 + 代码生成，自动生成类型安全的注册和分发代码。方案一最符合 Go 的演进方向，但会增加 Bus 的复杂度（可能需要多个 Bus 实例或一个 MultiTypedBus）。

**Q2：** `PublishAsync` 中如果一个 handler panic 了，其他 handler 不受影响。但如果一个 handler 一直阻塞（比如 HTTP 调用卡住了），会有什么后果？怎么防？

> **参考答案**：每次 `PublishAsync` 都 `go` 一个 goroutine，如果 handler 阻塞，goroutine 不会释放。大量事件 + 慢 handler = goroutine 泄漏，最终 OOM。防御方案：① handler 内部设超时（`context.WithTimeout`）；② Bus 层面用 worker pool 限制并发数，超出时丢弃或排队；③ 监控 goroutine 数量，异常时告警。生产级事件总线通常有 worker pool + buffer channel 的组合。

**Q3（挑战）：** 假设需求变了——"点击统计必须保证不丢失，即使服务重启"。纯内存的 EventBus 满足不了。你会怎么演进这个架构？哪些代码需要改，哪些不用？

> **参考答案**：把 EventBus 的 `Publish` 实现从"内存分发"改为"写入持久化消息队列（如 Redis Stream / Kafka）"，消费端从队列拉取后调用 handler。需要改的：`Bus` 的实现（或新建一个 `PersistentBus` 实现同样的 `Publish/Subscribe` 接口）、main.go 的组装代码。**不需要改的**：`LinkService`（它只调 `bus.Publish`）、所有 handler（它们只是处理事件的函数）。这就是接口抽象的价值——`LinkService` 依赖的是"能发布事件"这个能力，不是"内存分发"这个实现。如果一开始就把 Bus 定义为接口，切换更是零改动。

---

> 准备好了就说「继续」进入下一章。
