---
ticket: z8pmx9mf17
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf17"
  github: ""
---

# Plan — 7 · Derive navigation and the home surface from permissions

> **Revision 2.** Revision 1 was submitted to the advisory panel
> (`senior-reviewer`, `security-reviewer`, `performance-reviewer`) before any
> code was written. Two lenses independently found the same hole — a route that
> lets an account administrator acquire a foreign scope from a URL — and the
> design below is changed because of it. Every finding is answered in
> **Panel response** at the end of this file.

## Approach

Ticket 6 built the primitives — the account lens, the scoped device list, the
query keys, the accounts and users API clients — and shipped **none** of them to
a user, because nothing imported them. This ticket is the wiring: the first
decision path built on `permissions[]`, and the first screen a principal actually
lands on because of what they hold.

The shape of the change is dictated by one constraint more than by anything else:
**this repository has no component renderer in its test environment.** `vitest`
runs in node, there is no `jsdom`, no `@testing-library/react`, and the
acceptance criteria demand that navigation visibility, the surface derivation and
the scope behaviour be *proven*. A decision embedded in JSX cannot be proven here.

So every decision this ticket makes is moved out of the components and into two
pure modules, and the components become renderers of what those modules return:

| Module | Decides |
|---|---|
| `src/lib/surfaces.ts` | which home surface; is the scope foreign; may this principal hold this scope; what scope a route should write; what an account is called |
| `src/components/layout/navigation.ts` | which navigation entries exist for this permission array |

Both take their inputs as **arguments**. Neither imports a store, axios, or
`stores/account.ts`. That is not tidiness — it is what makes `AC-3` and `C-2`
structurally true rather than merely observed, and it is what the study (§13,
rule 2) asks for in as many words.

The navigation table lives under `components/layout/` rather than in `src/lib/`
because it carries lucide icon components, and `src/lib/` today contains **zero**
React and zero lucide imports. Keeping that layer node-pure is worth more than
the symmetry of putting both decision modules in one directory; the table is
still one pure data module and vitest tests it identically.

### The order inside `homeSurface` is the requirement, not an implementation detail

```ts
export function homeSurface(granted: readonly string[] | null | undefined): HomeSurface {
  if (hasPermission(granted, PERMISSIONS.ACCOUNTS_MANAGE_ALL)) return 'platform'
  if (hasPermission(granted, PERMISSIONS.ACCOUNTS_MANAGE)) return 'account'
  return 'device'
}
```

A `super_admin` holds **both** permissions (reference §04). Checking
`accounts.manage` first would therefore send every super administrator to the
account surface and the platform surface would be unreachable — a bug that is
invisible in any test that gives a principal one permission at a time. The test
that matters is the one that hands over both and asserts `platform`, and it is
written first.

`hasPermission` already answers `false` for `null` and `undefined`, so the
absent-session case needs no guard here: it falls through to `device`, which is
the safe default and the one an anonymous or pre-boot render should see.

### The `.manage` / `.manage.all` pair, and the hole the panel found in it

The study (§05) names this pair as *the* mistake people make, and the source
already warns about it in `PERMISSIONS.ACCOUNTS_MANAGE_ALL`'s own comment.
Revision 1 gated the surfaces correctly and then leaked the distinction through a
side door: `/accounts/:accountId` was gated on `accounts.manage` — right, for a
*screen* — and also **wrote the account scope**, which is a `.manage.all`
question. An account administrator following a link to another account's detail
page would have scoped their whole session into a foreign account. The device
list then narrows to a set they cannot see, `GET /devices?account_id=` answers
`200` with an empty array rather than `403` (reference §05), and the operator
reads it as *I have no devices* — the precise failure `src/App.tsx`'s session
teardown comment already documents.

So the route stays gated on `accounts.manage` and **the scope write is gated
separately**:

| Thing | Permission | Why not the other one |
|---|---|---|
| the **Accounts** nav entry | `accounts.manage` | gating on `.all` hides the surface from every account administrator, who is its primary audience |
| the `/accounts`, `/accounts/:accountId` **routes** | `accounts.manage` | same audience; the route must not be narrower than the entry pointing at it |
| the **Users** nav entry and the `/users` route | `users.manage` | same argument, one surface over |
| the **account switcher** | `accounts.manage.all` | it is the control that *leaves your own account* |
| **writing a foreign account into the scope**, from any origin | `accounts.manage.all` | there is exactly one question here and exactly one permission that answers it |

The last row is new in revision 2 and it is enforced in the pure layer, so it
holds for the URL, for the switcher, and for anything ticket 8 or 9 adds:

```ts
export function mayEnterAccount(
  routeAccountId: string | undefined,
  ownAccountId: string | null | undefined,
  mayLeaveOwnAccount: boolean,
): boolean
```

