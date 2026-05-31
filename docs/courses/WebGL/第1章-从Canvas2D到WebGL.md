---
title: 第 1 章：从 Canvas 2D 到 WebGL——你已经站在门口了
---

# 第 1 章：从 Canvas 2D 到 WebGL——你已经站在门口了

## 回扣本质

你已经用过 Canvas 2D、Fabric.js、PixiJS——这些工具让 CPU 帮你"画图"。WebGL 做的事情本质上一样：往 canvas 上输出像素。区别在于，它把这件事交给了 GPU 来做。本章的任务就是建立这个认知跨越：同一块 canvas，换一种 context，世界就不一样了。

---

## 一、你已经在用的那套模型

你用 Canvas 2D 时，代码大概是这样的：

```js
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'red';
ctx.fillRect(0, 0, 100, 100);
```

这里有几个关键点：
- `getContext('2d')` 返回一个**绘图上下文**
- 你通过调用 `ctx.fillRect()` 这样的**命令**告诉浏览器画什么
- 浏览器收到命令后，让 **CPU** 逐像素计算，填充颜色

PixiJS 在底层也做了同样的事（只不过它默认走 WebGL，这是后话）。

**WebGL 的入口完全一样**：

```js
const canvas = document.getElementById('myCanvas');
const gl = canvas.getContext('webgl');
```

就这一行差异。同一个 `<canvas>` 元素，换一个 context 类型，你就进入了 GPU 的世界。

---

## 二、CPU 渲染 vs GPU 渲染——为什么要绕这么一圈

| | CPU（Canvas 2D） | GPU（WebGL） |
|---|---|---|
| 核心数 | 8~32 个强核心 | 几千个弱核心 |
| 擅长 | 串行逻辑、分支判断 | 大量相同运算并行 |
| 画 100 万个像素 | 挨个算，慢 | 同时算，快 |

一张 1920×1080 的画面有 **207 万个像素**。如果每帧都要更新，CPU 需要串行处理每一个；GPU 可以同时处理几十万个。这就是 3D 实时渲染必须用 GPU 的原因。

PixiJS 之所以比 Canvas 2D 流畅，正是因为它在底层偷偷用了 WebGL，把渲染任务甩给了 GPU。

---

## 三、WebGL 是一台"状态机"

Canvas 2D 的 API 很直觉：`drawImage()`、`fillRect()`，说什么做什么。

WebGL 的 API 风格完全不同——它是一台**状态机**。你不是"发命令"，而是**配置状态**，然后触发绘制。

类比：你不是在跟一个听话的助手说"帮我在这里画个红色矩形"，而是在配置一台机器：
- 设置这台机器当前用哪个数据
- 设置当前用哪个着色程序
- 设置视口大小
- 然后按下"执行"按钮

这种设计初看反直觉，但背后逻辑很清晰：**GPU 不理解"矩形"、"图片"这些高层概念，它只理解"顶点"和"像素"**。WebGL 的 API 就是为这个层次设计的。

这也正是 Three.js 这类库存在的意义——它在 WebGL 上面封装了"矩形"、"球体"、"光源"等高层概念。

---

## 四、Hello GPU——第一段 WebGL 代码

目标：让 canvas 显示一个深蓝色背景。

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; background: #111; display: flex; justify-content: center; align-items: center; height: 100vh; }
    canvas { border: 1px solid #444; }
  </style>
</head>
<body>
  <canvas id="c" width="600" height="400"></canvas>
  <script>
    const canvas = document.getElementById('c');

    // 1. 获取 WebGL 上下文
    const gl = canvas.getContext('webgl');

    if (!gl) {
      alert('你的浏览器不支持 WebGL');
    }

    // 2. 设置视口：告诉 WebGL canvas 的像素范围
    gl.viewport(0, 0, canvas.width, canvas.height);

    // 3. 设置清屏颜色（RGBA，每个分量 0.0 ~ 1.0）
    gl.clearColor(0.1, 0.2, 0.4, 1.0);  // 深蓝色，完全不透明

    // 4. 执行清屏
    gl.clear(gl.COLOR_BUFFER_BIT);
  </script>
</body>
</html>
```

**逐行解读**：

- `getContext('webgl')`：获取 WebGL 渲染上下文，如果返回 `null` 说明不支持
- `gl.viewport()`：告诉 WebGL 我们要用 canvas 的哪个区域来渲染，坐标从左下角开始（注意：WebGL 的 Y 轴朝上，和 Canvas 2D 相反）
- `gl.clearColor(r, g, b, a)`：**只是设置状态**，告诉状态机"清屏时用这个颜色"，此时还没有真正清屏
- `gl.clear(gl.COLOR_BUFFER_BIT)`：**触发动作**，真正执行清屏

---

## 五、一个值得注意的坐标差异

| | Canvas 2D | WebGL |
|---|---|---|
| 原点位置 | 左上角 | 左下角 |
| Y 轴方向 | 向下 | 向上 |
| 坐标单位 | 像素 | 归一化（-1.0 ~ 1.0）|

WebGL 不用像素作坐标，而是用**归一化设备坐标（NDC）**：画布中心是 (0,0)，右上角是 (1,1)，左下角是 (-1,-1)。这个设计是为了让渲染结果与分辨率无关——第 3 章讲坐标系时会深入讨论。

---

## 章末思考题

**题 1（理解）**：Canvas 2D 和 WebGL 都能画东西，为什么 PixiJS 选择用 WebGL 作为默认渲染器？如果一个项目只需要画几个静态图形，你会选哪个？

> **参考答案**：PixiJS 面向游戏和动画场景，需要每秒 60 帧更新大量精灵（Sprite）——这正是 GPU 的强项。GPU 并行处理大量相同计算远快于 CPU。但如果只是画几个静态图形（比如一张报表），Canvas 2D 反而更简单，API 更直觉，不需要引入 GPU 的复杂性。**工具选择取决于性能需求和复杂度权衡。**

**题 2（延伸）**：WebGL 是"状态机"设计，Canvas 2D 是"命令式"设计。你觉得 WebGL 为什么要选择状态机这种设计风格？

> **参考答案**：因为 WebGL 直接对应 GPU 的工作方式。GPU 不是一个"理解命令"的智能体，它是一套流水线——你需要先配置好流水线的每个环节（着色程序、数据缓冲区、视口等），然后一次性触发执行。状态机设计让 WebGL 能最大程度地暴露 GPU 的控制权，代价是 API 更繁琐。这也是抽象层（Three.js）存在的核心价值：它帮你管理这些状态。

**题 3（挑战）**：`gl.clear(gl.COLOR_BUFFER_BIT)` 中的 `COLOR_BUFFER_BIT` 是什么意思？WebGL 除了颜色缓冲区，还有哪些缓冲区？猜猜它们各自的用途。

> **参考答案**：WebGL 维护多个"缓冲区"，每个存储不同信息：
> - **颜色缓冲区（COLOR_BUFFER_BIT）**：存储每个像素的颜色（最终输出到屏幕）
> - **深度缓冲区（DEPTH_BUFFER_BIT）**：存储每个像素距离相机的深度值，用于判断"哪个物体在前面"（遮挡关系）
> - **模板缓冲区（STENCIL_BUFFER_BIT）**：存储每个像素的蒙版值，用于高级渲染效果（如镜像、轮廓线）
>
> 这三个缓冲区共同构成一帧的完整渲染数据。清屏时可以用 `|` 组合多个 bit，如 `gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)`。
