# Python 类型系统与 FastAPI

> 来源：DeerFlow 前端研究对话中的 Python 基础知识补充（2026-05-16）

---

**Q1：Python 的 `Annotated` 第二个字段是什么？**

`Annotated[类型, 元数据]` 的第二个及之后的字段是**元数据**，Python 运行时完全忽略，但框架可以读取利用。例如 `Annotated[str, Query(max_length=50)]` 对 Python 来说类型就是 `str`，但 FastAPI 读取第二个字段 `Query(...)` 来做参数校验；`Annotated[int, Field(ge=0, le=150)]` 中 Pydantic 读取 `Field(...)` 做范围校验。本质上是把类型和约束打包在一起，比写在装饰器或配置里更直观。

> 💡 **Tips**：Python 的 type hints（包括 `Annotated`）都不影响运行时行为，是给静态检查工具（mypy, pyright）和 IDE 用的，类似 TypeScript 之于 JavaScript。Python 是**强类型 + 动态类型**——不做隐式转换（`"1"+1` 报 TypeError），但变量可以随时指向不同类型的值。

**Q2：FastAPI、Django、Flask 有什么区别？为什么 AI 项目多选 FastAPI？**

三个框架定位不同：Django 是"全家桶"（内置 ORM、Admin、模板、认证），适合内容网站和管理后台；Flask 是微框架，只给路由和模板核心，其他自己拼装，适合小项目和灵活定制；FastAPI 是 API 优先的现代框架，原生 async、类型标注驱动（自动校验 + 自动 API 文档 + IDE 补全）。FastAPI 火起来有三个原因：Python async/await 生态成熟后 Django 的同步模型成为瓶颈；type hints 成熟后 FastAPI 把它用到极致；AI/数据领域（模型部署、LLM 后端）几乎都是 API 服务，FastAPI 的定位完美匹配。DeerFlow 选 FastAPI 就是因为纯 API + SSE 流式 + 异步的场景。