`true` when the principal holds `accounts.manage.all`, **or** when the route names
their own account. `false` for a blank own-account id (`''` — the study's §11
"belongs to no account", which owns nothing and therefore may enter nothing) and
for a missing param. A detail page whose id is refused renders the
permission-denied surface and writes nothing.

The two gates that must not drift — the nav entry and the route — read one
declaration:

```ts
// src/components/layout/navigation.ts
export const SURFACE_PERMISSIONS = {
  accounts: PERMISSIONS.ACCOUNTS_MANAGE,
  users: PERMISSIONS.USERS_MANAGE,
} as const
```

### Entering your own account is the implicit scope, not an explicit one

`accountScopeEntry` is the second half, and it exists because the naive version
costs an operator their device selection for a benign navigation:

```ts
export type ScopeEntry = { enter: string | null } | null   // null ⇒ write nothing

export function accountScopeEntry(
  routeAccountId: string | undefined,
  ownAccountId: string | null | undefined,
  currentScope: string | null,
): ScopeEntry
```

| Case | Target | Why |
|---|---|---|
| blank / missing param | write nothing | a malformed URL must not move the lens |
| param equals the principal's own account | `null` | the *implicit* scope is what "my own account" means on this wire; writing the explicit id gives the same devices under a second cache key and a second request |
| otherwise | the trimmed id | a foreign scope, already permitted by `mayEnterAccount` |
| target equals the current scope | write nothing | idempotence — see below |

**The caller guards where the store deliberately does not.** `enterAccount` does
not compare ids: ticket 6 argues a guarantee resting on a comparison breaks at
the comparison, and accepts that re-entering the account you are in drops your
device selection. That reasoning is about the *store's* guarantee and it stands.
The route is a different case, and the cost is larger than "one click" there —
the effect re-runs on every mount of the detail page, and clearing the device
does not stop at the device:

> `enterAccount` clears the selection → `App.tsx` subscribes the device store to
> `wsClient.sync()` → `ws.ts` keys the socket URL on `selectedDeviceId`, so the
> WebSocket **closes** → `DeviceSwitcher`'s auto-select effect then adopts
> `devices[0]` of whatever the new scope returns → a second `sync()` **reopens**
> it → and `useDevices` refetches under the new `devicesKey(scope)`.

So an unguarded write is a socket teardown, a socket reconnect and a refetch on
every navigation back to a page the operator was already scoped to. The guard is
a raw `!==` between two strings, so it can never wrongly report *equal* for two
different ids; the failure it *can* have — reporting *different* for values that
normalise to the same thing — costs one extra clear, which is the harmless
direction.

### The device switcher will adopt a foreign device on its own, and the bar is the answer

That same chain has a consequence the panel is right to insist is stated rather
than discovered: after a legitimate scope change, `DeviceSwitcher`'s existing
effect — untouched by this ticket — sees that the selected device is no longer in
the list and selects `devices[0]`, which is now **a device belonging to the
customer's account**. No operator action is involved.

That is not a regression this ticket introduces; it is the pre-existing
auto-select meeting the first feature able to change the underlying list, and
removing the auto-select would change behaviour for every existing principal
(`NFR-1` forbids it). The mitigation is the one the spec's business goal already
names, and it is why the context bar ships in the **same** change rather than a
later one: the operator is told, persistently and in the chrome, which account
they are acting inside.

It is also why the bar is mounted **above the header** rather than above `<main>`
as revision 1 had it. The device switcher sits in that header; a warning
underneath the control it is warning about is a warning in the wrong place.

### The navigation table moves out of the shell, and gains one optional field

`app-shell.tsx` already holds `navGroups` as a data table. The smallest change
satisfying `AC-6/7/9` is to move that table to `src/components/layout/navigation.ts`,
add an optional `permission` to an item, and export one pure filter:

```ts
export function visibleNavGroups(granted: readonly string[] | null | undefined): NavGroup[]
```

It drops an item whose `permission` is not held, then drops a **group** left with
no items — otherwise a principal with no administrative rights renders an
"Administration" heading over nothing.

`AC-9` — absent, not disabled — is satisfied by the return type: the filter
returns items, and `NavItem` has nowhere to put a `disabled` flag. A source-policy
rule additionally asserts that neither `navigation.ts` nor `app-shell.tsx` names
`disabled`, so the shape cannot be added later in either half without the build
going red. Both files are free of the word today.

Two entries are relabelled, and the reason is a collision this ticket creates:
`/account` (the WhatsApp **profile** — avatar, push name, privacy, contacts) is
currently labelled "Account", and "Accounts" is about to appear next to it in the
same sidebar. The existing entry is relabelled **Profile**, which is what that
page has always been; the new one keeps **Accounts** as `AC-6` words it, and moves
into its own **Administration** group. The home entry is relabelled **Home**: it
renders three different surfaces now, so "Devices" would be wrong for two of the
three. No route changes.

