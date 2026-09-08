import { describe, expect, it } from 'vitest'
import { afterLoginPath, HOME_PATH, LOGIN_PATH } from './session-route'

/**
 * The guard hands `afterLoginPath` whatever it stamped into router state. Under
 * `HashRouter` a destination cannot leave the origin whatever it says, so these
 * assertions are about the day someone swaps in `BrowserRouter` — the swap that
 * would otherwise re-arm an open redirect with no code change to notice.
 */

describe('the destination the guard preserved (AC-7)', () => {
  it('reads a react-router Location rather than stringifying it', () => {
    // The bug this exists to prevent: `String(location)` is "[object Object]",
    // which fails every check below and silently sends everyone to the
    // dashboard — AC-7 lost with no error anywhere.
    expect(afterLoginPath({ pathname: '/chats', search: '' })).toBe('/chats')
  })

  it('keeps the query string, because it is part of where the user was', () => {
    expect(afterLoginPath({ pathname: '/chats', search: '?jid=123' })).toBe('/chats?jid=123')
  })

  it('accepts a plain path string', () => {
    expect(afterLoginPath('/groups')).toBe('/groups')
  })

  it('falls back to the dashboard when there was no destination', () => {
    expect(afterLoginPath(undefined)).toBe(HOME_PATH)
    expect(afterLoginPath(null)).toBe(HOME_PATH)
    expect(afterLoginPath({})).toBe(HOME_PATH)
    expect(afterLoginPath('')).toBe(HOME_PATH)
  })

  it('refuses to send the user back to the screen they just finished with', () => {
    expect(afterLoginPath(LOGIN_PATH)).toBe(HOME_PATH)
    expect(afterLoginPath('/login/anything')).toBe(HOME_PATH)
  })
})

describe('no destination may leave this origin (NFR-2)', () => {
  it('rejects an absolute URL', () => {
    expect(afterLoginPath('https://evil.example/steal')).toBe(HOME_PATH)
    expect(afterLoginPath('javascript:alert(1)')).toBe(HOME_PATH)
  })

  it('rejects a protocol-relative URL', () => {
    expect(afterLoginPath('//evil.example')).toBe(HOME_PATH)
  })

  it('rejects a backslash, which browsers normalise to a second slash', () => {
    expect(afterLoginPath('/\\evil.example')).toBe(HOME_PATH)
  })

  it('rejects control characters, which browsers strip before resolving', () => {
    // "/<TAB>//evil.example" resolves as "//evil.example" once the browser has
    // stripped the tab — an internal-looking path that leaves the origin.
    expect(afterLoginPath('/\t//evil.example')).toBe(HOME_PATH)
    expect(afterLoginPath('/\n//evil.example')).toBe(HOME_PATH)
    expect(afterLoginPath('/\r//evil.example')).toBe(HOME_PATH)
  })

  it('rejects a path that is not rooted', () => {
    expect(afterLoginPath('chats')).toBe(HOME_PATH)
    expect(afterLoginPath('evil.example/chats')).toBe(HOME_PATH)
  })
})
