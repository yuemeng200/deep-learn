# 第1章：模型、迁移与基本 CRUD

> GORM 的核心是"用 struct 表达关系模型"。本章从零开始——看看一个 Go struct 如何变成数据库表，以及 GORM 靠什么约定让这件事几乎不需要配置。

## 1.1 项目初始化与数据库连接

```bash
mkdir taskflow && cd taskflow
go mod init taskflow
go get -u gorm.io/gorm
go get -u gorm.io/driver/sqlite
```

```go
// database/db.go
package database

import (
    "gorm.io/driver/sqlite"
    "gorm.io/gorm"
)

var DB *gorm.DB

func Init() error {
    var err error
    DB, err = gorm.Open(sqlite.Open("taskflow.db"), &gorm.Config{})
    return err
}
```

**与 Django 的区别**：Django 在 `settings.py` 配数据库，`manage.py migrate` 跑迁移。GORM 把一切放在代码里——没有配置文件，没有 CLI 命令，全在 Go 代码中完成。这是 Go 生态的普遍风格。

## 1.2 模型定义——约定优于配置

```go
// models/user.go
package models

import "gorm.io/gorm"

type User struct {
    gorm.Model                      // 提供 ID、CreatedAt、UpdatedAt、DeletedAt
    Name   string `gorm:"size:100;not null"`
    Email  string `gorm:"size:200;uniqueIndex;not null"`
    Avatar string `gorm:"size:500"`
}
```

三个要点：

**`gorm.Model` 是嵌入，不是继承**

等价于自动获得这四个字段：

```go
ID        uint           `gorm:"primarykey"`
CreatedAt time.Time
UpdatedAt time.Time
DeletedAt gorm.DeletedAt `gorm:"index"`
```

Go 的 embedding 和 Django 的继承机制不同——字段被"提升"到外层结构体，GORM 通过反射读取。不嵌入 `gorm.Model` 也完全没问题，自己定义一个 `ID uint` 字段，GORM 照样认（它靠约定 `ID` 或 `xxxID` 识别主键）。

**struct tag 是 GORM 的配置语言**

Django 用 `EmailField(unique=True, max_length=200)` 这类字段类型表达约束。GORM 不搞字段类型——通用的 `string` + tag 来描述数据库约束。**用组合代替继承，用约定代替类型膨胀**，这就是 Go 的哲学。

**表名约定**

`User` → `users`，`TaskComment` → `task_comments`。要自定义就实现 `Tabler` 接口：

```go
func (User) TableName() string {
    return "app_users"
}
```

## 1.3 自动迁移

```go
// main.go
package main

import (
    "fmt"
    "log"
    "taskflow/database"
    "taskflow/models"
)

func main() {
    if err := database.Init(); err != nil {
        log.Fatal(err)
    }

    // 只添加缺失的列和索引，不会删已有的列
    database.DB.AutoMigrate(&models.User{})
    fmt.Println("Migrated")
}
```

**与 Django 的区别**：
- Django：`makemigrations` 生成迁移文件 → `migrate` 执行，有完整历史管理
- GORM：`AutoMigrate` 直接对比模型和数据库，差异同步，没有迁移文件

开发阶段用 AutoMigrate 很方便，但生产环境通常用 **golang-migrate**、**Atlas** 等工具来管理迁移——因为你需要回滚和审查的能力。

## 1.4 CRUD 操作

```go
// ========== Create ==========
user := models.User{Name: "张三", Email: "zhangsan@test.com"}
result := database.DB.Create(&user)
fmt.Printf("ID: %d, RowsAffected: %d\n", user.ID, result.RowsAffected)

// 批量
users := []models.User{
    {Name: "李四", Email: "lisi@test.com"},
    {Name: "王五", Email: "wangwu@test.com"},
}
database.DB.Create(&users)

// ========== Read ==========
var u models.User
database.DB.First(&u, 1)                              // 按主键
database.DB.First(&u, "email = ?", "zhangsan@test.com") // 按条件

var all []models.User
database.DB.Find(&all)                                 // 全部

// ========== Update ==========
database.DB.Model(&u).Update("Name", "张三丰")          // 单字段

// 多字段——注意零值陷阱！
database.DB.Model(&u).Updates(models.User{Name: "张三丰", Avatar: ""})
// ↑ Avatar 是空字符串，GORM 当作"没赋值"，跳过！

// 正确姿势：
database.DB.Model(&u).Updates(map[string]interface{}{"Name": "张三丰", "Avatar": ""})
database.DB.Model(&u).Select("Name", "Avatar").Updates(models.User{Name: "张三丰", Avatar: ""})

// ========== Delete ==========
database.DB.Delete(&u, 1)
// 因为有 gorm.Model（DeletedAt 字段），实际执行软删除：UPDATE users SET deleted_at=NOW()
// 真删除：database.DB.Unscoped().Delete(&u, 1)
```

## 零值陷阱——Django 转 GORM 最大的坑

```python
# Django：空字符串会正常更新
User.objects.filter(id=1).update(name="")
```
```go
// GORM：空字符串是 string 的零值，被跳过
DB.Model(&user).Updates(User{Name: ""})  // Name 不会被更新！
```

原因：Go 无法区分"用户想设为空字符串"和"字段没赋值（默认零值）"。解决方案：用 `map` 或 `Select()` 显式指定。

## 章末思考题

1. **如果 User 不嵌入 `gorm.Model`，而是只定义 `ID uint` 和业务字段，GORM 还能正常 CRUD 吗？** 动手试试，看看少了 CreatedAt / DeletedAt 后行为有什么变化。

2. **`Updates` 跳过零值这个设计，你觉得是"合理的权衡"还是"缺陷"？** 如果你来设计 GORM，你会怎么处理这个矛盾？

3. **`AutoMigrate` 只添加不删除。** 在团队协作的生产环境中，这会带来什么具体问题？你打算怎么应对？
