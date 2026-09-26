# 插件开发指南

后端内置了一套极简的插件机制：实现接口 → 注册 → 随事件回调。插件与主流程完全解耦，
任何插件 panic 都不会影响 WebSocket 服务和 HTTP 接口。

现有三个内置插件可以直接当模板抄：

| 插件 | 作用 | 值得参考的地方 |
| :--- | :--- | :--- |
| `ntfy-alert` | 把告警事件推到 ntfy | 配置解析、开关判定、脱敏输出 |
| `log-archive` | 定期清理过期日志 | 后台 goroutine + 定时器 + 幂等 Stop |
| `csv-export` | 日志导出接口 | 空插件 + HTTP handler |

---

## 快速上手

三步：实现 `Plugin` 接口 → 在 `main.go` 的 `initPlugins()` 里 `Register` → 如需在后台可见，
再实现 `Describable`。

```go
package plugins

import "log"

// ShoutPlugin 示例：收到导播掉线就写一行日志
type ShoutPlugin struct {
	// enabled 决定 OnEvent 里要不要干活
	enabled bool
}

func NewShoutPlugin(enabled bool) *ShoutPlugin {
	return &ShoutPlugin{enabled: enabled}
}

func (s *ShoutPlugin) Name() string    { return "shout" }
func (s *ShoutPlugin) Version() string { return "0.1.0" }
func (s *ShoutPlugin) Stop()            {}

// OnEvent 由后端在独立 goroutine 里调用，见下文「并发约定」
func (s *ShoutPlugin) OnEvent(event Event) {
	if !s.enabled {
		return
	}
	if event.Type != "director_disconnect" {
		return
	}
	log.Printf("[Shout] 导播 %d 掉线了，项目 %d", event.UserID, event.ProjectID)
}

// Describe 可选，但强烈建议实现：不实现的话后台只能显示「已启用、无配置」
func (s *ShoutPlugin) Describe() Descriptor {
	d := Descriptor{
		Name:        s.Name(),
		Version:     s.Version(),
		Description: "导播掉线时写一行日志（示例插件）",
		Enabled:     s.enabled,
		Config:      map[string]string{},
	}
	if !s.enabled {
		d.Reason = "已通过 PLUGIN_SHOUT_ENABLED=false 关闭"
	}
	return d
}
```

注册：

```go
// backend/main.go
func initPlugins() {
	// ...
	plugins.Register(plugins.NewShoutPlugin(cfg.GetBool("plugins.shout.enabled", true)))
}
```

---

## 接口定义

```go
// backend/app/plugins/plugin.go
type Plugin interface {
	Name() string
	Version() string
	OnEvent(event Event)
	Stop()
}
```

| 方法 | 要求 |
| :--- | :--- |
| `Name()` | 全局唯一，建议用小写连字符，如 `ntfy-alert` |
| `Version()` | 语义化版本，后台会原样显示 |
| `OnEvent(Event)` | 收到事件时回调。**必须自己保证线程安全，且不能阻塞太久** |
| `Stop()` | 释放资源。会被 `StopAll()` 调用，需要**幂等**（可重复调用不 panic） |

### Describable：让配置在后台可见

```go
type Descriptor struct {
	Name        string            `json:"name"`
	Version     string            `json:"version"`
	Description string            `json:"description"`
	Enabled     bool              `json:"enabled"`
	Reason      string            `json:"reason,omitempty"` // 为什么没启用；启用时留空
	Config      map[string]string `json:"config"`           // 脱敏后的生效配置
}

type Describable interface {
	Describe() Descriptor
}
```

`Describable` 是**可选**接口。没实现它也能注册，`List()` 会合成一份最小描述
（视为启用、配置为空），但后台就看不出任何配置细节了。

`Descriptor` 会被 `GET /api/plugins` 原样序列化，前端 `PluginInfo` 类型与之对应。
新增字段时记得同步 `admin/src/lib/api/types.ts`。

**`Config` 里只放脱敏后的值。** 需要展示机密时用 `plugins.MaskSecret(v)`：

```go
Config: map[string]string{
    "server": n.serverURL,
    "topic":  MaskSecret(n.topic), // super_secret_topic_xyz -> su****yz
},
```

---

## 事件

```go
type Event struct {
	Type      string
	ProjectID uint
	UserID    uint
	Data      map[string]any
}
```

目前后端**实际发出**的事件只有三个，全部来自 `app/ws/hub.go`：

| `Type` | 触发时机 | `Data` |
| :--- | :--- | :--- |
| `director_disconnect` | 导播 WebSocket 断开 | 空 |
| `lock_acquire` | 导播连接后自动抢到控制权 | 空 |
| `lock_release` | 控制权被释放 | `{"reason": "disconnect"}` |

