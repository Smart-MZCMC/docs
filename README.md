# smart-mzcmc-docs

绵中融媒体智汇导播系统的文档站，基于 **[VitePress](https://vitepress.dev) 2 + Mermaid** 构建。

包含四份文档：

| 文档 | 内容 |
| :--- | :--- |
| [operation-manual.md](operation-manual.md) | 操作手册：系统概述、安装部署、配置说明、项目授权校验、系统初始化、各端操作指南、API 接口参考、核心机制、故障排查、启动检查清单 |
| [development-guide.md](development-guide.md) | 开发指南：项目结构、后端本地开发、通信协议、权限模型、控制权与业务规则、数据模型与迁移、插件系统、测试与联调、版本与发布 |
| [api-examples.md](api-examples.md) | 接口示例：可直接复制的 curl / JavaScript 调用，含登录换令牌、日程更新语义、游标翻页、切台报表、WebSocket 起来与就绪上报 |
| [plugin-development.md](plugin-development.md) | 插件开发：接口定义、事件表、并发与配置约定、后台展示契约 |

## 本地开发

```bash
pnpm install
pnpm docs:dev        # http://localhost:5173
```

> `base` 配置为 `/docs/`（因为线上挂载在 Go 后端的 `/docs` 前缀下），本地 dev 时页面路径也会带这个前缀；如需以根路径预览，可临时把 `.vitepress/config.mts` 里的 `base` 改成 `'/'`。

## 构建与部署

```bash
pnpm docs:build          # 仅构建，产物在 .vitepress/dist
pnpm run build:deploy    # 构建并推送到 ../backend/public/docs
```

`build:deploy` 等价于 `node scripts/build.mjs`，会依次：

1. `pnpm install`
2. `pnpm docs:build`
3. **校验构建产物里的 base 是不是 `/docs/`** —— base 配错会让线上资源全部 404，而本地构建依然成功，所以这里显式拦截
4. 清空并重写 `../backend/public/docs`
5. 校验 `index.html` 引用的地址都能解析（cleanUrls 生成的页面不带 `.html`，后端会自动补）

参数：`--no-install`、`--skip-build`、`--backend <path>`。

## 配置要点

- `cleanUrls: true` —— 页面链接不带 `.html`，由后端静态站点中间件补 `.html` 解析
- 使用 `vitepress-mermaid-plugin`，因此 Markdown 里可以直接写 mermaid 代码块
- `lastUpdated: true` 依赖 git 提交历史，CI 里需要 `fetch-depth: 0`（见 `.github/workflows/docs.yml`）

## 部署形态

构建产物是纯静态文件（约 130 个），带 `/docs/` 前缀，由 Go 后端的 `routes/staticSite.go` 中间件托管，访问地址 `http://<host>:3000/docs`。
