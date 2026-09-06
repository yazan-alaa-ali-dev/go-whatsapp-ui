---
ticket: z8pmx9md71
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md71"
  github: ""
---

# Specification — 5 · Expose a typed permissions layer from /auth/me

## Business goal

The four tickets before this one built a session: a same-origin proxy, a store
that owns the token pair, a login screen and a route guard, and a refresh layer
that keeps the session alive. All four answer one question — *who is this?*

None of them answers the second one: *what may they do?*

The reference is unusually direct about how that question must be answered.
Permissions are **compile-time constants** in the backend; roles are **rows in a
database**, so an operator can compose a fourth role without a redeploy (§04).
The golden rule it states from that fact is one sentence: **rely on
`permissions[]`, not on the role name.** §11 repeats it in the list of common
traps, and puts "build the UI from `permissions[]`" at the top of its
medium-priority migration work.

The UI as it stands does neither. `permissions[]` arrives on every `GET
/auth/me` and is stored — `diagnostics()` even counts it — and then nothing
reads it. Every control in the dashboard is rendered unconditionally, so a
`user`-role account is shown a send box it will be refused at, pin and archive
buttons it cannot use, and device actions that end in a 403.

There is a second, quieter failure the reference calls "the thing that causes
the most silent bugs" (§09/§11): this backend masks a field by **deleting the
key**, not by nulling it. `has_debug === false` and `sent_by || 'unknown'` are
both wrong, and both look right. The rule that replaces them — check the key,
not the value — has to be written down somewhere executable before any screen
starts reading a maskable field.

So this ticket builds the **foundation** and nothing on top of it:

1. the permission catalogue as **typed constants**, spelled exactly as the wire
   format spells them, with the two documented traps in the catalogue itself;
2. **checking primitives** — a hook, a composite check, and a component wrapper
   that *hides* rather than disables;
3. the **masked-field rule**, documented and given a helper;
4. **403 as a permission rejection**, not an identity one: a message a human can
   act on, and provably no refresh and no logout.

Applying any of this to a specific screen — the send box, pin/archive, the
admin surfaces — is deliberately **not** in scope. Those are later tickets, and
this one exists so that each of them is a one-line change.

## User story

As **a System Admin**, I want the UI to expose a typed permissions layer sourced
from `permissions[]` in `/auth/me`, so that **every later feature can hide or
show its controls from real permissions instead of guessing from a role name
that operators can recompose at any time**.

## Functional requirements

- **REQ-1** One module defines the permission catalogue as typed constants whose
  values are the wire-format names, literally.
- **REQ-2** The catalogue documents, in the code, that `messages.read` does not
  mean reading messages, and what `accounts.manage.all` adds to
  `accounts.manage`.
