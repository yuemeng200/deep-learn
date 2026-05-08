# 第1章：认识 TOML —— 为什么不用 JSON/YAML

## 回扣本质

配置与代码分离是所有工程化项目的基本诉求。本章我们先认识 TOML 这个格式本身——它为什么诞生，以及它在"对人类友好"这件事上做了哪些具体设计决策。理解了格式层面的设计哲学，后续才能写出清晰、可维护的配置文件。

---

## 1.1 TOML 是什么

TOML（Tom's Obvious, Minimal Language）由 GitHub 联合创始人 Tom Preston-Werner 设计，2013 年发布，目标明确：**做一个语义明确、对人类可读的配置文件格式**。

一句话定位：**TOML = 有注释的 JSON + 不靠缩进的 YAML**。

---

## 1.2 三种格式横向对比

同一份配置，用三种格式分别表达：

### JSON
```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8080,
    "debug": true
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "myapp"
  }
}
```
痛点：不支持注释、尾逗号报错、嵌套深时大量花括号。

### YAML
```yaml
server:
  host: "0.0.0.0"
  port: 8080
  debug: true

database:
  host: localhost
  port: 5432
  name: myapp
```
痛点：缩进敏感（2空格还是4空格？Tab还是空格？）、隐式类型转换（`no` 变成 `false`、`3.0` 变成浮点）。

### TOML
```toml
# 服务器配置
[server]
host = "0.0.0.0"
port = 8080
debug = true

# 数据库配置
[database]
host = "localhost"
port = 5432
name = "myapp"
```
优势：
- **支持注释**（`#`）—— 配置文件几乎必备
- **语法明确** —— 字符串必须带引号，布尔/数字不带引号，不存在隐式转换
- **结构清晰** —— `[section]` 显式声明层级，不靠缩进

---

## 1.3 TOML 核心语法速览

### 键值对
```toml
title = "My App"        # 字符串
port = 8080             # 整数
rate = 3.14             # 浮点
enabled = true          # 布尔
```

### 表（Table）= 一个嵌套对象
```toml
[owner]
name = "Tom"
age = 35
```
等价于 JSON 的 `{"owner": {"name": "Tom", "age": 35}}`

### 数组
```toml
ports = [8080, 8081, 8082]
hosts = ["web1", "web2"]
```

### 表格数组（Array of Tables）—— 最独特的语法
```toml
[[products]]
name = "Hammer"
price = 9.99

[[products]]
name = "Nail"
price = 0.05
```
等价于 JSON 的 `{"products": [{"name":"Hammer","price":9.99}, {"name":"Nail","price":0.05}]}`

### 日期时间（原生支持）
```toml
created_at = 2024-01-15T09:30:00Z
date_only = 2024-01-15
```

---

## 1.4 实战产出：为 AppConfig 写第一个配置文件

创建项目结构：

```
appconfig/
├── config/
│   └── app.toml
└── main.go        (下一章完成)
```

`config/app.toml` 内容：

```toml
# AppConfig - 服务配置文件

[server]
host = "0.0.0.0"
port = 8080
read_timeout = 5    # 秒
write_timeout = 10  # 秒

[database]
host = "localhost"
port = 5432
user = "admin"
password = "secret"
name = "myapp_dev"
max_open_conns = 25
max_idle_conns = 5

[log]
level = "info"       # debug | info | warn | error
format = "json"      # json | text
output = "stdout"    # stdout | file

[features]
enable_signup = true
enable_oauth = false
maintenance_mode = false
```

这份文件已经覆盖了：基本类型（字符串、整数、布尔）、注释、多个表。后续章节会逐步扩展。

---

## 章末思考题

**题1：** YAML 中 `version: 3.0` 和 `version: "3.0"` 的值是什么类型？TOML 中同样的写法呢？这说明了什么设计差异？

**参考答案：**
YAML 中 `version: 3.0` 是浮点数 3.0，`version: "3.0"` 才是字符串。这种隐式类型推断经常导致意外 bug（Docker Compose 版本号就是经典案例）。TOML 中 `version = 3.0` 是浮点数，`version = "3.0"` 是字符串——规则一样，但 TOML 的设计哲学是：**格式本身的语法规则更少、更明确**，不存在 YAML 那种 `yes/no/on/off` 自动转布尔的魔法。设计差异的本质：TOML 选择"显式优于隐式"。

---

**题2：** 如果一个配置项是"多个数据库实例"，每个实例有 host/port/name，用 TOML 应该怎么表达？用 JSON 呢？

**参考答案：**
TOML 使用表格数组：
```toml
[[databases]]
host = "db1.example.com"
port = 5432
name = "primary"

[[databases]]
host = "db2.example.com"
port = 5432
name = "replica"
```
JSON：
```json
{"databases": [{"host":"db1.example.com","port":5432,"name":"primary"}, ...]}
```
TOML 的 `[[]]` 语法在视觉上把每个实例分隔开，可读性明显优于 JSON 的数组嵌套——这是第3章的重点内容。

---

**题3：** 什么场景下你**不会**选 TOML？

**参考答案：**
- 需要复杂的数据交换格式（如 API 响应） → 用 JSON，因为所有语言都有原生解析
- 配置极其简单只有几个键 → `.env` 文件足够
- 需要 YAML 的锚点/引用（`&` / `*`）来避免重复 → TOML 不支持引用机制
- 团队/生态已经深度绑定 YAML（如 K8s） → 没必要逆流

TOML 的最佳场景是：**应用程序自身的配置文件**，特别是需要人类频繁手动编辑的场景。

---

> 准备好了就说「继续」进入下一章。
