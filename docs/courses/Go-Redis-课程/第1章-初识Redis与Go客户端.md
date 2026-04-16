# 第1章：初识 Redis 与 Go 客户端

> 我们说 Redis 的本质是"用内存换时间"。本章将从这个起点出发，理解 Redis 为什么快、它的工作模型是什么，并在 Go 中完成第一次连接和读写——搭建起整个社区项目的骨架。

---

## 1.1 Redis 是什么，为什么快

先建立一个心智模型。想象你去图书馆查资料：

- **传统数据库（MySQL/PostgreSQL）**：管理员去仓库翻找书架（磁盘 I/O），找到后复印一份给你。靠谱，但慢。
- **Redis**：管理员把最常被查的书直接摆在前台桌上（内存），你一伸手就拿到。极快，但桌子空间有限。

Redis 快的三个根本原因：

| 设计选择 | 效果 |
|---------|------|
| **数据全在内存** | 读写延迟在微秒级，比磁盘快 1000 倍以上 |
| **单线程事件循环** | 没有锁竞争、没有上下文切换，逻辑极简 |
| **精简的数据结构** | 每种结构都针对特定操作优化（不是通用型，而是专用型） |

一个常见误解："单线程不是很慢吗？" 不，瓶颈从来不在 CPU 计算，而在 I/O 等待。Redis 用 epoll/kqueue 做 I/O 多路复用，单线程就能轻松处理 10 万+ QPS。

## 1.2 安装与准备

**Redis 服务端**（macOS 为例）：

```bash
# 用 Homebrew 安装
brew install redis

# 启动 Redis（前台运行，方便观察日志）
redis-server

# 另开终端，验证是否正常
redis-cli ping
# 应返回 PONG
```

**Go 项目初始化**：

```bash
mkdir community-api && cd community-api
go mod init community-api
```

**安装 go-redis**（目前最主流的 Go Redis 客户端）：

```bash
go get github.com/redis/go-redis/v9
```

为什么选 `go-redis` 而不是 `redigo`？`go-redis` 提供了类型安全的 API、内置连接池管理、对 Redis 新特性（Stream、Cluster）的原生支持，是当前社区的首选。

## 1.3 第一次连接：Hello Redis

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/redis/go-redis/v9"
)

func main() {
    // 创建客户端 —— 这里已经内置了连接池，不需要手动管理
    rdb := redis.NewClient(&redis.Options{
        Addr:     "localhost:6379",
        Password: "", // 本地开发通常无密码
        DB:       0,  // 使用默认数据库
    })

    ctx := context.Background()

    // 验证连接
    pong, err := rdb.Ping(ctx).Result()
    if err != nil {
        log.Fatalf("连接 Redis 失败: %v", err)
    }
    fmt.Println("Redis 连接成功:", pong)

    // 写入一个键值对
    err = rdb.Set(ctx, "welcome", "你好，Redis！", 0).Err()
    if err != nil {
        log.Fatalf("写入失败: %v", err)
    }

    // 读取
    val, err := rdb.Get(ctx, "welcome").Result()
    if err != nil {
        log.Fatalf("读取失败: %v", err)
    }
    fmt.Println("读取到:", val)
}
```

几个要点：

- **`context.Context`**：go-redis 的所有操作都需要传 context，这让超时控制和取消传播变得自然。
- **`redis.Options`**：`Addr` 是唯一必填项，其余都有合理默认值。连接池大小默认 10，本地开发足够了。
- **`.Result()` 模式**：go-redis 的每个命令返回一个 `*Cmd` 对象，调用 `.Result()` 获取 `(value, error)`。也可以分开用 `.Val()` 和 `.Err()`。

## 1.4 搭建项目骨架

现在把 Redis 集成到一个真正的 Web 服务中。我们用标准库 `net/http`（保持简单，不引入框架）：

```go
package main

import (
    "context"
    "encoding/json"
    "log"
    "net/http"

    "github.com/redis/go-redis/v9"
)

var rdb *redis.Client

func initRedis() {
    rdb = redis.NewClient(&redis.Options{
        Addr: "localhost:6379",
        DB:   0,
    })

    ctx := context.Background()
    if err := rdb.Ping(ctx).Err(); err != nil {
        log.Fatalf("Redis 连接失败: %v", err)
    }
    log.Println("Redis 连接成功")
}

