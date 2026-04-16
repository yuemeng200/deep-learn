# 第2章：看日志的基本功 — cat, less, head, tail, grep

> 上一章我们知道了日志住在哪里，本章解决下一个问题——**怎么打开它、怎么看它、怎么在里面找东西**。这五个命令是日志排查最底层的"肌肉记忆"，就像厨师的刀工，后面所有高级操作都建立在它们之上。

---

## 2.1 先准备一份"模拟日志"

为了让你能跟着练，我们先定义一下 `order-service` 产生的日志格式。这是一个典型的 Go 服务日志：

```log
2024-03-15 10:00:01 INFO  [order-service] server started on :8080
2024-03-15 10:00:15 INFO  [order-service] POST /api/order uid=1001 latency=23ms status=200
2024-03-15 10:00:16 INFO  [order-service] POST /api/order uid=1002 latency=45ms status=200
2024-03-15 10:00:17 WARN  [order-service] POST /api/order uid=1003 latency=1205ms status=200
2024-03-15 10:00:18 ERROR [order-service] POST /api/order uid=1004 err="connect mysql timeout" status=500
2024-03-15 10:00:18 ERROR [order-service] POST /api/payment uid=1005 err="insufficient balance" status=400
2024-03-15 10:00:19 INFO  [order-service] GET /api/order/1001 uid=1001 latency=12ms status=200
2024-03-15 10:00:20 ERROR [order-service] POST /api/order uid=1006 err="connect mysql timeout" status=500
2024-03-15 10:00:21 FATAL [order-service] panic: runtime error: invalid memory address or nil pointer dereference
2024-03-15 10:00:21 FATAL [order-service] goroutine 1 [running]:
2024-03-15 10:00:21 FATAL [order-service] main.handleOrder(0x0)
2024-03-15 10:00:21 FATAL [order-service]     /app/handler/order.go:42
```

实际操作时，你可以把上面的内容存为 `/tmp/order-service.log` 来练习。

---

## 2.2 cat — 一口气倒出来

`cat` 是 concatenate（拼接）的缩写，最简单粗暴：把文件内容全部输出到终端。

```bash
cat /tmp/order-service.log
```

**什么时候用**：日志文件很小（几十行到几百行），想快速看全貌。

**什么时候不要用**：文件很大时（几万行以上），`cat` 会把终端刷屏，你根本看不过来。线上日志动辄几百 MB，`cat` 一个大文件是新手常犯的错误。

**实用变体**：

```bash
cat -n /tmp/order-service.log    # -n 显示行号，方便定位"第几行出了问题"
```

---

## 2.3 less — 翻页阅读器

`less` 是看大文件的正确姿势，它不会一口气把文件全加载进内存，而是**按需加载、翻页浏览**。

```bash
less /var/log/messages
```

进入 `less` 后，你面对的是一个交互界面，核心操作：

```
操作              快捷键
──────────────────────────
往下翻一页         空格 / f
往上翻一页         b
往下翻一行         j / ↓ / 回车
往上翻一行         k / ↑
跳到文件开头       g
跳到文件末尾       G（大写）
搜索关键词         /关键词   然后回车
搜索下一个         n
搜索上一个         N（大写）
退出              q
```

**排查场景**：打开一个大日志文件，先按 `G` 跳到末尾看最近发生了什么，然后 `/ERROR` 搜索错误，用 `n` 逐个跳转。

**一个好习惯**：用 `less` 代替 `cat` 看任何超过一屏的文件。`less` 比 `more` 强大（能往回翻），记住一个就够了。

---

## 2.4 head / tail — 看头看尾

大多数排查场景，你不需要看完整日志，只关心**最开头**或**最末尾**。

### head — 看开头

```bash
head /tmp/order-service.log        # 默认显示前 10 行
head -n 20 /tmp/order-service.log  # 显示前 20 行
head -n 1 /tmp/order-service.log   # 只看第一行（比如确认日志格式）
```

**使用场景**：确认日志文件格式、看服务启动时的第一条日志。

### tail — 看结尾（日志排查最高频命令）

```bash
tail /tmp/order-service.log        # 默认显示最后 10 行
tail -n 50 /tmp/order-service.log  # 显示最后 50 行
tail -n +100 /tmp/order-service.log  # 从第 100 行开始显示到末尾（注意 + 号）
```

**使用场景**：线上出问题时，第一反应往往是 `tail -n 100 app.log` 看最近的日志。

### tail -f — 实时跟踪（第4章会深入）

```bash
tail -f /tmp/order-service.log     # 持续输出新追加的内容，Ctrl+C 退出
```

这相当于"打开监控屏幕实时看"。当你在一个终端 `tail -f`，另一个终端复现问题，就能实时看到日志输出。这是线上排查的核心操作之一。

---

## 2.5 grep — 关键词搜索（最重要的命令）

如果只能学一个命令，那就是 `grep`。它的作用是：**从文本中筛选出包含指定关键词的行**。

### 基础用法

```bash
grep "ERROR" /tmp/order-service.log
```

输出：

```
2024-03-15 10:00:18 ERROR [order-service] POST /api/order uid=1004 err="connect mysql timeout" status=500
2024-03-15 10:00:18 ERROR [order-service] POST /api/payment uid=1005 err="insufficient balance" status=400
2024-03-15 10:00:20 ERROR [order-service] POST /api/order uid=1006 err="connect mysql timeout" status=500
```

一行命令就从 12 行日志中提取出了 3 条错误。如果是 10 万行日志呢？同样有效。

### 常用参数——必须记住的 6 个

