# 校园直播导播协调系统 —— 操作手册

---

## 系统概述

本系统用于校园直播活动中，解决导播切画面与解说不同步的痛点，实现**导播预判指令 → 解说提前准备 → 包装同步联动 → 采访状态透明**的全链路协同。

::: tip 推荐阅读顺序
首次部署建议依次阅读「安装与部署」「配置说明」和「系统初始化」，完成基础配置后再阅读各端操作指南。
:::

### 系统架构

```mermaid
flowchart TD
    subgraph Clients[前端客户端层]
        Admin[管理后台<br/>Web]
        Director[导播端<br/>Flutter]
        Commentator[解说端<br/>C# WPF]
        Packaging[包装端<br/>C# WPF]
        Interviewer[采访端<br/>Flutter / Web]
    end

    subgraph Backend[后端服务层<br/>Go + Goravel + SQLite]
        HTTP[HTTP API<br/>3000 端口]
        WS[WebSocket Hub<br/>3002 端口]
        Lock[Lock Manager]
        Plugins[Plugins<br/>ntfy / log-archive / csv]
    end

    Admin -->|HTTP| HTTP
    Director -->|HTTP + WS| HTTP
    Director <--> |WebSocket| WS
    Commentator -->|WebSocket| WS
    Packaging -->|WebSocket| WS
    Interviewer -->|HTTP + WS| WS
    HTTP --> Lock
    HTTP --> Plugins
    WS --> Lock
    WS --> Plugins
```

### 端口分配

| 端口 | 服务 | 说明 |
|------|------|------|
| 3000 | HTTP API | 管理后台、REST API、认证 |
| 3002 | WebSocket | 实时通讯、采访端 Web 托管 |

### 访问地址

| 页面 | 地址 |
|------|------|
| 系统首页 | `http://<服务器IP>:3000/` |
| 管理后台 | `http://<服务器IP>:3000/admin` |
| 采访端 Web | `http://<服务器IP>:3002/interviewer/` |
| API 状态 | `http://<服务器IP>:3000/api/status` |

---

## 安装与部署

### 环境要求

- **后端**：Go 1.25+、SQLite（内嵌，无需安装）
- **导播端**：Flutter SDK、Android SDK / Windows SDK
- **解说端/包装端**：.NET 10 Runtime
- **采访端**：Flutter SDK（Web 部署）或现代浏览器（Web 访问）

### 后端部署

#### 方式一：直接运行（推荐开发环境）

```bash
cd backend

# 1. 安装依赖
go mod tidy

# 2. 构建并运行
go build -o smart-mzcmc.exe .
./smart-mzcmc.exe
```

