# 开发指南

本文档面向参与 Smart MZCMC 开发、联调和部署的开发者，内容以当前仓库代码为准。系统由 Go 后端、Svelte 管理端、Flutter 导播端/采访端和 .NET WPF 解说端/包装端组成。

::: info 文档约定
本文档描述的是当前仓库的实际实现。设计方案或未来规划请以 `plan.md` 为准，不要将规划中的功能当作已经上线的接口。
:::

## 项目结构

```text
smart-mzcmc/
├── backend/                 # Go + Goravel 后端
│   ├── app/http/            # HTTP 控制器与 JWT 中间件
│   ├── app/models/          # 数据模型
│   ├── app/plugins/         # ntfy、日志归档、CSV 导出插件
│   ├── app/ws/              # WebSocket Hub 与独立服务
│   ├── config/              # Goravel 配置
│   ├── database/migrations/ # SQLite 数据库迁移
│   ├── public/              # 后端托管的首页、管理端和采访端资源
│   ├── routes/              # HTTP 路由
│   └── main.go              # 启动 3000/3002 两个服务；`migrate` 子命令只跑迁移
├── admin/                   # SvelteKit 管理端源码
├── director/                # Flutter 导播端
├── interviewer/             # Flutter 采访端（支持 Web）
├── CommentatorApp/          # .NET 10 WPF 解说端
├── PackagingApp/            # .NET 10 WPF 包装端
├── docs/                    # VitePress 文档（含 plugin-development.md）
├── start.bat                # Windows 本地开发快捷启动
└── plan.md                  # 产品设计与阶段计划
```

## 技术栈与服务边界

| 模块 | 技术 | 默认地址 | 作用 |
| --- | --- | --- | --- |
| HTTP 后端 | Go 1.25 + Goravel 1.18 + SQLite | `http://127.0.0.1:3000` | 登录、项目、权限、锁、日志和采访状态 API |
| 实时服务 | Gorilla WebSocket | `ws://127.0.0.1:3002/ws` | 角色订阅、切台指令、聊天和状态广播 |
| 采访端 Web | Flutter Web 静态文件 | `http://127.0.0.1:3002/interviewer/` | 现场采访点状态操作 |
| 管理端 | SvelteKit + Svelte 5 | 开发时由 Vite 提供 | 管理用户、项目、授权和日志 |
| 导播端 | Flutter | Windows/Android | 获取控制权、发送切台和聊天消息 |
| 解说/包装端 | .NET 10 WPF | Windows 桌面 | 订阅 WebSocket 并展示实时信息 |

线上走反向代理，`zhdb.647382.xyz` 一个域名收拢 3000 和 3002，
配置见「反向代理部署」。**3000 与 3002 在本机启动时都只监听回环**，
对外一律经由 80/443。

### 客户端配置归属

这是最容易踩的地方——四个客户端的地址配置方式**不一样**：

| 端 | 配置文件 | 读取时机 | 换地址要重新编译？ |
| --- | --- | --- | --- |
| 管理后台 | 无（`VITE_API_BASE` 默认空串＝同源） | 构建时 | 否 |
| 解说端 / 包装端 | exe 同目录 `config.json` | **运行期** | 否 |
| 采访端 | `public/interviewer/config.json` | **运行期**（Web 端读 JSON） | 否 |
| 导播端 | `lib/config.dart` | **编译期**（`static const`） | **是** |

采访端为此专门做了运行期覆盖：Web 产物启动时 fetch 同目录 `config.json`，
逐字段校验后覆盖内置默认值，取不到就回落默认值。配置文件写坏不会让应用起不来。

导播端是原生应用，没有可改的外部配置文件，只能重编译。

**协议上三处都只用 WebSocket，不用 HTTP API**：`serverUrl` 字段在采访端、
解说端、包装端里都保留了，但没有任何代码引用它。

后端启动时由 `backend/main.go` 启动两个服务：Goravel HTTP 服务监听 `3000`，WebSocket 服务监听 `3002`。部署和防火墙配置不能只开放 `3000`。

## 开发环境

::: tip 建议
Windows 开发机可以使用仓库根目录的 `start.bat` 快速启动后端和导播端；如果需要单独调试某个客户端，建议使用本指南中的独立启动命令，日志更容易定位。
:::

