---
ticket: z8pmx9mf1a
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1a"
  github: ""
---

# Plan — 10 · Build the users administration surface

> **Revision 2.** Revision 1 was submitted to the advisory panel before any code
> was written. The panel returned 28 findings across three lenses; every one is
> answered in `Panel response` at the foot of this file, and 17 of them changed
> the design above. The most consequential: `src/lib/auth-messages.ts` is now
> **not modified at all**, a password can reach the screen through the server's
> own rejection text and is redacted the way this repo already redacts two other
> credentials, and every operator-controlled string this surface renders is
> stripped of bidi overrides first.

## Approach

**The API layer already exists and is not touched.** `z8pmx9mf16` typed all six
`/auth/users` endpoints, wrote `omitUntouched` (the dirty-fields pruner this
ticket's whole edit path depends on), modelled `CreateUserPayload` as a union so
the both-or-neither body does not compile, and added `usersKey` to
`src/lib/query-keys.ts`. So does `src/lib/auth-messages.ts`, whose
`ADMIN_REJECTIONS` table already carries `privilege-escalation`,
`self-mutation`, `last-administrator`, `password-hashing-busy`, `already-taken`
and `not-found`. This ticket is **the screen and the decisions**, not the wire.

**Every decision goes into one new pure module, `src/lib/user-admin.ts`.** This
repository has no component renderer in its test environment, so a decision
written inside JSX is a decision no test can reach. That is the established
shape: `@/lib/surfaces` (mf17), `@/lib/account-lifecycle` (mf18),
`@/lib/account-devices` + `@/lib/device-webhook` (mf19). This ticket is the one
where a wrong decision signs a customer's operators out, so it follows the same
shape rather than inventing one.

**`src/lib/auth-messages.ts` is not modified.** Revision 1 proposed amending the
`already-taken` and `not-found` descriptions so a `409`/`404` could name what
collided. The panel showed that is wrong three times over: `not-found` is
already consumed by `account-lifecycle.ts` for the account-delete `404`, where a
"what you sent" sentence would render as a dangling promise; `auth-messages.test.ts`
pins both descriptions to specific phrases (`does not say which`, `the same way
for both`) and that file was not in the change list; and the table's whole
discipline is that it *says what the wire says*. So the table stays byte-identical
and **the detail is concatenated by the call site**, exactly as
`account-devices-panel.tsx` already concatenates `title` + `description`.

**The detail names what this client sent, never what the server holds.** The
ticket asks that a `409` name which value collided and a `404` name which thing
was missing. The server deliberately joins three causes into one of each, to
withhold an enumeration oracle. The resolution is that `collisionDetail` and
`notFoundDetail` take **the submitted payload as their sole argument** and echo
it back: the operator typed those values a second ago, so this adds zero bits to
what they already know, while still telling them which fields to change. Neither
function may read the loaded page — a "helpful" scan of `users.data` for a
matching username would both split what the server joined *and* be wrong on a
partial page, which is REQ-3's whole point. A source rule enforces that
`user-admin.ts` never names `getQueryData`/`getQueriesData`.

**A password can reach the screen through the server's own text, and is
redacted.** `toActionErrorMessage` renders `apiError.message` verbatim for any
non-`403`, so a `400` from `POST /auth/users` or `POST /auth/users/{id}/password`
that quotes the value it rejected prints a credential inside the dialog that is
still holding it. This repo has solved exactly this twice — `createFailure` /
`CREATE_FAILED_REDACTED` for `meta_token_ref`, `webhookSaveFailure` /
`WEBHOOK_SAVE_FAILED_REDACTED` for the webhook signing secret, both enforced by
source rules. `passwordFailure` / `PASSWORD_FAILED_REDACTED` is the third
instance of that shape, and the two password-carrying dialogs are asserted never
to reach `toActionErrorMessage` themselves.

**Every operator-controlled string is stripped before it is rendered.**
`accountName` strips `\p{Cc}\p{Cf}` and caps at 60 because "a name carrying one
of those can reorder what is rendered around it". Usernames, emails and
free-text role ids are the same class of text — and this surface closes the loop
itself: `usernameError` is deliberately permissive after the first character, so
a `U+202E`-bearing username is creatable *through this very form* and would then
be reordered into the sentence authorising a delete. React escapes HTML; it does
not neutralise bidi. So the strip-and-cap is exported from `@/lib/surfaces` as
`displayText(value, max)` — one regex, one owner, the module that already
normalises in five places — `accountName` is rewritten onto it with no change in
behaviour, and every username, email and role id on this surface goes through
it. The raw `user_id` is rendered beside the name through `IdText` in both
destructive confirmations, because that is already this repo's stated answer to
a homoglyph: it cannot be sanitised into honesty, but it can be shown next to an
id the operator can compare.

**The surface is one component used twice.** `/users` renders it unfiltered; the
account detail screen renders it with `accountId` fixed, which introduces the
`Tabs` shell that `account-detail.tsx`'s own comment defers to this ticket. The
account filter is applied **within the loaded page** — `GET /auth/users` takes no
`account_id` (study §14 `Q-3`) — and the panel says so on screen whenever a
filter is active.

**No new session code.** A self-edit ending your own session is `z8pmx9md70`'s
existing path: the `401` triggers one refresh attempt, it fails against the new
epoch, the session is cleared and `refusalReason` derives `permissions-changed`,
which `SIGN_OUT_NOTICES` already renders. This ticket adds the *warning before*
it and nothing else, enforced by a source rule copying the four-name pattern
already used for the permission-denied surface.

## Steps

### 1 — The shared display sanitiser (`src/lib/surfaces.ts`)

Export the strip-and-cap that `accountName` already performs:

```ts
export function displayText(value: string | null | undefined, max: number): string
```

`accountName` is rewritten to call it. Behaviour is byte-identical — the same
`CONTROL_OR_FORMAT` regex, the same trim, the same `…` cap — so
`surfaces.test.ts` passes unchanged. This is the only reason `surfaces.ts` is in
the change list: a second copy of that regex in `user-admin.ts` is the
divergence this module exists to prevent.

### 2 — The decisions (`src/lib/user-admin.ts`, new)

Pure: no store, no React, no axios, no cache read.

```
PASSWORD_MIN_BYTES = 8
PASSWORD_MAX_BYTES = 72
USERNAME_MIN = 2 / USERNAME_MAX = 64
MAX_DISPLAY = 60
SEEDED_ROLES = ['user', 'admin', 'super_admin']   // display only
DEFAULT_PAGE_SIZE = 100 / MAX_PAGE_SIZE = 500
PASSWORD_FAILED_REDACTED = '…'

passwordByteLength(value) / passwordError(value)
normaliseUsername(value) / usernameError(value) / emailError(value)
createUserPayloadFrom(fields): CreateUserPayload | null
updatePayloadFrom(original, edited): UpdateUserPayload
isEmptyUpdate(payload) / mayRemoveAdministration(payload)
userRejection(error, operation, context): AdminRejection | null
passwordFailure(error): 'server' | 'redacted'
collisionDetail(submitted) / notFoundDetail(submitted)
isSelf(userId, signedInUserId)
filterByAccount(users, accountId)
pageState(rowCount, limit, offset): { canNext, canPrevious, nextOffset, previousOffset }
```

Notes that matter:

- `passwordByteLength` is `ENCODER.encode(value).length` over **one
  module-level `TextEncoder`** — the counter runs per keystroke. `TextEncoder`
  is not in the source policy's decode ban (`TextDecoder` is; that rule is about
  taking a JWT apart), so this is a legal encode. The study calls the character
  count out as "an error that will certainly happen in an Arabic deployment".
