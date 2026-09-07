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
 * Strip the JSX `role` attribute before the role rule looks at anything.
 *
 * ARIA is the only legitimate reason a shipped file names `role` without it
 * being an authorization decision — `role="alert"`, `role="button"`. Removing
 * the attribute form is what lets the rule below ban the *field* outright
 * instead of chasing comparison shapes, which is the only version of the rule
 * that survives `const { role } = user` and `ROLE_CAPS[user.role]`.
 *
 * Like `stripComments`, it can only ever remove text — never hide added code.
 */
function stripAriaRole(source: string): string {
  return source.replace(/\brole\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\})/g, ' ')
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
  .map(([path, source]): [string, string] => [path, stripAriaRole(stripComments(source))])
  .sort(([a], [b]) => a.localeCompare(b))

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  return SOURCES.filter(([path, source]) => pattern.test(source) && !allowed.includes(path)).map(
    ([path]) => path,
  )
}

/**
 * Identifiers that only appear where a credential is being handled.
 *
 * `password` is matched as a bare identifier rather than as `password:`
 * (z8pmx9md6z): the narrower form missed `setPassword(x)`, `formData.password`
 * and `type="password"` — every shape the login form actually uses. Widening it
 * only ever makes the storage rule below stricter.
 */
const CREDENTIAL = /access_token|refresh_token|\bBearer\b|password|credential\s*[:=]/i
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
      offenders(WEB_STORAGE, [
        'src/stores/connection.ts',
        'src/stores/device.ts',
        'src/stores/account.ts',
      ]),
      'connection.ts removes the legacy key; device.ts and account.ts persist a device id and an account id, neither of which is a credential',
    ).toEqual([])
  })
})

