# 第2章：用 React 拆解时间——组合、动画与「Web 即画布」

> **回扣本质**：上一章我们立起了「视频 = frame 的纯函数」。但真实的视频不会是「整屏一个函数」——它由无数片段在时间上编排而成。本章回答一个对资深 React 工程师来说格外顺手的问题：**如何用你已经会的 React 组合模型，去拆解和编排「时间」？** 而「动画如何建模」这个看似细节的选择，恰恰是 **Remotion 与 HyperFrames 的根本分野**——第4章对决的根就在这里。

---

## 2.1 时间结构：组件树从「空间」变成了「空间 + 时间」

> 在普通前端，**组件树 = 空间结构**（嵌套布局）。  
> 在 Remotion，**同一套组件树，同时编码了时间结构**。

Remotion 没有发明新的「时间编排语言」，它**复用了你组合 DOM 的那套直觉**去组合时间。三个核心积木：

**① `<AbsoluteFill>` —— 图层（Layer）**
默认 `position: absolute; inset: 0`，铺满父容器。**多个 AbsoluteFill 叠加 = 视频的图层堆叠**，靠 DOM 顺序 / zIndex 决定层叠——直接对应 AE 里的「层」。

**② `<Sequence>` —— 时间片段 + 时间作用域**
```tsx
<Sequence from={30} durationInFrames={60}>
  <Subtitle />
</Sequence>
```
关键洞察：**`<Sequence>` 内部组件调用的 `useCurrentFrame()` 返回的是 `0`，不是 `30`。** Sequence 把时间**局部化**了——就像 React 把 props/state 局部化到作用域。这让每个片段都能自洽地写「我从 frame 0 淡入」，**与全局位置解耦**。把 Sequence 从 `from={30}` 挪到 `from={60}`，内部动画一行都不用改。
> 这就是「用 React 拆解时间」的字面含义：**时间被组件化、被作用域化了。**

**③ `<Series>` —— 顺序拼接**
```tsx
<Series>
  <Series.Sequence duration={60}><Intro /></Series.Sequence>
  <Series.Sequence duration={90}><Main /></Series.Sequence>
  <Series.Sequence duration={30}><Outro /></Series.Sequence>
</Series>
```
> 心智模型：**把整个视频想象成一棵「时间树」**——根是整段视频，Sequence 是子时间段，子组件是叶子。这棵树和 DOM 树用同一套 React 心智去读、写、重构。

---

## 2.2 动画原语：`interpolate` 与 `spring`（帧的纯函数）

两个原语，本质都是 **`f(frame) → 值`**：

**`interpolate` —— 线性映射 + 缓动**
```tsx
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: 'clamp',     // 超出左端：钳制
  extrapolateRight: 'clamp',    // 超出右端：钳制
  easing: Easing.bezier(0.2, 0.8, 0.2, 1),
});
```

**`spring` —— 物理弹簧**
```tsx
const { fps } = useVideoConfig();
const y = spring({ frame, fps, from: 60, to: 0, config: { damping: 12 } });
```
注意 `spring` 需要 `fps`——物理模拟要把「帧数」换算成「秒」。**但输出仍是 frame 的纯函数**：给定 `frame + fps + config`，永远算出同一个值。

---

## 2.3 根本分野：帧纯函数 vs 时间线（Remotion vs GSAP/HyperFrames）

| 维度 | Remotion（`interpolate`/`spring`） | GSAP / Framer Motion（时间线驱动） |
|---|---|---|
| **动画模型** | `frame` 的纯函数，**无状态** | 基于 `requestAnimationFrame` + **墙钟时间**推进，**有状态** |
| **当前位置** | `f(frame)`，一步算出 | `(now − startTime)` 的函数，依赖启动时机 |
| **随机访问** | O(1)，任意 frame 直接代入 | 需要让时间线 seek/快进到该时刻 |
| **确定性** | 天然确定 | 需额外保证（本质是时间线状态机） |
| **并行渲染** | 每帧独立，天然可多核/多机并行 | 时间线本质顺序，并行化困难 |

**为什么 Remotion 必须自己重写 `spring`，不能直接用 GSAP？**

渲染视频时，渲染器要**逐帧「跳帧」截图**，甚至把不同帧丢给不同 CPU 并行。`f(frame)` 的纯函数模型让「任意 frame 独立渲染」成立：渲染第 1000 帧 = 代入 `frame=1000`，一步到位。而 GSAP 是「启动后按墙钟时间播放」的模型，当前位置含**状态**和**启动时机**；要渲染第 1000 帧得起一条时间线、seek 过去、等状态收敛——既慢，又在并行/多帧场景下产生竞态、破坏确定性。