### The shell reads the permission array once, and the switcher boolean once

```tsx
const groups = visibleNavGroups(usePermissions())                            // one subscription
const canLeaveOwnAccount = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE_ALL)  // one more
```

Two subscriptions for the whole shell however far the table grows — `AC-10` and
`NFR-2`. `NavContent` is rendered twice (the sidebar and the mobile `Sheet`), so
it takes `groups: NavGroup[]` as a **prop** and opens no subscription of its own;
otherwise the hoisting is undone by the second render site.

`usePermissions()` returns the store's own array (or the frozen `NO_PERMISSIONS`),
so the snapshot is stable; the filter runs in render over that value and its fresh
result never reaches `useSyncExternalStore`. The tempting alternative — a
`selectVisibleNavGroups` selector — is exactly the render loop `NO_PERMISSIONS`
exists to prevent (`NFR-3`), and it is not written.

The stated cost, corrected from revision 1: the shell re-renders when the `user`
object's *identity* changes, which `storeTokenPair` does on a refresh carrying a
principal — roughly every fifteen minutes. The routed subtree is spared not
because "react-router does not remount on a parent re-render" (revision 1 said
that; it is about remounting and is not the mechanism) but because `<Outlet/>`
returns the same element identity out of route context, so React bails out of
re-rendering it. The **header** subtree — device switcher, ws badge, theme
toggle, user menu, account switcher, context bar — does re-render. That is a
handful of cheap components twice an hour, and it is accepted.

### `useHomeSurface()` belongs beside the one reader of `permissions`

`C-2` allows exactly one module to read the field off the principal, so the
selector goes into `src/hooks/use-permissions.ts` next to the four already there:

```ts
export function selectHomeSurface(state: AuthState): HomeSurface {
  return homeSurface(state.user?.permissions)
}
export function useHomeSurface(): HomeSurface { return useAuth(selectHomeSurface) }
```

It selects a **string**, so the snapshot is a primitive and the identity problem
above does not arise for the home page. `homeSurface` itself still takes an
argument and reads nothing — the hook is the bridge, which is what that file
already describes itself as.

### `/` becomes a dispatcher; the device grid is not touched

`src/pages/home.tsx` switches on `useHomeSurface()` and renders one of three
things. The `device` arm renders the existing `DashboardPage` **unchanged** —
same file, same component, same query, same empty state. `AC-4` and `NFR-1` are
then true by construction: for a principal with neither accounts permission the
tree below `/` is what it is today.

The two administrative arms live in `home.tsx` as local components rather than in
a `src/features/home/` directory. They are two cards; a directory for them is the
abstraction the senior lens is right to flag.

- **platform** — the number of accounts from `useAccounts()`, a link to
  `/accounts`, and a link onward to the device surface. The accounts link is
  rendered from the same `accounts.manage` gate as the nav entry, so a
  (degenerate) principal holding `.manage.all` without `.manage` is never offered
  a route that would deny them.
- **account** — the principal's own account, named by looking its `account_id` up
  in the same `useAccounts()` result, with a link to `/accounts/:ownId` and, when
  held, to `/users`.

### `useAccounts()` is one query, gated, keyed and cached

```ts
// src/hooks/use-accounts.ts
export function useAccounts() {
  const authenticated = useAuth((s) => s.status === 'authenticated')
  const mayManageAccounts = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)
  return useQuery({
    queryKey: accountsKey(),
    queryFn: listAccounts,
    enabled: authenticated && mayManageAccounts,
    staleTime: 5 * 60_000,
  })
}
```

`GET /accounts` requires `accounts.manage`; firing it without one manufactures a
403 the user then has to be told about. The `enabled` gate is an affordance, not
enforcement — the server still guards the route (`NFR-4`).

`staleTime` is not decoration. `app-shell.tsx` keys `<main>`'s child on
`location.pathname`, so `HomePage` **remounts** on every navigation back to `/`,
and the client's defaults (`src/main.tsx` sets only `retry: 1` and
`refetchOnWindowFocus: false`) leave `staleTime: 0` — every visit to the home
screen would be a fresh `GET /accounts`. Five minutes is chosen rather than
`Infinity` because ticket 9 will create and delete accounts and a stale list is a
real thing an operator can see; those mutations will invalidate `accountsKey()`
explicitly, and the window bounds the damage if one forgets.

`accountsKey()` is ticket 6's builder, which had no caller. This is it. Three
components read the same list from one request because they share the key.

