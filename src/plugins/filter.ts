import { FilterConfig, FilterTags, FilterResult, PluginContext } from './types.ts'





export function extractFilterTags(ctx: PluginContext): FilterTags {
  const extras = ctx.message?.extras || {}


  let tags: string[] = []
  const rawTags = extras['woe::filter::tags']
  if (Array.isArray(rawTags)) {
    tags = rawTags.filter(t => typeof t === 'string')
  }

  return { tags }
}






function evaluateTags(filterTags: string[], messageTags: string[]): boolean {
  if (filterTags.length === 0) return true
  if (messageTags.length === 0) return false


  const filterSet = new Set(filterTags)
  return messageTags.some(tag => filterSet.has(tag))
}






function evaluatePriority(
  filterMinPriority: number | undefined,
  messagePriority: number | undefined
): boolean {
  if (filterMinPriority === undefined) return true

  const effectivePriority = messagePriority ?? 0
  return effectivePriority >= filterMinPriority
}









export function evaluateFilter(
  filter: FilterConfig | undefined,
  ctx: PluginContext
): FilterResult {

  if (!filter) {
    return { allowed: true, reason: 'No filter configured' }
  }

  try {
    const filterTags = extractFilterTags(ctx)
    const messagePriority = ctx.message?.priority


    const tagsMatch = evaluateTags(
      filter.tags || [],
      filterTags.tags
    )
    if (!tagsMatch) {
      return {
        allowed: false,
        reason: `Tags mismatch: filter=[${filter.tags?.join(',')}], message=[${filterTags.tags.join(',')}]`
      }
    }


    const priorityMatch = evaluatePriority(
      filter.minPriority,
      messagePriority
    )
    if (!priorityMatch) {
      return {
        allowed: false,
        reason: `Priority too low: filterMin=${filter.minPriority}, messagePriority=${messagePriority}`
      }
    }

    return { allowed: true, reason: 'All conditions matched' }

  } catch (error) {

    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return {
      allowed: false,
      reason: `Filter evaluation error: ${errorMsg}`
    }
  }
}





export function hasFilterTags(extras: Record<string, any> | undefined): boolean {
  if (!extras) return false
  return extras['woe::filter::tags'] !== undefined
}
