/**
 * The only place in `src/` that touches `document.cookie`.
 *
 * Split deliberately in two: `cookieAttributes` is pure and takes `secure` as
 * an argument, so the exact string this writes is assertable under the Node
 * test environment, where there is neither `document` nor `location`. The I/O
 * half below is the only part that needs a browser.
 *
 * This is storage, not protection. `HttpOnly` cannot be set from JavaScript —
 * only a server response can set it — so a cookie written here is as readable
 * to injected script as `localStorage` is. What it does buy is a lifetime the
 * browser enforces, `SameSite=Strict`, `Secure` on https, and one audited door
 * instead of an open key-value bag. See ADR-012.
 */

/** Cookies must be visible to a page served at the origin root — see ADR-012. */
const PATH = 'Path=/'
const SAME_SITE = 'SameSite=Strict'

/** True when the page itself is https, which is the only time `Secure` is legal. */
export function isSecurePage(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

/**
 * The exact `document.cookie` string for one write. `Secure` is appended last
 * and only when the page's own scheme allows it: setting it over plain http
 * makes the browser drop the cookie, which would break local development.
 */
export function cookieAttributes(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds))
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    PATH,
    SAME_SITE,
    `Max-Age=${maxAge}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

/**
 * Read one cookie, or null when it is absent. Values are encoded on write, so
 * they are decoded here; a value that is not valid percent-encoding is returned
 * as-is rather than throwing, because a malformed cookie is somebody else's.
 */
export function getCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined') return null
    const prefix = `${name}=`
    for (const entry of document.cookie.split(';')) {
      const candidate = entry.trimStart()
      if (!candidate.startsWith(prefix)) continue
      const raw = candidate.slice(prefix.length)
      try {
        return decodeURIComponent(raw)
      } catch {
        return raw
      }
    }
    return null
  } catch {
    // cookies disabled — indistinguishable from "no session", which is correct
    return null
  }
}

export function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  try {
    if (typeof document === 'undefined') return
    document.cookie = cookieAttributes(name, value, maxAgeSeconds, isSecurePage())
  } catch {
    // storage refused; the session simply does not survive this page
  }
}

/**
 * Delete a cookie. `Path` and `SameSite` must match the write or the browser
 * treats it as a different cookie and the original survives.
 */
export function removeCookie(name: string): void {
  try {
    if (typeof document === 'undefined') return
    document.cookie = cookieAttributes(name, '', 0, isSecurePage())
  } catch {
    // nothing to do — a cookie that cannot be written cannot be present either
  }
}
