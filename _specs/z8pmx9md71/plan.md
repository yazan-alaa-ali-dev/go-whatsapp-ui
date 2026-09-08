---
ticket: z8pmx9md71
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-06
links:
  clickup: "https://app.clickup.com/t/z8pmx9md71"
  github: ""
---

# Plan — 5 · Expose a typed permissions layer from /auth/me

> **Revision 2.** Revision 1 was reviewed by the advisory panel (senior /
> security / performance) **before any code was written**. They returned **40
> findings — 5 major**. Six changed the design and one changed `spec.md`.
>
> Three defects were found independently by two or more lenses, and the
> unanimous answer to all three of revision 1's open questions was the same:
> **cut the composite `<Can>` props**, keep `redaction.ts` separate, stop the
> 403 wiring at `use-action-mutation.ts`.
>
> One of the panel's mitigations turned out **not to be available**, and saying
> so is part of the response: the security lens asked that the 403 message gate
> on the gowa envelope code. Reference §02's error table gives the 403 row a
> code of **`—`** — there is no code to gate on. The finding is real; the fix is
> the other half of its own suggestion, and revision 2 takes that half.
>
> Full disposition in *Panel response* at the end of this file.

## Approach

`permissions[]` already arrives and is already stored. `GET /auth/me` returns
`AuthUserView`, `src/api/auth.ts` types it, `isAuthUser()` validates that
`permissions` is a string array before the value is trusted, and
`src/stores/auth.ts` holds the principal on `user`. Nothing needs fetching,
nothing needs a new request, and nothing needs a new place to live.

So this ticket adds **readers**, not state. Four small modules and five edits,
laid out along the layering this repository already uses:

| Layer | File | What it knows |
|---|---|---|
| `src/lib/` — pure | `permissions.ts` | the catalogue, and how to test a list against it |
| `src/lib/` — pure | `redaction.ts` | that a masked field is a deleted key |
| `src/hooks/` | `use-permissions.ts` | how to get the current list out of the store |
| `src/components/shared/` | `can.tsx` | that an absent permission renders nothing |

The two `lib/` modules are **pure functions over a string list**. They import no
store, no React and no axios — and, after the panel, **not each other**: the
no-import rule between them is asserted, for the reason in *Presence is not a
grant* below. That purity is what makes the whole feature testable in a Node
environment with no renderer, and it keeps the store the only thing that knows
where a principal comes from.

### The catalogue is a closed set, and the two traps live in it

`PERMISSIONS` is a `const` object mapping a screaming-snake key to the literal
wire-format string, and `Permission` is the union of its values. (A `const`
object rather than an `enum`: `tsconfig.app.json` sets
`erasableSyntaxOnly: true`, so an enum would not compile.) A typo in a call site
is then a compile error rather than a check that silently never passes — which
is the entire reason for typing this at all, because a permission name is a
string the server never validates back at us.

Two entries carry the documentation the acceptance criteria ask for, and they
are the two the reference itself calls out:

- `messages.read` is a **misnomer fixed in the wire format**: it grants
  `GET /message/{id}/download` — media only. Reading messages comes with
  `chats.read`. This is written on the constant, where somebody about to guard a
  message list with it will read it (AC-3).
- `accounts.manage` answers *may you use this surface at all*;
  `accounts.manage.all` answers *may you leave your own account*, and belongs to
  `super_admin` alone. An `admin` holds the first and not the second, so it sees
  the whole admin surface scoped to its own account (AC-4). `users.manage` /
  `users.manage.all` are the same pair one surface over.

The catalogue is transcribed from §04's table — 28 names — and nothing derives
one permission from another. §04 is explicit that the `user` role's nine
permissions are written literally in the backend and do **not** expand when a
permission is added (spec C-5), so any UI-side derivation would eventually
disagree with the server. Those nine are recorded as a comment, for orientation
only; no code reads them.

**Four of the 28 are reconstructed, not transcribed** (the senior lens caught
this). §04's table compresses four rows into shorthand —
`contacts.read / .write`, `groups.read / .write`, `newsletters.read / .write`,
`devices.webhook.read / .write` — so `contacts.write`, `groups.write`,
`newsletters.write` and `devices.webhook.write` never appear spelled out
anywhere in the reference. The expansion is obvious and the ticket's own AC-2
lists all four by name, but TC-12 can no longer claim "exact transcription for
all 28", and `spec.md > Known limits` now records it.

### `NO_PERMISSIONS` is a frozen module constant, and that is not tidiness

