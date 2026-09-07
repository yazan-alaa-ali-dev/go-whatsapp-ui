---
ticket: z8pmx9mf18
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf18"
  github: ""
---

# Plan — 8 · Build the accounts list and the account lifecycle

> **Revision 2.** Revision 1 was authored for the advisory review panel
> (`senior-reviewer`, `security-reviewer`, `performance-reviewer`) before any
> code was written. The panel returned 30 findings across the three lenses — two
> of them raised independently by two lenses — and every one is answered in
> **Panel response** at the end of this file. Eleven changed the design, and
> those changes are folded into the sections below.
>
> **Two findings changed the specification itself**, not just the plan, and are
> marked in `spec.md`: `AC-13` now confirms on the account **id** rather than the
> name, and `AC-21a` was added for the account an operator can lock themselves
> out of.

## Approach

Everything on the wire already exists. Ticket 6 typed and tested all nine account
calls in `src/api/accounts.ts`, including the two shapes that make this ticket
hard — the `DeleteAccountOptions` union that cannot be under-filled, and the
`DeleteAccountResult` partial-execution report. Ticket 7 opened `/accounts` and
`/accounts/:accountId` behind `accounts.manage` and left both rendering a
placeholder. **This ticket writes only the surface**, and modifies no module in
`src/api/`.

The shape of the work is set by one fact about this repository: **there is no
component renderer in the test environment.** A decision written inside JSX is a
decision no test can reach, and this is the ticket where a decision going wrong
destroys a customer's WhatsApp session keys. So every decision the delete flow
makes is lifted into pure functions — what to send, which rejection this is, what
the outcome was, and whether the account lens must be abandoned — each taking its
inputs as arguments and each with a colocated test. The dialogs become thin: they
hold form state, call a pure function, and render what it returned.

### One screen, no branch, and the audience that proves it

`GET /accounts` returns every account to a holder of `accounts.manage.all` and
only the caller's own account to everybody else (reference §05). The account
administrator's view is therefore the same component with one row in it.

This is worth stating as a design decision rather than an observation, because
the alternative is tempting and wrong: an "if the caller is an admin, show their
own account instead" branch would be a second rendering path exercised by the
majority of principals and tested by nobody, and it would drift the first time a
column changes. The list renders `accounts` and nothing reads who asked.

The one thing that *does* branch is the create action, and it branches on
`accounts.manage.all`, which is the permission `POST /accounts` actually requires
(reference §05). Delete branches on `accounts.manage`. Both booleans are hoisted
once in the page component — never per row (`src/components/shared/can.tsx` and
the source rule that enforces it).

### The dialogs are mounted once, not once per row

**(Performance, major.)** The house pattern — `create-device-dialog.tsx` — puts
the trigger, the local state and the mutation inside the dialog component. Copied
into a row, that mounts one dialog, one `useMutation` and one query instance per
account, which is the per-row cost `AC-23` forbids `<Can>` for, arriving by a
different door.

So the accounts page holds **one** `<DeleteAccountDialog>`, driven by a single
`selectedAccount` state. A row renders a button that sets it. The dialog's own
step-one state — the typed confirmation and the cascade checkbox — stays inside
the dialog, below the list boundary, so a keystroke in the confirmation field
re-renders the dialog and not the table.

### The delete is a state machine, and its decisions are pure

The endpoint has three properties that reshape the UI, and the study (§07) names
all three: a cascade that must be asked for explicitly, an `expected_devices`
that must be read live and is never defaulted, and a response that is a report
rather than a boolean.

`src/lib/account-lifecycle.ts` holds the decisions that belong to the *lifecycle*:

```ts
metaTokenRefError(value: string): string | null
createAccountPayloadFrom(fields): CreateAccountPayload
createFailure(error: unknown, sentReference: boolean): CreateFailure
confirmationMatches(typed: string, target: string): boolean
deleteRequestFor(purge: boolean, live: readonly {device_id: string}[]): DeleteAccountOptions
deleteOutcome(result: DeleteAccountResult): 'deleted' | 'kept'
deleteRejection(error: unknown, askedForCascade: boolean): AdminRejection | null
isOwnAccountDeletion(targetAccountId, ownAccountId): boolean
```

