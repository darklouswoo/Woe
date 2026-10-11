import i18n from '@/locales'

type DateInput = string | number | Date | null | undefined

const toDate = (value: DateInput): Date | null => {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const resolveLocale = (): string => (i18n.global.locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')


export function formatDateTime(value: DateInput): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleString(resolveLocale())
}


export function formatDate(value: DateInput): string {
  const date = toDate(value)
  if (!date) return ''
  return date.toLocaleDateString(resolveLocale())
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const RELATIVE_WINDOW_MS = 7 * DAY_MS





export function formatRelativeTime(value: DateInput, now: Date | number = Date.now()): string {
  const date = toDate(value)
  if (!date) return ''

  const diff = Math.max(0, new Date(now).getTime() - date.getTime())
  const formatter = new Intl.RelativeTimeFormat(resolveLocale(), { numeric: 'auto' })

  if (diff < MINUTE_MS) return formatter.format(0, 'second')
  if (diff < HOUR_MS) return formatter.format(-Math.floor(diff / MINUTE_MS), 'minute')
  if (diff < DAY_MS) return formatter.format(-Math.floor(diff / HOUR_MS), 'hour')
  if (diff < RELATIVE_WINDOW_MS) return formatter.format(-Math.floor(diff / DAY_MS), 'day')
  return formatDate(value)
}
