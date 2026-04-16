# 第4章：实时追踪与系统日志 — tail -f, journalctl, dmesg

> 前三章我们都在"事后翻日志"——问题已经发生了，去日志里找证据。但更高效的排查方式是**实时盯着日志看**，一边复现问题一边观察输出。本章让你从"考古学家"进化为"现场侦探"，同时学会阅读系统层的日志——这正是"向正确的数据提问"中**时效性**维度的体现。

---

## 4.1 tail -f / tail -F — 实时追踪文件

### tail -f：基础实时追踪

```bash
tail -f /var/log/app.log
```

它做的事情：**显示文件最后 10 行，然后挂在那里，文件每追加新内容就立刻输出**。按 `Ctrl+C` 退出。

典型用法——开两个终端窗口：

```
┌─────────────────────────┬─────────────────────────┐
│  终端 1：实时看日志       │  终端 2：操作/复现问题    │
│                         │                         │
│  tail -f app.log        │  curl localhost:8080/api │
│  (等着输出)              │  (触发请求)              │
│  → 立刻看到新日志        │                         │
└─────────────────────────┴─────────────────────────┘
```

### tail -f 配合 grep：只看你关心的

实时日志刷得很快，直接看会被淹没。加上 grep 过滤：

```bash
# 只看 ERROR 级别的实时日志
tail -f app.log | grep "ERROR"

# 只看某个用户的请求
tail -f app.log | grep "uid=1004"

# 只看某个接口，并保证实时性
tail -f app.log | grep --line-buffered "api/order"
```

**注意 `--line-buffered`**：管道默认有缓冲区，可能攒一批数据才输出。加了这个参数，grep 每匹配到一行就立刻输出，实时性更好。如果你发现 `tail -f | grep` 不出东西，十有八九是缓冲问题，加上这个参数。

### tail -F vs tail -f：日志轮转场景

线上服务通常会做**日志轮转**（log rotation）：当 `app.log` 太大时，系统把它重命名为 `app.log.1`，再创建一个新的 `app.log`。

```
app.log      →  被重命名为 app.log.1
(新的) app.log  →  新日志写到这里
```

这时候：
- `tail -f`：还在追踪旧文件（已经被重命名的那个），**看不到新日志**
- `tail -F`：会检测到文件被替换，**自动跟踪新文件**

```bash
# 线上环境永远用大 F
tail -F /var/log/app.log
```

**记住：线上用 `-F`，本地调试用 `-f`。**

### 同时追踪多个文件

```bash
# tail 自带的多文件追踪
tail -F /var/log/app.log /var/log/app-error.log

# 输出会标注来自哪个文件：
# ==> /var/log/app.log <==
# 2024-03-15 10:00:18 INFO ...
# ==> /var/log/app-error.log <==
# 2024-03-15 10:00:18 ERROR ...
```

---

## 4.2 journalctl — systemd 日志的瑞士军刀

如果你的 Go 服务用 systemd 管理（CentOS 7+ 的标准做法），那 `journalctl` 是你最强的日志查询工具。

### 为什么 journalctl 比翻文件强

| 能力 | 翻文件（grep） | journalctl |
|------|---------------|------------|
| 按服务过滤 | 需要知道日志文件路径 | `journalctl -u 服务名` |
| 按时间范围 | grep 时间字符串（粗糙） | `--since / --until`（精确） |
| 看最近 N 条 | `tail -n N` | `-n N` |
| 实时追踪 | `tail -f` | `-f` |
| 看上次崩溃的日志 | 不方便 | `-b -1`（上一次启动） |
| 按优先级过滤 | grep "ERROR" | `-p err` |

### 最常用的命令（按使用频率排序）

**① 查看某个服务的日志**

```bash
journalctl -u order-service          # 查看全部日志
journalctl -u order-service -n 50    # 最近 50 条
journalctl -u order-service -f       # 实时追踪（等价于 tail -f）
```

`-u` 是 unit 的缩写，对应 systemd 的服务单元名。

**② 按时间范围过滤**

```bash
# 看今天的日志
journalctl -u order-service --since today

# 看最近 30 分钟
journalctl -u order-service --since "30 min ago"

# 精确时间范围
journalctl -u order-service --since "2024-03-15 10:00" --until "2024-03-15 11:00"

# 看昨天的
journalctl -u order-service --since yesterday --until today
```

**③ 按日志级别过滤**

```bash
journalctl -u order-service -p err       # 只看 ERROR 及以上
journalctl -u order-service -p warning   # 只看 WARNING 及以上
```

systemd 日志级别（从低到高）：`debug < info < notice < warning < err < crit < alert < emerg`

**④ 看上一次启动周期的日志（排查崩溃）**

```bash
journalctl -u order-service -b       # 本次启动以来的日志
journalctl -u order-service -b -1    # 上一次启动的日志
```

**⑤ 输出格式控制**

```bash
journalctl -u order-service -o json-pretty    # JSON 格式（字段最全）
journalctl -u order-service -o short-iso      # 带 ISO 时间戳
journalctl -u order-service --no-pager        # 不用翻页器（方便管道处理）
```

### journalctl 配合管道

```bash
# 统计今天各级别日志的数量
journalctl -u order-service --since today --no-pager | awk '{print $5}' | sort | uniq -c | sort -rn

# 从 journal 中 grep 特定错误
journalctl -u order-service --since "1 hour ago" --no-pager | grep "mysql timeout"
```

`--no-pager` 很关键——不加它，journalctl 会调用 less 翻页器，管道就不工作了。

---

## 4.3 dmesg — 内核日志

`dmesg` 读取内核的环形缓冲区，记录的是**内核级别的事件**。

### OOM Killer（内存不足杀进程）

Go 服务莫名消失的头号嫌疑人：