> **一句话：帧纯函数模型让「跳帧并行渲染」成立，这是 Remotion 整个渲染策略（第3章）的前提。** HyperFrames 用 GSAP，要解决「GSAP 时间线 + 确定性逐帧」的矛盾——它如何取舍，是第4章选型的核心看点。

> ⚠️ 实操推论：**在 Remotion 里不要直接用 Framer Motion / GSAP 做动画**（它们基于墙钟时间，会破坏确定性），要用 Remotion 自己的 `interpolate` / `spring`——为确定性重写的版本。

---

## 2.4 Web 即画布：媒体、字体与确定性陷阱

**媒体组件：**
- `<Img>` —— 图片（用 `staticFile()` 引用 `public/` 下的本地资源，或远程 URL）。
- `<Audio>` —— 音频。
- `<Video>` vs **`<OffthreadVideo>`** —— 一个**为确定性而设计**的经典案例：
  - 普通 `<Video>` 是 HTML 原生 `<video>`，靠墙钟时间**实时播放**，截某帧时音画/进度可能不同步——**不确定**。
  - `<OffthreadVideo>` 是 Remotion 特制版：在**独立线程解码**，按帧精确提取对应画面。**它存在的全部理由，是把「会漂移的实时视频」驯服成「按帧确定的素材」。**

**字体的坑（视频里最常见的「随机渲染错误」源）：**
字体加载是异步的。渲染第 0 帧时字体可能没下完，浏览器用 fallback 顶上——**截图就错了**，且「时有时无」极难排查。解法：用 `@remotion/google-fonts` 或显式 `loadFont()`，它们内部会**等待字体真正就绪**（靠下一节的 `delayRender`）。

---

## 2.5 确定性的关键机制：`delayRender` / `continueRender`

渲染器是「逐帧截图」的，它怎么知道该**等**异步资源（图片、字体、fetch、动态 import）？答案是把「组件内部的异步就绪状态」提升成一个**渲染器可观测的协议**：

```tsx
const MyComp = () => {
  const [data, setData] = useState(null);
  const [handle] = useState(() => delayRender('Loading API data')); // ① 别急着截图
  useEffect(() => {
    fetch('/api/data').then((d) => { setData(d); continueRender(handle); }); // ② 我好了
  }, [handle]);
  if (!data) return null;
  return <div>{data.text}</div>;
};
```

**机制推理**：
- `delayRender()` 通过 Remotion 运行时在页面里维护一个「未完成计数器」，并把状态**暴露给渲染器**（渲染器与页面在同一浏览器进程，通过 JS 通道/CDP 读取）。
- 渲染器截某帧前检查：**所有 handle 都 `continueRender` 了吗？** 没有，就**等**。都好了，才截图。
- 这是 **React 渲染模型 ↔ 截图渲染模型** 之间的桥，类似 `Suspense`，但服务的是「截图时机」。

**如果没有它**：任何异步资源都会让某帧截到「未就绪」画面，确定性崩溃。`<Img>`/`<Audio>`/字体包内部都已自动用 `delayRender`，日常不用手动管——**但当你自己 fetch、动态 import、异步绘制 Canvas 时，必须手动用**，否则渲染卡住或超时（`delayRender` 有默认超时约数秒）。

> **统一视角**：从 `<OffthreadVideo>`、字体等待、到 `delayRender`——Remotion 在「异步、实时、不确定」的 Web 世界里，处处在做**同一件事：把不确定驯服成确定**，只为守住「确定性优先」这个地基。

---

## 2.6 动手：升级成媒体丰富的项目画面

```tsx
import {
  AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring,
  useVideoConfig, Img, Audio, staticFile,
} from 'remotion';

const Title = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
    <h1 style={{ opacity, color: 'white', fontSize: 100 }}>数据驱动视频</h1>
  </AbsoluteFill>;
};

const Subtitle = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = spring({ frame, fps, from: 80, to: 0, config: { damping: 12 } });
  return <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', top: 120 }}>
    <h2 style={{ transform: `translateY(${y}px)`, color: '#9ad', fontSize: 48 }}>由 Remotion 生成</h2>
  </AbsoluteFill>;
};

export const Scene = () => (
  <AbsoluteFill>
    <Img src={staticFile('bg.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    <Audio src={staticFile('bgm.mp3')} />
    <Sequence from={0}  durationInFrames={60}><Title /></Sequence>
    <Sequence from={20} durationInFrames={90}><Subtitle /></Sequence>
  </AbsoluteFill>
);
```

