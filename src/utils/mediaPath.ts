


















export const DEFAULT_APP_IMAGE = "static/defaultapp.png";


const LEGACY_IMAGE_PREFIXES = ["/api/v1/image/", "/image/"];


const MEDIA_PREFIX = "image/";


const ABSOLUTE_URL_PATTERN = /^(?:https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:/i;








export function normalizeMediaPath(
  value: string | null | undefined,
  fallback?: string
): string {
  const raw = value ?? "";
  if (!raw.trim()) {
    return fallback ?? "";
  }
  if (ABSOLUTE_URL_PATTERN.test(raw) || DATA_URL_PATTERN.test(raw)) {
    return raw;
  }
  for (const prefix of LEGACY_IMAGE_PREFIXES) {
    if (raw.startsWith(prefix)) {
      return MEDIA_PREFIX + raw.slice(prefix.length);
    }
  }

  return raw;
}
