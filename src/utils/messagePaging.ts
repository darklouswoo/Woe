














import { ApiResponse } from "./response.ts";


export interface MessagePaging {
  limit: number;
  since: number;
}

export type MessagePagingResult =
  | { ok: true; value: MessagePaging }
  | { ok: false; response: Response };


export const MESSAGE_LIMIT_DEFAULT = 100;
export const MESSAGE_LIMIT_MIN = 1;
export const MESSAGE_LIMIT_MAX = 200;


const LIMIT_PATTERN = /^\+?\d+$/;

const SINCE_PATTERN = /^\d+$/;

function isSafeIntegerWithin(value: number, min: number, max?: number): boolean {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) return false;
  if (value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function isValidLimitValue(value: unknown): boolean {
  return typeof value === "number" && isSafeIntegerWithin(value, MESSAGE_LIMIT_MIN, MESSAGE_LIMIT_MAX);
}

function isValidSinceValue(value: unknown): boolean {
  return typeof value === "number" && isSafeIntegerWithin(value, 0);
}


export function invalidMessageLimitResponse(): Response {
  return ApiResponse.error(
    "Bad Request",
    400,
    "Invalid limit parameter: must be an integer between 1 and 200"
  );
}


export function invalidMessageSinceResponse(): Response {
  return ApiResponse.error(
    "Bad Request",
    400,
    "Invalid since parameter: must be a non-negative integer"
  );
}


function parseLimit(raw: string): number | null {
  if (!LIMIT_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return isSafeIntegerWithin(value, MESSAGE_LIMIT_MIN, MESSAGE_LIMIT_MAX) ? value : null;
}


function parseSince(raw: string): number | null {
  if (!SINCE_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return isSafeIntegerWithin(value, 0) ? value : null;
}





export function parseMessagePaging(params: URLSearchParams): MessagePagingResult {

  const limitRaw = params.get("limit");
  const sinceRaw = params.get("since");

  if (limitRaw === "") {
    return { ok: false, response: invalidMessageLimitResponse() };
  }
  const limit = limitRaw === null ? MESSAGE_LIMIT_DEFAULT : parseLimit(limitRaw);
  if (limit === null) {
    return { ok: false, response: invalidMessageLimitResponse() };
  }

  const since = sinceRaw === null || sinceRaw === "" ? 0 : parseSince(sinceRaw);
  if (since === null) {
    return { ok: false, response: invalidMessageSinceResponse() };
  }

  return { ok: true, value: { limit, since } };
}


export function isValidMessagePaging(limit: number, since: number): boolean {
  return isValidLimitValue(limit) && isValidSinceValue(since);
}


export function invalidMessagePagingResponse(limit: number, since: number): Response {
  return isValidLimitValue(limit) ? invalidMessageSinceResponse() : invalidMessageLimitResponse();
}