**The two decisions about the account lens do not live there.** `src/lib/surfaces.ts`
already owns every decision about the scope, already normalises an id the same way
in four places, and is already covered by the source rule that it reads its
arguments and nothing else. Putting a third and fourth lens decision in a second
module would be the divergence that module exists to prevent, so they go beside
`accountScopeEntry`:

```ts
shouldLeaveDeletedAccount(currentScope, deletedAccountId, accountDeleted): boolean
scopeIsGone(accounts, currentScope): boolean
```

### `expected_devices` is read at submission, and the read can fail

`GET /accounts/{id}/devices` is the authoritative membership list (study §08: it
reads the device rows, which is what the reply path reads). It is used twice on
this screen, and the two uses must not share a value:

- **Step one displays a count.** That is a render, so it comes from a TanStack
  query on the existing `accountDevicesKey(accountId)`, enabled only while the
  dialog is open. It is allowed to be a moment stale — it is informing a human
  who is about to type an account id.
- **Step two submits a count.** That is an irreversible purge, so it calls
  `listAccountDevices(accountId)` **directly**, at click time. Never
  `queryClient.getQueryData`, never the value step one rendered, and never a
  default.

**(Security, major.)** `deleteRequestFor` therefore takes the **device list**, not
a number. A number is a value anything can mint — a cached count, a `0`, a stale
`getQueryData` — and every one of those is a type-correct call that every unit
test passes. Taking the array the live read returned puts the provenance in the
signature, and a source rule bans `getQueryData` from the dialog so the array
cannot come from the cache either.

**(Security + senior, both.)** **A failed live read aborts the submission.** No
`DELETE` is sent, the read's own error is rendered, and the operator may retry.
Falling back to the displayed count is the exact hazard `AC-14` exists to
prevent.

`listAccountDevices` answers `[]` for an envelope with no `results`, so a
degenerate response would submit `expected_devices: 0`. That is recorded rather
than defended against, because it is **inert**: an account that owns devices
answers `409 ACCOUNT_DEVICE_COUNT_MISMATCH` and purges nothing, and an account
that owns none has nothing to lose. A wrong-low count cannot over-purge; that is
what the server-side comparison is for. `src/api/accounts.ts` is not modified
(C-1).

The live read's result is written into the cache (`setQueryData` on
`accountDevicesKey`), so the count on screen and the count submitted agree after a
re-run rather than disagreeing silently.

### The cascade is an opt-in, and the refusal it produces is rendered

Step one carries an unchecked checkbox: *also purge the N devices this account
owns*. Unchecked, the request carries no `purge_devices` at all — which is what
"asked for explicitly" means, and it is the request the reference documents being
refused with `409 ACCOUNT_HAS_DEVICES` when the account still owns devices.

That refusal is **rendered rather than pre-empted.** A client-side "you have
devices, tick the box" would be the client asserting a count it read a moment ago
as though it were the server's; the whole design of this endpoint says the client
does not know. So the operator's request is sent, the server answers, and the
notice explains that the devices must be purged explicitly. It is also the only
way `ACCOUNT_HAS_DEVICES` is reachable at all, and a rejection branch that can
never fire is the failure mode `auth-messages.ts` already refuses to build.

### The confirmation is typed against the account **id**, not its name

**(Security, major — this changes `AC-13`.)** The ticket asks for the account
*name* to be typed. Three facts make the name the wrong string to confirm an
irreversible purge against:

1. **It is not unique.** Only `account_id` is. Two accounts of one customer are
   routinely `Acme Support` and `Acme Sales`, and nothing stops two accounts
   sharing a name outright.
2. **It is server-controlled text.** `accountName` in `@/lib/surfaces` strips
   Unicode control and format characters — the bidi overrides that can reorder
   what is rendered around them — and caps the result at 60 characters with an
   ellipsis. So the dialog would either display a sanitised, elided string the
   operator *cannot type*, or display the raw one and re-open the reordering
   attack ticket 7 closed.
3. **The id is already rendered raw**, in mono, by `IdText`, and is immune to
   both problems.

