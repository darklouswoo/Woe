# Woe Deployment Guide (Cloudflare Workers)

This guide covers a fresh deployment: create the Cloudflare resources, configure the Worker, build the frontend, deploy the Worker, initialize the administrator, and verify the service. Upgrade and rollback instructions are at the end.

Prerequisites:

- A Cloudflare account and Wrangler login (`npx wrangler login`); Workers, D1, R2, Durable Objects, Queues, and Images are subject to your account plan and quotas
- Node.js ≥ 22.12 and npm
- A clone of this repository with dependencies installed: `npm ci` at the repository root and `npm ci` in `frontend/`

## 1. Create Cloudflare resources

```bash
# D1 database (save the database_id, which is a UUID)
npx wrangler d1 create woe-db

# R2 bucket for application, user, and plugin icons
npx wrangler r2 bucket create woe-storage

# Optional: create this only when a push transport plugin is installed or implemented.
# The public build ships only displayer and produces no push_outbox jobs by default.
npx wrangler queues create woe-push-queue
```

The Durable Object (`MessageStreamHubObject`) does not need to be created separately. The first `wrangler deploy` applies the `v1_message_stream_hub` / `new_sqlite_classes` migration and creates the SQLite-backed DO class; later deployments must retain the binding and migration history.

The `[images]` section is the Worker Images optimization binding used to compress/transform images before storing them in R2; it does not require a separate Images storage resource.

The public build contains only `displayer`, with no webhook or mobile-push transport plugin, so it does not write `push_outbox` jobs by default. Queue is retained as an asynchronous extension point. If you deploy the example configuration unchanged, create and keep the Queue. For the default public functionality, you may remove the `[[queues.producers]]` and `[[queues.consumers]]` blocks; the message API and WebSocket stream still work. Restore the Queue binding when installing a custom transport plugin.

## 2. Configure wrangler.toml

```bash
cp example.wrangler.toml wrangler.toml
```

Required changes:

| Setting | Description |
|---|---|
| `database_id` | Replace with the UUID returned by `wrangler d1 create` in step 1. The placeholder `00000000-0000-0000-0000-000000000000` is not usable. |
| `workers_dev` | Set to `true` to use a `*.workers.dev` hostname, or remove it and configure `[[routes]]` for a custom domain. |
| `name` | The Worker name shown in the Cloudflare dashboard. |

Optional settings include `REGISTRATION` (whether API registration is open; default `false`) and `[observability]` logging and tracing.

The public build contains no vendor-specific mobile-push configuration. To add a transport, inject a `PushProvider` implementation from the Worker bootstrap and let that provider own its configuration.

## 3. Set secrets

Inject the administrator initialization credential as a Secret (**do not** put it in `[vars]`, because a plaintext password would be exposed with the configuration):

```bash
# Use a strong random value. The server rejects known weak values
# (password / admin / 123456), which cannot trigger initialization.
npx wrangler secret put DEFAULT_ADMIN_PASSWORD

# DEFAULT_ADMIN_USER is configured in [vars] (default: admin); it is not a Secret.
```

For local development, use a `.dev.vars` file at the repository root, outside `frontend/` (it is ignored by `.gitignore` and must not be committed):

```text
DEFAULT_ADMIN_PASSWORD=your-strong-random-password
```

`.dev.vars` applies only to a local `wrangler dev` session. Cloud deployments must use `wrangler secret put`; the two mechanisms are independent.

## 4. Build and deploy

Frontend assets are not committed. Build them before deployment:

```bash
# Build the frontend, including vue-tsc type checking, into root public/ (the ASSETS directory)
npm run build:frontend

# Deploy (regenerates buildInfo before uploading the Worker and static assets)
npx wrangler deploy
# Equivalent script: npm run deploy
```

The Worker runs migrations on the first request: it applies the checked-in `0000_initial_schema` baseline and then the remaining migrations in name order. A fresh D1 does not require `drizzle-kit generate`, `db:push`, or a hand-generated baseline file. A successful migration is reused within the Worker isolate, and concurrent first requests share one migration run.

If migration fails, no business route runs and the request returns HTTP 503:

```json
{"error":"Database migration failed","code":"DATABASE_MIGRATION_FAILED"}
```

The response does not expose SQL, file paths, or stack traces. The migration name is logged server-side; a failed state is cleared so a later request can retry.

