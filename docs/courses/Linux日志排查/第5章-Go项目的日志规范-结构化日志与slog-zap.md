# 第5章：Go 项目的日志规范 — 结构化日志与 slog/zap

> 前四章你一直是日志的"读者"。本章换个视角——你是日志的"作者"。一条好日志和一条烂日志的排查效率可以差 10 倍。这正是核心本质的另一面：**想高效提问，先得让数据本身好回答**。日志规范不是锦上添花，而是排查能力的基础设施。

---

## 5.1 为什么你写的日志不好查

先看一个反面教材。很多 Go 新手这样写日志：

```go
log.Println("处理订单出错了")
log.Println("error: " + err.Error())
log.Printf("uid: %d, 订单创建失败", uid)
```

产生的日志：

```
2024/03/15 10:00:18 处理订单出错了
2024/03/15 10:00:18 error: connection refused
2024/03/15 10:00:18 uid: 1004, 订单创建失败
```

现在你要排查"用户 1004 的订单为什么失败"：

- `grep "1004"` — 只能找到第三行，但错误原因在第二行，关联不起来
- `grep "error"` — 不知道是哪个用户的错误
- 想统计"各类错误出现了多少次"？几乎不可能，因为错误信息没有固定格式

**问题根源**：日志是**非结构化的自由文本**，每行格式不同，关键信息散落在不同行。

---

## 5.2 结构化日志：让每条日志自带"索引"

结构化日志的核心思想：**每条日志是一个包含固定字段的记录，而不是一段自由文本**。

同样的信息，结构化写法：

```json
{"time":"2024-03-15T10:00:18Z","level":"ERROR","msg":"订单创建失败","uid":1004,"path":"/api/order","err":"connection refused","latency_ms":1205}
```

现在排查：

```bash
# 找用户 1004 的所有错误
grep '"uid":1004' app.log | grep '"level":"ERROR"'

# 用 jq 精确提取
cat app.log | jq 'select(.uid==1004 and .level=="ERROR")'

# 统计各类错误出现次数
cat app.log | jq -r 'select(.level=="ERROR") | .err' | sort | uniq -c | sort -rn

# 找延迟超过 1 秒的请求
cat app.log | jq 'select(.latency_ms > 1000)'
```

**对比感受**：结构化日志让前面学的所有命令（grep、awk、jq）发挥出最大威力。

---

## 5.3 日志级别：什么时候用哪个

```
级别     含义                         Go 项目中的使用场景
─────────────────────────────────────────────────────────────
DEBUG    调试详情                      请求的完整参数、SQL 语句、缓存命中情况
                                     线上一般关闭，排查时临时开启

INFO     正常业务流程                   请求开始/结束、用户登录、订单创建成功
                                     线上的"基准日志"，日常就靠它

WARN     异常但可恢复                   延迟偏高、重试成功、降级处理
                                     不需要立刻处理，但要关注趋势

ERROR    出错了，需要关注               请求失败、数据库连接失败、外部 API 超时
                                     应该触发告警

FATAL    致命错误，程序即将退出          启动配置缺失、关键依赖完全不可用
                                     出现即崩溃，必须立刻响应
```

**两个常见错误**：

1. **什么都用 INFO**：线上日志全是 INFO，grep "ERROR" 找不到任何东西
2. **正常流程用 ERROR**：比如"用户余额不足"是正常业务逻辑，不是系统错误，应该用 WARN 或 INFO

**判断标准**：问自己——"凌晨 3 点看到这条日志，我需要起床处理吗？"需要的是 ERROR，不需要的降级。

---

## 5.4 Go 日志方案对比

### 标准库 log — 能用但不够

```go
import "log"

log.Println("server started")
log.Printf("request failed: %v", err)
```

问题：没有级别、不是结构化、不支持字段。只适合小脚本。

### slog（Go 1.21+ 标准库）— 推荐首选

```go
import "log/slog"

// 初始化：输出 JSON 格式到 stdout
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
    Level: slog.LevelInfo,
}))
slog.SetDefault(logger)

// 使用
slog.Info("server started", "addr", ":8080")
slog.Error("order failed",
    "uid", 1004,
    "path", "/api/order",
    "err", err.Error(),
    "latency_ms", 1205,
)
```

输出：

```json
{"time":"2024-03-15T10:00:01Z","level":"INFO","msg":"server started","addr":":8080"}
{"time":"2024-03-15T10:00:18Z","level":"ERROR","msg":"order failed","uid":1004,"path":"/api/order","err":"connection refused","latency_ms":1205}
```

**为什么推荐 slog**：标准库零依赖、原生结构化、性能不错、支持自定义 Handler。

### zap（uber 出品）— 高性能场景

```go
import "go.uber.org/zap"

logger, _ := zap.NewProduction()
defer logger.Sync()

logger.Error("order failed",
    zap.Int("uid", 1004),
    zap.String("path", "/api/order"),
    zap.Error(err),
    zap.Int64("latency_ms", 1205),
)
```

**什么时候选 zap**：日志量极大（每秒几万条以上）、对性能敏感。zap 比 slog 快 2-5 倍。

### 选型建议

```
场景                     推荐
─────────────────────────────────
小脚本/CLI 工具          标准库 log
一般 Web 服务            slog（Go 1.21+）
高吞吐/对延迟敏感        zap
已有项目用了 logrus      可以继续用，但新项目别选了（维护模式）
```

---

## 5.5 实战：为 order-service 接入 slog

