---
ticket: z8pmx9mf17
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf17"
  github: ""
---

# Specification — 7 · Derive navigation and the home surface from permissions

## Business goal

Three kinds of principal use this dashboard and today they all land on the same
screen: a device grid. A super administrator who runs the platform, an account
administrator who runs one customer, and an ordinary user who sends messages from
one phone are given identical navigation, and every administrative capability
phase 2 is building has nowhere to appear.

The backend already answers the question of who may do what. `GET /auth/me`
returns `permissions[]` — a flat list of compile-time constants — and ticket 5
turned that list into a typed layer with exactly one reader. What is missing is
the consumer: a first surface that is *derived* from that list rather than
guessed from a role name.

The distinction matters more than it looks. Permissions are compile-time
constants in the Go backend; **roles are rows in a database** an operator can
recompose without a redeploy (reference §04). A condition written against a role
name is a condition that will lie the first time somebody composes a fourth role.
This repository already enforces that mechanically — `src/lib/source-policy.test.ts`
fails the build when a shipped file so much as names the field — and the phase-2
study (§13) records that the users-administration surface will eventually collide
with that rule, because `roles[]` is a wire field the API sends and receives.

This ticket is where that collision is settled, once, and where the rule is
proven to hold on the first real decision path built on top of it.

There is a second, narrower goal, and it is the one an operator would name first:
**a super administrator must never be able to send a message from a customer's
account while believing they are in their own.** That is the worst operational
mistake this phase makes reachable, and the persistent account context bar is the
only thing standing in front of it.

## User story

As **a System Admin**,
I want **the navigation and the home screen to be derived from `permissions[]`**,
so that **a super administrator, an account administrator and an ordinary user
each land on the surface that belongs to them, without a single decision ever
being taken from a role name**.

## Functional requirements

- **REQ-1 — The home surface is a pure derivation.** A pure function maps a
  permission array onto one of three surfaces: `platform`, `account`, `device`.
  It takes the array as an argument, reads no store, and names no role.
- **REQ-2 — The global permission is evaluated first.** `accounts.manage.all`
  yields `platform`; failing that, `accounts.manage` yields `account`; failing
  both, `device`. Order is part of the requirement, because a holder of the
  global permission also holds the narrower one.
- **REQ-3 — `/` renders the derived surface.** The device grid that lives at `/`
  today becomes the `device` surface and is otherwise unchanged.
- **REQ-4 — The two administrative surfaces summarise, and link.** The
  `platform` surface summarises the accounts visible to the principal; the
  `account` surface summarises the principal's own account. Both link into the
  detail surfaces this ticket routes to.
- **REQ-5 — Navigation entries are gated on the surface permission, not the
  global one.** An **Accounts** entry appears with `accounts.manage`; a **Users**
  entry appears with `users.manage`.
- **REQ-6 — The account switcher is gated on the global permission.** It appears
  with `accounts.manage.all` and with nothing else, because that permission
  answers *may you leave your own account* and no other one does.
- **REQ-7 — An unavailable entry is absent, not disabled.** It is not in the
  DOM at all.
- **REQ-8 — Permission booleans are hoisted once per screen.** The `<Can>`
  wrapper is not used per row of a list; each instance opens its own store
  subscription.
- **REQ-9 — Three new routes exist** — `/accounts`, `/accounts/:accountId`,
  `/users` — behind the existing session guard.
- **REQ-10 — The account detail route writes its id into the account scope on
  entry**, so a shared link restores the context — but only for a principal
  permitted to hold that scope, and entering the principal's **own** account
  writes the implicit scope rather than an explicit id.
- **REQ-10a — A foreign account scope may be written only with
  `accounts.manage.all`**, whatever the origin of the write: the URL, the
  switcher, or anything a later ticket adds. Holding `accounts.manage` opens the
  accounts *surface*; it does not answer *may you leave your own account*.
- **REQ-11 — A route whose permission the principal lacks renders a
  "you do not have permission" surface.** Not a blank screen, not a redirect,
  and with no refresh attempt and no logout: a 403 is a permission rejection,
  not an identity rejection.
- **REQ-12 — The existing operational routes are unchanged.**
- **REQ-13 — A persistent account context bar names a foreign scope.** When the
  account scope is set to an account other than the principal's own, a bar names
  that account and offers a way back. It renders from the scope alone: a pending
  or failed account-name lookup never hides it, and the raw account id is shown
  beside the name so an operator-chosen name cannot impersonate another account.
- **REQ-14 — Leaving through the bar returns the scope to implicit and clears
  the device selection**, in one action.
