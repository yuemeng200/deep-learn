---
title: LangGraph 渐进式学习课程
date: 2026-05-21
summary: 以"Deep Research Agent"实战项目为主线，系统掌握 LangGraph 的图建模思想与生产级 Agent 开发实践
---

# LangGraph 渐进式学习课程

## 核心本质

LangGraph 解决的根本问题是：**如何让 AI Agent 像传统软件一样可控、可观测、可恢复**。

普通的 Agent 开发（如 ReAct 循环）本质上是把控制流交给 LLM，开发者只能"祈祷"它按预期行事。LangGraph 的设计哲学是：**用图（Graph）重新夺回控制权**——将 Agent 的推理过程显式建模为状态机，每个节点做什么、状态怎么流转、何时需要人类介入，全部由开发者定义。这样你既保留了 LLM 的智能，又获得了工程上的确定性。

## 课程主线

**实战项目：Deep Research Agent（深度研究助手）**

一个能接收研究问题、自主规划调研步骤、搜索并分析信息、自我反思迭代、最终生成结构化报告的 Agent。选它的原因：
- 天然涉及多步骤、循环、条件分支（覆盖 Graph 核心特性）
- 需要人类审批门控（Human-in-the-loop）
- 需要持久化与错误恢复（生产级要求）
- 足够复杂以展示子图（Sub-graph）的价值

## 课程大纲

### 第1章：从 Agent 到 Graph——为什么需要 LangGraph

理解"把 Agent 建模为图"的动机，对比传统 ReAct 循环的局限性。产出：搭建项目骨架，实现最简单的单节点 Graph。

### 第2章：State——图的血液系统

掌握 LangGraph 的状态定义与传递机制（TypedDict、Annotated reducers）。产出：为研究助手设计完整的状态 Schema。

### 第3章：节点与边——构建可控的推理流

掌握节点函数、普通边、条件边的设计模式。产出：实现"规划→搜索→分析"的基础流程图。

### 第4章：循环与反思——让 Agent 自我修正

利用图的循环能力实现 self-reflection 和重试机制。产出：为研究助手添加"质量检查→不合格则重新搜索"的反思循环。

### 第5章：Human-in-the-Loop——生产级 Agent 的安全阀

实现中断、审批、编辑三种人类介入模式。产出：在关键节点加入人类审批门控。

### 第6章：持久化与流式输出——部署前的最后一公里

Checkpointer 实现状态持久化与故障恢复；Streaming 实现实时反馈。产出：完整可部署的 Deep Research Agent。

### 第7章：子图与多 Agent 架构——规模化的设计模式

用 Sub-graph 实现模块化，探索 Supervisor / Swarm 等多 Agent 协作模式。产出：将研究助手重构为多 Agent 协作架构。

### 第8章：整合与复盘——从 Demo 到 Production

回顾全项目，补充生产级关注点（可观测性、测试、部署策略），复盘 LangGraph 的设计哲学。
