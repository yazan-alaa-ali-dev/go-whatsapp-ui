import { describe, expect, it } from 'vitest'
import { API_PREFIX, HEALTH_PATH, absoluteApiUrl, joinUrl, rerootServerUrl, toWebSocketUrl } from './url'

describe('API_PREFIX', () => {
  it('is relative same-origin — no scheme, host or port', () => {
    expect(API_PREFIX.startsWith('/')).toBe(true)
    expect(API_PREFIX.startsWith('//')).toBe(false)
    expect(() => new URL(API_PREFIX)).toThrow()
    expect(API_PREFIX).not.toMatch(/:/)
  })

  it('is distinct from the health path, which stays at the root', () => {
    expect(HEALTH_PATH).toBe('/health')
    expect(HEALTH_PATH.startsWith(API_PREFIX)).toBe(false)
  })
})

describe('joinUrl', () => {
  it('joins without duplicating slashes', () => {
    expect(joinUrl('/api/', '/devices')).toBe('/api/devices')
    expect(joinUrl('/api', 'devices')).toBe('/api/devices')
  })
})

describe('rerootServerUrl', () => {
  it('discards the host the server built from its own Host header', () => {
    expect(rerootServerUrl('http://0.0.0.0:3000/statics/qrcode/x.png')).toBe(
      '/api/statics/qrcode/x.png',
    )
  })

  it('strips the server base path before joining', () => {
    expect(rerootServerUrl('http://pod:3000/wa/statics/q.png', '/wa')).toBe('/api/statics/q.png')
  })

  it('keeps a query string', () => {
    expect(rerootServerUrl('http://internal:3000/statics/q.png?v=2')).toBe(
      '/api/statics/q.png?v=2',
    )
  })

  it('handles a relative value the server may return instead', () => {
    expect(rerootServerUrl('/statics/q.png')).toBe('/api/statics/q.png')
  })
})

describe('toWebSocketUrl', () => {
  it('derives wss from an https page and prefixes the path', () => {
    const url = new URL(
      toWebSocketUrl(
        { device_id: 'device 1' },
        { protocol: 'https:', host: 'dash.example.com' },
      ),
    )
    expect(url.protocol).toBe('wss:')
    expect(url.host).toBe('dash.example.com')
    expect(url.pathname).toBe('/api/ws')
    expect(url.searchParams.get('device_id')).toBe('device 1')
  })

  it('derives ws from an http page and omits empty params', () => {
    const url = new URL(
      toWebSocketUrl({ device_id: '' }, { protocol: 'http:', host: 'localhost:5173' }),
    )
    expect(url.protocol).toBe('ws:')
    expect(url.pathname).toBe('/api/ws')
    expect([...url.searchParams.keys()]).toHaveLength(0)
  })

  it('carries no credential', () => {
    const url = toWebSocketUrl({ device_id: 'd1' }, { protocol: 'http:', host: 'localhost:5173' })
    expect(url).not.toMatch(/authorization/i)
  })
})

describe('absoluteApiUrl', () => {
  it('builds on the page origin, not on a backend address', () => {
    expect(absoluteApiUrl('/send/message', 'https://dash.example.com')).toBe(
      'https://dash.example.com/api/send/message',
    )
  })
})
