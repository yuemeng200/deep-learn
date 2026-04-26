# 第1章：浏览器为什么需要 WebAssembly

上一章我们在大纲中明确了 Wasm 的核心使命——**让浏览器拥有接近原生的计算能力**。本章我们就来搞清楚：这个能力缺口到底有多大？Wasm 又是怎么补上它的？最后，我们会亲手写出第一个 Wasm 模块，点燃视频编辑器项目的第一行代码。

---

## 1.1 问题：JavaScript 的性能天花板

假设你正在开发视频编辑器。一段 1080p、30fps 的视频，每秒产生 30 帧，每帧 1920×1080 = 2,073,600 个像素，每个像素 4 字节（RGBA），总计：

```
30 帧/秒 × 2,073,600 像素 × 4 字节 ≈ 248 MB/秒
```

每秒要处理近 **2.5 亿字节** 的数据——而且这只是读取，还没算上对每个像素的计算（调色、叠加、转场……）。

JavaScript 能不能扛住？理论上能跑，实际上会很吃力。原因是：

- **动态类型**：引擎在运行时才知道变量类型，无法提前优化内存布局
- **JIT 编译的局限**：热点代码会被加速，但遇到分支密集、类型不稳定的循环，优化会被打断（"去优化"）
- **GC 压力**：大量临时对象（像素数组、中间结果）触发频繁垃圾回收，造成卡顿

结果就是：在视频处理这类**大规模、高密度的数值计算**场景下，JS 的性能通常只有原生 C/Rust 的 **1/5 到 1/20**。这个差距，用户肉眼就能看到——掉帧、卡顿、操作延迟。

> 这不是 JS 的错。它被设计用来处理 DOM 交互和事件调度，在这个领域它是王者。但在"搬砖"——逐字节处理海量数据这件事上，它天生不是最优工具。

---

## 1.2 WebAssembly：精准补丁

WebAssembly（Wasm）不是一个新语言，而是一个**编译目标**。你可以用 Rust、C、C++、Go 等语言编写代码，然后编译成 `.wasm` 二进制文件，让浏览器直接执行。

一个直观的心智模型：

```
┌─────────────────────────────────────────┐
│                浏览器                     │
│                                          │
│   JavaScript 引擎        Wasm 虚拟机     │
│   ┌──────────┐          ┌──────────┐     │
│   │ UI 调度   │◄────────►│ 密集计算  │     │
│   │ 事件处理  │  函数调用 │ 像素处理  │     │
│   │ DOM 操作  │  共享内存 │ 编解码   │     │
│   └──────────┘          └──────────┘     │
└─────────────────────────────────────────┘
```

**JavaScript 是指挥官，Wasm 是执行者。** JS 决定"做什么"（用户点了哪个滤镜、时间轴怎么排列），Wasm 负责"怎么做"（把 200 万个像素逐个变换）。

Wasm 快的根本原因：

| 特性 | JS | Wasm |
|------|----|----|
| 类型 | 运行时推断 | 编译时确定 |
| 编译 | JIT（运行时） | AOT（构建时） |
| 内存 | GC 管理 | 手动/线性内存 |
| 执行 | 去优化可能回退 | 稳定的接近原生速度 |

---

## 1.3 开发语言选择：为什么是 Rust

Wasm 支持多种源语言，但本课程选择 **Rust**，原因很简单：

1. **零成本抽象**：Rust 的所有权系统不需要 GC，生成的 Wasm 体积小、性能稳定
2. **工具链成熟**：`wasm-bindgen` + `wasm-pack` 是目前最好的 Wasm 开发工具链
3. **内存安全**：没有悬垂指针和数据竞争，这在处理像素这种裸内存操作时极其重要
4. **社区共识**：WebAssembly 领域 Rust 是事实上的主流选择，生态最丰富

> 不必担心 Rust 的学习曲线——本课程只涉及 Rust 的一个子集，足够完成视频编辑器即可。不会要求你成为 Rust 专家。

---

## 1.4 实战：搭建环境，写出第一个 Wasm 模块

### 步骤一：安装工具链

```bash
# 安装 Rust（如果还没装的话）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 安装 wasm-pack（Rust → Wasm 的构建工具）
cargo install wasm-pack
```

### 步骤二：创建 Wasm 引擎项目

```bash
# 在你喜欢的目录下创建项目
cargo new --lib video-editor-engine
cd video-editor-engine
```

### 步骤三：配置项目

编辑 `Cargo.toml`：

```toml
[package]
name = "video-editor-engine"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
```

- `cdylib`：告诉编译器生成 C 兼容的动态库，这是 Wasm 需要的格式
- `wasm-bindgen`：Rust 与 JS 之间的桥梁，让两者能互相调用

### 步骤四：写第一个 Wasm 函数

编辑 `src/lib.rs`：

```rust
use wasm_bindgen::prelude::*;

// 这个属性让函数可以被 JS 调用
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("你好，{}！Wasm 视频编辑引擎已就绪。", name)
}

// 一个真正和视频处理相关的函数
// 计算一帧 RGBA 数据的总字节数
#[wasm_bindgen]
pub fn frame_byte_count(width: u32, height: u32) -> u32 {
    width * height * 4  // 每像素 4 字节 (R, G, B, A)
}
```

