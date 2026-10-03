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
│   ├── app/setup/           # 初始化：补 .env 密钥、判定是否未初始化、写配置
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

**四个客户端现在都会发 HTTP 请求。** 解说端、包装端与采访端要用
`ServerUrl`（采访端由 `wsUrl` 推导）调 `POST /api/auth/login` 换令牌，
再把令牌拼进 WebSocket 查询串——开启 `REQUIRE_PROJECT_MEMBERSHIP` 之后，
没有令牌的连接会在握手阶段被拒。凭据留空时不登录，行为与开启之前一致。

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

# 可选：采访端掉线扫描（默认 60s 扫一次，90s 无消息判离线）
PLUGIN_PRESENCE_SCAN_INTERVAL=60s
PLUGIN_PRESENCE_TIMEOUT=90s

# 可选：强制校验项目成员身份。默认 false，此时只记日志不拦截
REQUIRE_PROJECT_MEMBERSHIP=false

# 可选：谁能登录管理后台网页（前端专用登录入口）。默认 leader
ADMIN_MIN_ROLE=leader
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

采访端也使用 `wsUrl` 配置，状态值必须使用后端支持的四种值：`ready`、`preparing`、`not_ready`、`offline`。

HTTP 地址不单独配，由 `wsUrl` 推导（`ws://host:3002/ws` → `http://host:3002`）——两者本来就指向同一台服务，多一个字段就多一次填错的机会。

```powershell
cd interviewer
flutter pub get
flutter run -d chrome

# 构建 Web 版本
flutter build web
```

采访端的行为有两个容易被忽略的点：

- **它会在三个时机主动上报 `offline`**：页面切到后台、WebSocket 断开、
  心跳超时前。前两个不是「优化」而是必需——记者把浏览器切走或走出 WiFi
  覆盖范围时，服务端的 TCP 连接看起来仍然正常。