- **REQ-15 — No new file decides anything from a role name.** Every decision
  reads `permissions[]`.
- **REQ-16 — The source-policy allowlist is widened only for a role as a value
  displayed or assigned**, never for a role as a source of authority, and every
  added file carries a written justification inside the test itself.
- **REQ-17 — The build-failing source policy passes.**

## Non-functional requirements

- **NFR-1 — Nothing an existing principal can do changes.** For a principal
  holding neither accounts permission, every screen, route and request is what it
  was before this ticket.
- **NFR-2 — No new store subscription per rendered row.** Every permission read
  added by this ticket is hoisted to the component that owns the screen or the
  shell.
- **NFR-3 — No selector may return a fresh array.** zustand v5 compares
  snapshots with `Object.is`; a selector building a new array every call is the
  documented render loop this repository already guards against with
  `NO_PERMISSIONS`.
- **NFR-4 — Hiding a control is an affordance, never enforcement.** Every new
  guard is a convenience over a server that guards itself with
  `Require(permission)` on every route.
- **NFR-5 — Server text is rendered as a text child, sanitised and capped.** An
  account name is operator-chosen text rendered inside the app's own chrome, so
  it reaches no `innerHTML` and no `href`, carries no Unicode control or format
  character (bidi overrides included), and is length-capped.
- **NFR-6 — Every pure decision added is covered by a colocated Vitest file.**
  This repository has no component renderer in its test environment, so a
  decision that can only be observed by mounting a tree is a decision that cannot
  be proven. Decisions therefore live in pure modules.

## Constraints

- **C-1 — No deployment runtime file is touched.** `vite.config.ts`,
  `package.json`, `index.html` and both CI workflows are out of bounds.
- **C-2 — `permissions` has exactly one reader.** `src/hooks/use-permissions.ts`
  is the only module that may read the field off the principal; the pure
  functions this ticket adds take the array as an argument.
- **C-3 — The account lens is a client-side lens.** There is no `X-Account-Id`
  header; nothing in `src/lib/` may import `src/stores/account.ts`.
- **C-4 — The test environment is node, with no DOM.** Assertions are made
  against pure functions and against source text, not against a rendered tree.
- **C-5 — The screens behind the three new routes are not this ticket's.**
  Tickets 8, 9 and 10 build them.

## Acceptance criteria

### The home surface

- **AC-1** — A pure function derives the home surface from the permission array
  alone and returns one of `platform`, `account`, `device`. (REQ-1)
- **AC-2** — `accounts.manage.all` yields `platform`; otherwise `accounts.manage`
  yields `account`; otherwise `device`. The global check is evaluated first.
  (REQ-2)
- **AC-3** — The function takes the permission array as an argument and does not
  read the store; the one-reader rule is preserved. (REQ-1, C-2)
- **AC-4** — `/` renders the surface the function returns, and the device grid
  that lives there today is the `device` surface, unchanged. (REQ-3)
- **AC-5** — The `platform` surface summarises the accounts and the `account`
  surface summarises the principal's own account; both link into the detail
  surfaces. (REQ-4)

### Navigation

- **AC-6** — An **Accounts** entry appears with `accounts.manage`, and is not
  gated on `accounts.manage.all`. (REQ-5)
- **AC-7** — A **Users** entry appears with `users.manage`. (REQ-5)
- **AC-8** — An account switcher in the header appears only with
  `accounts.manage.all`. (REQ-6)
- **AC-9** — An entry the principal cannot use is absent from the DOM, not
  rendered disabled. (REQ-7)
- **AC-10** — Permission booleans are hoisted once per screen, and `<Can>` is
  not used per row of a list. (REQ-8, NFR-2)

### Routes

- **AC-11** — `/accounts`, `/accounts/:accountId` and `/users` exist, all behind
  the existing session guard. (REQ-9)
- **AC-12** — `/accounts/:accountId` writes its id into the account scope on
  entry when the principal may hold that scope; the principal's own account is
  written as the implicit scope, and a route already scoped to its target writes
  nothing. (REQ-10)
- **AC-12a** — A principal without `accounts.manage.all` cannot acquire a foreign
  account scope from a URL: the detail route writes nothing and renders the
  permission-denied surface. (REQ-10a)
- **AC-13** — A route whose permission the principal lacks renders a "you do not
  have permission" surface, and triggers no refresh and no logout. (REQ-11)
- **AC-14** — The existing operational routes are unchanged. (REQ-12, NFR-1)

### Account context bar

