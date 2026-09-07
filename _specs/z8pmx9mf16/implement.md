---
ticket: z8pmx9mf16
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf16"
  github: ""
---

# Implementation — 6 · Add the account scope store and the accounts/users API layer

Applied on branch `ticket/z8pmx9mf16`, cut from `ticket/z8pmx9md70` at the merge
of PR #5 — the tip of the stacked auth-foundation chain. Working-tree changes
only; no commit is created here, and the single publishable commit belongs to
`/publish-pr`.

## Files changed

**Added — 10** (matching `plan.md > Files to change` exactly)

| File | Lines | What |
|---|---|---|
| `src/stores/account.ts` | 79 | the lens, and the one action that clears the device first |
| `src/stores/account.test.ts` | 152 | 7 tests, including the two-store atomicity observer |
| `src/lib/device-scope.ts` | 84 | `scopedDeviceFilter`, `hasScopedField` |
| `src/lib/device-scope.test.ts` | 185 | 17 tests, 6 of them through the real axios adapter |
| `src/lib/query-keys.ts` | 54 | the four builders |
| `src/lib/query-keys.test.ts` | 98 | 8 tests against a real `QueryClient` |
| `src/api/accounts.ts` | 264 | `Account`, `AccountDevice`, `DeleteAccountResult`, the nine calls |
| `src/api/accounts.test.ts` | 290 | 16 tests, every one asserting the request on the wire |
| `src/api/users.ts` | 216 | `AdminUser`, the payload types, `omitUntouched`, the six calls |
| `src/api/users.test.ts` | 267 | 18 tests, 2 of them compile-time |

**Edited — 7** (matching `plan.md` exactly)

| File | Change |
|---|---|
| `src/api/types.ts` | `RegistryDevice` gains `account_id?`, `priority?`, `send_state?` |
| `src/api/devices.ts` | `listDevices(accountId)` |
| `src/hooks/use-devices.ts` | scope-aware key and filter; `queryFn` wrapped |
| `src/App.tsx` | one line: the lens is reset when a session ends |
| `src/lib/auth-messages.ts` | `AdminRejection`, `ADMIN_REJECTIONS` (eight notices) |
| `src/lib/auth-messages.test.ts` | 7 tests for them (22 → 29) |
| `src/lib/source-policy.test.ts` | four allowlist entries, six new rules, one widened (19 → 25) |

**Not changed.** No deployment runtime file. No file under `src/features/`,
`src/pages/` or `src/components/`. None of the five feature files that
invalidate the bare `['devices']` prefix.

**Carried in the same working tree, not produced by this ticket:**
`docs/gowa-phase2-accounts-rbac-study-ar.html` (the phase-2 study, untracked
until now and the authoritative reference for this ticket and the four after
it) and a one-line `links.github` backfill on `_specs/z8pmx9md71/ticket.md`
left over from PR #5.

## Deviations from the plan

### 1. The `auth-messages.ts` role exemption was not needed, so it was not built

`plan.md` designed a `stringLiteralRanges` scanner — a non-destructive
single-pass lexer — so that `auth-messages.ts` could name a role in copy while
being provably unable to read one in code. It was the plan's most elaborate
mechanism, and revision 2 had already rewritten it once in response to three
separate panel findings.

Writing the copy removed the need for it. The panel's finding #4 is why: the
notices must not name which of three joined causes collided, and must not assert
that anything does not exist — so the `404` entry says "not found, or not
available to your account" rather than "no such account or role". After that,
`auth-messages.ts` contains **zero** occurrences of `role` outside comments,
which `stripComments` already removes.

So `auth-messages.ts` stays out of the role allowlist entirely and the base rule
guards it unchanged. That is strictly stronger than the exemption would have
been, and it is mutation-tested in that direction: **M4** puts the word into the
file's copy and the build goes red.

Only `src/api/users.ts` needed the exemption, and it kept the narrowing the plan
specified — the counting rule, which no rename, read, lookup or bracket access
can satisfy.

### 2. The versioned-name assertion moved from the store's test to the source policy

`plan.md` step 1 implied a runtime assertion on `useAccountStore.persist`. There
is none to make: zustand's `persist` middleware degrades to a plain store when it
cannot reach a storage, and this repository's test environment is node with no
`localStorage`, so `store.persist` is `undefined`. The same is already true of
`device.ts`, which is why nothing had noticed.

The assertion moved to `source-policy.test.ts` as a rule over the persisted
stores, which is stronger than the original: it covers `device.ts` as well as
`account.ts`, and it is what mutation **M9** kills. It also records a real
pre-existing inconsistency rather than hiding it — `src/stores/recipient.ts`
persists under the unversioned `gowa-recipient`. That predates the convention,
holds no shape this ticket touches, and is left alone.

### 3. Two rules were added beyond the plan's list, both inside the planned file

`plan.md` step 11 named the rules to add. Two more went in, both in
`source-policy.test.ts` and both free (zero existing offenders):

- **a header attached outside the interceptor** — `config.headers[…]` is written
  only in `src/lib/http.ts`. The plan described this rule; it is recorded here
  because it guards a file the plan does not otherwise touch.
