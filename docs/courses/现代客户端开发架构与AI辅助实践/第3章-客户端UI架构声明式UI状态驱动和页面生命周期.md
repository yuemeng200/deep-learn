# 第 3 章：客户端 UI 架构，声明式 UI、状态驱动和页面生命周期

客户端开发的核心不是把界面元素摆出来，而是让界面在业务状态、用户事件、异步数据和系统生命周期之间保持一致。

前两章我们已经建立了客户端运行环境和平台模型。这一章进入 UI 架构层：为什么现代客户端 UI 越来越像 React，但又不能简单套用 Web 心智。

## 1. 现代客户端 UI 的共同趋势：声明式、组件化、状态驱动

过去很多 UI 开发是命令式的。你会拿到一个按钮、一个文本、一个列表，然后在合适的时机手动修改它们：

```text
找到 TextView / UILabel / DOM Node
  -> 设置文字
  -> 设置颜色
  -> 设置 loading
  -> 请求回来后再手动改一次
```

这种方式的问题是：当状态变多时，UI 很容易和真实业务状态不同步。

比如一个提交按钮至少可能受这些状态影响：

- 表单是否有效。
- 当前是否正在提交。
- 网络是否可用。
- 用户是否登录。
- 服务端是否返回字段错误。
- 页面是否已经离开。

如果你在多个回调里手动改按钮、错误文案和 loading，很快就会出现“某个分支忘了改回来”的问题。

声明式 UI 的思路是反过来：

```text
先描述状态
  -> 再描述状态对应的界面
  -> 状态变化后框架重新计算界面
```

也就是：

```text
UI = f(State)
```

React、SwiftUI、Jetpack Compose、React Native、Flutter 都在不同程度上采用这个思想。它们的共同点是：

- 用组件或视图函数描述界面结构。
- 用状态描述当前页面应该长什么样。
- 用户事件触发状态变化。
- 状态变化驱动 UI 更新。
- 框架负责把描述转换成真实界面更新。

这也是前端开发者进入现代客户端时最容易迁移的部分。

## 2. 但客户端 UI 不是简单的“移动端 React”

如果只看声明式 UI，SwiftUI、Compose、RN、Flutter 确实都像 React。但客户端 UI 多了一个重要维度：系统生命周期会打断 UI。

在 Web 页面中，你也会遇到刷新、路由切换、tab 隐藏、组件卸载。但移动客户端的系统干预更强：

- App 进入后台。
- 页面被导航栈移除。
- Android Activity 因配置变化被重建。
- iOS Scene 被断开或恢复。
- 系统因内存压力杀掉进程。
- 权限弹窗打断当前交互。
- 第三方登录或支付跳出 App 后再回调。
- 用户从通知或 deep link 直接进入某个页面。

所以客户端 UI 不只是：

```text
State -> View
```

更准确的模型是：

```text
用户事件 + 异步数据 + 系统生命周期
  -> 改变状态
  -> 状态驱动界面
  -> 界面再触发事件
```

可以画成这样：

```text
             用户点击 / 输入 / 滚动
                      |
                      v
网络响应 / 本地缓存 -> State <- 系统生命周期 / 权限 / 导航
                      |
                      v
                    View
                      |
                      v
              Effect / Navigation / 平台能力
```

这里的关键是：客户端 UI 架构不仅要回答“状态怎么渲染”，还要回答“状态从哪里来、何时失效、页面不在了怎么办、系统打断后怎么恢复”。

## 3. 几个核心概念：View、State、Event、Effect

不管具体框架叫什么名字，现代客户端 UI 都绕不开四个概念。

### View：界面的描述

View 是当前状态下界面应该是什么样。

在 React/RN 里，它通常是组件返回的 JSX。在 SwiftUI 里是 `View` 的组合。在 Compose 里是 Composable 函数。在 Flutter 里是 Widget Tree。

你不需要把 View 理解为某个具体对象。更有用的理解是：View 是状态的可视化投影。

### State：界面的事实来源

State 是 UI 当前依赖的事实。

典型状态包括：

