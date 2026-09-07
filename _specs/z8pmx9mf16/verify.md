---
ticket: z8pmx9mf16
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf16"
  github: ""
---

# Verification — 6 · Add the account scope store and the accounts/users API layer

## Validation profile — `ui-build`

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | clean |
| `ui-lint` | `npm run lint` | 0 | 4 warnings, the same 4 pre-existing `only-export-components` ones — no new warning |
| `ui-test` | `npm run test` | 0 | **357 passed in 25 files** (baseline: 278 in 20) |
| `ui-build` | `npm run build` | 0 | one file in `dist/`, 1,026,213 bytes |

The 79 new tests: 66 in the five new test files (7 store, 17 device-scope,
8 query-keys, 16 accounts, 18 users), 7 added to `auth-messages.test.ts`
(22 → 29) and 6 added to `source-policy.test.ts` (19 → 25).

## Runtime impact (TR-3, VF-9)

**No deployment runtime file changed.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are all untouched — confirmed against `git status`, which lists
exactly the ten added and seven edited files `plan.md` names, plus the ticket's
own `_specs/` artifacts, the phase-2 study document and one carried-over
`links.github` backfill on ticket 5.

**One behaviour change reaches a user, and it is deliberate.** Signing out now
clears the selected device as well as the account lens, so a device must be
re-selected after signing back in. `plan.md > The lens does not outlive the
session that chose it` argues why the half-reset would be the inconsistent
option; it is recorded here rather than left to be discovered.

Nothing else renders differently. No screen, route, navigation item or component
was added or edited, and until ticket 7 ships a way to set a scope the account
lens is `null` for every principal — under which `useDevices()` issues exactly
the request it issued before, against a key the six existing bare-prefix
invalidations still match.

## Acceptance criteria — all 29 mapped to an executed result

### Account scope store

| AC | Result | Evidence |
|---|---|---|
| AC-1 | **pass** | `source-policy.test.ts` › *a store that persists names a versioned key* asserts `gowa-ui.account.v1`; mutation **M9** (drop the version) kills it. Asserted on the source because `persist` degrades to a plain store without a `localStorage` — see `implement.md` deviation 2. |
| AC-2 | **pass** | `account.test.ts` › *null is a distinct value from any account id, and is never spelled ""*; and `device-scope.test.ts` treats `''` and `null` as the same *filter* while the store never stores `''`. |
| AC-3 | **pass** | `account.test.ts` › three tests: the clear, the *never lets an observer see the new scope beside the old device* invariant over both stores' notifications, and the exact write order. Mutations **M10** (reverse the order), **M11** (guard on the id) and **M12** (drop the device guard) all killed. |
| AC-4 | **pass** | `account.test.ts` › *returning to the implicit scope clears the selection the same way* — the same code path, `enterAccount(null)`. |
| AC-5 | **pass** | Three independent rules, all mutation-tested: no `X-Account-Id` anywhere in `src/` (**M5**), `config.headers[…]` written only in `src/lib/http.ts` (**M6**), and `@/stores/account` imported only by `App.tsx` and `use-devices.ts` — nothing in `src/lib/` may reach it (**M7**). `http.ts` is byte-for-byte unchanged. |

### Scoped device list

| AC | Result | Evidence |
|---|---|---|
| AC-6 | **pass** | `device-scope.test.ts` › *the filter on the wire*: no parameter for the implicit scope, `{ account_id }` for an explicit one, through the real interceptor chain and a stub adapter. |
| AC-7 | **pass** | `scopedDeviceFilter` returns `null` without the permission; asserted as a unit and again on the wire. Mutation **M13** (drop the gate) killed. `PERMISSIONS.ACCOUNTS_MANAGE`, not `.MANAGE_ALL`. |
| AC-8 | **pass** | `device-scope.test.ts` › four tests: `''`, whitespace, trimming, and the negative case that a malformed id is *not* treated as blank. Mutations **M14** (send the blank) and **M15** (send the parameter unconditionally) killed. |
| AC-9 | **pass** | `device-scope.test.ts` › *a 400 rejects, so it is a different state from the empty list*, plus *an empty envelope on a 2xx is `[]` — the `??` never absorbs a rejection*. |
| AC-10 | **pass** | `device-scope.test.ts` › *an empty list for a foreign account resolves as empty, not as an error*. Nothing in the code path reads the response as evidence the account exists, and no message table entry asserts existence (AC-28). |

### Query keys

