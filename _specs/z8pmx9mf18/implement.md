---
ticket: z8pmx9mf18
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf18"
  github: ""
---

# Implementation — 8 · Build the accounts list and the account lifecycle

Branch `ticket/z8pmx9mf18`, cut from `ticket/z8pmx9mf17` rather than from `main`
because this ticket consumes ticket 7's routes and ticket 6's API layer, neither
of which is merged yet.

**5 files added, 8 edited.** No file under `src/api/` was touched (`C-1`). No
deployment runtime file was touched (`GU-2`).

## Files changed

### Added

| File | What |
|---|---|
| `src/lib/account-lifecycle.ts` | The pure lifecycle decisions: `metaTokenRefError`, `createAccountPayloadFrom`, `createFailure`, `confirmationMatches`, `deleteRequestFor`, `deleteOutcome`, `isOwnAccountDeletion`, `deleteRejection`, and the `CREATE_FAILED_REDACTED` sentence. No React, no store, no axios instance. |
| `src/lib/account-lifecycle.test.ts` | 21 cases across 7 groups. |
| `src/hooks/use-account-devices.ts` | `GET /accounts/{id}/devices` on `accountDevicesKey`, gated on the session, on `accounts.manage`, and on an `enabled` argument, with a 30-second window. |
| `src/features/account-admin/create-account-dialog.tsx` | The create form, the advanced disclosure, pre-request validation, and the redacting failure path. |
| `src/features/account-admin/delete-account-dialog.tsx` | The two-step confirmation, the cascade opt-in, the own-account warning, the live read at submission, the two `409` notices, the partial-execution report, and the re-run. |

### Edited

| File | What |
|---|---|
| `src/lib/surfaces.ts` | `shouldLeaveDeletedAccount` and `scopeIsGone`, beside `accountScopeEntry`, reusing its `normalise`. |
| `src/lib/surfaces.test.ts` | 11 cases for the two. |
| `src/lib/auth-messages.ts` | One `AdminRejection` entry, `account-id-taken`. |
| `src/lib/auth-messages.test.ts` | The closed-set assertion widened by that one key, with its reason. |
| `src/pages/accounts.tsx` | The placeholder replaced by the real screen. |
| `src/pages/account-detail.tsx` | The device count (`AC-3`). Four lines; nothing else on that page changed. |
| `src/components/layout/account-context-bar.tsx` | The lens reconciliation, in the component that already holds the account list. |
| `src/lib/source-policy.test.ts` | Five new rules, one widened loop, one justified allowlist entry. |

## Deviations from the plan

### 1. The confirmation is typed against the account **id**, not its name

