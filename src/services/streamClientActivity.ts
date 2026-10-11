


























import { and, eq, sql } from "drizzle-orm";
import { clients, users } from "../models/index.ts";
import type { DrizzleDB } from "../drizzle/index.ts";
import { isClientExpired, parseClientTimestamp } from "./clientExpiry.ts";


export const STREAM_HEADER_USER_ID = "X-Woe-Stream-User-Id";
export const STREAM_HEADER_CLIENT_ID = "X-Woe-Stream-Client-Id";
export const STREAM_HEADER_TOKEN_LOOKUP = "X-Woe-Stream-Token-Lookup";


export const STREAM_CLIENT_REFRESH_INTERVAL_MAX_MS = 300_000;

export const STREAM_CLIENT_REFRESH_INTERVAL_MIN_MS = 500;

export const STREAM_CLIENT_RETRY_MAX_MS = 10_000;


export interface StreamClientBinding {
  userId: number;
  clientId: number;
  tokenLookup: string;
}


export interface StreamClientBindingState {
  lastUsed: string | null;
  expiresAfterInactivitySeconds: number;
  expiresAt: string | null;
}

export interface StreamClientRefreshResult {
  status: "active" | "invalid";










  refreshDueAtMs?: number;

  currentSeconds?: number;
}


const STREAM_CLIENT_RENEWAL_FAILURE_MESSAGE = "stream client renewal failed";














export class StreamClientRenewalError extends Error {
  readonly currentSeconds: number | undefined;

  constructor(currentSeconds: number | undefined, cause: unknown) {
    super(STREAM_CLIENT_RENEWAL_FAILURE_MESSAGE, { cause });
    this.name = "StreamClientRenewalError";
    this.currentSeconds = currentSeconds;
  }
}


export function streamClientRefreshIntervalMs(seconds: number): number {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return STREAM_CLIENT_REFRESH_INTERVAL_MAX_MS;
  return Math.min(
    STREAM_CLIENT_REFRESH_INTERVAL_MAX_MS,
    Math.max(STREAM_CLIENT_REFRESH_INTERVAL_MIN_MS, Math.floor(seconds * 500))
  );
}


export function streamClientRetryAfterMs(seconds: number): number {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return STREAM_CLIENT_RETRY_MAX_MS;
  return Math.min(
    STREAM_CLIENT_RETRY_MAX_MS,
    Math.max(STREAM_CLIENT_REFRESH_INTERVAL_MIN_MS, Math.floor(seconds * 500))
  );
}

interface ClientBindingRow {
  id: number;
  userId: number;
  token: string;
  lastUsed: string | null;
  expiresAfterInactivitySeconds: number | null;
  expiresAt: string | null;
}

type BindingCheck = { status: "active"; row: ClientBindingRow } | { status: "invalid" };







interface BindingLoadProgress {
  lastReadSeconds?: number;
}






async function loadAndCheckBinding(
  drizzle: DrizzleDB,
  binding: StreamClientBinding,
  nowMs: number,
  progress?: BindingLoadProgress
): Promise<BindingCheck> {
  if (!Number.isSafeInteger(binding.userId) || binding.userId <= 0) return { status: "invalid" };
  if (!Number.isSafeInteger(binding.clientId) || binding.clientId <= 0) return { status: "invalid" };
  if (typeof binding.tokenLookup !== "string" || binding.tokenLookup.length === 0) {
    return { status: "invalid" };
  }

  const row = await drizzle
    .select({
      id: clients.id,
      userId: clients.userId,
      token: clients.token,
      lastUsed: clients.lastUsed,
      expiresAfterInactivitySeconds: clients.expiresAfterInactivitySeconds,
      expiresAt: clients.expiresAt
    })
    .from(clients)
    .where(eq(clients.id, binding.clientId))
    .get();
  if (!row) return { status: "invalid" };
  if (row.userId !== binding.userId || row.token !== binding.tokenLookup) return { status: "invalid" };

  if (progress) progress.lastReadSeconds = row.expiresAfterInactivitySeconds ?? 0;

  const user = await drizzle
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, row.userId), eq(users.disabled, false)))
    .get();
  if (!user) return { status: "invalid" };

  if (isClientExpired(row.expiresAt, nowMs)) return { status: "invalid" };
  return { status: "active", row };
}


