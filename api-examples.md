---
outline: deep
---

# 接口调用示例

本页是可直接复制执行的调用示例。完整接口清单见
[操作手册的 API 接口参考](./operation-manual.md#api-接口参考)，
协议与实现细节见[开发指南的通信协议](./development-guide.md#通信协议)。

::: tip 约定
下面用 `$BASE` 表示后端 HTTP 根地址（例如 `http://127.0.0.1:3000`），
用 `$WS` 表示 WebSocket 地址（例如 `ws://127.0.0.1:3002/ws`）。
:::

## curl 快速上手

```bash
export BASE=http://127.0.0.1:3000
export WS=ws://127.0.0.1:3002/ws

# 服务状态（公开）
curl -s $BASE/api/status

# 健康检查（公开，真的查库；数据库不可用时返回 503）
curl -s $BASE/api/health
```

## 登录与令牌

```bash
TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123456"}' | jq -r .token)

# 之后所有需要认证的请求都带上它
AUTH="Authorization: Bearer $TOKEN"
```

查看自己是谁：

```bash
curl -s $BASE/api/auth/profile -H "$AUTH"
```

::: warning 改密码会让所有旧令牌立刻失效
`PUT /api/auth/password` 会递增 `token_version`，三处验签点都会比对它。
响应里会返回**新令牌**，调用方必须立刻替换本地存的那一份，否则当前设备
会被自己刚改的密码踢下线。
:::

## 项目与日程

创建项目（管理员及以上）：

```bash
curl -s -X POST $BASE/api/admin/projects \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{
    "name": "春季运动会",
    "code": "spring2026",
    "venue": "田径场",
    "scheduled_start": "2026-05-20T09:00",
    "scheduled_end": "2026-05-20T18:00",
    "status": "planned",
    "mode": "live"
  }'
```

新建项目会自动带上一套默认机位预设，并写一条 `project.create` 审计记录。

**更新**项目。字段语义是「出现了就更新」，空串表示清空：

```bash
# 把描述清空、改成直播中
curl -s -X PUT $BASE/api/admin/projects/1 \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"description": "", "status": "live"}'
```

::: danger 不要用「值是否为空」判断要不要发字段
后端靠**键是否存在**区分「清空」与「不动」。如果你写的是
`if description != "" { body["description"] = ... }`，那么描述一旦设过就再也
清不掉——这正是 1.3.0 及更早版本的 bug，界面上还专门加了一句提示来迁就它。
:::

导播端使用的项目列表（只返回当前账号有权访问的，按「正在直播 > 即将开始 >
无日程 > 已结束」排序）：

```bash
curl -s $BASE/api/projects -H "$AUTH"
```

## 机位预设

```bash
# 读取（任意登录用户，需项目成员身份）
curl -s $BASE/api/projects/1/cameras -H "$AUTH"

# 新增（管理员）
curl -s -X POST $BASE/api/admin/projects/1/cameras \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"终点线"}'

# 改名 / 调顺序
curl -s -X PUT $BASE/api/admin/projects/1/cameras/11 \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"终点冲刺"}'

# 删除
curl -s -X DELETE $BASE/api/admin/projects/1/cameras/11 -H "$AUTH"
```

导播端的预设按钮就是这份列表，`sort_order` 即按钮顺序。此前它们硬编码在
导播端代码里，换个场地就得重新构建。

## 控制权

```bash
# 获取
curl -s -X POST $BASE/api/locks/1/acquire -H "$AUTH"

# 心跳续期（30 秒一次；返回 404 说明锁已丢失，必须按「控制权已丢失」处理）
curl -s -X POST $BASE/api/locks/1/heartbeat -H "$AUTH"

# 查询
curl -s $BASE/api/locks/1/status -H "$AUTH"

# 释放
curl -s -X POST $BASE/api/locks/1/release -H "$AUTH"
```

::: warning 心跳的 404 不能丢
锁被别的导播抢走或过期后，`heartbeat` 返回
`{"error":"未持有控制权，需重新获取"}`。调用点如果把这个响应丢掉，导播会一直
以为自己还持有控制权、继续按切台键，而每次切台都被服务端拒绝——现场表现为
「按钮按了没反应」。
:::

## 日志与导出

查询协调日志：

```bash
curl -s "$BASE/api/logs?project_id=1&type=shot_state&limit=100" -H "$AUTH"

# 时间范围 + 发件人 + 游标翻页
curl -s "$BASE/api/logs?from=2026-05-01&to=2026-05-21T18:00&sender_id=3&limit=100" -H "$AUTH"
```

响应里的 `total` 是**匹配条件的真实总行数**，不是本页长度：

```json
{
  "total": 1284,
  "messages": [],
  "next_cursor": 987,
  "has_more": true
}
```

翻下一页时把 `next_cursor` 原样传回 `cursor`：

```bash
curl -s "$BASE/api/logs?limit=100&cursor=987" -H "$AUTH"
```

用游标而不是页码，是因为日志表在持续写入：偏移量分页会让同一条记录被重复
看到，或者整段跳过。

导出（`from` / `to` 必填，单次上限 2 万行）：

```bash
curl -s -X POST $BASE/api/logs/export \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"from":"2026-05-01","to":"2026-05-21"}'

# 响应里的 truncated 为 true 表示触到了上限，缩小时间范围再导一次
```

清理过期日志（管理员）：

```bash
curl -s -X POST $BASE/api/logs/cleanup \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"days":30}'
```

## 切台报表

```bash
curl -s "$BASE/api/projects/1/shot-cuts?from=2026-05-20&to=2026-05-21" -H "$AUTH"
```

```json
{
  "project_id": 1,
  "total": 12,
  "cuts": [
    {
      "id": 12,
      "from_shot": "全景",
      "to_shot": "跳远",
      "director_id": 3,
      "mode": "live",
      "cut_at": "2026-05-20T10:12:33+08:00"
    }
  ],
  "summary": {
    "cut_count": 12,
    "avg_dwell_seconds": 184.5,
    "by_shot": [{ "shot": "跳远", "count": 3, "avg_dwell_seconds": 95.2 }],
    "by_mode": [
      { "mode": "live", "cut_count": 9 },
      { "mode": "rehearsal", "cut_count": 3 }
    ]
  }
}
```

`avg_dwell_seconds` 不包含最后一段——那一段没有后续切台，停留多久无从得知，
按「到现在为止」算会让这个数字随着你盯着屏幕的时间不断变大。

## 操作审计

```bash
# 最近 100 条
curl -s "$BASE/api/admin/audit-logs?limit=100" -H "$AUTH"

# 按动作筛选（下拉选项由响应里的 actions 字段给出）
curl -s "$BASE/api/admin/audit-logs?action=logs.cleanup" -H "$AUTH"
```

```json
{
  "total": 7,
  "logs": [
    {
      "id": 5,
      "actor_id": 1,
      "actor_username": "r***",
      "action": "logs.cleanup",
      "target_type": "message",
      "target_id": "",
      "detail": "清理 30 天前的协调日志，删除 128 条 {\"days\":30,\"rows_affected\":128}",
      "ip": "127.0.0.1",
      "created_at": "2026-05-21T19:12:10+08:00"
    }
  ],
  "next_cursor": 0,
  "has_more": false,
  "actions": ["camera.create", "logs.cleanup", "project.create"]
}
```

**操作审计与协调日志是两回事**：前者在 `audit_logs` 表（谁改了角色、谁清了
日志），后者在 `messages` 表（谁切了台、谁发了消息）。用户名是脱敏存储的，
精确追溯请用 `actor_id`。

## WebSocket（JavaScript）

```js
// 1) 先换令牌。开启 REQUIRE_PROJECT_MEMBERSHIP 后所有角色都必须带令牌。
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'point_1', password: '******' })
}).then((r) => r.json());

// 2) 建连。采访端还要带 point_code。
const ws = new WebSocket(
  `${WS}?project_id=1&role=interviewer&point_code=point_1` +
    `&token=${encodeURIComponent(login.token)}`
);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'system' && msg.payload.state_available) {
    // 连接与重连时后端都会下发当前切台状态，连上的一瞬间就能渲染，
    // 不必等下一次切台。
    console.log('当前播送：', msg.payload.current_shot);
    console.log('即将切台：', msg.payload.next_shot);
  }

  if (msg.type === 'shot_state') {
    console.log(msg.payload.current, '→', msg.payload.next);
  }
};

// 3) 心跳。载荷里的 ts 供服务端刷新 LastSeen，掉线扫描判断的就是它。
setInterval(() => {
  ws.send(JSON.stringify({
    type: 'chat',
    project_id: 1,
    payload: { message: 'heartbeat', ts: Date.now() }
  }));
}, 10000);

// 4) 页面切到后台时主动上报离线。
//
// 这一条不是优化：记者把浏览器切走或走出 WiFi 覆盖范围时，服务端的
// TCP 连接看起来仍然正常，导播端会一直显示绿色「就绪」。
document.addEventListener('visibilitychange', () => {
  const status = document.hidden ? 'offline' : 'ready';
  ws.send(JSON.stringify({
    type: 'interview_status',
    project_id: 1,
    payload: { point_code: 'point_1', point_name: '采访点 1', status }
  }));
});

// 5) 断线后 WebSocket 已经不可用，改走 HTTP 通知服务端。
ws.onclose = () => {
  navigator.sendBeacon?.(
    `${BASE}/api/interview/status`,
    new Blob(
      [JSON.stringify({
        project_id: 1,
        point_code: 'point_1',
        point_name: '采访点 1',
        status: 'offline'
      })],
      { type: 'application/json' }
    )
  );
};
```

### 导播端上报切台

```js
// 预告：current 不变，next 是准备切过去的机位
ws.send(JSON.stringify({
  type: 'shot_state',
  project_id: 1,
  payload: { current: '全景', next: '跳远' }
}));

// 确认已切：current 变成新机位，next 清空
ws.send(JSON.stringify({
  type: 'shot_state',
  project_id: 1,
  payload: { current: '跳远', next: '' }
}));
```

只有第二条会让 `current` 发生变化，因此**只有它会写入 `shot_cuts` 表**。

::: warning 只接受持有控制权的导播
非导播角色上报 `shot_state` 会被拒绝并回一条 `system` 错误；导播未持锁同样
被拒。被拒的消息仍会写入 `messages` 表并打服务端日志——那是一次真实的越权
尝试，属于审计线索。
:::

### wscat 手工调试

```bash
npx wscat -c "$WS?project_id=1&role=commentator&token=$TOKEN"
```

连上后先收到一条带 `current_shot` 的 `system` 消息，然后才会收到后续的
`shot_state`。
