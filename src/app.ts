







import { Hono } from "hono";
import { HonoEnv } from "./types/hono.ts";
import { createDrizzle } from "./drizzle/index.ts";
import { MigrationRunner } from "./services/migrationRunner.ts";
import { ApiResponse, createErrorHandler } from "./utils/response.ts";


import { system } from "./routes/system.ts";
import { init } from "./routes/init.ts";
import { current } from "./routes/current.ts";
import { user } from "./routes/user.ts";
import { application } from "./routes/application.ts";
import { client } from "./routes/client.ts";
import { message } from "./routes/message.ts";
import { plugin } from "./routes/plugin.ts";
import { stream } from "./routes/stream.ts";
import { image } from "./routes/image.ts";
import { staticRoutes } from "./routes/static.ts";
import { auth } from "./routes/auth.ts";

const app = new Hono<HonoEnv>();


app.options("*", (c) => {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
    },
  });
});


let migrationRan = false;
app.use("*", async (c, next) => {
  if (!migrationRan) {
    try {
      const migrationRunner = new MigrationRunner(c.env.DB);
      await migrationRunner.runPendingMigrations();
      migrationRan = true;
      console.log("Database migrations completed successfully");
    } catch (e) {
      console.error("Migration failed:", e instanceof Error ? e.message : e);
    }
  }
  await next();
});




app.route("/", system);
app.route("/", auth);
app.route("/init", init);
app.route("/current", current);
app.route("/user", user);
app.route("/application", application);
app.route("/client", client);
app.route("/message", message);
app.route("/plugin", plugin);
app.route("/stream", stream);
app.route("/image", image);

app.route("/static", staticRoutes);


app.route("/api/v1", system);
app.route("/api/v1", auth);
app.route("/api/v1/init", init);
app.route("/api/v1/current", current);
app.route("/api/v1/user", user);
app.route("/api/v1/application", application);
app.route("/api/v1/client", client);
app.route("/api/v1/message", message);
app.route("/api/v1/plugin", plugin);
app.route("/api/v1/stream", stream);
app.route("/api/v1/image", image);
app.route("/api/v1/static", staticRoutes);


app.notFound((c) => {
  return ApiResponse.error("Not Found", 404, "Endpoint not found");
});


app.onError(createErrorHandler());

export default app;