describe('the store is the only session owner (AC-1, AC-2, AC-10)', () => {
  it('RULE: zustand persist may not be used by the auth store, and never over a credential', () => {
    const persisting = offenders(/persist\(|createJSONStorage/, [
      'src/stores/device.ts',
      'src/stores/recipient.ts',
      // z8pmx9mf16: the account lens. An account id is a scope, not a
      // credential — it names which devices are offered, and the server derives
      // the account from the device that travels, never from this value.
      'src/stores/account.ts',
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
    // `\b...\b` rather than a bare substring (z8pmx9md70): `access_token` and
    // `access_token_expires_at` are different facts. The expiry is a clock, not
    // a credential, and the refresh scheduler reads it — exempting a file for
    // naming an expiry would have widened this rule instead of narrowing it.
    // The word boundary does not match before `_`, so the expiry is excluded
    // and the token itself is still caught everywhere.
    expect(
      offenders(/\baccess_token\b/, [
        'src/stores/auth.ts',
        'src/api/auth.ts',
        'src/lib/http.ts',
        // The browser cannot set a header on a WebSocket handshake, so the
        // token travels in the query string — the server's own instruction
        // (reference §10). This is the "attached" case, one transport over.
        'src/lib/ws.ts',
      ]),
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

  it('RULE: nothing in src/ writes to the console at all (z8pmx9md70, AC-29)', () => {
    // The narrower rule — "a token near a console call" — was rejected at
    // review: it cannot see `console.log(pair)`, `console.log(getState())` or a
    // template built from a variable, so it would have guarded AC-29 in name
    // only. The shipped source contains zero console calls, so the flat ban is
    // both airtight and free, and its exemption list is empty on purpose. A
    // refresh outcome is recorded in the store and read through diagnostics().
    expect(
      offenders(/\bconsole\s*\./),
      'no token may reach a log; the audited output is useAuth.getState().diagnostics()',
    ).toEqual([])
  })

  it('RULE: the cURL renderer emits a placeholder and reads no token', () => {
    const [, curl] = SOURCES.find(([path]) => path === 'src/lib/curl.ts')!
    expect(curl).toContain('Authorization: Bearer <token>')
    expect(/useAuth|access_token/.test(curl)).toBe(false)
  })
})

describe('the credential the login form handles (z8pmx9md6z, AC-25)', () => {
  it('RULE: `password` is named only where the form holds it and the request type declares it', () => {
    // Substring, not `\bpassword\b`: the word-boundary form cannot match inside
    // `setPassword`, which is the single most likely way a credential would
    // actually escape a form. Mutation-testing this rule is what caught that.
    expect(
      offenders(/password/i, [
        'src/api/auth.ts',
        'src/pages/login.tsx',
        'src/lib/auth-messages.ts',
        // z8pmx9mf16: the administrative reset (POST /auth/users/{id}/password)
        // and the create-user body. This is the case the rule's own message
        // sanctions — "the request type declares it" — and it is all the file
        // does: no value is held, stored or read back.
        'src/api/users.ts',
      ]),
      'the password lives in the login form’s own state and is discarded after the request; auth-messages.ts names it in copy, never as a value',
    ).toEqual([])
  })

  it('RULE: ending a session is one code path, and it lives in the store', () => {
    // A logout button, an expired token and a refused token are three triggers
    // for one outcome. If each grew its own teardown they would drift, and one
    // of them would eventually leave a half-cleared session behind.
    expect(
      offenders(/\bclearSession\(|\bendSession\(/, ['src/stores/auth.ts']),
      'call signOut() or endRefusedSession(); the teardown itself belongs to the store',
    ).toEqual([])
  })

  it('RULE: no server-supplied text is rendered as HTML', () => {
    // The login screen renders a message any intermediary in front of gowa can
    // choose, to a visitor who has not authenticated yet.
    expect(
      offenders(/dangerouslySetInnerHTML/),
      'server and user text is rendered as a text child, which React escapes',
    ).toEqual([])
  })
})

describe('nothing decodes what the server owns (AC-15, AC-16)', () => {
  it('RULE: no JWT is decoded in the UI — the server rebuilds role and permissions per request', () => {
    expect(
      // Widened for z8pmx9md71: the original four names cover the libraries a
      // developer would reach for and none of the ways somebody would hand-roll
      // it. Verified free — src/ contains zero occurrences of the three added
      // names — so this costs nothing and closes AC-7 rather than half of it.
      offenders(
        /\batob\s*\(|jwt-decode|jwtDecode|jose|base64|Buffer\s*\.\s*from|TextDecoder/,
      ),
      'account_id, epoch and permissions come from GET /auth/me or not at all',
    ).toEqual([])
  })

  it('RULE: the refresh token is opaque and nothing may take it apart', () => {
    expect(offenders(/refresh_token\s*\.\s*split|decode\w*\(\s*\w*refresh/i)).toEqual([])
  })
})

describe('rights come from permissions[], never from a role name (z8pmx9md71)', () => {
  it('RULE: no shipped file names `role` or `roles` outside the five that only display one', () => {
    // The reference's golden rule (§04) and its own list of common traps (§11):
    // permissions are compile-time constants, roles are database rows an
    // operator can compose without a redeploy — so a role name is not a fact
    // this UI may reason about.
    //
    // The rule matches the FIELD, not a comparison. An earlier draft matched
    // `.role ===`, `.role !==`, `roles.includes` and equality against the three
    // seeded names; review pointed out what that misses — `const { role } =
    // user` (no dot), `switch (user.role)`, `==`, `user.role.startsWith(…)`,
    // and above all a lookup table `ROLE_CAPS[user.role]` or
    // `ADMIN_ROLES.includes(user.role)`, which is exactly the role-derivation
    // §04 forbids and which no comparison pattern can see. Naming the field is
    // the one thing none of those can avoid.
    //
    // ARIA is stripped first (`stripAriaRole`), so `role="alert"` and
    // `role="button"` are not offences and a new one never will be.
    expect(
      offenders(/\brole\b|\broles\b/, [
        // The wire type: /auth/me answers with `role` and `roles[]`, and the
        // interface has to say so. Nothing reads them for a decision.
        'src/api/auth.ts',
        // A newsletter *viewer* role — an unrelated field that happens to share
        // the word, rendered as text.
        'src/api/newsletter.ts',
        'src/features/newsletter/newsletter-list.tsx',
        // diagnostics() reports the role as identity, in output meant for a
        // human reading a support ticket.
        'src/stores/auth.ts',
        // The user menu renders it as identity, next to the username.
        'src/components/layout/user-menu.tsx',
        // z8pmx9mf16: the user-administration wire type. `roles[]` is the field
        // the API sends and receives, so it cannot be avoided and must not be
        // renamed into something misleading. The exemption is narrowed rather
        // than granted: the rule immediately below allows the file to DECLARE
        // the field and nothing else, so a read, a rename, a lookup table or a
        // bracket access still fails the build.
        'src/api/users.ts',
      ]),
      'decide from permissions[] — see src/lib/permissions.ts; a role name is not authority',
    ).toEqual([])
  })

  it('RULE: `permissions` is read off the principal in one layer and copied nowhere', () => {
    // AC-8: one source of truth. A component reading `user.permissions`
    // directly is the second copy, and the moment the two disagree the
    // disagreement is an authorization bug.
    //
    // Three spellings, because review showed the narrow `.permissions` form is
    // evaded by `const { permissions } = user` and by `user['permissions']`.
    // Case-sensitive on purpose: the PERMISSIONS catalogue and NO_PERMISSIONS
    // are constants, not reads of the principal. Prose is unaffected — English
    // does not end the word with `,` or `}`, which is why the bare-word form
    // this replaced would have failed on auth-messages.ts's own sign-out copy
    // ("Your permissions were updated") the day it was written.
    expect(
      offenders(/\.permissions\b|\bpermissions\s*[,}]|\[\s*['"]permissions['"]\s*\]/, [
        'src/api/auth.ts',
        'src/stores/auth.ts',
        'src/lib/permissions.ts',
        'src/hooks/use-permissions.ts',
      ]),
      'read it through @/hooks/use-permissions — one reader, one copy',
    ).toEqual([])
  })

  it('RULE: a permission check, a redaction check and a device-scope check are three authorities and none may import another', () => {
    // `hasField(m, 'sent_by')` reads like "I hold messages.origin.read" and is
    // not: it is a statement about one payload, from one request. Masking is
    // key deletion with no 403 attached (§09), so presence must never gate an
    // action. The module boundary is the cheapest control on that confusion,
    // and it is only a control if it is enforced.
    const [, permissions] = SOURCES.find(([path]) => path === 'src/lib/permissions.ts')!
    const [, redaction] = SOURCES.find(([path]) => path === 'src/lib/redaction.ts')!

    expect(/from\s+['"][^'"]*redaction['"]/.test(permissions)).toBe(false)
    expect(/from\s+['"][^'"]*permissions['"]/.test(redaction)).toBe(false)

    // z8pmx9mf16 adds the third. `hasScopedField(device, 'account_id')` reads
    // like "I hold accounts.manage" and is not — it is a statement about one
    // payload — and it is not the §09 masking rule either, which is about
    // message fields and a different document section. Three authorities, three
    // modules, no edge between any two of them.
    const [, deviceScope] = SOURCES.find(([path]) => path === 'src/lib/device-scope.ts')!
    expect(/from\s+['"][^'"]*device-scope['"]/.test(permissions)).toBe(false)
    expect(/from\s+['"][^'"]*device-scope['"]/.test(redaction)).toBe(false)
    expect(/from\s+['"][^'"]*permissions['"]/.test(deviceScope)).toBe(false)
    expect(/from\s+['"][^'"]*redaction['"]/.test(deviceScope)).toBe(false)
  })

  it('RULE: the two files a later ticket opens say that hiding is not enforcement', () => {
    // NFR-5. The sentence exists so nobody reads `<Can>` as a security control;
    // a sentence only in spec.md is a sentence nobody will meet. Asserted on
    // the raw sources, because it lives in a comment.
    for (const path of ['src/lib/permissions.ts', 'src/components/shared/can.tsx']) {
      const source = MODULES[path.replace('src/', '../')] ?? MODULES[path.replace('src/lib/', './')]
      expect(source, `${path} should be in the module graph`).toBeTypeOf('string')
      expect(source, `${path} must state that hiding is an affordance, not enforcement`).toMatch(
        /affordance, never enforcement/,
      )
      expect(source).toMatch(/server is the only authority/)
    }
  })
})

describe('the account is a lens, not a scope on the wire (z8pmx9mf16)', () => {
  it('RULE: `roles` is DECLARED in src/api/users.ts and read nowhere — every mention is one of its field declarations', () => {
    // This is what narrows the allowlist entry above from an exemption into a
    // permission to declare. The study (§13) asks for exactly this distinction:
    // a role as a value assigned or displayed is allowed, a role as a source of
    // authority never is — and a plain allowlist entry grants both.
    //
    // Counting rather than stripping, deliberately. An earlier draft removed
    // every `roles\s*\??\s*:` and asserted nothing was left; review showed that
    // also erases `const { roles: assigned } = user` — a destructuring rename,
    // which is a role read as authority — and an object literal `roles: [...]`.
    // A stripping pass can hide what it was meant to catch. Counting cannot:
    // every one of those adds a mention without adding a declaration.
    const [, users] = SOURCES.find(([path]) => path === 'src/api/users.ts')!
    const declarations = users.match(/^[ \t]*roles\??: string\[\][ \t]*\r?$/gm) ?? []
    const mentions = users.match(/\brole\b|\broles\b/g) ?? []

    expect(declarations.length, 'the wire field should still be declared').toBeGreaterThan(0)
    expect(
      mentions.length,
      'src/api/users.ts may declare the field and do nothing else with it — decide from permissions[], see src/lib/permissions.ts',
    ).toBe(declarations.length)
  })

  it('RULE: no file reads a role through a bracket access', () => {
    // The spelling that survives every rule written against `.role`, and the
    // one the sibling `permissions` rule was already hardened against. Free
    // today — src/ contains zero occurrences — so it costs nothing and closes
    // the gap before somebody finds it.
    expect(
      offenders(/\[\s*['"`]roles?['"`]\s*\]/),
      'a role name is not authority; ROLE_CAPS[user.role] is the shape §04 forbids',
    ).toEqual([])
  })

  it('RULE: there is no X-Account-Id header on this wire, so the name appears nowhere', () => {
    // AC-5, asserted against the thing itself rather than against an import.
    // The account is a client-side lens: the only scope that travels is
    // X-Device-Id, and the backend derives the account from that device's
    // ownership. A header named here would be a header this server ignores.
    expect(
      offenders(/X-Account-Id/i),
      'the account narrows which devices are offered; the device id is what carries scope',
    ).toEqual([])
  })

  it('RULE: a request header is attached in one file', () => {
    // The import ban below is evadable by a relative specifier or a dynamic
    // import, and in any case it does not stop a header being attached from
    // anywhere that already holds an id. This does: every header this client
    // sets is set in the one interceptor, where it can be read in one place.
    expect(
      offenders(/config\s*\.\s*headers\s*\[/, ['src/lib/http.ts']),
      'headers are attached by the request interceptor in src/lib/http.ts',
    ).toEqual([])
  })

  it('RULE: a store that persists names a versioned key', () => {
    // Changing a persisted shape means changing the version, or state already
    // saved in a user's browser is read back as the wrong thing. Asserted on
    // the source because zustand's persist middleware degrades to a plain store
    // when it cannot reach a storage — which is the case in this test
    // environment — so there is no `.persist` to read the name off at runtime.
    for (const path of ['src/stores/device.ts', 'src/stores/account.ts']) {
      const [, source] = SOURCES.find(([candidate]) => candidate === path)!
      expect(source, `${path} must persist under a versioned name`).toMatch(
        /name:\s*'gowa-ui\.[a-z-]+\.v\d+'/,
      )
    }
    // src/stores/recipient.ts persists under the unversioned `gowa-recipient`.
    // It predates the convention and holds no shape this ticket touches, so it
    // is recorded here rather than changed.
    const [, recipient] = SOURCES.find(([path]) => path === 'src/stores/recipient.ts')!
    expect(recipient).toContain("name: 'gowa-recipient'")
  })

  it('RULE: the account lens is imported only where the scope is owned or applied', () => {
    // Matched on any specifier ending in `stores/account`, so a relative path
    // and a dynamic import are caught with the aliased form. Nothing in
    // src/lib/ may reach it — which is what makes "this store adds no header"
    // structurally true rather than merely observed.
    expect(
      offenders(/(?:from|import\()\s*['"][^'"]*stores\/account['"]/, [
        // The lens is reset when a session ends, in the effect that already
        // clears the cache for the same reason.
        'src/App.tsx',
        // The one consumer: it turns the lens into a query key and a filter.
        'src/hooks/use-devices.ts',
      ]),
      'read the scope through useDevices(); nothing in lib/ may reach the lens',
    ).toEqual([])
  })
})