```go
package main

import (
    "log/slog"
    "net/http"
    "os"
    "time"
)

func main() {
    // 1. 初始化 logger
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)

    slog.Info("server started", "addr", ":8080")

    http.HandleFunc("/api/order", handleOrder)
    http.ListenAndServe(":8080", nil)
}

func handleOrder(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    uid := r.URL.Query().Get("uid")

    // 2. 用 slog.With 携带请求级别的公共字段
    reqLogger := slog.With(
        "uid", uid,
        "method", r.Method,
        "path", r.URL.Path,
    )

    // 业务逻辑...
    err := processOrder(uid)

    latency := time.Since(start)

    if err != nil {
        // 3. ERROR 日志：带上所有排查需要的字段
        reqLogger.Error("order failed",
            "err", err.Error(),
            "latency_ms", latency.Milliseconds(),
        )
        http.Error(w, "internal error", 500)
        return
    }

    // 4. INFO 日志：正常请求也要记录
    reqLogger.Info("order success",
        "latency_ms", latency.Milliseconds(),
    )
    w.WriteHeader(200)
}
```

输出的每条日志都是完整的、可独立查询的记录：

```json
{"time":"2024-03-15T10:00:18Z","level":"ERROR","msg":"order failed","uid":"1004","method":"POST","path":"/api/order","err":"connection refused","latency_ms":1205}
```

---

## 5.6 日志最佳实践清单

### 必须包含的字段

```
字段          为什么需要
──────────────────────────────────
时间戳         知道什么时候发生的
级别          快速过滤 ERROR/WARN
请求标识       uid / request_id / trace_id，串联一个请求的所有日志
接口路径       知道是哪个接口出的问题
错误信息       知道具体什么错误
耗时          判断是否超时
```

### 关键原则

**① 一个事件一条日志**

```go
// 坏：一个错误拆成三行
slog.Error("处理订单出错")
slog.Error("错误信息: " + err.Error())
slog.Error("用户: " + uid)

// 好：所有信息在一条里
slog.Error("order failed", "uid", uid, "err", err.Error())
```

**② 用字段（key-value），不要拼字符串**

```go
// 坏：难以用 awk/jq 提取
slog.Info(fmt.Sprintf("uid=%d latency=%dms", uid, latency))

// 好：结构化字段
slog.Info("request completed", "uid", uid, "latency_ms", latency)
```

**③ Error 级别日志必须带 error 字段**

```go
// 坏：知道出错了，但不知道错在哪
slog.Error("database query failed")

// 好：带上完整错误信息
slog.Error("database query failed", "err", err.Error(), "query", sql)
```

**④ 不要记录敏感信息**

密码、token、身份证号、银行卡号等不能出现在日志中。

---

## 5.7 命令速查表（jq 篇）

```bash
# 格式化查看
cat app.log | jq .

# 提取特定字段
cat app.log | jq '{time, level, msg, uid}'

# 按条件过滤
cat app.log | jq 'select(.level=="ERROR")'
cat app.log | jq 'select(.uid=="1004")'
cat app.log | jq 'select(.latency_ms > 1000)'

# 组合条件
cat app.log | jq 'select(.level=="ERROR" and .uid=="1004")'

# 提取字段值用于统计
cat app.log | jq -r '.err' | sort | uniq -c | sort -rn

# 安装 jq（CentOS）
yum install -y jq
```

---

## 章末思考题

**题目一：有人说"线上日志级别应该设为 WARN，INFO 太多了浪费磁盘和性能"。你同意吗？如果不同意，怎么平衡日志量和排查需求？**

> **参考答案**：不完全同意。INFO 级别的日志（如每个请求的开始/结束）是日常排查最重要的数据来源——它能告诉你"谁在什么时候调了什么接口、花了多长时间"。如果只保留 WARN 以上，出了问题时连正常请求的链路都无法还原。正确的做法不是砍级别，而是：① 控制 INFO 的量——每个请求只记一条 INFO（请求结束时）；② 用日志轮转（logrotate）控制磁盘占用；③ DEBUG 在线上默认关闭，排查时动态开启。关掉 INFO 是因噎废食。

**题目二：`slog.With()` 返回一个带有预设字段的新 logger，在请求处理中使用它有什么好处？如果不用 With，会有什么问题？**

> **参考答案**：`slog.With()` 的好处是避免在每条日志中重复写公共字段。比如一个请求处理过程中可能写 5 条日志，每条都需要 uid 和 path。不用 With 的话，每条都要手动加 `"uid", uid, "path", path`，既啰嗦又容易遗漏。更重要的是，With 保证了**同一请求的所有日志都有统一标识字段**，`grep "uid=1004"` 就能串起来。在复杂项目中，通常把 logger 注入到 context 中（配合中间件），自动携带 request_id / trace_id。

**题目三：你的 Go 服务同时输出日志到 stdout 和文件，stdout 被 journalctl 收集。发现 journalctl 里的日志和文件里的格式不一样（journald 加了前缀）。怎么解决？**

> **参考答案**：用 `journalctl -o cat` 输出纯原始内容，去掉 journald 附加的前缀。这样输出的就是 Go 程序原始写出的 JSON，跟直接读文件格式一致。例如：`journalctl -u order-service -o cat --no-pager | jq 'select(.level=="ERROR")'`。`-o cat` 是一个非常实用但很多人不知道的参数。

---

> 准备好了就说「继续」进入下一章。