- `usernameError` enforces 2..64 characters, first character a letter or digit,
  `@` admitted, deliberately permissive after that — being stricter than the
  server rejects input the server would have taken. It is *not* a bidi guard;
  `displayText` at every render site is.
- `createUserPayloadFrom` returns `null` when the account arm is unresolved,
  which is what makes "both or neither" unable to produce a request at all.
  `email` and `roles` are omitted when empty — an omitted `roles` is how the
  server's own least-privileged default is obtained.
- `updatePayloadFrom` emits only what differs. `account_id` is emitted only when
  non-empty **and** different, so an empty account id cannot be produced by any
  path. `roles` is compared as a set and emitted **complete** when it differs.
- `userRejection(error, operation, { targetIsSelf, mayCollide, mayRemoveAdmin })`.
  The caller knows which request it just made; `ADMIN_REJECTIONS` has no
  classifier on purpose. `403` → `self-mutation` when the target is you and the
  operation is a delete or a disable, `privilege-escalation` otherwise. `409` →
  `last-administrator` when the request could remove administration, else
  `already-taken`; **the caller appends `collisionDetail` on any `409` whose
  payload could collide**, so an ambiguous one carries both readings rather than
  the client picking between two the server refused to distinguish. `503` →
  `password-hashing-busy`. `404` → `not-found`. Anything else → `null`.
