---
ticket: z8pmx9mf18
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf18"
  github: ""
---

# Verification — 8 · Build the accounts list and the account lifecycle

## Validation profile — `ui-source` (+ `ui-build`)

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | clean |
| `ui-lint` | `npm run lint` | 0 | 4 warnings, all pre-existing `only-export-components` in files this ticket did not touch |
| `ui-test` | `npm run test` | 0 | **451 passed in 28 files** (baseline 407 in 27) |
| `ui-build` | `npm run build` | 0 | one file in `dist/`, 1,057,557 bytes |

Every command is read-only with respect to the working tree (VP-2) and
non-interactive (VP-3). No commit was created here (VF-10).

## Runtime impact (TR-3, VF-9)

**Did any deployment runtime file change? No.**

`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json` and `index.html` are untouched — confirmed by `git diff --name-only`
against the branch point. No dependency was added: the dialogs are built from
`dialog.tsx`, `checkbox.tsx`, `input.tsx`, `label.tsx`, `badge.tsx`, `card.tsx`,
`button.tsx` and `skeleton.tsx`, all already vendored, and the advanced disclosure
is a `useState` toggle rather than a newly vendored Radix collapsible.

The bundle grew **+20,428 bytes (+1.97%)**, from 1,037,129 to 1,057,557. `dist/`
still contains exactly one file, which is the invariant CI asserts.

**What changes at runtime for an existing user:**

- A holder of `accounts.manage` now sees a real accounts list where a placeholder
  was, and can create (with `.manage.all`) and delete accounts. This is new
  capability, not changed behaviour.
- A holder of neither permission sees **no change at all**: the route is guarded
  as it already was, and no navigation entry appears.
- `AccountContextBar` gained one effect. It fires only for a principal already
  carrying a **foreign** scope — the only case in which the bar renders at all —
  and only against a loaded, non-empty account list that omits that scope. For
  every other principal the component still returns `null` before making any
  request.
- `AccountDetailPage` now issues one `GET /accounts/{id}/devices` on the detail
  route. It is gated on the session and on `accounts.manage`, and cached for 30
  seconds.
- No change to `src/lib/http.ts`, the 401 recovery path, the refresh scheduler,
  the WebSocket, or any persisted store's shape.

**The one irreversible thing this ticket makes reachable** is the device purge,
and it is the server's action. It requires: the delete control (`accounts.manage`),
the cascade checkbox ticked deliberately, the account id typed exactly, a second
confirmation step, and a device count read live at that moment that matches the
server's own. Any mismatch purges nothing.

## Acceptance criteria — all 26 mapped to an executed result

### The list

| AC | Result | Evidence |
|---|---|---|
| AC-1 | **pass** | `src/pages/accounts.tsx` renders `useAccounts()` with no branch on who asked; the server scopes the response (reference §05). Grep confirms no permission read inside the `.map(`. |
| AC-2 | **pass** | `AccountRow` renders name, `IdText` id, an SMS-fallback badge, `formatDay(created_at)`, and an Open link. |
| AC-3 | **pass** | No device query and no count in `accounts.tsx`; the count is on `account-detail.tsx` via `useAccountDevices`. |
| AC-4 | **pass** | No call to any per-id account read exists; `accountName(accounts, id)` builds the detail header from the list. |
| AC-5 | **pass** | `grep -n 'account.name' src/` finds only reads. The create form has a name field; nothing edits an existing one. |

### Creating an account

| AC | Result | Evidence |
|---|---|---|
| AC-6 | **pass** | `accounts.tsx` gates `<CreateAccountDialog />` on `useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE_ALL)`, hoisted once. |
| AC-7 | **pass** | `account-lifecycle.test.ts` → *"omits account_id rather than sending an empty one"* asserts `'account_id' in payload === false`; **M9** (blank instead of omit) fails a test. |
| AC-8 | **pass** | `metaTokenRefError` rejects a literal token, a name outside the prefix, and a name with illegal characters; the submit button is disabled while it is non-null. **M7** (anchor dropped) fails 4 tests. |
| AC-9 | **pass** | The message never quotes its input (test + source rule); `createFailure` redacts server text for a failed request that carried a reference (**M13** fails a test); the field is cleared on close and absent from every response type. |
| AC-10 | **pass** | `createFailure` maps `409` to `account-id-taken`, whose copy says "Nothing was created and nothing was overwritten". |

