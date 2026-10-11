import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatDateTime, formatDate, formatRelativeTime } from '@/utils/datetime'
import i18n from '@/locales'


const NOW = new Date('2026-10-10T12:00:00')

const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

describe('formatRelativeTime', () => {
  beforeAll(() => { i18n.global.locale.value = 'zh-CN' })
  afterAll(() => { i18n.global.locale.value = 'en-US' })

  it('1 分钟内归为刚刚', () => {
    expect(formatRelativeTime(iso(-30_000), NOW)).toBe('现在')
  })

  it('按分钟/小时/天分桶（zh-CN auto 桶：-2 天为「前天」）', () => {
    expect(formatRelativeTime(iso(-3 * 60_000), NOW)).toBe('3分钟前')
    expect(formatRelativeTime(iso(-5 * 3_600_000), NOW)).toBe('5小时前')
    expect(formatRelativeTime(iso(-2 * 86_400_000), NOW)).toBe('前天')
  })

  it('超过 7 天回落为绝对日期（不再产出「N 天前」以外的粗粒度）', () => {
    const out = formatRelativeTime(iso(-30 * 86_400_000), NOW)
    expect(out).not.toContain('前')
    expect(out).toBe(formatDate(iso(-30 * 86_400_000)))
  })

  it('未来时间钳制为刚刚，不产生负数桶', () => {
    expect(formatRelativeTime(iso(5 * 60_000), NOW)).toBe('现在')
  })

  it('en-US 文案', () => {
    i18n.global.locale.value = 'en-US'
    expect(formatRelativeTime(iso(-3 * 60_000), NOW)).toBe('3 minutes ago')
    i18n.global.locale.value = 'zh-CN'
  })

  it('空值/非法值返回空串', () => {
    expect(formatRelativeTime('')).toBe('')
    expect(formatRelativeTime('not-a-date')).toBe('')
  })
})

describe('formatDateTime / formatDate', () => {
  it('非法/空输入返回空串', () => {
    expect(formatDateTime('')).toBe('')
    expect(formatDateTime('not-a-date')).toBe('')
    expect(formatDate(null)).toBe('')
  })

  it('按当前 locale 输出可解析的本地格式', () => {
    i18n.global.locale.value = 'en-US'

    expect(formatDate('2026-10-10T12:00:00')).toContain('2026')
    i18n.global.locale.value = 'zh-CN'
    expect(formatDate('2026-10-10T12:00:00')).toContain('2026')
  })
})
