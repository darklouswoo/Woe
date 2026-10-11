import { ApiResponse } from "./response.ts";

const POSITIVE_INTEGER_ID_PATTERN = /^[1-9]\d*$/;

export function parsePositiveIntegerId(rawId: string): number | null {
  if (!POSITIVE_INTEGER_ID_PATTERN.test(rawId)) {
    return null;
  }

  const parsed = Number(rawId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function validatePositiveIntegerId(rawId: string): Response | null {
  if (parsePositiveIntegerId(rawId) === null) {
    return ApiResponse.error("Bad Request", 400, "Invalid id parameter: must be a positive integer");
  }

  return null;
}