```bash
dmesg -T | grep -i "oom"
```

典型输出：

```
[Thu Mar 15 10:00:18 2024] Out of memory: Killed process 12345 (order-service) total-vm:2048000kB, anon-rss:1536000kB
```

**更详细地看 OOM 上下文**：

```bash
dmesg -T | grep -B 5 -A 5 "oom"
```

`-T` 参数非常重要：dmesg 默认显示的是系统启动以来的秒数（如 `[163728.123]`），加 `-T` 后变成可读时间。

### 磁盘错误

```bash
dmesg -T | grep -iE "error|fail|i/o"
```

### 网络相关

```bash
dmesg -T | grep -iE "link|eth|network"
```

### dmesg 实用参数

```bash
dmesg                  # 查看所有内核日志
dmesg -T               # 带可读时间戳（必加）
dmesg -T -l err,warn   # 只看 err 和 warn 级别
dmesg --follow         # 实时追踪内核日志
```

---

## 4.4 实战：实时监控 Go 服务并捕获一次 panic

模拟场景：`order-service` 跑在 CentOS 上，用 systemd 管理。用户反馈"下单偶尔报错"。

**排查步骤**：

```bash
# 步骤一：开终端 1，实时追踪服务日志
journalctl -u order-service -f

# 步骤二：开终端 2，实时追踪内核日志（防止 OOM）
dmesg -T --follow

# 步骤三：开终端 3，让用户复现，或者自己 curl 触发
curl http://localhost:8080/api/order -d '{"item":"test"}'
```

终端 1 看到了：

```
Mar 15 10:05:21 server order-service[12345]: FATAL panic: runtime error: invalid memory address
Mar 15 10:05:21 server order-service[12345]: goroutine 42 [running]:
Mar 15 10:05:21 server order-service[12345]: main.handleOrder(0x0)
Mar 15 10:05:21 server order-service[12345]:     /app/handler/order.go:42
```

**如果服务已经崩溃重启了**：

```bash
journalctl -u order-service -b -1 --no-pager | tail -n 50
```

---

## 4.5 实用技巧汇总

### 快速判断服务状态

```bash
systemctl status order-service
```

一个命令告诉你：服务是否在运行、PID、最近几条日志。排查时第一步先敲这个。

### 看服务最近一次崩溃的原因

```bash
journalctl -u order-service -p err -b -1 --no-pager | tail -n 30
```

### 磁盘空间告警时看日志占了多少

```bash
du -sh /var/log/* | sort -rh | head -n 10
```

---

## 4.6 命令速查表

```
命令                                           用途
──────────────────────────────────────────────────────────────────
tail -f file                                  实时追踪文件
tail -F file                                  实时追踪（支持日志轮转）
tail -f file | grep --line-buffered "KEY"     实时过滤关键词

journalctl -u SERVICE                         查看服务日志
journalctl -u SERVICE -f                      实时追踪服务日志
journalctl -u SERVICE -n 50                   最近 50 条
journalctl -u SERVICE --since "30 min ago"    时间范围过滤
journalctl -u SERVICE -p err                  按级别过滤
journalctl -u SERVICE -b -1                   上次启动的日志
journalctl -u SERVICE --no-pager              不用翻页器（管道用）

dmesg -T                                      内核日志（可读时间）
dmesg -T | grep -i oom                        查 OOM Kill
dmesg --follow                                实时追踪内核日志

systemctl status SERVICE                       快速查看服务状态
du -sh /var/log/* | sort -rh | head            查看日志磁盘占用
```

---

## 章末思考题

**题目一：你用 `tail -f app.log | grep "ERROR"` 实时追踪错误日志，但发现过了好几秒才输出，明明日志文件里已经有新的 ERROR 了。这是什么原因？怎么解决？**

> **参考答案**：这是管道缓冲（pipe buffering）导致的。默认情况下，当 grep 的输出不是终端（而是管道或文件）时，它使用块缓冲（通常 4KB），会攒够一批数据才刷出来。解决方法是给 grep 加 `--line-buffered` 参数，改为行缓冲。完整命令：`tail -f app.log | grep --line-buffered "ERROR"`。多级管道中可以用 `stdbuf -oL` 强制任意命令行缓冲：`tail -f app.log | stdbuf -oL grep "ERROR" | awk '{print $2}'`。

**题目二：你的 Go 服务被 systemd 管理，某天凌晨 3 点服务挂了，systemd 自动拉起来了。早上到公司后你想看凌晨 3 点崩溃前后的日志，应该怎么查？给出至少两种方式。**

> **参考答案**：
> - **方式一**：按时间范围查——`journalctl -u order-service --since "03:00" --until "03:10" --no-pager`
> - **方式二**：看上一次启动周期——`journalctl -u order-service -b -1 --no-pager | tail -n 50`
> - **方式三**：先排除 OOM——`dmesg -T | grep -i oom`
>
> 实际排查中三种方式组合：先 dmesg 排除 OOM，再 journalctl 看崩溃日志细节。

**题目三：`journalctl` 的日志默认存在哪里？如果服务器重启后 journal 日志丢失了，最可能的原因是什么？怎么让它持久化？**

> **参考答案**：journald 的日志默认存在 `/run/log/journal/`，这是一个 tmpfs（内存文件系统），**重启就没了**。这是 CentOS 7 的默认配置。要持久化，需要创建 `/var/log/journal/` 目录：`sudo mkdir -p /var/log/journal && sudo systemd-tmpfiles --create --prefix /var/log/journal`，然后重启 journald：`sudo systemctl restart systemd-journald`。之后日志写到磁盘上，重启也不丢。这是 CentOS 服务器部署时应该做的基础配置。

---

> 准备好了就说「继续」进入下一章。
