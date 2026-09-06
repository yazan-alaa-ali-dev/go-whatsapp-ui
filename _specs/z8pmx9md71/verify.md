---
ticket: z8pmx9md71
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md71"
  github: ""
---

# Verification — 5 · Expose a typed permissions layer from /auth/me

**Outcome: PASSED**, with three limits recorded rather than averaged away.

## Validation profile — `ui-build`

| Check | Command | Result |
|---|---|---|
| unit tests | `npm run test` | **278 passed / 278**, 20 files. Baseline before this ticket: **215 in 16 files** (+63) |
| types | `npm run typecheck` | clean |
| lint | `npm run lint` | 4 warnings — byte-identical to the 4 that pre-date this ticket (`use-device-guard.tsx`, `button.tsx`, `badge.tsx`, `tabs.tsx`, all `react(only-export-components)`) |
| build | `npm run build` | `dist/index.html`, 1,024.62 kB / 418.26 kB gzip |

## Runtime impact (TR-3, VF-9)

**No deployment runtime file was changed. Answer: no.**

`git diff` against `package.json`, `vite.config.ts`, `index.html`,
`.github/workflows/ci.yml` and `.github/workflows/release.yml` is empty. No
dependency was added (AC-26): `react-dom/server` was already a dependency, which
is why the component test needs neither jsdom nor React Testing Library.

Runtime behaviour of the shipped app is **unchanged but for one line**: the
error message a failed action shows, via `use-action-mutation.ts`. Everything
else added by this ticket has no importer in the application graph (C-6 wires no
screen), so Rollup tree-shakes it out of the bundle entirely — the built file is
byte-for-byte the same size as before. The cost of this layer arrives with the
wiring tickets, and NFR-3 should be judged there.

## Acceptance criteria — all 28 mapped to an executed result

Each row says what *kind* of evidence backs it. "Assertion" means a test that
can fail; "read-through" means a human read the code and the reference. They are
labelled separately rather than averaged.

### Permission catalogue

| AC | Result | Evidence |
|---|---|---|
| AC-1 | **pass** (assertion) | `permissions.test.ts` — every value matches `/^[a-z]+(?:\.[a-z]+)+$/`, i.e. the wire format's shape, so a SCREAMING_SNAKE key pasted over a value fails |
| AC-2 | **pass** (assertion) | `permissions.test.ts` compares `ALL_PERMISSIONS` against a §04 list written out independently in the test file; 28 names, no duplicates |
| AC-3 | **pass** (read-through) | `permissions.ts` — the `MESSAGES_READ` docblock states it grants `GET /message/{id}/download` only and that messages come with `chats.read` |
| AC-4 | **pass** (assertion + read-through) | the docblocks on `ACCOUNTS_MANAGE` / `ACCOUNTS_MANAGE_ALL`, plus an assertion that the two are distinct values and that the `.all` form is not a prefix answer |

### Source of truth

| AC | Result | Evidence |
|---|---|---|
| AC-5 | **pass** (assertion) | `use-permissions.test.ts`, against the **real** zustand store: `setState({ user }) → selector → decision`, including a later `/auth/me` returning a different list |
| AC-6 | **pass** (assertion, mutation-tested ×4) | `source-policy.test.ts` bans the `role` / `roles` **field** outside five display-only files. Killed: a destructured `const { role } = user` comparison, a `ROLE_CAPS[user.role]` lookup table, a `switch (user.role)`, and `user.roles.includes('admin')` |
| AC-7 | **pass** (assertion, mutation-tested) | the JWT rule, widened by `base64`, `Buffer.from` and `TextDecoder`; an injected `atob(t.split('.')[1])` is caught |
| AC-8 | **pass** (assertion, mutation-tested ×3) | the `permissions`-owner rule. Killed: `user.permissions`, `const { permissions } = user`, `user['permissions']` |

### Checking primitives

| AC | Result | Evidence |
|---|---|---|
| AC-9 | **pass** (assertion) | `useHasPermission` / `selectHasPermission` — present, absent, and a whole-name match that refuses a prefix |
| AC-10 | **pass** (assertion) | any-of and all-of, both directions, plus both empty-list answers asserted deliberately |
| AC-11 | **pass** (assertion) | `can.test.tsx` — `renderToStaticMarkup` returns `<button …>Send</button>` when the permission is held |
| AC-12 | **pass** (assertion) | the same render returns the **empty string** without it: `not.toContain('button')`, `not.toContain('disabled')` |
| AC-13 | **pass** (assertion) | `null`, `undefined` and `[]` all answer `false` in the pure layer; `<Can>` renders `''` with no session; and a principal that arrived with no `permissions` field at all does not crash |

### Masked field rule

| AC | Result | Evidence |
|---|---|---|
| AC-14 | **pass** (read-through + assertion) | `redaction.ts`'s header states the rule with both wrong spellings; the test asserts an absent key throws nothing and produces no error state |
| AC-15 | **pass** (assertion, mutation-tested) | `hasField` tests the key. A `value[key] !== undefined` rewrite is now killed — see *Mutation pass* |
| AC-16 | **pass** (assertion) | an absent `has_debug` and an explicit `false` are indistinguishable; only `=== true` is diagnostics |
| AC-17 | **pass** (assertion + compiler) | `sent_via` is absent from `MASKED_FIELDS`, present on a redacted payload, and declared **required** on `MessageInfo` — so `hasField(m, 'sent_via')` does not compile |
| AC-18 | **pass** (compiler) | the seven maskable fields are optional on `MessageInfo`; `npm run typecheck` is the executed check |

### Authorization behaviour