This is the one non-obvious defect the design has to avoid, and it would be
invisible until it hung the page. The performance lens **verified the claim
against `node_modules/zustand/esm/react.mjs` rather than taking it on trust.**

zustand v5 reads state through `useSyncExternalStore` with
`getSnapshot = () => selector(api.getState())`, and React re-renders whenever
`Object.is` fails on the returned snapshot. A selector written the natural way —

```ts
useAuth((state) => state.user?.permissions ?? [])      // WRONG
```

— returns a **new array** on every call whenever `user` is null. `Object.is`
never matches, React re-renders, re-reads, gets another new array, and the
component loops; in development React also warns that `getSnapshot` should be
cached. So the anonymous case is a single frozen constant:

```ts
export const NO_PERMISSIONS: readonly string[] = Object.freeze([])
```

and the selector returns either the store's own array — whose identity is stable
for as long as `user` is — or that one constant.

**What that does *not* buy**, corrected after the panel (perf and senior found
it independently): revision 1 claimed the selected value survives "an unrelated
store write". `recordRefresh` is indeed unrelated and identity-neutral. A
**rotation** is not — `storeTokenPair` writes `user: pair.user ?? state.user`,
and `AuthTokenPair.user` is optional, so a `POST /auth/refresh` that *does*
answer with a principal replaces `user` with a structurally identical object of
a different identity, and every `usePermissions()` consumer re-renders. So the
guarantee is narrowed to what is true:

- `usePermissions()` — array identity is stable across a refresh **record**, not
  across a rotation that carries a principal.
- `useHasPermission` / `useHasAnyPermission` / `useHasAllPermissions` — return a
  **boolean**, so they are stable across both, and they are what a guarded tree
  should be built on.

TC-14 is extended to assert exactly that split, including the negative case.

### Three checks, and the empty-list answers are chosen, not inherited

```ts
hasPermission(granted, permission)      // granted?.includes(permission) ?? false
hasAnyPermission(granted, permissions)  // permissions.some(...)
hasAllPermissions(granted, permissions) // permissions.every(...)
```

`granted` is typed `readonly string[] | null | undefined` on purpose. The
argument is not "the permissions" but "whatever the store has right now", which
before boot and after a sign-out is nothing. AC-13 is then satisfied by the
signature rather than by a guard every caller has to remember.

The empty-list cases are `some` and `every`'s defaults — `any []` is `false`,
`all []` is `true` — and they are the right answers (an empty requirement list
demands nothing), but they are inherited from `Array.prototype`, so TC-6 asserts
them explicitly. A future rewrite that loops by hand must not quietly flip them.

### `<Can>` takes one prop, after all three lenses said so

Revision 1 gave `<Can>` a three-way discriminated union — `permission` / `anyOf`
/ `allOf`. Every lens rejected it, each for its own reason, and together they
make the case:

- **senior:** the branch invites a *conditional hook call*
  (`props.permission ? useHasPermission(p) : …`), which breaks the rules of
  hooks, and revision 1 never said how the branch was evaluated.
- **performance:** avoiding that means calling all three hooks unconditionally
  — **three `useSyncExternalStore` subscriptions per instance** where one would
  do.
- **security:** a three-way *optional*-prop union only fails closed if the
  runtime does; a spread or an `any`-typed prop presents zero props to a
  compile-time-only union. And `anyOf` is the prop reached for when `allOf` was
  meant, which widens visibility silently.

So:

```tsx
<Can permission={PERMISSIONS.MESSAGES_SEND}><SendButton /></Can>
```

One required prop, one hook call, one subscription. AC-11 names `permission=`
and nothing else; AC-10's composite is satisfied by `hasAnyPermission` /
`hasAllPermissions` and their hooks, and TC-5 tests the *check*, not the
component — so removing the composite props costs **zero** acceptance criteria
and zero coverage. Adding a prop later is a non-breaking one-line change.

There is deliberately **no `fallback` prop** either. §11 and the ticket both say
hide the control, do not disable it. A `fallback` is the shape that invites a
disabled button back in.

### `<Can>` is a screen-level guard, not a per-row one

The performance lens's second major, recorded here because it is the kind of
thing a wiring ticket gets wrong by default: the permission answer is **identical
for every row of a list**, but a `<Can>` per row buys one store subscription per
row — 25 chats, 30 messages, or an unbounded participant list.

The sanctioned per-row spelling is therefore a boolean hoisted once in the
parent:

```tsx
const canSend = useHasPermission(PERMISSIONS.MESSAGES_SEND)   // once
{rows.map((row) => canSend && <SendButton … />)}              // per row
```

