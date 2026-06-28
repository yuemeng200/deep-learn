# 渐进式学习课程：Remotion 框架

> 课程模式：**混合型**（实战项目骨架 + 问题链 + 内部机制深挖）
> 学员定位：**技术成熟的领域新手**（React/TS 进阶，Remotion/视频新手；目标为「做核心产品」所需的深度理解）
> 课程长度：**4 章**（高密度整合版）

---

## 核心本质

视频历史上一直是一种**「时间线上的手工制品」**——在 Premiere、AE 这类 GUI 工具里手工堆叠图层、打关键帧。这种形态让视频天生**不可编程、不可数据驱动、不可版本化、不可复现、无法规模化自动化**。这就是 Remotion 要解决的根本问题。

Remotion 的核心重构是一句话：**「视频是时间的纯函数。」** 正如 React 把 UI 渲染成 `state/props` 的函数，Remotion 把每一帧渲染成 `frame`（帧号）的函数。给定相同的帧 + 相同的数据 → 相同的像素。

支撑这个重构的三大设计哲学：

1. **统一心智模型**：`useCurrentFrame()` 是唯一输入。整个视频就是一个纯函数。
2. **复用整个 Web 平台**：浏览器（React / CSS / SVG / Canvas / WebGL / 字体 / DOM）**就是**视频创作工具。浏览器能渲染的一切都能被捕获成帧。
3. **让视频像软件**：因为它是代码，所以可版本化、可数据驱动、可复现、可测试、可 CI、可自动化。

> **一条贯穿一切的暗线：确定性优先（determinism first）。**
> Remotion 几乎所有「反直觉」的设计选择——逐帧截图而非实时录制、为什么需要 FFmpeg、为什么 WebCodecs 是未来、为什么 `<Player>` 与渲染是两套机制——都源于「确定性优先」这一个原则。理解了这一点，所有看似零散的问题（FFmpeg 是不是必须？直接录制会不会更好？）就都有了统一的答案。

> 一句话的「魂」：**把视频从「时间线上的手工制品」变成「时间的纯函数 + Web 技术栈」，让视频像软件一样可工程化。** 后续每一章都会回扣这个本质。

---

## 课程主线

### 实战项目

**「数据驱动的短视频生成器」**——一个接收结构化数据（一条新闻 / 一个产品 / 一条内容）并产出精良短视频的系统。它会随课程逐章扩展：

> 单个静态画面 → 带动画的媒体丰富画面 → 渲染成视频文件 → 参数化生成器 + 服务端批量自动化 → 配以竞品选型判断。

### 问题链骨架（4 层收束）

- **源头**：视频到底是什么，才让它这么难以被编程？Remotion 如何用「帧的纯函数」重构它？
- → 这些「帧的纯函数」如何变成一个真正的视频文件？渲染管线内部、已知问题、以及替代范式（实时录制 / WebCodecs）的权衡是什么？
- → 如何让它从「一个视频」变成「数据驱动的视频生成器」，并规模化、自动化地生产？
- **收束**：面对 Remotion（React 派）与 HyperFrames（HTML/GSAP 派）等选项，在什么场景下该选什么？

---

## 课程大纲

### 第1章：视频即时间的函数——心智模型、前世今生与版图
源头问题开场：为什么视频难以编程？Remotion 的诞生（Jonny Burger）与设计动机。核心心智模型：`<Composition>` + `useCurrentFrame()` + 帧驱动的重渲染，以及「确定性优先」这条暗线。开篇即给**版图**：时间线工具（AE/Premiere）/ 编程式（Remotion、HyperFrames）/ ML 生成——并埋下伏笔：编程式内部已分化为 React 派与 HTML 派。横向对比：AE 表达式 / FFmpeg 脚本 / Canvas+MediaRecorder，为什么「时间的函数」是更优抽象。
**产出**：第一个可运行 Composition + 完整的认知版图。

### 第2章：用 React 拆解时间——组合、动画与「Web 即画布」
React 的组合模型如何映射到视频结构：`<Sequence>` / `<Series>` / `<AbsoluteFill>` / 图层与时间轴。动画原语：`interpolate()` / `spring()` / 缓动——深挖为什么 Remotion 把动画做成**帧的纯函数**，对比 GSAP / Framer Motion 的事件/时间驱动模型（这一对比正是 Remotion 与 HyperFrames 的根本分野）。Web 即画布：`<Img>` / `<Video>` / `<Audio>` / `<OffthreadVideo>`、字体的坑与解法、SVG/Canvas/WebGL 取舍。深挖 `delayRender()` / `continueRender()` —— 确定性的关键机制：如何等待异步资源就绪。
**产出**：一个媒体完整、视觉丰富、带动画的项目画面。

### 第3章：从帧到文件——渲染管线内部、已知问题与替代范式
直接回答你的两个问题。完整渲染管线：无头 Chromium 逐帧截图 → 管道给 **FFmpeg 编码**（**是的，当前用 FFmpeg**）。为什么用 Chrome 当渲染器；为什么是**逐帧步进而非实时**（确定性、不掉帧、音画同步的根源）；并行化（并发 / 帧切分 / 多机）。`<Player>`（Web 实时回放）vs 渲染（离线确定性）的心智模型。**Remotion 当前局限**：截图+FFmpeg 管线的性能/质量边界、浏览器内不能渲染最终输出。**替代范式三方对比**：MediaRecorder（实时录制，快但非确定、帧率不稳）vs WebCodecs（逐帧原生编码，确定+硬件加速——**Remotion 的未来方向，正在用 `@remotion/webcodecs` 替换 FFmpeg**）vs 截图+FFmpeg（当前）。核心权衡：**确定性 vs 速度 vs 成熟度**。
**产出**：渲染出第一个视频文件 + 看透整条管线 + 理解三种范式何时该跳出 Remotion。

### 第4章：从视频到生成器——数据驱动、自动化与「Remotion vs HyperFrames」选型
通向你「做核心产品」的目标。数据驱动：`defaultProps` / `calculateMetadata()` / 动态时长 / CLI & JSON 输入 props / `<Still>`，深挖 `calculateMetadata` 为何是数据与渲染的桥梁。服务端规模化：`@remotion/renderer` 编程式 API / `@remotion/lambda` 云端渲染 / `@remotion/bundler`，架构、队列、伸缩、成本模型、冷启动，以及 props 作为用户输入的安全考量。**核心对比：Remotion vs HyperFrames**——维度：技术栈（React vs HTML+GSAP）、动画模型（帧纯函数 vs 时间线）、构建复杂度、数据驱动与组件化能力、生态成熟度、AI Agent 友好度、确定性；**分场景结论**（批量数据驱动 / 复杂组件 / 已有 React 团队 → Remotion；单条高质量快速产出 / Agent 主导 / 无 React 依赖 → HyperFrames）。商业模式与许可证（Remotion 免费框架+付费渲染 vs HyperFrames Apache 2.0）与边界选型判断框架。
**产出**：参数化生成器 + 服务端渲染架构 + 一套清晰的「什么场景用什么」选型判断力。