`NtfyAlert` 里还处理了 `lock_timeout` / `interview_offline` / `system_error`，
但后端目前**没有对应的 Emit 站点**。你可以照这几个类型先写好分支，
等后端补上触发点时插件无需改动。

### 发出新事件

在 `app/ws/hub.go` 的合适位置加：

```go
plugins.Emit(plugins.Event{
	Type:      "lock_timeout",
	ProjectID: c.ProjectID,
	UserID:    c.UserID,
	Data:      map[string]any{"expired_at": lock.ExpireAt.Unix()},
})
```

约定：

- `Emit` 会对每个插件起一个新 goroutine，所以**调用点不会被阻塞**，可以放心在
  连接处理流程里调用。
- 每个 goroutine 里有 `recover`，单个插件 panic 只会被记一行日志，不会拖垮进程。
- 但 `Emit` 本身**没有并发上限**。如果事件很频繁（例如每条消息都发），
  且插件处理较重，请在自己的插件里加限流。
- 想加新事件类型，请同步更新本页表格、`Event` 结构体注释、
  `NtfyAlert.OnEvent` 的 switch，以及 `docs/development-guide.md` 的协议章节。

---

## 并发约定

```go
// backend/app/plugins/plugin.go
func Emit(event Event) {
	defaultRegistry.mu.RLock()
	defer defaultRegistry.mu.RUnlock()

	for _, p := range defaultRegistry.plugins {
		go func(plugin Plugin) {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[Plugin] %s 处理事件 panic: %v", plugin.Name(), r)
				}
			}()
			plugin.OnEvent(event)
		}(p)
	}
}
```

要点：

1. **每次事件都是新 goroutine。** 不要假设两次 `OnEvent` 顺序执行——
   它们的完成顺序是未定义的。需要保序就在插件内部加锁或用 channel 串行化。
2. **同一插件的多次回调可能并发。** 共享状态必须加 `sync.Mutex`，
   或用 `sync/atomic`。
3. **别在 `OnEvent` 里长时间阻塞。** 例如发 HTTP 请求务必设 `Timeout`
   （`ntfy-alert` 用的是 10 秒）。
4. **不要从 `OnEvent` 里操作 `messages` 表去删改刚写入的行。** 事件是在入库之后
   异步发出的，事务已经结束。

### 带后台任务的插件

参考 `log-archive`：

```go
type LogArchive struct {
	stopCh   chan struct{}
	stopOnce sync.Once
}

func (l *LogArchive) Start() {
	if !l.enabled {
		log.Printf("[LogArchive] 已停用: %s", l.reason)
		return
	}
	go l.run()
}

func (l *LogArchive) run() {
	ticker := time.NewTicker(l.checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			l.cleanup()
		case <-l.stopCh:
			return
		}
	}
}

// sync.Once 保证幂等：Start 没跑过也能安全 Stop，重复调用不会 panic。
func (l *LogArchive) Stop() {
	l.stopOnce.Do(func() { close(l.stopCh) })
}
```

`Start()` **不是** `Plugin` 接口的一部分，由 `main.go` 在 `Register` 之后显式调用。
`Stop()` 在没有 `Start()` 过的情况下也必须安全。

---

## 配置约定

三段式，和现有插件保持一致：

**1. 在 `backend/config/plugins.go` 声明读取环境变量**

```go
config.Add("plugins", map[string]any{
	"shout": map[string]any{
		"enabled": config.Env("PLUGIN_SHOUT_ENABLED", true),
		"loud":    config.Env("PLUGIN_SHOUT_LOUD", "normal"),
	},
})
```

**2. 在 `backend/.env.example` 补上说明**

```dotenv
# shout：示例插件
PLUGIN_SHOUT_ENABLED=true
PLUGIN_SHOUT_LOUD=normal
```

**3. 在 `main.go` 读出来传进构造函数**

```go
plugins.Register(plugins.NewShoutPlugin(plugins.ShoutConfig{
	Enabled: cfg.GetBool("plugins.shout.enabled", true),
	Loud:    cfg.GetString("plugins.shout.loud", "normal"),
}))
```

### 开关的两种写法

| 场景 | 写法 |
| :--- | :--- |
| 布尔开关 | `Enabled bool`，停用时 `Reason` 写「已通过 XXX=false 关闭」 |
| 三态开关 | `Enabled string`（空 / `"true"` / `"false"`），留空时按配置是否齐全自动判断 |

三态写法见 `NtfyAlert`：`NTFY_SERVER` 和 `NTFY_TOPIC` 都配了才启用，
只配一个视为配置错误并停用——**宁可明确报「未配置」，也不要让告警静默丢失**。

