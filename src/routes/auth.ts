










import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ClientHandlers } from "../handlers/clientHandlers.ts";
import { ApiResponse } from "../utils/response.ts";
import { DurableObjectMessageStreamHub } from "../services/messageStreamHub.ts";

const auth = new Hono<HonoEnv>();


auth.post("/auth/logout", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);


  const tokenInfo = await authenticator.requireClient(c.req.raw, c.env);
  if (!tokenInfo) {
    return ApiResponse.error(
      "Unauthorized",
      401,
      "you need to provide a valid access token or user credentials to access this api"
    );
  }
  if (tokenInfo.clientId == null) {

    return ApiResponse.error("Forbidden", 403, "no client auth provided");
  }
  if (tokenInfo.clientTokenLookup == null) {



    console.error(
      `auth/logout: authenticated client token missing internal lookup snapshot ` +
        `(userId=${tokenInfo.userId}, clientId=${tokenInfo.clientId})`
    );
    return ApiResponse.error("Internal Server Error", 500, "internal auth state error");
  }


  const clientHandlers = new ClientHandlers(drizzle, c.env.DB);
  const result = await clientHandlers.logoutClient(
    tokenInfo.userId,
    tokenInfo.clientId,
    tokenInfo.clientTokenLookup
  );
  if (!result.ok) {

    return result.response;
  }



  if (result.revoked && c.env.MESSAGE_STREAM_HUB) {
    try {
      const streamHub = new DurableObjectMessageStreamHub(c.env.MESSAGE_STREAM_HUB);
      await streamHub.disconnectClient(tokenInfo.userId, tokenInfo.clientId);
    } catch (error) {
      console.error(
        `Failed to disconnect logged-out client stream ` +
          `(userId=${tokenInfo.userId}, clientId=${tokenInfo.clientId}):`,
        error
      );
    }
  }
  return ApiResponse.json({});
});

export { auth };