This is a deliberate deviation from the ClickUp acceptance criterion ("requires
the account name to be typed"), raised by the advisory panel's security lens and
folded into `spec.md > AC-13` and `plan.md` before any code was written.

Three facts made the name the wrong string to confirm an irreversible purge
against. It is **not unique** — only `account_id` is, and two accounts of one
customer are routinely `Acme Support` and `Acme Sales`. It is **server-controlled
text**: `accountName` in `@/lib/surfaces` strips Unicode control and format
characters — the bidi overrides that reorder what is rendered around them — and
caps the result at 60 characters with an ellipsis, so the dialog would have shown
either a string the operator *cannot type* or a raw one that re-opens the attack
ticket 7 closed. And the **id is already rendered raw**, in mono, by `IdText`.

The name is displayed beside it, sanitised, as context. The confirmation is
stronger than the criterion asked for, not weaker.

### 2. The plan's `DeleteOutcome` union was reduced to a discriminant

Revision 1 had `deleteOutcome` return
`{ kind: 'deleted' | 'kept', purged, failed, notAttempted }`. The senior lens
pointed out that this renames three fields of an already-typed
`DeleteAccountResult` and carries no decision beyond one boolean read — two names
for one report. It now returns `'deleted' | 'kept'` and the dialog renders
`purged_devices`, `failed_devices` and `not_attempted_devices` off the response.

The guarantee the function exists for is unchanged and is now asserted twice:
in its own test, and by a source rule that fails the build if the dialog derives
the answer from `failed_devices.length` instead.

### 3. `createRejection` became `createFailure`, with a third arm

Revision 1 had `createRejection(error): AdminRejection | null`. The senior lens
noted that the plan's prose described a "400 → the server's own message" arm that
the return type could not express and that was identical to the `null`
fall-through. The security lens, independently, found *why* that arm needed to
exist: `toActionErrorMessage` renders the server's text verbatim, and a `400`
rejecting `meta_token_ref` may quote the value it rejected — putting a pasted
Meta access token into a toast.

So the arm was not deleted; the return type grew to hold it.
`createFailure(error, sentReference)` answers `notice`, `server` or `redacted`,
and any failed request that **carried a reference** and got a response from the
server renders a fixed sentence instead of the server's text. A failure with no
server behind it (`status: 0` — offline, DNS, a cancelled request) keeps its text:
there is nothing that could have echoed anything.

### 4. Two lens decisions went to `surfaces.ts`, not to the new module

`shouldLeaveDeletedAccount` and `scopeIsGone` live in `src/lib/surfaces.ts`
beside `accountScopeEntry`, at the senior lens's suggestion: that module already
owns every decision about the account lens and already normalises an id in four
places, and a fifth copy of that normalisation in a second module is the
divergence it exists to prevent. Both reuse its `normalise`, which is what makes
` acc-a ` and `acc-a` the same account here as everywhere else.

### 5. `createAccountPayloadFrom` was kept rather than replaced by `clean()`

The senior lens suggested dropping it for `clean()` in `@/api/request`, which
already discards `undefined` and `''`. Declined, and the reason is recorded in the
function's own header:

- `clean()` returns `Record<string, unknown>`, so its result reaches
  `createAccount` only through a cast that discards the typed payload.
- It does not trim, and every id on this screen is trimmed.
- The header of `src/api/accounts.ts` states at length that the helper is used
  **nowhere** in that area, because one endpoint over it turns "unblock this
  device" into an empty body — `send_state: ''` is the only way to unblock a
  device and `clean()` deletes it. Reaching for it from a dialog would
  re-introduce exactly what that module refuses.

### 6. The feature directory is `account-admin/`, not `accounts/`

`src/features/account/` already exists and is unrelated — it is the **WhatsApp
profile**: avatar, business profile, contacts, push name. A sibling
`src/features/accounts/` one character away would be misread for the life of the
repository (senior lens).

### 7. One dialog per screen, not one per row

The house pattern (`create-device-dialog.tsx`) puts the trigger, the state and
the mutation inside the dialog. Copied into a table row that would mount one
dialog, one `useMutation` and one query instance per account — the same per-row
cost `<Can>` is banned from lists for, arriving by a different door (performance
lens). The page holds one `<DeleteAccountDialog>` driven by a `selectedAccount`
state; rows render a button.

### 8. The cache instructions were absent from revision 1 entirely

Two lenses found this independently and it would have shipped a create button
that appeared to do nothing: `useAccounts` holds a five-minute `staleTime` and
its own comment hands the explicit invalidation to *this* ticket by name. The
full table is in `plan.md > What the cache is told, exactly`. The sharpest part
is the performance lens's: the deleted account's device key is **removed**, never
invalidated — invalidating asks for an account that no longer exists, and
`retry: 1` in `src/main.tsx` makes that two guaranteed failing requests.

### 9. Two existing tests failed on the first run, and both were the guards working

- `auth-messages.test.ts` asserts `ADMIN_REJECTIONS` holds exactly the documented
  set. Adding `account-id-taken` broke it, which is the assertion doing its job.
  Widened by one key with the reason written into the list.
- `source-policy.test.ts` failed the `stores/account` import allowlist the moment
  the delete dialog imported the lens. Widened by one file with the reason
  written into the entry — deleting the account you are standing in is
  unavoidably "a place a human deliberately changes which account they are acting
  inside".

Neither was edited to make a failure go away; each was widened where its own
stated principle already covered the new case.

## The bundle question, with a number

| | `dist/index.html` |
|---|---|
| before (`ticket/z8pmx9mf17` tree) | 1,037,129 bytes |
| after | 1,057,557 bytes |
| delta | **+20,428 bytes** (+1.97%) |

Ticket 6 shipped `src/api/accounts.ts` and none of its unused exports; ticket 7
brought the first of them in. This ticket brings in the rest, and the built file
confirms the surface is really there:

| Marker | Occurrences in `dist/index.html` |
|---|---|
| `META_TOKEN_` | 3 |
| `Type the account id to confirm` | 1 |
| `Not attempted` | 1 |
| `account-id-taken` | 2 |

`dist/` still contains exactly one file, which is what CI asserts.

## Validation run

Profile `ui-source`, plus `ui-build` by hand:

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | clean |
| `ui-lint` | `npm run lint` | 4 warnings — the same 4 pre-existing `only-export-components` ones, in files this ticket did not touch |
| `ui-test` | `npm run test` | **451 passed in 28 files**, up from a 407-in-27 baseline |
| `ui-build` | `npm run build` | 1 file in `dist/`, 1,057,557 bytes |

### Mutation pass — 16 mutations, 3 controls

Each pure decision was mutated in the direction that would cause the damage it
exists to prevent, the suite was run, and the failure recorded. The list was
re-derived from the final signatures after the senior lens pointed out that
revision 1 named a comparison none of them contained.

| # | Mutation | Caught by |
|---|---|---|
| M1 | `deleteRequestFor` — cascade ternary inverted | 3 tests |
| M2 | `deleteRequestFor` — `expectedDevices` from a constant instead of the list's length | 1 |
| M3 | `deleteOutcome` — read `failed_devices.length === 0` instead of `account_deleted` | 1 |
| M4 | `deleteRejection` — the two `409` arms swapped | 1 |
| M5 | `deleteRejection` — the `askedForCascade` fallback deleted | 1 |
| M6 | `deleteRejection` — `403` mapped to a notice instead of `null` | 1 |
| M7 | `metaTokenRefError` — the prefix anchor dropped from the pattern | 4 |
| M8 | `metaTokenRefError` — the typed value interpolated into the message | 2 |
| M9 | `createAccountPayloadFrom` — omitted fields blanked to `''` instead | 1 |
| M10 | `confirmationMatches` — the blank-target guard removed | 1 |
| M11 | `confirmationMatches` — the comparison lower-cased | 1 |
| M12 | `isOwnAccountDeletion` — the `own !== ''` guard removed | **survived → fixed, see below** |
| M13 | `createFailure` — `redacted` downgraded to `server` | 1 |
| M14 | `shouldLeaveDeletedAccount` — the `accountDeleted` term dropped | 1 |
| M15 | `shouldLeaveDeletedAccount` — `===` widened to a truthiness test | 1 |
| M16 | `scopeIsGone` — the loaded-and-non-empty guard removed | 2 |

**M12 survived the first pass**, and the reason is worth recording: every
assertion about a principal belonging to no account compared a blank own account
against a *real* id, which fails either way. The guard only shows itself when
**both** sides are blank — `isOwnAccountDeletion('', '')` — because "belongs to no
account" is not the same fact as "belongs to the account whose id is blank", and
reading them as equal warns a user about a lockout that cannot happen. A case was
added; the mutation now fails one test, and the suite went from 450 to 451.

**Controls** — mutations the suite must *not* catch, which is how a suite is shown
to be testing behaviour rather than text:

| Control | Result |
|---|---|
| C1 — a doc comment reworded in `account-lifecycle.ts` | 451 passed, as expected |
| C2 — a lucide icon import aliased in `accounts.tsx` | 451 passed, as expected |
| C3 — a Tailwind gap class changed on the account row | 451 passed, as expected |

## Open items

- **Nothing is verified against a running gowa server.** Every assertion here is
  made against the reference document and against tests. In particular, the two
  `409` code strings are **inferred from prose** — the reference names them only
  in descriptions of a `409`, never inside a rendered envelope, and the
  `ErrorBadRequest` schema shows `code` carrying the HTTP status as a string.
  `deleteRejection` therefore never depends on one; it falls back on what the
  caller asked for, which is exact.
- **The `META_TOKEN_` prefix is a client-side constant.** A deployment that
  configured a different prefix must change the line in
  `src/lib/account-lifecycle.ts`. The server stays the authority and its
  rejection is rendered.
- **A `409` raised mid-cascade would be rendered as a false all-clear.** Both
  notices assert that nothing was purged, which is true of every `409` the
  reference documents today — all are raised before the cascade begins. The
  assumption is recorded in the module so the sentence is findable if that
  changes.
- **Study `Q-5`, `Q-6` and `Q-7` are obeyed, not resolved.** No single-account
  read, no editable name, no device-count column, no detach action.
- The devices, users and settings tabs of an account remain placeholders behind
  `/accounts/:accountId` — tickets 9, 10 and 11.
