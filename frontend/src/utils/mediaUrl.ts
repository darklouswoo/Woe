



















const LEGACY_API_PREFIX = 'api/v1/'


const MEDIA_PATH_PATTERN = /^\/?(api\/v1\/)?(image\/.+|static\/.+)$/


const ABSOLUTE_URL_PATTERN = /^(?:https?:)?\/\//i
const DATA_URL_PATTERN = /^data:/i







function resolveBaseUrl(baseUrl?: string): URL {
  const configured = (baseUrl ?? (import.meta.env.VITE_API_BASE_URL || '/')).trim()
  const siteOrigin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost'
  return new URL(configured, siteOrigin)
}


function asDirectory(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}


export const DEFAULT_APP_IMAGE = 'static/defaultapp.png'








export function resolveMediaUrl(rawUrl?: string | null, baseUrl?: string): string {
  const raw = (rawUrl ?? '').trim()
  if (!raw) return ''
  if (ABSOLUTE_URL_PATTERN.test(raw) || DATA_URL_PATTERN.test(raw)) return raw

  const base = resolveBaseUrl(baseUrl)
  const baseDir = asDirectory(base.pathname)


  let candidate = raw
  if (candidate.startsWith('/') && baseDir !== '/' && candidate.startsWith(baseDir)) {
    candidate = candidate.slice(baseDir.length - 1)
  }

  const matched = candidate.match(MEDIA_PATH_PATTERN)

  if (!matched) return raw

  const hasLegacyApiPrefix = Boolean(matched[1])
  let mediaPath = matched[2]

  if (hasLegacyApiPrefix && !baseDir.endsWith(`/${LEGACY_API_PREFIX}`)) {
    mediaPath = LEGACY_API_PREFIX + mediaPath
  }

  return base.origin + baseDir + mediaPath
}














export function hasCustomApplicationImage(rawUrl?: string | null, baseUrl?: string): boolean {
  const resolved = resolveMediaUrl(rawUrl, baseUrl)
  if (!resolved) return false
  return resolved !== resolveMediaUrl(DEFAULT_APP_IMAGE, baseUrl)
}