- `passwordFailure` is `createFailure`'s shape: `status >= 400` → `redacted`.
  A `status: 0` keeps its text — there is no response to have echoed anything.
- `collisionDetail` / `notFoundDetail` take the **submitted payload only** and
  run every value through `displayText` before interpolating it.
- `pageState` returns four fields, not five: `full` is the input `canNext` is
  derived from, and exposing both invites a caller to branch on the wrong one.

`src/lib/user-admin.test.ts` covers TC-1..TC-18.

### 3 — The users query (`src/hooks/use-users.ts`, new)

`useQuery({ queryKey: usersKey(page), queryFn: () => listUsers(page), enabled:
authenticated && mayManageUsers, staleTime: 30_000, placeholderData:
keepPreviousData })`.

- Gated on `PERMISSIONS.USERS_MANAGE` — the permission that makes the request
  legal — so the surface never manufactures a `403`.
- `staleTime: 30_000` for the reason `use-account-devices.ts` records:
  `app-shell.tsx` keys the routed subtree on `location.pathname`, so the screen
  remounts on every navigation back to it and the client default is `0`.
- `placeholderData: keepPreviousData` so paging does not blank the table
  (precedent: `chat-list.tsx`, `message-view.tsx`).
- **100 is the only page size the UI ever asks for.** `MAX_PAGE_SIZE` is the
  clamp and nothing else; there is no size selector, because 500 rows × a
  four-action row set is ~4–5k DOM nodes with no windowing anywhere in this
  stack, and adding a virtualiser would inline it into the single-file bundle.

### 4 — The panel (`src/features/user-admin/users-panel.tsx`, new)

The one component both surfaces render. It owns page state, the account filter,
and **one instance each** of the create, edit and reset dialogs plus the delete
`AlertDialog` inline — driven by which row was chosen.

Memoisation is not decoration here; it is what makes the one-dialog-per-screen
pattern cheap, and revision 1 took the pattern without it:

- `filterByAccount` and `pageState` are `useMemo`d.
- The four row action handlers are `useCallback`ed.
- The account **name lookup is a `Map` built once** with `useMemo` over
  `useAccounts().data` — `accountName`'s linear `find` plus a regex pass, run per
  row over 100 rows, is a scan and 100 regex passes on every re-render.
  `accounts.tsx` gets away with calling it per row only because it has one row
  per account.
- Rows are a separate `React.memo` component (step 5).

Other decisions:

- Permission booleans hoisted **once**: `USERS_MANAGE` only.
  `USERS_MANAGE_ALL` is **not** hoisted — revision 1 hoisted it and named no
  control behind it. `GET /accounts` is already scoped by the server, so the
  select needs no client gate; an unused permission boolean reads like a control
  and is not one.
- The signed-in `user_id` is read once through a **primitive selector**, so the
  snapshot survives an unrelated store write.
- Columns (REQ-4): username, email, account, status, roles, `token_epoch`,
  created. No permissions column, ever — there is no source for it.