### The context bar renders from the scope alone; the name only enriches it

The bar is the spec's single defence against the worst mistake this phase makes
reachable, so it may not be gated on a network request that can be pending, slow
or refused:

```tsx
export function AccountContextBar() {
  const scope = useAccountStore((s) => s.accountId)          // string | null
  const ownAccountId = useAuth((s) => s.user?.account_id ?? null)
  if (!isForeignScope(scope, ownAccountId)) return null
  return <ForeignAccountBar accountId={scope!} />
}
```

Two primitive selectors, no request, an early return — so an account
administrator, for whom the bar can essentially never show, pays nothing for it on
every screen. The inner component mounts only for a genuinely foreign scope, and
it **always renders the bar**: `useAccounts()` supplies the name when it resolves,
and while it is pending or after it fails the bar is already on screen carrying
the raw account id.

`isForeignScope(scope, own)` is pure and lives in `surfaces.ts`:

- `null` scope — the implicit scope — is never foreign; it *is* the principal's
  own by definition;
- a blank or whitespace-only scope is read as implicit, matching
  `scopedDeviceFilter`'s rule that a blank `account_id` means *no filter* and
  never *the account with no id*;
- a `null` **own** account id (no principal loaded — pre-boot, or a torn-down
  session mid-render) with an explicit scope is **foreign**. Fail loud: the
  expensive error is failing to mark a foreign account, never marking one
  unnecessarily;
- a blank (`''`) own account id — §11's "belongs to no account" — is the same
  answer for the same reason;
- otherwise foreign when the two trimmed strings differ.

The way back is `enterAccount(null)`, which ticket 6 already made atomic: it
clears the device selection **before** it moves the lens, so no subscriber
observes `(new scope, old device)`. `AC-16` is therefore delivered by an action
already unit-tested for exactly that property; this ticket adds the caller.

### An account name is operator-chosen server text, and it is treated as such

The bar is the control that prevents scope confusion, so the name inside it is
worth attacking: an account called `Your own account`, or one carrying a
right-to-left override, spoofs the one signal the operator has. Three rules,
all in the pure `accountName(accounts, id): string | null`:

1. **Unicode control and format characters are stripped** (`\p{Cc}`, `\p{Cf}`) —
   that is the bidi overrides `U+202A..202E` and `U+2066..2069`, the zero-width
   joiners, and `LRM`/`RLM`. They cannot survive into the chrome.
2. **The name is capped** at 60 characters, following the `MAX_SERVER_MESSAGE`
   precedent in `auth-messages.ts` — a shorter cap than that one because this is
   header chrome rather than a notice body.
3. **A blank or unknown name returns `null`,** and the bar then shows the id
   alone rather than inventing a label.

And the raw `account_id` is rendered **beside the name, always**, through the
existing `IdText`. Homoglyphs cannot be defeated by sanitising; an id the
operator can compare can. Everything is a React text child, so it is escaped
(`NFR-5`).

### The account switcher is a menu, not a `Select`

Radix's `Select` cannot express this control: the implicit scope is `null`, and
Radix throws on an item whose `value` is the empty string, so "my own account"
would need a sentinel string that an account id could in principle collide with.
A `DropdownMenu` — the pattern `UserMenu` already uses — has no value plumbing,
expresses `null` directly, and lets a non-item hint be rendered among the items.

Radix mounts menu content only while it is open, so the list costs nothing on the
screens where nobody opens it. It is still capped at **50** accounts with a
trailing line pointing at `/accounts`, because `GET /accounts` has no pagination
and, for a `.manage.all` holder, returns every account on the deployment. The
assumed order of magnitude is *tens*; a deployment with thousands of accounts
needs the search that belongs to ticket 9's accounts screen, and the cap is what
stops that being discovered as a frozen header.

It is `hidden sm:flex`: the header is 56px and already carries the device
switcher, the socket badge, the theme toggle and the user menu. The control is
`accounts.manage.all`-only, so hiding it below `sm` costs a super administrator a
wider window and costs everyone else nothing.

### The permission-denied route surface renders, and does nothing else

```tsx
export function RequirePermission({ permission }: { permission: Permission }) {
  return useHasPermission(permission) ? <Outlet /> : <PermissionDenied />
}
```

No `<Navigate>`, no refresh, no `signOut`. `AC-13` says a 403 is a permission
rejection and not an identity rejection, and the strongest available proof is
that neither file names any of the three teardown entry points — asserted in
`source-policy.test.ts` and mutation-tested by adding one.

The guard is nested **inside** `RequireSession` in `App.tsx` and stays there. It
decides from client state, so on its own it would answer "denied" for a principal
whose `user` has not loaded; it is safe only because `RequireSession` holds the
whole tree at `status: 'unknown'` above it. That ordering is a precondition, not
an accident, and it is written down here so a later route reshuffle cannot invert
it silently.