This is written as a header comment on `can.tsx`, where the next ticket will
read it. Two specific hazards are recorded with it:

- `src/features/chat/message-view.tsx` holds the composer `draft` in the same
  component that renders the unmemoized message rows, so a guard placed inside
  that subtree re-runs its hooks **on every keystroke**. Guards go above the
  keystroke boundary.
- `src/features/group/participants-panel.tsx` renders the full participant list
  with **no pagination and no windowing** — unlike chats and messages, capped at
  25 and 30 — so it is the worst case for a per-row guard.

### Presence is not a grant — the two modules may not import each other

`permissions.ts` answers *what may this principal do*. `redaction.ts` answers
*what is in this object*, and the second is not derived from the first — that is
the whole point of §09. The backend deletes the key, so a privileged user with
no diagnostics and an unprivileged user are indistinguishable **by design**, and
the UI is told (§09, §11) not to try to tell them apart or to show an error for
the difference.

The security lens's finding is the one that shapes the module: `if (hasField(m,
'sent_by'))` *reads* like "I hold `messages.origin.read`", and a caller one
ticket later could gate a mutation on it — a permission decision taken from
redaction output. So the boundary is made executable rather than stylistic:
neither module may import the other, and `source-policy.test.ts` asserts it.

```ts
export const MASKED_FIELDS = [
  'metadata_debug', 'has_debug', 'transcript', 'transcript_language',
  'transcript_status', 'sent_by', 'sent_by_name',
] as const
export type MaskedField = (typeof MASKED_FIELDS)[number]

export function hasField<K extends MaskedField>(
  value: unknown, key: K,
): value is Record<K, unknown>

export function hasDiagnostics(message: { has_debug?: boolean }): boolean
```

Two panel corrections are in that signature:

1. **`K extends MaskedField`, not `K extends string`.** `hasField(m, 'sent_bt')`
   would otherwise compile and report "absent" forever — a typo that silently
   and permanently hides a field, which is the same bug class the closed
   `Permission` union exists to prevent one module over.
2. **A type predicate, not a `boolean`.** With `hasField(...): boolean`,
   TypeScript still types `m.sent_by` as `string | undefined` inside the guarded
   branch, so the developer reaches for `!` or `?? 'unknown'` — the exact idiom
   §09 bans. Returning `value is Record<K, unknown>` narrows the branch and makes
   the banned fallback unnecessary rather than merely discouraged.

`hasDiagnostics` exists separately because `has_debug` is the one field that is
**both** maskable *and* `omitempty`: even for a principal who may see it, absence
means "no diagnostics". `has_debug === true` is the only correct test and
`=== false` is never expected (AC-16).

`MessageInfo` in `src/api/chat.ts` gains the seven maskable fields as
**optional** properties (AC-18). `sent_via` is added as **required** — the
senior lens's point, verified: nothing in this repository constructs a
`MessageInfo` literal (it only ever arrives through a `results<…>` cast), so
`sent_via: string` costs nothing and makes AC-17 — "not masked, always
available" — a fact the compiler holds rather than a sentence in a comment.
Everything else is purely additive, so no existing reader breaks.

### 403 is a permission rejection, and the interceptor already treats it as one

Half of this section is verification rather than construction, and saying so
here is the point: `src/lib/http.ts` handles **only** 401. A 403 falls through
to `Promise.reject(apiError)` before any session code runs, so AC-20 and AC-21
are already true. They are not built — they are **locked in** with tests, so a
future edit to the interceptor cannot quietly make a 403 spend a refresh.

What is missing is the sentence a human reads. Today a 403 surfaces as
`toApiError(error).message` — whatever the server wrote — through
`toast.error(...)`. AC-19 wants "you do not have permission for this action".

**The security lens's major, and why its first mitigation is unavailable.** A
403 from a WAF, a reverse proxy or an origin refusal is not a permission
problem, and replacing its text with an account-permission sentence both
mislabels it and destroys the only diagnostic an operator has. The suggested fix
was to gate on the gowa envelope code, the way `toLoginError` already gates on
`AUTH_*` rather than on status. **That gate does not exist:** reference §02's
error table lists a `code` for every row it documents *except* 403, whose code
column is literally `—`. gowa's 403 is not distinguishable from any other 403 by
code, which is exactly why the reference's advice for it is "better to hide the
button in the first place".

So revision 2 takes the finding's second, available half — **show the sentence
*and* keep the server's text** rather than replacing it:

```ts
export const PERMISSION_DENIED: Notice   // "You don't have permission for this action"