- Delete and disable are **absent from the signed-in user's own row**.
- Paging: "Newer / Older" from `pageState`, **both disabled while
  `isPlaceholderData || isFetching`**, and the "showing N rows" line derived
  from the rows actually rendered rather than from `offset` — with
  `keepPreviousData` and no `total`, an offset-derived range mislabels the rows
  on screen while a page is in flight.
- The account filter renders only when the accounts list is available.
  `useAccounts()` is gated on `accounts.manage`, so a `users.manage` holder
  without it would otherwise get an empty select; that principal sees accounts
  by id and a line saying so.

### 5 — The row (`src/features/user-admin/user-row.tsx`, new)

A `React.memo` row taking already-resolved props — the sanitised username and
email, the resolved account label, the permission booleans, and the four
callbacks. It mounts no dialog and opens no store subscription, the rule
`source-policy.test.ts` already enforces for the account device row.

### 6 — Creating (`src/features/user-admin/create-user-dialog.tsx`, new)

- A radio with exactly two arms — "Add to an existing account" (a select over
  `useAccounts()`) and "Create a new account for this user" (id + name). Submit
  is disabled until one arm resolves, and `createUserPayloadFrom` returns `null`
  rather than a body if it somehow does not.
- Choosing the second arm re-titles the submit "Create customer" and says in one
  sentence that the account and its first user are created together, atomically.
- Password: `type="password"`, `autoComplete="new-password"`, validated live by
  `passwordError`, with the **byte** count beside the field (`58 / 72 bytes`).
- Username: `normaliseUsername` on change, so the field lower-cases as it is
  typed, with a note saying the username is stored lower-cased.
- Roles: three checkboxes for the seeded ids plus a free-text field, with a
  sentence saying there is no endpoint that lists roles. Selecting none submits
  **no `roles` field**.
- Status: a select, `active` default, `disabled` offered.
- **Failure is classified before anything is rendered**: `passwordFailure(error)`
  decides whether the server's text may be shown at all, then `userRejection`
  picks the notice, then `collisionDetail`/`notFoundDetail` appends what was
  sent. This dialog never calls `toActionErrorMessage`.
- On success: invalidate the `['users']` prefix, and `accountsKey()` when the
  inline-account arm was used. The toast names the username, never the password.

### 7 — Editing (`src/features/user-admin/edit-user-dialog.tsx`, new)

- Fields: email, account, status, roles. No username (`PATCH` does not take
  one) and no password — that is the reset dialog's job, and mixing them would
  put a credential in a form that is otherwise a diff.
- The payload is `useMemo`d on `[original, edited]` and never placed raw in a
  dependency array.
- Submit is disabled while `isEmptyUpdate(payload)`, with a line saying nothing
  has changed yet.
- Submitting opens the **confirmation step in the same dialog**: the fields that
  will be written, then "This will sign *username* out of every device
  immediately. There is no grace period." — or, on your own row, "This will sign
  **you** out of this session immediately."
- `roles` is rendered as the complete final set ("roles → user, admin"), never
  as "added admin", so what is on screen is what is submitted.
- On success: invalidate `['users']` **only**. Revision 1 also invalidated
  `['devices']`; `devicesKey` is keyed on the *signed-in principal's* effective
  lens, not the edited user's account, so that was a guaranteed-spurious
  refetch.

### 8 — Resetting a password (`src/features/user-admin/reset-password-dialog.tsx`, new)

- Two fields, new password and confirm, both `type="password"`
  `autoComplete="new-password"`, on a `<form autoComplete="off">`. The target's
  username is rendered as **text, never as an `<input>`**: an administrative
  reset types a credential for a *different* principal into a form on the
  admin's own origin, and a username field beside it is what makes a password
  manager offer to overwrite the administrator's own saved credential.
- The same `passwordError` and byte counter.
- Says why there is no current-password field, and that this revokes every
  session **and** every refresh-token family.