建议安装以下工具：

- Go `1.25` 或更高版本
- Node.js 与 pnpm（管理端和文档站）
- Flutter SDK `3.12` 对应的 Dart SDK
- .NET SDK `10.0` 与 Windows Desktop Runtime
- Git；可选安装 Air 用于 Go 热重载

首次准备依赖：

```powershell
# 后端
cd backend
go mod download

# 管理端
cd ..\admin
pnpm install

# 导播端
cd ..\director
flutter pub get

# 采访端
cd ..\interviewer
flutter pub get

# 解说端和包装端
cd ..\CommentatorApp
dotnet restore
cd ..\PackagingApp
dotnet restore

# 文档站
cd ..\docs
pnpm install
```

## 后端本地开发

### 配置环境变量

::: danger 不要泄露密钥
开发环境也不要把真实 JWT 密钥、生产数据库或 ntfy topic 写入 Git。复制 `.env.example` 后只在本地 `.env` 中填写敏感值。
:::

复制 `backend/.env.example` 为 `backend/.env`，至少配置：

```dotenv
APP_ENV=local
APP_DEBUG=true
APP_HOST=127.0.0.1
APP_PORT=3000

# 必须修改为随机、足够长的密钥
JWT_SECRET=replace-with-a-random-secret

DB_CONNECTION=sqlite
DB_DATABASE=database/smart-mzcmc.db

# 可选：启用 ntfy 告警插件
NTFY_SERVER=https://ntfy.sh
NTFY_TOPIC=your-topic
```

不要把真实的 `JWT_SECRET`、ntfy topic 或数据库文件提交到仓库。后端配置从环境变量读取，JWT 默认有效期由 `config/jwt.go` 控制。

### 启动后端

```powershell
cd backend
go run .
```

Windows 下也可以使用：

```powershell
cd backend
.\artisan.bat serve
```

如果安装了 Air，可以运行 `air` 进行热重载。仓库根目录的 `start.bat` 会启动 Air 和 Windows 导播端，但它假设本机已安装 `air`、Go 和 Flutter。

### 验证服务

```powershell
Invoke-WebRequest http://127.0.0.1:3000/api/status

# 页面地址
Start-Process http://127.0.0.1:3000/
Start-Process http://127.0.0.1:3000/admin
Start-Process http://127.0.0.1:3002/interviewer/
```

`3002` 的 WebSocket 地址是 `/ws`，采访端静态文件也由同一个服务提供。浏览器访问 `/interviewer/` 时出现 404，通常说明 Web 产物路径不正确或后端启动工作目录不对。

## 各客户端开发

### 管理端

管理端源码位于 `admin/src`。本地开发：

```powershell
cd admin
pnpm dev
```

管理端通过 HTTP API 访问后端；开发时需要在前端配置中使用 `http://127.0.0.1:3000`。发布前执行：

```powershell
pnpm check
pnpm build
```

生产环境的管理页面由 `backend/public/admin/index.html` 提供。如果修改的是 `admin` 源码，需要将构建产物按项目现有发布流程复制到后端的 `public/admin/`，否则后端页面不会更新。

### 导播端

导播端的服务器地址在 `director/lib/config.dart`：

```dart
class AppConfig {
  static const String serverUrl = 'http://127.0.0.1:3000';
  static const String wsUrl = 'ws://127.0.0.1:3002/ws';
}
```

本地运行：

```powershell
cd director
flutter pub get
flutter run -d windows
```

主要代码位置：

- `lib/screens/login_screen.dart`：登录
- `lib/screens/home_screen.dart`：项目选择、控制权、消息和切台操作
- `lib/services/api_service.dart`：HTTP API 调用
- `lib/services/websocket_service.dart`：WebSocket 连接与消息处理
- `lib/widgets/slide_to_confirm.dart`：滑动确认
- `lib/widgets/interview_status_bar.dart`：采访状态
- `lib/widgets/chat_panel.dart`：内部通信

### 采访端

采访端也使用 `serverUrl`/`wsUrl` 配置，状态值必须使用后端支持的四种值：`ready`、`preparing`、`not_ready`、`offline`。

```powershell
cd interviewer
flutter pub get
flutter run -d chrome

# 构建 Web 版本
flutter build web
```

