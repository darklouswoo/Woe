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

Database schema: the migration chain in `src/migrations/sql/` is **incremental** and assumes that the initial tables already exist. Therefore:

- **Fresh deployment (empty D1):** create the baseline schema before deploying:
  ```bash
  # 1. Generate baseline CREATE TABLE SQL into a temporary directory.
  npx drizzle-kit generate --dialect sqlite --schema ./src/models/index.ts --out /tmp/woe-baseline
  # 2a. Apply it to the remote D1 database. The database name comes from wrangler.toml.
  #     Run this before wrangler deploy: the first checked-in migration is ALTER TABLE,
  #     so deploying directly to an empty database fails because the tables are missing.
  npx wrangler d1 execute woe-db --remote --file /tmp/woe-baseline/0000_*.sql

  # 2b. Apply it to the local D1 database for wrangler dev (separate from the remote database).
  npx wrangler d1 execute woe-db --local --file /tmp/woe-baseline/0000_*.sql

  # 3. Deploy. With no migration records, incremental migrations skip already-applied changes.
  npx wrangler deploy
  ```
- **Upgrade of an existing deployment:** deploy the new version directly; incremental migrations run automatically and only move forward.

`--local` and `--remote` operate on separate databases. Applying the baseline locally does not initialize the remote database. Do not apply the baseline again to a database already managed by the migration chain, and do not use `db:push` to alter a production schema.

`wrangler deploy --dry-run` (also used by `npm run build`) performs an offline build check.

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

## 7. Upgrade an existing public deployment

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

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| `/health` returns `red` | Check the D1 binding, `database_id`, and region. |
| Initialization returns 403 or rejects the password | `DEFAULT_ADMIN_PASSWORD` is a weak value (`password`, `admin`, or `123456`); use a strong random value. |
| Frontend returns 404 or shows an old page | Run `npm run build:frontend` before deploying; `public/` must be current. |
| `POST /message` returns 500 | Confirm that `queues.producers` and `queues.consumers` use the same queue binding. |
| Image upload fails | Check that the R2 bucket name matches `bucket_name` and that the Images binding is enabled. |
