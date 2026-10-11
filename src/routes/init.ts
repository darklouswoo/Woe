






import { Hono } from "hono";
import { HonoEnv } from "../types/hono.ts";
import { createDrizzle } from "../drizzle/index.ts";
import { Authenticator } from "../middleware/auth.ts";
import { ApiResponse, parseJsonBody } from "../utils/response.ts";

const init = new Hono<HonoEnv>();



init.get("/status", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const { InitService } = await import("../services/initService.ts");
  const initService = new InitService(drizzle.$client);
  const status = await initService.getInitStatus();
  return ApiResponse.json(status);
});


init.post("/admin", async (c) => {
  const drizzle = createDrizzle(c.env.DB);
  const { InitService } = await import("../services/initService.ts");
  const initService = new InitService(drizzle.$client);
  const authenticator = new Authenticator(drizzle);

  const isDefaultAuth = await authenticator.isDefaultInitAuth(c.req.raw, c.env);


  if (!isDefaultAuth) {
    return ApiResponse.error(
      "Forbidden",
      403,
      "Initialization not allowed or default credentials invalid"
    );
  }
  const initialized = await initService.isSystemInitialized();
  const locked = await initService.isInitializationLocked();



  try {
    await initService.sweepStaleInitializationClaims();
  } catch (e) {
    console.warn("Stale initialization claim sweep failed during precheck:", e);
  }
  const initializing = await initService.isInitializationInProgress();


  if (initialized || locked || initializing) {
    return ApiResponse.error(
      "Forbidden",
      403,
      "Initialization not allowed or default credentials invalid"
    );
  }


  try {
    await initService.ensureSchema();
  } catch (e) {
    console.error("Schema migration failed during initialization:", e);
    return ApiResponse.error(
      "Database error",
      500,
      "Initialization failed"
    );
  }

  const dbReady = await initService.validateDatabase();
  if (!dbReady) {
    return ApiResponse.error(
      "Service Unavailable",
      503,
      "Database validation failed"
    );
  }

  const parsed = await parseJsonBody<{ name: string; pass: string }>(c.req.raw);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  if (!body?.name || !body?.pass) {
    return ApiResponse.error(
      "Bad Request",
      400,
      "Missing required fields: name and pass"
    );
  }



  const claimToken = await initService.claimInitialization();
  if (!claimToken) {
    return ApiResponse.error(
      "Forbidden",
      403,
      "System is already initialized or being initialized"
    );
  }





  let ownsClaim: boolean;
  try {
    ownsClaim = await initService.assertClaimOwnership(claimToken);
  } catch (error) {
    console.error("Failed to verify initialization claim ownership:", error);
    await initService.releaseInitializationClaim(claimToken).catch(() => {});
    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Initialization state check failed"
    );
  }
  if (!ownsClaim) {
    console.error("Initialization claim lost before admin creation");
    return ApiResponse.error(
      "Conflict",
      409,
      "Initialization claim lost to a concurrent attempt"
    );
  }


  let adminUserId: number | null = null;
  try {
    adminUserId = await initService.createAdminUser(body.name, body.pass);
  } catch (error) {
    console.error("Failed to create admin user:", error);
    await initService.releaseInitializationClaim(claimToken).catch(() => {});
    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Admin user creation failed"
    );
  }
  if (adminUserId === null) {
    await initService.releaseInitializationClaim(claimToken).catch(() => {});
    return ApiResponse.error(
      "Conflict",
      409,
      "User with this name already exists"
    );
  }





  let stillOwnsClaim: boolean;
  try {
    stillOwnsClaim = await initService.assertClaimOwnership(claimToken);
  } catch (error) {
    console.error("Failed to verify initialization claim ownership before finalization:", error);
    await initService.releaseInitializationClaim(claimToken).catch(() => {});
    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Initialization state check failed; admin user may exist — check server logs before retry"
    );
  }
  if (!stillOwnsClaim) {
    console.error("Initialization claim lost before finalization; admin user may already exist");
    return ApiResponse.error(
      "Conflict",
      409,
      "Initialization claim lost to a concurrent attempt; admin user may exist — check server logs before retry"
    );
  }







  try {
    await initService.markAsInitialized();
    await initService.lockInitialization();
  } catch (error) {
    console.error("Failed to finalize initialization state:", error);
    await initService.releaseInitializationClaim(claimToken).catch(() => {});
    return ApiResponse.error(
      "Internal Server Error",
      500,
      "Initialization state finalization failed; admin user may exist — check server logs before retrying"
    );
  }



  await initService.releaseInitializationClaim(claimToken).catch(() => {});

  return ApiResponse.json({ ok: true });
});

export { init };
