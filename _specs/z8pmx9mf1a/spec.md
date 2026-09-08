---
ticket: z8pmx9mf1a
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1a"
  github: ""
---

# Specification — 10 · Build the users administration surface

## Business goal

Granting and revoking access to this deployment is currently an environment
variable that fires once at boot. Phase 1 replaced the shared basic-auth
credential with a real identity (`z8pmx9md6z`) and a typed permission layer
(`z8pmx9md71`); phase 2 gave those identities an account to live in
(`z8pmx9mf16`, `z8pmx9mf18`). What is still missing is the operation that
*creates* one: there is no way, from the product, to add a customer's operator,
disable a departing one, or reset a forgotten password.

This ticket is the surface that closes that. It is the most delicate one in the
phase — not because the endpoints are many (there are six, all already typed in
`src/api/users.ts`), but because **the semantics of the fields are not
obvious**, and every one of the non-obvious ones is destructive when it is got
wrong:

- an **absent** field and an **empty** field are different instructions, and
  `account_id: ""` is an attempt to leave a user able to address no device;
- every non-empty change **bumps `token_epoch`** and rejects every access and
  refresh token that user holds, with no grace window;
- `roles` **replaces** the set rather than merging into it, so a partial
  selection silently revokes the rest;
- the password limit is **72 bytes**, not 72 characters, so an Arabic password
  of 30 characters is over the limit while `value.length` says 30.

Each of those is a mistake that reaches a customer as "everyone was signed out"
or "the operator lost their permissions", and each is invisible from the outside
until it happens.

## User story

As **an Account Administrator**,
I want **to create, edit, disable and reset the users of an account**,
so that **granting and revoking access is a product operation with visible
consequences, rather than an environment variable that fires once**.

## Functional requirements

### The list

- **REQ-1** — `/users` lists identities from `GET /auth/users` with `limit`
  (default 100, capped at 500) and `offset`.
- **REQ-2** — The response is a **flat array with no total**. Paging is
  next/previous, decided by whether the page came back full — never a page
  count, which the API cannot support.
- **REQ-3** — There is **no `account_id` filter on this endpoint**. Narrowing to
  one account happens **within the loaded page**, and the screen states that
  limit plainly rather than presenting a partial answer as authoritative.
- **REQ-4** — Columns: username, email, account, status, roles, `token_epoch`,
  created.
- **REQ-5** — `token_epoch` is shown. It exists so an operator can *see* that a
  change cut the outstanding sessions rather than trust that it did.
- **REQ-6** — There is **no permissions column**. The effective union of a
  user's grants is what `GET /auth/me` answers and there is no source for it
  here; the most that may be shown is the role ids assigned.
- **REQ-7** — No response carries a password hash and the UI never asks for one.
- **REQ-8** — The users surface appears in two places over one implementation:
  the standalone `/users` route, and a users tab on the account detail screen
  narrowed to that account (within the loaded page, per REQ-3).

### Creating a user

- **REQ-9** — Exactly one of "add to an existing account" or "create a new
  account together with this user" — a radio, never both, never neither.
- **REQ-10** — Both together is a conflict and is refused; neither is refused as
  well. A user with a blank account can address no device, so that state must
  not exist even for a moment.
- **REQ-11** — Creating the user and the account in one request is presented as
  **one operation** — "create a customer" — not as two steps.
- **REQ-12** — `roles` defaults to the least privileged option when omitted.
- **REQ-13** — `status` may be `active` or `disabled`; creating a user disabled
  is legitimate and is offered.
- **REQ-14** — The password is validated as **8 to 72 bytes, not characters**,
  measured on the UTF-8 encoding.
- **REQ-15** — The username is 2 to 64 characters, starts with a letter or a
  digit, may contain `@` so an email address can be a login name, and is
  **stored lower-cased**. The form shows the lower-casing as it is typed, so it
  does not look as though the server altered the input.
- **REQ-16** — The email is optional, and unique when non-blank.

### Roles

- **REQ-17** — There is **no endpoint that lists the available roles** (study
  §14, `Q-2`). The form offers the three seeded ids and a free-text field for
  any other id an operator has composed without a redeploy.
- **REQ-18** — An unknown role answers `404`. The message names **the role value
  this client submitted** — a value the operator typed a second ago — and
  asserts nothing about what does or does not exist on the server.
- **REQ-19** — Roles are **assigned and displayed** here as values. No code
  anywhere decides a capability from a role name; that remains `permissions[]`,
  always.

