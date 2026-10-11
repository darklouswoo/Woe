
































import { ApiResponse, parseJsonBody } from "./response.ts";


export interface MessageCreateBody {
  message: string;
  title?: string;
  priority?: number;
  extras?: any;
  appid?: number;
}


export type MessageCreateParseResult =
  | { ok: true; data: MessageCreateBody }
  | { ok: false; response: Response };


const BOUND_FIELD_NAMES = ["message", "title", "priority", "appid", "extras"] as const;

type BoundFieldName = (typeof BOUND_FIELD_NAMES)[number];


function isBoundFieldName(name: string): name is BoundFieldName {
  return (BOUND_FIELD_NAMES as readonly string[]).includes(name);
}


const FORM_INTEGER_RE = /^-?\d+$/;


function parseContentType(header: string): { mediaType: string; params: Map<string, string> } {
  const params = new Map<string, string>();
  const semicolon = header.indexOf(";");
  const mediaType = (semicolon === -1 ? header : header.slice(0, semicolon)).trim().toLowerCase();
  if (semicolon !== -1) {
    for (const chunk of header.slice(semicolon + 1).split(";")) {
      const eq = chunk.indexOf("=");
      if (eq === -1) continue;
      const key = chunk.slice(0, eq).trim().toLowerCase();
      let value = chunk.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key) params.set(key, value);
    }
  }
  return { mediaType, params };
}

function bindingError(description: string): { ok: false; response: Response } {
  return { ok: false, response: ApiResponse.error("Bad Request", 400, description) };
}






function buildMessageCreateBody(fields: Partial<Record<BoundFieldName, string>>): MessageCreateParseResult {
  const data = {} as MessageCreateBody;

  if (fields.message !== undefined) data.message = fields.message;
  if (fields.title !== undefined) data.title = fields.title;



  if (fields.priority !== undefined) {
    if (fields.priority === "") {
      data.priority = 0;
    } else if (!FORM_INTEGER_RE.test(fields.priority)) {
      return bindingError("priority must be an integer");
    } else {
      data.priority = parseInt(fields.priority, 10);
    }
  }

  const appid = fields.appid;
  if (appid !== undefined && appid !== "") {
    if (!FORM_INTEGER_RE.test(appid)) {
      return bindingError("appid must be an integer");
    }
    data.appid = parseInt(appid, 10);
  }

  const extras = fields.extras;
  if (extras !== undefined && extras !== "") {
    try {
      data.extras = JSON.parse(extras);
    } catch {
      return bindingError("extras must be valid JSON");
    }
  }

  return { ok: true, data };
}


async function bindJson(request: Request): Promise<MessageCreateParseResult> {
  const parsed = await parseJsonBody<MessageCreateBody>(request);
  if (!parsed.ok) return parsed;
  return { ok: true, data: parsed.data };
}





async function bindUrlEncoded(request: Request, parseBody: boolean): Promise<MessageCreateParseResult> {
  let bodyParams: URLSearchParams | null = null;
  if (parseBody) {
    try {
      bodyParams = new URLSearchParams(await request.text());
    } catch {
      return bindingError("Invalid form body");
    }
  }
  const queryParams = new URL(request.url).searchParams;

  const fields: Partial<Record<BoundFieldName, string>> = {};
  for (const name of BOUND_FIELD_NAMES) {

    const bodyValue = bodyParams ? bodyParams.get(name) : null;
    if (bodyValue !== null) {
      fields[name] = bodyValue;
      continue;
    }
    const queryValue = queryParams.get(name);
    if (queryValue !== null) fields[name] = queryValue;
  }
  return buildMessageCreateBody(fields);
}






async function bindMultipart(request: Request, boundary: string | undefined): Promise<MessageCreateParseResult> {
  if (!boundary) {
    return bindingError("multipart Content-Type requires a boundary parameter");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return bindingError("Invalid multipart body");
  }

  const fields: Partial<Record<BoundFieldName, string>> = {};
  const bound = new Set<string>();
  for (const [name, value] of formData.entries()) {
    if (!isBoundFieldName(name)) {
      continue;
    }
    if (typeof value !== "string") {

      return bindingError(`${name} must be a text field, not a file`);
    }
    if (!bound.has(name)) {
      bound.add(name);
      fields[name] = value;
    }
  }
  return buildMessageCreateBody(fields);
}






export async function parseMessageCreateRequest(request: Request): Promise<MessageCreateParseResult> {
  const { mediaType, params } = parseContentType(request.headers.get("content-type") || "");

  if (mediaType === "application/json") {
    return bindJson(request);
  }
  if (mediaType === "multipart/form-data") {
    return bindMultipart(request, params.get("boundary"));
  }
  if (mediaType === "application/x-www-form-urlencoded") {
    return bindUrlEncoded(request, true);
  }

  return bindUrlEncoded(request, false);
}