// 健康检查：同时检测 HTTP 服务和 Redis 是否存活
func healthHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    status := map[string]string{"http": "ok"}

    if err := rdb.Ping(ctx).Err(); err != nil {
        status["redis"] = "down"
        w.WriteHeader(http.StatusServiceUnavailable)
    } else {
        status["redis"] = "ok"
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(status)
}

// 简单的计数器接口 —— 每次访问加 1，体验 Redis 的原子递增
func visitHandler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    count, err := rdb.Incr(ctx, "visit_count").Result()
    if err != nil {
        http.Error(w, "Redis 错误", http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]int64{"visits": count})
}

func main() {
    initRedis()

    http.HandleFunc("/health", healthHandler)
    http.HandleFunc("/visit", visitHandler)

    log.Println("服务启动于 :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

运行并测试：

```bash
go run main.go

# 另一个终端
curl localhost:8080/health
# {"http":"ok","redis":"ok"}

curl localhost:8080/visit
# {"visits":1}

curl localhost:8080/visit
# {"visits":2}
```

注意 `INCR` 命令——它是**原子操作**，即使有 100 个并发请求同时到达，计数也不会出错。这就是 Redis 单线程模型带来的天然优势：不需要加锁就能保证操作的原子性。

## 1.5 理解 go-redis 的连接池

你可能注意到我们没有写任何"打开连接/关闭连接"的代码。这是因为 `redis.NewClient` 内部维护了一个**连接池**：

```
你的 Go 程序
    │
    ├── goroutine A ──→ 从池中借一个连接 ──→ 执行命令 ──→ 归还连接
    ├── goroutine B ──→ 从池中借一个连接 ──→ 执行命令 ──→ 归还连接
    └── goroutine C ──→ 池满了，等待...     ──→ 有连接归还 ──→ 执行
```

关键配置参数（现在了解即可，第6章会深入调优）：

```go
&redis.Options{
    PoolSize:     10,              // 最大连接数，默认 10 * runtime.GOMAXPROCS
    MinIdleConns: 3,               // 最少保持的空闲连接
    DialTimeout:  5 * time.Second, // 建立连接超时
    ReadTimeout:  3 * time.Second, // 读操作超时
    WriteTimeout: 3 * time.Second, // 写操作超时
}
```

---

## 章末思考题

**题目一：为什么 Redis 选择单线程模型，而不是像 MySQL 那样用多线程处理并发请求？这个选择有什么代价？**

> **参考解析**：Redis 的操作对象在内存中，CPU 几乎不是瓶颈，瓶颈在网络 I/O。单线程通过 I/O 多路复用处理大量并发连接，避免了多线程的锁竞争和上下文切换开销，代码也更简单、不易出 bug。代价是：如果某个命令执行时间很长（比如 `KEYS *` 遍历百万 key），会阻塞所有其他请求。所以 Redis 的设计哲学是"每个命令都要快"，慢命令在生产中是大忌。

**题目二：在上面的 `visitHandler` 中，我们用 `INCR` 实现计数。如果换成"先 `GET` 再 `SET (val+1)`"两步操作，在并发场景下会出什么问题？**

> **参考解析**：经典的竞态条件（race condition）。假设当前值为 5，两个请求同时 GET 到 5，各自加 1 后 SET 为 6——丢失了一次计数。`INCR` 是原子的，Redis 单线程保证了它在执行期间不会被其他命令打断。这揭示了一个重要原则：**能用 Redis 原子命令解决的问题，不要拆成多步操作**。

**题目三：`redis.NewClient` 创建的连接池，在程序退出时需要手动关闭吗？如果不关闭会怎样？**

> **参考解析**：应该调用 `rdb.Close()` 优雅关闭（通常放在 `defer` 或 shutdown hook 中）。如果不关闭，连接会在进程退出时被操作系统回收，短期内不会有问题。但在长时间运行的服务中，如果反复创建 Client 而不关闭，会导致连接泄漏，最终耗尽 Redis 的最大连接数（默认 10000）。这是一个好习惯问题。

---

> 准备好了就说「继续」进入下一章。