`PermissionDenied` is a separate file rather than folded into the guard because it
has two callers in this ticket: the route guard, and the account detail page
refusing a foreign id to a principal who may not leave their own account.

The copy is not invented: `PERMISSION_DENIED` in `src/lib/auth-messages.ts` is
already exactly this sentence, written and tested in ticket 6. One vocabulary for
the client-side guard and for the server's own 403. The server path is already
correct and is not touched — `http.ts` recovers only a `401`, so a real 403
spends no refresh today, which its existing tests assert.

### The role-name collision, settled by not needing an exemption

The study (§13) predicts this ticket must widen the role allowlist. **It does
not, and that is the stronger outcome.**

Every file this ticket adds decides from `permissions[]`. None needs the word:
`surfaces.ts` compares permission constants, `navigation.ts` carries a
`permission` field, the guards call `useHasPermission`. The users *screen* is
ticket 10's, and `src/api/users.ts` — the one file that genuinely cannot avoid
`roles[]` — was already exempted in ticket 6, narrowed by a counting rule that
allows the declaration and nothing else.

So `AC-18` is satisfied vacuously: nothing is widened, so nothing needs
justifying. What this ticket adds instead is the positive assertion the study asks
for in the same paragraph — that the decision path is built on `permissions[]`
alone:

- **RULE: the two decision modules import no store and name no role.**
  `surfaces.ts` and `navigation.ts` may not match
  `(?:from|import\()\s*['"][^'"]*stores\/` — the shape the neighbouring
  account-lens rule already uses, so a relative or dynamic import is caught too,
  not only the aliased spelling — and may not match `\brole\b|\broles\b`.
- **RULE: a navigation entry is absent, never disabled.** Neither
  `navigation.ts` nor `app-shell.tsx` may name `disabled`. Both are free of it
  today. The real guarantee is the filter's return type; this stops the shape
  being added to either half later.
- **RULE: the permission-denied surface ends no session and navigates nowhere.**
  `require-permission.tsx` and `permission-denied.tsx` may not name
  `signOut|endRefusedSession|refreshSession|Navigate`.
- **RULE: `<Can>` is not used in a file that renders a list.** Study §13 rule 3,
  made runnable: a file matching `<Can[\s/>]` may not also match `\.map\(`. The
  anchor is the senior lens's correction — the bare `<Can` would have matched
  `<Canvas` and `<Candidate`. The lens argued for dropping the rule entirely
  since `<Can>` has zero call sites; it is kept because this repository's own
  precedent is to write the free rule before somebody finds the gap (the
  bracket-access role rule says so in its own comment), and because the study
  names it as one of the three rules this phase collides with. The false positive
  it can produce — a screen-level `<Can>` in a file that also renders an
  unrelated list — demands a hoist, which is the right change anyway.
- **The account-lens allowlist is widened, with justification.** The existing
  rule permits `App.tsx` and `use-devices.ts` to import `stores/account.ts`. Three
  files are added, each owning or moving the scope: the switcher, the context bar
  and the account detail page. Nothing in `src/lib/` is added, so "no lib module
  reaches the lens" stays true.

### The three new screens are placeholders, deliberately

`C-5` and the ticket's out-of-scope list put the accounts, account-devices and
users surfaces in tickets 8, 9 and 10. Building a read-only accounts list here is
work ticket 9 rewrites, and it smuggles the account lifecycle into a navigation
ticket.

So `/accounts`, `/accounts/:accountId` and `/users` render a `PageHeader` and an
`EmptyState` naming the ticket that fills them — with the two exceptions that are
this ticket's own: the detail page **writes the scope** (or refuses it), and it
offers "Open this account", which navigates to `/` with the scope set. That last
piece is what makes the context bar reachable and therefore what makes `AC-15`
and `AC-16` demonstrable at all.

### What is deliberately not built

- No `features/home/` directory, no `RouteGuard` taking a permission list, no
  route registry beyond the two-entry `SURFACE_PERMISSIONS`. Each is an
  abstraction with one or two callers.
- No change to `<Can>`, to `DeviceSwitcher`'s auto-select, to `useDevices`,
  `scopedDeviceFilter`, the query keys, or any API module. Ticket 6 built them to
  be used unchanged, and they are.
- No `GET /accounts/{id}` client and no account-count endpoint; there are none on
  this wire.
- No `account_name` on `/auth/me` and no invented label for a principal who
  cannot call `GET /accounts` (study `Q-4`).
- No route-level code splitting: `vite-plugin-singlefile` inlines every chunk into
  one `dist/index.html`, so `lazy()` would buy nothing.

## Steps

