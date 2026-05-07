# 第3章：结构型模式——Repository 与依赖注入

## 回扣本质

上一章我们解决了"怎么创建对象"的问题。本章解决另一个核心问题：**如何组织对象之间的关系，让业务逻辑不被基础设施绑架**。Repository 模式和依赖注入不是 GoF 的经典分类，但它们是 Go Web 开发中最高频、最实用的结构型实践——正是"低成本修改和扩展"这个核心本质在代码结构层面的直接体现。

---

## 一、问题：业务代码和数据库纠缠在一起

假设 LinkFlow 要加一个功能：创建短链时检查是否已存在相同 URL。一个新手可能这样写：

```go
func (s *LinkService) CreateLink(originalURL string) (*domain.Link, error) {
    // 直接操作数据库——业务逻辑和 SQL 混在一起
    var count int
    err := s.db.QueryRow("SELECT COUNT(*) FROM links WHERE original_url = ?", originalURL).Scan(&count)
    if err != nil {
        return nil, err
    }
    if count > 0 {
        // 已存在，查出来返回
        row := s.db.QueryRow("SELECT code, original_url, created_at FROM links WHERE original_url = ?", originalURL)
        // ... 一堆 Scan 逻辑
    }
    // 不存在，插入
    code := generateCode()
    _, err = s.db.Exec("INSERT INTO links (code, original_url, created_at) VALUES (?, ?, ?)", code, originalURL, time.Now())
    // ...
}
```

问题是什么？
1. **测试困难**：测试 `CreateLink` 必须连真实数据库
2. **换数据库要改业务代码**：从 MySQL 换 PostgreSQL？所有 SQL 都要改
3. **业务意图被淹没**：你要读完 SQL 才能理解"查重 → 复用 → 创建"这个业务流程

---

## 二、Repository 模式：给数据访问画一条线

### 心智模型

Repository 的本质是一条**边界线**：线上面是业务语言（"保存链接"、"按短码查找"），线下面是存储细节（SQL、Redis 命令、文件 IO）。业务层永远不知道线下面发生了什么。

```
┌─────────────────────────────────┐
│  Service（业务逻辑）              │  只说"做什么"
│  "如果 URL 已存在就返回旧链接"    │
└──────────────┬──────────────────┘
               │ 调用接口方法
┌──────────────▼──────────────────┐
│  Store Interface（契约）          │  边界线
│  Save / FindByCode / FindByURL  │
└──────────────┬──────────────────┘
               │ 具体实现
┌──────────────▼──────────────────┐
│  MemoryStore / MySQLStore        │  负责"怎么做"
│  具体的 SQL / map 操作           │
└─────────────────────────────────┘
```

### 扩展 LinkFlow 的 Store 接口

```go
package store

import "linkflow/domain"

type Store interface {
    Save(link *domain.Link) error
    FindByCode(code string) (*domain.Link, error)
    FindByURL(url string) (*domain.Link, error)  // 新增：按原始 URL 查找
    IncrClick(code string) error
    List(offset, limit int) ([]*domain.Link, error)  // 新增：分页列表
}
```

### MySQL 实现

```go
package store

import (
    "database/sql"
    "linkflow/domain"
)

type MySQLStore struct {
    db *sql.DB
}

func NewMySQLStore(dsn string) (*MySQLStore, error) {
    db, err := sql.Open("mysql", dsn)
    if err != nil {
        return nil, err
    }
    if err := db.Ping(); err != nil {
        return nil, err
    }
    return &MySQLStore{db: db}, nil
}

func (m *MySQLStore) Save(link *domain.Link) error {
    _, err := m.db.Exec(
        "INSERT INTO links (code, original_url, created_at, clicks) VALUES (?, ?, ?, ?)",
        link.Code, link.OriginalURL, link.CreatedAt, link.Clicks,
    )
    return err
}

func (m *MySQLStore) FindByCode(code string) (*domain.Link, error) {
    link := &domain.Link{}
    err := m.db.QueryRow(
        "SELECT code, original_url, created_at, clicks FROM links WHERE code = ?", code,
    ).Scan(&link.Code, &link.OriginalURL, &link.CreatedAt, &link.Clicks)
    if err == sql.ErrNoRows {
        return nil, ErrNotFound
    }
    return link, err
}

func (m *MySQLStore) FindByURL(url string) (*domain.Link, error) {
    link := &domain.Link{}
    err := m.db.QueryRow(
        "SELECT code, original_url, created_at, clicks FROM links WHERE original_url = ?", url,
    ).Scan(&link.Code, &link.OriginalURL, &link.CreatedAt, &link.Clicks)
    if err == sql.ErrNoRows {
        return nil, ErrNotFound
    }
    return link, err
}

func (m *MySQLStore) IncrClick(code string) error {
    _, err := m.db.Exec("UPDATE links SET clicks = clicks + 1 WHERE code = ?", code)
    return err
}

func (m *MySQLStore) List(offset, limit int) ([]*domain.Link, error) {
    rows, err := m.db.Query(
        "SELECT code, original_url, created_at, clicks FROM links ORDER BY created_at DESC LIMIT ? OFFSET ?",
        limit, offset,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var links []*domain.Link
    for rows.Next() {
        link := &domain.Link{}
        if err := rows.Scan(&link.Code, &link.OriginalURL, &link.CreatedAt, &link.Clicks); err != nil {
            return nil, err
        }
        links = append(links, link)
    }
    return links, rows.Err()
}
```