| AC | Result | Evidence |
|---|---|---|
| AC-19 | **pass** (assertion) | `auth-messages.test.ts` — a 403 reports the permission sentence, keeps the server's own text, caps it at 200 characters, and never mentions signing in |
| AC-20 | **pass** (assertion, mutation-tested) | `http.test.ts` — a 403 issues no `POST /auth/refresh`, alone or in a burst of five. Widening the 401 branch to `4xx` kills the suite |
| AC-21 | **pass** (assertion) | after a 403 the store's `status`, `access_token`, `refresh_token`, expiry, `endReason` and `lastRefresh` are unchanged |
| AC-22 | **partial — known limit** | Verified: both permissions are in the catalogue, and `App.tsx` declares nine routes, **none** an accounts or users admin surface. Nothing can be observed being hidden because nothing exists to hide. Recorded, not reported as a pass |

### Testing

| AC | Result | Evidence |
|---|---|---|
| AC-23 | **pass** (assertion) | present, absent, empty session and both composites, in `permissions.test.ts` and again against the real store in `use-permissions.test.ts` |
| AC-24 | **pass** (assertion) | a principal whose `role` is `shift-supervisor` — a name this UI has never heard of — passes the `chats.write` check; and one named `admin` with an empty list fails it |
| AC-25 | **pass** (assertion) | `expect(html).toBe('')` — the element is absent from the output, not disabled in it |

### Cross-cutting

| AC | Result | Evidence |
|---|---|---|
| AC-26 | **pass** (assertion) | `git diff package.json` is empty |
| AC-27 | **pass** (assertion) | `git diff` against all five deployment runtime files is empty |
| AC-28 | **pass** (executed) | all four checks green; 278 > 215 |

## Mutation pass — 20 mutations

Every guard this ticket adds was broken by hand and its test re-run. A guard
whose mutation survives is a guard whose test asserts the shape of the code
rather than its behaviour.

**18 killed. 2 negative controls correctly passed. 1 survivor, found and
closed.**

| Mutation | Result |
|---|---|
| `hasPermission`: `?? false` → `?? true` | killed |
| `hasPermission`: whole-name match → prefix match | killed |
| `hasAnyPermission`: `some` → `every` | killed |
| `hasAllPermissions`: `every` → `some` | killed |
| `<Can>`: always renders children | killed |
| `<Can>`: renders a disabled wrapper instead of nothing | killed |
| `selectPermissions`: frozen constant → fresh `[]` | killed |
| `toActionErrorMessage`: 403 arm never taken | killed |
| `toActionErrorMessage`: server detail discarded | killed |
| `toActionErrorMessage`: non-403 text uncapped | killed |
| `hasDiagnostics`: `=== true` → `!== false` | killed |
| role rule: destructured `const { role } = user` | killed |
| role rule: `ROLE_CAPS[user.role]` lookup table | killed |
| role rule: `switch (user.role)` | killed |
| role rule: `user.roles.includes('admin')` | killed |
| permissions rule: `user.permissions` | killed |
| permissions rule: `const { permissions } = user` | killed |
| permissions rule: `user['permissions']` | killed |
| authorities rule: `redaction.ts` imports `permissions.ts` | killed |
| NFR-5 rule: the affordance sentence removed from `can.tsx` | killed |
| JWT rule: a hand-rolled `atob` decode | killed |
| `http.ts`: 401 branch widened to any 4xx | killed |
| **negative control** — an ARIA `role="status"` attribute | correctly **not** flagged |
| **negative control** — the prose "Your permissions were updated" | correctly **not** flagged |

The two negative controls matter as much as the kills. The role rule bans a
word, and the `permissions` rule runs over a file containing that word in its
sign-out copy — both were shapes an earlier draft of these rules would have
false-flagged, and the panel caught both before they were written.

### The survivor

`hasField`'s `key in value` was replaced by `value[key] !== undefined` and
**every test passed**. The suite had no case where a key is present holding
`undefined` — and that value test is the most plausible way somebody rewrites
this function believing they preserved its meaning, while silently reporting a
present-but-empty origin field as redacted.

A test was added (`hasField({ sent_by: undefined }, 'sent_by')` is `true`) and
the mutation now dies. Recorded here rather than quietly fixed.

## What the tests corrected in the plan

One case where the code disagreed with a claim the plan had adopted from the
review panel, and the code was right:

**A rotation does not necessarily change `usePermissions()`'s identity.** The
plan said it did. The first version of TC-14 wrote
`setState({ user: { ...principal } })` and failed — a spread copies the
`permissions` array **by reference**, so the identity survives. It is the
array's identity that decides, not the principal object's. The finding remains
correct about the case that actually occurs (a principal parsed from JSON has a
new array), and both facts are now asserted separately. `spec.md > Known limits`
and the hook's doc comment state the narrower, true claim.

## Open items

Three, none of them a failing criterion.

1. **Nothing was verified against a running gowa server** (C-1). Every 403 in
   this suite is constructed. That the server answers 403 where §04 says it
   does, and that it deletes the seven keys §09 lists, are claims of the
   reference taken on trust until a screen reads a real payload.
2. **C-1 still rules out a browser pass.** `<Can>` is verified through
   `react-dom/server`, which exercises the component's branch and its markup but
   not a browser's re-render behaviour. The selector identity that governs that
   behaviour is asserted directly instead, because `Object.is` on the snapshot is
   the exact comparison React makes.
3. **AC-22 has nothing to observe** (above). Both permissions exist in the
   catalogue and no admin surface exists in the UI; the guard becomes a one-line
   change the day one is built.
