# Woe 部署指南（Cloudflare Workers）

本指南从零开始：创建全部 Cloudflare 资源 → 配置 → 构建前端 → 部署 Worker → 初始化管理员 → 验证。已部署公开版升级与回滚见文末。

前置要求：

- Cloudflare 账号及 Wrangler 登录（运行 `npx wrangler login`）；Workers、D1、R2、Durable Objects、Queues 和 Images 受账户计划与配额约束
- Node.js ≥ 22.12 与 npm
- 已克隆本仓库并安装依赖：`npm ci`（仓库根）与 `npm ci`（`frontend/` 目录）

## 1. 创建 Cloudflare 资源

```bash
# D1 数据库（记下输出的 database_id，形如 UUID）
npx wrangler d1 create woe-db

# R2 存储桶（应用/用户/插件图标）
npx wrangler r2 bucket create woe-storage

# 可选：只有保留/实现推送传输插件时才需要创建 Queue
# 当前公开版仅含 displayer，默认不会产生 push_outbox 任务
npx wrangler queues create woe-push-queue
```

Durable Object（`MessageStreamHubObject`）不需要单独创建。首次 `wrangler deploy` 会应用 `[[migrations]]` 中的 `v1_message_stream_hub` / `new_sqlite_classes` 并创建 SQLite-backed DO 类；后续部署必须保留该 binding 和迁移历史。

`[images]` 是 Worker 的 Images 优化 binding，用于压缩/转码 R2 中的图片；不需要单独创建 Images 存储资源。

公开版只包含 `displayer`，没有 webhook/mobile-push 传输插件，因此默认不会写入 `push_outbox`，Queue 只是保留的异步扩展点。如果按 `example.wrangler.toml` 原样部署，请创建并保留 Queue；若只运行默认公开功能，可删除配置中的 `[[queues.producers]]` 与 `[[queues.consumers]]` 两段，消息 API 和 WebSocket 仍可工作。之后安装自定义传输插件时再恢复 Queue binding。

## 2. 配置 wrangler.toml

```bash
cp example.wrangler.toml wrangler.toml
```

必须修改的值：

| 配置项 | 说明 |
|---|---|
| `database_id` | 替换为第 1 步 `wrangler d1 create` 输出的 UUID（占位值 `00000000-0000-0000-0000-000000000000` 不是可用值） |
| `workers_dev` | `true` 使用 `*.workers.dev` 域名；或删除该项并配置 `[[routes]]` 自定义域 |
| `name` | Worker 名称（Cloudflare 控制台中显示） |

可选：`REGISTRATION`（是否开放 API 注册，默认 `false`）、`[observability]` 日志与追踪。

公开版不包含厂商移动推送配置。若要接入自定义传输，需在 Worker bootstrap 中注入实现 `PushProvider` 接口的 Provider；配置由该 Provider 自行管理。

## 3. 设置 Secrets

`DEFAULT_ADMIN_USER`（在 `[vars]` 中配置，默认 `admin`）是引导用户名；`DEFAULT_ADMIN_PASSWORD` 是通过 Secret 设置的引导密码。**这组凭据仅用于授权首次初始化，不会自动创建管理员账号，也不能用于日常登录。**

引导密码通过以下命令注入（**不要**写进 `[vars]`——明文密码会随配置泄露）：

```bash
# 云端：强随机值；服务端拒绝已知弱值（password / admin / 123456），弱口令无法触发初始化
npx wrangler secret put DEFAULT_ADMIN_PASSWORD

# 引导用户名在 [vars] 的 DEFAULT_ADMIN_USER 中配置（默认 admin），它不是 Secret
```

本地开发使用 `frontend/` 之外的仓库根 `.dev.vars` 文件（已被 .gitignore 忽略，勿提交）：

```text
DEFAULT_ADMIN_PASSWORD=your-strong-random-password
```

`.dev.vars` 只作用于 `wrangler dev` 本地会话；云端必须用 `wrangler secret put`。两者互不替代。

## 4. 构建与部署

前端产物不提交仓库，部署前必须先构建：

```bash
# 构建前端（含 vue-tsc 类型检查），输出到根 public/（ASSETS 目录）
npm run build:frontend

# 部署（会重新生成 buildInfo，并上传 Worker 与静态资源）
npx wrangler deploy
# 或使用等价脚本：npm run deploy
```

数据库迁移由 Worker 在首次请求时自动执行：先运行入仓的 `0000_initial_schema` 固定基线，再按名称顺序执行后续增量迁移。全新 D1 不需要运行 `drizzle-kit generate`、`db:push` 或手动灌入临时基线。迁移成功后当前 isolate 复用成功状态；同一 isolate 的并发首请求共享一轮迁移。

迁移失败时业务路由不会执行，请求直接返回 HTTP 503：

```json
{"error":"Database migration failed","code":"DATABASE_MIGRATION_FAILED"}
```

响应不包含 SQL、文件路径或堆栈，具体迁移名称只记录在 Worker 日志；失败状态会清除，后续请求可重试。

`0000_initial_schema` 是固定入仓基线，`drizzle-kit generate` 仅用于开发和诊断，不是生产部署步骤。

## 5. 初始化管理员

部署不会自动创建默认管理员账号。首次部署完成后，通过 `/setup` 创建首个实际管理员：