### Deleting an account

| AC | Result | Evidence |
|---|---|---|
| AC-11 | **pass** | The row's delete button renders behind `mayDelete`, hoisted once in the page. |
| AC-12 | **pass** | The checkbox defaults to `false`; `deleteRequestFor(false, …)` returns `{ purgeDevices: false }` — no query parameters at all. **M1** (inverted) fails 3 tests. `ACCOUNT_HAS_DEVICES` renders its own notice. |
| AC-13 | **pass** (revised) | Two steps: step one counts and takes the typed **id**; step two submits. `confirmationMatches` is exact and case-sensitive; **M10** and **M11** each fail a test. The deviation from the name is recorded in `spec.md > AC-13`, `plan.md` and `implement.md`. |
| AC-14 | **pass** | The mutation function `await`s `listAccountDevices(id)` and passes the returned array to `deleteRequestFor`. **M2** (constant instead of the list) fails a test. A source rule fails the build if the dialog names `getQueryData`. A failed read rejects the mutation, so no `DELETE` is sent. |
| AC-15 | **pass** | `deleteRejection` maps the mismatch to its notice ("Nothing was purged and nothing was deleted… Reopen the account… and confirm again"). **M4** and **M5** each fail a test. |
| AC-16 | **pass** | `DeleteReport` renders `purged_devices`, `failed_devices` and `not_attempted_devices` as three separately-labelled lists, each with the sentence for what state those devices are in. |
| AC-17 | **pass** | `deleteOutcome` reads `account_deleted` alone; the success toast and the close are behind it. **M3** fails a test, and a source rule fails the build if the dialog derives it from `failed_devices.length`. |
| AC-18 | **pass** | A `kept` outcome keeps the dialog open and relabels the action "Run it again"; the re-run goes through the same mutation, so the live read repeats. |
| AC-19 | **pass** | The checkbox's own copy: "Purging a device destroys its WhatsApp session keys. Re-pairing needs physical access to the customer's phone. This is irreversible." |
| AC-20 | **pass** | The "Pausing instead of ending?" panel: block every device and keep the data. |
| AC-21 | **pass** | `accountsKey()` invalidated on every response; `['devices']` prefix when `purged_devices` is non-empty; `accountDevicesKey(id)` **removed** when deleted; `enterAccount(null)` behind `shouldLeaveDeletedAccount`. **M14** and **M15** each fail a test; a source rule asserts the single lens write. |
| AC-21a | **pass** | `isOwnAccountDeletion` drives a distinct destructive panel in step one. **M12** survived the first pass and was killed by an added case (`implement.md`). |
| AC-21b | **pass** | `scopeIsGone` in the context bar. **M16** (guard removed) fails 2 tests; `surfaces.test.ts` covers pending, failed, empty and matching lists. |

### Permissions

| AC | Result | Evidence |
|---|---|---|
| AC-22 | **pass** | `source-policy.test.ts` — `account-lifecycle.ts` was added to the existing loop asserting the decision modules name no `role`/`roles` in any casing and import no store. The repository-wide role rule is unchanged and green. |
| AC-23 | **pass** | Both booleans are `useHasPermission` calls in `AccountsPage`, passed into `AccountRow` as props. No `<Can>` anywhere; the existing `<Can>`-in-a-list rule is green. |
| AC-24 | **pass** | `deleteRejection` returns `null` for `403`, so it falls through to `toActionErrorMessage` — which keeps the server's text and, provably in `src/lib/http.ts`, spends no refresh and triggers no logout. **M6** fails a test. |

### Testing

| AC | Result | Evidence |
|---|---|---|
| AC-25 | **pass** | The two-step payload (`deleteRequestFor`), the live count (its array signature plus the `getQueryData` rule), the report decision (`deleteOutcome`) and the "kept on purpose" outcome are each covered, and each mutation-tested. |
| AC-26 | **pass** | `npm run test` passes `source-policy.test.ts`: 5 new rules, one widened loop, one widened allowlist, and the two pre-existing rules that fired during implementation and were widened at their own stated principle. |

