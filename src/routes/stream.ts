




import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ClientHandlers } from "../handlers/clientHandlers.ts";
import { ApiResponse } from "../utils/response.ts";
import { DurableObjectMessageStreamHub } from "../services/messageStreamHub.ts";
import type { StreamClientBinding } from "../services/streamClientActivity.ts";

const stream = new Hono<HonoEnv>();



stream.get("/", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const clientHandlers = new ClientHandlers(drizzle);
  const streamHubNamespace = c.env.MESSAGE_STREAM_HUB;

  if (!streamHubNamespace) {
    return ApiResponse.error("Internal Server Error", 500, "MESSAGE_STREAM_HUB binding is not configured");
  }
  const streamHub = new DurableObjectMessageStreamHub(streamHubNamespace);

  const tokenInfo = await authenticator.requireClient(c.req.raw, c.env);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }


  if (tokenInfo.tokenType === "client" && tokenInfo.resourceId) {
    try {
      await clientHandlers.updateLastUsed(tokenInfo.resourceId);
    } catch (error) {
      console.error("Failed to update client last_used:", error);

    }
  }

  const upgrade = c.req.header("Upgrade");
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return ApiResponse.json({ ok: true });
  }




  let binding: StreamClientBinding | undefined;
  if (tokenInfo.clientId && tokenInfo.clientTokenLookup) {
    binding = {
      userId: tokenInfo.userId,
      clientId: tokenInfo.clientId,
      tokenLookup: tokenInfo.clientTokenLookup
    };
  }

  return streamHub.connect(tokenInfo.userId, tokenInfo.resourceId, c.req.raw, binding);
});

export { stream };