So the operator types the account id. The name is displayed beside it, sanitised,
as context. This is a deliberate deviation from the ClickUp acceptance criterion,
recorded here and in `implement.md`, and it makes the confirmation *stronger*
rather than weaker.

### Deleting the account you belong to

**(Security, major — this adds `AC-21a`.)** For a holder of `accounts.manage`
without `.all`, `GET /accounts` returns exactly one row: their own account. The
single delete this screen offers them is therefore the deletion of the account
they belong to — an irreversible self-lockout with no in-product recovery.
`ADMIN_REJECTIONS` already carries a `self-mutation` notice for the equivalent on
the users surface, and nothing in this ticket had an equivalent.

The action is **not withheld** — the server is the authority, and a super
administrator deleting a decommissioned account they happen to belong to is a
legitimate operation this client must not guess about. Instead
`isOwnAccountDeletion` drives a distinct, prominent warning in step one: *this is
the account your own user belongs to; deleting it ends your access to this
dashboard and there is no way back through the product.*

### Which `409` this is, decided by the caller that made the request

`ADMIN_REJECTIONS` in `@/lib/auth-messages` already carries both notices, and
that module states plainly that it contains **no classifier on purpose**: "a
caller that knows which request it just made is better placed to pick an entry
than a function guessing from a status code." This ticket is that caller:

```ts
deleteRejection(error, askedForCascade)
  404                                         → 'not-found'
  409 + code ACCOUNT_HAS_DEVICES              → 'account-has-devices'
  409 + code ACCOUNT_DEVICE_COUNT_MISMATCH    → 'account-device-count-mismatch'
  409 + no recognised code, cascade asked     → 'account-device-count-mismatch'
  409 + no recognised code, cascade not asked → 'account-has-devices'
  anything else                               → null  (fall through)
```

The two code strings are **inferred** — the reference names them only in prose
descriptions of a `409`, never inside a rendered envelope, and the
`ErrorBadRequest` schema shows `code` carrying the HTTP status as a string. Hence
the fallback on what the caller asked for, which needs no code string and cannot
be wrong: only one of the two rejections is reachable for a given request shape.

**(Security, info.)** Both notices assert that nothing was purged and nothing
deleted, which is true of every `409` the reference documents — all of them are
raised before the cascade starts. A `409` raised *mid-cascade* would be rendered
as a false all-clear. The assumption is recorded in the module so the day it
stops holding, the sentence is findable.

### `403` keeps its existing sentence, and `null` is the fall-through

`toActionErrorMessage` already renders a `403` as a permission rejection while
keeping the server's text, and provably spends no refresh and triggers no logout
(`src/lib/http.ts` and its tests). So the classifier returns `null` for anything
it does not recognise, and the caller falls through to that existing path. No new
403 handling is written, and none may be.

### The reference value never reaches a rendered string

**(Security, major.)** `meta_token_ref` names an environment variable holding a
Meta access token. Two paths could have put a *value* on screen, and both are
closed:

- `metaTokenRefError` returns a **fixed sentence naming only the prefix**. It
  never interpolates what was typed. Asserted in its test.
- A failed create renders the server's own message through
  `toActionErrorMessage`, and a server that echoes the offending field in a
  `400` would echo it into a toast. So `createFailure(error, sentReference)`
  returns three arms rather than a rejection or `null`: a recognised `notice`, the
  server's text (`server`), or `redacted` — a fixed sentence — whenever the failed
  request **carried a reference** and the failure came from the server at all.
  The diagnostic loss is bounded and the alternative is a token in a toast.

A source rule asserts the create dialog never passes the field's value into a
message, and the field itself is `autoComplete="off"`, `spellCheck={false}`,
controlled, and cleared when the dialog closes — so autofill and form history do
not retain what the "cleared on close" guarantee covers.

### `account_deleted` is the only success signal

**(Senior, minor.)** `deleteOutcome` returns the **discriminant only** —
`'deleted' | 'kept'`. An earlier draft returned a union that renamed three fields
of the already-typed `DeleteAccountResult`; it carried no decision beyond one
boolean read and gave the report two names. The dialog renders `purged_devices`,
`failed_devices` and `not_attempted_devices` straight off the response.

