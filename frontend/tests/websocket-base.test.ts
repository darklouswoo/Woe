import { describe, expect, it } from 'vitest'
import { buildWebSocketUrl, computeReconnectDelayMs } from '../src/services/websocket'

describe('WebSocket deployment base', () => {
  const httpLocation = { protocol: 'http:', host: 'example.test' }
  const httpsLocation = { protocol: 'https:', host: 'example.test' }

  it('uses /stream for the root deployment', () => {
    expect(buildWebSocketUrl('a token', httpLocation, '/'))
      .toBe('ws://example.test/stream?token=a%20token')
  })

  it('prefixes the stream route for a sub-path deployment', () => {
    expect(buildWebSocketUrl('token/with?chars', httpLocation, '/proxy/'))
      .toBe('ws://example.test/proxy/stream?token=token%2Fwith%3Fchars')
  })

  it('uses wss for HTTPS and normalizes repeated base slashes', () => {
    expect(buildWebSocketUrl('token', httpsLocation, '///proxy///'))
      .toBe('wss://example.test/proxy/stream?token=token')
  })
})

describe('computeReconnectDelayMs (客户端对齐的指数退避)', () => {
  it('按 2^(attempt-1) 指数递增', () => {
    expect(computeReconnectDelayMs(1)).toBe(1000)
    expect(computeReconnectDelayMs(2)).toBe(2000)
    expect(computeReconnectDelayMs(3)).toBe(4000)
    expect(computeReconnectDelayMs(5)).toBe(16000)
  })

  it('封顶 30s，不随次数无限增长', () => {
    expect(computeReconnectDelayMs(6)).toBe(30000)
    expect(computeReconnectDelayMs(20)).toBe(30000)
  })

  it('支持自定义 base/max（纯函数无隐依赖）', () => {
    expect(computeReconnectDelayMs(1, 500, 2000)).toBe(500)
    expect(computeReconnectDelayMs(3, 500, 2000)).toBe(2000)
  })
})
