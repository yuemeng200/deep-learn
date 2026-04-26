# 第3章：Rust 与 Wasm 的深度协作

上一章我们让 JS 和 Wasm 通过共享内存高效传递像素数据。但目前的协作方式还很原始——JS 手动管理每个滤镜的调用顺序，Rust 只是一个"被动执行函数"的工具。本章我们要让两者的协作升级：用 Rust 构建一条**图像处理管线**，让 JS 只需说"我要什么效果"，而不用操心"每个效果怎么串联"。

---

## 3.1 管线思维：从"搬砖"到"流水线"

回到上一章结尾的思考题——多个滤镜串行调用，每次都遍历全图，缓存命中率低。解决方案是**管线（Pipeline）**：

```
传统方式：
像素 → [灰度] → 写回 → 再读 → [亮度] → 写回 → 再读 → [对比度] → 写回
       遍历1次          遍历2次                遍历3次

管线方式：
像素 → [灰度 → 亮度 → 对比度] → 写回
       只遍历1次，每个像素经过全部变换后输出
```

这不仅是性能优化，更是一个架构转变：**把"一系列独立的函数调用"变成"一条有组织的处理管线"**。

---

## 3.2 wasm-bindgen 的高级桥接能力

在构建管线之前，我们需要掌握几个关键的工具链能力。

### 3.2.1 复杂数据结构传递

之前我们只传了 `&mut [u8]`（原始字节切片）和基本数字。但一个管线需要更丰富的数据结构——比如滤镜参数、管线配置。

```rust
use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};

/// 滤镜参数——用 Serde 自动序列化
#[derive(Serialize, Deserialize)]
pub struct FilterParams {
    pub brightness: i16,
    pub contrast: f32,
    pub saturation: f32,
    pub hue_rotate: f32, // 度
}

/// 管线配置
#[wasm_bindgen]
pub struct Pipeline {
    filters: Vec<FilterParams>,
    width: u32,
    height: u32,
    original: Vec<u8>,  // 保存原始帧数据
}

#[wasm_bindgen]
impl Pipeline {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        Pipeline {
            filters: Vec::new(),
            width,
            height,
            original: Vec::new(),
        }
    }

    /// 加载原始图像数据（从 JS 的 Uint8Array 传入）
    pub fn load_image(&mut self, data: &[u8]) {
        self.original = data.to_vec();
    }

    /// 添加一个滤镜到管线
    pub fn add_filter(&mut self, brightness: i16, contrast: f32, saturation: f32, hue_rotate: f32) {
        self.filters.push(FilterParams {
            brightness,
            contrast,
            saturation,
            hue_rotate,
        });
    }

    /// 清空管线
    pub fn clear(&mut self) {
        self.filters.clear();
    }
}
```

关键点：

- `#[wasm_bindgen]` 作用在 `struct` 上，会让这个类型在 JS 侧变成一个可实例化的对象
- `#[wasm_bindgen(constructor)]` 标记的函数对应 JS 的 `new Pipeline()`
- `impl` 块内的方法会变成 JS 对象上的方法
- `&[u8]` 参数自动映射为 JS 的 `Uint8Array`

### 3.2.2 从 Rust 回调 JS 函数

有时候 Wasm 需要调用浏览器 API——比如日志输出、请求动画帧等。`wasm-bindgen` 支持从 Rust 端调用 JS 函数：

```rust
use wasm_bindgen::prelude::*;

/// 声明一个外部的 JS 函数
#[wasm_bindgen]
extern "C" {
    /// 绑定到 console.log
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    /// 绑定到 console.time
    #[wasm_bindgen(js_namespace = console)]
    fn time(s: &str);

    /// 绑定到 console.timeEnd
    #[wasm_bindgen(js_namespace = console)]
    fn time_end(s: &str);
}

// 也可以用更方便的宏
macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}
```

使用：

```rust
fn process_pixel_chunk(data: &mut [u8], params: &FilterParams) {
    console_log!("处理 {} 个像素", data.len() / 4);
    // ...
}
```

### 3.2.3 接收 JS 的闭包

