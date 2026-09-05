import { describe, expect, it } from 'vitest'

/**
 * Executable source policy for the session (ticket z8pmx9md6y).
 *
 * These are the rules that would otherwise be review discipline: "don't put a
 * token in localStorage", "don't read document.cookie from anywhere else",
 * "don't decode the JWT". A rule nobody can run is a rule that decays, so each
 * one below is an assertion whose message states the rule it enforces.
 *
 * The sources are pulled in through `import.meta.glob` rather than read off
 * disk on purpose: it puts every guarded file in vitest's module graph, so a
 * watch run re-runs this file on exactly the edit it exists to catch.
 */
const MODULES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * Comments are stripped before anything is matched: this guards what the code
 * *does*, and a file that documents the rule it obeys must not fail it. The
 * `[^:]` guard keeps `https://` from being read as a line comment. It is a
 * lexer approximation — it can only ever remove text, never hide added code.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/**
 * Glob keys are relative to this file, so `./curl.ts` and `../api/auth.ts` both
 * arrive; they are normalised to repository paths because that is what a rule
 * violation has to name for the message to be actionable.
 */
function toRepoPath(key: string): string {
  if (key.startsWith('../')) return `src/${key.slice(3)}`
  if (key.startsWith('./')) return `src/lib/${key.slice(2)}`
  return key
}

/** Every shipped source file, keyed by repository path, comments removed. */
const SOURCES: [string, string][] = Object.entries(MODULES)
  .map(([key, source]): [string, string] => [toRepoPath(key), source])
  .filter(([path]) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
  .map(([path, source]): [string, string] => [path, stripComments(source)])
  .sort(([a], [b]) => a.localeCompare(b))

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return SOURCES.filter(([path, source]) => pattern.test(source) && !allowed.includes(path)).map(
    ([path]) => path,
  )
}

/** Identifiers that only appear where a credential is being handled. */
const CREDENTIAL = /access_token|refresh_token|\bBearer\b|password\s*[:=]|credential\s*[:=]/
const WEB_STORAGE = /\b(localStorage|sessionStorage)\b/

it('reads the source it is meant to guard', () => {
  expect(SOURCES.length).toBeGreaterThan(50)
  expect(SOURCES.map(([path]) => path)).toContain('src/stores/auth.ts')
})

describe('no credential reaches web storage (AC-9)', () => {
  it('RULE: a file that handles a token, password or credential may not touch localStorage or sessionStorage', () => {
    const violations = SOURCES.filter(
      ([, source]) => CREDENTIAL.test(source) && WEB_STORAGE.test(source),
    ).map(([path]) => path)
    expect(violations, 'the session lives in cookies only — see src/stores/auth.ts').toEqual([])
  })

  it('RULE: nothing writes to web storage directly; the two stores that persist do so through zustand, and hold no credential', () => {
    expect(
      offenders(/\b(localStorage|sessionStorage)\s*\.\s*setItem/),
      'persisting a value is the auth store’s job, and it persists to cookies',
    ).toEqual([])
  })

  it('RULE: only these files may name web storage at all — a new one must be justified here first', () => {
    expect(
      offenders(WEB_STORAGE, ['src/stores/connection.ts', 'src/stores/device.ts']),
      'connection.ts removes the legacy key; device.ts persists a device id, which is not a credential',
    ).toEqual([])
  })
})

describe('the store is the only session owner (AC-1, AC-2, AC-10)', () => {
  it('RULE: zustand persist may not be used by the auth store, and never over a credential', () => {
    const persisting = offenders(/persist\(|createJSONStorage/, [
      'src/stores/device.ts',
      'src/stores/recipient.ts',
    ])
    expect(persisting, 'the auth store persists to cookies, explicitly, in stores/auth.ts').toEqual(
      [],
    )
    const [, authStore] = SOURCES.find(([path]) => path === 'src/stores/auth.ts')!
    expect(/persist\(|createJSONStorage/.test(authStore)).toBe(false)
  })

  it('RULE: document.cookie is touched in exactly one file', () => {
    expect(
      offenders(/document\s*\.\s*cookie/, ['src/lib/cookies.ts']),
      'every cookie read and write goes through the adapter in src/lib/cookies.ts',
    ).toEqual([])
  })

  it('RULE: the access token is named only where it is owned, fetched or attached', () => {
    expect(
      offenders(/access_token/, ['src/stores/auth.ts', 'src/api/auth.ts', 'src/lib/http.ts']),
      'read the token from useAuth.getState(), never from storage or a second copy',
    ).toEqual([])
  })
})

describe('no token reaches a log, a URL or a rendered command (AC-18)', () => {
  it('RULE: a bearer token is attached in one interceptor, and stood in for everywhere else', () => {
    expect(
      offenders(/\bBearer\b/, ['src/lib/http.ts', 'src/lib/curl.ts']),
      'http.ts attaches the real header; curl.ts renders a valueless <token> placeholder',
    ).toEqual([])
  })

  it('RULE: the cURL renderer emits a placeholder and reads no token', () => {
    const [, curl] = SOURCES.find(([path]) => path === 'src/lib/curl.ts')!
    expect(curl).toContain('Authorization: Bearer <token>')
    expect(/useAuth|access_token/.test(curl)).toBe(false)
  })
})

describe('nothing decodes what the server owns (AC-15, AC-16)', () => {
  it('RULE: no JWT is decoded in the UI — the server rebuilds role and permissions per request', () => {
    expect(
      offenders(/\batob\s*\(|jwt-decode|jwtDecode|jose/),
      'account_id, epoch and sub come from GET /auth/me or not at all',
    ).toEqual([])
  })

  it('RULE: the refresh token is opaque and nothing may take it apart', () => {
    expect(offenders(/refresh_token\s*\.\s*split|decode\w*\(\s*\w*refresh/i)).toEqual([])
  })
})
