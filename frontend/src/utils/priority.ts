
export type PriorityLevel = 0 | 1 | 2 | 3

export function getPriorityLevel(priority: number): PriorityLevel {
  if (priority <= 0) return 0
  if (priority <= 1) return 1
  if (priority <= 2) return 2
  return 3
}


export function normalizePriorityFilter(raw: string | null): string {
  if (raw === null || !/^-?\d+$/.test(raw)) return ''
  const priority = Number(raw)
  return Number.isSafeInteger(priority) ? String(getPriorityLevel(priority)) : ''
}
