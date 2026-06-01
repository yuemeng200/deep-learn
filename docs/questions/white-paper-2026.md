---
title: White Paper 2026
date: 2026-06-01
summary: Ask and Answer
---

# White Paper 2026

## 你的 AI Workflow 是什么样的？

当前主要方式是基于 Claude Code 的 Plugin，里面包含一系列 Skills 和 Mcps。涵盖整个需求交付的链路。

起点是从我们被拉到一个需求群，PM发出初版的需求文档，约定下午需求评审。

此时需要 **需求澄清 SKILL**，输入为初版PRD链接，以及代码库维护的结构化文档：

docs/
  modules/
    concept/
    fact/

> 这些文档在 pre-commit 阶段自动维护。

此阶段确保需求可理解，无漏洞。

产出问题清单，在需求详评上针对性讨论这些问题。提高沟通效率。

根据会议结论和更正后的PRD通过 **规格明确SKILL**产出需求规格文档，类似于spec

下一个阶段就是技术设计阶段，输入为规格文档、上下游接口契约，使用**技术设计SKILL**输出为技术设计文档 plan。

使用这份文档进行技术设计 review。

之后进入开发环节。使用 **任务规划SKILL**进行任务拆解为tasks

确认后进行编码阶段。通过CLAUDE.md约束开发和环境，比如figma mcp、playwright MCP等

还有**问题发现SKILL**和**需求变更SKILL**