### 步骤五：编译为 Wasm

```bash
wasm-pack build --target web
```

这会在 `pkg/` 目录下生成：
- `video_editor_engine_bg.wasm`——编译后的二进制文件
- `video_editor_engine.js`——JS 胶水代码（自动生成）
- `video_editor_engine.d.ts`——TypeScript 类型定义

### 步骤六：创建前端页面来调用

在项目根目录创建 `index.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>Wasm 视频编辑器</title>
</head>
<body>
    <h1>WebAssembly 视频编辑引擎</h1>
    <p id="output">加载中...</p>

    <script type="module">
        // 导入 wasm-pack 生成的胶水代码
        import init, { greet, frame_byte_count } from './pkg/video_editor_engine.js';

        async function run() {
            // 初始化 Wasm 模块（下载 + 编译）
            await init();

            // 调用 Rust 函数
            const msg = greet("开发者");
            const bytes = frame_byte_count(1920, 1080);

            document.getElementById('output').innerHTML = `
                <strong>${msg}</strong><br>
                一帧 1080p 画面 = ${bytes.toLocaleString()} 字节
                                 = ${(bytes / 1024 / 1024).toFixed(2)} MB
            `;
        }

        run();
    </script>
</body>
</html>
```

### 步骤七：运行

```bash
# 需要一个本地服务器（浏览器不允许 file:// 加载 Wasm）
# 如果没装 python，也可以用 npx serve .
python3 -m http.server 8080
```

然后打开 `http://localhost:8080`，你应该能看到：

```
你好，开发者！Wasm 视频编辑引擎已就绪。
一帧 1080p 画面 = 8,294,400 字节 = 7.91 MB
```

恭喜——你刚刚完成了 **JavaScript 调用 Rust 编译的 Wasm 模块** 的完整链路。

---

## 1.5 刚才发生了什么？复盘调用链

```
Rust 源码 (lib.rs)
    ↓  wasm-pack build
Wasm 二进制 (.wasm) + JS 胶水代码 (.js)
    ↓  浏览器加载
JS 调用 greet() → 胶水代码转换参数 → Wasm 执行 → 返回结果 → 胶水代码转换回 JS 字符串
```

注意一个关键细节：`greet()` 传了一个字符串（`&str`），返回了一个字符串（`String`）。这背后 `wasm-bindgen` 帮你做了大量的编解码工作——因为 Wasm 本身只认识数字和线性内存中的字节，不认识 JS 的字符串对象。**这正是工具链的价值所在。**

而 `frame_byte_count()` 只接收和返回数字，不需要任何转换，这就是 Wasm 最高效的使用方式——后面处理像素时，我们会大量使用这种模式。

---

## 章末思考题

**题目一**：视频编辑器中，哪些操作适合放在 Wasm 中执行，哪些应该留在 JS 中？请举出至少 3 个 Wasm 适合的场景和 2 个 JS 更适合的场景，并说明原因。

**参考答案**：

**Wasm 适合**：
- 像素级滤镜（灰度、调色）——大规模、规则化的数值计算
- 视频编码/解码——密集循环、位操作
- 图像缩放/旋转——数学密集、内存访问模式固定

**JS 更适合**：
- DOM 操作和 UI 状态管理——Wasm 无法直接访问 DOM
- 事件处理和用户交互编排——需要灵活的回调和异步模式
- 网络请求和文件读取——Web API 已经提供了高效的异步接口

判断原则：**计算密集、数据密集、逻辑简单且稳定**的放 Wasm；**I/O 密集、需要浏览器 API、逻辑复杂多变**的留 JS。

---

**题目二**：`frame_byte_count(1920, 1080)` 返回约 8.3 MB。如果我们的目标是实时处理（30fps），且假设每个像素需要执行约 10 次运算（一次简单的颜色变换），那每秒 Wasm 需要完成多少次运算？这个量级对现代 CPU 来说压力大吗？

**参考答案**：

```
每秒运算量 = 1920 × 1080 × 30帧 × 4通道(RGBA) × 10次运算
           ≈ 24,883,200,000
           ≈ 250 亿次/秒（约 25 GFLOPS）
```

现代桌面 CPU 的单核浮点性能大约在 50-100 GFLOPS。所以简单滤镜没问题，但更复杂的操作（编码、多图层合成）会把单核吃满。这就是为什么后续章节会引入 SIMD（并行处理）和 Web Workers（多核）——**性能优化的本质就是榨干硬件能力**。

---

**题目三**：`wasm-bindgen` 帮我们处理了字符串的跨边界传递，这非常方便。但想一想：如果我们在处理 200 万个像素时也用这种方式传递数据（比如 Rust 返回一个 `Vec<u8>` 给 JS），可能会遇到什么问题？

**参考答案**：

**性能问题**。`wasm-bindgen` 处理复杂数据类型时，需要在 JS 堆和 Wasm 线性内存之间**复制数据**。一个 8 MB 的帧数据，每帧复制两次（传入 + 传出），30fps 就是 480 MB/秒的无意义拷贝。

这就是为什么下一章我们要学习 **Wasm 线性内存模型**——不是把数据"搬来搬去"，而是让 JS 和 Wasm **共享同一块内存**，直接在上面读写。这是高性能 Wasm 应用的核心技巧。