What the function is *for* is that it reads `account_deleted` and nothing else.
The reference also says the account is kept whenever `failed_devices` is
non-empty, and that is true — but deriving the answer from a second field is how a
`200` gets reported as a deletion that did not happen. One field answers.

A `'kept'` outcome therefore produces no success toast. The dialog stays open,
renders the report, and offers a re-run — legitimate because the reference states
the cascade is safe to re-run: what was not purged is still owned by the account,
and no device is left pointing at an account that is gone. The re-run repeats the
live read.

### Neither dialog uses `useActionMutation`

**(Senior, major.)** The house helper toasts success unconditionally and routes
every error through `toActionErrorMessage`. Both behaviours are wrong here: it
would report `account_deleted: false` as success (`AC-17`) and it would bypass the
`409` classifiers entirely (`AC-10`, `AC-12`, `AC-15`). Both dialogs use a bare
`useMutation` and choose their own success and failure rendering. This is a
deliberate refusal of the house pattern and is recorded as one.

### The report is a report

Three lists, each rendered only when non-empty, each labelled with what actually
happened to those devices:

- **Purged** — destroyed by this call, irreversibly.
- **Failed** — the purge returned an error. The account was kept because of these.
- **Not attempted** — the request deadline stopped the loop. Untouched, *not*
  half-purged, and a re-run continues with them.

"Not attempted" gets its own sentence because it is the one an operator will
otherwise read as "failed", and the difference between "untouched" and "half
destroyed" is the difference between re-running calmly and phoning the customer.

### What the cache is told, exactly

**(Senior + performance, both major, and unspecified in revision 1.)**
`useAccounts` sets `staleTime: 5 * 60_000` and its own comment hands the explicit
invalidation to this ticket. Without it a created account is invisible and a
deleted one stays listed for up to five minutes. And a cascade destroys **device
rows**, which the device switcher, `wsClient.sync()` and every operational screen
are still rendering.

| When | What |
|---|---|
| create succeeds | `invalidateQueries(accountsKey())` |
| any delete response | `invalidateQueries(accountsKey())` |
| `purged_devices` non-empty | `invalidateQueries({ queryKey: ['devices'] })` — the prefix, so every cached scope variant including the unfiltered `devicesKey(null)` a super administrator holds |
| account was deleted | `removeQueries(accountDevicesKey(id))` — **removed, never invalidated**: invalidating asks for an account that no longer exists, and `retry: 1` in `src/main.tsx` makes that two guaranteed failures |
| account was kept | `setQueryData(accountDevicesKey(id), …)` from the live read, so the count on screen matches the one that will be submitted next |

### Deleting the account you are standing in, and the tab that was not looking

Ticket 7 made the account scope real, and this ticket makes it possible to delete
the account the scope points at. Left alone, the lens would name an account that
no longer exists, and `GET /devices?account_id=<gone>` answers `200` with an
empty array rather than a `404` (reference §05) — read by the operator as *I have
no devices*, with no diagnosis available anywhere. That is precisely the failure
ticket 7 built the context bar to prevent, and it is reachable again here.

So: when the response says the account is gone and the current scope names it,
`enterAccount(null)` (`shouldLeaveDeletedAccount`).

**(Security, minor.)** That closes one path and not the other. The lens persists
to `localStorage` under `gowa-ui.account.v1`, and zustand's persist does not
broadcast, so a *second tab* keeps a lens naming a deleted account and lands in
exactly the undiagnosable blank state above. The reconciliation belongs where the
lens is already read and the account list is already loaded — the context bar —
and it is a pure decision (`scopeIsGone`) beside the other two.

It fires **only on a loaded, non-empty account list that omits the scope.** A
pending query, a failed one, and an empty list all leave the lens alone: clearing
an operator's scope because a request was slow would be a worse bug than the one
being fixed.

This requires widening the `stores/account` import allowlist in
`src/lib/source-policy.test.ts` by one file — the delete dialog. The
justification is the one the existing entries already state, "a place a human
deliberately changes which account they are acting inside", and deleting the
account you are inside is that, unavoidably.