- **AC-15** — When the scope is an account other than the principal's own, a
  persistent context bar names the account and offers a way back. (REQ-13)
- **AC-15a** — The bar renders from the scope alone. A pending or failed
  account-name lookup never hides it; the raw account id is always shown; and a
  name carrying control or format characters, or exceeding the cap, is sanitised
  before it is rendered. (REQ-13, NFR-5)
- **AC-16** — Leaving through the bar returns the scope to implicit and clears
  the device selection in the same action. (REQ-14)

### Role names stay out of decisions

- **AC-17** — No new file decides anything from `role` or `roles[]`; every
  decision reads `permissions[]`. (REQ-15)
- **AC-18** — The source-policy allowlist is widened only where a role is a value
  being displayed or assigned, never where it is a source of authority, and every
  added file carries a written justification inside the test itself. (REQ-16)
- **AC-19** — The build-failing source policy passes. (REQ-17)

### Testing

- **AC-20** — Tests cover the three surface outcomes, the `accounts.manage`
  versus `accounts.manage.all` distinction, an empty session, and a composed role
  whose name is unknown but which holds `accounts.manage`. (NFR-6)

## Test cases

| # | Case | Maps to |
|---|---|---|
| TC-1 | An account administrator — `accounts.manage`, not `.all` — sees the Accounts entry, no account switcher, and the account surface at `/`. | AC-2, AC-6, AC-8 |
| TC-2 | A super administrator — `accounts.manage.all` — gets the platform surface at `/` and the account switcher is present. | AC-2, AC-8 |
| TC-3 | An ordinary user — neither accounts permission — gets the device grid at `/`, and the Accounts and Users entries are absent from the navigation model entirely. | AC-4, AC-9 |
| TC-4 | A composed role whose name is unknown but whose grants include `accounts.manage` derives the account surface; no comparison against any role string exists in the decision path. | AC-1, AC-17 |
| TC-5 | Leaving a foreign account through the context bar makes the scope implicit and clears the device selection in the same action. | AC-16 |
| TC-6 | An empty session — `null`, `undefined` and `[]` — derives the device surface and an empty navigation gate set. | AC-2, AC-20 |
| TC-7 | A principal holding `users.manage` alone sees the Users entry and not the Accounts entry. | AC-6, AC-7 |
| TC-8 | The account scope is written on entering `/accounts/:accountId` and is not rewritten when it already names that account. | AC-12 |
| TC-13 | An account administrator opening another account's detail URL writes no scope and is refused; opening their own writes the implicit scope. | AC-12a |
| TC-14 | An account name carrying a right-to-left override, a zero-width joiner, or 200 characters is sanitised and capped; an unknown or blank name resolves to nothing, leaving the id alone on screen. | AC-15a |
| TC-9 | A foreign scope is recognised as foreign; the principal's own account, an implicit scope and a blank scope are not. | AC-15 |
| TC-10 | The permission-denied surface names no session teardown and performs no navigation. | AC-13 |
| TC-11 | `npm run test` passes `source-policy.test.ts`, including the new rules. | AC-19 |
| TC-12 | The navigation model names no role and imports no store. | AC-17, AC-3 |

## Out of scope

- The content of the accounts, account-devices and users screens (tickets 8, 9
  and 10). This ticket opens the routes and guards them; the surfaces behind them
  are placeholders.
- Hiding the composer and the chat write controls from `permissions[]` (ticket
  11 / study wave ج).
- The account settings tab, SMS fallback labelling, and the account lifecycle
  (tickets 9 and 12).
- Any change to `src/lib/http.ts`, the 401 recovery path, or the refresh
  scheduler.
- Resolving the study's open questions `Q-1..Q-8`, including `Q-4` (an
  `account_name` field on `/auth/me`).

## Known limits

- **An ordinary user still sees a raw account id.** They do not hold
  `accounts.manage`, so they cannot call `GET /accounts` and there is no way to
  turn `account_id` into a name. The study (§11) records the same limit and
  recommends asking the backend team for `account_name` on `/auth/me` (`Q-4`).
  This ticket displays the id and does not invent a name; the context bar is only
  reachable by a principal who *can* resolve the name.
- **The scope lives in a store, not in the URL, for the operational screens.**
  That is the study's recorded architectural trade-off: `/chats` and its siblings
  keep their paths and need no `:accountId`, at the cost that a shared link to one
  of them does not carry the context. Only the administrative routes carry the id.
- **Nothing is verified against a running gowa server.** Every assertion is made
  against the reference and against tests.