更强大的模式：JS 传一个回调函数给 Rust，Rust 在合适的时机调用它。这在管线设计中很有用——比如处理完成后的通知。

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Pipeline {
    // ... 其他字段
    on_complete: Option<js_sys::Function>,
}

#[wasm_bindgen]
impl Pipeline {
    /// 设置完成回调
    pub fn on_complete(&mut self, callback: js_sys::Function) {
        self.on_complete = Some(callback);
    }

    fn notify_complete(&self, duration_ms: f64) {
        if let Some(ref cb) = self.on_complete {
            let this = JsValue::NULL;
            let args = [JsValue::from(duration_ms)];
            let _ = cb.call1(&this, &JsValue::from(duration_ms));
        }
    }
}
```

JS 侧：

```javascript
const pipeline = new Pipeline(1920, 1080);
pipeline.onComplete((ms) => {
    console.log(`处理完成，耗时 ${ms.toFixed(1)}ms`);
});
```

---

## 3.3 实战：构建图像处理管线

现在把所有知识组合起来，构建一条完整的管线。

### 步骤一：完整的 Rust 管线实现

更新 `src/lib.rs`：

```rust
use wasm_bindgen::prelude::*;

// 外部 JS 函数声明
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    fn time(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    fn time_end(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

/// 单个滤镜的参数
struct FilterConfig {
    brightness: i16,
    contrast: f32,
    saturation: f32,
    grayscale: bool,
}

/// 图像处理管线
#[wasm_bindgen]
pub struct Pipeline {
    width: u32,
    height: u32,
    original: Vec<u8>,
    filters: Vec<FilterConfig>,
}

#[wasm_bindgen]
impl Pipeline {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> Self {
        Pipeline {
            width,
            height,
            original: Vec::new(),
            filters: Vec::new(),
        }
    }

    /// 加载原始图像
    pub fn load_image(&mut self, data: &[u8]) {
        self.original = data.to_vec();
        console_log!("加载图像：{}x{}，{} 字节", self.width, self.height, data.len());
    }

    /// 设置滤镜（替换模式——每次设置就是最终状态）
    pub fn set_filter(
        &mut self,
        brightness: i16,
        contrast: f32,
        saturation: f32,
        grayscale: bool,
    ) {
        // 用单个滤镜替代多个，简化模型
        self.filters.clear();
        self.filters.push(FilterConfig {
            brightness,
            contrast,
            saturation,
            grayscale,
        });
    }

    /// 执行管线，返回处理后的像素数据
    pub fn process(&self) -> Vec<u8> {
        time("pipeline_process");

        // 从原始数据复制一份
        let mut output = self.original.clone();

        for filter in &self.filters {
            self.apply_filter(&mut output, filter);
        }

        time_end("pipeline_process");
        output
    }

    /// 单次遍历，应用所有变换
    fn apply_filter(&self, data: &mut [u8], config: &FilterConfig) {
        for chunk in data.chunks_exact_mut(4) {
            let mut r = chunk[0] as f32;
            let mut g = chunk[1] as f32;
            let mut b = chunk[2] as f32;

            // 1. 灰度化（最先执行）
            if config.grayscale {
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = gray;
                g = gray;
                b = gray;
            }

            // 2. 亮度调整
            if config.brightness != 0 {
                r = (r + config.brightness as f32).clamp(0.0, 255.0);
                g = (g + config.brightness as f32).clamp(0.0, 255.0);
                b = (b + config.brightness as f32).clamp(0.0, 255.0);
            }

            // 3. 对比度调整
            if config.contrast != 1.0 {
                r = ((r - 128.0) * config.contrast + 128.0).clamp(0.0, 255.0);
                g = ((g - 128.0) * config.contrast + 128.0).clamp(0.0, 255.0);
                b = ((b - 128.0) * config.contrast + 128.0).clamp(0.0, 255.0);
            }

            // 4. 饱和度调整
            if config.saturation != 1.0 {
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = (gray + (r - gray) * config.saturation).clamp(0.0, 255.0);
                g = (gray + (g - gray) * config.saturation).clamp(0.0, 255.0);
                b = (gray + (b - gray) * config.saturation).clamp(0.0, 255.0);
            }

            chunk[0] = r as u8;
            chunk[1] = g as u8;
            chunk[2] = b as u8;
            // chunk[3] (Alpha) 不动
        }
    }

    /// 获取管线信息
    pub fn info(&self) -> String {
        format!(
            "Pipeline: {}x{}, {} bytes, {} filter(s)",
            self.width,
            self.height,
            self.original.len(),
            self.filters.len()
        )
    }
}
```

### 步骤二：更新 Cargo.toml

```toml
[package]
name = "video-editor-engine"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
js-sys = "0.3"

[dependencies.web-sys]
version = "0.3"
features = [
    "console",
]
```

### 步骤三：编译

```bash
wasm-pack build --target web
```

### 步骤四：前端页面——管线式图像编辑器

更新 `index.html`：

```html
<!DOCTYPE html>
<html lang="zh">
<head>
    <meta charset="UTF-8">
    <title>Wasm 图像处理管线</title>
    <style>
        body { font-family: sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
        canvas { border: 1px solid #ccc; max-width: 100%; }
        .controls { margin: 1rem 0; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
        .controls label { min-width: 60px; }
        .controls input[type="range"] { width: 180px; }
        .status { color: #666; font-size: 0.9em; margin-top: 0.5rem; }
        .pipeline-info { background: #f5f5f5; padding: 0.5rem 1rem; border-radius: 4px; font-family: monospace; }
    </style>
</head>
<body>
    <h1>Wasm 图像处理管线</h1>

    <div class="controls">
        <input type="file" id="fileInput" accept="image/*">
        <span id="status" class="status"></span>
    </div>

    <div class="controls">
        <label>亮度</label>
        <input type="range" id="brightness" min="-128" max="128" value="0">
        <span id="brightnessVal">0</span>
    </div>
    <div class="controls">
        <label>对比度</label>
        <input type="range" id="contrast" min="0" max="300" value="100">
        <span id="contrastVal">1.0</span>
    </div>
    <div class="controls">
        <label>饱和度</label>
        <input type="range" id="saturation" min="0" max="300" value="100">
        <span id="saturationVal">1.0</span>
    </div>
    <div class="controls">
        <button id="grayscaleBtn">灰度化</button>
        <button id="resetBtn">重置</button>
        <span id="pipelineInfo" class="pipeline-info"></span>
    </div>

    <canvas id="canvas"></canvas>

    <script type="module">
        import init, { Pipeline } from './pkg/video_editor_engine.js';

        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        let pipeline = null;
        let isGrayscale = false;

        async function main() {
            await init();
            setupUI();
            document.getElementById('status').textContent = 'Wasm 管线就绪，请加载图片';
        }

        function setupUI() {
            // 加载图片
            document.getElementById('fileInput').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const img = new Image();
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);

                    // 创建管线并加载图像
                    pipeline = new Pipeline(img.width, img.height);
                    const imageData = ctx.getImageData(0, 0, img.width, img.height);
                    pipeline.load_image(imageData.data);

                    document.getElementById('status').textContent =
                        `已加载 ${img.width}x${img.height}`;
                    updatePipelineInfo();
                };
                img.src = URL.createObjectURL(file);
            });

            // 滑块事件
            const throttle = (fn, ms) => {
                let last = 0;
                return (...args) => {
                    const now = Date.now();
                    if (now - last >= ms) { last = now; fn(...args); }
                };
            };

            const apply = throttle(() => {
                if (!pipeline) return;
                applyPipeline();
            }, 30); // 约 30fps 节流

            document.getElementById('brightness').addEventListener('input', (e) => {
                document.getElementById('brightnessVal').textContent = e.target.value;
                apply();
            });
            document.getElementById('contrast').addEventListener('input', (e) => {
                document.getElementById('contrastVal').textContent = (e.target.value / 100).toFixed(2);
                apply();
            });
            document.getElementById('saturation').addEventListener('input', (e) => {
                document.getElementById('saturationVal').textContent = (e.target.value / 100).toFixed(2);
                apply();
            });

            document.getElementById('grayscaleBtn').addEventListener('click', () => {
                isGrayscale = !isGrayscale;
                document.getElementById('grayscaleBtn').textContent =
                    isGrayscale ? '取消灰度' : '灰度化';
                if (pipeline) applyPipeline();
            });

            document.getElementById('resetBtn').addEventListener('click', () => {
                if (!pipeline) return;
                document.getElementById('brightness').value = 0;
                document.getElementById('contrast').value = 100;
                document.getElementById('saturation').value = 100;
                document.getElementById('brightnessVal').textContent = '0';
                document.getElementById('contrastVal').textContent = '1.00';
                document.getElementById('saturationVal').textContent = '1.00';
                isGrayscale = false;
                document.getElementById('grayscaleBtn').textContent = '灰度化';
                applyPipeline();
            });
        }

        function applyPipeline() {
            const brightness = parseInt(document.getElementById('brightness').value);
            const contrast = parseInt(document.getElementById('contrast').value) / 100;
            const saturation = parseInt(document.getElementById('saturation').value) / 100;

            // 一次设置，一次处理
            pipeline.set_filter(brightness, contrast, saturation, isGrayscale);

            const t0 = performance.now();
            const result = pipeline.process();
            const dt = performance.now() - t0;

            // 写回 Canvas
            const imageData = ctx.createImageData(
                canvas.width, canvas.height
            );
            imageData.data.set(result);
            ctx.putImageData(imageData, 0, 0);

            document.getElementById('status').textContent =
                `处理耗时 ${dt.toFixed(1)}ms`;
            updatePipelineInfo();
        }

        function updatePipelineInfo() {
            if (pipeline) {
                document.getElementById('pipelineInfo').textContent = pipeline.info();
            }
        }

        main();
    </script>
</body>
</html>
```

### 步骤五：运行

```bash
wasm-pack build --target web && python3 -m http.server 8080
```

加载一张图片，拖动滑块——注意控制台会输出 `pipeline_process` 的计时。你会看到单次遍历处理比之前串行调用快了不少。

---

## 3.4 关键解析：管线的架构优势

### 对比：之前 vs 现在

| 维度 | 第2章（独立函数） | 本章（管线） |
|------|-------------------|-------------|
| 数据流 | JS 每次复制原始数据 | Rust 内部保存原始数据 |
| 遍历次数 | 每个滤镜一次 | 所有滤镜合为一次 |
| JS 侧工作 | 管理调用顺序、复制数据 | 只设参数、点"执行" |
| 缓存友好性 | 差（多次全图遍历） | 好（单次遍历） |

### 管线的核心模式

```
JS 层（调度层）                    Wasm 层（计算层）
┌─────────────┐                  ┌──────────────────┐
│ 用户操作 UI  │                  │                  │
│ 滑块变化     │──set_filter()──→ │  FilterConfig    │
│             │                  │       ↓          │
│ 点击执行     │──process()────→ │  遍历像素 1 次    │
│             │                  │  灰度→亮度→对比度 │
│ 渲染结果     │←──Vec<u8>────── │       ↓          │
│             │                  │  返回处理结果     │
└─────────────┘                  └──────────────────┘
```

**职责清晰**：JS 负责"什么时候处理"和"处理完怎么展示"，Rust 负责"怎么处理"。这正是 Wasm 的设计哲学——协作而非替代。

---

## 3.5 `wasm_bindgen` 类型映射速查

本章涉及了多种跨边界类型传递，整理如下：

| Rust 类型 | JS 类型 | 备注 |
|-----------|---------|------|
| `u8, i32, f32, f64` | `Number` | 直接传递，零开销 |
| `&str` / `String` | `String` | `wasm-bindgen` 自动编码解码 |
| `&[u8]` | `Uint8Array` | 指向共享内存，零拷贝 |
| `&mut [u8]` | `Uint8Array` | 同上，可修改 |
| `Vec<u8>` | `Uint8Array` | **复制**——Rust 把数据拷贝到新内存 |
| `bool` | `Boolean` | 直接映射 |
| `#[wasm_bindgen] struct` | JS 类实例 | 通过指针引用，不复制 |
| `js_sys::Function` | 函数对象 | 可调用 `.call()` |
| `JsValue` | 任意 JS 值 | 兜底类型，最灵活但最不安全 |

重点记住：**`&[u8]` 是零拷贝共享，`Vec<u8>` 是复制传递**。处理像素时优先用前者。

---

## 章末思考题

**题目一**：当前管线的 `process()` 方法返回 `Vec<u8>`，这意味着每次处理都会复制一整帧数据回 JS。有没有办法避免这次复制，让 JS 直接读取处理结果？

**参考答案**：

有。可以让管线在内部维护一个输出缓冲区，然后暴露一个方法返回该缓冲区的引用（`&[u8]`）：

```rust
#[wasm_bindgen]
pub struct Pipeline {
    output: Vec<u8>,
    // ...
}

#[wasm_bindgen]
impl Pipeline {
    /// 返回处理结果的引用（零拷贝）
    pub fn output(&self) -> &[u8] {
        &self.output
    }
}
```

JS 侧拿到的是指向 Wasm 线性内存的 `Uint8Array`，直接从中读取即可。但要注意：如果在 JS 读取之前又调用了 `process()`，输出缓冲区会被覆盖。对于视频编辑器，这通常不是问题——处理和渲染是同步的。

---

**题目二**：管线的 `set_filter()` 方法目前只支持一个滤镜。如果要支持多个滤镜链式叠加（比如先加一个"暖色"滤镜，再加一个"暗角"滤镜），数据结构该怎么设计？每个滤镜是顺序叠加（上一个的输出是下一个的输入），还是像现在一样合并为单次遍历？

**参考答案**：

两种策略各有适用场景：

**合并策略**（当前方式）：适合"调色类"滤镜——亮度、对比度、饱和度这些操作在数学上可以合并为简单的线性变换。单次遍历，性能最优。

**链式策略**：适合"空间类"滤镜——模糊、锐化、暗角等操作需要读取周围像素，不同滤镜之间有依赖关系，无法合并。

实际的视频编辑器（如 Premiere、DaVinci）通常采用混合策略：
- 调色类滤镜合并为一次遍历
- 空间类滤镜各自独立执行
- 中间结果通过帧缓冲区传递

```
原始帧 → [调色管线：亮度+对比度+饱和度] → [模糊] → [暗角] → 最终输出
          单次遍历                          各自遍历
```

---

**题目三**：在 `apply_filter` 中，我们用 `chunk[0] as f32` 把 `u8` 转为浮点数做计算，再转回 `u8`。每次转换都有开销。能不能全程用整数运算替代浮点运算？性能会差多少？

**参考答案**：

可以用**定点数运算**（fixed-point arithmetic）替代浮点运算。核心思路是把浮点系数乘以 256，存为整数：

```rust
// 定点数：Q8 格式（8 位小数）
const BRIGHTNESS_SCALE: i32 = 256; // 1.0 的定点表示
// 灰度权重
const R_WEIGHT: i32 = 77;   // 0.299 × 256 ≈ 77
const G_WEIGHT: i32 = 150;  // 0.587 × 256 ≈ 150
const B_WEIGHT: i32 = 29;   // 0.114 × 256 ≈ 29

fn grayscale_fixed(chunk: &mut [u8]) {
    let gray = (chunk[0] as i32 * R_WEIGHT
              + chunk[1] as i32 * G_WEIGHT
              + chunk[2] as i32 * B_WEIGHT) >> 8;
    chunk[0] = gray as u8;
    chunk[1] = gray as u8;
    chunk[2] = gray as u8;
}
```

性能差异取决于平台。在 x86 桌面 CPU 上，浮点运算单元很强，定点优势不明显（可能快 10-20%）。但在 ARM 移动设备或嵌入式环境上，定点可以快 2-3 倍。不过现代 Wasm 引擎（V8、SpiderMonkey）对浮点运算的优化已经很好，通常不需要手动做定点化——**先 profile，再优化**。
