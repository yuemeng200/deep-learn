# 第3章：文本处理三剑客 — awk, sed 与统计分析

> 上一章的 grep 解决了"找到关键行"的问题。但现实中，找到还不够——你还需要**从中提取特定字段、清洗格式、做统计汇总**。这正是"用正确的工具处理数据"的进阶体现：grep 是渔网捞鱼，awk/sed/sort 则是把鱼分类、清理、计数。

---

## 3.1 理解"列"的概念——awk 的心智模型

在讲具体命令之前，先建立一个关键认知：**日志的每一行，其实是一张"表格"的一行**。

拿我们的日志举例：

```
2024-03-15 10:00:18 ERROR [order-service] POST /api/order uid=1004 err="connect mysql timeout" status=500
```

如果用空格分隔，每一段就是一"列"：

```
$1          $2       $3    $4               $5   $6         $7       $8                    $9
2024-03-15  10:00:18 ERROR [order-service]  POST /api/order uid=1004 err="connect          mysql
```

`awk` 的核心思想就是：**按列操作文本**。grep 是按行筛选，awk 是按列提取。

---

## 3.2 awk — 按列提取

### 基础语法

```bash
awk '{print $N}' file    # 打印第 N 列（从 $1 开始，$0 是整行）
```

### 入门示例

```bash
# 只看时间和日志级别
awk '{print $1, $2, $3}' /tmp/order-service.log
```

输出：

```
2024-03-15 10:00:01 INFO
2024-03-15 10:00:15 INFO
2024-03-15 10:00:17 WARN
2024-03-15 10:00:18 ERROR
...
```

一下子把噪音都去掉了，只留你关心的字段。

### 条件筛选——awk 的 grep 能力

awk 不仅能提取列，还能加条件：

```bash
# 只看 ERROR 行的时间和请求路径
awk '$3=="ERROR" {print $1, $2, $6}' /tmp/order-service.log
```

输出：

```
2024-03-15 10:00:18 /api/order
2024-03-15 10:00:18 /api/payment
2024-03-15 10:00:20 /api/order
```

语法解读：`$3=="ERROR"` 是条件（第3列等于 ERROR），`{print ...}` 是动作。**条件 + 动作**是 awk 的基本范式。

### 自定义分隔符

默认 awk 按空格/Tab 分列。但有时日志用别的分隔符：

```bash
# 假设日志是 JSON 格式，用 : 分隔提取
awk -F: '{print $1}' file

# 用 = 分隔，提取 key=value 中的 value
echo "uid=1004" | awk -F= '{print $2}'    # 输出 1004
```

### 实战：提取所有请求的延迟值

我们的日志中延迟格式是 `latency=23ms`，想把数字提取出来：

```bash
grep "latency" /tmp/order-service.log | awk -F'latency=' '{print $2}' | awk '{print $1}'
```

输出：

```
23ms
45ms
1205ms
12ms
```

思路：先用 grep 筛选有 latency 的行，再用 `latency=` 作为分隔符取后半段，再取第一个字段（去掉后面的内容）。

---

## 3.3 sed — 流式替换与清洗

`sed`（Stream Editor）的核心能力是**查找替换**，类似编辑器里的"查找并替换"，但在命令行里批量完成。

### 基础语法

```bash
sed 's/旧内容/新内容/' file       # 替换每行第一个匹配
sed 's/旧内容/新内容/g' file      # 替换每行所有匹配（g = global）
```

### 日志清洗场景

**场景一：去掉日志中的服务名标签，让输出更干净**

```bash
sed 's/\[order-service\] //' /tmp/order-service.log
```

替换前：`2024-03-15 10:00:18 ERROR [order-service] POST /api/order ...`
替换后：`2024-03-15 10:00:18 ERROR POST /api/order ...`

**场景二：把 latency 的 ms 去掉，只留数字（方便后续排序）**

```bash
grep "latency" /tmp/order-service.log | sed 's/ms / /'
```

**场景三：脱敏——把 uid 替换为 `***`**

```bash
sed 's/uid=[0-9]*/uid=***/g' /tmp/order-service.log
```

这里 `[0-9]*` 是正则表达式，匹配一串数字。

### 只输出特定行

```bash
sed -n '5,10p' /tmp/order-service.log    # 只输出第 5 到第 10 行
```

`-n` 表示"安静模式"（不自动输出每行），`p` 表示"打印"。这比 `head`/`tail` 的组合更灵活——想看文件中间的某几行时特别好用。

### sed 实用小结

```
sed 's/old/new/'  file     # 替换（每行第一个）
sed 's/old/new/g' file     # 替换（全部）
sed -n 'Np'       file     # 只打印第 N 行
sed -n 'M,Np'     file     # 打印第 M 到 N 行
sed '/pattern/d'  file     # 删除匹配行（输出中去掉）
```

---

## 3.4 统计三件套 — sort, uniq, wc

日志排查不只是"找到那条日志"，很多时候你需要**统计**：哪个错误最多？哪个接口最慢？哪个时间段出问题最集中？

这三个命令经常组合使用：

### wc — 数数

```bash
wc -l /tmp/order-service.log      # 统计总行数（-l = lines）
grep "ERROR" app.log | wc -l      # 统计 ERROR 有多少行
```

`wc -l` 比 `grep -c` 更通用——它能统计任何输入的行数，不限于 grep 的输出。

### sort — 排序

```bash
sort file                  # 按字典序排序
sort -n file               # 按数字排序（-n = numeric）
sort -r file               # 倒序（-r = reverse）
sort -k 3 file             # 按第 3 列排序（-k = key）
sort -t'=' -k2 -n file     # 指定分隔符为 = ，按第 2 列数字排序
```