```bash
# -i  忽略大小写
grep -i "error" /tmp/order-service.log     # 能匹配 ERROR、Error、error

# -n  显示行号
grep -n "ERROR" /tmp/order-service.log     # 输出 "5:2024-03-15 ..."，知道在第几行

# -c  只输出匹配的行数（统计用）
grep -c "ERROR" /tmp/order-service.log     # 输出 3

# -v  反向匹配（排除包含关键词的行）
grep -v "INFO" /tmp/order-service.log      # 显示所有非 INFO 的行

# -A / -B / -C  显示匹配行的上下文
grep -A 3 "panic" /tmp/order-service.log   # 显示匹配行及其后 3 行（After）
grep -B 2 "panic" /tmp/order-service.log   # 显示匹配行及其前 2 行（Before）
grep -C 2 "panic" /tmp/order-service.log   # 前后各 2 行（Context）

# -r  递归搜索目录下所有文件
grep -r "timeout" /var/log/                # 在 /var/log/ 下所有文件中搜索
```

### 最实用的组合

**场景一：快速看有多少条错误**

```bash
grep -c "ERROR" app.log
```

**场景二：看 panic 及其完整堆栈（Go 的 panic 一般跟着好几行堆栈）**

```bash
grep -A 20 "panic" app.log
```

**场景三：找某个用户的所有请求**

```bash
grep "uid=1004" app.log
```

**场景四：找错误但排除某种已知的无害错误**

```bash
grep "ERROR" app.log | grep -v "insufficient balance"
```

注意这里出现了 `|`（管道），它把前一个命令的输出"喂给"后一个命令处理。这是 Linux 的精髓——第6章会专门讲。

---

## 2.6 实战演练：定位一次 500 错误

回到我们的 order-service，运维反馈"最近有用户下单报 500"。你的排查步骤：

```bash
# 第一步：看最近的日志，确认还在出问题吗
tail -n 50 /tmp/order-service.log

# 第二步：有多少 500 错误？
grep -c "status=500" /tmp/order-service.log

# 第三步：看具体是什么错误
grep "status=500" /tmp/order-service.log

# 第四步：发现都是 "connect mysql timeout"，看看这个错误的时间分布
grep "mysql timeout" /tmp/order-service.log

# 第五步：看看出问题前后发生了什么
grep -B 2 -A 2 "mysql timeout" /tmp/order-service.log
```

五步下来，你已经知道了：500 错误是 MySQL 连接超时导致的，不是代码 bug。接下来该去查 MySQL 状态而不是翻代码。

**这就是"向正确的数据提出正确的问题"**——5 个基础命令组合就完成了。

---

## 2.7 命令速查表

```
命令                            用途                    典型场景
──────────────────────────────────────────────────────────────────
cat file                       查看完整内容             小文件快速查看
cat -n file                    带行号查看               定位具体行
less file                      翻页浏览                 大文件查看
head -n N file                 看前 N 行               确认文件格式
tail -n N file                 看后 N 行               看最近的日志
tail -f file                   实时跟踪                 监控实时日志
grep "keyword" file            搜索关键词               找错误、找请求
grep -i "keyword" file         忽略大小写搜索           不确定大小写时
grep -c "keyword" file         统计匹配行数             粗略统计
grep -n "keyword" file         搜索并显示行号           定位位置
grep -v "keyword" file         排除关键词               过滤噪音
grep -A/B/C N "keyword" file   显示上下文               看 panic 堆栈
grep -r "keyword" dir/         递归搜索目录             多文件搜索
```

---

## 章末思考题

**题目一：线上日志文件有 2GB，你需要找其中包含 "panic" 的行。用 `cat app.log | grep "panic"` 和直接 `grep "panic" app.log`，哪种写法更好？为什么？**

> **参考答案**：直接 `grep "panic" app.log` 更好。`cat file | grep` 被称为"无用的 cat"（Useless Use of Cat）——cat 要先把 2GB 文件全部读到内存，通过管道传给 grep；而 grep 直接读文件时可以自己高效地逐行扫描，少了一次完整的数据拷贝。对于小文件差别不大，但对 2GB 的文件，性能差距是可感知的。养成好习惯：如果 grep 能直接接文件参数，就不要画蛇添足加 cat。

**题目二：Go 服务发生 panic 时，日志往往是多行的（第一行是 panic 信息，后面跟着调用栈）。但 `grep "panic"` 只能匹配到包含 "panic" 这个关键词的那一行。如何才能看到 panic 后面的完整调用栈？**

> **参考答案**：使用 `grep -A N "panic" app.log`，其中 N 是你想看 panic 后面多少行。Go 的 panic 堆栈通常有 10-30 行，所以 `grep -A 30 "panic" app.log` 是个安全的选择。如果不确定堆栈有多长，可以先用一个较大的数字（如 50），看到完整堆栈后再调整。另一种方式是用 `less app.log` 然后 `/panic` 搜索跳转，这样可以自由翻阅上下文，不受行数限制。

**题目三：你想找出日志中所有的 WARN 和 ERROR（两种级别都要），用一条 grep 命令怎么做？**

> **参考答案**：使用 `grep -E "WARN|ERROR" app.log`。`-E` 开启扩展正则表达式，`|` 表示"或"。也可以写成 `grep "WARN\|ERROR" app.log`（不加 `-E` 时需要转义 `|`），但 `-E` 的写法更清晰。还有一种方式是用 `egrep "WARN|ERROR" app.log`，`egrep` 等价于 `grep -E`。这个技巧在下一章讲正则表达式时会经常用到。

---

> 准备好了就说「继续」进入下一章。
