/**
 * Where an unauthenticated visitor is sent, and where they are allowed back to.
 *
 * The whole module exists for `afterLoginPath`. The route guard stamps the
 * refused destination into router state so a successful sign-in can return the
 * user to it, and this is the one place that decides whether a destination is
 * one this app is willing to navigate to.
 *
 * The app runs under `HashRouter` (`src/main.tsx`), so a destination is written
 * after the `#` and cannot leave the origin today. That is a property of the
 * router, not of this code, and swapping to `BrowserRouter` would re-arm the
 * open-redirect surface silently — so the validation lives here rather than
 * resting on the router.
 */

export const LOGIN_PATH = '/login'
export const HOME_PATH = '/'

/**
 * Browsers strip tab, carriage return and newline before resolving a URL, so a
 * candidate like `"/<TAB>//evil.example"` resolves as the protocol-relative
 * `"//evil.example"` and leaves the origin. Rejecting every control character
 * covers that whole family at once.
 *
 * Written as a code-point scan rather than a character class because a regexp
 * over C0 controls has to carry those bytes in the source file itself.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * A path this app will navigate to: rooted, and not the start of a URL that
 * points somewhere else. `//host` is protocol-relative, and browsers normalise
 * the backslash in `/\host` to the same thing.
 */
function isInternalPath(candidate: string): boolean {
  if (!candidate.startsWith('/')) return false
  const second = candidate[1]
  return second !== '/' && second !== '\\'
}

/**
 * The guard stamps a react-router `Location` object, not a string — reading
 * `pathname` and `search` explicitly is what keeps this from stringifying one
 * into `"[object Object]"` and silently losing the destination. A plain string
 * is accepted too, because that is what a test and a future caller will pass.
 */
function readPath(from: unknown): string | null {
  if (typeof from === 'string') return from
  if (typeof from === 'object' && from !== null) {
    const location = from as { pathname?: unknown; search?: unknown }
    if (typeof location.pathname === 'string') {
      const search = typeof location.search === 'string' ? location.search : ''
      return location.pathname + search
    }
  }
  return null
}

/**
 * The destination to land on after a successful sign-in. Anything unusable —
 * absent, foreign, malformed, or the login screen itself — falls back to the
 * dashboard rather than failing, because a sign-in that worked should never end
 * on an error.
 */
export function afterLoginPath(from: unknown): string {
  const candidate = readPath(from)
  if (candidate === null) return HOME_PATH
  if (hasControlCharacter(candidate)) return HOME_PATH
  if (!isInternalPath(candidate)) return HOME_PATH
  // Returning to /login would bounce the user straight back out of the screen
  // they just finished with.
  if (candidate === LOGIN_PATH || candidate.startsWith(`${LOGIN_PATH}/`)) return HOME_PATH
  return candidate
}
