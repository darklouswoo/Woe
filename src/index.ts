







import app from "./app.ts";
import { Env } from "./types/index.ts";
import { MessageStreamHubObject } from "./durable/messageStreamHub.ts";



const backendPrefixes = [
  "/api",


  "/auth",
  "/init",
  "/current",
  "/user",
  "/application",
  "/client",
  "/message",
  "/plugin",
  "/stream",
  "/image",
  "/health",
  "/version",
  "/gotifyinfo",
  "/status"
];






const exactBackendPaths = ["/static/defaultapp.png"];

export default {




  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;


    const isBackendRequest = backendPrefixes.some(prefix =>
      path === prefix || path.startsWith(prefix + "/")
    ) || exactBackendPaths.includes(path);


    if (!isBackendRequest) {
      if (env.ASSETS) {
        try {

          let response = await env.ASSETS.fetch(request.clone());



          if (response.status === 404 && !path.includes(".")) {
            const indexUrl = new URL(request.url);
            indexUrl.pathname = "/index.html";
            response = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));


            if (response.status >= 300 && response.status < 400 && response.headers.has("Location")) {
              const redirectUrl = response.headers.get("Location");
              if (redirectUrl) {
                const newRequest = new Request(new URL(redirectUrl, request.url).toString(), request);
                response = await env.ASSETS.fetch(newRequest);
              }
            }
          }








          if (
            (response.status >= 200 && response.status < 300) ||
            response.status === 304
          ) {
            const responseHeaders = new Headers(response.headers);

            if (path.startsWith("/assets/")) {
              responseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
            } else {
              responseHeaders.set("Cache-Control", "public, max-age=3600");
            }
            return new Response(
              response.status === 304 ? null : response.body,
              {
                status: response.status,
                headers: responseHeaders,
              }
            );
          }
        } catch (error) {
          console.error("Error serving assets:", error);
        }
      }




      if (!path.includes(".") || path === "/") {
        return new Response(
          `Frontend asset not found for path: ${path}. Please ensure the frontend is built ('npm run build') and the 'public' directory exists.`,
          { status: 404, headers: { "Content-Type": "text/plain" } }
        );
      }
    }


    return app.fetch(request, env, ctx);
  },





  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log("Scheduled task triggered, cron:", event.cron);
    const { CleanupService } = await import('./services/cleanupService.ts');
    const cleanupService = new CleanupService(env.DB);
    await cleanupService.cleanupOldPluginLogs(30);


    try {
      const { createDrizzle } = await import('./drizzle/index.ts');
      const drizzle = createDrizzle(env.DB);

      const { PushOutboxService } = await import('./services/push/outboxService.ts');
      const outbox = new PushOutboxService(drizzle);
      const reclaimed = await outbox.reclaimStaleProcessing();
      if (reclaimed > 0) {
        console.log(`Push reconciliation: reclaimed ${reclaimed} stale processing jobs`);
      }

      const { PushConfigService } = await import('./services/push/configService.ts');
      const configService = new PushConfigService(drizzle);
      const config = await configService.getRuntimeConfig();
      const { createProviderRegistry } = await import('./services/push/providers/registry.ts');
      const providers = createProviderRegistry();

      const { PushDispatcher } = await import('./services/push/dispatcher.ts');
      const dispatcher = new PushDispatcher(outbox, providers, {
        maxRetries: config.maxRetries,
        retryBackoffMs: config.retryBackoffMs
      });
      await dispatcher.runOnce();

      await cleanupService.cleanupPushOutbox(30);
    } catch (error) {
      console.error('Scheduled push reconciliation failed:', error);
    }





    try {
      const { createDrizzle } = await import('./drizzle/index.ts');
      const drizzle = createDrizzle(env.DB);
      const { DurableObjectMessageStreamHub } = await import('./services/messageStreamHub.ts');
      const streamHub = env.MESSAGE_STREAM_HUB
        ? new DurableObjectMessageStreamHub(env.MESSAGE_STREAM_HUB)
        : undefined;
      const { cleanupExpiredClients } = await import('./services/clientExpiry.ts');
      const deleted = await cleanupExpiredClients(drizzle, streamHub);
      if (deleted > 0) {
        console.log(`Expired client cleanup: deleted ${deleted} expired clients`);
      }
    } catch (error) {
      console.error('Scheduled expired client cleanup failed:', error);
    }
  },





  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.PUSH_QUEUE) {
      console.error("PUSH_QUEUE binding is missing");
      batch.retryAll();
      return;
    }

    try {
      const { createDrizzle } = await import("./drizzle/index.ts");
      const drizzle = createDrizzle(env.DB);

      const { PushConfigService } = await import("./services/push/configService.ts");
      const configService = new PushConfigService(drizzle);
      const config = await configService.getRuntimeConfig();
      const { createProviderRegistry } = await import('./services/push/providers/registry.ts');
      const providers = createProviderRegistry();

      const { PushOutboxService } = await import("./services/push/outboxService.ts");
      const outboxService = new PushOutboxService(drizzle);
      const { consumePushQueueBatch } = await import("./services/push/queueConsumer.ts");

      await consumePushQueueBatch(batch, {
        outbox: outboxService,
        providers,
        queue: env.PUSH_QUEUE,
        maxRetries: config.maxRetries,
        retryBackoffMs: config.retryBackoffMs
      });
    } catch (error) {
      console.error("Queue push dispatch failed:", error);
      batch.retryAll();
    }
  },
};

export { MessageStreamHubObject };