`0000_initial_schema` is a fixed checked-in baseline. `drizzle-kit generate` remains a development and diagnostic tool, not a production deployment step.

## 5. Initialize the administrator

After deployment, when the database is empty for the first time:

- **Browser:** open the Worker hostname and follow the Setup flow.
- **API:**
  ```bash
  curl -u "<DEFAULT_ADMIN_USER>:<DEFAULT_ADMIN_PASSWORD>" \
    -X POST https://<your-domain>/api/v1/init/admin \
    -H 'Content-Type: application/json' \
    -d '{"name":"admin","pass":"<administrator-password>"}'
  ```

The request body fields are `name` and `pass`. Initialization is one-time: a second request is rejected by the `is_initialized` guard. `DEFAULT_ADMIN_*` credentials only trigger initialization; after it succeeds, sign in to the Web UI with the administrator account you created.

## 6. Verify the deployment

```bash
# Health check (database reachability)
curl https://<your-domain>/api/v1/health

# Version information (version/commit/buildDate)
curl https://<your-domain>/api/v1/version

# After signing in, create an application and send a message with its one-time token:
curl -H "X-Gotify-Key: <app token>" -H 'Content-Type: application/json' \
  -d '{"title":"hello","message":"world","priority":0}' \
  https://<your-domain>/api/v1/message
```

Message smoke test: create a client (through the Web UI or `POST /client`), connect to `/stream` with its client token, send a message with the application token, and verify that the same message id is received.

## 8. Upgrade an existing public deployment

```bash
git pull
npm ci && (cd frontend && npm ci)
npm run build:frontend
npx wrangler deploy
```

Upgrade notes:

- Database migrations run automatically and only move forward; they are not rolled back automatically.
- **Built-in plugins:** the public build contains only `displayer`. If an older database contains plugin configuration rows for removed built-in plugins such as `webhooker`, `push-huawei`, or `push-apns`, those instances cannot load because their module paths no longer resolve and they will not execute. Their configuration rows remain in the database and may be deleted manually.
- **Existing tasks and queue entries:** the upgrade does not automatically delete existing outbox rows or queued messages. The retained core push pipeline handles them according to its retry and retention behavior. Use the D1 console or `wrangler d1 execute` for explicit cleanup.
- **Rollback:** redeploy an older Worker version from the Workers dashboard or with `wrangler rollback`. Rollback does not revert the database schema. If a newer migration has run, older code should remain compatible because migrations only add columns or indexes; back up important tables with `wrangler d1 execute <db> --remote --command "SELECT ..."` before deployment when needed.

## 9. Database diagnosis and recovery

Use read-only checks against the remote D1 database:

```bash
npx wrangler d1 execute woe-db --remote --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;"
npx wrangler d1 execute woe-db --remote --command "SELECT name, applied_at FROM _migrations ORDER BY id;"
```

- **Fresh**: no core tables exist and `_migrations` is absent or empty. The Worker applies the fixed baseline and all pending migrations.
- **Healthy**: all core tables exist and migration records are readable. If `0000_initial_schema` is missing, the Worker records the baseline as adopted without recreating tables.
- **Inconsistent**: only part of the core schema exists, records disagree with the schema, or a completed migration is missing a required object. The Worker stops and returns 503.

For an empty deployment, create a new D1 and deploy again. For a complete existing schema, upgrade directly. For a data-bearing inconsistent database, back it up and design a manual repair migration. Deployment never drops tables, deletes `_migrations`, or automatically reapplies the baseline.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `/health` returns `red` | Check the D1 binding, `database_id`, and region. |
| Requests return `503 DATABASE_MIGRATION_FAILED` | Check the migration name in Worker logs, fix D1 access or the reported schema issue, then retry. |
| The database is reported inconsistent | Back up the database and perform the read-only schema checks below; do not drop tables, delete `_migrations`, or reapply the baseline. |
| Initialization returns 403 or rejects the password | `DEFAULT_ADMIN_PASSWORD` is a weak value (`password`, `admin`, or `123456`); use a strong random value. |
| Frontend returns 404 or shows an old page | Run `npm run build:frontend` before deploying; `public/` must be current. |
| `POST /message` returns 500 | Confirm that `queues.producers` and `queues.consumers` use the same queue binding. |
| Image upload fails | Check that the R2 bucket name matches `bucket_name` and that the Images binding is enabled. |