- 页面是否加载中。
- 当前用户资料。
- 输入框内容。
- 错误信息。
- 是否展示弹窗。
- 列表数据和分页状态。
- 当前选中的 tab。
- 权限是否已授权。

状态设计的质量，直接决定 UI 复杂度。很多混乱的页面不是 UI 难写，而是状态没有被清晰建模。

### Event：用户或系统触发的输入

Event 是外部世界对界面的输入。

常见事件包括：

- 用户点击按钮。
- 用户输入文本。
- 用户下拉刷新。
- 网络请求完成。
- 页面进入前台。
- 权限结果返回。
- deep link 打开页面。

成熟的 UI 架构通常会把 Event 作为状态变化的入口，而不是让任意地方随手改状态。

### Effect：不纯的外部动作

Effect 是那些不能只靠渲染完成的事情。

比如：

- 发起网络请求。
- 写本地数据库。
- 打开相机。
- 请求定位权限。
- 跳转页面。
- 上报埋点。
- 显示 Toast。

声明式 UI 的一个常见陷阱是：初学者会以为所有东西都应该写在 View 里。但 Effect 不应该和纯 UI 描述混在一起，否则页面会变得难以测试、难以复用，也容易出现重复请求、重复跳转、生命周期泄漏。

## 4. 各技术栈如何表达这套模型

下面的表不是 API 对照表，而是心智模型对照表。

| 概念 | React / React Native | SwiftUI | Jetpack Compose | Flutter |
| --- | --- | --- | --- | --- |
| UI 描述 | Component / JSX | View | Composable | Widget |
| 本地状态 | `useState` / store | `@State` / `@Binding` | `remember` / state holder | `StatefulWidget` / state object |
| 外部状态 | Redux/Zustand/Query 等 | `Observable` / `@Observable` / ViewModel | ViewModel / Flow / StateFlow | ChangeNotifier / Bloc / Riverpod 等 |
| 副作用 | `useEffect` / handler | `.task` / `.onAppear` / async action | `LaunchedEffect` / side-effect API | lifecycle / Future / stream / side-effect layer |
| 页面容器 | Navigation / native screen | NavigationStack / ViewController | Activity / Fragment / NavHost | Navigator / Route |
| 平台能力 | Native Module / Turbo Module | iOS SDK | Android SDK | Platform Channels / plugin |

这张表里真正重要的是：不同技术栈命名不同，但都在处理同一组问题。

你学客户端 UI 架构时，不应该把每个框架当成完全独立的世界，而应该问：

- 这个框架的 View 是什么？
- 状态放在哪里？
- 用户事件在哪里被接收？
- 副作用在哪里执行？
- 页面生命周期如何暴露？
- 导航和平台能力如何接入？

这些问题比背 API 更稳定。

## 5. 状态应该怎么拆：从“变量堆”到“页面模型”

AI Coding 很容易把状态写成一堆变量：

```text
isLoading
isSubmitting
error
user
avatar
showDialog
hasPermission
selectedImage
uploadProgress
```

这些变量本身没错，但如果没有结构，页面很快会出现非法组合。

比如：

- `isLoading = true`，但同时 `user` 又有值。
- `isSubmitting = false`，但 `uploadProgress = 80%`。
- `error` 有值，但 UI 仍然显示成功。
- `hasPermission = false`，但 `selectedImage` 有值。

更好的方式是先识别页面状态类型。

以“个人资料页”为例，可以拆成：

```text
页面主状态：
  initialLoading
  loaded(userProfile)
  loadFailed(error)

头像编辑状态：
  idle
  requestingPermission
  pickingImage
  croppingImage
  uploading(progress)
  uploadFailed(error)

表单编辑状态：
  clean
  dirty(form)
  validating
  submitting
  submitFailed(fieldErrors)
  submitSucceeded
```

这种拆法的价值是：它让非法状态更少，让 UI 渲染更清楚，也让 AI 更容易生成符合业务的代码。

如果你只告诉 AI“加一个上传头像功能”，它可能会堆变量。如果你告诉它“头像编辑状态是 idle/requestingPermission/pickingImage/croppingImage/uploading/uploadFailed，并且页面离开时取消 uploading”，它生成的方案通常会更接近真实工程。

