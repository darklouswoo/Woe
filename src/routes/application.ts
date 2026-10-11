









import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { Env } from "../types/index.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator, SESSION_NOT_ELEVATED_MESSAGE } from "../middleware/auth.ts";
import { ApplicationHandlers } from "../handlers/applicationHandlers.ts";
import { MessageHandlers } from "../handlers/messageHandlers.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";
import { validatePositiveIntegerId } from "../utils/routeParams.ts";
import { parseMessagePaging } from "../utils/messagePaging.ts";

const application = new Hono<HonoEnv>();









async function requireElevatedClientWithDistinct401(
  authenticator: Authenticator,
  request: Request,
  env: Env
) {
  const client = await authenticator.requireClient(request, env);
  if (!client) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const elevated = await authenticator.requireElevatedClient(request, env);
  if (!elevated) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  return elevated;
}


async function getClientAuth(c: any) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const applicationHandlers = new ApplicationHandlers(drizzle);
  const messageHandlers = new MessageHandlers(drizzle);

  const basicAuthUser = await authenticator.authenticateBasic(c.req.raw, c.env);
  if (basicAuthUser) {
    return {
      userId: basicAuthUser.id,
      isAdmin: basicAuthUser.admin,
      tokenType: "client" as const,
      applicationHandlers,
      messageHandlers,
      basicAuthUser
    };
  }
  const tokenInfo = await authenticator.authenticate(c.req.raw);
  if (!tokenInfo || tokenInfo.tokenType !== "client") {
    return null;
  }
  return { ...tokenInfo, applicationHandlers, messageHandlers, basicAuthUser: null };
}


application.get("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.applicationHandlers.getAllApplications(auth.userId);
});


application.post("/", async (c) => {
  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const parsed = await parseJsonBody<{ name: string; description?: string; defaultPriority?: number; sortKey?: string }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.name) {
    return ApiResponse.error("Bad Request", 400, "Missing required field: name is required");
  }
  return await auth.applicationHandlers.createApplication(
    auth.userId,
    body.name,
    body.description,
    body.defaultPriority,
    body.sortKey
  );
});


application.get("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.applicationHandlers.getApplication(auth.userId, id);
});


application.put("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  const parsed = await parseJsonBody<{ name?: string; description?: string; defaultPriority?: number; sortKey?: string }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await auth.applicationHandlers.updateApplication(auth.userId, id, body);
});


application.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);

  const guard = await requireElevatedClientWithDistinct401(authenticator, c.req.raw, c.env);
  if (guard instanceof Response) {
    return guard;
  }


  const applicationHandlers = new ApplicationHandlers(drizzle, c.env.DB);
  return await applicationHandlers.deleteApplication(guard.userId, id);
});


application.put("/:id/security", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);

  const guard = await requireElevatedClientWithDistinct401(authenticator, c.req.raw, c.env);
  if (guard instanceof Response) {
    return guard;
  }




  const parsed = await parseJsonBody<{ regenerateToken?: unknown }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (typeof body !== "object" || Array.isArray(body)) {
    return ApiResponse.error("Bad Request", 400, "Invalid JSON body");
  }
  const action = body.regenerateToken;
  if (action !== undefined && action !== null && typeof action !== "boolean") {
    return ApiResponse.error("Bad Request", 400, "regenerateToken must be true");
  }
  const applicationHandlers = new ApplicationHandlers(drizzle);
  return await applicationHandlers.updateApplicationSecurity(guard.userId, id, action === true);
});


application.post("/:id/image", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }
  return await auth.applicationHandlers.uploadApplicationImage(auth.userId, id, auth.isAdmin, c.req.raw, c.env);
});


application.delete("/:id/image", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }
  return await auth.applicationHandlers.deleteApplicationImage(auth.userId, id, auth.isAdmin, c.env);
});


application.get("/:id/message", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }

  const parsed = parseMessagePaging(new URL(c.req.url).searchParams);
  if (!parsed.ok) {
    return parsed.response;
  }
  return await auth.messageHandlers.getApplicationMessages(auth.userId, id, parsed.value.limit, parsed.value.since);
});


application.delete("/:id/message", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const auth = await getClientAuth(c);
  if (!auth) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  return await auth.messageHandlers.deleteApplicationMessages(auth.userId, id);
});

export { application };
