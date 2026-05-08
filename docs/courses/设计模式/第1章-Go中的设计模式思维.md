# 第1章：Go 中的设计模式思维

## 回扣本质

设计模式的核心是**用结构换灵活性**——通过约定好的协作方式，让代码在增长时依然可控。但 Go 实现这件事的方式和 Java/C++ 截然不同：它没有继承，却有更强大的东西。本章就是建立这个认知的起点。

---

## 一、你熟悉的那套方式，在 Go 里不存在

你做前端时肯定写过这样的代码：

```typescript
// TypeScript
class Storage {
  save(key: string, value: string) { ... }
}

class RedisStorage extends Storage {
  save(key: string, value: string) { /* Redis 实现 */ }
}

class MemoryStorage extends Storage {
  save(key: string, value: string) { /* 内存实现 */ }
}
```

在 Go 里，`extends` 这个关键字不存在。Go 的答案是：**接口（interface）**。

---

## 二、Go 的接口：隐式契约

Go 的接口有一个让很多人第一次看到都觉得奇怪的特点：**你不需要声明"我实现了这个接口"**。

只要一个类型拥有接口要求的所有方法，它就自动满足这个接口。没有 `implements`，没有 `extends`。

```go
// 定义契约：能存储就行
type Store interface {
    Save(key, value string) error
    Get(key string) (string, error)
}

// MemoryStore 实现了 Store —— 但它自己不知道，也不需要知道
type MemoryStore struct {
    data map[string]string
}

func (m *MemoryStore) Save(key, value string) error {
    m.data[key] = value
    return nil
}

func (m *MemoryStore) Get(key string) (string, error) {
    v, ok := m.data[key]
    if !ok {
        return "", fmt.Errorf("key %s not found", key)
    }
    return v, nil
}

// 业务代码只依赖接口，永远不知道背后是内存还是 Redis
type LinkService struct {
    store Store  // 依赖的是接口，不是具体类型
}
```

这个特性是 Go 所有设计模式的地基。**接口是模块之间的契约，而不是类型的标签。**

---

## 三、组合替代继承

Go 用**结构体嵌入（embedding）**来复用代码，而不是继承：

```go
// 不是继承，是"把另一个类型的能力嵌入进来"
type BaseHandler struct {
    logger *log.Logger
}

func (b *BaseHandler) LogRequest(r *http.Request) {
    b.logger.Printf("%s %s", r.Method, r.URL.Path)
}

type LinkHandler struct {
    BaseHandler        // 嵌入，自动获得 LogRequest 方法
    service *LinkService
}
```

这就是 Go 的哲学：**组合优于继承**。你不是"是一个"（is-a），而是"有一个"（has-a）。

---

## 四、搭建 LinkFlow 项目骨架

项目结构：

```
linkflow/
├── main.go          # 入口，组装所有依赖
├── domain/
│   └── link.go      # 核心数据模型（不依赖任何框架）
├── store/
│   └── store.go     # 存储接口 + 内存实现
├── service/
│   └── link.go      # 业务逻辑
└── handler/
    └── link.go      # HTTP 处理器
```

依赖方向：`handler → service → store(interface) ← store/memory(实现)`

### `domain/link.go`

```go
package domain

import "time"

type Link struct {
    Code        string
    OriginalURL string
    CreatedAt   time.Time
    Clicks      int64
}
```

### `store/store.go`

```go
package store

import (
    "fmt"
    "sync"
    "linkflow/domain"
)

type Store interface {
    Save(link *domain.Link) error
    FindByCode(code string) (*domain.Link, error)
    IncrClick(code string) error
}

type MemoryStore struct {
    mu   sync.RWMutex
    data map[string]*domain.Link
}

func NewMemoryStore() *MemoryStore {
    return &MemoryStore{data: make(map[string]*domain.Link)}
}

func (m *MemoryStore) Save(link *domain.Link) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.data[link.Code] = link
    return nil
}

func (m *MemoryStore) FindByCode(code string) (*domain.Link, error) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    link, ok := m.data[code]
    if !ok {
        return nil, fmt.Errorf("link not found: %s", code)
    }
    return link, nil
}

func (m *MemoryStore) IncrClick(code string) error {
    m.mu.Lock()
    defer m.mu.Unlock()
    if link, ok := m.data[code]; ok {
        link.Clicks++
    }
    return nil
}
```

### `service/link.go`

