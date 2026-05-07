# 第 2 章：Ink 是怎么工作的——React 渲染到终端

## 核心概念

React 内部分两层：
- **React Core（reconciler）**：计算组件树、diff、调度更新
- **Renderer（渲染器）**：把 diff 结果"画"到具体目标上

Ink 是针对**终端字符网格**的 renderer。

## Ink 渲染流程

```
JSX 组件树
    ↓
Ink reconciler 构建虚拟节点树
    ↓
Yoga 引擎计算布局（x/y/width/height）
    ↓
遍历节点树，生成字符 + ANSI 序列
    ↓
diff 对比上次输出，只重绘变化的行
    ↓
process.stdout.write(...)
```

## 环境搭建

```bash
mkdir taskr && cd taskr
npm init -y
npm install ink react
npm install --save-dev @babel/core @babel/preset-react @babel/preset-env @babel/node
```

`babel.config.json`：
```json
{
  "presets": [
    ["@babel/preset-env", { "targets": { "node": "current" } }],
    "@babel/preset-react"
  ]
}
```

`package.json` scripts：
```json
"scripts": {
  "dev": "babel-node src/index.jsx"
}
```

## 实战代码：src/index.jsx

```jsx
import React, { useState, useEffect } from 'react';
import { render, Text, Box } from 'ink';

function ProgressBar({ percent }) {
  const width = 30;
  const filled = Math.round(width * percent);
  const empty = width - filled;

  return (
    <Box>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>
      <Text>  {Math.round(percent * 100)}%</Text>
    </Box>
  );
}

function App() {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(p => {
        if (p >= 1) {
          clearInterval(timer);
          setDone(true);
          return 1;
        }
        return p + 0.05;
      });
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>✓ taskr</Text>
      <Box marginTop={1}>
        <ProgressBar percent={progress} />
      </Box>
      {done && <Text color="green">  完成！</Text>}
    </Box>
  );
}

render(<App />);
```

## 对比第 1 章

| | 第 1 章（原始） | 第 2 章（Ink） |
|---|---|---|
| 颜色 | `\x1b[32m` | `color="green"` |
| 布局 | 手动计算字符位置 | Flexbox |
| 刷新 | 手动 `\r` + `\x1b[2K]` | 状态更新自动 diff |
| 组件复用 | 无 | React 组件 |

## 重要注意

- `console.log` 底层也写 `stdout`，会破坏 Ink 界面渲染
- Ink 监听 `SIGWINCH` 信号处理终端 resize
- 所有 React hooks（useState、useEffect）都可以正常使用
