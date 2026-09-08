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
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
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
        // z8pmx9mf1a: the users administration surface. Five files, enumerated
        // rather than discovered at implement time — the advisory panel's point
        // was that four unplanned entries added under pressure is how a
        // narrowed rule becomes a bare exemption.
        //
        // The rule is a case-insensitive SUBSTRING over the whole file, so it
        // catches identifiers, UI copy and an aria-label alike. Only two of
        // these five hold a value:
        //
        //   user-admin.ts          — PASSWORD_MIN_BYTES, passwordError, and the
        //                            byte-length validator. Measures, never holds.
        //   create-user-dialog     — holds one in useState until the request.
        //   reset-password-dialog  — the same, for somebody else's account.
        //   users-panel.tsx        — imports and mounts the reset dialog.
        //   user-row.tsx           — an aria-label reading "Reset the password
        //                            of …". Copy, and it stays accurate rather
        //                            than being reworded to dodge a regex.
        //
        // The exemption is narrowed by the rules under "the users surface holds
        // a credential" below, which apply to ALL of these files rather than to
        // two named ones — so widening this list cannot widen what is allowed.
        'src/lib/user-admin.ts',
        'src/features/user-admin/users-panel.tsx',
        'src/features/user-admin/user-row.tsx',
        'src/features/user-admin/create-user-dialog.tsx',
        'src/features/user-admin/reset-password-dialog.tsx',
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
      offenders(/\batob\s*\(|jwt-decode|jwtDecode|jose|base64|Buffer\s*\.\s*from|TextDecoder/),
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
        // z8pmx9mf1a: the users administration surface — the ticket that finally
        // puts roles on screen. They are ASSIGNED and DISPLAYED here, which is
        // the distinction the study (§13) draws and which the `api/users.ts`
        // entry above could only express by "declare and never read".
        //
        // That treatment cannot be copied here, and the advisory panel is why:
        // it works one file over only because every mention there is a
        // `roles?: string[]` declaration line. `user-admin.ts` declares no
        // interface — it imports the wire types — and must legitimately read the
        // field about ten times (set comparison, omission, the seeded list), so
        // a declarations-equal-mentions count could never hold. Asserting
        // something unsatisfiable is worse than asserting nothing: it gets
        // deleted, and the exemption is what survives.
        //
        // What narrows these five instead is the rule immediately below, which
        // bans the SHAPE that makes a role authority — a role value compared
        // against a literal — across every one of them.
        'src/lib/user-admin.ts',
        'src/features/user-admin/users-panel.tsx',
        'src/features/user-admin/user-row.tsx',
        'src/features/user-admin/create-user-dialog.tsx',
        'src/features/user-admin/edit-user-dialog.tsx',
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
        // z8pmx9mf17 — the three files that own or move the scope, and nothing
        // else. Each one is a place a human deliberately changes which account
        // they are acting inside; none of them is a place the scope is read to
        // decide something, which is still useDevices()'s job alone.
        //
        // The switcher: the control a super administrator uses to leave their
        // own account. `accounts.manage.all` gates its mounting.
        'src/components/layout/account-switcher.tsx',
        // The context bar: it reads the scope to know whether to warn, and
        // writes enterAccount(null) as the way back out.
        'src/components/layout/account-context-bar.tsx',
        // The one route carrying an account id in its URL, which writes it into
        // the lens so a shared link restores the context.
        'src/pages/account-detail.tsx',
        // z8pmx9mf18 — the delete. This is the fourth place a human deliberately
        // changes which account they are acting inside, and the only one where
        // the account they were inside stops existing: left behind, the lens
        // names a deleted account and GET /devices?account_id= answers 200 with
        // an empty array rather than a 404 (reference §05), which reads as "I
        // have no devices" with no diagnosis available anywhere. The entry buys
        // one write, `enterAccount(null)`, taken from the pure decision in
        // @/lib/surfaces — asserted by its own rule below.
        'src/features/account-admin/delete-account-dialog.tsx',
      ]),
      'read the scope through useDevices(); nothing in lib/ may reach the lens',
    ).toEqual([])
  })
})