export async function loadStreamClientBindingState(
  drizzle: DrizzleDB,
  binding: StreamClientBinding,
  nowMs: number = Date.now()
): Promise<{ status: "active"; state: StreamClientBindingState } | { status: "invalid" }> {
  const checked = await loadAndCheckBinding(drizzle, binding, nowMs);
  if (checked.status !== "active") return { status: "invalid" };
  return {
    status: "active",
    state: {
      lastUsed: checked.row.lastUsed,
      expiresAfterInactivitySeconds: checked.row.expiresAfterInactivitySeconds ?? 0,
      expiresAt: checked.row.expiresAt
    }
  };
}











export async function refreshBoundStreamClient(
  drizzle: DrizzleDB,
  binding: StreamClientBinding,
  nowMs: number = Date.now()
): Promise<StreamClientRefreshResult> {




  const progress: BindingLoadProgress = {};
  try {
    let checked = await loadAndCheckBinding(drizzle, binding, nowMs, progress);
    if (checked.status !== "active") return { status: "invalid" };

    for (let attempt = 0; attempt < 2; attempt++) {
      const row = checked.row;
      const seconds = row.expiresAfterInactivitySeconds ?? 0;
      const intervalMs = streamClientRefreshIntervalMs(seconds);
      const lastUsedMs = parseClientTimestamp(row.lastUsed);
      const elapsedMs = lastUsedMs === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - lastUsedMs);
      if (elapsedMs < intervalMs) {
        return {
          status: "active",
          refreshDueAtMs: (lastUsedMs ?? nowMs) + intervalMs,
          currentSeconds: seconds
        };
      }

      const nowIso = new Date(nowMs).toISOString();
      const dueBeforeIso = new Date(nowMs - intervalMs).toISOString();
      const expiresAt = seconds > 0 ? new Date(nowMs + seconds * 1000).toISOString() : null;
      const updated = await drizzle
        .update(clients)
        .set({ lastUsed: nowIso, expiresAt })
        .where(
          sql`${clients.id} = ${binding.clientId}
            AND ${clients.userId} = ${binding.userId}
            AND ${clients.token} = ${binding.tokenLookup}
            AND ${clients.expiresAfterInactivitySeconds} = ${seconds}
            AND (${clients.expiresAt} IS NULL OR ${clients.expiresAt} > ${nowIso})
            AND (${clients.lastUsed} IS NULL OR ${clients.lastUsed} <= ${dueBeforeIso})
            AND EXISTS (SELECT 1 FROM ${users}
              WHERE ${users.id} = ${clients.userId} AND ${users.disabled} = 0)`
        )
        .returning({ id: clients.id });

      if (Array.isArray(updated) && updated.some((r) => Number((r as { id?: unknown })?.id) === binding.clientId)) {
        return { status: "active", refreshDueAtMs: nowMs + intervalMs, currentSeconds: seconds };
      }

      checked = await loadAndCheckBinding(drizzle, binding, nowMs, progress);
      if (checked.status !== "active") return { status: "invalid" };
    }





    const fallbackSeconds = checked.row.expiresAfterInactivitySeconds ?? 0;
    const fallbackLastUsedMs = parseClientTimestamp(checked.row.lastUsed);
    return {
      status: "active",
      refreshDueAtMs: (fallbackLastUsedMs ?? nowMs) + streamClientRefreshIntervalMs(fallbackSeconds),
      currentSeconds: fallbackSeconds
    };
  } catch (error) {
    if (error instanceof StreamClientRenewalError) throw error;
    throw new StreamClientRenewalError(progress.lastReadSeconds, error);
  }
}
