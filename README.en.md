# Woe

Woe is a self-hosted, Gotify-compatible notification service running on Cloudflare Workers. It provides a REST API, a WebSocket message stream, and a Web UI for managing messages, applications, clients, users, and plugins.

## Features

- **Message API**: Gotify-compatible `POST /message` with JSON, form, multipart, query binding, and extras fields.
- **Real-time stream**: subscribe through `/stream` with a client token; text `ping`/`pong` keep-alive is supported.
- **Web UI**: login, message browsing with Markdown rendering, application/client/user management, and plugin configuration.
- **Multi-user and media**: administrator elevation, registration toggle, credential rotation and expiry; icons are stored in Cloudflare R2 with a default-image fallback.

## Authentication and message contract

- Basic Authentication is used for user operations, administrator elevation, and initialization.
- Application Tokens (`X-Gotify-Key`) send messages to `POST /message`; Client Tokens serve Web/client sessions and `/stream`; Bearer is equivalent to `X-Gotify-Key`.
- Newly issued app/client tokens use the `gtfy…` EdDSA format. Legacy `A…`/`C…` tokens remain valid, and full tokens are returned only by create or rotate responses.
- `priority` accepts integers from **0..3**. Explicit values outside that range return 400.

## First-time setup and sign-in

**Deployment does not automatically create a default administrator account.** `DEFAULT_ADMIN_USER` (default: `admin`) and `DEFAULT_ADMIN_PASSWORD` (set through a Wrangler Secret) only authorize first-time initialization; they are not credentials for everyday sign-in.

After deployment, open `/setup`. Enter the bootstrap credentials in the “Initialization Token” username/password fields, then choose the first actual administrator's username, password, and password confirmation. Once initialization succeeds, sign in with the administrator account you created.

Use a different username and an independent strong password for the administrator account. **Do not reuse both the bootstrap username and password as the administrator's credentials**, because sign-in rejects that exact combination. Initialization can succeed only once; changing `DEFAULT_ADMIN_*` does not change an existing administrator account.

See [Initialize the administrator](DEPLOY.en.md#5-initialize-the-administrator) for the full steps.

## Public plugin boundary

The public build contains only **displayer**, a display-plugin example that renders messages on a standalone page (`GET /display/{id}`). It does not execute webhook or mobile-push actions.

Mobile-push and webhook transport plugins are not included in the public repository. The core push pipeline and plugin API remain extension points; without a transport plugin, new messages do not trigger mobile pushes or webhook calls.

## Documentation

- [中文部署指南](DEPLOY.md)
- [English deployment guide](DEPLOY.en.md): resource creation, configuration, secrets, build, deployment, initialization, upgrades, and troubleshooting.

## License

[GPL-3.0-only](LICENSE)
