



















import { ApiResponse } from "./response.ts";


export interface ValidatedMessageFields {
  message: string;
  title?: string;
  priority?: number;
  extras?: Record<string, unknown> | null;
}

export type MessageCreateFieldValidation =
  | { ok: true; value: ValidatedMessageFields }
  | { ok: false; response: Response };







export function validateMessageCreateFields(input: unknown): MessageCreateFieldValidation {

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      response: ApiResponse.error("Bad Request", 400, "Message body must be a JSON object"),
    };
  }
  const body = input as Record<string, unknown>;


  const message = body.message;
  if (message === undefined || message === null || message === "") {
    return {
      ok: false,
      response: ApiResponse.error("Bad Request", 400, "Missing required field: message is required"),
    };
  }
  if (typeof message !== "string") {
    return {
      ok: false,
      response: ApiResponse.error("Bad Request", 400, "message must be a string"),
    };
  }


  const rawTitle = body.title;
  let title: string | undefined;
  if (rawTitle !== undefined && rawTitle !== null) {
    if (typeof rawTitle !== "string") {
      return {
        ok: false,
        response: ApiResponse.error("Bad Request", 400, "title must be a string"),
      };
    }
    title = rawTitle;
  }


  const rawPriority = body.priority;
  let priority: number | undefined;
  if (rawPriority !== undefined && rawPriority !== null) {
    if (
      typeof rawPriority !== "number" ||
      !Number.isSafeInteger(rawPriority)
    ) {
      return {
        ok: false,
        response: ApiResponse.error("Bad Request", 400, "Priority must be a safe integer"),
      };
    }
    priority = rawPriority;
  }


  const rawExtras = body.extras;
  let extras: Record<string, unknown> | null | undefined;
  if (rawExtras !== undefined && rawExtras !== null) {
    if (typeof rawExtras !== "object" || Array.isArray(rawExtras)) {
      return {
        ok: false,
        response: ApiResponse.error("Bad Request", 400, "extras must be an object"),
      };
    }
    extras = rawExtras as Record<string, unknown>;
  } else if (rawExtras === null) {
    extras = null;
  }

  return { ok: true, value: { message, title, priority, extras } };
}