- **REQ-3** The permission list is read from the session store, which sources it
  from `GET /auth/me` (and from the login response's principal copy at sign-in).
  There is no second copy and no second reader of the wire field.
- **REQ-4** No rendering decision anywhere in the shipped source is taken from
  `role` or `roles[]`, and no permission is extracted from the access token.
- **REQ-5** A boolean hook answers "does the current principal hold this
  permission?".
- **REQ-6** A composite check answers "any of these" and "all of these" over a
  list of permissions.
- **REQ-7** A component wrapper renders its children only when the check passes,
  and renders **nothing at all** — not a disabled control — when it fails.
- **REQ-8** A principal with no session holds no permissions: every check returns
  `false`, and nothing reads a property of `undefined`.
- **REQ-9** The masked-field rule (§09) is documented where a developer reading
  a maskable field will meet it, and a helper implements the key-presence test.
- **REQ-10** The types the UI holds for maskable message fields declare them
  **optional**, so the compiler agrees with the wire format that they can be
  absent — and declare the one field §09 exempts (`sent_via`) as **required**,
  so the compiler holds that distinction too.
- **REQ-11** A 403 from the API is surfaced as a permission rejection with a
  message that says so, rather than as the malfunction its raw server text
  would read as.
- **REQ-12** A 403 triggers no refresh attempt, no session teardown and no
  logout; the session is left exactly as it was.

## Non-functional requirements

- **NFR-1** The permission layer adds no network request. It reads state that
  `GET /auth/me` has already put in the store.
- **NFR-2** No permission check subscribes a component to the whole auth store,
  and each one opens exactly **one** subscription. The boolean hooks select a
  value that is stable across every auth-store write, including a rotation, so a
  tree guarded on one is not re-rendered by the session's own housekeeping. The
  array-returning `usePermissions()` is stable across a refresh *record* but not
  across a rotation that carries a principal — see *Known limits*.
- **NFR-3** No new runtime dependency. The build is `vite-plugin-singlefile`, so
  every byte added is user-visible download cost.
- **NFR-4** The prohibition in REQ-4 is **executable**: a test fails the build
  when a role-name comparison appears in shipped source, in the same way
  `src/lib/source-policy.test.ts` already enforces the credential rules.
- **NFR-5** Hiding a control is a UX affordance and never a security control.
  The specification states this, and nothing in the implementation may be
  written as though the server's own check were optional.

## Constraints

- **C-1** No browser and no running gowa server are available in this
  environment. Everything is verified by the repository's own test, typecheck,
  lint and build commands. No acceptance criterion may be written so that only a
  live server could settle it, and any that cannot be fully settled is recorded
  as a known limit rather than reported as passing.
- **C-2** The test environment is Node, not jsdom, and this repository has no
  DOM renderer and no React Testing Library. A component's rendered output is
  asserted through `react-dom/server`, which is already a dependency.
- **C-3** zustand's `useSyncExternalStore` server snapshot is
  `api.getInitialState()`, not the live state. A component rendered under
  `react-dom/server` therefore cannot observe `useAuth.setState(...)`, and any
  render assertion must supply the principal by mocking the store module rather
  than by writing to it.
- **C-4** Deployment runtime files (`.github/workflows/ci.yml`,
  `.github/workflows/release.yml`, `vite.config.ts`, `package.json`,
  `index.html`) are not modified by this ticket.
- **C-5** The `user` role's nine permissions are listed literally in the backend
  and do not expand automatically when a permission is added (§04). The UI must
  not derive one permission from another, or infer a set from a role.
- **C-6** No screen is permission-wired by this ticket. The layer is built and
  proven; the send box, the pin/archive controls and the admin surfaces stay
  exactly as they render today.

## Acceptance criteria

### Permission catalogue

- **AC-1** One module defines the permission catalogue as typed constants whose
  values match the wire-format names literally. *(REQ-1)*
- **AC-2** The catalogue covers at least: `chats.read`, `chats.write`,
  `messages.read`, `messages.mark`, `messages.send`, `messages.debug.read`,
  `messages.transcript.read`, `messages.origin.read`, `devices.read`,
  `devices.create`, `devices.pair`, `devices.delete`, `devices.webhook.read`,
  `devices.webhook.write`, `contacts.read`, `contacts.write`, `groups.read`,
  `groups.write`, `newsletters.read`, `newsletters.write`, `calls.reject`,
  `accounts.manage`, `users.manage`, `chatwoot.manage`, `admin.debug.toggle`,
  `admin.retention.run`, `accounts.manage.all`, `users.manage.all`. *(REQ-1)*
- **AC-3** It is documented in the code that `messages.read` does **not** mean
  reading messages but downloading media only
  (`GET /message/{id}/download`) — a misleading name fixed in the wire format —
  while the messages themselves come with `chats.read`. *(REQ-2)*
- **AC-4** The difference between `accounts.manage` (may you use this surface at
  all) and `accounts.manage.all` (may you leave your own account) is documented,
  the latter belonging to `super_admin` alone. *(REQ-2)*

### Source of truth

- **AC-5** `permissions[]` is read from the auth store, sourced from
  `GET /auth/me` and from the login response's principal copy at sign-in.
  *(REQ-3)*
- **AC-6** No rendering decision is built on the `role` name or on `roles[]`,
  and a test fails the build if one is. *(REQ-4, NFR-4)*
- **AC-7** No permission is extracted from the JWT claims, and a test fails the
  build if anything decodes the token. *(REQ-4, NFR-4)*
- **AC-8** `permissions[]` after a refresh or a reload is updated through the
  same store, with no second copy anywhere in the source. *(REQ-3)*

### Checking primitives

- **AC-9** A checking hook exists — `useHasPermission(permission)` — returning a
  boolean. *(REQ-5)*
- **AC-10** A composite check exists supporting "any of" and "all of" over a
  list of permissions. *(REQ-6)*
- **AC-11** A component wrapper exists — `<Can permission=… />` — that hides its
  children when the permission is absent. *(REQ-7)*
- **AC-12** Absence means the element is **not rendered**, not rendered
  disabled: the rendered output contains no element for it at all. *(REQ-7)*
- **AC-13** A principal with no session is treated as holding no permissions —
  an empty list, not an `undefined` the code crashes on — and every check
  returns `false`. *(REQ-8)*

### Masked field rule

- **AC-14** The rule is documented explicitly: a masked field **disappears
  silently**, and no 403 accompanies it. *(REQ-9)*
- **AC-15** A helper is provided that checks **key presence** rather than value
  (`'sent_by' in message`) for maskable fields. *(REQ-9)*
- **AC-16** It is documented that `has_debug` carries `omitempty`, so its
  absence means "no diagnostics" and an explicit `false` must never be expected.
  *(REQ-9)*
- **AC-17** It is documented that `sent_via` is **not** masked and remains
  always available — and the type declares it **required**, so this is a fact the
  compiler holds rather than a sentence in a comment. *(REQ-9, REQ-10)*
- **AC-18** The message type declares every maskable field as optional, so the
  compiler cannot be used to prove a field is there. *(REQ-10)*

### Authorization behaviour

- **AC-19** When a 403 arrives from the API despite the control being hidden, a
  "you do not have permission for this action" message is shown, and the failure
  is not presented as a malfunction. *(REQ-11)*
- **AC-20** A 403 triggers no refresh attempt and no logout — it is a permission
  rejection, not an identity rejection — and a test proves it. *(REQ-12)*
- **AC-21** The session survives a 403 unchanged: same status, same token, same
  principal. *(REQ-12)*
- **AC-22** Admin surfaces stay hidden without `accounts.manage` or
  `users.manage`. *(REQ-7)* — see **Known limits**: no admin surface exists in
  this UI yet, so what is verified is that the catalogue and the wrapper make
  the guard a one-line change, and that nothing today renders such a surface.

### Testing

- **AC-23** Unit tests cover: a permission present, a permission absent, an
  empty session, and the composite check in both its forms. *(REQ-5, REQ-6,
  REQ-8)*
- **AC-24** A test documents that the role name has no effect whatsoever on the
  result of a check — a principal whose `role` is `user` but whose
  `permissions[]` contains `chats.write` passes the `chats.write` check.
  *(REQ-4)*
- **AC-25** A test asserts the guarded element is absent from the rendered
  output entirely, rather than present and disabled. *(REQ-7)*

### Cross-cutting

- **AC-26** No new runtime dependency is added. *(NFR-3)*
- **AC-27** No deployment runtime file is modified. *(C-4)*
- **AC-28** `npm run test`, `npm run typecheck`, `npm run lint` and
  `npm run build` all pass, with the test count strictly greater than the
  pre-ticket baseline. *(C-1)*

## Test cases

| # | Case | Given | When | Then | Covers |
|---|------|-------|------|------|--------|
| TC-1 | Permission present | a session whose `permissions[]` contains `messages.send` | the `messages.send` check is called | it returns `true`, and the wrapper renders its children | AC-9, AC-11 |
| TC-2 | Permission absent → hidden, not disabled | a `user`-role principal without `messages.send` | the guarded element is rendered | the rendered output is empty — no element, and no `disabled` attribute | AC-12, AC-25 |
| TC-3 | The decision does not depend on the role name | a composed role whose name is not known in advance but which holds `chats.write` | the `chats.write` check is called | it returns `true`; and no comparison against a role string exists in shipped source | AC-6, AC-24 |
| TC-4 | Empty session | no session exists (`user` is `null`) | any permission check is called | it returns `false` and no error is thrown on an undefined array | AC-13 |
| TC-5 | Composite — any of | a principal holding only `chats.read` | "any of `[chats.write, chats.read]`" is asked | it returns `true`; "all of" the same list returns `false` | AC-10 |
| TC-6 | Composite — empty list | any principal | "any of `[]`" and "all of `[]`" are asked | `any` is `false` and `all` is `true`, stated deliberately rather than by accident | AC-10 |
| TC-7 | A masked field disappears silently | a message object with no `sent_by` key | the presence helper is asked | it reports absent, and reading the field produces no error and no message to the user | AC-14, AC-15 |
| TC-8 | `has_debug` absent vs. `false` | a message with no `has_debug` key, and one with `has_debug: false` | the diagnostics helper is asked | both report "no diagnostics"; nothing distinguishes them, and no code path expects an explicit `false` | AC-16 |
| TC-9 | `sent_via` is never masked | a message from a principal without `messages.origin.read` | `sent_via` is read | it is present and readable; only the origin identity fields are absent | AC-17 |
| TC-10 | A 403 rejection from the API | a guarded endpoint called without sufficient permission | the server answers 403 | the permission message is shown; no refresh is issued; no teardown runs; the store is untouched | AC-19, AC-20, AC-21 |
| TC-11 | A 403 is not a 401 | an authenticated session | a 403 and then a 401 arrive | only the 401 path spends a refresh; the 403 path spends none | AC-20 |
| TC-12 | Catalogue completeness | the catalogue module | it is compared against the reference's §04 table | all 28 names are present; the 24 the table spells out match it literally, and the 4 it writes in shorthand (`contacts / groups / newsletters / devices.webhook` `.read / .write`) match the expansion the ticket's own AC-2 spells out | AC-1, AC-2 |
| TC-13 | No second reader of the wire field | the shipped source | it is scanned for reads of `permissions` | only the store and the permission layer name it | AC-8 |
| TC-14 | Selector identity, in both directions | a principal in the store | (a) a refresh *record* is written; (b) a rotation carrying a principal is written | (a) `usePermissions()` keeps its identity; (b) it does **not** — but every boolean hook keeps its value across both, which is what a guarded tree is built on | NFR-2 |
| TC-15 | Anonymous identity is one constant | no session | `usePermissions()` is read twice | both reads return the same frozen `NO_PERMISSIONS` reference, so `Object.is` holds and no render loop is possible | NFR-2, AC-13 |

## Out of scope

- Wiring any screen to a permission: the send box, pin/archive, the device
  actions, `metadata_debug`, the transcript panel and the origin badge all stay
  as they render today. Each is its own ticket, and each becomes a one-line
  change because of this one.
- Building an admin surface. None exists; this ticket does not create one.
- Reading, rendering or requesting any maskable field. The rule and the helper
  are delivered; the first *consumer* is a later ticket.
- Any change to how `GET /auth/me` is called, when it is called, or what the
  store does with the principal. That is `z8pmx9md6y` and `z8pmx9md70` work and
  it already passes.
- Server-side authorization. The server is the only authority; nothing here
  weakens or replaces its checks.

## Known limits

- **No admin surface exists** (AC-22). The dashboard has seven routes and none
  of them is an accounts or users admin surface, so "stays hidden without
  `accounts.manage`" cannot be observed by hiding something. What is verified
  instead is the two halves that make it true the moment such a surface is
  added: the two permissions are in the catalogue, and no route or navigation
  entry today renders an admin surface. This is recorded as a limit, not
  reported as a pass.
- **No live server and no browser** (C-1). Every 403 in the test suite is a
  constructed one. That the *server* answers 403 where the reference says it
  does is not verified here and cannot be.
- **The masked-field helper has no consumer yet** (C-6, Out of scope). It is
  proven against constructed message objects. Whether the *real* payload omits
  the key exactly as §09 describes is a claim of the reference, taken on trust
  until a screen reads one.

- **Four of the 28 catalogue names are reconstructed, not transcribed** (AC-2,
  TC-12). §04's table compresses four rows into shorthand —
  `contacts.read / .write`, `groups.read / .write`,
  `newsletters.read / .write`, `devices.webhook.read / .write` — so
  `contacts.write`, `groups.write`, `newsletters.write` and
  `devices.webhook.write` never appear spelled out anywhere in the reference.
  The expansion is unambiguous and the ticket's own AC-2 lists all four by name,
  but the catalogue cannot claim to be a literal transcription for those four,
  and TC-12 does not.

- **`permissions[]` is stale for the life of the tab** (REQ-3, AC-8). The silent
  refresh added by `z8pmx9md70` re-fetches no principal — `storeTokenPair` keeps
  `user: pair.user ?? state.user`, and `AuthTokenPair.user` is optional — so a
  permission *revoked* without a `token_epoch` bump leaves its control rendered
  until the tab reloads or the session ends. "Read from the store" therefore
  means *as of the last `GET /auth/me`*, not *current*. This is tolerable only
  because of NFR-5: the control that actually stops the action is the server's
  own check, which is not stale, and the user meets it as a 403.

- **`usePermissions()` is not identity-stable across a rotation** (NFR-2,
  TC-14). A `POST /auth/refresh` whose response carries a principal replaces
  `user` with a structurally identical object of a different identity, so every
  consumer of the array re-renders. The boolean hooks do not, which is why they
  are what a guarded tree is built on. Recorded rather than fixed: de-duplicating
  the principal would mean comparing it on every rotation, for a re-render that
  costs nothing today because no screen is wired.