```go
package service

import (
    "fmt"
    "math/rand"
    "time"
    "linkflow/domain"
    "linkflow/store"
)

type LinkService struct {
    store store.Store
}

func NewLinkService(s store.Store) *LinkService {
    return &LinkService{store: s}
}

func (s *LinkService) CreateLink(originalURL string) (*domain.Link, error) {
    link := &domain.Link{
        Code:        generateCode(),
        OriginalURL: originalURL,
        CreatedAt:   time.Now(),
    }
    if err := s.store.Save(link); err != nil {
        return nil, fmt.Errorf("save link: %w", err)
    }
    return link, nil
}

func (s *LinkService) Redirect(code string) (*domain.Link, error) {
    link, err := s.store.FindByCode(code)
    if err != nil {
        return nil, err
    }
    _ = s.store.IncrClick(code)
    return link, nil
}

func generateCode() string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    b := make([]byte, 6)
    for i := range b {
        b[i] = chars[rand.Intn(len(chars))]
    }
    return string(b)
}
```

### `handler/link.go`

```go
package handler

import (
    "encoding/json"
    "net/http"
    "strings"
    "linkflow/service"
)

type LinkHandler struct {
    svc *service.LinkService
}

func NewLinkHandler(svc *service.LinkService) *LinkHandler {
    return &LinkHandler{svc: svc}
}

func (h *LinkHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req struct {
        URL string `json:"url"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid request", http.StatusBadRequest)
        return
    }
    link, err := h.svc.CreateLink(req.URL)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(link)
}

func (h *LinkHandler) Redirect(w http.ResponseWriter, r *http.Request) {
    code := strings.TrimPrefix(r.URL.Path, "/")
    link, err := h.svc.Redirect(code)
    if err != nil {
        http.Error(w, "not found", http.StatusNotFound)
        return
    }
    http.Redirect(w, r, link.OriginalURL, http.StatusFound)
}
```

### `main.go`

```go
package main

import (
    "log"
    "net/http"
    "linkflow/handler"
    "linkflow/service"
    "linkflow/store"
)

func main() {
    s := store.NewMemoryStore()
    svc := service.NewLinkService(s)
    h := handler.NewLinkHandler(svc)

    mux := http.NewServeMux()
    mux.HandleFunc("/links", h.Create)
    mux.HandleFunc("/", h.Redirect)

    log.Println("LinkFlow running on :8080")
    log.Fatal(http.ListenAndServe(":8080", mux))
}
```

---

## 五、这一章已经悄悄用了什么模式？

| 你做的事 | 对应的模式 |
|---------|-----------|
| `LinkService` 依赖 `store.Store` 接口 | 依赖倒置原则 |
| `main.go` 负责把所有零件装在一起 | 依赖注入（第3章详讲） |
| `domain` 包不依赖任何人 | 分层架构的雏形 |

---

## 章末思考题

**Q1：** `MemoryStore` 没有写 `implements Store`，Go 怎么知道它实现了 `Store` 接口？如果你少实现了一个方法，什么时候会报错——编译时还是运行时？

> **参考答案**：Go 在编译时通过"方法集"检查。当你把 `*MemoryStore` 赋值给 `store.Store` 类型的变量时（如 `NewLinkService(s)`），编译器会检查 `*MemoryStore` 是否拥有 `Store` 要求的所有方法。少一个方法就编译报错，不会等到运行时。这是 Go 接口系统的核心优势：**隐式满足，但编译期保证**。

**Q2：** 现在 `main.go` 里写的是 `store.NewMemoryStore()`。假设产品上线了，要把存储换成 MySQL，你需要修改哪些文件？`service/link.go` 需要改吗？为什么？

> **参考答案**：你只需要新建一个 `store/mysql.go` 实现 `Store` 接口，然后修改 `main.go` 的组装代码。`service/link.go` **完全不需要改**——因为它依赖的是 `store.Store` 接口而非具体类型。这就是接口解耦的价值所在：业务逻辑和基础设施彻底隔离，换存储不影响业务代码。

**Q3（挑战）：** 现在 `handler` 包直接依赖了 `*service.LinkService` 具体类型。参照 store 层的设计，你会怎么改造它？改造后有什么好处？

> **参考答案**：在 `service` 包（或 `handler` 包）定义一个 `LinkServiceInterface`，包含 `CreateLink` 和 `Redirect` 两个方法，让 `LinkHandler` 依赖这个接口。好处是：`handler` 的测试可以注入一个 mock service，不需要真实的存储层。这也是后端单元测试的核心技巧——每一层只测自己的逻辑，通过 mock 隔离依赖。