- The target's `user_id` is shown through `IdText`.
- Routed through `passwordFailure` first, like the create dialog. A `503` is
  `password-hashing-busy` — "nothing was changed" — never a rejection of input.
- The password lives in this component's state, is cleared on close, and reaches
  no toast, no query key, no log.

### 9 — Deleting (inline in `users-panel.tsx`)

An `AlertDialog` naming the sanitised username **and the raw `user_id` through
`IdText`**, stating that every session and refresh family goes with it. No typed
confirmation: `delete-account-dialog.tsx` earns one because an account delete
purges devices and destroys WhatsApp session keys, which re-pairing recovers only
with physical access to a phone; a user delete is recoverable. The id is what
guards the *identification* — `admin` and `аdmin` (Cyrillic а) are one click
apart — which is the same answer `surfaces.ts` already gives to a homoglyph.

Inline rather than its own file because that is what the shape earns:
`account-devices-panel.tsx` owns exactly this shape inline; the separate
`delete-account-dialog.tsx` earns its file through a two-step typed confirmation
and a live count.

### 10 — Wiring

- `src/pages/users.tsx` — placeholder → `<PageHeader/><UsersPanel/>`. The route
  and its guard in `App.tsx` are **not** touched.
- `src/pages/account-detail.tsx` — the two-tab shell its own comment defers
  here: **Devices** and **Users** (`<UsersPanel accountId={accountId}/>`,
  mounted only for a `users.manage` holder). **No `forceMount`** — otherwise
  every visit to an account fires a `GET /auth/users` for a tab nobody opened.
  Radix unmounts inactive content, so `AccountDevicesPanel` refetches on tab
  switch; that is bounded by its existing `staleTime: 30_000` and is expected,
  not a regression.

### 11 — Executable rules (`src/lib/source-policy.test.ts`)

The exemption lists are enumerated in full — the panel showed revision 1's were
short by four files, and four unplanned allowlist entries added under time
pressure is exactly what AC-14/NFR-2 forbid:

- `password` rule (a case-insensitive **substring** over the whole file) gains
  `src/lib/user-admin.ts`, `src/features/user-admin/users-panel.tsx`,
  `create-user-dialog.tsx` and `reset-password-dialog.tsx`.
- `role`/`roles` rule gains `src/lib/user-admin.ts`,
  `src/features/user-admin/users-panel.tsx`, `user-row.tsx`,
  `create-user-dialog.tsx` and `edit-user-dialog.tsx`.

The narrowing counter-rules are scoped to **every file the exemption admits**,
not to two named ones. Revision 1's proposed *counting* rule is dropped: it
copied the `src/api/users.ts` treatment, which works only because that file
declares and never reads, whereas `user-admin.ts` must legitimately read `roles`
about ten times. Declarations would be 0 and the assertion could never hold.
What replaces it asserts the property that actually matters:

1. **No role value is compared against a string literal** anywhere in the
   surface — `/\broles?\b[^\n]*(===|!==|==|!=)\s*['"\`]/` — which is the
   role-as-authority shape. The existing bracket-access rule already covers
   `ROLE_CAPS[user.role]`.
2. **No password reaches a toast, a template literal or a query key** in the two
   dialogs that hold one, and **neither calls `toActionErrorMessage`** — they
   use `passwordFailure` and `PASSWORD_FAILED_REDACTED`, mirroring the existing
   `meta_token_ref` and webhook-secret rules.
3. **`user-admin.ts` names no `getQueryData`/`getQueriesData`**, so the detail
   builders cannot become cache readers.
4. **No file under `src/features/user-admin/` ends a session** —
   `/\bsignOut\b|\bendRefusedSession\b|\brefreshSession\b|\bNavigate\b/`, the
   four-name pattern already used for the permission-denied surface. Revision 1
   banned three names, two of which are already banned repo-wide, and missed the
   two a self-edit handler would actually reach for.
5. **No raw `.username` / `.email` / role value inside a template literal** in
   the surface — every one goes through `displayText` first.