### uniq — 去重和计数

**重要前提：uniq 只能去除相邻的重复行，所以必须先 sort。**

```bash
sort file | uniq            # 去重
sort file | uniq -c         # 去重并统计每个出现次数（-c = count）
sort file | uniq -d         # 只显示有重复的行
```

### 经典组合：统计排行榜

这是日志分析中最常用的模式，**一定要记住**：

```bash
... | sort | uniq -c | sort -rn
```

翻译成人话：**先排序 → 去重计数 → 再按数字倒序排**——得到一个从多到少的排行榜。

---

## 3.5 实战：统计各接口的错误次数排行

任务：从 order-service 的日志中，统计每个 API 接口各出现了多少次 ERROR，按频次从高到低排列。

```bash
grep "ERROR" /tmp/order-service.log | awk '{print $6}' | sort | uniq -c | sort -rn
```

逐步拆解：

```bash
# 第一步：grep 筛选出所有 ERROR 行
grep "ERROR" /tmp/order-service.log

# 第二步：awk 提取第 6 列（请求路径）
# ... | awk '{print $6}'
# 输出：
# /api/order
# /api/payment
# /api/order

# 第三步：sort 排序（让相同的路径相邻）
# ... | sort
# 输出：
# /api/order
# /api/order
# /api/payment

# 第四步：uniq -c 去重并计数
# ... | uniq -c
# 输出：
#       2 /api/order
#       1 /api/payment

# 第五步：sort -rn 按数字倒序
# ... | sort -rn
# 输出：
#       2 /api/order
#       1 /api/payment
```

结论一目了然：`/api/order` 的错误最多，优先排查。

---

## 3.6 更多实战组合

**统计每小时的错误数量分布**：

```bash
grep "ERROR" app.log | awk '{print substr($2,1,2)}' | sort | uniq -c
```

`substr($2,1,2)` 从时间字段 `10:00:18` 中截取前 2 个字符（小时数 `10`），得到按小时的错误分布。

**统计各错误类型的出现次数**：

```bash
grep "ERROR" app.log | grep -oP 'err="[^"]*"' | sort | uniq -c | sort -rn
```

`grep -oP 'err="[^"]*"'` 是只输出匹配部分（`-o`），用 Perl 正则（`-P`）提取 `err="..."` 的内容。

**找出延迟超过 1 秒的请求**：

```bash
grep -E "latency=[0-9]{4,}ms" app.log
```

这匹配 `latency=` 后跟至少 4 位数字的行，即 1000ms 以上。简单粗暴但有效。

---

## 3.7 命令速查表

```
命令                                  用途
──────────────────────────────────────────────────────
awk '{print $N}' file                提取第 N 列
awk '$3=="X" {print $1}' file        条件筛选后提取
awk -F'分隔符' '{print $N}' file      自定义分隔符提取
sed 's/old/new/g' file               全局替换
sed -n 'M,Np' file                   提取第 M 到 N 行
sed '/pattern/d' file                删除匹配行
wc -l file                           统计行数
sort file                            排序
sort -rn file                        按数字倒序
sort -k N file                       按第 N 列排序
uniq -c                              去重计数（需先 sort）
... | sort | uniq -c | sort -rn      经典排行榜模式
```

---

## 章末思考题

**题目一：`sort | uniq -c` 中为什么一定要先 sort？如果不 sort 直接 uniq 会发生什么？**

> **参考答案**：`uniq` 只比较**相邻行**是否相同。如果不先排序，相同的内容散落在不同位置就不会被合并。比如输入是 `A B A`，不排序时 uniq 认为三行都不重复（第一个 A 和第三个 A 不相邻）；排序后变成 `A A B`，uniq 就能正确合并出 `2 A, 1 B`。这是一个非常经典的坑。

**题目二：你拿到一个 Go 服务的日志，日志格式是 JSON：`{"time":"2024-03-15T10:00:18","level":"ERROR","msg":"timeout","path":"/api/order"}`。要用 awk 提取 path 字段的值，你会怎么做？这种场景下 awk 还是最好的工具吗？**

> **参考答案**：用 awk 硬解析 JSON 是痛苦的——你需要 `awk -F'"' '{print $N}'` 按引号分列，但列号取决于字段顺序，脆弱且难以维护。更好的选择是用 `jq`，一个专门处理 JSON 的命令行工具：`cat app.log | jq -r '.path'`，直接按字段名提取，不受格式变化影响。这也引出一个重要认知：**awk/sed 擅长处理"空格/Tab 分隔的文本"，遇到 JSON、CSV 等结构化格式，该用专门工具**（jq、csvkit 等）。不是所有钉子都要用锤子。

**题目三：请写出一条命令链，从日志中找出"过去一小时内，被调用次数最多的前 5 个 API 接口"。假设日志格式与我们的 order-service 一致。**

> **参考答案**：
> ```bash
> grep "2024-03-15 10:" app.log | awk '{print $6}' | sort | uniq -c | sort -rn | head -n 5
> ```
> 拆解：① `grep "2024-03-15 10:"` 筛选 10 点这一小时的日志；② `awk '{print $6}'` 提取接口路径列；③ `sort | uniq -c` 去重计数；④ `sort -rn` 按次数倒序；⑤ `head -n 5` 取前 5 名。这条命令链用到了本章学的所有核心工具，也预演了第6章"管道组合"的思路。实际环境中时间筛选可能需要更精确（比如用 awk 比较时间戳），但这个简单的 grep 在大多数情况下已经够用。

---

> 准备好了就说「继续」进入下一章。