| AC | Result | Evidence |
|---|---|---|
| AC-11 | **pass** | `query-keys.test.ts` › *never serves one account's devices for another*, against a real `QueryClient`. Mutation **M17** (drop the scope from the key) killed. |
| AC-12 | **pass** | `query-keys.test.ts` › *names each list separately* — `['accounts']`, `['account-devices', id]`, `['users', {limit, offset}]` — plus the paged-key hashing test. |
| AC-13 | **pass** | `query-keys.test.ts` › *marks a scoped query stale from the unscoped prefix* and *does not reach past its own prefix*. Six existing call sites rely on this and none was edited; they are named in `plan.md`. |

### Accounts API client

| AC | Result | Evidence |
|---|---|---|
| AC-14 | **pass** | All nine calls exist and all nine are exercised in `accounts.test.ts`, each asserting the method, path and body/params actually sent. |
| AC-15 | **pass** | `accounts.test.ts` › *carries the five fields the reference gives*, asserted as an exact sorted key list. |
| AC-16 | **pass** | Same test: `meta_token_ref` is absent from the response key list. It exists on `CreateAccountPayload` — a request field naming an environment variable, never a token — and the create test asserts it is sent. |
| AC-17 | **pass** | `accounts.test.ts` › *accepts a device that carries the two fields the schema omits*. Optional on evidence: the prose carries them, the OpenAPI `AccountDevice` schema does not. |
| AC-18 | **pass** | `accounts.test.ts` › *returns a partial-execution report, not a boolean* — all five fields including the echoed `account_id`, with `account_deleted: false` read as the retry handle. Mutation **M19** (send the cascade in a body) killed. |

### Users API client

| AC | Result | Evidence |
|---|---|---|
| AC-19 | **pass** | All six calls exercised in `users.test.ts`, including both arms of the create union and the path-encoding cases. |
| AC-20 | **pass** | `users.test.ts` › *carries the nine documented fields*, asserted as an exact sorted key list. |
| AC-21 | **pass** | Same test: `permissions` and `password_hash` are both absent from the key list. |
| AC-22 | **pass** | `users.test.ts` › *is a flat array with no total, and invents none*, plus the paging parameters and the empty-envelope case. |
| AC-23 | **pass** | `users.test.ts` › six tests on `omitUntouched`: the status-only payload, `''` kept as a value, a blank `account_id` forwarded rather than edited away, falsy values kept, and the empty change forwarded as the empty body the server refuses. Mutation **M21** (drop `''` like `clean()`) killed. |

### Registry device type

| AC | Result | Evidence |
|---|---|---|
| AC-24 | **pass** | `src/api/types.ts` declares all three as optional; the compiler accepts a `RegistryDevice` without them and with them (`device-scope.test.ts` constructs both). |
| AC-25 | **pass** | `device-scope.test.ts` › four presence tests, the load-bearing two being *reports PRESENT for an empty string* and *reports present for a key explicitly holding `undefined`*. Mutation **M16** (read by value) killed. |
| AC-26 | **pass** | The three names appear in no masked-field list, and `source-policy.test.ts`'s boundary rule — widened from two authorities to three — forbids `device-scope`, `redaction` and `permissions` from importing one another. Mutation **M8** killed. |

### Error vocabulary

| AC | Result | Evidence |
|---|---|---|
| AC-27 | **pass, with a documented reduction** | `auth-messages.test.ts` › *covers every rejection the ticket lists, and nothing else*. Eight entries, not eleven: the ticket lists "409 duplicate username / email / inline account id" and "404 unknown account or role" as five, and the specification documents them as **two** joined rejections. Splitting them is asserted against — see below. |
| AC-28 | **pass** | `auth-messages.test.ts` › every entry has a title and a description that names a consequence and a next step, ends in a full stop, and carries no `<` or `>`. No branch renders a raw server string: nothing in this ticket consumes an error at all. |

### Testing

| AC | Result | Evidence |
|---|---|---|
| AC-29 | **pass** | All four named areas are covered: the atomic device clear (`account.test.ts`, 3 tests + 3 mutations), the filter-parameter rule (`device-scope.test.ts`, 7 tests + 3 mutations), the empty-versus-malformed distinction (`device-scope.test.ts`, 3 tests), and the partial-update payload builder (`users.test.ts`, 6 tests + 1 mutation). |

## Test cases — all 16 executed