Rules revision 1 proposed that are dropped as redundant: web storage is already
banned outside three named stores, `console` is already banned across all of
`src/`, and `clearSession(`/`endSession(` are already banned outside
`stores/auth.ts`.

### 12 — Validation

`npm run typecheck && npm run lint && npm test && npm run build`, plus a manual
pass recorded in `verify.md`.

## Files to change

**New (8)**

| Path | Why |
|------|-----|
| `src/lib/user-admin.ts` | Every decision, pure and testable (NFR-1). |
| `src/lib/user-admin.test.ts` | TC-1..TC-18. |
| `src/hooks/use-users.ts` | The paged list query, gated on `users.manage`. |
| `src/features/user-admin/users-panel.tsx` | The surface, rendered by both screens; owns the delete confirmation inline. |
| `src/features/user-admin/user-row.tsx` | The memoised row (perf). |
| `src/features/user-admin/create-user-dialog.tsx` | REQ-9..REQ-16. |
| `src/features/user-admin/edit-user-dialog.tsx` | REQ-20..REQ-25. |
| `src/features/user-admin/reset-password-dialog.tsx` | REQ-26..REQ-29. |

**Modified (4)**

| Path | Change |
|------|--------|
| `src/pages/users.tsx` | Placeholder → the panel. |
| `src/pages/account-detail.tsx` | The two-tab shell its own comment defers here. |
| `src/lib/surfaces.ts` | Export `displayText`; `accountName` rewritten onto it, behaviour identical. |
| `src/lib/source-policy.test.ts` | The enumerated exemptions and the five new rules of step 11. |

**Not touched:** `src/lib/auth-messages.ts`, `src/api/users.ts`,
`src/lib/query-keys.ts`, `src/App.tsx`, and every deployment runtime file
(`vite.config.ts`, `package.json`, `index.html`, `.github/workflows/*`).

## Validation strategy

- `npm run typecheck` — the `CreateUserPayload` union is the compile-time half
  of AC-6.
- `npm test` — `user-admin.test.ts` for TC-1..TC-18, `source-policy.test.ts` for
  TC-19, `auth-messages.test.ts` and `surfaces.test.ts` unchanged and passing,
  which is the evidence that neither shared module's behaviour moved.
- `npm run lint`, `npm run build`.
- Manual: create a user into an existing account; create a customer in one
  submission; edit only status and confirm one key on the wire; attempt an empty
  save; reset a password; confirm delete and disable are absent from your own
  row.

## Rollback

Every new file is additive. The four modifications are diffs against files that
already worked, and two of them (`surfaces.ts`, `source-policy.test.ts`) are
behaviour-preserving by construction — the existing tests for both pass
unchanged. Reverting the single commit restores the placeholder `/users` page
and the untabbed account detail screen. No data is migrated, no key shape
changes, no stored state is written.

## Out of scope

- `GET /auth/roles`, an `account_id` filter, a `total` — study §14 `Q-2`/`Q-3`,
  worked with rather than around.
- Routing and navigation (`z8pmx9mf17`); the account settings tab (11); the
  account devices tab (`z8pmx9mf19`).
- Any new session-handling code (C-5).
- **Hiding the `super_admin` checkbox from an `admin`.** An `admin` who ticks it
  gets a `403 privilege-escalation` from the server. Leaving that is deliberate
  (NFR-5: hiding is an affordance, the server is the authority) — and the
  tempting fix is to hide the box when the signed-in user's own *role* is not
  `super_admin`, which is precisely the role-as-authority read this whole ticket
  is built to prevent. Recorded here so nobody closes it later by reading a role
  name.

## Panel response

The three advisory lenses reviewed revision 1 before any code was written, at
the owner's instruction. 28 findings; every one is answered. **17 changed the
design**, 4 were made moot by another change, 3 changed `spec.md`, and 4 were
verifications recorded for `/verify`. Three findings were raised independently
by two lenses (the unsatisfiable counting rule, the under-enumerated exemption
lists, and the memoisation gap), which is what promoted them from "reasonable"
to "certain".

### Senior lens — system fit and scope

