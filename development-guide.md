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
│   └── main.go              # 启动 3000/3002 两个服务
├── admin/                   # SvelteKit 管理端源码
├── director/                # Flutter 导播端
├── interviewer/             # Flutter 采访端（支持 Web）
├── CommentatorApp/          # .NET 10 WPF 解说端
├── PackagingApp/            # .NET 10 WPF 包装端
├── docs/                    # VitePress 文档
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

构建后，将 `build/web/` 内容发布到 `backend/public/interviewer/`。后端 `main.go` 当前按独立的 `interviewer/build/web` 路径启动静态文件服务；如果采用复制到 `backend/public/interviewer/` 的方式，需要同步检查 `app/ws/server.go` 的静态目录配置。

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
| `POST` | `/api/auth/register` | 否 | 注册用户 |
| `GET` | `/api/auth/profile` | 是 | 当前用户 |
| `GET/POST/PUT/DELETE` | `/api/admin/*` | 是 | 用户、项目、授权管理 |
| `POST/GET` | `/api/locks/:projectId/*` | 是 | 获取、释放、续期和查询控制权 |
| `GET` | `/api/messages/:projectId` | 是 | 查询项目消息 |
| `GET` | `/api/logs` | 是 | 按项目或类型查询日志 |
| `GET/POST` | `/api/interview/*` | 否 | 查询和更新采访状态 |
| `GET` | `/api/plugins` | 是 | 查看插件 |
| `GET` | `/api/projects/:projectId/stats` | 是 | 项目统计 |
| `POST` | `/api/logs/export` | 是 | 导出 JSON 日志 |
| `POST` | `/api/logs/export/csv` | 是 | 导出 CSV 日志 |
| `POST` | `/api/logs/cleanup` | 是 | 清理旧日志 |

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
  "type": "next_shot",
  "project_id": 1,
  "sender_id": 1,
  "payload": {
    "name": "100米"
  },
  "timestamp": 1789000000000
}
```

当前重要消息类型：

- `next_shot`：导播发送下一项预告，转发给解说端和包装端。
- `confirm_switch`：导播确认切台，转发给解说端和包装端。
- `chat`：项目内消息广播；`{"message":"heartbeat"}` 会被过滤，不写入有效聊天。
- `interview_status`：采访端状态变更，转发给导播端和包装端。
- `lock_update`：控制权变化。
- `system`：连接成功、权限错误等系统消息。

新增消息类型时，应同时更新后端 Hub、发送方客户端、接收方客户端以及本指南中的协议说明，并补充至少一个联调场景。

## 控制权与业务规则

控制权以项目为粒度，同一项目同时只能存在一个有效锁：

1. 导播连接 WebSocket 时，如果项目没有有效锁，会尝试自动获取。
2. HTTP `acquire` 可重复调用；如果当前用户已持有锁，会续期并返回成功。
3. 其他导播抢锁时返回 `409`，响应中包含当前持有者和过期时间。
4. 锁默认有效期为 90 秒，导播端需要定期调用 `heartbeat`。
5. 只有当前锁持有者可以发送 `next_shot` 和 `confirm_switch`。
6. 导播断开时，后端会释放该用户在该项目上的锁并广播更新。

修改锁逻辑时必须重点验证：双导播同时抢锁、持有者心跳、锁过期后重新获取、持有者断线和非持有者推送这五种情况。

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

## 插件系统

插件代码在 `backend/app/plugins`，当前注册：

- `ntfy-alert`：向 ntfy 推送事件告警，依赖 `NTFY_SERVER` 和 `NTFY_TOPIC`。
- `log-archive`：按 30 天策略清理历史日志。
- `csv-export`：提供日志 CSV 导出接口。

插件通过事件总线接收锁获取、锁释放、导播断线等事件。新增插件时应满足：初始化失败不能阻断后端启动；处理失败不能影响主业务；耗时操作不能阻塞 WebSocket 广播；配置必须通过环境变量或配置文件注入。

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