### Editing a user

- **REQ-20** — Every field is optional and an **absent field is not written**.
  The payload carries only the fields the operator actually changed.
- **REQ-21** — An empty body is a `400`, not a no-op, so the save action stays
  disabled while nothing is dirty. The UI never produces an empty request.
- **REQ-22** — `account_id` is never sent empty: that is an attempt to leave the
  user able to address nothing, and it is refused.
- **REQ-23** — `roles` **replaces** the set rather than merging into it, so the
  multi-select submits the complete final set and never a delta.
- **REQ-24** — Every non-empty change bumps `token_epoch` and rejects every
  access and refresh token the user holds, with no fifteen-minute window. The
  confirmation says so **before** saving: "this will sign the user out of every
  device immediately".
- **REQ-25** — Editing your own account is confirmed with an explicit "this will
  sign **you** out of this session". **No new session code is written for it** —
  the existing layer (`z8pmx9md70`) already ends the session and shows the "your
  permissions were updated" notice.

### Password reset

- **REQ-26** — `POST /auth/users/{user_id}/password` carries **no current
  password field**. This is an administrative reset on somebody else's account,
  and asking an administrator for a value they legitimately do not know would be
  absurd.
- **REQ-27** — It bumps `token_epoch` **and** revokes every refresh-token family
  the user holds. The dialog states that.
- **REQ-28** — The same 8-to-72-byte validation applies (REQ-14).
- **REQ-29** — A `503` means password hashing is at capacity. The message says
  to retry shortly and does not present it as a rejection of the input.

### Rejections shown plainly

- **REQ-30** — **Privilege escalation** (`403`): granting or changing a
  permission the caller does not hold themselves — including resetting the
  password of a more privileged user, or deleting them. The message names that
  reason.
- **REQ-31** — **Self mutation** (`403`): you cannot delete or disable yourself.
  Changing your own roles is allowed, because it can only narrow. The delete and
  disable actions are **hidden on your own row** rather than left to be refused.
- **REQ-32** — **Last administrator** (`409`): the last user able to administer
  users cannot be disabled, deleted or stripped of that permission. The message
  explains why — there is no recovery from that state through the API.
- **REQ-33** — A `409` from a create or an edit names the values **this client
  submitted** that could have collided (username, email, inline account id) and
  states that the server does not say which. It never asserts that a particular
  value exists on the server.
- **REQ-34** — A `404` names **what this request addressed** — the user, the
  account or the role id it sent — and states that "does not exist" and "is not
  yours to see" are answered identically on purpose.

## Non-functional requirements

- **NFR-1** — Every decision on this surface is a **pure function in
  `src/lib/`**, tested. This repository has **no component renderer in its test
  environment**, so a decision written inside JSX is a decision no test can
  reach — and this is the ticket where a wrong decision signs a customer's
  operators out or revokes their access.
- **NFR-2** — **No role name is read for an authorization decision**, anywhere.
  Roles are displayed and assigned as values only. `src/lib/source-policy.test.ts`
  enforces this mechanically; the `src/api/users.ts` entry stays narrowed to
  *declaration only*.
- **NFR-3** — **No password value reaches storage, a log, a URL, a query key, a
  toast, or a rendered command.** The source policy's `password` rule is
  extended by exactly the files that hold one in form state, and no more.
- **NFR-4** — Permission booleans are hoisted **once per screen**, never per
  row: `<Can>` and the permission hooks are screen guards, not row guards
  (study §13 rule 3).
- **NFR-5** — Hiding a control is an **affordance, never enforcement**. The
  server is the only authority.
- **NFR-6** — The list is bounded by the page size the client asks for; no
  request is issued per row, and no row re-renders because an unrelated dialog
  opened.
- **NFR-7** — **Operator-controlled text is not trusted to render.** A username,
  an email or a free-text role id can carry a bidi override that reorders what
  is rendered around it — including the sentence authorising a delete — and this
  surface can create such a username itself. React escapes HTML; it does not
  neutralise bidi. Every such string is stripped and capped before it is
  rendered, and a raw id is shown beside it wherever the identification
  authorises something destructive. (Added at review; see `plan.md > Panel
  response`, SEC2/SEC3.)

## Constraints

- **C-1** — `src/api/users.ts` already types all six endpoints (`z8pmx9mf16`)
  and is **not changed** by this ticket. `usersKey` already exists in
  `src/lib/query-keys.ts`.