### What is *not* built, and why each omission is deliberate

- **No device-count column.** `Q-7`: the count is not on the account object and
  one request per row is not acceptable. The count appears on the detail screen,
  where there is exactly one account to count, and in the delete dialog, which
  reads it live because it must.
- **No account fetched by id.** `Q-5`: there is no single-account read endpoint.
- **No editable name field.** `Q-5`: no endpoint changes an account name.
- **No search, no pagination.** `GET /accounts` offers neither and returns tens
  of rows. Building a client-side pager over an unpaginated endpoint would be
  inventing a capability the backend does not have.
- **No SMS fallback switch.** Ticket 11. This ticket renders the state the
  account object already carries, as a badge, and changes nothing.
- **No block-every-device action.** That control is the devices tab, ticket 9.
  The delete dialog names the alternative in prose and links to the account.
- **(Performance, minor.) No new vendored primitive.** There is no
  `collapsible.tsx` and no `table.tsx` in `src/components/ui/`, and vendoring one
  inlines Radix bytes into a single-file bundle for behaviour `useState` and
  semantic markup give free. The advanced disclosure is a `useState` toggle; the
  rows are a `ul`/`li` list, as `newsletter-list.tsx` already does.

### The detail screen gains one line, not a tab

`AccountDetailPage` is ticket 7's, and ticket 9 owns its tabs. `AC-3` says the
device count belongs there, so this ticket adds the count — one
`useAccountDevices` call and one line of text — and touches nothing else on that
page. Building the membership list to satisfy a count would be building ticket 9.

## Steps

1. **`src/lib/account-lifecycle.ts`** — the pure lifecycle decisions listed
   above. No React, no store, no axios instance.
2. **`src/lib/account-lifecycle.test.ts`** — a case per decision, including the
   two `409` shapes, the `account_deleted: true` + non-empty `failed_devices`
   contradiction, the `meta_token_ref` rejections and the assertion that the
   message never carries the value, and the omitted-versus-empty payload fields.
3. **`src/lib/surfaces.ts`** — `shouldLeaveDeletedAccount` and `scopeIsGone`,
   beside `accountScopeEntry`, reusing its `normalise`.
   **`src/lib/surfaces.test.ts`** — their tests, including every "leave the lens
   alone" case.
4. **`src/lib/auth-messages.ts`** — add one `AdminRejection` entry,
   `'account-id-taken'`, because `POST /accounts` documents its `409` as a single
   cause while the existing `'already-taken'` deliberately refuses to say which of
   three fields collided on `POST /auth/users`. Two endpoints, two answers. Lands
   in the same edit as step 1 or the union does not type-check.
5. **`src/hooks/use-account-devices.ts`** — a TanStack query on
   `accountDevicesKey(accountId)`, `enabled` on an argument so a closed dialog
   issues no request, with a stated `staleTime`.
6. **`src/features/account-admin/create-account-dialog.tsx`** — the create form,
   the advanced disclosure, validation before the request, redaction on failure,
   every field cleared on close.
7. **`src/features/account-admin/delete-account-dialog.tsx`** — the two-step
   confirmation, the cascade opt-in, the own-account warning, the live read at
   submission, the rejection notices, the report, and the re-run.
8. **`src/pages/accounts.tsx`** — the page: header, the create action behind
   `accounts.manage.all`, the query states, the rows, and the one delete dialog.
9. **`src/pages/account-detail.tsx`** — add the device count. Nothing else.
10. **`src/components/layout/account-context-bar.tsx`** — reconcile a lens naming
    an account that is no longer listed.
11. **`src/lib/source-policy.test.ts`** — add `src/lib/account-lifecycle.ts` to
    the **existing** z8pmx9mf17 "no store, no role" loop rather than writing a
    fourth rule; add the two new rules (the delete dialog reads no cache and
    writes the lens only from the pure decision; the create dialog never renders
    the reference value); and widen the `stores/account` allowlist by one file
    with its justification.

## Files to change