1. 打开 Worker 域名，进入 `/setup` 页面。
2. 在“初始化令牌”的用户名字段填写 `DEFAULT_ADMIN_USER` 的配置值（默认 `admin`），密码字段填写第 3 节设置的 `DEFAULT_ADMIN_PASSWORD` Secret。这组凭据只授权初始化。
3. 在管理员用户名、密码和确认密码字段中填写要创建的实际管理员账号，例如 `woe-owner`，并使用独立的强密码。Web UI 要求管理员密码至少 8 个字符。
4. 提交成功后，使用第 3 步创建的管理员账号登录 Web UI。

建议使用不同的用户名和独立的强密码。**不要让实际管理员的用户名和密码同时与引导凭据完全相同**，否则该组合会被登录认证拒绝；使用相同用户名但不同密码是允许的。

也可通过 API 完成同一流程：

```bash
curl -u "<DEFAULT_ADMIN_USER>:<DEFAULT_ADMIN_PASSWORD>" \
  -X POST https://<your-domain>/api/v1/init/admin \
  -H 'Content-Type: application/json' \
  -d '{"name":"woe-owner","pass":"<独立的管理员强密码>"}'
```

`-u` 中是引导凭据，请求体的 `name` / `pass` 是要创建的实际管理员凭据；请替换示例占位符。API 只校验 `name` / `pass` 非空，请自行选择强密码。

初始化是**一次性**的：成功后再次调用会被拒绝。修改 `DEFAULT_ADMIN_USER` 或 `DEFAULT_ADMIN_PASSWORD` 不会更改已创建的管理员用户名或密码；后续账号管理应使用用户管理功能。

## 6. 验证部署

```bash
# 健康检查（数据库可达性）
curl https://<your-domain>/api/v1/health

# 版本信息（version/commit/buildDate）
curl https://<your-domain>/api/v1/version

# 登录 Web UI，创建应用（获得一次性 app token）并推送一条消息：
curl -H "X-Gotify-Key: <app token>" -H 'Content-Type: application/json' \
  -d '{"title":"hello","message":"world","priority":0}' \
  https://<your-domain>/api/v1/message
```

消息功能冒烟：创建 client（Web UI 或 `POST /client`）→ 用 client token 连接 `/stream` → 用 app token 发消息 → 收到同 id 消息。

## 7. 从已有公开版升级

```bash
git pull            # 获取新版本源码
npm ci && (cd frontend && npm ci)
npm run build:frontend
npx wrangler deploy
```

升级语义与注意事项：

- 数据库迁移自动执行；迁移只前进，不自动回退。
- **内置插件变更**：公开版仅含 displayer。若旧数据库中存在指向已移除内置插件（如 webhooker、push-huawei、push-apns）的插件配置行，这些实例升级后不可加载（modulePath 无法解析），也不会再执行；其配置行保留在数据库中，可手动删除。
- **旧任务与队列**：已存在的 outbox 行、队列中的消息不会被升级流程自动删除，由保留的核心推送管线按既有重试/保留策略处理；如需清理，请用 D1 控制台或 `wrangler d1 execute` 显式操作，部署流程不会自动删数据。
- 回滚：重新部署旧版本 Worker 代码即可（Workers 控制台或 `wrangler rollback`）；回滚不回退数据库 schema——若新版本迁移已执行，旧代码遇到新 schema 应保持兼容（迁移均为加列/加索引形态），部署前建议用 `wrangler d1 execute <db> --remote --command "SELECT ..."` 备份关键表。

## 8. 数据库状态诊断与故障处理

使用只读命令检查远程 D1：

```bash
npx wrangler d1 execute woe-db --remote --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;"
npx wrangler d1 execute woe-db --remote --command "SELECT name, applied_at FROM _migrations ORDER BY id;"
```

- **Fresh**：核心基础表都不存在，且 `_migrations` 不存在或为空；Worker 会自动运行固定基线和增量迁移。
- **Healthy**：核心基础表完整且迁移记录可读；没有 `0000_initial_schema` 记录时只登记基线采用，不重复建表。
- **Inconsistent**：只有部分基础表、迁移记录与结构不符，或已完成迁移的关键对象缺失；Worker 停止迁移并返回 503。

无数据时新建 D1 并重新部署；有数据且结构完整时直接升级；有数据但不一致时先备份，再制定人工修复迁移。部署不会 DROP 表、删除 `_migrations` 或自动重灌基线。

## 9. 故障排查

| 现象 | 排查 |
|---|---|
| `/health` 返回 `red` | D1 绑定不可达：检查 `database_id` 与区域 |
| 请求返回 `503 DATABASE_MIGRATION_FAILED` | 查看 Worker 日志中的迁移名称；确认 D1 权限和资源可达性，修复后重试 |
| 数据库被判定为不一致 | 先备份并执行只读结构检查；不要 DROP 表、删除 `_migrations` 或重复灌入基线 |
| 初始化返回 403/弱口令拒绝 | `DEFAULT_ADMIN_PASSWORD` 是弱值（password/admin/123456）；换强随机值 |
| 前端 404 或旧页面 | 忘记先 `npm run build:frontend`——public/ 未更新 |
| 部署后 `POST /message` 500 | 队列绑定缺失：确认 `queues.producers`/`queues.consumers` 与队列名一致 |
| 图片上传失败 | R2 桶名与 `bucket_name` 不一致，或 Images 绑定未启用 |