### 定义领域错误

```go
package store

import "errors"

var ErrNotFound = errors.New("not found")
```

业务层用 `errors.Is(err, store.ErrNotFound)` 来判断，而不是检查 `sql.ErrNoRows`——这样即使底层换了存储，错误处理逻辑不用变。

---

## 三、依赖注入：不用框架，理解本质

### 心智模型

依赖注入（DI）不是什么高深的事，它的本质就一句话：**不要自己造依赖，让别人传进来**。

对比：

```go
// ❌ 自己造——和 MemoryStore 绑死了
func NewLinkService() *LinkService {
    return &LinkService{
        store: store.NewMemoryStore(),  // 写死了
    }
}

// ✅ 别人传——用什么你说了不算，调用者说了算
func NewLinkService(s store.Store, opts ...Option) *LinkService {
    return &LinkService{store: s}
}
```

就这么简单。Go 里 90% 的依赖注入就是"构造函数接收接口参数"。

### 为什么不用 DI 框架（wire、dig）？

| 方面 | 手动 DI | 框架 DI |
|------|---------|---------|
| 可读性 | `main.go` 里清晰看到谁依赖谁 | 需要理解框架的 DSL |
| 调试 | 编译器直接报错 | 运行时反射出错，堆栈看不懂 |
| 适用规模 | < 30 个组件绰绰有余 | 数百个组件时手动组装确实累 |

**Go 社区的共识**：中小项目手动 DI 足矣。`main.go` 就是你的"组装车间"。

### LinkFlow 的完整组装

```go
func main() {
    cfg := config.Get()

    // 创建存储（工厂模式）
    s, err := store.NewStore(cfg.StoreType, cfg.DSN)
    if err != nil {
        log.Fatal(err)
    }

    // 注入存储到服务（依赖注入）
    svc := service.NewLinkService(s,
        service.WithExpiry(cfg.DefaultExpiry),
        service.WithCodeLength(cfg.CodeLength),
    )

    // 注入服务到处理器（依赖注入）
    h := handler.NewLinkHandler(svc)

    // 组装路由
    mux := http.NewServeMux()
    mux.HandleFunc("/links", h.Create)
    mux.HandleFunc("/", h.Redirect)

    log.Fatal(http.ListenAndServe(":"+cfg.Port, mux))
}
```

依赖方向从上往下流，每一层只知道自己的上游接口。这就是**依赖倒置原则**的实际落地。

---

## 四、收获：可测试性

Repository + DI 带来的最大实际好处是**可测试性**。

### Mock Store 用于单元测试

```go
package service_test

import (
    "testing"
    "linkflow/domain"
    "linkflow/service"
    "linkflow/store"
)

// MockStore 实现 Store 接口，用于测试
type MockStore struct {
    links map[string]*domain.Link
}

func NewMockStore() *MockStore {
    return &MockStore{links: make(map[string]*domain.Link)}
}

func (m *MockStore) Save(link *domain.Link) error {
    m.links[link.Code] = link
    return nil
}

func (m *MockStore) FindByCode(code string) (*domain.Link, error) {
    link, ok := m.links[code]
    if !ok {
        return nil, store.ErrNotFound
    }
    return link, nil
}

func (m *MockStore) FindByURL(url string) (*domain.Link, error) {
    for _, link := range m.links {
        if link.OriginalURL == url {
            return link, nil
        }
    }
    return nil, store.ErrNotFound
}

func (m *MockStore) IncrClick(code string) error {
    if link, ok := m.links[code]; ok {
        link.Clicks++
    }
    return nil
}

func (m *MockStore) List(offset, limit int) ([]*domain.Link, error) {
    return nil, nil
}

func TestCreateLink(t *testing.T) {
    mock := NewMockStore()
    svc := service.NewLinkService(mock)

    link, err := svc.CreateLink("https://example.com")
    if err != nil {
        t.Fatal(err)
    }
    if link.OriginalURL != "https://example.com" {
        t.Errorf("got %s, want https://example.com", link.OriginalURL)
    }
    if len(link.Code) != 6 {
        t.Errorf("code length: got %d, want 6", len(link.Code))
    }
}

func TestCreateLink_Dedup(t *testing.T) {
    mock := NewMockStore()
    svc := service.NewLinkService(mock)

    link1, _ := svc.CreateLink("https://example.com")
    link2, _ := svc.CreateLink("https://example.com")

    // 相同 URL 应该返回同一个短码
    if link1.Code != link2.Code {
        t.Errorf("expected same code for same URL, got %s and %s", link1.Code, link2.Code)
    }
}
```