```go
switch strings.ToLower(strings.TrimSpace(cfg.Enabled)) {
case "false", "0", "off", "no":
	n.reason = "已通过 PLUGIN_NTFY_ENABLED=false 关闭"
case "true", "1", "on", "yes":
	// 显式要求开启，但配置不全时仍拒绝启用
default:
	// 按 server/topic 是否齐全自动判断
}
```

**注意：停用的插件依然要 `Register`。** 这样后台能显示「已停用」以及停用原因，
而不是让插件凭空消失导致「我明明配了怎么没生效」查不到。

---

## 后台展示

`GET /api/plugins`（需 JWT）返回 `[]Descriptor`：

```json
[
  {
    "name": "ntfy-alert",
    "version": "1.0.0",
    "description": "把导播掉线、控制权超时、采访点离线等事件推送到 ntfy",
    "enabled": false,
    "reason": "未配置 NTFY_SERVER / NTFY_TOPIC",
    "config": { "server": "https://ntfy.example.com", "topic": "su****yz" }
  },
  {
    "name": "log-archive",
    "version": "1.0.0",
    "description": "定期删除超过保留天数的消息日志",
    "enabled": true,
    "config": { "retention_days": "30 天", "check_interval": "1h0m0s" }
  }
]
```

后台「插件与统计」页直接渲染这份数据：未启用时用灰色「已停用」标签并显示 `reason`，
下方列出 `config` 每个键值。改完 `.env` 重启后端即可看到变化。

---

## 暴露 HTTP 接口

如果你的插件要提供 API，把 handler 写成包级函数，在 `backend/routes/web.go` 注册：

```go
// app/plugins/shout.go
func ShoutHandler(ctx http.Context) http.Response {
	return ctx.Response().Json(200, map[string]any{"ok": true})
}
```

```go
// routes/web.go（放在 Jwt 中间件组内）
r.Get("/api/shout", plugins.ShoutHandler)
```

handler 用 `github.com/goravel/framework/contracts/http` 的 `http.Context`，
错误统一返回 `ctx.Response().Json(500, map[string]any{"error": "..."})`。

停用的插件，其 handler 应该在函数开头就返回 503 或明确错误，别让调用方以为它还活着。
`csv-export` 目前就是无条件暴露的——如果你新增的插件也需要按开关控制接口，
记得自己加这道判断。

---

## 联调

```sh
cd backend
go build ./...
go vet ./...
```

启动后确认插件注册和配置解析：

```sh
go run .            # 启动，日志里应有 [Plugin] 注册插件: xxx v1.0.0
curl -H "Authorization: Bearer <token>" http://127.0.0.1:3000/api/plugins
```

推荐的验证顺序：

1. **不配置**就跑一次，确认日志里是「未启用」且 `reason` 说得清原因。
2. 只配一半再跑一次，确认不会误启用。
3. 配齐后跑一次，确认 `/api/plugins` 里 `enabled: true` 且 `config` 值正确、
   机密已脱敏。
4. 手动断开一个导播 WebSocket，确认 `director_disconnect` 回调被触发。
5. 故意在 `OnEvent` 里 `panic` 一次，确认主流程不受影响、日志有
   `[Plugin] xxx 处理事件 panic`。

---

## 注意事项

- `Register` 可以在启动阶段多次调用；`StopAll` 会对所有已注册插件调 `Stop`。
  重复注册同名插件**不会**去重，后台会显示两条——注意别写两次 `initPlugins`。
- 插件包的 `init()` **不要**调用 `Register`。配置要在 `config` 加载之后才拿得到，
  统一在 `main.go` 的 `initPlugins()` 里注册。
- 不要在插件里 `log.Fatal` / `os.Exit`，会直接杀掉整个后端。
- 插件需要访问数据库时用 `github.com/goravel/framework/facades` 的 `Orm()`，
  和主流程共用连接池，注意别在 `OnEvent` 里跑长事务。
- 新增配置项后要同步四处：`config/plugins.go`、`.env.example`、
  `backend/README.md` 的插件配置表、本页的配置约定。

---

## 相关文件

| 路径 | 内容 |
| :--- | :--- |
| `backend/app/plugins/plugin.go` | `Plugin` / `Describable` / `Descriptor` / `Event` / 注册中心 |
| `backend/app/plugins/ntfy_alert.go` | 三态开关、脱敏、HTTP 推送的参考实现 |
| `backend/app/plugins/log_archive.go` | 后台 goroutine、定时器、幂等 Stop 的参考实现 |
| `backend/app/plugins/handlers.go` | 内置插件的 HTTP handler |
| `backend/config/plugins.go` | 插件配置项定义 |
| `backend/main.go` | `initPlugins()` 装配入口 |
| `admin/src/lib/api/types.ts` | 前端 `PluginInfo` 类型，需与 `Descriptor` 同步 |