**不需要手工 `cp .env.example .env`。** 首次启动时后端会自动创建 `.env` 并补齐
`APP_KEY`、`JWT_SECRET`（各 32 位随机串）与 SQLite 配置，然后进入初始化模式，
在浏览器里完成「配置 + 建管理员」即可，详见下面的[系统初始化](#系统初始化)。

想提前改端口、数据库路径之类的配置，也可以先复制模板再启动：

```bash
cp .env.example .env
# 编辑 .env：APP_HOST / APP_PORT / DB_DATABASE / NTFY_* 等
```

#### 方式二：Docker 部署

```bash
cd backend

# 构建镜像
docker build -t smart-mzcmc .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -p 3002:3002 \
  -v $(pwd)/database:/www/database \
  -v $(pwd)/.env:/www/.env \
  --name smart-mzcmc \
  smart-mzcmc
```

#### 方式三：使用 Air 热重载（推荐开发）

```bash
cd backend
air
```

### 导播端编译

```bash
cd director

# 获取依赖
flutter pub get

# Windows 桌面端
flutter build windows

# Android APK
flutter build apk

# Web 版本
flutter build web
```

### 采访端编译

```bash
cd interviewer

# 获取依赖
flutter pub get

# Web 部署（推荐）
flutter build web

# 产物位置：interviewer/build/web/
# 后端启动时按 public/interviewer -> interviewer/build/web 的顺序查找，
# 所以本地构建后直接重启后端即可；若要模拟线上发布包布局，再执行：
cp -r build/web/* ../backend/public/interviewer/
```

### 解说端/包装端编译

```bash
cd CommentatorApp   # 或 PackagingApp

# 获取依赖
dotnet restore

# 编译
dotnet build -c Release

# 发布（单文件）
dotnet publish -c Release -r win-x64 --self-contained
```

---

## 配置说明

### 后端配置文件 `.env`

::: warning 安全提示
`JWT_SECRET` 必须使用随机字符串，并且不要提交 `.env`、数据库文件或真实的 ntfy 配置。生产环境请关闭调试模式并限制管理端访问范围。
:::

```dotenv
# 应用基础配置
APP_NAME=SmartMZCMC
APP_ENV=local
APP_DEBUG=true
APP_PORT=3000
APP_HOST=0.0.0.0

# JWT 认证（必须配置）
JWT_SECRET=your-random-32-char-secret-key-here

# 数据库（默认 SQLite）
DB_CONNECTION=sqlite
DB_DATABASE=database/smart-mzcmc.db

# 插件配置（可选，详见后文）
# ntfy 告警：两项都填才会启用；只填一项会被停用并在后台标出原因
NTFY_SERVER=https://ntfy.sh
NTFY_TOPIC=your-alert-topic
# PLUGIN_NTFY_ENABLED=false   # 配置齐全但仍想关闭时用

# 日志归档
PLUGIN_LOG_ARCHIVE_ENABLED=true
PLUGIN_LOG_RETENTION_DAYS=30
PLUGIN_LOG_CHECK_INTERVAL=1h

# 采访端掉线扫描（与上面的清理共用一个后台 goroutine）
PLUGIN_PRESENCE_SCAN_INTERVAL=60s
PLUGIN_PRESENCE_TIMEOUT=90s

# 日志导出接口
PLUGIN_CSV_EXPORT_ENABLED=true

# 项目授权校验。默认 false —— 打开前请先把各端的登录账号配好
REQUIRE_PROJECT_MEMBERSHIP=false
```

改完 `.env` 重启后端，然后到管理后台「插件与统计」页确认：
每个插件卡片会显示**真实的启用状态**（已启用 / 已停用）、停用原因和生效配置。
ntfy topic 之类的机密值在界面上是脱敏显示的（形如 `su****yz`）。

若某个插件显示「已停用」，卡片上会直接写明原因，不用去翻服务端日志。

| 环境变量 | 默认值 | 说明 |
|--------|--------|------|
| `NTFY_SERVER` | 空 | ntfy 服务器地址 |
| `NTFY_TOPIC` | 空 | ntfy 主题名 |
| `PLUGIN_NTFY_ENABLED` | 空 | 显式开关；留空按前两项是否配齐自动判断 |
| `PLUGIN_LOG_ARCHIVE_ENABLED` | `true` | 是否启用日志自动清理 |
| `PLUGIN_LOG_RETENTION_DAYS` | `30` | 日志保留天数。同时决定 `storage/exports` 里导出文件的清理期限 |
| `PLUGIN_LOG_CHECK_INTERVAL` | `1h` | 清理检查间隔，支持 `30s` / `5m` / `1h` |
| `PLUGIN_PRESENCE_SCAN_INTERVAL` | `60s` | 采访端掉线扫描间隔 |
| `PLUGIN_PRESENCE_TIMEOUT` | `90s` | 超过这个时长没收到任何消息就判定采访端离线 |
| `PLUGIN_CSV_EXPORT_ENABLED` | `true` | 是否启用日志导出接口 |
| `REQUIRE_PROJECT_MEMBERSHIP` | `false` | 是否强制校验项目成员身份，详见下方「项目授权校验」 |

::: tip 升级到 1.4.0 时先别开 `REQUIRE_PROJECT_MEMBERSHIP`
它默认关闭，关闭时后端只把「本来会被拦下的请求」写进日志。**先把账号配下去、
确认现场都能连上，再打开它。** 详见下方「项目授权校验」一节。
:::

### 项目授权校验

`user_projects` 表记录「谁可以访问哪个项目」，此前它只被管理后台读写，
**从未参与任何权限判断**：后勤账号能看到全部项目，控制权接口只从 URL 取项目
编号，WebSocket 只要知道 `project_id` 就能监听整个项目的实时消息。

`REQUIRE_PROJECT_MEMBERSHIP=true` 之后，以下位置都会校验调用者是不是该项目的
成员（管理员及以上仍然绕过，因为他们本来就要管理所有项目）：

| 位置 | 说明 |
| :--- | :--- |
| `/api/locks/*` | 控制权获取、释放、心跳、查询 |
| `/api/messages/:projectId` | 项目消息 |
| `/api/projects/:projectId/stats` | 项目统计 |
| `/api/projects/:projectId/cameras` | 机位预设 |
| `/api/projects/:projectId/shot-cuts` | 切台记录 |
| WebSocket 握手 | 所有非管理员角色都要带令牌，且必须是该项目成员 |

**打开前的准备顺序**（顺序反了现场会当场断连）：

1. 在管理后台给每个使用者建账号，并在「权限分配」页把他们加到对应项目。
2. 把账号和密码填进各端配置：
   - 解说端 / 包装端：exe 同目录 `config.json` 的 `Username` / `Password`
   - 采访端：`public/interviewer/config.json` 的 `username` / `password`
   - 导播端：本来就要登录，无需额外配置
3. 各端重启（采访端刷新浏览器），确认都能正常连接。
4. 把 `.env` 里的 `REQUIRE_PROJECT_MEMBERSHIP` 改成 `true`，重启后端。

关闭状态下，未授权的访问会写一条这样的日志，可用来先看名单：

```text
[Authz] 用户 zhangsan(#7, logistics) 访问了未授权的项目 3（REQUIRE_PROJECT_MEMBERSHIP=false，仅记录，未拦截）
```

::: warning 凭据留空 = 不登录
三个客户端在账号留空时不会尝试登录，行为与打开开关之前完全一致。
所以可以先把配置发下去、确认没人受影响，再打开后端的开关。
:::

### 各端地址配置

正式环境走反向代理，所有客户端只需填**一个域名**，不用再带端口：

| 端 | 配置文件 | 是否需要重新编译 |
| :--- | :--- | :--- |
| 管理后台 | 无需配置（默认同源） | 否 |
| 解说端 | exe 同目录 `config.json` | **否**，改完重启 exe |
| 包装端 | exe 同目录 `config.json` | **否**，改完重启 exe |
| 采访端 | `public/interviewer/config.json` | **否**，刷新浏览器 |
| 导播端 | `director/lib/config.dart` | **是**，改完 `flutter build` |

#### 解说端 / 包装端

编辑与 exe 同目录的 `config.json`：

```json
{
  "ServerUrl": "http://zhdb.647382.xyz",
  "WsUrl": "ws://zhdb.647382.xyz/ws",
  "ProjectId": 1,
  "Role": "commentator",
  "Username": "",
  "Password": ""
}
```

> **Role 可选值**：`commentator`（解说端）、`packaging`（包装端）
>
> `ServerUrl` 用于登录（`POST /api/auth/login`），**必须填对**；
> `WsUrl` 用于实时通信。两者指向同一台服务，只是一个走 HTTP、一个走 WebSocket。

| 字段 | 说明 |
| :--- | :--- |
| `ServerUrl` | HTTP 接口地址，登录时用 |
| `WsUrl` | WebSocket 地址，`ws://` 或 `wss://` |
| `ProjectId` | 订阅的项目 ID |
| `Role` | `commentator` / `packaging` |
| `Username` / `Password` | 登录账号。留空表示不登录，适用于未开启项目授权校验的部署 |

登录失败时窗口右下角会显示 `[系统] 登录失败 HTTP 401：...`，而不是一直停在
「连接中...」——现场能直接看出是账号问题还是网络问题。

#### 采访端

编辑 `backend/public/interviewer/config.json`，刷新浏览器即可：

```json
{
  "wsUrl": "ws://zhdb.647382.xyz/ws",
  "projectId": 1,
  "pointCode": "point_1",
  "pointName": "采访点 1",
  "username": "",
  "password": ""
}
```

这是**运行期**配置：采访端是 Web 产物，浏览器启动时会读这个文件覆盖内置默认值。
好处是现场换服务器地址、改账号都不用重新构建、重新部署整个采访端。

`pointCode` 决定这台设备在管理后台里对应哪个采访点。同一项目下多台设备各配一个不同的 `pointCode`。
`config.json` 写坏了也不会让采访端起不来——取不到或字段不合法时会回落到内置默认值。

HTTP 接口地址由 `wsUrl` 推导（`ws://host:3002/ws` → `http://host:3002`），
不需要另配一项。

### 采访端掉线判定

采访端状态有四种，其中「离线」由后端自动产生，不需要现场手动操作：

| 触发条件 | 说明 |
| :--- | :--- |
| WebSocket 断开 | 立即判定，右侧导播端一行变红 |
| 页面切到后台 | 浏览器标签页被切走或锁屏时主动上报 |
| 长时间无消息 | 超过 `PLUGIN_PRESENCE_TIMEOUT`（默认 90 秒）没有任何消息 |

第二条和第三条是必须的：记者走出 WiFi 覆盖范围时，TCP 要等很久才会报错，
连接在服务端看起来仍然「正常」。没有这两条，导播端会一直显示绿色「就绪」，
而人其实早就离开了——屏幕上那个绿色是假的。

掉线会同时触发一条 `interview_offline` 事件，如果配了 ntfy 就会推到管理员手机。

#### 导播端

编辑 `director/lib/config.dart` 后**必须重新编译**：

```dart
class AppConfig {
  static const String serverUrl = 'http://zhdb.647382.xyz';
  static const String wsUrl = 'ws://zhdb.647382.xyz/ws';
}
```

```sh
cd director && flutter build windows --release
```

导播端是装在导播室机器上的原生应用，不像采访端那样有可改的外部配置文件。

---

::: danger 启用 HTTPS 后必须把所有 ws:// 换成 wss://
浏览器把 https 页面里的 `ws://` 判为**混合内容**直接拦掉，
连不上而且**不报任何错**——表现就是各端状态灯一直转圈。

需要改的三处：
1. 解说端 / 包装端的 `config.json`
2. `public/interviewer/config.json`
3. `director/lib/config.dart`（并重新编译）

`serverUrl` 同理要改成 `https://`。
:::

### 反向代理部署

后端本身监听两个端口：`3000`（API、首页、后台、文档站）和 `3002`（WebSocket、采访端）。
生产环境在前面放一层 nginx，把两者收拢到同一个域名：

```nginx
# 必须在 http {} 块里（宝塔的 vhost 文件就是在 http 块内 include 的）
map $http_upgrade $smartmzcmc_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    # 3002：WebSocket
    location ^~ /ws {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $smartmzcmc_connection_upgrade;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }

    # 3002：采访端
    location ^~ /interviewer/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_set_header Host $host;
    }

    # 3000：其余全部
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

几个必须注意的点：

| 事项 | 原因 |
| :--- | :--- |
| 用 `location ^~ /ws` 而不是 `= /ws` | 首页还会请求 `/ws/status` 拿在线连接数 |
| **不能**写成 `/ws/` | 后端 Go `ServeMux` 把 `/ws` 注册为精确匹配，带斜杠匹配不上 |
| `proxy_read_timeout` 至少 300s | 默认 60s。笔记本休眠时心跳会停，60s 断线会让服务端释放导播控制权 |
| `Connection` 用 map 而不是写死 `"upgrade"` | 写死会让普通 GET 也带 `Connection: upgrade`，破坏上游 keepalive |
| 删掉宝塔的 `rewrite/go_*.conf` | 那是 Go 框架伪静态模板，会重写查询串，而本项目全靠查询串传参 |
| 3002 只监听 127.0.0.1 | 无需对外开放，公网只暴露 80/443 |

验证：

```bash
curl -I http://zhdb.647382.xyz/                            # 200
curl    http://zhdb.647382.xyz/ws/status                   # {"status":"ok",...}
curl -I http://zhdb.647382.xyz/interviewer/                # 200
curl -I http://zhdb.647382.xyz/interviewer/config.json     # 200
```

`curl` 测不出 WebSocket（不发 Upgrade 头），直接看系统首页右上角的连接状态最快。

---

## 系统初始化

### 初始化向导（推荐）

系统没有预置账号。全新部署时（数据库文件不存在）后端会**自动进入初始化模式**：

| 行为 | 说明 |
| :--- | :--- |
| 自动补 `.env` | 生成 32 位随机 `APP_KEY` / `JWT_SECRET`，并写入 `DB_CONNECTION=sqlite`、`DB_DATABASE` |
| 拦截业务接口 | 除 `/api/setup/*` 与 `/api/health` 外，所有 API 返回 503 `{"code":"setup_required"}` |
| 首页跳转 | 访问 `/` 直接 302 到 `/admin/setup`，管理后台任何页面也会被前端送到向导页 |

打开向导页：

```
http://127.0.0.1:3000/admin/setup
# 局域网部署换成 http://<服务器IP>:3000/admin/setup
```

页面上要填两类信息：

**系统信息**（写进 `.env`）

| 字段 | 对应键 | 说明 |
| :--- | :--- | :--- |
| 系统名称 | `APP_NAME` | 界面上展示的名称，留空用默认值 |
| 对外访问地址 | `APP_URL` | 各端填服务器地址时照抄这个。局域网填 `http://<内网IP>:3000`，反代填域名 |
| 监听地址 | `APP_HOST` | `0.0.0.0` = 局域网内所有机器可访问（推荐）；`127.0.0.1` = 仅本机 |
| 监听端口 | `APP_PORT` | 默认 `3000` |

**管理员账号**：用户名（≤64 字符，字母数字与 `_` `.` `-` 及中文）、显示名、邮箱（可选，仅用于取头像）、密码（**至少 6 位**）。

点击「完成初始化」后，后端会依次：写 `.env` → 执行全部数据库迁移 → 创建账号（固定为
**超级管理员**）。成功后页面会列出写入了哪些键、WebSocket 地址，以及是否需要重启。

::: warning 改了监听地址或端口要重启后端
`.env` 是在进程启动时读入的，监听端口无法热切换。向导页会检测到变化并提示重启；
不重启也不影响本次使用（当前进程仍按旧地址监听），但重启后才生效。
:::

::: danger 初始化完成前不要暴露端口
`POST /api/setup/apply` 与 `POST /api/auth/register` 在系统还没有任何账号时都是公开的。
请先把服务跑起来、立刻完成初始化，再对外开放。
:::

### 手工初始化（无浏览器场景）

初始化模式只在「数据库文件不存在」时才成立，所以也可以完全手工建库，后端就不会拦截：

```bash
cd backend
cp .env.example .env      # 手工填好 JWT_SECRET（APP_KEY 不填也会自动生成）
go run . migrate          # 建表（幂等）
go run .                  # 启动后直接 curl 注册管理员
```

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123456",
    "display_name": "系统管理员"
  }'
```

成功返回 `201`：

```json
{"id":1,"username":"admin","display_name":"系统管理员","role":"super_admin"}
```

几个要点：

| 事项 | 说明 |
| :--- | :--- |
| `role` 不用传 | 引导模式下该字段会被忽略，第一个账号固定是 `super_admin` |
| 密码至少 6 位 | 低于 6 位返回 400 `密码至少 6 位` |
| 用户名限 64 字符内 | 只能包含字母、数字、`_`、`.`、`-` 与中文 |
| **只有一次机会** | 第一个账号建好后，该接口立刻切换为「仅管理员可调用」 |

### 初始化模式相关接口

| 接口 | 说明 |
| :--- | :--- |
| `GET /api/setup/status` | 公开。返回 `needs_setup`、`.env` 路径与可写性、数据库路径、当前默认值、探测到的内网 IP |
| `POST /api/setup/apply` | 公开，但系统已初始化后返回 403。写 `.env`、跑迁移、建首个超级管理员 |

改了数据库路径、想重新初始化时：停服 → 备份并删除 `backend/database/smart-mzcmc.db` → 重启，
后端会重新进入初始化模式。

手工流程的上机验证（确认接口已经收紧）：

```bash
curl http://localhost:3000/api/auth/bootstrap
# 期望 {"needs_bootstrap":false}

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test123456","role":"admin"}'
# 期望：401 {"error":"系统已有账号，创建用户需要管理员登录"}
```

### 登录管理后台

1. 访问 `http://<服务器IP>:3000/admin`
2. 输入刚创建的用户名与密码
3. 登录成功后进入管理后台

令牌有效期 60 分钟，过期后前端会自动跳回登录页（后端返回 401 + 可读错误消息）。

### 创建项目

1. 在管理后台点击「项目管理」标签
2. 点击「+ 新建项目」
3. 填写项目名称（如：校园运动会）、编码（如：sports2025）、描述
4. 点击「创建」

### 创建导播账号

1. 在管理后台点击「用户管理」标签
2. 点击「+ 新建用户」
3. 填写用户名（≤64 字符）、密码（**至少 6 位**）、显示名
4. 角色选择「导播」
5. 点击「创建」

::: tip 创建用户需要管理员登录态
`新建用户` 走的是同一个 `POST /api/auth/register`，但只有在管理员登录后
才能调用。导播账号即使自己调这个接口也会收到 403。
:::

### 分配项目权限

1. 在管理后台点击「权限分配」标签
2. 选择用户和项目
3. 点击「分配」

---

## 各端操作指南

### 导播端（Flutter 手机/平板）

#### 登录

1. 启动导播端应用
2. 输入服务器地址、用户名、密码
3. 点击「登录」

#### 主界面说明

```mermaid
flowchart TB
    Header[项目名 · 在线 · 张三 · 释放控制权]
    Status[采访状态栏<br/>🟢采访点1 · 🟡采访点2 · 🔵采访点3]
    Presets[预设按钮矩阵<br/>全景 · 50米 · 100米<br/>跳远 · 跳高 · 接力]
    Confirm[滑动确认条<br/>滑动以确认推送]
    Chat[内部通信区<br/>消息列表 · 输入框 · 发送]

    Header --> Status --> Presets --> Confirm --> Chat
```

#### 操作流程

1. **获取控制权**：点击右上角「获取控制权」按钮
2. **选择项目**：从下拉框选择当前直播项目
3. **发送切台指令**（每次切台分两步，后端各收到一条 `shot_state`）：
   - 点击预设按钮（如「50米」），状态条显示「即将切台 50米」
   - **滑动底部确认条** → 下发「即将切台」，解说端变红，包装端右栏亮起
   - 现场把画面切过去后，点击 **「确认已切」** → 下发「正在播送」，
     解说端变绿，包装端右栏清空
4. **发送内部消息**：在底部输入框输入消息，点击「发送」
5. **释放控制权**：点击右上角「释放控制权」按钮

> **注意**：同一项目同一时间只有一名导播能持有控制权。导播断线时控制权自动释放。

### 解说端（C# 桌面应用）

#### 启动

1. 双击 `CommentatorApp.exe`
2. 应用自动读取 `config.json` 配置并连接服务器
3. 右下角绿点表示已连接

#### 界面说明

窗口只有一块主显示区，按后端指令在两种状态间切换：

```mermaid
flowchart TB
    Pending["即将播送：<br/><strong>跳远</strong>"]
    OnAir["正在播送：<br/><strong>100米</strong>"]
    Connection[🟢 已连接]

    Pending -->|导播点「确认已切」| OnAir
    OnAir --- Connection
```

#### 状态说明

| 状态 | 显示 |
|------|------|
| 收到 `shot_state`，`next` 非空 | 「即将播送：」+ 机位名，**琥珀红**，背景转为暗红 |
| 收到 `shot_state`，`next` 为空 | 「正在播送：」+ 机位名，**绿色**，背景为深蓝 |
| 收到新的 `shot_state` | 整体替换为新状态，不需要等待 |
| 断线重连 | 右下角红点，自动重连（指数退避） |

> 解说端不再自行推断「正在播送」，也不再有 5 秒自动清空计时器——
> 状态完全由后端下发的 `shot_state` 决定。

### 包装端（C# 桌面应用）

#### 启动

1. 双击 `PackagingApp.exe`
2. 应用自动读取 `config.json` 配置并连接服务器

#### 功能

- 同时显示「正在播送」与「即将切台」两栏，由后端 `shot_state` 驱动
- 接收导播发送的内部消息
- 显示消息历史记录

### 采访端（Flutter/Web）

#### 方式一：Web 访问（推荐）

1. 浏览器访问 `http://<服务器IP>:3002/interviewer/`
2. 页面显示巨大状态按钮

#### 方式二：Flutter App

1. 启动应用，修改 `config.dart` 中的服务器地址和采访点配置
2. 编译运行

#### 操作

- **点击巨大按钮**切换状态：
  - 灰色（未就绪）→ 蓝色（准备中）→ 绿色（就绪）→ 循环
- 状态变更实时推送给导播端和包装端
- 底部显示 WebSocket 连接状态

---

## API 接口参考

### 认证接口

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/login` | 登录 | 否 |
| POST | `/api/auth/register` | 创建用户（见下方双模式说明） | 视状态而定 |
| GET | `/api/auth/profile` | 获取当前用户信息 | JWT |

**登录请求示例：**

```json
POST /api/auth/login
{
  "username": "admin",
  "password": "admin123456"
}
```

::: warning `POST /api/auth/register` 的双模式
这是唯一一个「有时公开、有时需要管理员」的接口，行为取决于数据库当前状态：

| 系统状态 | 需要认证 | `role` 字段 | 用途 |
| :--- | :--- | :--- | :--- |
| **用户表为空** | 否 | 被忽略，强制 `admin` | 全新部署创建第一个管理员 |
| **已有任何用户** | 是，且必须是 `admin` | 必须是 `admin` 或 `director` | 管理后台「新建用户」 |

其他角色的调用一律 403。另外：

- 密码至少 6 位，否则 400；
- 用户名 ≤64 字符，仅限字母、数字、`_`、`.`、`-` 与中文，否则 400；
- 用户名重复返回 409。

对应状态码：401 未登录/令牌无效、403 角色不足、400 参数不合法、409 用户名已存在。
:::

**响应：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "display_name": "系统管理员",
    "role": "admin"
  }
}
```

### 管理接口（需 JWT + admin 角色）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表 |
| DELETE | `/api/admin/users/:id` | 删除用户 |
| PUT | `/api/admin/users/:id/role` | 更新用户角色 |
| GET | `/api/admin/projects` | 项目列表（全部，按日程排序） |
| POST | `/api/admin/projects` | 创建项目 |
| PUT | `/api/admin/projects/:id` | 更新项目（名称、描述、场地、日程、状态、模式） |
| DELETE | `/api/admin/projects/:id` | 删除项目 |
| POST | `/api/admin/projects/:id/cameras` | 新增机位预设 |
| PUT | `/api/admin/projects/:id/cameras/:cameraId` | 修改机位（改名、调顺序） |
| DELETE | `/api/admin/projects/:id/cameras/:cameraId` | 删除机位 |
| POST | `/api/admin/assign` | 分配用户到项目 |
| POST | `/api/admin/revoke` | 撤销项目授权 |
| GET | `/api/admin/users/:id/projects` | 查询用户项目 |
| GET | `/api/admin/audit-logs` | 操作审计记录 |

**`PUT /api/admin/projects/:id` 的字段语义是「出现了就更新」**，空串表示清空：

```json
{
  "name": "春季运动会",
  "description": "",
  "venue": "田径场",
  "scheduled_start": "2026-05-20T09:00",
  "scheduled_end": "2026-05-20T18:00",
  "status": "planned",
  "mode": "live"
}
```

上面这个请求会把描述**清空**。不传某个字段则表示「不动它」。

`status` 可选 `planned` / `live` / `finished` / `cancelled`，
`mode` 可选 `live`（正式直播）/ `rehearsal`（彩排）；彩排与正式的切台记录分开统计。
时间字段接受 `<input type="datetime-local">` 的 `2026-05-20T09:00` 写法（不带秒）。

::: danger 只校验「令牌有效」是不够的
JWT 中间件只判断令牌能不能被解开，不关心持有者是谁。所以这组接口额外挂了
`RequireRole("admin")`：每次请求都查库比对角色，**不信任令牌里缓存的角色**。

这样管理员在后台把某个人的角色降下来，那个人手里的旧令牌会**立即失效**，
而不是等到 60 分钟自然过期。导播角色调用这组接口会收到 403。
:::

### 项目接口（需 JWT 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/projects` | 当前账号有权访问的项目，按「正在直播 > 即将开始 > 无日程 > 已结束」排序 |
| GET | `/api/projects/:projectId/cameras` | 项目的机位预设，按配置顺序 |
| GET | `/api/projects/:projectId/shot-cuts` | 切台时间线与报表 |
| GET | `/api/projects/:projectId/stats` | 项目统计 |

导播端用 `GET /api/projects` 填充项目下拉框。**它和管理接口 `/api/admin/projects`
不是一回事**：后者需要管理员角色，导播调用会 403。此前导播端误用了管理接口，
项目下拉框恒为空。

`GET /api/projects/:projectId/shot-cuts` 支持 `from` / `to`（时间范围）、
`shot`（机位）与 `limit`，返回时间线加汇总：

```json
{
  "project_id": 1,
  "total": 12,
  "cuts": [
    { "id": 12, "from_shot": "全景", "to_shot": "跳远", "director_id": 3,
      "mode": "live", "cut_at": "2026-05-20T10:12:33+08:00" }
  ],
  "summary": {
    "cut_count": 12,
    "avg_dwell_seconds": 184.5,
    "by_shot": [{ "shot": "跳远", "count": 3, "avg_dwell_seconds": 95.2 }],
    "by_mode": [{ "mode": "live", "cut_count": 9 }, { "mode": "rehearsal", "cut_count": 3 }]
  }
}
```

只有**真的切过去了**才记一行：导播发预告（`current` 不变）不算，
按「确认已切」让 `current` 变化才算。最后一段没有后续切台，停留多久无从得知，
所以不参与平均——否则这个数字会随着你盯着屏幕的时间不断变大。

### 控制权接口（需 JWT 认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/locks/:projectId/acquire` | 获取控制权 |
| POST | `/api/locks/:projectId/release` | 释放控制权 |
| POST | `/api/locks/:projectId/heartbeat` | 心跳续期 |
| GET | `/api/locks/:projectId/status` | 查询锁状态 |

开启 `REQUIRE_PROJECT_MEMBERSHIP` 后，这些接口会先校验调用者是不是该项目的成员，
否则返回 403。

### 采访接口（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/interview/:projectId` | 查询项目采访状态 |
| POST | `/api/interview/status` | 更新采访状态 |

`POST /api/interview/status` 接受 `ready` / `preparing` / `not_ready` / `offline`
四种状态。写入后后端会同时广播给导播端与包装端，所以**数据库里的状态和界面上
显示的状态永远一致**——此前这条 HTTP 接口只写库不广播、WebSocket 那条只广播不
写库，两边长期对不上。

采访端掉线（断连 / 页面切后台 / 超时）时后端会自动把它置为 `offline`，
不需要客户端显式调用。但客户端仍会主动 POST 一次，因为这条路径在
WebSocket 已经不可用时还能到达服务端。

### 日志与审计接口（需 JWT 认证）

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/messages/:projectId` | 登录 | 查询项目消息 |
| GET | `/api/logs` | 登录 | 查询协调日志 |
| GET | `/api/admin/audit-logs` | admin | 查询操作审计 |
| POST | `/api/logs/export` | leader 及以上 | 导出日志（JSON），写入 `storage/exports` |
| POST | `/api/logs/export/csv` | leader 及以上 | 导出日志（CSV），写入 `storage/exports` |
| POST | `/api/logs/cleanup` | admin | 清理旧日志 |

`GET /api/logs` 支持以下参数：

| 参数 | 说明 |
| :--- | :--- |
| `project_id` | 项目筛选 |
| `type` | 消息类型筛选 |
| `sender_id` | 发件人筛选 |
| `from` / `to` | 时间范围，接受 `2026-05-20` 与 `2026-05-20T09:30` 两种写法 |
| `limit` | 每页条数，默认 100，上限 500 |
| `cursor` | 上一页返回的 `next_cursor`，用于翻页 |

响应里的 `total` 是**匹配筛选条件的真实总行数**，与本页 `messages` 的长度无关。
分页用游标而不是页码：日志表持续写入，用偏移量翻页会重复看到或整段跳过记录。

**导出接口的 `from` / `to` 是必填的**，单次上限 2 万行：

```json
{ "project_id": 1, "from": "2026-05-01", "to": "2026-05-21" }
```

上限触发时响应里的 `truncated` 为 `true`，应缩小时间范围再导一次。
`storage/exports` 里的文件会按 `PLUGIN_LOG_RETENTION_DAYS` 自动清理——
管理后台的「导出 CSV（当前结果）」是在浏览器里拼装的，服务端这份主要是留存。

### 操作审计

管理后台的「日志与审计」页分成两个 Tab，它们是**两回事**：

| Tab | 数据来源 | 内容 |
| :--- | :--- | :--- |
| 协调日志 | `messages` 表 | 谁切了台、谁发了内部消息、采访点状态变化 |
| 操作审计 | `audit_logs` 表 | 谁改了别人的角色、谁删了账号、谁清了日志 |

操作审计覆盖：删除账号、修改角色、修改个人资料、项目增删改、机位增删改、
权限授予与撤销、日志清理、系统在线更新。

::: warning 日志清理本身也会留痕
「清理日志」会真的删数据，被删的历史记录是审计对象。所以清理动作自己也会写
一条 `logs.cleanup` 审计记录，否则「谁把证据清了」永远查不出来。
:::

审计记录里的用户名是**脱敏存储**的（形如 `r***`），需要精确追溯时用
`actor_id` 去用户表查。记录里还带来源 IP。

### WebSocket 连接

::: info 连接提示
导播端和管理员连接必须携带 JWT。解说端、包装端和采访端在
`REQUIRE_PROJECT_MEMBERSHIP=true` 时**也必须携带**——否则会在握手阶段被拒
（分别返回 401 和 403）。连接地址使用 `3002` 端口，不是 HTTP API 的 `3000` 端口。
:::

```
ws://<服务器IP>:3002/ws?project_id=1&role=director&token=<JWT>
```

**连接参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| project_id | 是 | 项目 ID |
| role | 是 | 角色：director/commentator/packaging/interviewer |
| token | 见上 | JWT 令牌 |
| user_id | 否 | 用户 ID |
| point_code | 采访端必填 | 采访点编码 |

**连接建立后的第一条消息**（`system` 类型）会带上当前切台状态：

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

客户端据此**在连上的一瞬间就显示正确的画面状态**。没有这一步，中途连上来的
解说端会一直停在「等待导播指令」，直到下一次切台——而这中间的解说内容已经
和画面脱节了。断线重连同理。`state_available` 为 `false` 表示这个项目还没切过台。

**消息格式：**

```json
{
  "type": "shot_state",
  "project_id": 1,
  "sender_id": 1,
  "payload": { "current": "100米", "next": "跳远" },
  "timestamp": 1789000000000
}
```

---

## 核心机制说明

### 控制权互斥

- 同一项目同一时间只有一名导播持有控制权
- 导播上线时自动获取控制权（如果无人持有）
- 控制权有效期 90 秒，需定期心跳续期（30 秒间隔）
- 导播断线时自动释放控制权
- 锁过期后会由后台扫描清理并广播 `lock_update`，同时发一条 `lock_timeout`
  事件（配了 ntfy 就会推送）。此前锁只在「有人查询时」才会被顺手删掉，
  没人查就永远不删，超时告警从未触发过。

### 状态流转

切台是「预告 → 确认」两步，每一步后端都会收到一条携带完整状态的 `shot_state`。

```mermaid
flowchart TB
    A[导播点击预设按钮<br/>仅本地预览]
    B[滑动确认条]
    C["发送 shot_state<br/>current=旧机位 next=新机位"]
    D[解说端显示「即将播送」<br/>包装端右栏亮起]
    E[导播现场切画面<br/>点击「确认已切」]
    F["发送 shot_state<br/>current=新机位 next=空串"]
    G[解说端切到「正在播送」<br/>包装端右栏清空]

    A --> B --> C --> D --> E --> F --> G
```

接收端不推断状态、不做本地计时，完全按后端下发的 `shot_state` 渲染。
每次通过校验的切台都会往 `shot_cuts` 表写一行，用于赛后复盘。

### 断线重连

- 指数退避重连：1s → 2s → 4s → 最大 10s
- **重连后由欢迎消息补发当前切台状态**，不重放历史消息

> 状态类信息（正在播送哪个机位）只在服务端保留最新一份（`project_states` 表），
> 重连时随欢迎消息下发。聊天记录与切台历史不补发，需要翻看请到管理后台。

### 采访状态

| 状态 | 颜色 | 说明 |
|------|------|------|
| ready | 绿色 | 已就绪 |
| preparing | 蓝色 | 准备中 |
| not_ready | 灰色 | 未就绪 |
| offline | 红色 | 离线（由后端判定，见「采访端掉线判定」） |

---

## 故障排查

::: details 快速诊断顺序
先检查后端进程和 `3000/3002` 端口，再检查客户端服务器地址、项目 ID、角色和 JWT。最后查看后端控制台中的 `[AUTHZ]`、`[AUTH]`、`[WS]` 日志。
:::

### 后端无法启动

| 问题 | 解决方案 |
|------|----------|
| 端口被占用 | 检查 3000/3002 端口：`netstat -ano | findstr :3000` |
| JWT_SECRET 未配置 | 在 `.env` 中设置 `JWT_SECRET` |
| 数据库权限问题 | 确保 `database/` 目录可写 |

### 客户端无法连接

| 问题 | 解决方案 |
|------|----------|
| WebSocket 连接失败 | 检查防火墙是否开放 3002 端口 |
| 认证失败 | 检查 JWT 是否过期，重新登录获取新 token |
| 控制权获取失败 | 检查是否已有其他导播持有控制权 |
| 提示「无权访问该项目」(403) | 开启了项目授权校验但该账号没被分配到该项目。到管理后台「权限分配」页加上，或临时把 `REQUIRE_PROJECT_MEMBERSHIP` 改回 `false` |
| 提示「该项目需要登录后访问」(401) | 同上，但客户端连账号都没填 |

### 解说端/包装端无法连接

| 问题 | 解决方案 |
|------|----------|
| 启动后无反应 | 检查 `config.json` 中的 `ServerUrl` 与 `WsUrl` |
| 连接后断开 | 检查网络稳定性，应用会自动重连 |
| WebSocket 地址错误 | 确认 `WsUrl` 指向 3002 端口 |
| 界面显示「登录失败 HTTP 401」 | `Username` / `Password` 不对，或该账号已被删除 |
| 界面显示「登录失败 HTTP 403」 | 该账号不是 `ProjectId` 的成员 |

### 日志导出失败

| 问题 | 解决方案 |
|------|----------|
| 提示「必须提供 from 与 to 时间范围」 | 导出接口不再允许对整个项目历史做无条件查询，界面上选好时间范围即可 |
| 导出结果比预期少 | 单次上限 2 万行，缩小时间范围分几次导 |

### 磁盘被导出文件占满

`storage/exports` 下的文件由 `log-archive` 插件按 `PLUGIN_LOG_RETENTION_DAYS`
自动清理。若该插件被停用（`PLUGIN_LOG_ARCHIVE_ENABLED=false`），导出文件不会
被删除，需要手工清理该目录。

---

## 快速启动检查清单

- [ ] 后端 `.env` 已配置 `JWT_SECRET`
- [ ] 后端已启动（3000 + 3002 端口）
- [ ] 管理员账号已创建
- [ ] 项目已创建（建议填好计划时间，导播端据此把当前/下一场置顶）
- [ ] 导播账号已创建并分配项目权限
- [ ] 导播端已配置服务器地址并登录
- [ ] 解说端/包装端 `config.json` 已配置正确地址（开成员校验时还要填账号）
- [ ] 采访端 `config.dart` 已配置服务器地址和采访点
- [ ] 所有客户端均已连接（检查连接状态指示器）
- [ ] 若要用 `REQUIRE_PROJECT_MEMBERSHIP`：账号已下发、各端都能连上，再打开开关

---

## 附录

### 项目目录结构

```
smart-mzcmc/
├── backend/              # Go 后端（Goravel 框架）
│   ├── app/              # 应用逻辑
│   │   ├── http/         # HTTP 控制器和中间件
│   │   ├── models/       # 数据模型
│   │   ├── plugins/      # 插件系统
│   │   └── ws/           # WebSocket 服务
│   ├── config/           # 配置文件
│   ├── database/         # SQLite 数据库
│   ├── public/           # 静态资源
│   │   ├── admin/        # 管理后台
│   │   └── interviewer/  # 采访端 Web 产物
│   ├── routes/           # 路由定义
│   └── .env              # 环境配置
├── director/             # 导播端 Flutter 项目
├── interviewer/          # 采访端 Flutter 项目
├── CommentatorApp/       # 解说端 C# 项目
├── PackagingApp/         # 包装端 C# 项目
├── plan.md               # 项目开发计划
└── start.bat             # 一键启动脚本（Windows）
```

### WebSocket 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| shot_state | 导播 → 解说/包装 | 切台状态：`current` 当前播送 + `next` 即将切台（空串=已切完） |
| chat | 全部 | 内部消息；`{"message":"heartbeat"}` 为保活心跳，后端不落库不转发 |
| interview_status | 采访端 → 导播/包装 | 采访状态变更，后端会先落库再广播 |
| lock_update | 系统 → 全部 | 控制权变更通知，`payload.reason` 可为 `disconnect` 或 `timeout` |
| system | 系统 → 客户端 | 系统消息（连接成功、权限错误等）；连接成功时带上 `current_shot` |

> `next_shot` / `confirm_switch` 是协议升级前的旧类型，后端已合并进 `shot_state`，
> 收到时只回一条 `system` 错误并丢弃。

### 数据表

| 表 | 用途 |
| :--- | :--- |
| `users` | 账号、密码哈希、角色、令牌版本 |
| `projects` | 项目、日程、场地、状态与模式 |
| `user_projects` | 项目授权关系（`REQUIRE_PROJECT_MEMBERSHIP` 的判定依据） |
| `project_locks` | 控制权及过期时间 |
| `project_states` | 项目当前的切台状态，一个项目一行 |
| `shot_cuts` | 切台流水，用于时间线与报表 |
| `project_cameras` | 机位预设 |
| `interview_status` | 各采访点当前状态 |
| `messages` | 协调日志（WebSocket 消息与操作记录） |
| `audit_logs` | 操作审计 |

### 默认配置值

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 控制权有效期 | 90 秒 | 导播控制权 TTL |
| 心跳间隔 | 30 秒 | 导播端心跳发送间隔 |
| WebSocket 超时 | 60 秒 | 读写超时 |
| 采访端心跳间隔 | 10 秒 | 采访端客户端心跳发送间隔 |
| 采访端掉线阈值 | 90 秒 | 超过此时长没消息即判定离线 |
| 日志保留 | 30 天 | 自动清理旧日志与导出文件 |
| 导出单次上限 | 20000 行 | 超出时间范围的导出会被截断 |