采访端 Web 产物由后端 `3002` 服务在 `/interviewer/` 路径下托管。`main.go` 按以下优先级挑第一个存在的目录（见 `app/ws/server.go` 的 `resolveWebDir`）：

1. `<二进制所在目录>/public/interviewer` —— CI 在后端仓库内构建后落盘，随发布包分发，部署机上无需采访端源码；
2. `<源码根>/public/interviewer` —— 本地在后端仓库内直接 `go run .` 时命中；
3. `<源码根>/interviewer/build/web` —— 本地开发直接 `flutter build web` 的产物，无需拷贝。

所以本地开发时既可以直接 `flutter build web` 后重开后端，也可以按下面的方式拷贝到 `public/interviewer` 以模拟线上布局：

```powershell
cp -r interviewer/build/web/* backend/public/interviewer/
```

若 `/interviewer/` 返回 404，先看后端启动日志里的 `[WS] 采访端 Web: <路径>`，它会打印实际选中的目录。

### 解说端与包装端

两个桌面端都是 .NET 10 WPF 工程，连接参数位于各自目录的 `config.json`。解说端的角色为 `commentator`，包装端的角色为 `packaging`：

```json
{
  "ServerUrl": "http://127.0.0.1:3000",
  "WsUrl": "ws://127.0.0.1:3002/ws",
  "ProjectId": 1,
  "Role": "commentator"
}
```

编译运行：

```powershell
cd CommentatorApp
dotnet run

cd ..\PackagingApp
dotnet run
```

发布 Windows 单文件版本：

```powershell
dotnet publish -c Release -r win-x64 --self-contained true
```

发布后的 `config.json` 必须与程序放在同一目录。修改连接地址、项目 ID 或角色时，不要把配置写死到 C# 源码中。

## 通信协议

::: warning 修改协议前先联调
WebSocket 消息会同时影响后端 Hub、导播端、采访端、解说端和包装端。修改 `type` 或 `payload` 时，必须同步更新发送方、接收方和协议文档。
:::

### HTTP API

除公开接口外，其余 API 需要在请求头中携带：

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

核心路由：

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| `GET` | `/api/status` | 否 | 服务状态 |
| `POST` | `/api/auth/login` | 否 | 登录并获取 JWT |
| `POST` | `/api/auth/register` | **视状态而定** | 创建用户，见下文 |
| `GET` | `/api/auth/profile` | JWT | 当前用户 |
| `GET/POST/PUT/DELETE` | `/api/admin/*` | JWT + **admin** | 用户、项目、授权管理 |
| `POST/GET` | `/api/locks/:projectId/*` | JWT | 获取、释放、续期和查询控制权 |
| `GET` | `/api/messages/:projectId` | JWT | 查询项目消息 |
| `GET` | `/api/logs` | JWT | 按项目或类型查询日志 |
| `GET/POST` | `/api/interview/*` | 否 | 查询和更新采访状态 |
| `GET` | `/api/plugins` | JWT | 查看插件 |
| `GET` | `/api/projects/:projectId/stats` | JWT | 项目统计 |
| `POST` | `/api/logs/export` | JWT + **admin** | 导出 JSON 日志 |
| `POST` | `/api/logs/export/csv` | JWT + **admin** | 导出 CSV 日志 |
| `POST` | `/api/logs/cleanup` | JWT + **admin** | 清理旧日志 |

### 权限模型

两层校验，缺一不可：

| 中间件 | 位置 | 作用 |
| --- | --- | --- |
| `middleware.Jwt()` | `routes/web.go` 的整个认证组 | 解析并校验令牌，写入 `user_id` |
| `middleware.RequireRole("admin")` | `/api/admin/*` 与 `/api/logs/{export,cleanup}` | 查库比对角色 |

**`Jwt` 只回答「令牌是否有效」，不回答「持有者是谁」。** 早期版本只在
管理接口上挂了 `Jwt`，结果任何登录用户（包括最低权限的导播）都能
列出全部用户与项目、增删项目、分配权限。

两个实现细节，改动时务必保留：

1. **`RequireRole` 每次查库，不信任令牌里的角色。** 令牌有效期 60 分钟，
   如果把角色写进 claims，管理员在后台降权后对方要等令牌过期才生效。
   每次多一次 `SELECT role FROM users WHERE id = ?` 换来降权即时生效。
