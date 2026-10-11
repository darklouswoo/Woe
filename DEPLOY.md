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

管理员初始化凭据通过 Secret 注入（**不要**写进 `[vars]`——明文密码会随配置泄露）：

```bash
# 云端：强随机值；服务端拒绝已知弱值（password / admin / 123456），弱口令无法触发初始化
npx wrangler secret put DEFAULT_ADMIN_PASSWORD

# 用户名在 [vars] 的 DEFAULT_ADMIN_USER 中配置（默认 admin），它不是 Secret
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

# 部署（会先重新生成 buildInfo，再上传 Worker 与静态资产）
npx wrangler deploy
# 或使用等价 script：npm run deploy
```

数据库结构：本仓库的迁移链（`src/migrations/sql/`）是**增量形态**——它假设数据库已存在初始表结构。因此：

- **全新部署（空 D1）**：先建立基线结构，再部署：
  ```bash
  # 1. 从当前 schema 生成基线建表 SQL（输出到临时目录，不进入仓库）
  npx drizzle-kit generate --dialect sqlite --schema ./src/models/index.ts --out /tmp/woe-baseline
  # 2a. 灌入云端 D1（数据库标识取 wrangler.toml 的 database_name；需 wrangler 登录）
  #     ——必须在 wrangler deploy 之前执行：本仓库首个迁移是 ALTER TABLE，
  #     空库直接部署会因缺表而初始化失败
  npx wrangler d1 execute woe-db --remote --file /tmp/woe-baseline/0000_*.sql

  # 2b. 灌入本地 D1（仅 wrangler dev 本地开发用；与云端库相互独立）
  npx wrangler d1 execute woe-db --local --file /tmp/woe-baseline/0000_*.sql

  # 3. 部署；迁移记录为空，增量迁移按幂等冲突跳过，不重复生效
  npx wrangler deploy
  ```
- **升级既有部署**：直接部署新版本——增量迁移自动执行（只前进，不自动回退）。

`--local` 与 `--remote` 操作的是两个独立的数据库：只灌本地基线不会初始化云端库；
云端全新部署必须在 deploy 前完成 `--remote` 基线。不要在已由迁移管理的库上
重复灌入基线或用 `db:push` 改结构。

`wrangler deploy --dry-run`（`npm run build`）可做不出网的构建校验。

## 5. 初始化管理员

部署完成后（首次、数据库为空时）：

- 浏览器：打开 Worker 域名，按 Setup 引导输入用户名/密码；
- API：`curl -u "<DEFAULT_ADMIN_USER>:<DEFAULT_ADMIN_PASSWORD>" -X POST https://<your-domain>/api/v1/init/admin -H 'Content-Type: application/json' -d '{"name":"admin","pass":"<管理员密码>"}'`（请求字段是 `name` / `pass`）

初始化是**一次性**的：成功后再次调用会被拒绝（`is_initialized` 状态守卫）。`DEFAULT_ADMIN_*` 凭据仅用于触发初始化，不能用于日常登录——初始化成功后即可在 Web UI 登录刚创建的管理员账号。

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

## 8. 故障排查

| 现象 | 排查 |
|---|---|
| `/health` 返回 `red` | D1 绑定不可达：检查 `database_id` 与区域 |
| 初始化返回 403/弱口令拒绝 | `DEFAULT_ADMIN_PASSWORD` 是弱值（password/admin/123456）；换强随机值 |
| 前端 404 或旧页面 | 忘记先 `npm run build:frontend`——public/ 未更新 |
| 部署后 `POST /message` 500 | 队列绑定缺失：确认 `queues.producers`/`queues.consumers` 与队列名一致 |
| 图片上传失败 | R2 桶名与 `bucket_name` 不一致，或 Images 绑定未启用 |
