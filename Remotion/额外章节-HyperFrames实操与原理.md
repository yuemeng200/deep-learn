# 额外章节：HyperFrames 实操与原理

> **回扣本质**：前几章把 HyperFrames 当作 Remotion 的对照面来理解——它选了 HTML/GSAP、为 Agent 优化「输入端」、用 seek 适配确定性。但这些都是「侧写」。这一章**正面拆开它**：到底怎么用？渲染管线长什么样？那个神秘的 `seekable adapter` 如何把 GSAP 变成确定性的？看完，就有亲手对比、甚至混合使用两个框架的实操基础。
>
> 依据：HyperFrames 官方 README（31.3k star，Apache 2.0，2026.6 仍活跃迭代至 v0.7.8）。

---

## B.1 心智模型：视频 = 一个 HTML 文件 + `data-*` 时间线

| | **Remotion** | **HyperFrames** |
|---|---|---|
| 创作单元 | React 组件 | **一个 HTML 文件** |
| 时间如何表达 | 组件树（`<Sequence>`） | **HTML 的 `data-*` 属性** |
| 构建步骤 | 需要（webpack bundle） | **无**（`index.html` 直接能播） |

你写一个 `index.html`，它既是结构也是时间编排：
```html
<div id="stage" data-composition-id="launch" data-width="1920" data-height="1080">
  <video  class="clip" data-start="0" data-duration="6" data-track-index="0" src="intro.mp4" muted></video>
  <h1     class="clip" data-start="1" data-duration="4" data-track-index="1">Launch day</h1>
  <audio  data-start="0" data-duration="6" data-track-index="2" data-volume="0.5" src="music.wav"></audio>
</div>
```
- `data-composition-id` / `data-width` / `data-height` —— 容器（对应 Remotion `<Composition>`）。
- `class="clip"` + `data-start` + `data-duration` + `data-track-index` —— 片段的**起止时间和轨道**（对应 `<Sequence>`），`data-track-index` 就是视频编辑器的「轨道」。

> **关键洞察**：HyperFrames 把「时间线」**编码进 HTML 的 data 属性**——没发明新 DSL，而是用 HTML 原生属性表达时间。与 Remotion「用组件树表达时间」异曲同工，但宿主不同：**Remotion 借 React 工程化，HyperFrames 借 HTML 普适性**——这正是它 Agent 友好的根。而且**无构建步骤**是杀手特性：`index.html` 浏览器直接打开就能播。

---

## B.2 动画的核心机制：seekable + adapter 适配层（本章之魂）

问题：**HTML/CSS/GSAP 全是 wall-clock 实时动画，怎么让它们「逐帧 seek」做确定性渲染？**

HyperFrames 的解法是 **adapter（运行时适配器）层**——每个动画库（GSAP / Lottie / Three.js / Anime.js / CSS / WAAPI）都有一个 adapter，把该库的动画「接管」成可 seek 的。GSAP 标准写法：

```js
const tl = gsap.timeline({ paused: true });          // ① paused：切断自动播放
tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
window.__timelines = window.__timelines || {};
window.__timelines.launch = tl;                       // ② 注册：移交控制权
```
渲染时框架对每帧：
```
t = frame / fps
window.__timelines.launch.seek(t)    // ③ adapter：seek 到该时刻
截图
```

**三个动作共同把「实时墙钟动画」改造成「确定性逐帧动画」**：

| 动作 | 作用 |
|---|---|
| `paused: true` | **切断墙钟驱动**——时间线不自己 play。掐断「实时性」的第一刀 |
| 注册到 `window.__timelines` | **移交控制权**——框架 adapter 现在能操作它 |
| 渲染时 `tl.seek(t)` | **按帧精确驱动**——框架而非墙钟决定时间线在哪个时刻 |

> 这就是「**seekable animation**」的精确实现。这也解释了它为何支持一堆库：**只要能写 adapter 把播放头接管成 seekable，就能用**——adapter 是它的扩展性所在。

---

## B.3 渲染管线：与 Remotion 几乎同构

官方一句话：*"The renderer seeks each frame in headless Chrome and encodes the result with FFmpeg, so the same input produces the same video."*

