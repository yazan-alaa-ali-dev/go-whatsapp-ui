import { afterEach, describe, expect, it, vi } from 'vitest'
import { cookieAttributes, getCookie, isSecurePage, removeCookie, setCookie } from './cookies'

/**
 * A minimal `document.cookie` stand-in. The browser's own accessor is
 * write-one/read-all, so this mirrors that rather than exposing a map: a test
 * that asserts against the written string is asserting the thing the browser
 * actually parses.
 */
function cookieJar() {
  const writes: string[] = []
  const jar = new Map<string, string>()
  vi.stubGlobal('document', {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
    },
    set cookie(entry: string) {
      writes.push(entry)
      const [pair] = entry.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index)
      const value = pair.slice(index + 1)
      if (entry.includes('Max-Age=0')) jar.delete(name)
      else jar.set(name, value)
    },
  })
  return writes
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cookieAttributes', () => {
  it('writes Path, SameSite and Max-Age, and Secure only over https', () => {
    expect(cookieAttributes('gowa-ui.access.v1', 'token', 900, true)).toBe(
      'gowa-ui.access.v1=token; Path=/; SameSite=Strict; Max-Age=900; Secure',
    )
  })

  it('omits Secure over plain http, which a browser would otherwise reject', () => {
    expect(cookieAttributes('gowa-ui.access.v1', 'token', 900, false)).toBe(
      'gowa-ui.access.v1=token; Path=/; SameSite=Strict; Max-Age=900',
    )
  })

  it('carries the refresh token its own 30 days, not the access token lifetime', () => {
    expect(cookieAttributes('gowa-ui.refresh.v1', 'opaque', 2_592_000, true)).toContain(
      'Max-Age=2592000',
    )
  })

  it('encodes the value — an opaque refresh token is not guaranteed cookie-safe', () => {
    expect(cookieAttributes('k', 'a;b=c d', 60, false)).toContain('k=a%3Bb%3Dc%20d')
  })

  it('floors and clamps the lifetime rather than emitting a fractional Max-Age', () => {
    expect(cookieAttributes('k', 'v', 12.7, false)).toContain('Max-Age=12')
    expect(cookieAttributes('k', 'v', -5, false)).toContain('Max-Age=0')
  })
})

describe('isSecurePage', () => {
  it('is true only when the page itself is https', () => {
    vi.stubGlobal('location', { protocol: 'https:' })
    expect(isSecurePage()).toBe(true)
    vi.stubGlobal('location', { protocol: 'http:' })
    expect(isSecurePage()).toBe(false)
  })
})

describe('the cookie door', () => {
  it('round-trips a value that contains cookie punctuation', () => {
    cookieJar()
    setCookie('gowa-ui.refresh.v1', 'a;b=c', 60)
    expect(getCookie('gowa-ui.refresh.v1')).toBe('a;b=c')
  })

  it('returns null for a cookie that is not there', () => {
    cookieJar()
    expect(getCookie('gowa-ui.access.v1')).toBeNull()
  })

  it('does not match a cookie whose name merely ends with the one asked for', () => {
    cookieJar()
    setCookie('other.gowa-ui.access.v1', 'wrong', 60)
    expect(getCookie('gowa-ui.access.v1')).toBeNull()
  })

  it('removes with Max-Age=0 and the same Path, or the original would survive', () => {
    const writes = cookieJar()
    setCookie('gowa-ui.access.v1', 'token', 900)
    removeCookie('gowa-ui.access.v1')
    expect(writes[1]).toContain('Max-Age=0')
    expect(writes[1]).toContain('Path=/')
    expect(writes[1]).toContain('SameSite=Strict')
    expect(getCookie('gowa-ui.access.v1')).toBeNull()
  })

  it('degrades to "no session" where there is no document at all', () => {
    expect(getCookie('gowa-ui.access.v1')).toBeNull()
    expect(() => setCookie('gowa-ui.access.v1', 'token', 900)).not.toThrow()
    expect(() => removeCookie('gowa-ui.access.v1')).not.toThrow()
  })

  it('survives a browser that refuses storage instead of taking boot down', () => {
    vi.stubGlobal('document', {
      get cookie(): string {
        throw new Error('cookies disabled')
      },
      set cookie(_entry: string) {
        throw new Error('cookies disabled')
      },
    })
    expect(getCookie('gowa-ui.access.v1')).toBeNull()
    expect(() => setCookie('gowa-ui.access.v1', 'token', 900)).not.toThrow()
  })
})