| # | Finding | Answer |
|---|---------|--------|
| S1 | major — the `password` exemption list is short by two files and `npm test` would fail. | **Accepted.** All four files enumerated in step 11. |
| S2 | major — the proposed `roles` counting rule is unsatisfiable: `user-admin.ts` declares nothing and must read `roles` ~10 times, so declarations = 0 and mentions ≈ 10. | **Accepted; rule dropped.** Replaced by the literal-comparison rule (step 11.1), which asserts the property that actually matters. Raised independently by the security lens (SEC5). |
| S3 | major — the `roles` exemption list omits `users-panel.tsx`, which AC-4 requires to name the field. | **Accepted.** Five files enumerated. |
| S4 | major — the plan contradicts itself three ways on `auth-messages.ts`. | **Accepted.** Resolved in the direction the paragraph's own reasoning pointed: the table is untouched and the detail is concatenated at the call site. |
| S5 | major — editing the shared `already-taken`/`not-found` descriptions breaks pinned tests and leaves a dangling promise on the account-delete surface. | **Accepted; verified independently** (`account-lifecycle.ts:282` consumes `not-found`; `auth-messages.test.ts` pins both phrasings). `auth-messages.ts` dropped from the change list entirely. |
| S6 | minor — two of three proposed source rules are ~75% redundant with existing ones. | **Accepted.** The redundant halves are dropped; step 11 lists only what is new. |
| S7 | minor — invalidating `['devices']` after an edit is guaranteed-spurious: the key is on the signed-in principal's lens, not the edited user's account. | **Accepted.** Dropped; `['users']` only. |
| S8 | minor — the account filter renders as an empty select for a `users.manage` holder without `accounts.manage`. | **Accepted.** The filter renders only when the list is available; that principal sees ids and a line saying so. |
| S9 | minor — `delete-user-dialog.tsx` is a file for a shape the cited precedent keeps inline. | **Accepted.** Folded into the panel. (The file count is still 8 because the panel's *own* finding P1 extracts `user-row.tsx`; the delete file is gone.) |
| S10 | nit — `pageState` returns five fields where three are needed. | **Accepted.** Four fields; `full` is not exposed. |
| S11 | info — Radix `Tabs` unmounts inactive content, so the devices panel refetches on tab switch. | **Recorded** in step 10 so `/verify` does not read it as a regression. |

### Security lens — credentials, authorization, blast radius

| # | Finding | Answer |
|---|---------|--------|
| SEC1 | major — a password can reach a rendered message: `toActionErrorMessage` prints server text verbatim, and both password dialogs render failures inline while still holding the value. The proposed rule cannot see this path. | **Accepted — the most valuable finding of the review.** `passwordFailure` + `PASSWORD_FAILED_REDACTED` added (the third instance of the `createFailure` / `webhookSaveFailure` shape), both dialogs routed through it, and a source rule asserts neither calls `toActionErrorMessage`. New `AC-31`. |
| SEC2 | major — raw `username`, `email` and free-text role ids are rendered in the table *and inside destructive confirmations*, with none of `accountName`'s bidi treatment — and this form creates such usernames itself. | **Accepted.** `displayText(value, max)` exported from `@/lib/surfaces` (one regex, one owner), `accountName` rewritten onto it, applied at every render site and inside both detail builders. Source rule 11.5. New `AC-32`. |
| SEC3 | major — the delete confirmation identifies the target by a label the operator cannot verify; `admin` vs `аdmin` is one click apart and a recreated user gets a new `user_id`. | **Accepted.** The raw `user_id` is rendered through `IdText` in both the delete and the reset confirmations — one line, and it removes the argument for a typed confirmation. New `AC-33`. |
| SEC4 | major — the exemption lists are under-enumerated and the counter-rule is scoped to two named files, so widening the allowlist would widen what is allowed. | **Accepted.** Six files enumerated; every counter-rule scoped to `src/lib/user-admin.ts` plus all of `src/features/user-admin/`. |
| SEC5 | major — the counting rule is not implementable, and its fallback is the bare exemption AC-14 forbids. | **Accepted.** Same as S2. |
| SEC6 | minor — the reset dialog specifies no `type`/`autoComplete`, so a password manager offers to overwrite the *administrator's own* saved credential with the victim's new one. | **Accepted.** `type="password"` + `autoComplete="new-password"` on both fields, `autoComplete="off"` on the form, and the target's username rendered as text rather than as an `<input>`. |
| SEC7 | minor — nothing stops an implementer making `collisionDetail` infer which field collided from the loaded page, which both splits what the server joined and is wrong on a partial page. | **Accepted.** Both builders take the submitted payload as their sole argument, and source rule 11.3 bans `getQueryData`/`getQueriesData` from `user-admin.ts` — the provenance template `delete-account-dialog.tsx` already uses. |
| SEC8 | minor — `USERS_MANAGE_ALL` is hoisted and gates nothing; an unused permission boolean reads like a control. | **Accepted.** Dropped. `GET /accounts` is already server-scoped, so the select needs no client gate. |
| SEC9 | minor — the `super_admin` checkbox is offered to every `users.manage` holder, and the tidy fix violates NFR-2. | **Accepted as a deliberate non-fix**, recorded under Out of scope so nobody closes it later by reading a role name. |
| SEC10 | nit — the session-teardown rule should copy the existing four-name pattern; the proposed three miss `endRefusedSession` and `refreshSession`. | **Accepted.** Pattern copied verbatim. |
| — | Verified: no runtime file touched, no new dependency, the self-edit path is genuinely existing behaviour, no password in a query key, the cURL renderer is off this path, the cache is torn down with the session. | **Recorded** as evidence for `/verify`. |

### Performance lens — render cost, fan-out, bundle

| # | Finding | Answer |
|---|---------|--------|
| P1 | major — the plan takes mf19's one-dialog-per-screen pattern but drops the memoisation half that makes it cheap, so the whole table re-renders on every dialog open, filter and pager change. | **Accepted.** `user-row.tsx` extracted as a `React.memo` row; the filter, the page state and the four handlers memoised. Raised in substance by the senior lens too (file-shape). |
| P2 | major — `accountName` per row is an O(accounts) `find` plus a regex pass per call. | **Accepted.** A `Map` built once with `useMemo`; the row receives a resolved label. |
| P3 | major — `keepPreviousData` plus an offset-derived `pageState` mislabels the rows on screen while a page is in flight, and `chat-list.tsx` avoids this only because it has a `total`, which REQ-2 forbids. | **Accepted.** Both pager buttons disabled while `isPlaceholderData || isFetching`, and the count line derived from the rendered rows. |
| P4 | minor — `MAX_PAGE_SIZE = 500` is either dead or lets the UI render ~5k DOM nodes with no windowing. | **Accepted.** 100 is the only size the UI asks for; `MAX_PAGE_SIZE` is documented as the clamp and nothing else. No size selector. |
| P5 | minor — a payload recomputed every render is a fresh identity and an infinite-loop shape in a dependency array. | **Accepted.** `useMemo` on `[original, edited]`, never raw in a dependency array. |
| P6 | minor — prefix-invalidating `['users']` leaves several cached page arrays under the default `gcTime`. | **Acknowledged, not changed.** Correct as-is in v5 (only the mounted query refetches), and the pages are 100 rows, not 500 (P4). Adding a `gcTime` for a bounded cost the senior lens would rightly read as tuning-without-a-number. |
| P7 | nit — `new TextEncoder()` per call, on a counter that runs per keystroke. | **Accepted.** One module-level encoder. |
| P8 | info — no bundle cost; all primitives exist and `Tabs` is already used by three surfaces. Do not pass `forceMount`. | **Accepted.** Step 10 states no `forceMount`, with the reason. |
| P9 | info — verified stable query-key hashing, no per-row request, correct `staleTime` reasoning, permission booleans hoisted per screen. | **Recorded** as evidence for `/verify`. |