- **C-2** — No deployment runtime file is touched.
- **C-3** — `GET /auth/users` takes no `account_id` and returns no total. Both
  are worked *with*, never around.
- **C-4** — There is no roles endpoint. The three seeded ids plus a free-text
  field is the whole of what is available.
- **C-5** — Session teardown after a self-edit is **existing behaviour**
  (`z8pmx9md70` / `src/lib/session-refresh.ts`). This ticket adds a confirmation
  and no session code.

## Acceptance criteria

| ID | Criterion | Requirements |
|----|-----------|--------------|
| AC-1 | `/users` lists users from `GET /auth/users` with `limit`/`offset`; the default page is 100 and the client never asks for more than 500. | REQ-1 |
| AC-2 | Paging is next/previous decided by whether the page came back full. No page count and no total appear anywhere. | REQ-2 |
| AC-3 | Narrowing to one account filters **within the loaded page**, and the screen says so in words whenever a filter is active. | REQ-3, REQ-8 |
| AC-4 | The table shows username, email, account, status, roles, `token_epoch` and created — and no permissions column. | REQ-4, REQ-5, REQ-6 |
| AC-5 | No password hash is read, rendered or requested anywhere. | REQ-7 |
| AC-6 | The create form offers exactly one of "existing account" / "new account", and cannot submit both or neither. | REQ-9, REQ-10 |
| AC-7 | Creating a user with a new account is one submission of one request, described as creating a customer. | REQ-11 |
| AC-8 | Omitting roles submits no `roles` field, so the server applies its own least-privileged default. | REQ-12 |
| AC-9 | `status` is selectable at creation and `disabled` is offered. | REQ-13 |
| AC-10 | A password is rejected unless its **UTF-8 byte length** is 8..72. A 30-character Arabic password is rejected; an 8-character latin password is accepted. | REQ-14, REQ-28 |
| AC-11 | The username field lower-cases as it is typed and enforces 2..64 characters starting with a letter or digit, `@` admitted. | REQ-15 |
| AC-12 | Email is optional at creation and is submitted only when non-blank. | REQ-16 |
| AC-13 | The role field offers the three seeded ids and accepts a free-text id; a `404` after submitting one names the role value that was sent. | REQ-17, REQ-18, REQ-34 |
| AC-14 | No role name is read for a decision; `src/lib/source-policy.test.ts` passes with the users surface added, and `src/api/users.ts` still mentions `role`/`roles` only in its declarations. | REQ-19, NFR-2 |
| AC-15 | The edit payload contains only dirty fields. Changing status alone submits `{status}` and nothing else. | REQ-20 |
| AC-16 | The save action is disabled while nothing is dirty, so no empty `PATCH` is ever issued. | REQ-21 |
| AC-17 | `account_id` is never submitted as an empty string. | REQ-22 |
| AC-18 | The roles control submits the complete final set, never a delta. | REQ-23 |
| AC-19 | Saving any non-empty change is confirmed first with "this will sign the user out of every device immediately", and the refreshed row shows a higher `token_epoch`. | REQ-24 |
| AC-20 | Editing your own account is confirmed with a distinct "this will sign **you** out of this session", and no new session-handling code is added. | REQ-25, C-5 |
| AC-21 | The reset dialog asks for a new password only — there is no current-password field — and states that it revokes every session and refresh family. | REQ-26, REQ-27 |
| AC-22 | A `503` on a password operation is reported as the server being busy, with "nothing was changed", not as a rejection of the password. | REQ-29 |
| AC-23 | A `403` on a create, edit, delete or reset is reported as privilege escalation or self-mutation as appropriate, naming the reason. | REQ-30, REQ-31 |
| AC-24 | Delete and disable are **hidden on the signed-in user's own row**. | REQ-31, NFR-5 |
| AC-25 | A `409` on delete/disable/edit is reported as the last-administrator rejection, explaining that there is no recovery through the API. | REQ-32 |
| AC-26 | A `409` on create/edit names the values this client submitted and states the server does not say which collided. | REQ-33 |
| AC-27 | Every decision listed in NFR-1 lives in a pure module under `src/lib/` and is covered by unit tests: byte-length validation, dirty-fields-only payload, the empty-body guard, roles-replace, and each of the three special rejections. | NFR-1 |
| AC-28 | No password value reaches storage, a log, a URL, a query key or a toast; the source policy's credential rules pass unchanged apart from the narrowly justified new entries. | NFR-3 |
| AC-29 | Permission booleans are hoisted once per screen and no request is issued per row. | NFR-4, NFR-6 |
| AC-30 | `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass. | — |
| AC-31 | **No server-supplied text is rendered for a failed request that carried a password.** A `4xx` rejecting a create or a reset may quote the value it rejected, so the failure gets a fixed sentence instead. A transport failure (`status: 0`) keeps its text — there was no response to have echoed anything. | NFR-3 |
| AC-32 | Every operator-controlled string this surface renders — username, email, free-text role id — is stripped of Unicode control and format characters and length-capped before it reaches a rendered node or an interpolated sentence. | NFR-7 |
| AC-33 | Both destructive confirmations (delete, password reset) show the target's raw `user_id` beside its sanitised username. | NFR-7 |

## Test cases

| ID | Case | Covers |
|----|------|--------|
| TC-1 | A password of 30 Arabic characters is rejected as exceeding 72 bytes; an 8-character latin password is accepted; 7 characters is rejected. | AC-10 |
| TC-2 | An edit form with nothing changed produces a payload of `{}` and the guard reports it as not submittable. | AC-15, AC-16 |
| TC-3 | Changing only status from active to disabled produces `{status: 'disabled'}` — `account_id`, `email` and `roles` are absent from the JSON. | AC-15, AC-17 |
| TC-4 | Unchecking one of two roles produces the complete remaining set, not a delta. | AC-18 |
| TC-5 | Selecting the same account the user already has produces no `account_id` in the payload; an empty account id can never be produced. | AC-17 |
| TC-6 | A `403` on a delete of the signed-in user maps to `self-mutation`; a `403` on any other mutation maps to `privilege-escalation`. | AC-23 |
| TC-7 | A `409` on delete or disable maps to `last-administrator`; a `409` on create maps to the submitted-values notice. | AC-25, AC-26 |
| TC-8 | A `503` on create or reset maps to `password-hashing-busy`. | AC-22 |
| TC-9 | A `404` after submitting a free-text role names that role value; a `404` with no role submitted names the user or account addressed. | AC-13 |
| TC-10 | The create payload builder produces `account_id` xor `account`, and refuses to produce a body with both or neither. | AC-6, AC-7 |
| TC-11 | Omitting the role selection produces a payload with no `roles` key at all. | AC-8 |
| TC-12 | A username is lower-cased and validated: `A@b` → `a@b` accepted, `_x` rejected, one character rejected, 65 characters rejected. | AC-11 |
| TC-13 | Paging: a page returned full offers "next"; a short page does not; offset never goes below zero. | AC-2 |
| TC-14 | Filtering by account narrows within the loaded array and reports how many of the loaded rows matched. | AC-3 |
| TC-15 | The self-edit predicate is true only for the signed-in user's own `user_id`. | AC-20, AC-24 |
| TC-16 | A `4xx` on a create or a reset is classified `redacted`; a `status: 0` transport failure is classified `server` and keeps its text. | AC-31 |
| TC-17 | A username carrying `U+202E` is stripped before it is rendered; a 200-character username is capped; a blank one yields the empty string rather than `undefined`. | AC-32 |
| TC-18 | `accountName` still behaves byte-identically after being rewritten onto the shared sanitiser — `surfaces.test.ts` passes unchanged. | AC-32 |
| TC-19 | `src/lib/source-policy.test.ts` passes: no role is compared against a literal, no password reaches a toast/template/query key, neither password dialog calls `toActionErrorMessage`, `user-admin.ts` reads no query cache, and nothing under `src/features/user-admin/` ends a session. | AC-14, AC-28, AC-31 |
| TC-20 | `npm run typecheck && npm run lint && npm test && npm run build`. | AC-30 |

## Out of scope

- Navigation and route guarding — `z8pmx9mf17`, already done. `/users` is
  already routed behind `users.manage`.
- The account lifecycle (create/delete an account on its own) — `z8pmx9mf18`.
- The account devices tab — `z8pmx9mf19`.
- Any new session-handling code. A self-edit ending your own session is
  `z8pmx9md70`'s existing behaviour and is used as-is (C-5).
- Asking the backend for `GET /auth/roles`, an `account_id` filter or a `total`.
  Those are recorded as study §14 `Q-2` / `Q-3` and are worked with, not around.