| TC | Result | Where |
|---|---|---|
| TC-1 | pass | `account.test.ts` × 3 |
| TC-2 | pass | `account.test.ts` › returning to the implicit scope |
| TC-3 | pass | `account.test.ts` › the guard is on the device, not on the account id |
| TC-4 | pass | `device-scope.test.ts` › is dropped entirely without the permission (unit + wire) |
| TC-5 | pass | `device-scope.test.ts` › sends the account_id parameter for an explicit scope |
| TC-6 | pass | `device-scope.test.ts` › a blank is no filter (×4) |
| TC-7 | pass | `device-scope.test.ts` › an empty list for a foreign account |
| TC-8 | pass | `device-scope.test.ts` › a 400 rejects |
| TC-9 | pass | `query-keys.test.ts` › never serves one account's devices for another |
| TC-10 | pass | `query-keys.test.ts` › the bare prefix still invalidates every scope |
| TC-11 | pass | `users.test.ts` › a status-only change sends status and nothing else |
| TC-12 | pass, **premise corrected** | `users.test.ts` › keeps an empty string, because it is a value. The spec wrote this as "a field deliberately cleared where the server accepts one"; the field is `email`, and the correction is that `account_id: ''` is also forwarded rather than dropped — see below. |
| TC-13 | pass | `accounts.test.ts` and `users.test.ts` › exact sorted key lists on `Account`, `AccountDevice` and `AdminUser` |
| TC-14 | pass | `accounts.test.ts` › returns a partial-execution report, not a boolean |
| TC-15 | pass | `auth-messages.test.ts` × 5 |
| TC-16 | pass | `device-scope.test.ts` › the three privileged fields are read by presence |

## Mutation pass — 23 mutations plus one against the compiler

21 killed, 2 controls behaved as designed. The full table is in `implement.md`.
Three of them are worth restating here because they are the panel's own findings
turned into assertions:

- **M20** reverts the device-order body to revision 1's guess,
  `{ device_ids: order }`, and the suite goes red. That assertion exists only
  because the specification was eventually read; without it, every reorder call
  would have answered `400` in the one endpoint whose failure is silent.
- **M1**, **M2** and **M3** are the three evasions the lenses found in revision
  1's `roles` narrowing regex — a destructuring rename, an object literal and a
  bracket access. All three fail the build now.
- **N2** is the control for the rule that was *not* written: a credential inside
  a string literal is still caught. Revision 1's global `stripStrings` pass would
  have blinded that rule; the pass was never built, and this proves it.

## What the implementation corrected in the spec

**TC-12's premise was half right.** The spec wrote it as "a field deliberately
cleared to an empty string on a user form where the server accepts one", which is
`email` — documented as "unique when non-blank; several users may have none".
That is correct and is asserted. What the spec did not anticipate is
`account_id: ''`, which the server explicitly refuses. Revision 1 of the plan
dropped it client-side; both the senior and security lenses objected, and the
shipped behaviour forwards it so the server's documented `400` is the message.
There is no client-invented rejection anywhere in this ticket.

**AC-27 asked for more entries than the wire supports.** The ticket lists eight
rejections by counting "duplicate username / email / inline account id" as three
and "unknown account or role" as two. The specification documents one `409`
covering all three names and one `404` covering both kinds of absence, and it
documents a foreign-tenant `404` as byte-identical to a missing one. Splitting
them would have rebuilt a user-enumeration oracle the backend deliberately gives
up — the same one the sign-in screen already refuses to reconstruct. The table
therefore has eight entries covering all eight documented rejections, and two
tests assert the collapse rather than leaving it as a comment:
*never names which of the three joined causes collided* and *never asserts that
something does not exist*.

## Open items

- **Nothing was verified against a running gowa server.** Every wire shape is
  transcribed from the reference's embedded OpenAPI specification and asserted
  against a stub adapter. The tests prove the client sends what the specification
  describes; they cannot prove the specification describes the deployed server.
  This is the largest remaining risk in the ticket and it is the one the four
  following tickets will close first, since each of them calls these endpoints
  for real.
- **No browser pass** (`C-4`): the extension was unavailable, so `NFR-1` is
  argued from the code and the tests rather than demonstrated on screen. The
  argument is strong — no component, page or route was touched, and the lens is
  `null` until ticket 7 — but it is an argument.
- **`GET /accounts/{id}/devices` is typed and untested against a live account**,
  like the other eight; and the study's §08 join (rows LEFT JOIN registry) is
  ticket 9's, not this one's.
- **The study's `Q-1..Q-8` remain open.** None was answered or guessed at.
- **`src/stores/recipient.ts` persists under an unversioned key.** Recorded by
  the new rule, deliberately not changed — it predates the convention and holds
  no shape this ticket touches.