## 6. ViewModel / Store / State Holder 的意义

在客户端工程里，你会经常看到这些名字：

- ViewModel
- Store
- Controller
- Presenter
- State Holder
- Bloc
- Reducer

它们不是同一个东西，但都在试图解决一个问题：

> 不要让 UI 组件直接承担全部业务状态、异步流程和副作用。

一个比较通用的分层可以这样理解：

```text
View
  只负责展示状态和发出事件

ViewModel / Store / State Holder
  持有页面状态
  接收用户事件
  调用业务逻辑或数据层
  处理异步结果
  输出新的 UI 状态

Repository / Service / Use Case
  负责网络、本地存储、领域规则、平台能力封装
```

这个分层不是宗教。小页面可以简单，大页面需要更清晰。但原则是稳定的：UI 越纯，状态和副作用越可控；状态越集中，页面越容易测试和维护。

对于 AI Coding，这也是一个重要约束。你可以明确要求：

```text
不要把网络请求直接写在 View 里。
把页面状态放在 ViewModel/Store。
View 只渲染 state，并把用户事件转发给 ViewModel/Store。
权限请求结果要回写为明确状态。
页面销毁时取消未完成任务。
```

这种 prompt 比“帮我写一个页面”可靠得多。

## 7. 生命周期如何影响 UI 状态

声明式 UI 很容易让人产生一个错觉：只要状态设计好了，UI 就自然正确。

在客户端里，还要考虑状态什么时候应该存在，什么时候应该释放，什么时候应该恢复。

### 页面进入时

页面第一次出现，可能需要加载数据、恢复本地缓存、检查权限、订阅数据源、开始埋点。

风险是重复加载。比如页面每次重新出现都触发请求，可能造成闪烁、重复上报或覆盖用户编辑中的数据。

### 页面离开时

页面离开后，可能需要取消请求、保存草稿、停止监听、释放资源、结束埋点。

风险是异步回调晚到。请求完成时页面已经不在，状态更新可能无效，甚至导致崩溃。

### App 进入后台时

App 进入后台，可能需要暂停动画、保存状态、降低刷新频率、处理上传中断。

风险是把后台当成页面仍在前台。比如继续高频刷新、继续播放不该播放的媒体、继续执行耗电任务。

### 页面被系统重建时

Android 配置变化、系统回收内存后恢复、iOS Scene 恢复，都可能让页面对象重新创建。

风险是把短期 UI 状态和长期业务状态混在一起。比如输入框草稿应该恢复，但一次性 Toast 不应该重复弹出。

## 8. 轻量验证：个人资料页的状态拆分

假设我们要做一个个人资料页，功能包括：

- 展示头像、昵称、简介。
- 点击头像后选择图片并上传。
- 编辑昵称和简介。
- 保存修改。
- 弱网时显示错误并允许重试。

不要急着写 UI。先做状态拆分。

### 页面主状态

| 状态 | 含义 | UI 表现 |
| --- | --- | --- |
| `loading` | 首次加载用户资料 | 骨架屏或加载态 |
| `loaded(profile)` | 资料加载成功 | 展示资料和编辑入口 |
| `loadFailed(error)` | 首次加载失败 | 错误页和重试按钮 |

### 表单状态

| 状态 | 含义 | UI 表现 |
| --- | --- | --- |
| `clean` | 当前表单未修改 | 保存按钮禁用 |
| `dirty(form)` | 用户已修改 | 保存按钮可用 |
| `submitting` | 正在保存 | 保存按钮 loading |
| `submitFailed(errors)` | 保存失败 | 字段错误或全局错误 |

### 头像状态

| 状态 | 含义 | UI 表现 |
| --- | --- | --- |
| `idle` | 未编辑头像 | 正常展示头像 |
| `requestingPermission` | 正在请求相册/相机权限 | 可展示等待态 |
| `pickingImage` | 正在选择图片 | 等待系统选择器返回 |
| `croppingImage` | 正在裁剪 | 裁剪界面或等待 |
| `uploading(progress)` | 正在上传 | 头像局部进度 |
| `uploadFailed(error)` | 上传失败 | 错误提示和重试 |

