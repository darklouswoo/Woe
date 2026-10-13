# Woe

Gotify 兼容的自托管通知服务，运行在 Cloudflare Workers 上。Woe 提供 REST API、WebSocket 消息流和用于服务管理的 Web UI，支持消息、应用、客户端、用户与插件管理。

## 功能

- **消息 API**：兼容 Gotify 的 `POST /message`，支持 JSON、form、multipart、query 绑定以及 extras 字段。
- **实时消息流**：通过 `/stream` 和 client token 订阅消息，支持 `ping`/`pong` 保活。
- **Web UI**：登录、消息浏览与 Markdown 渲染、应用/客户端/用户管理、插件配置。
- **多用户与媒体**：管理员提权、注册开关、凭据轮换与过期；图标存储在 Cloudflare R2 并支持默认图兜底。

## 认证与消息契约

- Basic Authentication 用于用户操作、管理员提权和初始化。
- Application Token（`X-Gotify-Key`）用于 `POST /message`；Client Token 用于 Web/客户端会话和 `/stream`；Bearer 与 `X-Gotify-Key` 等价。
- 新签发的 app/client token 使用 `gtfy…` EdDSA 格式，历史 `A…`/`C…` 格式仍有效；完整 token 只在创建或轮换响应中返回。
- `priority` 接受 **0..3** 的整数，超出范围的显式值返回 400。

## 首次初始化与登录

**首次部署不会自动创建默认管理员账号。** `DEFAULT_ADMIN_USER`（默认 `admin`）和 `DEFAULT_ADMIN_PASSWORD`（通过 Wrangler Secret 设置）仅用于授权首次初始化，不能用于日常登录。

部署后打开 `/setup`：先在“初始化令牌”的用户名/密码字段中填写上述引导凭据，再设置首个实际管理员的用户名、密码和确认密码。初始化成功后，使用新创建的管理员账号登录。

建议为实际管理员使用不同的用户名和独立的强密码。**不要让实际管理员的用户名和密码同时与引导凭据完全相同**，否则该组合会被登录认证拒绝。初始化只能成功一次；修改 `DEFAULT_ADMIN_*` 不会更改已创建的管理员账号。

详细步骤见[部署指南的“初始化管理员”](DEPLOY.md#5-初始化管理员)。

## 公开插件边界

公开版只包含 **displayer** 展示插件：它把消息渲染为独立展示页（`GET /display/{id}`），不执行 Webhook 或移动推送。

移动推送和 Webhook 传输插件不包含在公开仓库中；核心推送管线和插件 API 仍保留为扩展点。未安装传输插件时，新消息不会触发移动推送或 Webhook 调用。

## 文档入口

- [中文部署指南](DEPLOY.md)：资源创建、配置、Secrets、构建、部署、初始化、升级和故障排查。
- [English deployment guide](DEPLOY.en.md)

## License

[GPL-3.0-only](LICENSE)