```
                  Remotion                          HyperFrames
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ① Bundle (webpack)           │      │ ① 解析 HTML composition       │
│ ② 启动无头 Chrome             │      │ ② 启动无头 Chrome (Puppeteer) │
│ ③ 设 frame=N, 等 delayRender │      │ ③ seek 时间线到 t=frame/fps   │  ◄─ 唯一差异
│ ④ 截图 (captureScreenshot)   │ ◄同构► ④ 截图                        │
│ ⑤ FFmpeg 编码                 │      │ ⑤ FFmpeg 编码                 │
└──────────────────────────────┘      └──────────────────────────────┘
```

**关键认知：渲染管线后半段（Chrome 截图 + FFmpeg 编码）两者完全一样！** 唯一区别在**「如何驱动每一帧」**：Remotion 是 `frame` 纯函数求值，HyperFrames 是 `seek` 时间线到 `t`。

> **印证结论**：两个框架的根本分野**不在渲染管线**，而在「动画模型 + 创作语言」。管线同构恰恰说明，选型看的不是「谁能渲染」，而是「谁更适合被你的生产方式（人写/Agent 写/数据驱动）驱动」。

包结构：`@hyperframes/core`（解析+runtime+adapters）、`@hyperframes/engine`（Puppeteer+FFmpeg 捕获）、`@hyperframes/producer`（完整管线）、`@hyperframes/aws-lambda`（分布式渲染，对应 Remotion Lambda）。

---

## B.4 两条上手路径：CLI vs Agent Skills

**路径 ①：CLI（人类开发者，极简）**
```bash
npx hyperframes init my-video      # 脚手架
cd my-video
npx hyperframes preview            # 浏览器实时预览 + live reload
npx hyperframes render             # 渲染 MP4
```
要求：Node.js 22+、FFmpeg。**全程无构建步骤**。

**路径 ②：Agent Skills（AI Agent，杀手锏）**
```bash
npx skills add heygen-com/hyperframes   # 安装 19 个 skills
```
自然语言驱动：*Using `/hyperframes`, create a 10-second product intro with a fade-in title, a background video, and subtle background music.*

skills 体系：
- **`/hyperframes`** —— router（先读），把「做个视频」请求路由到对应工作流。
- **创建工作流 skills**：`/product-launch-video`、`/website-to-video`、`/faceless-explainer`、`/pr-to-video`、`/motion-graphics`、`/music-to-video`、`/embedded-captions`、`/talking-head-recut`……甚至 **`/remotion-to-hyperframes`**（端口迁移）。
- **领域 skills**：`/hyperframes-core`、`/hyperframes-animation`（含 runtime adapters）、`/hyperframes-media`（TTS/音乐/字幕）、`/hyperframes-cli` 等。
- 支持 Claude Code、Cursor、Gemini CLI、Codex。

> **关键洞察**：HyperFrames 的「Agent 友好」**不是「LLM 能写它的代码」这么浅**——而是它**把视频生产的领域最佳实践，编码成 19 个 agent skills**。Agent 复用这些「专家技能包」而非从零生成。这是比 Remotion 高一层的抽象：Remotion 给 API，HyperFrames 给「视频生产方法论」。这是它一周爆 9.6k star 的真正原因。

---

## B.5 Catalog 与 frame.md：生态与设计系统

- **Catalog**（可复用 blocks/components）：transitions、overlays、captions、charts、maps、effects
  ```bash
  npx hyperframes add data-chart            # 动画图表 block
  npx hyperframes add flash-through-white   # shader 转场
  ```
- **frame.md**（独特卖点）：把 web design system「为镜头反向翻译」——同一套设计规范重写成 agent 能用来**拍视频**的 `DESIGN.md`。解决「设计系统为屏幕写、非为镜头写」的断层。

---

## B.6 回到选型：有了实操图景，选型更具体

| 你的生产方式 | 推荐 | 具体动作 |
|---|---|---|
| 人/团队手写、要工程化、数据驱动批量 | Remotion | React 组件 + props + `calculateMetadata` + Lambda |
| 让 Agent 生成、要快速产出单条 | HyperFrames | `npx skills add` + 自然语言 + `/hyperframes` router |
| 混合 | 两者 | Remotion 做数据驱动批量核心；HyperFrames + skills 做 Agent 模板生成层 |

