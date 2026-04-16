# Midscene 渐进式学习课程

## 核心本质

Midscene 解决的根本问题是 **UI 自动化的"描述方式"**。传统方案（Playwright/Selenium）用 CSS 选择器、XPath 等"程序语言"指定元素，UI 一改就断。Midscene 换了一个根本思路：用**视觉语言模型（VLM）像人一样"看"界面**，用自然语言描述意图。这不只是换了个定位方式，而是把自动化的抽象层级从"DOM 结构"提升到了"视觉语义"。

与 Playwright+MCP 的关键差异：Playwright+MCP 是给 AI agent 提供浏览器操作工具，本质是"AI 在外面操控 Playwright"。而 Midscene 是将 VLM **深度嵌入自动化框架内部**，每一步操作都经过视觉理解，并提供缓存、可视化回放、断言等测试基础设施。

## 实战项目

**对 TodoMVC 编写完整 E2E 测试套件**，同时用 Playwright 原生方案做同场景对比，直观感受两种范式的差异。选择 TodoMVC 是因为它覆盖 CRUD 全场景、便于 A/B 对比、可逐步扩展到数据提取和视觉断言等高级场景。

## 课程大纲

**第1章：核心理念与快速上手**
视觉驱动 vs 选择器驱动的本质差异；环境搭建（SDK 安装 + Chrome 扩展零代码体验）；写出第一个 AI 驱动的自动化脚本。产出：在 Chrome 扩展中完成一次自然语言驱动的页面操作，并用 SDK 写出第一个脚本。

**第2章：三大 API 体系深度拆解**
Interaction API（点击/输入/滚动）、Data Extraction API（结构化数据提取）、Utility API（aiAssert/aiLocate/aiWaitFor）；与 Playwright 的集成方式。产出：用 Midscene + Playwright 为 TodoMVC 编写包含交互、数据提取、视觉断言的完整测试用例。

**第3章：Midscene vs Playwright+MCP — 架构级对比**
两种方案的架构差异、决策流程、适用场景深度对比；缓存机制与 Token 成本控制；稳定性与可维护性分析。产出：同一测试场景的 Midscene 方案 vs Playwright+MCP 方案对比实验报告。

**第4章：跨平台能力与高级特性**
Android/iOS 移动端自动化原理；YAML 声明式脚本；Bridge Mode（接管已有浏览器）；可视化调试报告解读；模型选择策略。产出：一个 YAML 声明式自动化脚本 + 可视化报告分析。

**第5章：实战整合、CI/CD 与最佳实践**
完整项目回顾与集成；CI/CD 中运行 Midscene 测试；Midscene 的能力边界与局限性；何时该用 Midscene、何时该用传统方案的决策框架。产出：一套可落地的 Midscene 测试策略方案。
