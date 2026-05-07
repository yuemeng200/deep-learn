# 第2章：Go 读取 TOML —— struct 映射的核心机制

## 回扣本质

上一章我们认识了 TOML 格式的"对人类友好"，本章我们将看到它在 Go 中的核心价值——**struct 映射**。配置文件的字段直接对应 Go 结构体字段，解析器通过反射自动完成映射，既保留了可读性，又获得了编译期类型安全。

---

## 2.1 库的选择

Go 生态中主流 TOML 库：

| 库 | 特点 | 推荐场景 |
|---|---|---|
| `github.com/BurntSushi/toml` | 最早的 Go TOML 库，API 简洁，社区广泛 | 通用场景首选 |
| `github.com/pelletier/go-toml/v2` | 性能更好，支持 TOML v1.0 完整规范 | 性能敏感场景 |

本课程使用 **`BurntSushi/toml`**，原因：API 最直观，学习曲线平缓，社区文档丰富。

---

## 2.2 项目初始化

```bash
mkdir appconfig && cd appconfig
go mod init appconfig
go get github.com/BurntSushi/toml
```

项目结构：
```
appconfig/
├── config/
│   └── app.toml        (上一章已写好)
├── main.go
└── go.mod
```

---

## 2.3 核心概念：Struct Tag 映射

Go 的 TOML 解析基于**反射 + struct tag**，规则如下：

```go
type ServerConfig struct {
    Host         string `toml:"host"`
    Port         int    `toml:"port"`
    ReadTimeout  int    `toml:"read_timeout"`
    WriteTimeout int    `toml:"write_timeout"`
}
```

映射规则：
1. `toml:"xxx"` tag 指定 TOML 文件中的键名
2. 如果没有 tag，默认用字段名的**小写形式**匹配
3. 类型必须兼容：TOML 整数 → Go `int/int64`，TOML 字符串 → Go `string`，TOML 布尔 → Go `bool`

---

## 2.4 完整代码实现

```go
package main

import (
    "fmt"
    "os"

    "github.com/BurntSushi/toml"
)

// 顶层配置结构体
type AppConfig struct {
    Server   ServerConfig   `toml:"server"`
    Database DatabaseConfig `toml:"database"`
    Log      LogConfig      `toml:"log"`
    Features FeatureFlags   `toml:"features"`
}

type ServerConfig struct {
    Host         string `toml:"host"`
    Port         int    `toml:"port"`
    ReadTimeout  int    `toml:"read_timeout"`
    WriteTimeout int    `toml:"write_timeout"`
}

type DatabaseConfig struct {
    Host         string `toml:"host"`
    Port         int    `toml:"port"`
    User         string `toml:"user"`
    Password     string `toml:"password"`
    Name         string `toml:"name"`
    MaxOpenConns int    `toml:"max_open_conns"`
    MaxIdleConns int    `toml:"max_idle_conns"`
}

type LogConfig struct {
    Level  string `toml:"level"`
    Format string `toml:"format"`
    Output string `toml:"output"`
}

type FeatureFlags struct {
    EnableSignup    bool `toml:"enable_signup"`
    EnableOAuth     bool `toml:"enable_oauth"`
    MaintenanceMode bool `toml:"maintenance_mode"`
}

func main() {
    var cfg AppConfig

    // 读取并解析 TOML 文件
    _, err := toml.DecodeFile("config/app.toml", &cfg)
    if err != nil {
        fmt.Fprintf(os.Stderr, "读取配置失败: %v\n", err)
        os.Exit(1)
    }

    // 打印验证
    fmt.Printf("服务器: %s:%d\n", cfg.Server.Host, cfg.Server.Port)
    fmt.Printf("数据库: %s@%s:%d/%s\n", cfg.Database.User, cfg.Database.Host, cfg.Database.Port, cfg.Database.Name)
    fmt.Printf("日志级别: %s, 格式: %s\n", cfg.Log.Level, cfg.Log.Format)
    fmt.Printf("功能开关 - 注册: %v, OAuth: %v, 维护模式: %v\n",
        cfg.Features.EnableSignup, cfg.Features.EnableOAuth, cfg.Features.MaintenanceMode)
}
```

运行结果：
```
服务器: 0.0.0.0:8080
数据库: admin@localhost:5432/myapp_dev
日志级别: info, 格式: json
功能开关 - 注册: true, OAuth: false, 维护模式: false
```

---

## 2.5 理解底层：反射映射过程

`toml.DecodeFile` 内部做了什么？

```
TOML 文件 → 解析为内部 map[string]interface{} → 反射遍历目标 struct → 按 tag 名匹配 → 类型转换赋值
```

关键行为：
1. **未匹配的 TOML 键**：默认被忽略（不报错）
2. **struct 中有但 TOML 中没有的字段**：保持 Go 零值（`""`, `0`, `false`）
3. **类型不匹配**：返回错误（如 TOML 中是字符串，struct 中是 int）

如何检测"多余"的 TOML 键？用 `MetaData`：

```go
meta, err := toml.DecodeFile("config/app.toml", &cfg)
if err != nil {
    log.Fatal(err)
}

// 列出 TOML 中存在但 struct 中没有对应字段的键
undecoded := meta.Undecoded()
if len(undecoded) > 0 {
    fmt.Printf("警告: 以下配置项未被识别: %v\n", undecoded)
}
```

这在重构时极为有用——可以发现过时的配置项。

---

## 2.6 常见错误与排查

| 症状 | 原因 | 解决 |
|------|------|------|
| 字段始终是零值 | tag 名与 TOML 键不匹配 | 检查 `toml:"xxx"` 是否拼写正确 |
| 字段始终是零值 | struct 字段未导出（小写开头） | 改为大写开头 |
| 报 type mismatch 错误 | TOML 类型与 Go 类型不兼容 | 如 TOML 中 `port = "8080"` 但 Go 中是 `int` |
| 报文件错误 | 路径相对于程序运行目录 | 用绝对路径或确认 `go run` 的工作目录 |

---

## 章末思考题

**题1：** 如果 TOML 文件中有一个键 `max_retry_count = 3`，但你的 struct 中没有对应字段，程序会怎样？这是好事还是坏事？

**参考答案：**
程序不会报错，该键被静默忽略。这是一把双刃剑：好处是向后兼容（新版配置文件可以被旧版程序部分读取）；坏处是拼写错误不会被发现（比如你写了 `max_opne_conns` 而不是 `max_open_conns`，程序不报错但值是零值）。解决方案：使用 `meta.Undecoded()` 在启动时检测并告警。

---

**题2：** `toml.Decode(string, &cfg)` 和 `toml.DecodeFile(path, &cfg)` 有什么区别？什么时候用前者？

**参考答案：**
`Decode` 接收字符串（TOML 内容），`DecodeFile` 接收文件路径。用 `Decode` 的场景：
- 单元测试中直接写 TOML 字符串，不依赖外部文件
- 从环境变量或远程配置中心拿到 TOML 文本后解析
- 需要对内容做预处理（如变量替换）再解析

---

**题3：** 为什么 `toml.DecodeFile` 的第一个返回值是 `MetaData` 而不是直接忽略？设计者在鼓励什么行为？

**参考答案：**
设计者鼓励**防御性解析**——不仅关心"解析成功了吗"，还关心"有没有我不认识的键"和"哪些键被成功映射了"。在生产环境中，`Undecoded()` 可以帮助发现配置文件中的错误拼写或过时项，`Keys()` 可以用于配置审计。这体现了 Go 社区"显式处理所有信息"的文化。

---

> 准备好了就说「继续」进入下一章。