| File | New? | What |
|---|---|---|
| `src/lib/account-lifecycle.ts` | new | The pure decisions of the create and delete flows. |
| `src/lib/account-lifecycle.test.ts` | new | Their tests. |
| `src/hooks/use-account-devices.ts` | new | `GET /accounts/{id}/devices` as a gated query. |
| `src/features/account-admin/create-account-dialog.tsx` | new | The create form. |
| `src/features/account-admin/delete-account-dialog.tsx` | new | The two-step delete and its report. |
| `src/lib/surfaces.ts` | edit | Two lens decisions, beside the one that is already there. |
| `src/lib/surfaces.test.ts` | edit | Their tests. |
| `src/lib/auth-messages.ts` | edit | One new `AdminRejection` entry. |
| `src/pages/accounts.tsx` | edit | The real screen, replacing the placeholder. |
| `src/pages/account-detail.tsx` | edit | The device count (AC-3), and nothing else. |
| `src/components/layout/account-context-bar.tsx` | edit | Lens reconciliation against the loaded account list. |
| `src/lib/source-policy.test.ts` | edit | Two new rules, one widened loop, one justified allowlist entry. |

Directory name: **`src/features/account-admin/`**, not `src/features/accounts/`
— **(senior, minor)** the latter sits one character from the existing, unrelated
`src/features/account/` (the WhatsApp profile forms: avatar, business profile,
contacts), and the two import paths would be misread for the life of the
repository.

No file under `src/api/` is touched. No deployment runtime file is touched.

## Validation strategy

Profile **`ui-source`** (`npm run typecheck`, `npm run lint`, `npm run test`) as
the default for an application change, plus **`ui-build`** (`npm run build`),
because this ticket adds two components and a hook to a bundle that must stay a
single file.

Baseline: 27 test files, 407 tests, all passing.

Beyond the profile, a **mutation pass**, with the list re-derived from the final
signatures **(senior, info — revision 1 named a comparison none of them
contains)**. Each pure decision is mutated in the direction that would cause the
damage it exists to prevent:

- `deleteRequestFor` — the cascade ternary inverted; `expectedDevices` sourced
  from a constant rather than the array's length.
- `deleteOutcome` — `account_deleted` replaced by `failed_devices.length === 0`.
- `deleteRejection` — the two `409` arms swapped; the `askedForCascade` fallback
  deleted; `403` mapped to a notice instead of `null`.
- `metaTokenRefError` — the prefix anchor dropped; the value interpolated into
  the message.
- `createAccountPayloadFrom` — the omitted fields blanked to `''` instead.
- `confirmationMatches` — the blank-target guard removed; the comparison
  lower-cased.
- `shouldLeaveDeletedAccount` — the `accountDeleted` term dropped; `===` widened
  to a truthiness test.
- `scopeIsGone` — the loaded-and-non-empty guard removed, so a pending list
  clears the lens.
- `createFailure` — `redacted` downgraded to `server`.

A test that survives its mutation is a test that proves nothing, and the survivors
are recorded in `implement.md` rather than quietly fixed.

## Rollback

Every new file is additive; the six edited files are edited in place. Reverting
the ticket's commit restores the placeholder `/accounts` and the previous context
bar, and nothing else in the app imports any new module. There is no data
migration, no persisted-store shape change, and no wire change to undo. The one
irreversible thing this ticket makes reachable — a purge — is the server's, and
it is guarded by the two-step confirmation, not by anything a rollback could
reach.

## Out of scope

As `spec.md > Out of scope`. In particular: the devices, users and settings tabs
of an account; the SMS fallback switch; pagination or search over `GET /accounts`;
and any change to `src/api/accounts.ts`.

## Panel response

Three lenses, 30 findings. Every one is answered below. **Eleven changed the
design** and are folded into the sections above; two of those changed `spec.md`.

### The two findings two lenses reached independently

Both are about what the cache is told after a delete, and neither appeared in
revision 1 at all — the plan said "the account list is refetched" and stopped.

- **The senior and performance lenses both found the missing
  `invalidateQueries(accountsKey())`.** `useAccounts` sets a five-minute
  `staleTime` and its own comment hands the explicit invalidation to *this*
  ticket by name; without it a created account is invisible and a deleted one
  stays listed. Revision 1 would have shipped a create button that appears to do
  nothing.
