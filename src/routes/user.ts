









import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator, SESSION_NOT_ELEVATED_MESSAGE } from "../middleware/auth.ts";
import { UserHandlers } from "../handlers/userHandlers.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";
import { parsePositiveIntegerId, validatePositiveIntegerId } from "../utils/routeParams.ts";
import { isRegistrationEnabled } from "../utils/registrationConfig.ts";
import { DurableObjectMessageStreamHub } from "../services/messageStreamHub.ts";

const user = new Hono<HonoEnv>();


async function getAuth(c: any, opts?: { skipRehash?: boolean }) {
  const drizzle = createDrizzle(c.env.DB);
  const authenticator = new Authenticator(drizzle);
  const streamHub = c.env.MESSAGE_STREAM_HUB
    ? new DurableObjectMessageStreamHub(c.env.MESSAGE_STREAM_HUB)
    : undefined;
  const userHandlers = new UserHandlers(drizzle, streamHub);
  const tokenInfo = await authenticator.requireClient(c.req.raw, c.env, opts);
  const hasCredentials = authenticator.hasCredentials(c.req.raw);

  return { authenticator, tokenInfo, hasCredentials, userHandlers, env: c.env };
}






async function unauthenticatedAdminResponse(authenticator: Authenticator, request: Request, message: string) {
  if (await authenticator.isOrphanClientToken(request)) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return ApiResponse.error("Unauthorized", 401, message);
}

user.get("/", async (c) => {
  const { authenticator, tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return unauthenticatedAdminResponse(authenticator, c.req.raw, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env);
  if (!elevatedAdmin) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  return await userHandlers.getAllUsers();
});

user.post("/", async (c) => {

  const { authenticator, tokenInfo, hasCredentials, userHandlers, env } = await getAuth(c, { skipRehash: true });
  const parsed = await parseJsonBody<{
    name: string;
    pass: string;
    nickname?: string;
    email?: string;
    admin?: unknown;
    description?: string;
  }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.name || !body.pass) {
    return ApiResponse.error("Bad Request", 400, "Missing required fields: name and pass are required");
  }



  let admin: boolean;
  if (body.admin === undefined || body.admin === null) {
    admin = false;
  } else if (typeof body.admin === "boolean") {
    admin = body.admin;
  } else {
    return ApiResponse.error("Bad Request", 400, "admin must be a boolean");
  }


  if (tokenInfo) {
    if (!tokenInfo.isAdmin) {
      return ApiResponse.error("Forbidden", 403, "Admin access required");
    }
    const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env, { skipRehash: true });
    if (!elevatedAdmin) {
      return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
    }
    return await userHandlers.createUser(
      body.name,
      body.pass,
      admin,
      body.nickname,
      body.email,
      body.description
    );
  }

  if (hasCredentials) {

    if (await authenticator.isOrphanClientToken(c.req.raw)) {
      return ApiResponse.error("Forbidden", 403, "Admin access required");
    }
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }


  const registrationEnabled = isRegistrationEnabled(env.REGISTRATION);
  if (!registrationEnabled) {
    return ApiResponse.error("Unauthorized", 401, "you are not allowed to access this api");
  }
  if (admin) {

    return ApiResponse.error("Unauthorized", 401, "you are not allowed to create an admin user");
  }
  return await userHandlers.createUser(
    body.name,
    body.pass,
    admin,
    body.nickname,
    body.email,
    body.description
  );
});

user.get("/:id", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { authenticator, tokenInfo, userHandlers } = await getAuth(c);

  if (!tokenInfo) {
    return unauthenticatedAdminResponse(authenticator, c.req.raw, "Authentication required");
  }

  if (tokenInfo.userId === idNumber) {
    return await userHandlers.getUser(id);
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "You can only view your own user or require admin privileges");
  }

  const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env);
  if (!elevatedAdmin) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  return await userHandlers.getUser(id);
});

user.put("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }


  const { authenticator, tokenInfo, userHandlers } = await getAuth(c, { skipRehash: true });
  if (!tokenInfo) {
    return unauthenticatedAdminResponse(authenticator, c.req.raw, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env, { skipRehash: true });
  if (!elevatedAdmin) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  const parsed = await parseJsonBody<{ name?: string; pass?: string; admin?: boolean }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await userHandlers.updateUser(id, body);
});

user.post("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }


  const { authenticator, tokenInfo, userHandlers } = await getAuth(c, { skipRehash: true });
  if (!tokenInfo) {
    return unauthenticatedAdminResponse(authenticator, c.req.raw, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env, { skipRehash: true });
  if (!elevatedAdmin) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  const parsed = await parseJsonBody<{ name?: string; pass?: string; admin?: boolean }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await userHandlers.updateUser(id, body);
});

user.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const { authenticator, tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return unauthenticatedAdminResponse(authenticator, c.req.raw, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const elevatedAdmin = await authenticator.requireElevatedAdmin(c.req.raw, c.env);
  if (!elevatedAdmin) {
    return ApiResponse.error("Forbidden", 403, SESSION_NOT_ELEVATED_MESSAGE);
  }
  return await userHandlers.deleteUser(id);
});

user.get("/:id/applications", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserApplications(idNumber);
});

user.get("/:id/clients", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserClients(idNumber);
});

user.get("/:id/plugins", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserPlugins(idNumber);
});


user.put("/:id/profile", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  const parsed = await parseJsonBody<{ nickname?: string; email?: string; description?: string }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  return await userHandlers.updateUserProfile(
    tokenInfo.userId,
    idNumber,
    tokenInfo.isAdmin,
    body
  );
});


user.post("/:id/avatar", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers, env } = await getAuth(c);

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  return await userHandlers.uploadUserAvatar(
    tokenInfo.userId,
    idNumber,
    tokenInfo.isAdmin,
    c.req.raw,
    env
  );
});


user.delete("/:id/avatar", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers, env } = await getAuth(c);

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Authentication required");
  }

  return await userHandlers.deleteUserAvatar(
    tokenInfo.userId,
    idNumber,
    tokenInfo.isAdmin,
    env
  );
});


user.get("/:id/plugin-permissions", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  return await userHandlers.getUserPluginPermissions(idNumber);
});


user.put("/:id/plugin-permissions", async (c) => {
  const id = c.req.param("id");
  const idNumber = parsePositiveIntegerId(id);
  if (idNumber === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  const { tokenInfo, userHandlers } = await getAuth(c);
  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }
  const parsed = await parseJsonBody<{ modulePaths: string[] }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body.modulePaths || !Array.isArray(body.modulePaths)) {
    return ApiResponse.error("Bad Request", 400, "modulePaths array is required");
  }
  return await userHandlers.updateUserPluginPermissions(idNumber, body.modulePaths);
});


user.put("/:id/disabled", async (c) => {
  const id = c.req.param("id");
  const invalidIdResponse = validatePositiveIntegerId(id);
  if (invalidIdResponse) {
    return invalidIdResponse;
  }

  const { tokenInfo, userHandlers } = await getAuth(c);

  if (!tokenInfo) {
    return ApiResponse.error("Unauthorized", 401, "Client token or Basic auth required");
  }
  if (!tokenInfo.isAdmin) {
    return ApiResponse.error("Forbidden", 403, "Admin access required");
  }

  const parsed = await parseJsonBody<{ disabled: boolean }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (typeof body.disabled !== "boolean") {
    return ApiResponse.error("Bad Request", 400, "disabled must be a boolean");
  }

  return await userHandlers.setUserDisabled(id, body.disabled);
});

export { user };