describe('navigation and the home surface come from permissions[] (z8pmx9mf17)', () => {
  it('RULE: the two decision modules read their argument and nothing else — no store, no role', () => {
    // AC-3 and AC-17. `homeSurface` and `visibleNavGroups` are the first real
    // consumers of the permission layer, and the study (§13, rule 2) asks for
    // exactly this shape: a pure function taking the array as an ARGUMENT, so
    // @/hooks/use-permissions stays the single reader of the field.
    //
    // The store pattern is the one the account-lens rule above already uses —
    // any specifier ending in `stores/…`, so a relative path and a dynamic
    // import are caught, not only the aliased spelling. An earlier draft matched
    // `from '@/stores/` alone and would have missed both.
    // z8pmx9mf18 adds the third decision module to the loop rather than writing a
    // fourth rule for it: the guarantee is identical and one loop is one place to
    // add the next one.
    for (const path of [
      'src/lib/surfaces.ts',
      'src/components/layout/navigation.ts',
      'src/lib/account-lifecycle.ts',
    ]) {
      const [, source] = SOURCES.find(([candidate]) => candidate === path)!
      expect(
        source,
        `${path} must not import a store — it takes its input as an argument`,
      ).not.toMatch(/(?:from|import\()\s*['"][^'"]*stores\//)
      // Case-INsensitive here, unlike the repository-wide rule above, which is
      // case-sensitive so the PERMISSIONS catalogue does not trip its sibling
      // `permissions` rule. These two files contain no spelling of the word at
      // all, so the wider form is free, and they are the two files where a role
      // must not appear in any casing because they ARE the decision.
      //
      // What neither form catches — deliberately — is a role name buried inside
      // a longer identifier (`adminRoles`, `ROLE_MAP`): `\b` does not match
      // between two word characters. That is not a gap, because such a constant
      // decides nothing on its own; deriving a right from it requires READING
      // the field off the principal, and every spelling of that read
      // (`user.role`, `const { role }`, `user['roles']`) carries the boundary
      // and is caught, here and by the repository-wide rule. Mutation-tested in
      // both directions.
      expect(source, `${path} must decide from permissions[], never from a role name`).not.toMatch(
        /\brole\b|\broles\b/i,
      )
    }
  })

  it('RULE: the account detail route writes only the scope the pure decision returned', () => {
    // AC-12 / AC-12a, and the one thing the pure tests cannot reach: whether the
    // component actually asks. There is no renderer in this environment, so a
    // guard dropped from that effect would leave every unit test green.
    //
    // Two things stop that, and this asserts the second. First,
    // `accountScopeEntry` takes the permission as a REQUIRED argument, so
    // bypassing it is a missing argument and a compile error. Second, this file
    // may write the lens only with what that function returned — never with the
    // route parameter it was handed, and never unconditionally.
    const [, page] = SOURCES.find(([path]) => path === 'src/pages/account-detail.tsx')!
    const writes = page.match(/enterAccount\([^)]*\)/g) ?? []
    expect(writes, 'the lens is written once, from the pure decision').toEqual([
      'enterAccount(entry.enter)',
    ])
    expect(page, 'the scope written must BE the decision, not a value beside it').toMatch(
      /const entry = accountScopeEntry\(/,
    )
    expect(page, 'and the decision must be told what the principal may do').toMatch(
      /mayLeaveOwnAccount,?\s*\)/,
    )
    // AC-12a's other half: a refused id renders the refusal. The scope write is
    // already impossible without the permission (the argument is required), so
    // inverting this guard leaks a screen rather than a scope — but a screen
    // naming an account the principal may not enter is still the thing AC-12a
    // asks for, and this is the only reach a suite with no renderer has.
    expect(page, 'a refused account id renders the permission-denied surface').toMatch(
      /if \(!permitted\) return <PermissionDenied \/>/,
    )
  })

  it('RULE: the shell mounts the account switcher behind the global permission', () => {
    // AC-8. The switcher is the control that LEAVES your own account, so it is
    // the one place `accounts.manage.all` — and nothing narrower — is the gate.
    // Text-asserted for the same reason as the rule above: the decision lives in
    // JSX, where this environment cannot render it.
    const [, shell] = SOURCES.find(([path]) => path === 'src/components/layout/app-shell.tsx')!
    expect(shell, 'the switcher is gated on accounts.manage.all').toMatch(
      /useHasPermission\(PERMISSIONS\.ACCOUNTS_MANAGE_ALL\)/,
    )
    expect(shell, 'and it is rendered only behind that boolean').toMatch(
      /\{mayLeaveOwnAccount && <AccountSwitcher \/>\}/,
    )
  })

  it('RULE: a navigation entry is absent, never disabled', () => {
    // AC-9. A disabled control still announces that the capability exists, which
    // for an administrative surface is worse than saying nothing at all. The
    // real guarantee is the shape of NavItem — there is nowhere to put the flag
    // — and this is what stops it being added, in the model or in the shell that
    // renders it. Both files are free of the word today, so the rule is free.
    for (const path of [
      'src/components/layout/navigation.ts',
      'src/components/layout/app-shell.tsx',
    ]) {
      const [, source] = SOURCES.find(([candidate]) => candidate === path)!
      expect(source, `${path} must drop an unavailable entry, not disable it`).not.toMatch(
        /\bdisabled\b/,
      )
    }
  })

  it('RULE: the permission-denied surface ends no session and navigates nowhere', () => {
    // AC-13. A 403 is a permission rejection, not an identity one: there is
    // nothing wrong with the session, so nothing here may spend a refresh, tear
    // one down, or redirect — a redirect also hides which route was refused and
    // makes a permission problem look like an authentication one.
    //
    // Asserted against the two files rather than globally, because signOut() is
    // legitimate in the user menu and refreshSession() in http.ts.
    for (const path of [
      'src/components/layout/require-permission.tsx',
      'src/components/shared/permission-denied.tsx',
    ]) {
      const [, source] = SOURCES.find(([candidate]) => candidate === path)!
      expect(source, `${path} must render a surface and do nothing else`).not.toMatch(
        /\bsignOut\b|\bendRefusedSession\b|\brefreshSession\b|\bNavigate\b/,
      )
    }
  })

  it('RULE: <Can> is a screen guard, so it may not appear in a file that renders a list', () => {
    // The study's §13 rule 3, made runnable. Every <Can> opens its own store
    // subscription, so one per row of a hundred-row table is a hundred
    // subscriptions for one answer that does not vary — the source's own
    // documentation says to hoist the boolean into the parent and use `&&`.
    //
    // Anchored `<Can[\s/>]` rather than a bare `<Can`, which would also have
    // matched <Canvas> and <Candidate>. Free today: <Can> has zero call sites,
    // and this ticket hoists booleans rather than adding one.
    const violations = SOURCES.filter(
      ([, source]) => /<Can[\s/>]/.test(source) && /\.map\(/.test(source),
    ).map(([path]) => path)
    expect(
      violations,
      'hoist the boolean once in the parent — see the header of src/components/shared/can.tsx',
    ).toEqual([])
  })

  it('RULE: the session teardown still resets the account lens', () => {
    // z8pmx9mf17 is the first ticket that can leave a NON-null lens behind, so
    // this line stopped being a precaution and became load-bearing: without it a
    // second principal on a shared browser boots into the previous one's
    // account. It lives in the effect that already clears the query cache, for
    // the same reason, and enterAccount(null) drops the device selection in the
    // same action.
    const [, app] = SOURCES.find(([path]) => path === 'src/App.tsx')!
    expect(app, 'App.tsx must reset the lens when a session ends').toMatch(/enterAccount\(null\)/)
  })
})

describe('the account lifecycle destroys data, so its decisions are pure (z8pmx9mf18)', () => {
  it('RULE: the delete dialog reads no cache, so expected_devices can only be a live read', () => {
    // AC-14, and the hole the advisory panel found in the first draft: a count
    // is a value anything can mint. `deleteRequestFor` now takes the device
    // ARRAY, which puts the provenance in the signature — but a cached array
    // would still type-check, so the other half of the guarantee is that this
    // file cannot reach the cache at all.
    //
    // `getQueryData` and `getQueriesData` are the two reads TanStack offers.
    // Asserted against the file rather than globally: reading the cache is
    // legitimate anywhere the answer is not about to authorise a purge.
    const [, dialog] = SOURCES.find(
      ([path]) => path === 'src/features/account-admin/delete-account-dialog.tsx',
    )!
    expect(
      /getQueryData|getQueriesData/.test(dialog),
      'expected_devices is the length of a list read at submission — never one out of the cache',
    ).toBe(false)
    // And the read itself must be there. Without this the rule above passes on a
    // file that submits a literal.
    expect(dialog, 'the submission reads the account’s devices itself').toMatch(
      /await listAccountDevices\(/,
    )
  })

  it('RULE: the delete dialog writes the lens only with what the pure decision returned', () => {
    // AC-21. The same shape z8pmx9mf17 asserts for the account detail route, for
    // the same reason: there is no renderer in this environment, so a guard
    // dropped from this component would leave every unit test green. The lens is
    // written once, with a literal null, and only behind the pure decision.
    const [, dialog] = SOURCES.find(
      ([path]) => path === 'src/features/account-admin/delete-account-dialog.tsx',
    )!
    const writes = dialog.match(/enterAccount\([^)]*\)/g) ?? []
    expect(writes, 'the lens is returned to implicit, and nothing else is written').toEqual([
      'enterAccount(null)',
    ])
    expect(dialog, 'and only when the pure decision says the account is gone').toMatch(
      /if \(shouldLeaveDeletedAccount\(/,
    )
  })

  it('RULE: a delete outcome is read from account_deleted and from no second field', () => {
    // AC-17. "A deleted message shown on a 200 without reading this field lies to
    // the operator on every partial run." The decision lives in one function, so
    // this asserts that the dialog asks it rather than re-deriving the answer
    // from the report's lists — the shape that would make two fields answer one
    // question.
    const [, dialog] = SOURCES.find(
      ([path]) => path === 'src/features/account-admin/delete-account-dialog.tsx',
    )!
    expect(dialog, 'the dialog asks deleteOutcome()').toMatch(/deleteOutcome\(/)
    expect(
      /failed_devices\s*(\?\.)?\.?length\s*===|failed_devices\s*(\?\.)?\.?length\s*>/.test(dialog),
      'the account is kept or gone by account_deleted alone — see deleteOutcome',
    ).toBe(false)
  })

  it('RULE: the reference value never reaches a rendered message', () => {
    // AC-9 / NFR-4. meta_token_ref names an environment variable holding a Meta
    // access token; it is not the token and must never become one on screen.
    // Two paths could have put a value there and both are closed:
    //
    // 1. The validator's message. `metaTokenRefError` returns a fixed sentence
    //    naming only the prefix — asserted in account-lifecycle.test.ts, and here
    //    against the source, because interpolating the argument is the one edit
    //    that would break it.
    // 2. The server's own text. A 400 rejecting the field may quote it, so
    //    `createFailure` redacts server text for any failed request that carried
    //    a reference. This asserts the dialog uses that decision rather than
    //    reaching for toActionErrorMessage on its own.
    const [, lifecycle] = SOURCES.find(([path]) => path === 'src/lib/account-lifecycle.ts')!
    const messageLine = lifecycle.match(/return `This is the NAME[^`]*`/)?.[0] ?? ''
    expect(messageLine, 'the validator must return a fixed sentence').not.toBe('')
    expect(
      /\$\{(?!META_TOKEN_PREFIX\})/.test(messageLine),
      'the rejection message names the prefix and never quotes what was typed',
    ).toBe(false)

    const [, dialog] = SOURCES.find(
      ([path]) => path === 'src/features/account-admin/create-account-dialog.tsx',
    )!
    expect(dialog, 'a failed create is classified before anything is rendered').toMatch(
      /createFailure\(error,/,
    )
    expect(dialog, 'and the redacted arm is the one that renders on a reference failure').toContain(
      'CREATE_FAILED_REDACTED',
    )
    // The value itself is state in this file and travels into the payload
    // builder. It may reach neither a toast nor a template.
    expect(
      /toast[^\n]*metaTokenRef|`[^`]*\$\{metaTokenRef\}/.test(dialog),
      'the reference is sent and never shown; it appears in no message this app writes',
    ).toBe(false)
  })

  it('RULE: neither lifecycle dialog uses the toast-on-success helper', () => {
    // The house helper toasts success unconditionally and routes every error
    // through toActionErrorMessage. Both are wrong here: the first would report
    // `account_deleted: false` as a deletion (AC-17), and the second would bypass
    // the two 409 notices entirely (AC-12, AC-15). This is a deliberate refusal
    // of the house pattern, so it is asserted rather than left to review.
    for (const path of [
      'src/features/account-admin/delete-account-dialog.tsx',
      'src/features/account-admin/create-account-dialog.tsx',
    ]) {
      const [, source] = SOURCES.find(([candidate]) => candidate === path)!
      expect(source, `${path} must choose its own success and failure rendering`).not.toMatch(
        /useActionMutation/,
      )
    }
  })
})

describe('the account devices surface joins on the rows and pays no per-row cost (z8pmx9mf19)', () => {
  const PANEL = 'src/features/account-devices/account-devices-panel.tsx'
  const ROW = 'src/features/account-devices/account-device-row.tsx'
  const WEBHOOK_DIALOG = 'src/features/devices/webhook-dialog.tsx'

  function sourceOf(path: string): string {
    const found = SOURCES.find(([candidate]) => candidate === path)
    expect(found, `${path} should be in the module graph`).toBeTruthy()
    return found![1]
  }

  it('RULE: the membership list is built by the join, never mapped off the registry query', () => {
    // AC-5, and the bug the whole first half of this ticket is about. The rows
    // are the authoritative membership answer; the registry "cannot show a row
    // the registry did not load" (study §08). Building the list from the
    // registry drops devices that exist — silently, because the screen still
    // renders — and the next reorder then submits an incomplete set the endpoint
    // refuses with a 400 nothing on screen explains.
    //
    // Two halves: the join must be what produces the list, and the registry
    // query's data must not be iterated here at all.
    const panel = sourceOf(PANEL)
    expect(panel, 'the list comes from joinAccountDevices(rows, registry)').toMatch(
      /joinAccountDevices\(\s*rows\.data,\s*registry\.data,?\s*\)/,
    )
    expect(
      /registry\.data\s*(\?\.)?\.?(map|filter|forEach|flatMap)\(/.test(panel),
      'the registry is joined onto the rows, never iterated into a list of its own',
    ).toBe(false)
  })

  it('RULE: the order payload is built from the rows, so a device the registry lost is still in it', () => {
    // AC-9. `orderSubmission` takes the ROW array rather than a list of ids —
    // provenance in the signature, the same trick `deleteRequestFor` uses for
    // expected_devices — but a caller could still hand it the wrong array. This
    // asserts which one it hands over.
    expect(sourceOf(PANEL), 'orderSubmission reads the row query, not the joined list').toMatch(
      /orderSubmission\(\s*rows\.data,/,
    )
  })

  it('RULE: the account surface offers exactly one creation path', () => {
    // AC-18, scoped to what the AC actually says. The generic POST /devices
    // stays available on the device dashboard, where it is the only path a
    // `devices.create`-holder without `accounts.manage` has — see the header of
    // create-device-dialog.tsx. What must not happen is this surface creating a
    // device that belongs to nobody for the time between two calls.
    const offenders = SOURCES.filter(
      ([path, source]) =>
        (path.startsWith('src/features/account-devices/') ||
          path === 'src/pages/account-detail.tsx') &&
        /\baddDevice\b/.test(source),
    ).map(([path]) => path)
    expect(
      offenders,
      'inside an account, create with createDeviceInAccount — POST /devices does not attach',
    ).toEqual([])
    expect(
      sourceOf('src/features/account-devices/add-device-dialog.tsx'),
      'and the account-scoped create is the one it calls',
    ).toMatch(/createDeviceInAccount\(/)
  })

  it('RULE: a device 404 is classified as "not available" and never as a permission', () => {
    // AC-23. Asserted on the classifier rather than on the feature files' own
    // text, because the feature files never write this sentence — they render
    // whatever the classifier picked, and a 403 falling through to
    // toActionErrorMessage legitimately does say "permission". The 404 is the
    // one the backend refuses to explain, and the one that must never be guessed
    // at: it is byte-identical for a device that does not exist and one
    // belonging to another account.
    const lib = sourceOf('src/lib/account-devices.ts')
    expect(lib, 'the 404 arm maps to the not-available notice').toMatch(
      /status === 404\)\s*return[^\n]*'device-not-available'/,
    )
    expect(
      /status === 403/.test(lib),
      'a 403 is not classified here — toActionErrorMessage already renders it, spending no refresh',
    ).toBe(false)
  })

  it('RULE: the device row calls no hook, so nothing is instantiated per device', () => {
    // AC-34, first half. The study's §13 rule 3 generalised: a hook in a row is
    // one store subscription or one query per row for an answer that does not
    // vary. Every permission boolean and every mutation is hoisted into the
    // panel and arrives as a prop.
    //
    // `memo(` and `useCallback`/`useMemo` are not hooks in this sense, but they
    // do not appear in the row either — it takes its callbacks as props — so the
    // rule can stay a blunt one.
    const row = sourceOf(ROW)
    expect(
      /\buse[A-Z]\w*\(/.test(row),
      'hoist it into account-devices-panel.tsx and pass it as a prop',
    ).toBe(false)
  })

  it('RULE: the device row renders no dialog, or the hooks would arrive inside one', () => {
    // AC-34, second half — the hole the rule above cannot see on its own. A row
    // that renders <DeviceWebhookDialog/> passes a hook scan of its own source
    // while mounting one useQuery and two useMutation per device, which is
    // exactly what device-card.tsx does one feature over. The panel owns one
    // instance of each dialog, keyed on which row was chosen.
    const row = sourceOf(ROW)
    for (const dialog of ['Dialog', 'AlertDialog', 'Sheet']) {
      expect(
        new RegExp(`<${dialog}[\\s/>]`).test(row),
        `${dialog} belongs to the panel, mounted once for the whole list`,
      ).toBe(false)
    }
    // And the panel is where they actually are.
    expect(sourceOf(PANEL)).toMatch(/<DeviceWebhookDialog/)
  })

  it('RULE: the stored webhook secret reaches no rendered node and no message', () => {
    // AC-32 / AC-35. The secret signs this customer's webhook payloads, and this
    // dialog is now reachable from every account device row — including by a
    // viewer holding only devices.webhook.read. It is held in state so an
    // unrelated save cannot destroy it, and it goes nowhere else:
    //
    // 1. Never into an input's value. A masked field would still put the real
    //    value in a DOM attribute; not rendering it is strictly stronger.
    // 2. Never into a toast or a template.
    // 3. Never as the server's own text after a failed save, because a 4xx
    //    rejecting this payload may quote the field it rejected — the same
    //    reason createFailure redacts a meta_token_ref rejection.
    const dialog = sourceOf(WEBHOOK_DIALOG)
    expect(
      /value=\{secret\}/.test(dialog),
      'the stored secret is never bound to an input; offer a replacement instead',
    ).toBe(false)
    expect(
      /toast[^\n]*\bsecret\b|`[^`]*\$\{secret\}/.test(dialog),
      'the secret appears in no message this app writes',
    ).toBe(false)
    expect(dialog, 'a failed save is classified before anything is rendered').toMatch(
      /webhookSaveFailure\(error\)/,
    )
    expect(dialog).toContain('WEBHOOK_SAVE_FAILED_REDACTED')
  })

  it('RULE: the surface shows a position, never a priority, and never says "ready" or offers a move', () => {
    // Three criteria that are otherwise only assertable by reading the JSX, made
    // runnable. SOURCES has already stripped comments, so the paragraphs in
    // these files that EXPLAIN each rule do not trip it — which is the whole
    // reason that helper exists.
    //
    // AC-6: `priority` is the raw column value, 100 by default, meaning
    //   "unordered". Rendering it invites a manual edit the order endpoint does
    //   not accept; the operator is shown a position instead.
    // AC-15: `fallback_allowed` answers whether channel-switching POLICY permits
    //   this device. Sending also needs it unblocked with a live session, so the
    //   label is "allowed as fallback" and never "ready".
    // AC-21: there is no detach endpoint (study §14, Q-6). Delete-and-recreate
    //   is the only way to move a device, and it destroys its session keys — an
    //   action that looks like a move and is a purge must not exist.
    const surface = SOURCES.filter(([path]) => path.startsWith('src/features/account-devices/'))
    expect(surface.length, 'the surface should be in the module graph').toBeGreaterThan(0)
    for (const [path, source] of surface) {
      expect(/\bpriority\b/.test(source), `${path} must show the position, not the priority`).toBe(
        false,
      )
      expect(/\bready\b/i.test(source), `${path}: the label is "allowed as fallback"`).toBe(false)
      expect(/\bdetach\b/i.test(source), `${path}: there is no detach endpoint to offer`).toBe(
        false,
      )
    }
  })

  it('RULE: the account API module names no payload-cleaning helper', () => {
    // AC-13. `src/api/accounts.ts` states this property at length in its own
    // header — `clean()` drops undefined AND '', and PATCH …/devices/{id} takes
    // a closed list where '' is the ONLY way to unblock a device, so running it
    // over that payload turns "unblock this device" into an empty body and
    // leaves an operator with no way to unblock anything.
    //
    // The spec claimed this rule already existed. It did not: that module
    // carried a paragraph about the rule and nothing that runs it. A rule nobody
    // can run is what this file exists to replace.
    const accounts = sourceOf('src/api/accounts.ts')
    expect(
      /\bclean\s*\(|from\s+['"][^'"]*api\/request['"]/.test(accounts),
      'this module builds its payloads literally — see its header',
    ).toBe(false)
    // The unblock payload is built with the empty string present.
    expect(accounts, 'send_state travels as a value, including when it is empty').toMatch(
      /\{\s*send_state:\s*sendState\s*\}/,
    )
  })
})

describe('the users surface holds a credential and displays a role (z8pmx9mf1a)', () => {
  const DECISIONS = 'src/lib/user-admin.ts'
  const PANEL = 'src/features/user-admin/users-panel.tsx'
  const ROW = 'src/features/user-admin/user-row.tsx'
  const CREATE = 'src/features/user-admin/create-user-dialog.tsx'
  const EDIT = 'src/features/user-admin/edit-user-dialog.tsx'
  const RESET = 'src/features/user-admin/reset-password-dialog.tsx'
  /** Every file the two exemptions above admit. The counter-rules cover all of them. */
  const SURFACE = [DECISIONS, PANEL, ROW, CREATE, EDIT, RESET]
  /** The two that actually hold a password in component state. */
  const HOLDS_PASSWORD = [CREATE, RESET]

  function sourceOf(path: string): string {
    const found = SOURCES.find(([candidate]) => candidate === path)
    expect(found, `${path} should be in the module graph`).toBeTruthy()
    return found![1]
  }

  it('RULE: no role value is compared against a literal anywhere in the surface', () => {
    // What narrows the `roles` exemption from a grant into a permission to
    // display. The study's §13 rule 1 and the reference's golden rule (§04):
    // permissions are compile-time constants, roles are database rows an
    // operator composes without a redeploy — so `role === 'admin'` is a decision
    // this UI may never make, and it is the shape every role-as-authority bug
    // takes. The sibling bracket-access rule already covers `ROLE_CAPS[r]`.
    //
    // Not a declarations-count rule, deliberately. That treatment works for
    // src/api/users.ts only because that file declares and never reads; this
    // surface must read the field to compare two sets and to omit an empty one,
    // so a count could never hold — and an unsatisfiable assertion is one that
    // gets deleted, leaving the bare exemption behind.
    // The literal must be NON-EMPTY, which is the whole precision of the rule.
    // `role.trim() !== ''` is a blank-entry filter and appears three times in
    // this surface legitimately; `role === 'admin'` is the authority read. A
    // first draft that banned both would have been either deleted or worked
    // around within a ticket, which is the failure mode this file exists to
    // avoid — so the pattern requires at least one character inside the quotes.
    for (const path of SURFACE) {
      expect(
        /\broles?\b[^\n]*(===|!==|==|!=)\s*['"`][^'"`]/.test(sourceOf(path)),
        `${path}: a role name is not authority — decide from permissions[], see src/lib/permissions.ts`,
      ).toBe(false)
    }
  })

  it('RULE: the surface never measures the seeded role list against who you are', () => {
    // The other half of the same hazard, and the shape a "tidy" fix would take:
    // hiding the super_admin checkbox unless the signed-in principal holds that
    // role. That is a capability derived from a role name — exactly what this
    // ticket is built to prevent — and it is recorded in plan.md as a deliberate
    // non-fix. An admin who ticks the box gets the server's 403; hiding is an
    // affordance and the server is the only authority.
    for (const path of SURFACE) {
      expect(
        /SEEDED_ROLES\s*\.\s*(some|every|filter|find)\s*\([^)]*\b(user|principal|granted|permissions)\b/.test(
          sourceOf(path),
        ),
        `${path}: the seeded list is a set of checkbox options, never a comparison against who you are`,
      ).toBe(false)
    }
  })

  it('RULE: no password reaches a toast, a template literal or a query key', () => {
    // The exemption above lets these files NAME a password. This is what they
    // may not do with one. `passwordError` states a byte COUNT and never the
    // value — asserted in user-admin.test.ts — and nothing else renders one.
    for (const path of HOLDS_PASSWORD) {
      const source = sourceOf(path)
      expect(
        /toast[^\n]*\bpassword\b|`[^`]*\$\{\s*password\s*\}/.test(source),
        `${path}: a toast is a rendered node like any other; a credential has no business in one`,
      ).toBe(false)
      expect(
        /Key\(\s*\{[^}]*password|queryKey:\s*\[[^\]]*password/.test(source),
        `${path}: a query key is stored in the cache and outlives the component`,
      ).toBe(false)
    }
  })

  it('RULE: neither password dialog renders the server’s own text for a failure', () => {
    // AC-31, and the finding that changed this ticket most. `toActionErrorMessage`
    // returns apiError.message verbatim for any non-403, so a 400 rejecting one
    // of these bodies — and a validation error naming the offending field is the
    // ordinary shape of a 400 — would print a credential inside the dialog that
    // is still holding it.
    //
    // Closed the way this repository has already closed it twice:
    // createFailure / CREATE_FAILED_REDACTED for meta_token_ref, and
    // webhookSaveFailure / WEBHOOK_SAVE_FAILED_REDACTED for the webhook signing
    // secret. This is the third, asserted the same way — the decision must be
    // called, and the escape hatch must be unreachable.
    for (const path of HOLDS_PASSWORD) {
      const source = sourceOf(path)
      expect(source, `${path} must classify the failure before rendering anything`).toMatch(
        /passwordFailure\(error\)/,
      )
      expect(source).toContain('PASSWORD_FAILED_REDACTED')
      expect(
        /toActionErrorMessage/.test(source),
        `${path}: a rejection can quote the field it rejected, and the field here is a password`,
      ).toBe(false)
    }
    // And the redacted sentence is a literal naming no value, as its two
    // siblings are — interpolating into it is the one edit that would break it.
    const sentence =
      sourceOf(DECISIONS).match(/PASSWORD_FAILED_REDACTED =\s*\n?\s*'[^']*'/)?.[0] ?? ''
    expect(sentence, 'the redacted sentence should be a plain literal').not.toBe('')
    expect(sentence).not.toContain('${')
  })

  it('RULE: the decision module reads no query cache, so a detail can only be what was sent', () => {
    // collisionDetail and notFoundDetail name what THIS CLIENT submitted, which
    // is what makes them legitimate: the operator typed those values a second
    // ago, so echoing them adds no bits to the enumeration oracle the server's
    // joined 409/404 already withholds.
    //
    // The shortcut this forecloses is a "helpful" scan of the loaded page for a
    // matching username. That would split what the server deliberately joined
    // AND be wrong — the page is one page of an endpoint with no total and no
    // account filter, so an absent match means "not on this page", never
    // "available". Same provenance guarantee, and the same two names, as the
    // delete-account dialog's rule above.
    expect(
      /getQueryData|getQueriesData/.test(sourceOf(DECISIONS)),
      'a detail is built from the submitted payload alone — see collisionDetail',
    ).toBe(false)
  })

  it('RULE: no operator-controlled string is interpolated raw into a rendered sentence', () => {
    // AC-32. A username, an email or a free-text role id is operator-chosen
    // text, and this surface can CREATE one carrying a bidi override — its own
    // username validator is deliberately permissive after the first character,
    // because being stricter than the server rejects input the server would
    // have taken. React escapes HTML; it does not neutralise U+202E, which
    // reorders the sentence around it — including the one authorising a delete.
    //
    // Every such value goes through displayText() from @/lib/surfaces first: the
    // same strip-and-cap accountName has used since z8pmx9mf17, extracted rather
    // than copied so a character added to the class closes every site at once.
    // Each interpolation is examined on its own rather than the file as a
    // whole: `${displayText(user.username, MAX_DISPLAY)}` names `.username` and
    // is exactly what the rule wants, so a file-wide "does it mention
    // .username inside a ${}" test would flag the correct code and pass the
    // wrong code sitting next to it. The unit is the interpolation.
    for (const path of SURFACE) {
      const raw = (sourceOf(path).match(/\$\{[^}]*\}/g) ?? []).filter(
        (interpolation) =>
          /\.(username|email)\b/.test(interpolation) && !interpolation.includes('displayText'),
      )
      expect(
        raw,
        `${path}: wrap it in displayText() — a bidi override reorders what is rendered around it`,
      ).toEqual([])
    }
  })

  it('RULE: both destructive confirmations show the raw id beside the sanitised name', () => {
    // The other half of AC-32, and the answer surfaces.ts already gives to a
    // homoglyph: `admin` and `аdmin` (Cyrillic а) cannot be told apart by
    // reading, so a name "cannot be sanitised into honesty, but it can be shown
    // next to an id the operator can compare". The delete confirmation lives in
    // the panel; the reset has its own file.
    for (const path of [PANEL, RESET]) {
      expect(sourceOf(path), `${path} must render the target's raw user_id`).toMatch(/<IdText/)
    }
  })

  it('RULE: nothing in the users surface ends a session', () => {
    // AC-20's "no new session-handling code was added for this", made runnable.
    // A self-edit ending your own session is z8pmx9md70's existing path — the
    // 401 spends one refresh, it fails against the new epoch, the session is
    // cleared, and refusalReason derives permissions-changed, which
    // SIGN_OUT_NOTICES already renders. This ticket adds the warning BEFORE it
    // and nothing else.
    //
    // The four-name pattern the permission-denied surface already uses:
    // endRefusedSession and refreshSession are the two spellings a self-edit
    // handler would actually reach for, and a list of signOut/clearSession/
    // endSession would have missed both while duplicating two rules that exist.
    for (const path of SURFACE) {
      expect(sourceOf(path), `${path} must add no session teardown`).not.toMatch(
        /\bsignOut\b|\bendRefusedSession\b|\brefreshSession\b|\bNavigate\b/,
      )
    }
  })

  it('RULE: the row mounts no dialog and opens no store subscription', () => {
    // The study's §13 rule 3, applied to the second list this codebase renders.
    // A permission hook per row is one store subscription per row for an answer
    // that does not vary; a dialog per row is a mutation per row. The panel owns
    // one instance of each, and the row takes props.
    const row = sourceOf(ROW)
    for (const dialog of ['Dialog', 'AlertDialog', 'Sheet']) {
      expect(
        new RegExp(`<${dialog}[\\s/>]`).test(row),
        `${dialog} belongs to the panel, mounted once for the whole list`,
      ).toBe(false)
    }
    expect(
      /\buse[A-Z]\w*\(/.test(row),
      'the row takes props; every hook belongs to the panel',
    ).toBe(false)
    expect(sourceOf(PANEL)).toMatch(/<UserRow/)
  })

  it('RULE: the panel resolves account names once, not once per row', () => {
    // accountName() scans the account list and runs a regex on every call, so
    // calling it inside .map() over a page of a hundred rows is a hundred scans
    // and a hundred regex passes on every re-render. accounts.tsx gets away with
    // it because it renders one row per account; this list does not.
    const panel = sourceOf(PANEL)
    expect(panel, 'the panel builds a lookup map once').toMatch(/new Map<string, string>\(\)/)
    expect(
      /\.map\(\(user\)[\s\S]{0,400}accountName\(/.test(panel),
      'resolve the label into a Map with useMemo and index it per row',
    ).toBe(false)
  })

  it('RULE: the pager is frozen while a page is in flight', () => {
    // keepPreviousData means the rows on screen belong to the PREVIOUS page
    // while the next one is loading, and this endpoint has no total to correct
    // the impression with. A pager left live advances the offset past a page
    // nobody saw, and fans out several in-flight queries over several cached
    // pages.
    expect(sourceOf(PANEL), 'both pager buttons wait for the real page').toMatch(
      /isPlaceholderData\s*\|\|\s*\w+\.isFetching/,
    )
  })

  it('RULE: the users list invents no total and no page count', () => {
    // REQ-2. The response is a flat array; there is no count to build a numbered
    // pager from, and pageState returns four fields precisely so a caller cannot
    // branch on the wrong one. A "page 3 of 12" here would be fabricated, and
    // this is a real constraint to build on rather than to work around.
    for (const path of [PANEL, DECISIONS]) {
      expect(
        /\btotalPages\b|\bpageCount\b|\btotalCount\b/.test(sourceOf(path)),
        `${path}: paging is next/previous on whether the page came back full`,
      ).toBe(false)
    }
  })
})