2. **查库必须用 `models.User` 承载结果。** Goravel 的 ORM 依赖模型元数据
   解析字段映射，查进匿名 `struct{Role string}` 会直接失败，
   表现为所有请求都返回 401「用户不存在」。

### 中断响应必须链式调用

```go
// 正确
ctx.Response().Json(401, map[string]any{"error": "..."}).Abort()

// 错误：会被 gin 重置成 400 + 空 body，客户端拿不到任何错误信息
ctx.Response().Json(401, map[string]any{"error": "..."})
ctx.Request().Abort()
```

`app/http/middleware/jwt.go` 里所有中断响应都用了链式写法。
`routes/staticSite.go` 也有同样的坑（那里表现为「200 + 空 body」）。

### 用户创建：唯一的双模式接口

`POST /api/auth/register` 必须挂在公开路由上（全新部署时还没有任何用户，
不可能有登录态），所以它自己承担了模式判断：

| 系统状态 | 需要认证 | `role` 字段 | 结果 |
| --- | --- | --- | --- |
| 用户表为空 | 否 | 被忽略 | 固定 `admin` |
| 已有用户 | 需要 `admin` | 仅 `admin` / `director` | 按传入值 |

实现要点：

- 判空用 `Count()` 而不是 `First()`。`First` 在结果为空时是否返回
  `ErrRecordNotFound` 依赖驱动实现，不可靠；`Count` 语义没有歧义。
- 鉴权放在参数校验**之前**。这是个公开路由，先校验参数等于把密码策略
  和用户名规则变成匿名可探测的预言机。
- `AuthController` 拿不到 JWT 中间件写入的上下文，所以
  `requireAdmin` 自己解析一次 `Authorization` 头。

参数约束：密码 ≥6 位，用户名 ≤64 字符且仅限字母、数字、`_`、`.`、`-`、中文。

⚠️ **运维风险**：在用户表为空之前，任何能访问 3000 端口的人都能抢先
注册管理员。部署后应立刻创建第一个管理员。

### WebSocket 连接

连接格式：

```text
ws://<host>:3002/ws?project_id=1&role=director&token=<JWT>
```

参数说明：

| 参数 | 说明 |
| --- | --- |
| `project_id` | 必填，项目 ID |
| `role` | `director`、`commentator`、`packaging` 或 `interviewer` |
| `token` | `director`/`admin` 必填，其他角色按当前客户端配置连接 |
| `user_id` | 可选，普通客户端标识 |
| `point_code` | 采访点编码，采访端使用 |

消息统一结构：

```json
{
  "type": "shot_state",
  "project_id": 1,
  "sender_id": 1,
  "payload": {
    "current": "100米",
    "next": "跳远"
  },
  "timestamp": 1789000000000
}
```

当前重要消息类型：

- `shot_state`：**唯一的切台消息**。导播端每次切台都上报一份完整状态——
  `current` 是当前正在播送的机位，`next` 是即将切过去的机位；
  `next` 为空串表示已确认切完、画面就是 `current`。
  转发给解说端和包装端，需要持有控制权。
- `chat`：项目内消息广播。`{"message":"heartbeat"}` 是保活心跳，
  后端在入库之前就丢弃：既不写入 `messages` 表，也不计入项目消息统计，
  更不会转发给同项目其他端。
- `interview_status`：采访端状态变更，转发给导播端和包装端。
- `lock_update`：控制权变化。
- `system`：连接成功、权限错误等系统消息。

> **协议变更记录**：`next_shot` 与 `confirm_switch` 已合并为 `shot_state`。
> 后端仍能识别这两个旧类型，但只回一条 `system` 错误并丢弃，不会广播。
> 这样接收端直接读 `current` 即可，不必自己推断「正在播送」；
> 旧客户端升级前会收到明确的错误提示，而不是静默失效。

新增消息类型时，应同时更新后端 Hub、发送方客户端、接收方客户端以及本指南中的协议说明，并补充至少一个联调场景。

## 控制权与业务规则

控制权以项目为粒度，同一项目同时只能存在一个有效锁：

