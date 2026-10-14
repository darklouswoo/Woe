import { describe, expect, it } from 'vitest'
import { getPriorityLevel, normalizePriorityFilter } from '@/utils/priority'
describe('priority buckets', () => {
  it.each([[-9007199254740991,0],[-1,0],[0,0],[1,1],[2,2],[3,3],[5,3],[9007199254740991,3]])('maps %s to %s', (priority,level) => expect(getPriorityLevel(priority)).toBe(level))
  it.each([['-9007199254740991','0'],['9007199254740991','3'],['9007199254740992',''],['2.5',''],[' ',''],[null,'']])('normalizes URL value %s', (raw,want) => expect(normalizePriorityFilter(raw)).toBe(want))
})