1. Add `src/lib/surfaces.ts` — `HomeSurface`, `homeSurface`, `isForeignScope`,
   `mayEnterAccount`, `accountScopeEntry`, `accountName`. Pure; imports only
   `@/lib/permissions`.
2. Add `src/lib/surfaces.test.ts`.
3. Add `src/components/layout/navigation.ts` — `NavItem`, `NavGroup`,
   `SURFACE_PERMISSIONS`, `NAV_GROUPS`, `visibleNavGroups`.
4. Add `src/components/layout/navigation.test.ts`.
5. Extend `src/hooks/use-permissions.ts` with `selectHomeSurface` / `useHomeSurface`.
6. Add `src/hooks/use-accounts.ts`.
7. Add `src/components/shared/permission-denied.tsx`.
8. Add `src/components/layout/require-permission.tsx`.
9. Add `src/components/layout/account-switcher.tsx` — a `DropdownMenu`, capped,
   with an explicit "My account" entry calling `enterAccount(null)`.
10. Add `src/components/layout/account-context-bar.tsx` — the two-component split.
11. Add `src/pages/home.tsx` — the dispatcher and the two summaries.
12. Add `src/pages/accounts.tsx`, `src/pages/account-detail.tsx`,
    `src/pages/users.tsx`.
13. Edit `src/components/layout/app-shell.tsx` — render `visibleNavGroups` into a
    prop-taking `NavContent`, mount the switcher behind `accounts.manage.all`,
    mount the context bar **above** the header.
14. Edit `src/App.tsx` — `/` to `HomePage`, three routes behind
    `RequirePermission`, inside `RequireSession`.
15. Edit `src/lib/source-policy.test.ts` — four rules, the widened account-lens
    allowlist.
16. Run the `ui-source` profile and `ui-build`, then the mutation pass.

## Files to change

**Added (13)**

| File | What |
|---|---|
| `src/lib/surfaces.ts` | the six pure decisions |
| `src/lib/surfaces.test.ts` | their tests |
| `src/components/layout/navigation.ts` | the navigation model and its filter |
| `src/components/layout/navigation.test.ts` | its tests |
| `src/hooks/use-accounts.ts` | `useAccounts()` |
| `src/components/shared/permission-denied.tsx` | the denied surface, two callers |
| `src/components/layout/require-permission.tsx` | the route guard |
| `src/components/layout/account-switcher.tsx` | the header switcher |
| `src/components/layout/account-context-bar.tsx` | the persistent bar |
| `src/pages/home.tsx` | the `/` dispatcher + two summaries |
| `src/pages/accounts.tsx` | placeholder surface |
| `src/pages/account-detail.tsx` | placeholder + the scope write / refusal |
| `src/pages/users.tsx` | placeholder surface |

**Edited (4)**

| File | Change |
|---|---|
| `src/App.tsx` | `/` → `HomePage`; three guarded routes added |
| `src/components/layout/app-shell.tsx` | nav from the model; switcher; context bar |
| `src/hooks/use-permissions.ts` | `selectHomeSurface`, `useHomeSurface` |
| `src/lib/source-policy.test.ts` | four rules; account-lens allowlist widened |

**Not changed.** No deployment runtime file (`C-1`). No file under `src/api/`,
`src/stores/`, `src/features/`, or `src/lib/` beyond `surfaces.ts` and the policy
test. `src/pages/dashboard.tsx`, `src/components/layout/device-switcher.tsx`,
`src/hooks/use-devices.ts` and `src/lib/http.ts` are untouched. In particular the
session-teardown effect in `App.tsx` that calls `enterAccount(null)` is left
exactly as ticket 6 wrote it — it is what stops a second principal on a shared
browser booting into the previous one's lens — and it is in the mutation pass.

## Validation strategy

Profile **`ui-source`** (`ui-typecheck`, `ui-lint`, `ui-test`), plus `ui-build`
run by hand to confirm the single-file output still builds and to record the
bundle delta — this is the first ticket of the phase that actually *ships* the
ticket-6 modules, so the delta answers "what has phase 2 cost so far".

On top of the profile, a **mutation pass**: every rule added to
`source-policy.test.ts` and every branch of the pure functions is broken on
purpose, the suite shown to go red, and the break reverted byte for byte.
The mutations that matter most:

- swap the two `hasPermission` checks in `homeSurface` — a super administrator
  must stop reaching the platform surface;
- gate the Accounts nav entry on `accounts.manage.all` — the study's named
  mistake must fail a test;
- return the parent group when all its items were filtered away;
- drop `mayLeaveOwnAccount` from `mayEnterAccount` — the URL hole must reopen and
  a test must catch it;