1. 导播连接 WebSocket 时，如果项目没有有效锁，会尝试自动获取。
2. HTTP `acquire` 可重复调用；如果当前用户已持有锁，会续期并返回成功。
3. 其他导播抢锁时返回 `409`，响应中包含当前持有者和过期时间。
4. 锁默认有效期为 90 秒，导播端需要定期调用 `heartbeat`。
5. `shot_state`（切台状态）只接受**持有控制权的导播**。
   非导播角色（解说端 / 包装端 / 采访端）上报会被拒绝并收到 `system` 提示；
   导播未持锁同样被拒。被拒的消息会照常写入 `messages` 表并打服务端日志，
   因为那是一次真实的越权尝试，属于审计线索。
6. 导播断开时，后端会释放该用户在该项目上的锁并广播更新。

修改锁逻辑时必须重点验证：双导播同时抢锁、持有者心跳、锁过期后重新获取、持有者断线和非持有者推送这五种情况，外加「非导播角色伪造 `shot_state` 被拒」。

## 数据模型与迁移

核心表位于 `backend/database/migrations/`：

| 表 | 用途 |
| --- | --- |
| `users` | 用户、密码哈希和角色 |
| `projects` | 直播项目 |
| `user_projects` | 用户与项目授权关系 |
| `project_locks` | 项目控制权及过期时间 |
| `interview_status` | 各采访点当前状态 |
| `messages` | WebSocket 消息和操作日志 |

新增字段或表时，新增迁移文件，不要直接修改已经执行过的迁移。迁移后同步更新对应的 `app/models`、控制器请求/响应和客户端模型。开发数据库默认为 `backend/database/smart-mzcmc.db`，测试破坏性迁移前先备份该文件。

### 执行迁移

```sh
cd backend
go run . migrate
```

`migrate` 是本项目自带的子命令，只跑数据库迁移、不启动任何服务。
Goravel 的 `migrate` 原本是 console 命令，但本项目没有接入 console kernel，
所以 `main.go` 里直接遍历 `bootstrap.Migrations()` 逐个调 `Up()`。

**所有迁移都必须写成幂等的**，因为这里没有 `migrations` 记账表：

- 建表类迁移用 `if !facades.Schema().HasTable(...)` 守卫；
- 数据清理类迁移（`DELETE`）天然可重复执行；
- 不可逆的迁移，`Down()` 里不要尝试恢复数据，写明原因即可
  （参考 `20260926000001_purge_heartbeat_messages`）。

已有迁移：

| 迁移 | 作用 |
| --- | --- |
| `20210101000001_create_jobs_table` | Goravel 内置队列表 |
| `20260901000001` ~ `20260901000006` | users / projects / user_projects / project_locks / interview_status / messages |
| `20260926000001_purge_heartbeat_messages` | 清理历史心跳消息（见下） |

### 心跳清理迁移

早期 `hub` 在写 `messages` 表**之后**才过滤 heartbeat，导致每个客户端每 10 秒一条心跳全部落库。
1401 条历史记录里 1251 条是心跳，日志审计页和 `message_count` 基本被噪音淹没。

现在心跳在入库前就被丢弃（`app/ws/hub.go` 的 `IsHeartbeat`），
`20260926000001_purge_heartbeat_messages` 负责清掉历史存量：

- 识别条件与 `IsHeartbeat` 一致：`type = 'chat'` 且 `content` 恰为 `{"message":"heartbeat"}`。
  `content` 是 TEXT 存的原始 JSON，这里用**等值比较**而非模糊匹配，
  避免误删正文里恰好提到 heartbeat 的消息。
- 该迁移不可逆，`Down()` 是空实现。删掉的是噪音，没有保留价值。
- 执行后 `message_count` 从约 1401 降到 153。

> 新增数据清理迁移前，先用只读查询确认命中行数，避免误删。

## 插件系统

插件代码在 `backend/app/plugins`，当前注册：

| 插件 | 作用 | 配置 |
| --- | --- | --- |
| `ntfy-alert` | 向 ntfy 推送事件告警 | `NTFY_SERVER` + `NTFY_TOPIC`（都配才启用） |
| `log-archive` | 定期清理过期日志 | `PLUGIN_LOG_RETENTION_DAYS`、`PLUGIN_LOG_CHECK_INTERVAL` |
| `csv-export` | 提供日志 JSON / CSV 导出接口 | `PLUGIN_CSV_EXPORT_ENABLED` |