- **Both also found that a cascade destroys device rows nothing invalidates.**
  The device switcher, `wsClient.sync()` and every operational screen would keep
  rendering devices that no longer exist, and for a super administrator the
  unfiltered `devicesKey(null)` is the list that holds them.

Two lenses arriving separately at the same omission is the signal that it was a
real hole rather than a preference. The full table is now in **What the cache is
told, exactly**, including the performance lens's sharper follow-up: the
account-devices key is **removed**, never invalidated, when the account is gone —
invalidating asks for an account that does not exist and `retry: 1` makes that two
guaranteed failures.

### The findings that changed the design

| # | Lens | Finding | Answer |
|---|---|---|---|
| 1 | performance | A per-row `<DeleteAccountDialog>` mounts N dialogs, N mutations and N query instances — the per-row cost `AC-23` bans `<Can>` for, arriving by a different door. | **Adopted.** One dialog at page level, driven by `selectedAccount`; rows render a button. Step-one form state stays inside the dialog, below the list boundary, so a keystroke does not re-render the table. |
| 2 | security | The purge is confirmed by typing a **name**, which is not unique, is server-controlled text, and is stripped and truncated by `accountName` — so the dialog shows either an untypeable string or a raw one that re-opens the bidi attack ticket 7 closed. | **Adopted, and it changed `AC-13`.** The confirmation is typed against `account_id`: unique, already rendered raw by `IdText`, immune to both problems. Recorded as a deliberate deviation from the ClickUp criterion. |
| 3 | security | `deleteRequestFor(purge, count: number)` accepts any number — a cached count, a stale `getQueryData`, a `0` — and every one is a type-correct call every test passes. | **Adopted.** It takes the device **array** the live read returned, so provenance is in the signature, and a source rule bans `getQueryData` from the dialog. |
| 4 | security | An account administrator's only row is their own account, so the only delete offered them is an irreversible self-lockout, and nothing mentioned it. | **Adopted, and it added `AC-21a`.** `isOwnAccountDeletion` drives a distinct warning in step one. The action is **not** withheld — the server is the authority, and a super administrator deleting a decommissioned account they belong to is legitimate. |
| 5 | security | `meta_token_ref` can still reach a rendered string: a `400` whose message echoes the field goes verbatim into a toast through `toActionErrorMessage`. | **Adopted.** `createFailure` gains a `redacted` arm: a failed create that **carried a reference** never renders server text. `metaTokenRefError` returns a fixed sentence and is asserted never to contain its input. |
| 6 | senior | `useActionMutation` toasts success unconditionally and routes every error through `toActionErrorMessage` — it would report `account_deleted: false` as success and bypass the `409` classifiers. | **Adopted.** Both dialogs use a bare `useMutation`. The refusal of the house helper is now stated in the plan rather than left implicit. |
| 7 | senior | `shouldLeaveDeletedAccount` puts a second account-scope decision in a second module, while `src/lib/surfaces.ts` already owns lens decisions and already normalises ids. | **Adopted.** Both lens decisions moved to `surfaces.ts`, reusing its `normalise`. The lifecycle module keeps only lifecycle decisions. |
| 8 | senior | `DeleteOutcome` renames three fields of an already-typed response and carries no decision beyond one boolean read. | **Adopted.** `deleteOutcome` returns `'deleted' \| 'kept'`. The report is rendered off the response's own fields. |
| 9 | senior | `src/features/accounts/` sits one character from the unrelated `src/features/account/`. | **Adopted.** `src/features/account-admin/`. |
| 10 | senior | The new source rule duplicates the existing z8pmx9mf17 loop over the two decision modules. | **Adopted.** `src/lib/account-lifecycle.ts` is added to that loop — three new rules, not four. |
| 11 | security + senior | The submission-time read has no stated failure path. | **Adopted.** A failed live read aborts: no `DELETE` is sent and the read's error is rendered. |
| 12 | performance | No `collapsible.tsx` or `table.tsx` is vendored; adding one inlines Radix bytes into a single-file bundle for behaviour `useState` gives free. | **Adopted.** The disclosure is a `useState` toggle; the rows are semantic `ul`/`li`, as `newsletter-list.tsx` already is. |
| 13 | security | The lens persists to `localStorage` and zustand does not broadcast, so a second tab keeps a lens naming a deleted account. | **Adopted.** `scopeIsGone` reconciles the lens in the context bar — but **only** against a loaded, non-empty list. A pending or failed query leaves the lens alone; clearing a scope because a request was slow is a worse bug than the one being fixed. |
| 14 | security | The reference field is a plain input an operator may paste a token into; autofill and form history outlive "cleared on close". | **Adopted.** `autoComplete="off"`, `spellCheck={false}`, controlled, cleared on close. |
| 15 | performance | `use-account-devices.ts` declared no `staleTime`, while `app-shell.tsx` keys the routed subtree on `location.pathname` so the detail screen remounts on every navigation back. | **Adopted.** A short window, stated in the hook with the reasoning `use-accounts.ts` established. |
| 16 | senior | The mutation list named a `>`/`>=` comparison no proposed signature contains. | **Adopted.** Re-derived from the final signatures; nine mutations, each named. |

