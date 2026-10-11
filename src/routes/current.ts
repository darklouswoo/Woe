






import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator, SESSION_NOT_ELEVATED_MESSAGE } from "../middleware/auth.ts";
import { UserHandlers } from "../handlers/userHandlers.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";

const current = new Hono<HonoEnv>();



current.get("/user", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const userHandlers = new UserHandlers(drizzle);

  const auth = await authenticator.requireClient(c.req.raw, c.env);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }



  return await userHandlers.getCurrentUser(auth.userId, auth);
});


current.post("/user/password", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const userHandlers = new UserHandlers(drizzle);



  const auth = await authenticator.requireElevatedClient(c.req.raw, c.env, { skipRehash: true });
  if (!auth) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }

  const parsed = await parseJsonBody<{ pass?: string }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.pass) {
    return ApiResponse.error("Bad Request", 400, "Missing required field: pass is required");
  }

  return await userHandlers.updateCurrentUserPassword(auth.userId, body.pass);
});

export { current };
