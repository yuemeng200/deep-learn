# GORM 渐进式学习课程

## 核心本质

GORM 解决的根本问题是：**在 Go 的静态类型系统中，用结构体来表达关系模型，让数据库操作具备类型安全和可组合性**。

它和 Django ORM 的哲学不同——Django 偏"重框架"，一个 `models.py` 搞定一切；GORM 更"Go 风格"——靠 struct tag 约定、嵌入（embedding）组合能力、链式调用构建查询。理解这个差异，是从 Django 思维切换到 GORM 思维的关键。

## 实战项目

**任务协作平台 API**（TaskFlow）

包含用户、团队、项目、任务、评论、标签等实体。选它因为：
- 关联关系自然覆盖 BelongsTo / HasMany / ManyToMany / 多态关联
- 业务场景能引出事务、钩子、软删除、作用域等进阶特性
- 贴近实际项目中会遇到的模式

## 课程大纲

### 第1章：模型、迁移与基本 CRUD
GORM 的约定哲学、模型定义、AutoMigrate、增删改查（含零值陷阱）。产出：项目骨架 + User 模型 CRUD。

### 第2章：链式查询与预加载
Where / Order / Limit / Scopes 等链式查询 + Preloading 解决 N+1 问题。产出：灵活高效的查询接口。

### 第3章：关联关系
BelongsTo、HasOne、HasMany、Many2Many 四种关联的定义与操作。产出：TaskFlow 完整关联模型。

### 第4章：钩子、事务与软删除
模型生命周期钩子、事务管理、软删除机制。产出：带业务逻辑保障的完整数据层。

### 第5章：项目整合与复盘
串联前 4 章产出为完整 TaskFlow API，梳理最佳实践，对比 Django ORM 与 GORM 的设计差异。产出：可运行的完整项目。