读这棵「时间树」：背景图 + 音乐铺底，`Title` 第 0 帧淡入、`Subtitle` 第 20 帧才从下方弹出（它内部 `useCurrentFrame()` 从 0 开始，所以 `spring` 从 `from=80` 启动）。Studio 里拖时间轴即可见——所见即最终渲染。

---

## 本章产出

✅ 掌握用 React 组合模型编排**时间**（`AbsoluteFill`/`Sequence`/`Series`）  
✅ 掌握动画原语 `interpolate`/`spring`，并**理解帧纯函数 vs 时间线的根本分野**（第4章对决之根）  
✅ 理解 `delayRender`/`continueRender` 如何把异步世界接入确定性  
✅ 一个媒体丰富、带动画的项目画面

---

## 章末思考题

**题 1（理解层）**：`<Sequence from={30}>` 内部的组件调用 `useCurrentFrame()`，返回的是 `0` 还是 `30`？Remotion 为什么这样设计？如果你确实需要「全局帧」，该怎么做？

> **参考答案**：返回 **`0`**。Sequence 把时间**局部化**了，内部 frame 相对于 Sequence 起点——就像 React 把 props/state 局部化到作用域。好处是每个片段能自洽地写「我从 frame 0 淡入」，**与全局位置解耦**：把 Sequence 从 `from={30}` 挪到 `from={60}`，内部动画一行都不用改。这正是「用 React 拆解时间」的精髓——时间有了作用域。若确实需要全局帧，常见做法是在 Sequence **外层**取帧，通过 props 传进去（绕开局部化）。

**题 2（分野层，核心）**：GSAP 和 Remotion 的 `spring` 都能做弹簧动画，但底层模型根本不同。请说明：为什么 Remotion 必须自己重写 `spring` 而不能直接用 GSAP？这两种模型在渲染一个 **60 秒视频（1800 帧）** 时，行为差异体现在哪？

> **参考答案**：
> - **模型差异**：GSAP 基于 `requestAnimationFrame` + 墙钟时间推进，**有状态**——当前位置是 `(now − startTime)` 的函数。Remotion 的 `spring` 是 `frame` 的**纯函数**：给定 `frame+fps+config` 直接算出值，无状态、可 O(1) 随机访问。
> - **为什么不能用 GSAP**：渲染视频时渲染器要「跳帧」截图。纯函数模型让「渲染第 1000 帧」=「代入 frame=1000」一步完成；GSAP 得起时间线、seek 到第 1000 帧、等状态收敛——既慢，又在并行/多帧场景下产生竞态、破坏确定性。
> - **1800 帧的行为差异**：Remotion 可把帧**拆给多核/多机并行**，每帧独立计算；GSAP 时间线本质是**顺序播放**，并行化困难。**帧纯函数模型是 Remotion 逐帧并行渲染的前提**——这是第3章渲染管线的根基，也是 HyperFrames（用 GSAP）要额外解决、且可能有取舍的地方。

**题 3（机制层）**：`delayRender()` 是在 React 组件**渲染期间**被调用的，但它的作用是「让外部渲染器等待」。请推理：**渲染器（一个外部控制端）是如何「感知到」组件内部调用了 `delayRender` 的？** 如果某个 `delayRender` 的 `continueRender` 永远不被调用，会发生什么？

> **参考答案**：
> - **感知机制**：`delayRender()` 不只是组件内部记账，它通过 Remotion 运行时在页面里维护「未完成计数器」，并把状态**暴露为渲染器可观测的信号**（渲染器与页面在同一浏览器进程，通过 JS 通道/CDP 读取，内部维护一个全局就绪标志）。渲染器截某帧前检查该标志：所有 handle 都 `continueRender` 了才截图。**本质：把「组件内部的异步就绪」提升成「跨边界的渲染协议」**，是 React 渲染模型与截图模型之间的桥。
> - **若永不 continueRender**：渲染器会无限等待，最终触发**超时**（默认数秒，可配置）。超时后 Remotion 报错/警告并强制继续——避免卡死。这是最常见 bug 源：忘了 `continueRender` 导致渲染卡顿或超时报错。**这也解释了为什么 `<Img>`/字体包要内置 `delayRender` 自动管理**——替你规避手动出错。
