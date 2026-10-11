
















import { eq, sql } from "drizzle-orm";
import { clients } from "../models/index.ts";
import type { DrizzleDB } from "../drizzle/index.ts";
import { formatDate } from "../utils/response.ts";
import { safeErrorKind } from "../utils/safeError.ts";
import type { MessageStreamHub } from "./messageStreamHub.ts";


export const CLIENT_ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;







export const EXPIRES_AFTER_INACTIVITY_MAX_SECONDS = 86_400 * 365 * 100;





export function normalizeExpiresAfterInactivitySeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < 0 || value > EXPIRES_AFTER_INACTIVITY_MAX_SECONDS) return null;
  return value;
}


export function parseClientTimestamp(value: string | null | undefined): number | null {
  const iso = formatDate(value);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}





export function computeExpiresAt(
  base: { lastUsed?: string | null; createdAt?: string | null },
  seconds: number
): string | null {
  if (!seconds) return null;
  const baseMs = parseClientTimestamp(base.lastUsed) ?? parseClientTimestamp(base.createdAt);
  if (baseMs === null) return null;
  return new Date(baseMs + seconds * 1000).toISOString();
}


export function isClientExpired(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const expiresMs = parseClientTimestamp(expiresAt);
  return expiresMs !== null && nowMs >= expiresMs;
}


export interface ClientActivityRow {
  id: number;
  userId: number;
  token: string;
  lastUsed: string | null;
  expiresAfterInactivitySeconds: number | null;
}














export async function refreshClientActivity(
  drizzle: DrizzleDB,
  row: ClientActivityRow,
  nowMs: number = Date.now()
): Promise<void> {
  const lastUsedMs = parseClientTimestamp(row.lastUsed);
  if (lastUsedMs !== null && nowMs - lastUsedMs < CLIENT_ACTIVITY_THROTTLE_MS) return;
  const seconds = row.expiresAfterInactivitySeconds ?? 0;
  const nowIso = new Date(nowMs).toISOString();
  const expiresAt = seconds > 0 ? new Date(nowMs + seconds * 1000).toISOString() : null;
  try {
    await drizzle
      .update(clients)
      .set({ lastUsed: nowIso, expiresAt })
      .where(sql`${clients.id} = ${row.id}
        AND ${clients.userId} = ${row.userId}
        AND ${clients.token} = ${row.token}
        AND ${clients.expiresAfterInactivitySeconds} IS ${row.expiresAfterInactivitySeconds}
        AND (${clients.lastUsed} IS NULL OR ${clients.lastUsed} = ${row.lastUsed})
        AND (${clients.expiresAt} IS NULL OR ${clients.expiresAt} > ${nowIso})`);
  } catch (error) {
    console.error("Failed to refresh client activity:", safeErrorKind(error));
  }
}







export async function refreshClientActivityById(
  drizzle: DrizzleDB,
  clientId: number,
  nowMs: number = Date.now()
): Promise<void> {
  try {
    const row = await drizzle
      .select({
        id: clients.id,
        userId: clients.userId,
        token: clients.token,
        lastUsed: clients.lastUsed,
        expiresAfterInactivitySeconds: clients.expiresAfterInactivitySeconds,
      })
      .from(clients)
      .where(eq(clients.id, clientId))
      .get();
    if (!row) return;
    await refreshClientActivity(drizzle, row, nowMs);
  } catch (error) {
    console.error("Failed to refresh client activity by id:", safeErrorKind(error));
  }
}











export async function cleanupExpiredClients(
  drizzle: DrizzleDB,
  streamHub?: Pick<MessageStreamHub, "disconnectClient">,
  nowMs: number = Date.now()
): Promise<number> {
  const nowIso = new Date(nowMs).toISOString();
  const expired = await drizzle
    .select({ id: clients.id, userId: clients.userId, token: clients.token })
    .from(clients)
    .where(sql`${clients.expiresAt} IS NOT NULL AND ${clients.expiresAt} <= ${nowIso}`);

  let deleted = 0;
  for (const row of expired) {
    const removed = await drizzle
      .delete(clients)
      .where(
        sql`${clients.id} = ${row.id} AND ${clients.token} = ${row.token}
          AND ${clients.expiresAt} IS NOT NULL AND ${clients.expiresAt} <= ${nowIso}`
      )
      .returning({ id: clients.id });
    if (!Array.isArray(removed) || !removed.some((r) => Number((r as { id?: unknown })?.id) === row.id)) {
      continue;
    }
    deleted++;
    if (streamHub) {
      try {
        await streamHub.disconnectClient(row.userId, row.id);
      } catch (error) {


        console.error(`Failed to disconnect expired client ${row.id}:`, safeErrorKind(error));
      }
    }
  }
  return deleted;
}
