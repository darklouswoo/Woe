import { ErrorResponse } from "../types/index.ts";

export class ApiResponse {
  static json(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
        ...headers,
      },
    });
  }

  static error(error: string, errorCode: number, errorDescription: string): Response {
    const errorResponse: ErrorResponse = {
      error,
      errorCode,
      errorDescription,
    };
    return new Response(JSON.stringify(errorResponse), {
      status: errorCode,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Gotify-Key",
      },
    });
  }

  static noContent(): Response {
    return new Response(null, {
      status: 204,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

export function toBoolean(value: number | boolean): boolean {
  return !!value;
}

export function safeJsonParse(value: string | null | undefined): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}







export async function parseJsonBody<T>(
  request: Request
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  try {
    const parsed = (await request.json()) as T;
    if (parsed === null) {
      return { ok: false, response: ApiResponse.error("Bad Request", 400, "Invalid JSON body") };
    }
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, response: ApiResponse.error("Bad Request", 400, "Invalid JSON body") };
  }
}



export function createErrorHandler() {
  return async (err: unknown, _c: { req: { raw: Request } }): Promise<Response> => {
    console.error("Unhandled error:", err);
    return ApiResponse.error("Internal Server Error", 500, "Internal server error");
  };
}





export function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;


  if (dateStr.includes('T')) return dateStr;



  return dateStr.replace(' ', 'T') + 'Z';
}