注意：**测试完全不需要数据库**。`MockStore` 满足 `Store` 接口，`LinkService` 分不出区别。这就是面向接口编程的威力。

---

## 五、升级 LinkService 业务逻辑

有了 `FindByURL`，我们可以实现去重功能：

```go
func (s *LinkService) CreateLink(originalURL string) (*domain.Link, error) {
    // 业务逻辑清晰可读：先查重，再创建
    existing, err := s.store.FindByURL(originalURL)
    if err == nil {
        return existing, nil  // 已存在，直接返回
    }
    if !errors.Is(err, store.ErrNotFound) {
        return nil, fmt.Errorf("check existing: %w", err)
    }

    // 不存在，创建新链接
    link := &domain.Link{
        Code:        s.generateCode(),
        OriginalURL: originalURL,
        CreatedAt:   time.Now(),
    }
    if err := s.store.Save(link); err != nil {
        return nil, fmt.Errorf("save link: %w", err)
    }
    return link, nil
}
```

对比本章开头的"SQL 版"——同样的业务逻辑，哪个更容易理解？

---

## 六、接口设计的几条实战原则

在 Go 中设计 Repository 接口，这些原则很重要：

### 1. 接口定义在使用方，不是实现方

```go
// ✅ service 包定义自己需要的接口
package service

type LinkStore interface {
    Save(link *domain.Link) error
    FindByCode(code string) (*domain.Link, error)
}

// ❌ 不要在 store 包定义一个大而全的接口然后让所有人用
```

这是 Go 的特色——接口小而精，定义在消费者侧。但在实际项目中，如果多个消费者需要相同接口，放在独立包（如 `store` 包）也是合理的。

### 2. 接口要小

```go
// ✅ 如果一个 handler 只需要查询
type LinkReader interface {
    FindByCode(code string) (*domain.Link, error)
}

// ❌ 不要把所有方法塞进一个巨大接口
type EverythingStore interface {
    Save(...) error
    FindByCode(...) (*domain.Link, error)
    FindByURL(...) (*domain.Link, error)
    List(...) ([]*domain.Link, error)
    Delete(...) error
    Update(...) error
    Count() (int, error)
    // ... 20 个方法
}
```

### 3. 返回领域错误，不要泄露实现细节

```go
// ✅ 业务层只看到领域错误
if errors.Is(err, store.ErrNotFound) { ... }

// ❌ 泄露了底层实现
if err == sql.ErrNoRows { ... }      // 换 Redis 就炸了
if strings.Contains(err.Error(), "no rows") { ... }  // 更脆弱
```

---

## 章末思考题

**Q1：** 如果测试中你需要验证"Service 调用了 Store.Save 恰好一次"，MockStore 需要怎么改造？

> **参考答案**：在 MockStore 中加一个计数器字段 `saveCalled int`，在 `Save` 方法里 `m.saveCalled++`，测试结束后断言 `mock.saveCalled == 1`。更通用的做法是记录所有调用（方法名 + 参数），类似 testify/mock 的 `AssertCalled`。核心思想是：Mock 不仅能模拟行为，还能**记录交互**，让你验证业务逻辑的调用路径是否正确。

**Q2：** `store.ErrNotFound` 是包级变量。如果你需要在错误中携带更多信息（比如"哪个 code 没找到"），怎么设计既保留 `errors.Is` 的判断能力，又能携带上下文？

> **参考答案**：定义一个自定义错误类型并实现 `Is` 方法：
> ```go
> type NotFoundError struct {
>     Resource string
>     ID       string
> }
> func (e *NotFoundError) Error() string {
>     return fmt.Sprintf("%s not found: %s", e.Resource, e.ID)
> }
> func (e *NotFoundError) Is(target error) bool {
>     return target == ErrNotFound
> }
> ```
> 这样 `errors.Is(err, store.ErrNotFound)` 依然返回 true，但你可以通过 `errors.As` 取出具体信息。这是 Go 1.13 error wrapping 体系的标准用法。

**Q3（挑战）：** 有人说"Repository 模式就是多套了一层，增加了复杂度"。在什么情况下，这个批评是对的？什么时候这层抽象的收益大于成本？

> **参考答案**：批评成立的场景：项目非常小（一个 CRUD 脚本、一个 CLI 工具）、只有一种存储且永远不会换、不需要单元测试。此时接口层确实是"过度设计"。收益大于成本的场景：需要单元测试（最常见的理由）、可能换存储、多人协作需要清晰边界、业务逻辑复杂到需要和存储细节分离才能看懂。**判断标准不是"以后可能需要"，而是"现在就给我带来好处"**——如果你现在就要写测试，那这层抽象现在就在帮你。

---

> 准备好了就说「继续」进入下一章。