> 你之前问「HyperFrames 为什么不用 Remotion 方案」——从实操层看到了答案的另一面：**它不是不能，而是它整个价值主张（HTML 原生、无构建、19 个 agent skills、frame.md）都建立在「HTML 范式」上。** 用 Remotion 方案 = 推翻它的全部价值 = 那就直接用 Remotion。

---

## 本章产出

✅ 掌握 HyperFrames 创作模型（HTML + `data-*` 时间线，无构建）  
✅ **看懂 `seekable adapter` 机制**（`paused` + 注册 + `seek` 三步把实时动画变确定性）  
✅ 看清渲染管线与 Remotion 同构、差异只在「每帧如何被驱动」  
✅ 两条上手路径（CLI / Agent Skills）+ 它「Agent 友好」的真正含义（19 个领域 skills）  
✅ 实操级选型动作表

---

## 章末思考题

**题 1（理解层）**：对比 Remotion 的 `<Sequence from={30} durationInFrames={60}>` 和 HyperFrames 的 `<div class="clip" data-start="1" data-duration="4" data-track-index="1">`。它们各自如何表达「时间编排」？这种差异如何体现两个框架的设计哲学？

> **参考答案**：
> - **Remotion**：用 React 组件 + props 表达时间，时间被**组件化、有作用域**（Sequence 内 `useCurrentFrame` 局部化）。
> - **HyperFrames**：用 HTML `data-*` 属性表达时间，时间线**编码进 HTML 元素属性**，像视频编辑器「轨道」。
> - **哲学差异**：两者都「没发明新 DSL」，但借用宿主不同——Remotion 把时间提升为 **React 组件一等公民**（时间=组件树，借 React 工程化）；HyperFrames 把时间编码为 **HTML 标注**（时间=data 属性，借 HTML 普适性 + Agent 生成能力）。

**题 2（机制层，核心）**：HyperFrames 让 GSAP timeline 必须 `paused: true` 并注册到 `window.__timelines`。请解释这三个动作（含渲染时 seek）各自作用，以及如何共同把「实时墙钟动画」变成「确定性逐帧渲染」。

> **参考答案**：
> - **`paused: true`**：阻止时间线被墙钟自动驱动，不自己 play。**切断「实时性」的第一刀**。
> - **注册到 `window.__timelines`**：把控制权**移交给框架 adapter**——框架现在能操作它。
> - **渲染时 `tl.seek(t)`**（`t=frame/fps`）：框架**按帧精确驱动**——让时间线跳到该时刻算状态再截图。
> - **三者共同作用**：切断自动播放 → 移交控制权 → 框架按帧定位。这样 GSAP「墙钟状态机」被改造成「可逐帧定位」的确定性动画源——这就是 **seekable** 的精确实现，也是 adapter 能扩展到 Lottie/Three.js/WAAPI 的统一模式。

**题 3（对比/选型层，承接全课）**：渲染管线层面，HyperFrames 和 Remotion 都用「无头 Chrome + FFmpeg」。既然管线几乎一样，为什么做「千万级批量数据驱动视频」仍应选 Remotion，而做「Agent 生成单条视频」选 HyperFrames？请从「**每帧如何被驱动**」和「**并行化能力**」两个底层差异回答。

> **参考答案**：
> - 管线后半段两者同构，差异只在**「每帧如何被驱动」**：
>   - Remotion：frame 纯函数，每帧**完全独立、无状态**。并行 1000 帧 = 1000 次独立求值，**天然无竞态**。
>   - HyperFrames：seek **有状态时间线**，每帧 seek 改变状态。并行时要么每帧 fork 独立实例（开销大），要么共享需状态隔离（易竞态）。
> - 所以：**千万级批量**（看重并行/确定性/成本）→ Remotion 纯函数模型天然占优；**Agent 生成单条**（看重生成门槛/HTML 普适/快速产出）→ HyperFrames 占优，单条规模下 seek 的并行劣势**不致命**。
> - 印证「**渲染管线同构，但动画模型决定并行能力**」——选型看**规模与并发需求**，而非渲染管线本身。这是做核心产品最该盯的底层变量。