export function toActionErrorMessage(error: unknown): string
//   403 → PERMISSION_DENIED.title, plus the server's own message when it said one
//   else → the server's own message
```

A gowa 403 then reads as a permission rejection with gowa's detail attached; a
WAF 403 reads as a permission rejection with the WAF's detail attached — which
is the string that tells an operator it was never gowa. This also answers the
lens's separate `info` about a 403 leaving no operator trail: the trail is the
server's own text, kept rather than discarded. No new store state is added for
it, because no acceptance criterion asks for one.

Both arms now go through the existing `serverMessage()` cap
(`MAX_SERVER_MESSAGE = 200`) — the second security finding here. That helper is
already in this module because any intermediary in front of gowa can choose that
text, and it was inconsistent for the login screen to cap it and a toast not to.
`serverMessage` gains an explicit "when empty" argument so the login screen keeps
its own wording; that is a one-line change at its single existing call site.

It goes in `auth-messages.ts` rather than a new file because that module is
already "what this app says about a session" — it holds `SIGN_OUT_NOTICES` and
`CONNECTION_NOTICES` as well as the login copy — and it already has a test file.

It is wired into **one** place: `src/hooks/use-action-mutation.ts`, the shared
error surface for **32 of the repository's action forms**. That is the largest
possible reach for a single-line change, and all three lenses agreed it is the
right line — mapping 403 inside `toApiError` would corrupt text the store's
refusal path and the login screen's `unknown` branch depend on, and the
mechanical multi-file edit is real scope creep.

The direct callers are **not** touched, and the known limit now carries the
verified number rather than "seven or so": **11 `toast.error(toApiError(…))`
sites across 8 components**, plus one inline `setError(apiError.message)` in
`login-qr-dialog.tsx` — **12 sites in 9 files**. They are listed by path in
`implement.md`, so the later per-screen tickets inherit a checklist rather than
an implication.

### The prohibition is executable, or it is not a prohibition

The one rule this ticket exists to establish — *never decide from a role name* —
is a rule nobody can run unless it is a test. `src/lib/source-policy.test.ts`
already enforces the credential rules that way, over every shipped source file
with comments stripped. Both of revision 1's proposed rules were **broken**, and
both breaks were found by more than one lens.

**Rule 1 — no role name, anywhere.** Revision 1 matched four *comparison*
shapes. The security lens enumerated what that misses: `const { role } = user;
if (role === 'admin')` (no dot), `switch (user.role)`, `==`,
`user.role.startsWith('admin')`, and above all a lookup table
`ROLE_CAPS[user.role]` / `ADMIN_ROLES.includes(user.role)` — the last being
precisely the role-derivation REQ-4 and C-5 exist to forbid, and invisible to
every one of the four patterns.

So the rule matches the **field**, not the comparison: ban the bare word
`role` / `roles` outside an explicit allowlist. The objection to that in
revision 1 was ARIA — `role="alert"`, `role="button"` — and the answer is to
strip the JSX attribute form before matching, the same way comments are already
stripped. Then the allowlist is five files, each verified as a pure mention:

| Allowed | Why |
|---|---|
| `src/api/auth.ts` | the wire type declares `role` / `roles[]` |
| `src/api/newsletter.ts` | an unrelated newsletter *viewer* role |
| `src/stores/auth.ts` | `diagnostics()` reports the role as identity |
| `src/components/layout/user-menu.tsx` | renders the role as identity, not authority |
| `src/features/newsletter/newsletter-list.tsx` | renders that unrelated field |

Destructuring, `switch`, and a lookup table are all caught, because none of them
can avoid naming the field. The literal-equality arm
(`=== 'admin' | 'super_admin' | 'user'`) is **dropped**: both the senior and
security lenses noted it matches a generic string in any context — `'user'` is a
plausible tab id or sender kind — and it now carries no weight the field rule
does not already carry.

**Rule 2 — `permissions` has one owner.** Revision 1 gave no pattern, and both
candidates fail. The senior lens found the fatal one: `stripComments` does not
strip *string literals*, and `src/lib/auth-messages.ts` — a file this very
ticket edits — contains the copy "Your permissions were updated" and "pick up
the new permissions". A bare `/permissions/` therefore **red-fails on arrival**,
and the fast fix would be an exemption that guts the rule. The narrow
`\.permissions\b` form is evaded by `const { permissions } = user` and
`user['permissions']`.

The shipped pattern covers all three spellings and no copy:

```
/\.permissions\b|\bpermissions\s*[,}]|\[\s*['"]permissions['"]\s*\]/
```

— field access, destructuring, and bracket access. It is case-sensitive, so the
`PERMISSIONS` catalogue and `NO_PERMISSIONS` do not match, and prose ends
`permissions` with a space or a full stop rather than `,` or `}`. Allowlist:
`src/api/auth.ts`, `src/stores/auth.ts`, `src/lib/permissions.ts`,
`src/hooks/use-permissions.ts`.

**Rule 3 — the two authorities may not import each other** (security). Asserted
directly on the two sources.

**Rule 4 — NFR-5 is written where it will be read** (security). "Hiding a
control is an affordance, never enforcement; the server is the only authority"
maps to no AC and no file in revision 1, so the one sentence that stops `<Can>`
being read as a security control lived only in `spec.md`. It becomes a header
comment on `can.tsx` and `permissions.ts` — the two files a later ticket opens —
and its presence is asserted, like every other rule in that file.

**Rule 5 — AC-7 was overclaimed** (security). Revision 1 said the existing JWT
rule already settles it. It bans `atob`, `jwt-decode`, `jwtDecode` and `jose` —
not `Buffer.from(t, 'base64')`, a hand-rolled base64url decode, or a
`TextDecoder` over one. The pattern is widened by three alternations
(`base64`, `Buffer.from`, `TextDecoder`). Verified free: **zero** occurrences of
any of them exist in `src/` today.

### Testing a component with no renderer

The repository has no jsdom and no React Testing Library, and adding either
would violate NFR-3. `react-dom/server` is already a dependency, and
`renderToStaticMarkup` gives exactly what TC-2 asks for: a string that either
contains the element or does not.

Two premises, both **confirmed experimentally before this plan was written**
rather than assumed (the senior lens asked for the second to be stated as a
premise, not discovered mid-implement):

1. **`.test.tsx` needs no configuration.** There is no `test:` block in
   `vite.config.ts` and no `vitest.config.*`, and if vitest needed one the only
   place to put it would be `vite.config.ts` — a deployment runtime file, i.e. a
   hard stop mid-implement. It does not: vitest's default `include` already
   covers `?(x)`, the default environment is node, and `@vitejs/plugin-react`
   supplies the JSX transform. A throwaway `.test.tsx` was run to prove it.
2. **zustand's server snapshot is the *initial* state.** `useStore` passes
   `api.getInitialState` as `getServerSnapshot`, so under `react-dom/server` a
   component rendered after `useAuth.setState({ user })` observes `user: null`
   and renders nothing. A render test written the obvious way would therefore
   **pass TC-2 for entirely the wrong reason** and fail TC-1 looking like a bug
   in `<Can>`. Proven by running it.

So `can.test.tsx` mocks `@/stores/auth` with a plain
`(selector) => selector(state)` over a mutable fixture, and asserts on real
rendered markup.

**And the mock is not allowed to be the only link.** The security lens's point:
with `can.test.tsx` mocked and no test for the hooks, the single path from the
server's `permissions[]` to a UI decision would never execute against the real
store, and TC-14 asserted over a mock would prove nothing about zustand. So
`use-permissions.test.ts` is added, exercising the **real** store with
`setState` + `getState` — no renderer needed, because a selector is just a
function — for the `user → permissions → check` path and for the identity
behaviour in both directions.

## Steps

1. **`src/lib/permissions.ts`** — the 28-name catalogue as `PERMISSIONS`, the
   `Permission` union, `NO_PERMISSIONS`, and the three pure checks. The two
   documented traps (AC-3, AC-4) on the constants; the NFR-5 sentence in the
   header.
2. **`src/lib/permissions.test.ts`** — TC-1, TC-3, TC-4, TC-5, TC-6, TC-12.
3. **`src/lib/redaction.ts`** — `MASKED_FIELDS`, `MaskedField`, `hasField` as a
   type predicate over that union, `hasDiagnostics`, the §09 rule with its two
   wrong spellings, and the "presence is not a grant" header.
4. **`src/lib/redaction.test.ts`** — TC-7, TC-8, TC-9.
5. **`src/hooks/use-permissions.ts`** — `usePermissions`, `useHasPermission`,
   `useHasAnyPermission`, `useHasAllPermissions`; **one** selector each.
6. **`src/hooks/use-permissions.test.ts`** — the real store, both identity
   directions (TC-14), and the anonymous path.
7. **`src/components/shared/can.tsx`** — one required `permission` prop, one
   hook, no fallback; the per-row guidance and the NFR-5 sentence in the header.
8. **`src/components/shared/can.test.tsx`** — TC-1, TC-2 through
   `renderToStaticMarkup` with the store module mocked.
9. **`src/api/chat.ts`** — seven optional maskable fields plus required
   `sent_via` on `MessageInfo` (AC-17, AC-18).
10. **`src/lib/auth-messages.ts`** — `PERMISSION_DENIED`,
    `toActionErrorMessage`, `serverMessage` gains its "when empty" argument;
    widen the module doc comment.
11. **`src/lib/auth-messages.test.ts`** — the 403 mapping with and without
    server text, the non-403 arm, and the 200-character cap on both.
12. **`src/hooks/use-action-mutation.ts`** — one line in `onError`.
13. **`src/lib/http.test.ts`** — TC-10, TC-11.
14. **`src/lib/source-policy.test.ts`** — the ARIA strip and rules 1–5.
15. Run the `ui-build` validation profile, then the mutation pass, and record
    both.

## Files to change

**Added — 8**

| File | Why |
|---|---|
| `src/lib/permissions.ts` | AC-1..AC-4, AC-9..AC-13 (the pure half) |
| `src/lib/permissions.test.ts` | AC-23, AC-24, TC-1, TC-3..TC-6, TC-12 |
| `src/lib/redaction.ts` | AC-14..AC-17 |
| `src/lib/redaction.test.ts` | TC-7, TC-8, TC-9 |
| `src/hooks/use-permissions.ts` | AC-5, AC-9, AC-10, AC-13, NFR-2 |
| `src/hooks/use-permissions.test.ts` | AC-5, TC-14 — against the real store |
| `src/components/shared/can.tsx` | AC-11, AC-12, NFR-5 |
| `src/components/shared/can.test.tsx` | AC-25, TC-2 |

**Edited — 6**

| File | Change |
|---|---|
| `src/api/chat.ts` | `MessageInfo` gains 7 optional + 1 required field (AC-17, AC-18) |
| `src/lib/auth-messages.ts` | `PERMISSION_DENIED`, `toActionErrorMessage`, `serverMessage` arg (AC-19) |
| `src/lib/auth-messages.test.ts` | tests for the above |
| `src/hooks/use-action-mutation.ts` | one line in `onError` (AC-19) |
| `src/lib/http.test.ts` | 403 behaviour locked in (AC-20, AC-21) |
| `src/lib/source-policy.test.ts` | the ARIA strip and five executable rules |

**Not changed**

No deployment runtime file (`.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json`,
`index.html`) is touched — AC-27, and `package.json` in particular because
AC-26 forbids a new dependency. No screen is permission-wired (C-6): no file
under `src/features/` or `src/pages/` is edited by this ticket.

## Validation strategy

Profile `ui-build`, run locally, exactly as `z8pmx9md70` ran it:

| Check | Command | Bar |
|---|---|---|
| unit tests | `npm run test` | green, and strictly more than the **215**-test baseline |
| types | `npm run typecheck` | clean |
| lint | `npm run lint` | no new warning beyond the 4 pre-existing ones |
| build | `npm run build` | the single-file `dist/index.html` is produced |

Beyond the profile, and because a permission layer that is only *asserted*
correct is worth little:

- **Mutation testing** on every guard this ticket introduces: `hasPermission`'s
  `?? false`, the `some`/`every` split, `<Can>`'s branch, the 403 arm of
  `toActionErrorMessage`, the `NO_PERMISSIONS` identity, and `hasField`'s
  `in` test. Each is broken by hand and the suite must fail. A surviving
  mutation means the test asserts the shape of the code rather than its
  behaviour, and is **reported rather than quietly fixed**.
- **The source-policy rules are mutation-tested too**, and against the shapes
  the panel said revision 1 would miss: a destructured `const { role } = user`
  comparison, a `ROLE_CAPS[user.role]` lookup table, a `const { permissions } =
  user` read, and a cross-import between the two lib modules. Each is
  temporarily introduced into a real file and each rule must catch it.

## Rollback

Every added file is new and referenced by nothing outside this ticket, so
deleting the eight added files removes the feature entirely. The six edits are
each additive or one line:

- `src/api/chat.ts` — remove the fields; nothing read them.
- `src/lib/auth-messages.ts` — remove two exports and restore `serverMessage`'s
  single-argument form at its one call site.
- `src/hooks/use-action-mutation.ts` — restore `toApiError(error).message`.
- the three test files — remove the added blocks and the ARIA strip.

No state shape, no persisted cookie name, no query key, no route and no store
field changes, so there is nothing in a user's browser to migrate back. The
whole ticket is revertible with `git revert` and no follow-up.

## Out of scope

As `spec.md > Out of scope`. In particular: no screen is wired, no admin surface
is built, no maskable field is rendered, and the 12 direct error-formatting
sites in 9 files keep formatting their toasts the way they do today.

## Panel response

Revision 1 went to the three advisory lenses before any code existed. They
returned **40 findings — 5 major**. **31 are adopted**, 6 are accepted as stated
costs or recorded as limits, 2 are declined with reasons, and **1 is corrected**:
a mitigation that rests on something the backend does not provide.

### The three defects two or more lenses found independently

These carry the most weight, because each lens reached them from a different
direction.

1. **`<Can>`'s three-prop union was wrong** — *senior* (a conditional hook call,
   breaking the rules of hooks, and the plan never said how the branch was
   evaluated), *performance* (avoiding that means three unconditional
   `useSyncExternalStore` subscriptions per instance), *security* (a
   compile-time-only union fails **open** under a spread or an `any`-typed prop,
   and `anyOf` is the prop reached for when `allOf` was meant — silently wider
   visibility). All three, independently, answered open question 1 the same way:
   ship `permission=` alone. **Adopted.** It costs no AC and no coverage, and it
   removes the hooks hazard entirely.
2. **The `permissions`-owner source rule would have red-failed on arrival** —
   *senior* (major) and *security* (minor), independently. `stripComments` does
   not strip string literals, and `auth-messages.ts` — a file this ticket edits
   — contains "Your permissions were updated" in its sign-out copy. The rule
   would have failed on the first run, and the fast fix would have been an
   exemption that gutted it. **Adopted**, with a pattern written out in full that
   also covers the destructured and bracket spellings the narrow form missed.
3. **NFR-2's guarantee was broader than the truth** — *performance* and
   *senior*, independently, both landing on `src/stores/auth.ts`'s
   `user: pair.user ?? state.user`. A rotation whose response carries a
   principal replaces `user`, so `usePermissions()`'s array identity changes and
   every guarded subtree re-renders. Only `recordRefresh` — what TC-14 actually
   exercised — is identity-neutral. **Adopted:** the claim is narrowed to the
   *boolean* hooks, and TC-14 now asserts both directions, negative case
   included.

### The findings that changed the design on their own

4. **403 keyed on status alone mislabels a proxy and destroys its text**
   (*security*, major). A WAF or reverse-proxy 403 would have been reported to
   the user as an account-permission problem, with the server's only diagnostic
   discarded. **Adopted — with a correction, below.**
5. **The role rule could be destructured, switched or lookup-tabled around**
   (*security*, major). `ROLE_CAPS[user.role]` is exactly the role-derivation
   REQ-4 and C-5 forbid, and revision 1's four comparison patterns could not see
   it. **Adopted:** the rule now matches the *field*, with ARIA attributes
   stripped first and a five-file verified allowlist. Both lenses' objection to
   the bare literal arm is also adopted — it is dropped.
6. **`hasField` was neither type-safe nor type-narrowing** (*security*, two
   minors). `K extends string` let `hasField(m, 'sent_bt')` compile and report
   "absent" forever; returning `boolean` rather than a type predicate left
   `m.sent_by` as `string | undefined` in the guarded branch, pushing the
   developer straight back to the `?? 'unknown'` idiom §09 exists to ban. **Both
   adopted.**
7. **Presence could be read as a grant** (*security*, minor). Nothing stopped a
   later caller gating an action on `hasField(m, 'sent_by')`. **Adopted:** the
   no-import rule between `permissions.ts` and `redaction.ts` is now asserted in
   `source-policy.test.ts`, so the boundary is executable rather than
   stylistic — and it is the concrete reason to answer open question 2 by
   keeping the modules split.
8. **The mock would have been the only link to the store** (*security*, minor).
   With `can.test.tsx` mocking `@/stores/auth` and no hook test, nothing would
   have executed the `permissions[] → UI decision` path against real zustand,
   and TC-14 over a mock proves nothing. **Adopted:** `use-permissions.test.ts`
   is added against the real store.
9. **`<Can>` per list row buys a subscription per row** (*performance*, major).
   **Adopted** as documentation rather than code — this ticket wires no screen —
   with the sanctioned hoisted-boolean spelling and the two named hazards
   (`message-view.tsx`'s keystroke boundary, `participants-panel.tsx`'s
   unwindowed list) written into `can.tsx`'s header for the wiring tickets.

### The correction — a mitigation that is not available

The security lens's major asked that the 403 message gate on the gowa envelope
code, "the way `toLoginError` already does". Checked against the source it cites:
reference §02's error table gives a code for every documented row **except
403**, whose code column is `—`. There is no `AUTH_*` or `PERMISSION_*` code on
a gowa 403, and therefore no gate. (The reference's own advice for that row is
"better to hide the button in the first place", which is this ticket.)

The finding is nevertheless right about the harm, so revision 2 takes the other
half of its own suggested mitigation — *"better still, show the friendly
sentence **and** keep the server text rather than replacing it"* — which needs no
code to distinguish. A WAF 403 now reads as a permission rejection carrying the
WAF's own text, and that text is what tells an operator it never reached gowa.
This also closes the lens's separate `info` about a 403 leaving no operator
trail, without adding store state no acceptance criterion asks for.

### Adopted without changing the shape of the design

10. `serverMessage()`'s 200-character cap now covers the action toast too
    (*security*) — the module already caps untrusted server text for the login
    screen, and exempting a toast was inconsistent.
11. The JWT-decode rule is widened by `base64`, `Buffer.from` and `TextDecoder`
    (*security*); revision 1's "AC-7 is already enforced" was an overclaim.
    Verified free — zero occurrences in `src/`.
12. NFR-5 becomes an executable rule and a header comment on the two files a
    later ticket opens (*security*); it previously mapped to no AC, no file and
    no test.
13. `sent_via` is declared **required**, not optional (*senior*) — verified:
    nothing in the repo constructs a `MessageInfo` literal, so AC-17 becomes a
    compiler fact instead of a comment.
14. Four of the 28 catalogue names are **reconstructed from §04's shorthand**,
    not transcribed (*senior*) — recorded in `spec.md > Known limits`; TC-12 no
    longer claims exact transcription for all 28.
15. The "Files to change" counts are corrected (*senior*): 8 added, 6 edited.
    `/implement` checks the changed set against this list, so a miscount invites
    an argument about which row is the stray.
16. The known limit carries the **verified** number (*senior*): 11
    `toast.error(toApiError(…))` sites across 8 components, plus one inline
    `setError` in `login-qr-dialog.tsx` — 12 sites in 9 files, listed by path in
    `implement.md`, not "seven or so".
17. `.test.tsx` needing no vitest configuration is stated as a **confirmed
    premise** (*senior*) rather than left to be discovered mid-implement, where
    the only place to configure it would have been `vite.config.ts` — a
    deployment runtime file and a hard stop.
18. The `?? []` loop claim was **verified** by the performance lens against
    `node_modules/zustand/esm/react.mjs` rather than accepted. Recorded as
    verified.
19. `permissions[]` is **stale for the life of the tab** (*security*): a silent
    refresh re-fetches no principal, so a permission revoked without a
    token-epoch bump keeps its control rendered until reload. Recorded in
    `spec.md > Known limits` — tolerable only because the server's own 403 is
    the real control, which is NFR-5 restated.
20. Open question 2 is answered "keep them separate" by all three lenses, and
    the plan's justification is rewritten to theirs: the import graph and the
    conflation hazard, not epistemology (*senior*, *security*, *performance*).

### Accepted as stated costs, and the two declined

- **Accepted:** an inline array argument (`useHasAnyPermission([A, B])`) changes
  the selector identity every render, so zustand's `useCallback` memo misses and
  the snapshot check re-runs (*performance*, info). No loop, because the
  selected value is a boolean. Recorded rather than optimised — a caller who
  needs a stable argument can hoist it, and there are no callers yet.
- **Accepted:** the whole layer is tree-shaken out of `dist/index.html` this
  ticket, because C-6 leaves it with no importer (*performance*, info). NFR-3 is
  therefore judged on the wiring tickets; recorded so it is judged on the right
  one.
- **Accepted:** `message-view.tsx`'s unmemoized rows and
  `participants-panel.tsx`'s unwindowed list are pre-existing conditions this
  ticket does not fix (*performance*, minors). Recorded as constraints on the
  wiring tickets, in `can.tsx`.
- **Declined:** recording the last 403 in `diagnostics()` (*security*, info). It
  adds store state for no acceptance criterion, and the operator trail it exists
  to provide is already restored by keeping the server's own text in the message
  (finding 4). The declining reason is the fix for the finding above it.
- **Declined:** the 12-site mechanical error-message edit (*senior* and
  *security* both explicitly recommend against it; it is listed here only
  because revision 1 raised it as open question 3). All three lenses agreed:
  keep the single wiring point, and do not touch `toApiError`, which is the
  shared normaliser behind the store's refusal path and the login screen's
  `unknown` branch.