- **the persisted-store version rule** — see deviation 2.

### 4. `hasScopedField` reports present for a key explicitly holding `undefined`

Not a change, but the one thing the implementation had to get right that the plan
did not spell out. `field in device` and `device[field] !== undefined` differ for
a payload that carries the key with no value, and the second answers "absent" for
a field that is present — which is the one thing a presence rule may not get
wrong. It is asserted (`device-scope.test.ts`) and mutation-tested (**M16**).

This is the same gap that survived a mutation in ticket 5's `hasField` and had to
be closed there afterwards. Here it was closed before the first run.

### 5. `deleteAccount` takes a defaulted options argument

`plan.md` showed the union type but not the call signature. It defaults to
`{ purgeDevices: false }`, so the dangerous form is the one that must be written
out in full. Mutation **M19** proves both parameters travel in the query string.

## The bundle question, settled with a number

The panel asked whether the unused exports this ticket ships — three query-key
builders, eight notices, and two API modules with no importer — cost anything.
Both builds were run.

| | `dist/index.html` |
|---|---|
| before (`ticket/z8pmx9md70` tree) | 1,024,629 bytes |
| after | 1,026,213 bytes |
| delta | **+1,584 bytes** (+0.15%) |

And the built file was grepped for each unreferenced piece:

| Marker | Occurrences in `dist/index.html` |
|---|---|
| `auth/users` | 0 |
| `sms-fallback` | 0 |
| `devices/create` | 0 |
| `account-devices` | 0 |
| `account-has-devices` | 0 |
| `gowa-ui.account.v1` | 1 |

So **none** of the unused exports ship — not the two API modules, not the three
spare key builders, and not the eight notices, even though `auth-messages.ts`
itself is in the graph. The 1,584 bytes are the store, the scope helpers, the
device key and the `useDevices` change: the code that is actually reachable.

## Validation run

Profile `ui-build`, all four checks:

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | clean |
| `ui-lint` | `npm run lint` | 4 warnings — the same 4 pre-existing `only-export-components` ones |
| `ui-test` | `npm run test` | **357 passed in 25 files**, up from a 278-in-20 baseline |
| `ui-build` | `npm run build` | 1 file in `dist/`, 1,026,213 bytes |

### Mutation pass — 23 mutations, plus one against the compiler

Every guard this ticket adds was broken on purpose, the suite shown to go red,
and the break reverted byte for byte. **21 killed, 2 controls behaved.**

| # | Mutation | Verdict |
|---|---|---|
| M1 | a role read by destructuring rename (`const { roles: assigned } = user`) | killed |
| M2 | a role in an object literal (`{ roles: ['user'] }`) | killed |
| M3 | a role read through a bracket access (`user['roles']`) | killed |
| M4 | a role named in `auth-messages.ts` copy | killed |
| M5 | an `X-Account-Id` header named anywhere | killed |
| M6 | a header attached outside the interceptor | killed |
| M7 | the lens imported from `src/lib/` | killed |
| M8 | `device-scope` importing `permissions` | killed |
| M9 | the persisted key loses its version | killed |
| M10 | the lens moves **before** the device is dropped | killed |
| M11 | the device clear guarded on the account id instead | killed |
| M12 | the device-null guard removed | killed |
| M13 | the permission gate dropped | killed |
| M14 | a blank sent as the filter | killed |
| M15 | the filter parameter sent unconditionally | killed |
| M16 | presence read by value instead of by key | killed |
| M17 | the scope dropped from the device key | killed |
| M18 | an empty `send_state` cleaned away | killed |
| M19 | the cascade sent in a body instead of the query | killed |
| M20 | the order body reverted to revision 1's `device_ids` guess | killed |
| M21 | `omitUntouched` drops empty strings like `clean()` | killed |
| M22 | `queryFn: listDevices` unwrapped | killed **by the compiler** |
| N1 | a comment naming a role (control) | stayed green, correctly |
| N2 | a credential in a string literal (control) | still caught, correctly |

M1, M2 and M3 are the three evasions the panel found in revision 1's narrowing
regex. M20 is the wrong guess itself: reverting to `{ device_ids: order }` fails,
which is the assertion that would not have existed had the specification stayed
unread. M22 is the senior lens's `queryFn` finding — the unwrapped form collapses
the query's data type to `{}` and breaks three call sites in `dashboard.tsx`.

N2 is the control that matters for the rule that was **not** written: it proves
the credential rule still sees a password inside a string literal, which is what
a global stripping pass would have blinded it to.

## Open items

- **Nothing was verified against a running gowa server.** Every assertion is made
  against the reference's OpenAPI specification and against tests. The wire
  shapes are transcribed, not observed.
- **No browser pass** (`C-4`): the extension was unavailable, so `NFR-1`'s
  "nothing renders differently" is argued from the code and the tests rather than
  demonstrated on screen.
- **A device must be re-selected after signing out and back in.** A deliberate,
  stated behaviour change — see `plan.md > The lens does not outlive the session`.
- **The study's `Q-1..Q-8` remain open** and are not this ticket's to answer.