- **WebSocket 断开后改走 HTTP 上报**（`POST /api/interview/status`），
  这是断网时唯一还能到达服务端的通道。

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
  "Role": "commentator",
  "Username": "",
  "Password": ""
}
```

`Username` / `Password` 是登录账号，**留空表示不登录**：这样在没有启用项目成员
校验的部署上，它们的行为与改动前完全一致。开启 `REQUIRE_PROJECT_MEMBERSHIP`
之前必须把账号填上，否则 WebSocket 会在握手阶段被拒，而界面上只表现为
「一直连接中...」——所以登录失败的原因会被透出到界面上。

两个端每次重连都会重新登录一次：JWT 默认 60 分钟过期，长时间运行的客户端
拿旧令牌重连会一直失败。

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

发布后的 `config.json` 必须与程序放在同一目录。修改连接地址、项目 ID、角色或账号时，不要把配置写死到 C# 源码中。

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
| `GET` | `/api/health` | 否 | 健康检查（真的查库，不可用返回 503） |
| `POST` | `/api/auth/login` | 否 | 登录并获取 JWT（原生客户端走这个） |
| `POST` | `/api/auth/admin-login` | 否 | 登录管理后台网页，额外校验 `authz.admin_min_role` |
| `POST` | `/api/auth/register` | **视状态而定** | 创建用户，见下文 |
| `GET` | `/api/auth/bootstrap` | 否 | 是否仍未初始化 |
| `GET/PUT` | `/api/auth/profile` | JWT | 读取 / 修改当前用户资料 |
| `PUT` | `/api/auth/password` | JWT | 改密码（旧令牌立即失效） |
| `GET` | `/api/auth/permissions` | JWT | 当前账号生效的权限名清单 |
| `GET` | `/api/roles` | JWT | 角色清单 |
| `GET/POST/PUT/DELETE` | `/api/admin/*` | JWT + 具名权限 | 用户、项目、机位、授权、审计，逐条权限见下表 |
| `GET/POST` | `/api/system/*` | JWT + `system.maintain` | 系统信息、运行指标、在线更新（仅超级管理员） |
| `POST/GET` | `/api/locks/:projectId/*` | JWT + 成员（写操作另加 `switch.operate`） | 获取、释放、续期和查询控制权 |
| `GET` | `/api/messages/:projectId` | JWT + 成员 | 查询项目消息 |
| `GET` | `/api/logs` | JWT + `log.view` | 按项目/类型/发件人/时间查询日志 |
| `GET` | `/api/projects` | JWT | 当前账号有权访问的项目（按 `user_projects` 收窄） |
| `GET` | `/api/projects/:projectId/cameras` | JWT + 成员 | 机位预设 |
| `GET` | `/api/projects/:projectId/shot-cuts` | JWT + 成员 | 切台时间线与报表 |
| `GET` | `/api/projects/:projectId/stats` | JWT + 成员 | 项目统计 |
| `GET/POST` | `/api/interview/*` | 否 | 查询和更新采访状态 |
| `GET` | `/api/plugins` | JWT | 查看插件 |

`/api/admin/*` 与 `/api/system/*` 逐条对应的权限（**接口准入看具名权限，不再比等级**）：

| 路径 | 权限 |
| --- | --- |
| `GET /api/admin/users` | `user.view` |
| `DELETE /api/admin/users/:id`、`PUT /api/admin/users/:id/role` | `user.manage` |
| `GET/POST/PUT/DELETE /api/admin/projects*` | `project.manage` |
| `POST /api/admin/assign`、`POST /api/admin/revoke`、`GET /api/admin/users/:id/projects` | `project.member` |
| `GET /api/admin/audit-logs` | `audit.view` |
| `GET /api/logs` | `log.view` |
| `POST /api/logs/export`、`POST /api/logs/export/csv` | `log.export` |
| `POST /api/logs/cleanup` | `log.cleanup` |
| `POST /api/locks/:projectId/{acquire,release,heartbeat}` | `switch.operate` |
| `GET /api/system/*` | `system.maintain` |

权限名、持有者与策略文件见 `app/rbac/policy.csv`；`interview.manage` 与 `project.view`
已在策略里声明但**尚未挂到任何路由**（前者是后端还没有采访点增删改接口，后者是
非管理端项目视图由成员校验负责）。

> **`/api/projects` 与 `/api/admin/projects` 不是一回事。** 前者给导播端用，
> 只返回当前账号有权访问的项目（且一个项目都没被授权时会退回全部，以免存量部署
> 看到空下拉框）；后者挂 `project.manage`，**完全不过滤**，返回全量项目详情。
> 导播端曾经误用后者，结果项目下拉框恒为空——因为导播调它一律 403。

### 权限模型

三层校验，缺一不可：

| 中间件 | 位置 | 作用 |
| --- | --- | --- |
| `middleware.Jwt()` | `routes/web.go` 的整个认证组 | 解析并校验令牌，写入 `user_id` |
| `middleware.RequirePermission(...)` | `/api/admin/*`、`/api/system/*`、`/api/logs`、切台的三个写接口 | 查库拿到角色，再查 `app/rbac` 的权限对照表 |
| `middleware.RequireProjectMember()` | 带 `projectId` 的业务接口 | 查 `user_projects` 比对项目成员身份 |

> **`routes/web.go` 里已经没有任何一条路由挂 `RequireRole`。**
> `TestPermissionRoutes_不再有等级门槛` 会把这一点钉住，有人挂回去直接测试红。
> `middleware/permission.go` 里的「不信任令牌里的角色」「用 `models.User` 承载查询
> 结果」等约束对 `RequirePermission` 同样成立，改动时一并看那个文件。

**准入与「能不能操作某个人」是两件事，不要合并。** 前者看具名权限（策略在
`app/rbac/policy.csv`），后者看等级（`models.Role.AtLeast`，留在
`controllers/authz.go` 的 `decideRoleChange` / `decideDeleteUser`）。混着来就会
出现「后勤等级高于管理员，于是能删掉导播账号」这种坑。`user.manage` 与
`project.manage` 这类权限只回答「能不能进这个接口」，进去之后能不能操作**这个人**
仍由控制器判断：不能操作权限不低于自己的、不能自降权、不能动最后一个超管。

**等级已经不再是准入依据。** 等级只能表达「一条直线」，表达不了「负责人能看、
不能改」，也表达不了「导播能抢锁、负责人不能」——`switch.operate` 就是后者的活
例子。所以角色与权限的对应关系走显式清单（`p, <角色>, <权限>`），不走继承链：
漏补一行的后果是该角色少一项能力（安全侧），而不是多一项（危险侧）。

**`Jwt` 只回答「令牌是否有效」，不回答「持有者是谁」。** 早期版本只在
管理接口上挂了 `Jwt`，结果任何登录用户（包括最低权限的导播）都能
列出全部用户与项目、增删项目、分配权限。

**项目成员校验也不属于这一套。** `user_projects` 表从第一天就在，但此前只被管理
接口增删查，从未参与任何鉴权判断：后勤账号能看到全部项目列表，控制权接口只从 URL
取项目编号，WebSocket 知道 `project_id` 就能监听整个项目的实时消息。

`RequireProjectMember()` 就是补这一层。它有两个必须记住的性质：

1. **管理员及以上绕过**：他们本来就要管理所有项目，逐个配授权没有意义。
2. **受 `REQUIRE_PROJECT_MEMBERSHIP` 控制，默认关闭**。关闭时只把「本来会被
   拦下的请求」写进日志而不拦截——存量部署未必给每个人都配过授权，直接打开
   会让现场当场连不上。打开前必须先把三个客户端的登录凭据配好
   （解说端 / 包装端 / 采访端），否则它们的 WebSocket 会在握手阶段被拒。

两个实现细节，改动时务必保留：

1. **`RequirePermission` 每次查库，不信任令牌里的角色。** 令牌有效期 60 分钟，
   如果把角色写进 claims，管理员在后台降权后对方要等令牌过期才生效。
   每次多一次 `SELECT role FROM users WHERE id = ?` 换来降权即时生效。
2. **查库必须用 `models.User` 承载结果。** Goravel 的 ORM 依赖模型元数据
   解析字段映射，查进匿名 `struct{Role string}` 会直接失败，
   表现为所有请求都返回 401「用户不存在」。

::: warning 路由中间件只能挂在 Group 上
Goravel 的 `Get(path, handler)` 返回 `Action`，而 `Action` 没有 `Middleware()`
方法。要给单条路由加中间件，得用 `Prefix(...).Middleware(...).Group(...)`。
另外 `RequirePermission` 会把 `models.User` 写进 `ctx` 的 `"user"` 键，而
`Jwt` 只写 `"user_id"`——**在没有 `RequirePermission` 的路由上调用 `actorFrom(ctx)`
会一律返回 401「未提供认证令牌」**。这类路由要自己按 `user_id` 查库
（参考 `ProjectController.actorForProjectList`）。
:::

::: warning 策略在文件里，不在数据库
角色 → 权限写在 `app/rbac/policy.csv`，由 `go:embed` 随程序加载：**改权限要改文件
并重启，没有在线编辑**。加载失败时 `rbac.Can` 一律返回 false，即全部拒绝——
宁可当场不可用，也不要在没有策略的情况下放行。`system.maintain` 与 `super_admin`
是受保护的（不可撤销、只授予超管），理由与改动入口见 `app/rbac/protect.go`。
改完策略记得跑 `go test ./app/rbac/... ./routes/...`：`rbac_test.go` 的迁移矩阵与
`permission_routes_test.go` 的挂载清单会挡住写错的行。
:::

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
| 用户表为空 | 否 | 被忽略 | 固定 `super_admin` |
| 已有用户 | 需要持有 `user.manage`（admin / super_admin） | 八种角色之一，且不高于调用者 | 按传入值 |

> 注意是 `super_admin` 而不是 `admin`：只有超级管理员能授予超管角色，
> 引导出来的若是管理员，就再没有人能创建超管，系统会停在一个「谁也管不了谁」
> 的状态——系统更新、角色调整全都做不了。

> 常态分支的判据是 `rbac.Can(actor.Role, rbac.PermUserManage)`，不是角色名。
> 它挂不进 `RequirePermission`——这是公开路由，引导模式恰恰没有令牌，所以只能
> 在控制器里手写一道（`resolveActor` 自己解析 `Authorization` 头）。
> **这条校验不能省**：早先只校验 `guardGrant`（不能授予高于自己的角色），
> 于是负责人（等级 40，不持有 `user.manage`）能建出另一个负责人，
> 等于绕过了「只有管理员及以上能增删账号」这条矩阵规则。引导模式不受影响。

实现要点：

- 判空用 `Count()` 而不是 `First()`。`First` 在结果为空时是否返回
  `ErrRecordNotFound` 依赖驱动实现，不可靠；`Count` 语义没有歧义。
- 鉴权放在参数校验**之前**。这是个公开路由，先校验参数等于把密码策略
  和用户名规则变成匿名可探测的预言机。

参数约束：密码 ≥6 位，用户名 ≤64 字符且仅限字母、数字、`_`、`.`、`-`、中文。

⚠️ **运维风险**：在用户表为空之前，任何能访问 3000 端口的人都能抢先
注册超级管理员。部署后应立刻创建第一个管理员。

另外两处准入**仍然是等级**，因为它们不属于路由守卫：

- `POST /api/auth/admin-login`（管理后台网页专用登录）校验 `authz.admin_min_role`，
  默认 `leader`——只有负责人及以上能进后台，原生客户端走 `/api/auth/login`
  不受限制。配置项写错（非法角色名）时退回 `leader` 并记日志。
- `ProjectController.List` 对管理员及以上返回全部项目，对其他人按 `user_projects`
  收窄；**一个项目都没被授权的人退回全部**，否则存量部署会看到空下拉框。

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
| `token` | `director`/`admin` 必填；开启 `REQUIRE_PROJECT_MEMBERSHIP` 后所有角色都必填 |
| `user_id` | 可选，普通客户端标识 |
| `point_code` | 采访点编码，采访端使用 |

令牌校验与 HTTP 侧同一套规则（HMAC 算法、查库确认用户还在、比对
`token_version`）。三处验签点中只要有一处漏了算法检查，「把 alg 改成 none」
就能绕过——WebSocket 这处曾经就是漏的。

连接建立后的第一条消息是 `system` 类型，**带上项目当前的切台状态**：

```json
{
  "type": "system",
  "project_id": 1,
  "payload": {
    "message": "连接成功",
    "online_count": 4,
    "current_shot": "100米",
    "next_shot": "",
    "state_available": true
  },
  "timestamp": 1789000000000
}
```

没有它，中途连上来的解说端/包装端会一直停在「等待导播指令」，直到下一次切台；
重连同理——`ScheduleReconnect` 只是重连，没有「把当前状态给我」这一步。

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
  通过校验后，后端会顺手做两件事：把状态 upsert 进 `project_states`，
  以及往 `shot_cuts` 写一行（**只在 `current` 真的变了时写**，预告不写，
  否则平均停留时长会被砍半）。
- `chat`：项目内消息广播。`{"message":"heartbeat"}` 是保活心跳，
  后端在入库之前就丢弃：既不写入 `messages` 表，也不计入项目消息统计，
  更不会转发给同项目其他端。心跳的唯一作用是刷新客户端的
  `LastSeen`——掉线扫描判断的就是它。
- `interview_status`：采访端状态变更。**后端会先落库再广播**，两件事都要做：
  只广播不落库的话，导播端切换项目时调 `GET /api/interview/:projectId`
  拿到的是空列表；只落库不广播的话，导播屏幕上要等刷新才更新。
- `lock_update`：控制权变化，`payload.reason` 为 `disconnect` 或 `timeout`。
- `system`：连接成功、权限错误等系统消息。连接成功的那条带 `current_shot`。

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
   过期锁由后台扫描清理并广播 `lock_update(reason=timeout)`——此前只有
   「有人查询时」才会顺手删掉，没人查就永远不删，`lock_timeout` 事件
   从未被触发过。
5. `shot_state`（切台状态）只接受**持有控制权的导播**。
   非导播角色（解说端 / 包装端 / 采访端）上报会被拒绝并收到 `system` 提示；
   导播未持锁同样被拒。被拒的消息会照常写入 `messages` 表并打服务端日志，
   因为那是一次真实的越权尝试，属于审计线索。
6. 导播断开时，后端会释放该用户在该项目上的锁并广播更新。
7. 采访端断开时，后端会把它在该项目的采访点状态改成 `offline` 并广播，
   同时发一条 `interview_offline` 事件。后台还会每隔
   `PLUGIN_PRESENCE_SCAN_INTERVAL` 扫一遍「连接还在但长时间没有消息」的客户端
   （阈值 `PLUGIN_PRESENCE_TIMEOUT`），把失联的采访点标成离线——记者走出
   WiFi 覆盖范围时 TCP 要等很久才报错，只靠断开事件是发现不了的。

修改锁逻辑时必须重点验证：双导播同时抢锁、持有者心跳、锁过期后重新获取、持有者断线和非持有者推送这五种情况，外加「非导播角色伪造 `shot_state` 被拒」。

## 数据模型与迁移

核心表位于 `backend/database/migrations/`：

| 表 | 用途 |
| --- | --- |
| `users` | 用户、密码哈希、角色、令牌版本 |
| `projects` | 直播项目、日程、场地、状态与模式 |
| `user_projects` | 用户与项目授权关系（`RequireProjectMember` 的判定依据） |
| `project_locks` | 项目控制权及过期时间 |
| `project_states` | 项目「当前」的切台状态，一个项目一行（历史在 `shot_cuts`） |
| `shot_cuts` | 切台流水：时间线、机位/时段筛选、次数与停留时长、分场统计 |
| `project_cameras` | 机位预设，导播端按 `sort_order` 渲染按钮 |
| `interview_status` | 各采访点当前状态 |
| `messages` | WebSocket 消息和操作日志（协调日志） |
| `audit_logs` | 操作审计：谁改了什么、从哪个 IP |

> `messages` 与 `audit_logs` 是两回事，管理后台也分两个 Tab 展示：
> 前者是「谁切了台、谁发了内部消息」，后者是「谁改了别人的角色、谁清了日志」。
> 之前那个叫「日志审计」的页面显示的其实是 `messages`，名字在骗人。

新增字段或表时，新增迁移文件，不要直接修改已经执行过的迁移。迁移后同步更新对应的 `app/models`、控制器请求/响应和客户端模型。开发数据库默认为 `backend/database/smart-mzcmc.db`，测试破坏性迁移前先备份该文件。

### 首次启动的初始化流程

全新部署时数据库文件不存在，后端要能自己把系统拉到可用状态，涉及三个文件：

| 文件 | 职责 |
| --- | --- |
| `app/setup/env.go` | 逐行解析/改写 `.env`（保留注释与行序），生成随机密钥 |
| `app/setup/setup.go` | `init()` 补密钥并采样数据库是否存在；`NeedsSetup()` 判定是否未初始化；`WriteAppConfig()` 写向导提交的配置 |
| `routes/setupGate.go` | 全局中间件：初始化模式下拦住除 `/api/setup/*`、`/api/health` 外的所有 API，首页 302 到 `/admin/setup` |

三个容易踩的点：

1. **`app/setup` 被 `config/setup.go` 空导入，不能删。** Goravel 在配置对象初始化
   阶段就校验 `APP_KEY`，缺失直接 `os.Exit(0)`——而 `config/*.go` 的 `init()`
   会触发这次初始化，早于 `main()`。准备代码必须放在被 `config` 导入的包的
   `init()` 里才跑得到。
2. **数据库是否存在必须在框架打开连接之前采样。** SQLite 连一下就建出空文件，
   之后再 stat 永远得到「存在」。所以 `markStartup()` 在 `init()` 里执行。
3. **调试时先删掉 `database/smart-mzcmc.db`** 才能重新进入初始化模式；
   只想看向导页不想重置数据，就手工把 `users` 表清空也行（用户表为空同样算未初始化）。

### 迁移什么时候跑

**每次启动都会跑一遍全部迁移**，不需要任何额外命令。执行点在
`bootstrap.Boot()` 的 `WithCallback` 里（`bootstrap/app.go`），排在 `rbac.Bootstrap()`
之前 —— 权限策略表本身就是一条迁移建的，顺序反过来的话每次全新启动都会先撞一次
「no such table」再退回内嵌 `policy.csv`。

仍然保留两条手动入口，用于排障：

```sh
cd backend
go run . migrate          # 只跑迁移、不启动任何服务，可在服务运行时安全执行
```

Goravel 的 `migrate` 原本是 console 命令，本项目没有接入 console kernel，
所以 `bootstrap.RunMigrations()` 直接遍历 `bootstrap.Migrations()` 逐个调 `Up()`。
初始化向导也复用同一个函数（`main.go` 里通过 `setup.SetMigrator` 注入到
`app/setup`，避免 `bootstrap → routes → controllers → bootstrap` 循环依赖）。

**迁移失败时服务拒绝启动**，日志里写明是哪一条迁移、原始错误、以及按实际发生频率
排序的处理办法。最常见的原因不是数据库坏了，而是**有第二个实例在同时启动或执行
`migrate`** —— 那会撞上「表已存在」。跨进程锁（`bootstrap/lock.go`）已经挡住了
这个场景，所以真遇到迁移失败时，先确认没有第二个实例再往下查。

### 为什么所有迁移都必须幂等

因为**每次启动都全量重跑，而且没有 `migrations` 记账表**：

- 建表类迁移用 `if !facades.Schema().HasTable(...)` 守卫；
- 加字段类用 `HasColumn` / `HasIndex` 守卫；
- 数据清理类（`DELETE`）天然可重复执行；
- 不可逆的迁移，`Down()` 里不要尝试恢复数据，写明原因即可
  （参考 `20260926000001_purge_heartbeat_messages`）。

在线更新会在换掉二进制之后跑一次迁移、失败就换回备份，随后 systemd 拉起新进程时
**又会跑一遍**。同一次升级里迁移因此被执行两次，这正是幂等必须成立的原因。

> **写完迁移文件一定要把它加进 `bootstrap.Migrations()`。** 忘了加不会报任何错：
> `RunMigrations` 只遍历注册表，未注册的文件连一行日志都不会有，而迁移本身又有
> 守卫，跑不跑都返回 nil。`20261101000006_normalize_audit_created_at` 就这样丢掉了
> —— 现在 `bootstrap` 里有一条测试要求迁移文件与注册表严格一一对应。

已有迁移：

| 迁移 | 作用 |
| --- | --- |
| `20210101000001_create_jobs_table` | Goravel 内置队列表 |
| `20260901000001` ~ `20260901000006` | users / projects / user_projects / project_locks / interview_status / messages |
| `20260926000001_purge_heartbeat_messages` | 清理历史心跳消息（见下） |
| `20261001000001_ensure_super_admin` | 给存量部署补一个超级管理员 |
| `20261002000001_add_user_profile_fields` | users 加 `email`（唯一，部分索引）与 `token_version` |
| `20261101000001_create_project_states_table` | 项目当前切台状态 |
| `20261101000002_create_shot_cuts_table` | 切台流水 |
| `20261101000003_add_project_schedule_fields` | projects 加日程、场地、负责人、状态、模式 |
| `20261101000004_create_project_cameras_table` | 机位预设；并给存量项目播下默认的 10 个机位 |
| `20261101000005_create_audit_logs_table` | 操作审计 |
| `20261101000006_normalize_audit_created_at` | 把 v1.4.0 / v1.4.1 写入的本地时区时间戳统一成 UTC |
| `20261102000001_create_role_permissions_table` | 权限矩阵的运行时存储（见权限模型一章） |

### 审计时间戳归一迁移

`audit_logs.created_at` 在 SQLite 里是 TEXT，审计页的日期筛选走的是**字符串**比较，
不做任何时间语义解析。而 `20261101000006` 之前，写入侧用的是 `time.Now()`（本地时区），
于是列里存的是 `2026-10-02T00:13:19.6237187+08:00`，而筛选条件归一成 UTC 之后是
`...16:14:00Z` —— 按字符比较前者大于后者，`created_at <= to` 一条都不成立。

表现是「明明有记录，审计页却是空的」，且**不带筛选时又能看到**，所以很难联想到时区。

写入侧早在 v1.4.2 就改成 `time.Now().UTC()`，这条迁移负责修好 v1.4.0 / v1.4.1 留下的
历史行。它只改仍带时区偏移的行：以 `Z` 结尾的已经是 UTC，裸墙上时间（没有偏移）
含义不确定，宁可不猜也不改错 —— 改错等于凭空造出一条错误时间的证据。

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
| `log-archive` | 定期清理过期日志与导出文件；顺带跑采访端掉线扫描 | `PLUGIN_LOG_RETENTION_DAYS`、`PLUGIN_LOG_CHECK_INTERVAL`、`PLUGIN_PRESENCE_SCAN_INTERVAL`、`PLUGIN_PRESENCE_TIMEOUT` |
| `csv-export` | 提供日志 JSON / CSV 导出接口 | `PLUGIN_CSV_EXPORT_ENABLED` |

配置项集中在 `backend/config/plugins.go`（环境变量驱动），
`main.go` 的 `initPlugins()` 负责装配。

**掉线扫描为什么挂在 log-archive 里**：它需要的只是一个「每隔 N 秒醒一次」的
后台 goroutine，而这里正好有一个。用回调注入（`SetPresenceScanner`）而不是让
`plugins` 反向 import `app/ws`——`ws` 已经 import 了 `plugins`（要发插件事件），
反过来就成环了。插件被停用时掉线扫描仍然运行：插件开关的本意是「别删日志」，
不该顺带把「采访端掉线能不能被发现」一起关掉。

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

按涉及范围跑，**不要只跑单测就提交**。改后端务必起一次真实服务实测：
本项目的大部分历史缺陷（状态从未落库、守卫从未生效、界面上恒定的错误数字）
都能通过编译和单测，只有真的跑一遍才看得出来。

### 后端

```powershell
cd backend
go build ./...
go vet ./...
go test ./...
gofmt -l app config routes database bootstrap
```

`gofmt -l` 有 33 个预存输出，**全部**集中在 `app/facades/`（自动生成的 facade
代理）与三处 gRPC 样板（`config/grpc.go`、`config/telemetry.go`、
`routes/grpc.go`）。只看自己改过的文件是否干净。

起真实服务实测时，建议在临时目录里跑，避免污染开发数据库：

```powershell
mkdir %TEMP%\mzverify
copy backend\smart-mzcmc.exe %TEMP%\mzverify\      # 或 go build -o
# 在 %TEMP%\mzverify 下写一份 .env（APP_PORT 换一个、DB_DATABASE 指向临时库）
cd %TEMP%\mzverify
.\smart-mzcmc.exe migrate
.\smart-mzcmc.exe
```

`backend/tests/integration/main.go` 是一份现成的端到端脚本，覆盖注册、登录、
建项目、WebSocket 连接、切台、采访状态、日志查询与导出：

```powershell
go run tests/integration/main.go http://127.0.0.1:3000
```

### 管理端

```powershell
cd admin
pnpm run check      # svelte-check，0 error 是硬要求
pnpm test           # vitest --run
pnpm run build
pnpm run format     # prettier --write
```

vitest 分 `server`（node 环境，纯逻辑）与 `client`（playwright + chromium）两个
project。`client` 需要先装浏览器，且依赖 README 里的构建产物：

```powershell
pnpm exec playwright install chromium
pnpm exec vitest run --project server      # 只跑纯逻辑用例
```

`admin/build/` 的产物要同步到 `backend/public/admin`（后端托管前端站点），
两者都在版本库里：

```powershell
cd admin
node scripts/build.mjs --no-install --no-check --skip-build
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
dotnet build -c Release

cd ..\PackagingApp
dotnet build -c Release
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
6. 从导播端发送 `shot_state`（先发 `next`、再发 `current`）与 `chat`，
   检查接收端显示、`shot_cuts` 里的记录与日志。
7. 关闭持有控制权的导播端，确认锁释放，另一导播可以接管。
8. 断开采访端的网络（不要点关闭，直接拔网线或开飞行模式），确认导播端在
   `PLUGIN_PRESENCE_TIMEOUT` 内把它显示为红色「离线」。
9. 中途新开一个解说端，确认它连上的一瞬间就显示出当前机位，而不是
   「等待导播指令」。
10. 查询日志并验证 JSON/CSV 导出结果（导出必须带 `from`/`to`）。

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

### 客户端连不上，报 401 / 403

先在 `.env` 里确认 `REQUIRE_PROJECT_MEMBERSHIP` 的值：

- **`true`**：解说端 / 包装端 / 采访端也必须带令牌。检查对应 `config.json`
  里的 `Username` / `Password` 是否填了、账号是否是 `ProjectId` 的成员。
  导播端报 403 说明该账号没被分配到这个项目，到「权限分配」页加上。
- **`false`**：后端不拦，但会在日志里打印
  `[Authz] 用户 xxx 访问了未授权的项目 N（...仅记录，未拦截）`。
  看到这条说明授权确实没配，只是还没拦。

### 看到「消息累计」是 0 或很小

`GET /api/logs` 返回的 `total` 是**匹配筛选条件的真实总行数**。总览页不带
筛选条件，所以它就是 `messages` 表的实际行数。若数字偏小，检查：
心跳不计数（正常）；日志保留期是 30 天，更早的已被清理。

### 导播端项目下拉框是空的

确认后端版本不低于 1.4.0（`GET /api/status` 的 `version`）。1.3.0 及更早
没有 `GET /api/projects`，而导播端如果调的是管理接口会拿到 403。

### 导出报「必须提供 from 与 to 时间范围」

导出接口不再允许对整个项目历史做无条件查询——30 天保留期下那可能是几百 MB，
一次性读进内存再同步写盘是不可控的。界面上选好时间范围即可，单次上限 2 万行。

## 提交前检查清单

- [ ] 新增 API 已注册路由、校验参数并补充认证说明。
- [ ] **新接口挂的是 `RequirePermission(具名权限)`，不是 `RequireRole`；改动
      `policy.csv` 或路由挂载后，`go test ./app/rbac/... ./routes/...` 全绿。**
- [ ] 新增 WebSocket 消息已定义 payload，并验证所有相关角色。
- [ ] 数据结构变更已新增迁移、模型和客户端类型。
- [ ] **迁移文件已加进 `bootstrap.Migrations()`**（漏加不会报错，只是永远不执行）。
- [ ] **迁移写成幂等的**（每次启动全量遍历全部迁移，没有记账表；在线更新那次之后
      还会再跑一遍）。
- [ ] **所有 `First()` 的「查到了吗」判断都补了主键**（查不到时不报错，只留零值）。
- [ ] 没有提交 `.env`、JWT 密钥、数据库备份或发布目录中的临时文件。
- [ ] 后端执行 `go build ./...`、`go vet ./...`、`go test ./...`，并起真实服务实测一次。
- [ ] Flutter 两个端执行 `flutter analyze` 和 `flutter test`。
- [ ] 管理端执行 `pnpm run check`、`pnpm test` 和 `pnpm run build`，
      并把 `admin/build/` 同步到 `backend/public/admin`。
- [ ] .NET 两个项目均执行 `dotnet build -c Release`（0 警告 0 错误）。
- [ ] 文档站执行 `pnpm run docs:build`。

## 版本与发布

版本号由构建流水线注入，**不要在任何客户端里手写版本字符串**：

| 端 | 注入方式 | 本地默认值所在 |
| :--- | :--- | :--- |
| admin | `VITE_APP_VERSION` | `admin/package.json` 的 `version` |
| Flutter 两端 | `--dart-define=APP_VERSION=<版本>` | 各自 `pubspec.yaml` 的 `version` |
| .NET 两端 | `dotnet build -p:Version=<版本>` | 各自 `.csproj` 的 `<Version>` |

后端 `status_controller.go` 里有两个常量：

- `Version`：自身版本。日常发版只改这一个。
- `MinClientVersion`：客户端最低适配版本。**平时不要动**——只有引入了老客户端
  无法承受的后端改动时才上调。日常发版只改 `Version`，这样客户端只会看到
  琥珀色「建议更新」而不是红色「必须更新」。

### 打 tag 发布的顺序

五个在流水线里的仓库（backend / admin / director / interviewer / docs）
打同一个 `v<版本>`：

```powershell
# 1. 先在四个客户端仓库打 tag 并推送
foreach ($d in 'admin','docs','director','interviewer') {
  git -C $d tag v1.4.0
  git -C $d push origin v1.4.0
}
# 2. 最后推 backend 的 tag —— 它触发发布流水线
git -C backend tag v1.4.0
git -C backend push origin v1.4.0
```

**顺序不能反。** `backend/.github/workflows/release.yml` 在构建时会去客户端
仓库查同名 tag，查不到就回退 `main` 并在发布说明里写明实际用的 ref。
先推 backend 的话，这次发布的产物会是各客户端当时的 `main`，
而不是你以为的那个版本。

两个 .NET 端不在流水线里，CI 会自己查后端最新 release tag。
