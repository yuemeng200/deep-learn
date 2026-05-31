---
title: SDD开发 渐进式学习课程
date: 2026-05-31
summary: 从意图鸿沟出发，以 GitHub spec-kit 为实践主轴，系统理解 Spec-Driven Development 的原理、工具生态与它在 Harness Engineering 中的定位
---

# SDD开发 渐进式学习课程

## 核心本质

SDD（Spec-Driven Development）是 AI 时代人机协作的一种契约模型——不是最优解，但它把「人类意图到机器执行」的鸿沟这个核心问题，用一种可结构化、可审查的方式显式暴露出来。

理解 SDD，本质上是理解 AI Coding 时代「人的价值在哪里」。人类将意图转化为机器可执行的规格（Spec），AI 在规格的约束下生成代码，人类审查的是规格的质量而非实现细节——这个范式背后的真正追问是：**在 AI 可以生成大量代码的时代，人类的不可替代价值究竟应该投放在哪里？**

## 课程主线（混合型：问题链 + 关键验证节点）

**核心问题链**：

> "AI 能写代码了，那工程师还需要做什么？"
> → 什么是好的 Spec？
> → Spec 和 Vibe 的本质区别是什么？
> → 主流工具如何落地 SDD？（以 GitHub spec-kit 为主轴）
> → SDD 在什么场景下赢、在什么场景下输？
> → 有没有比 SDD 更完整的框架来理解 AI Coding？
> → **最终收束**：一个成熟的 AI-Augmented 工程师应该如何定位自己的角色？

关键验证节点：第2章（工作流结构图）、第3章（spec-kit 实操案例）、第4章（对比矩阵）、第6章（分层结构图）。

## 课程大纲

### 第1章：为什么需要 Spec？
AI 时代的人机协作本质问题：意图鸿沟（Intent Gap）是什么，它如何导致 Vibe Coding 的质量不稳定。以 spec-kit 文档中「The Power Inversion」的论述为引子，收束于"Spec 的本质功能"，为后续一切打地基。

### 第2章：SDD 的核心工作流
从"写什么样的 Spec"到"Spec 驱动 AI 执行"的完整闭环。产出：SDD 工作流结构图（Constitution → Spec → Plan → Tasks → Implement）。

### 第3章：spec-kit 深度解析——当前最佳实践
GitHub 官方 SDD 工具包（107k stars）的完整解析：CLI 安装与初始化、5 大核心命令（`/speckit.constitution` / `/speckit.specify` / `/speckit.plan` / `/speckit.tasks` / `/speckit.implement`）、模板体系（spec/plan/constitution/tasks 模板）、30+ AI agent 集成（Claude Code、Copilot、Cursor、Windsurf、Devin 等）。产出：一个完整的 spec-kit 上手案例。

### 第4章：SDD vs Vibe Coding vs TDD+AI——三种范式的比较框架
用统一的评估维度（意图传递效率 / 可验证性 / 适用场景 / 认知负担 / 团队协作性）对三种模式进行系统性对比。产出：对比矩阵 + 各自的"最强适用场景"判断。

### 第5章：Spec 的质量决定一切——什么是好的 Spec？
深入 Spec 的内部结构：以 spec-kit 的 spec-template 为解剖对象，分析 User Stories / Acceptance Scenarios / FR requirements / Success Criteria 各层次的设计逻辑。模糊性 vs 精确性的权衡，过度约束 vs 欠约束的代价。产出：好/坏 Spec 的对比案例分析。

### 第6章：Harness Engineering——SDD 之上的更大框架
SDD 只是 Harness 的一层。完整的 Harness Engineering 包含什么？Constitution（治理层）、Spec/Plan/Tasks（规格层）、CI/CD 约束、测试覆盖率门槛、上下文窗口管理——这些如何共同「harness」AI 的能力。产出：Harness Engineering 的分层结构图。

### 第7章：面试战场——如何系统性地表达这套认知
如何在面试中展示「不只是 SDD 的使用者，而是 AI Coding 方法论的思考者」。包括常见追问的应对框架、表达结构、以及当前 Vibe Coding 经验如何转化为加分项，如何用 spec-kit 的具体设计决策作为论据。产出：面试场景下的表达模板 + 常见陷阱分析。
