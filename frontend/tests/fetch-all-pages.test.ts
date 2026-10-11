import { describe, it, expect, vi } from 'vitest'
import { fetchAllPages } from '@/types'

describe('fetchAllPages', () => {
  it('paging.next 为相对路径时以解析出的查询参数继续请求', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        data: ['a'],
        paging: { size: 1, since: 1, limit: 1, next: '/message?limit=1&since=5' }
      })
      .mockResolvedValueOnce({
        data: ['b'],
        paging: { size: 1, since: 5, limit: 1 }
      })

    const items = await fetchAllPages<string>(fetchPage, { limit: 1 })

    expect(items).toEqual(['a', 'b'])
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: '1', since: '5' })
  })
})