### 生命周期规则

还要补充规则：

- 页面首次出现时加载资料，但已有缓存时先展示缓存。
- 页面离开时，如果资料保存中，要么阻止离开，要么提示用户。
- 头像上传中切后台，允许继续还是取消，要根据产品和平台能力决定。
- 页面销毁时取消不必要的监听和请求。
- 保存成功后，表单状态从 `dirty` 回到 `clean`。
- 一次性 Toast 不应该被页面重建后重复展示。

这就是“状态拆分练习”的价值：你还没写一行具体 API，但已经把页面的架构骨架搭起来了。

## 9. AI Coding 下的 UI 架构提示模板

当你让 AI 写客户端页面时，可以这样给上下文：

```text
目标：
  实现个人资料页的头像上传和资料编辑。

技术栈：
  SwiftUI / Jetpack Compose / React Native / Flutter

架构约束：
  View 只负责渲染 UI state 和转发 user event。
  页面状态放在 ViewModel/Store/State Holder。
  网络请求、上传、缓存通过 Repository 或 Service 调用。
  不要把平台权限逻辑散落在多个 UI 组件里。

状态模型：
  mainState = loading | loaded(profile) | loadFailed(error)
  avatarState = idle | requestingPermission | pickingImage | croppingImage | uploading(progress) | uploadFailed(error)
  formState = clean | dirty(form) | submitting | submitFailed(errors)

生命周期：
  页面离开时取消未完成的非必要请求。
  页面重建后恢复表单草稿，但不要重复展示一次性 Toast。
  权限拒绝后展示降级路径，不要继续打开系统选择器。

验收：
  覆盖首次加载、保存失败、上传失败、权限拒绝、页面离开、弱网重试。
```

这个模板背后的原则是：让 AI 先遵守 UI 架构，再让它写具体代码。否则它很容易生成一个能跑但难维护的页面。

## 10. 本章小结

这一章建立了客户端 UI 架构的基本模型：

- 现代客户端 UI 普遍走向声明式、组件化、状态驱动。
- React、SwiftUI、Jetpack Compose、React Native、Flutter 的表层 API 不同，但都在处理 View、State、Event、Effect。
- 客户端 UI 不能只理解为 `UI = f(State)`，还必须加入系统生命周期、导航和平台能力。
- 好的页面状态不是变量堆，而是受控的状态模型，能减少非法组合。
- ViewModel、Store、State Holder 等模式的价值，是把 UI 展示、业务状态和副作用分开。
- AI Coding 写 UI 时，最应该补充的是状态模型、分层约束、生命周期规则和验收场景。

第 4 章会继续往业务链路走：一个按钮点击到服务端数据变化，中间到底会穿过 UI、状态、领域逻辑、网络、缓存、错误处理和埋点哪些层。

## 思考题

### 题 1：为什么说声明式 UI 的核心不是“语法更简洁”，而是“状态到界面的映射更清晰”？

参考答案：

因为声明式 UI 的关键变化是从手动修改界面，转为描述“某个状态下界面应该是什么样”。这样 UI 更新由状态驱动，能减少多个回调分支手动改 UI 造成的不一致。语法简洁只是表象，更重要的是把 UI 变成状态的可视化投影。

### 题 2：为什么客户端 UI 架构不能只用 `UI = f(State)` 概括？

参考答案：

因为移动客户端会被系统生命周期、导航、权限弹窗、后台切换、进程回收、deep link、第三方回调等因素打断。状态不仅来自用户事件和网络响应，也来自系统环境。更完整的模型应该是：用户事件、异步数据和系统生命周期共同改变状态，再由状态驱动 UI。

### 题 3：AI 生成客户端页面时，为什么要先给状态模型，而不是只给视觉描述？

参考答案：

视觉描述只能告诉 AI 页面长什么样，但不能告诉它业务状态如何变化、哪些状态互斥、异步流程如何处理、生命周期如何收尾。状态模型能约束页面的行为边界，减少非法状态和散乱副作用，让生成代码更接近真实工程结构。