## Test cases — all 14 executed

| TC | Result | Note |
|---|---|---|
| TC-1 | **pass** | One component, no branch: the server returns one row and `AccountsPage` renders one. Create is behind `.manage.all`, which that principal does not hold. |
| TC-2 | **pass** | `deleteRequestFor(false, [two devices]) → { purgeDevices: false }`, so no `purge_devices` travels; the `409` maps to `account-has-devices`, whose copy explains the devices must be purged explicitly. |
| TC-3 | **pass** | The submitted count is the length of the array read at submission, not the one step one displayed; the `409` maps to the mismatch notice, which asks for a reload rather than retrying with the stale number. |
| TC-4 | **pass** | `account_deleted: false` → `'kept'`; the three lists render separately; the action becomes "Run it again". |
| TC-5 | **pass** | A literal token is rejected before the request; the helper text names the prefix; nothing renders the value afterwards, and a failed create carrying one renders `CREATE_FAILED_REDACTED` instead of server text. |
| TC-6 | **pass** | Both blank optional fields are omitted from the payload rather than blanked. |
| TC-7 | **pass** | Create `409` → `account-id-taken`; delete `409` → one of the two, chosen from what the request asked for when no semantic code arrives. |
| TC-8 | **pass** | `account_deleted: true` with a non-empty `failed_devices` still reads `'deleted'` — one field answers. |
| TC-9 | **pass** | `shouldLeaveDeletedAccount`: leaves on a real deletion of the scoped account; stays on a kept account, on another account, and on an implicit scope. |
| TC-9a | **pass** | `scopeIsGone`: clears on a loaded list that omits the scope; leaves it alone for `undefined`, `[]`, a matching entry, and an implicit scope. |
| TC-9b | **pass** | `isOwnAccountDeletion` recognises the principal's own account, ignores anybody else's, and does not match two absences against each other. |
| TC-10 | **pass** | Whitespace forgiven, case and near-misses rejected, an empty box never confirms. |
| TC-11 | **pass** | `npm run test` — 28 files, 451 tests, `source-policy.test.ts` included. |
| TC-12 | **pass** | `accounts.tsx` contains no `<Can>` and no hook call inside a `.map(`; the existing repository rule that enforces this is green. |

## What the review panel changed before any code was written

The panel ran on `plan.md` revision 1 and returned 30 findings. **Eleven changed
the design and two changed the specification**, all before implementation. The
full ledger is `plan.md > Panel response`; the ones that would otherwise have
shipped as defects:

- **Nothing invalidated the account list.** Two lenses found this independently.
  `useAccounts` holds a five-minute `staleTime`; the create button would have
  appeared to do nothing and a deleted account would have stayed listed.
- **Nothing invalidated the device caches after a cascade.** Also found by two
  lenses. The switcher and every operational screen would have kept rendering
  devices that no longer exist.
- **The purge was confirmed against a name.** Not unique, and sanitised and
  truncated before display — so the operator would have been asked to type a
  string they could not see in full.
- **An account administrator could lock themselves out with no warning.**
  Their only row *is* their own account.
- **A `400` could have put a pasted Meta token into a toast**, through the
  server's own echoed message.
- **A per-row dialog** would have mounted a mutation and a query instance per
  account.

## Open items

Carried from `implement.md`, unchanged by verification:

- Nothing is verified against a running gowa server; the two `409` code strings
  remain inferred from prose, which is why the classifier never depends on one.
- The `META_TOKEN_` prefix is a client-side constant standing in for a
  deployment's configuration.
- A `409` raised mid-cascade would be rendered as a false all-clear; the
  assumption is recorded in the module.
- Study `Q-5`, `Q-6`, `Q-7` are obeyed rather than resolved.

## Decision

**PASSED.** All 26 acceptance criteria are mapped to an executed result and every
one passes; all 14 test cases executed and passed; `ui-source` and `ui-build` are
green; no deployment runtime file changed; 16 of 16 mutations are caught (one
after an added case) and all 3 controls behaved.
