




















export function parseMessageExtras(
  value: string | null | undefined
): Record<string, unknown> | undefined {

  if (typeof value !== "string" || value.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }


  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}