- make `accountScopeEntry` write the explicit id for the principal's own account;
- remove its idempotence guard — the device clear, and with it the socket
  teardown and reconnect, must be shown to return;
- make `isForeignScope` answer `false` for a `null` or blank own-account id;
- let `accountName` through a bidi override, and past the cap;
- name `signOut` in the permission-denied surface;
- put `<Can>` beside a `.map(`;
- import a store into `surfaces.ts`, relatively as well as aliased;
- delete the `enterAccount(null)` from `App.tsx`'s session teardown.

Plus one behaviour verified by hand rather than by a rule: a persisted
`gowa-ui.account.v1` holding a foreign account is restored on reload, and the bar
is present on that first render.

## Rollback

Delete the thirteen added files and revert the four edits; the tree returns to
ticket 6 exactly. There is no migration, no persisted-shape change (the account
store's `gowa-ui.account.v1` name and shape are untouched), and no API contract
change.

**One manual step is required, and it is the reason this section is not just
"revert".** This ticket is the first thing in the repository that can write a
*non-null* `gowa-ui.account.v1`. A revert removes the switcher, the context bar
and the detail route — that is, every way of seeing or clearing a scope — while
leaving the persisted value behind, where `useDevices` keeps filtering on it. An
operator who had entered an account must **sign out once** after the revert;
`App.tsx`'s teardown calls `enterAccount(null)` and the value is gone. Clearing
the key by hand in devtools does the same thing.

The other behaviour a revert restores is the nav labels: `Devices` and `Account`
in place of `Home`, `Profile` and the Administration group.

## Out of scope

As `spec.md > Out of scope`. In particular: the content of the three new screens,
the composer/chat-write gating, the account lifecycle, and any `http.ts` change.

## Panel response

Three advisory lenses reviewed revision 1 before any code was written. Twenty-six
findings; **two majors were the same defect found independently**, which is what
changed the design.

### The defect two lenses found on their own

`major` — *the `/accounts/:accountId` scope write was gated on `accounts.manage`,
so an account administrator could acquire a foreign scope from a URL* (senior;
security). Both traced the same consequence: the filter passes, the server answers
`200` with an empty array rather than `403`, and the operator reads *I have no
devices*.

**Adopted, and generalised past what either lens asked for.** The security lens
offered "require `.all`, **or** require the param to equal the principal's own
id"; taking *both* arms is what makes the rule complete — an administrator keeps
their own detail page, and nobody else's. It is enforced in `mayEnterAccount`, in
the pure layer, so it holds for the URL, the switcher and anything tickets 8–10
add rather than at one call site. A refused id renders the permission-denied
surface instead of silently doing nothing, and the negative test both lenses asked
for is in `surfaces.test.ts`.

It also produced a second correction neither lens raised: entering *your own*
account now writes the **implicit** scope, not the explicit id. The explicit form
would have given the same devices under a second cache key, a second request, and
a device clear — for navigating to your own page.

### The findings that changed the design

`major` — *the context bar may render nothing while `useAccounts()` is pending or
after it fails, leaving the operator unmarked inside a customer account during
exactly that window* (security). **Adopted.** The bar now renders from the store's
scope alone and the name only enriches it; `accountName` returns `null` and the
bar shows the raw id. This was the finding that most nearly shipped a defence that
is absent when it is most needed.

`major` — *`useAccounts()` declares no `staleTime`, and `<main>` is keyed on
`location.pathname`, so `HomePage` remounts and refetches `GET /accounts` on every
navigation back to `/`* (performance). **Adopted** — `staleTime: 5 * 60_000`. The
lens suggested `Infinity`; five minutes is chosen because ticket 9 mutates
accounts and a bounded window limits the damage of a forgotten invalidation.

`major` — *the account switcher renders every account on the platform in the
header of every screen, uncapped and unsearchable* (performance). **Adopted, with
a different mechanism than the lens proposed.** It became a `DropdownMenu` rather
than a `Select` — which also resolves the senior lens's separate finding that
Radix's `Select` cannot represent the `null` implicit scope without a sentinel —
capped at 50, mounted only while open, `hidden sm:flex`. The assumed order of
magnitude (tens) is recorded above rather than assumed silently.

`major` — *the scope write clears the device selection and `DeviceSwitcher`'s
auto-select then adopts the foreign account's first device with no operator
action; "no change to device-switcher" is true of the file and false of its
behaviour* (senior). **Adopted as a documented consequence, not a code change.**
Removing the auto-select would change behaviour for every existing principal
(`NFR-1`). It is written into the plan, it is the reason the bar ships in the same
change, and it is the reason the bar moved above the header — which the security
lens asked for independently.

`minor` — *the bidi/homoglyph spoof: an operator-chosen account name renders
inside the app's own chrome and can imitate "your own account"* (security).
**Adopted in full**: control and format characters stripped, a 60-character cap,
and the raw id rendered beside the name always.

`minor` — *`isForeignScope`'s contract enumerated a blank own-account id but not
`null`, which is what the component actually passes pre-boot* (security).
**Adopted** — `null` is specified as foreign, fail-loud, and asserted.

`minor` — *rollback is incomplete: this is the first thing that can write a
non-null persisted scope, and a revert removes every way to clear it* (senior).
**Adopted** — "sign out once after reverting" is now an explicit rollback step.
This was the finding with the longest tail: it is a defect that only appears after
the change is undone, which is the case nobody tests.

`minor` — *`src/lib/navigation.ts` puts the first value-level React/lucide import
into `src/lib/`* (senior). **Adopted** — the table moved to
`src/components/layout/navigation.ts`. `lib/` stays node-pure; `surfaces.ts` stays
in `lib/` because it imports nothing but `permissions.ts`.

`minor` — *`NavContent` renders twice (sidebar and mobile sheet); if it keeps
calling the hook the hoisting is undone* (performance). **Adopted** — it takes
`groups` as a prop and opens no subscription.

`minor` — *the accepted shell re-render is justified with the wrong mechanism*
(performance). **Adopted** — the reason is corrected to `<Outlet/>` element
identity and React's bailout, and the fact that the header subtree *does*
re-render is now stated rather than implied.

`minor` — *the "no store import" rule matched only the aliased specifier, weaker
than the account-lens rule it copies* (senior). **Adopted** — same
`(?:from|import\()\s*['"][^'"]*stores\/` shape.

`minor` — *`<Can` also matches `<Canvas` / `<Candidate`* (senior). **Adopted** —
anchored to `<Can[\s/>]`. The lens's stronger recommendation to drop the rule is
**declined**: the repository's own precedent is to write the free rule before the
gap is found, and the study names this as one of the three rules the phase
collides with.

`minor` — *"absent, never disabled" is asserted on the model but a `disabled` prop
would be added in the shell* (senior). **Adopted** — the rule covers
`app-shell.tsx` too (free today), and the plan now says plainly that the real
guarantee is the filter's return type.

`minor` — *two sidebar entries one character apart, "Accounts" and "Account", for
unrelated concepts* (senior). **Adopted, inverted.** Rather than renaming the new
entry away from what `AC-6` calls it, the *existing* `/account` entry is
relabelled **Profile** — which is what that page has always been — and the new
entries move into their own Administration group. No route changes.

`minor` — *the header already carries four controls at 56px and no mobile layout
was stated* (senior). **Adopted** — `hidden sm:flex`, justified by the switcher
being `.all`-only.

`minor` — *the `App.tsx` edit sits in the same file as the session teardown that
calls `enterAccount(null)`* (security). **Adopted** — recorded as untouched and
added to the mutation pass.

`minor` — *the persisted lens survives a browser restart, so a super admin returns
days later already scoped into a customer* (security). **Adopted** — the restored
scope on reload is an explicit hand-verified item in the validation strategy, and
it is the second reason the bar sits above the header.

`minor` — *entering an account tears down and reopens the WebSocket, not just the
device selection* (performance). **Adopted** — the full chain is written out, and
it is now the stated justification for the idempotence guard, which revision 1
justified only as "drops your device selection".

### Adopted as records rather than as changes

`minor` — *both administrative reads fetch the whole account list for one scalar,
and there is no `GET /accounts/{id}`* (performance). Accepted as stated: one
shared key dedupes the request, and the case for a single-account read is recorded
for ticket 9.

`info` — *`accountsKey()` carries no principal, so correctness rests on
`App.tsx` clearing the cache at session end; this ticket adds the first dependant
on that coupling* (security). Recorded; no key change while the reset stands.

`info` — *`RequirePermission` decides from client state and is safe only because
`RequireSession` holds the tree above it* (security). Adopted as a written
precondition in the plan, so a route reshuffle cannot invert it silently.

`info` — *`surfaces.ts` is called "four decisions" but exports five* (senior).
Reconciled — it is six now.

`info` — *`permission-denied.tsx` and `require-permission.tsx` are two files for
one surface with one caller* (senior). The premise changed with the URL fix: the
surface now has two callers, the route guard and the account detail page. Kept
separate, with the reason written in the plan.

`info` — *no code splitting; the delta is what matters* (performance) and *no
token, storage, transport or `http.ts` surface is touched* (security). Agreed;
no action beyond recording the measured delta.

`info` — *keeping `visibleNavGroups` out of a zustand selector, and reading the
scope through `getState()` in the effect rather than subscribing, are both the
right calls* (performance). Preserved verbatim through implementation.