配置项集中在 `backend/config/plugins.go`（环境变量驱动），
`main.go` 的 `initPlugins()` 负责装配。

两个设计约定：

1. **停用的插件依然会注册。** 这样 `GET /api/plugins` 能返回
   `enabled: false` + `reason` 说明停用原因，后台「插件与统计」页直接可见。
   「配了但没生效」不应该只能翻日志才查得到。
2. **机密脱敏后输出。** `Descriptor.Config` 里的 ntfy topic 经 `MaskSecret`
   处理成 `su****yz`，明文不会进 API 响应。

插件的事件、并发约定、配置写法、后台展示契约，详见
[插件开发指南](./plugin-development.md)。新增事件类型时，请同步更新
`Event` 结构体注释、`NtfyAlert.OnEvent` 的 switch、插件开发指南的事件表格，
以及本节的协议说明。

## 测试与联调

### 后端

```powershell
cd backend
go test ./...
go vet ./...
```

已有测试位于 `backend/tests`。涉及控制权、认证、消息分发和数据迁移的修改，至少运行完整后端测试。

### 管理端

```powershell
cd admin
pnpm check
pnpm test
pnpm build
```

### 客户端

```powershell
cd director
flutter analyze
flutter test

cd ..\interviewer
flutter analyze
flutter test

cd ..\CommentatorApp
dotnet build

cd ..\PackagingApp
dotnet build
```

### 推荐联调顺序

::: tip 联调原则
先验证单个服务的 HTTP 健康状态，再验证单条 WebSocket 链路，最后进行双导播抢锁、断线接管和多客户端广播测试。
:::

1. 启动后端，确认 `/api/status` 返回成功。
2. 注册两个导播用户，创建一个项目并分配权限。
3. 分别启动两个导播端，验证只有一个导播获得控制权。
4. 启动解说端和包装端，确认它们订阅同一个 `ProjectId`。
5. 启动采访端，切换四种状态，确认导播端和包装端收到广播。
6. 从导播端发送 `next_shot`、`confirm_switch` 和 `chat`，检查接收端显示与日志。
7. 关闭持有控制权的导播端，确认锁释放，另一导播可以接管。
8. 查询日志并验证 JSON/CSV 导出结果。

## 常见问题

### WebSocket 连接失败

依次检查：后端 `3002` 服务是否启动、防火墙是否开放 `3002`、客户端是否使用 `ws://<IP>:3002/ws`、项目 ID 是否大于 0，以及导播端 JWT 是否有效。

### 返回“JWT 密钥未配置”

确认运行后端的工作目录是 `backend`，并且 `.env` 中存在非空 `JWT_SECRET`。修改环境变量后需要重启后端。

### 导播端提示没有控制权

调用 `/api/locks/:projectId/status` 查看持有者和过期时间；必要时让当前持有者主动释放或等待 90 秒过期。不要直接删除数据库锁来代替正常流程，除非是在恢复故障。

### 采访端页面打不开

确认 `interviewer/build/web` 已生成，并检查 `backend/app/ws/server.go` 使用的静态目录。部署到其他路径后，必须同步调整后端静态文件目录和客户端 URL。

### 配置修改没有生效

桌面端读取的是发布目录旁边的 `config.json`，不是源码目录中的副本。Flutter 的服务器地址来自 `lib/config.dart`，修改后需要重新运行或重新构建应用。

## 提交前检查清单

- [ ] 新增 API 已注册路由、校验参数并补充认证说明。
- [ ] 新增 WebSocket 消息已定义 payload，并验证所有相关角色。
- [ ] 数据结构变更已新增迁移、模型和客户端类型。
- [ ] 没有提交 `.env`、JWT 密钥、数据库备份或发布目录中的临时文件。
- [ ] 后端执行 `go test ./...` 和 `go vet ./...`。
- [ ] Flutter 执行 `flutter analyze` 和 `flutter test`。
- [ ] 管理端执行 `pnpm check`、`pnpm test` 和 `pnpm build`。
- [ ] .NET 两个项目均执行 `dotnet build`。
- [ ] 文档站执行 `pnpm docs:build`。
