import { describe, it, expect, vi } from 'vitest'

vi.mock('dompurify', () => ({
  default: {
    sanitize: () => {
      throw new Error('boom')
    }
  }
}))

import { renderMessage } from '@/utils/markdown'

describe('renderMessage 异常回退', () => {
  it('管线任何异常都回退纯文本', () => {
    expect(renderMessage('**x**').mode).toBe('plain')
  })
})