### Adopted as records rather than as changes

| # | Lens | Finding | Answer |
|---|---|---|---|
| 17 | senior | `createAccountPayloadFrom` re-implements `clean()` from `@/api/request`. | **Declined, with the reason recorded.** `clean()` returns `Record<string, unknown>`, so passing its result to `createAccount` needs a cast that discards the typed payload; it does not trim; and the header of `src/api/accounts.ts` states at length that this helper is deliberately used **nowhere** in that area, because one endpoint over it turns "unblock this device" into an empty body. Reaching for it from a dialog re-introduces exactly what that module refuses. |
| 18 | senior | `deleteRequestFor` is a one-liner whose test asserts a ternary, and the union already makes an under-filled request a compile error. | **Kept, for the security lens's reason.** Under the revised signature it is not a ternary over a number but the conversion of *the list that was just read* into a request. That is the `AC-14` guarantee expressed as a type, which is more than the union gives. |
| 19 | senior | `createRejection`'s "400 → the server's own message" arm is behaviourally identical to the `null` fall-through and cannot be expressed by the return type. | **Correct as written, and the security lens is why it now exists.** The arm is real once `redacted` is a third outcome, so the return type became a discriminated union rather than the arm being deleted. |
| 20 | security | `listAccountDevices` answers `[]` for an envelope with no `results`, turning a missing read into the defaulted zero `REQ-11` forbids. | **Recorded, not defended against.** The defaulted zero is **inert**: an account owning devices answers `409 ACCOUNT_DEVICE_COUNT_MISMATCH` and purges nothing; an account owning none has nothing to lose. A wrong-**low** count cannot over-purge. Changing it would mean editing `src/api/accounts.ts`, which `C-1` places out of scope. |
| 21 | security | Both `409` notices assert nothing was purged; a future `409` raised mid-cascade would render a false all-clear. | **Recorded in the module comment**, so the sentence is findable the day the server adds one. Every `409` the reference documents today is raised before the cascade begins. |
| 22 | senior | `accounts-list.tsx` has one caller, holds no state, and takes its booleans as props. | **Adopted.** It stays a component inside `src/pages/accounts.tsx`. |
| 23 | senior | Step 9's `AdminRejection` widening and step 1 must land in the same edit or typecheck fails. | **Recorded in the steps.** |
| 24 | performance | `confirmationMatches` runs per keystroke; lifting that state into the page would re-render every row. | **Adopted** — it is the same fix as finding 1, and the state stays inside the dialog. |
| 25–30 | all three | The submission path is two sequential round trips and that is correct; the list is unbounded by design because `GET /accounts` has no pagination; nothing touches `src/lib/ws.ts`, an interceptor, a `refetchInterval` or a timer; no new dependency is required; no deployment runtime file is touched; the `console.*` ban already closes the logging channel for the reference; permission gating is correctly framed as an affordance. | **Accepted with no change.** Recorded so the next reader knows they were examined rather than missed. |
