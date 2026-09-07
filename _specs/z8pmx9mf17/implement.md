---
ticket: z8pmx9mf17
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf17"
  github: ""
---

# Implementation — 7 · Derive navigation and the home surface from permissions

Applied on branch `ticket/z8pmx9mf17`, cut from `ticket/z8pmx9mf16` — this
ticket is that ticket's first consumer, so the branch is stacked rather than cut
from `main`. Working-tree changes only; no commit is created here, and the single
publishable commit belongs to `/publish-pr`.

## Files changed

**Added — 13** (matching `plan.md > Files to change` exactly)

| File | Lines | What |
|---|---|---|
| `src/lib/surfaces.ts` | 238 | `homeSurface`, `isForeignScope`, `mayEnterAccount`, `accountScopeEntry`, `accountName` |
| `src/lib/surfaces.test.ts` | 276 | 30 tests over those five |
| `src/components/layout/navigation.ts` | 148 | `NavItem`, `NavGroup`, `SURFACE_PERMISSIONS`, `NAV_GROUPS`, `visibleNavGroups` |
| `src/components/layout/navigation.test.ts` | 115 | 13 tests |
| `src/hooks/use-accounts.ts` | 49 | the one `GET /accounts` query, gated and cached |
| `src/components/shared/permission-denied.tsx` | 32 | the refusal surface, two callers |
| `src/components/layout/require-permission.tsx` | 31 | the route guard |
| `src/components/layout/account-switcher.tsx` | 100 | the header menu, capped at 50 |
| `src/components/layout/account-context-bar.tsx` | 84 | the two-component split |
| `src/pages/home.tsx` | 201 | the `/` dispatcher and the two summaries |
| `src/pages/accounts.tsx` | 29 | placeholder surface |
| `src/pages/account-detail.tsx` | 92 | placeholder + the scope write / refusal |
| `src/pages/users.tsx` | 27 | placeholder surface |

**Edited — 4** (matching `plan.md` exactly)

| File | Change |
|---|---|
| `src/App.tsx` | `/` → `HomePage`; three routes behind `RequirePermission`, inside `RequireSession` (+27 −2) |
| `src/components/layout/app-shell.tsx` | nav from the model; switcher; context bar above the header (+51 −46) |
| `src/hooks/use-permissions.ts` | `selectHomeSurface`, `useHomeSurface` (+22) |
| `src/lib/source-policy.test.ts` | six new rules; the account-lens allowlist widened (+159) |

**Not changed.** No deployment runtime file. `src/pages/dashboard.tsx`,
`src/components/layout/device-switcher.tsx`, `src/hooks/use-devices.ts`,
`src/lib/http.ts`, `src/lib/device-scope.ts`, `src/lib/query-keys.ts`,
`src/stores/account.ts` and every file under `src/api/` are untouched. The
session-teardown effect in `App.tsx` that calls `enterAccount(null)` is exactly
as ticket 6 wrote it, and is now covered by a rule and a mutation.

**Carried in the same working tree, not produced by this ticket:** a one-line
`links.github` backfill on `_specs/z8pmx9mf16/ticket.md`, left over from PR #6.

## Deviations from the plan

### 1. The permission moved *inside* `accountScopeEntry`, because the mutation pass showed the plan's shape was untestable

`plan.md` had the component call `mayEnterAccount` and then, separately, call
`accountScopeEntry`. Both functions were written, both were unit-tested, and both
passed — and then the mutation `if (!permitted && false) return` **survived**:
with the guard deleted from the effect, every test in the repository stayed
green and the scope hole the panel found was open again.

That is the exact failure this repository's no-renderer constraint produces, and
the fix is structural rather than another test. `accountScopeEntry` now takes
`mayLeaveOwnAccount` as a **required fourth argument** and refuses on its own:

```ts
if (!mayEnterAccount(routeAccountId, ownAccountId, mayLeaveOwnAccount)) return null
```

Bypassing it is now a missing argument — a compile error (**M26**), not a silent
scope write. `mayEnterAccount` stays exported for the *render* decision, which is
a different question: what to show, rather than what to write.

The redundant `if (!permitted) return` was then **removed** from the effect. It
had become a line that reads like the thing keeping the code safe while no longer
being it, which is worse than not being there.

### 2. Two more source rules than the plan listed, and they exist because a mutation survived

`plan.md` named four rules. Six shipped. The two extra are both text assertions
over JSX, which is a weaker instrument than a unit test and is used only where
this environment has no other reach:

- **the detail route writes only the pure decision** — kills a page that writes
  the route parameter directly (**M23**), one that fabricates a `ScopeEntry`
  rather than asking for one (**M24**), and one whose render guard is inverted
  (**M25**);
- **the shell mounts the switcher behind `accounts.manage.all`** — kills an
  unconditional mount (**M28**) and a gate narrowed to `accounts.manage`
  (**M29**), which is `AC-8` and is otherwise unassertable.

### 3. The role allowlist was not widened, and `users.tsx` copy was rewritten rather than exempted

The study (§13) predicts this ticket must widen the role allowlist. It did not
need to: every file added decides from `permissions[]`, and none names a role.

One thing did fire — the **password** rule, on the `/users` placeholder's own
copy ("…editing and password reset arrive with…"). The rule matches the substring
deliberately, and the right answer was the same one ticket 6 reached for
`auth-messages.ts`: change the sentence, not the rule. The hint now reads
"the credential reset", the allowlist is untouched, and the rule still guards
that file.

The rule for the two decision modules was additionally made **case-insensitive**,
which is free (neither file contains the word in any casing). What that does
*not* close — and the comment now says so rather than over-claiming — is a role
name buried inside a longer identifier (`adminRoles`, `ROLE_MAP`): `\b` does not
match between two word characters. That is not a gap, because such a constant
decides nothing until the field is **read**, and every spelling of the read is
caught: dot access (**M19**), destructuring rename (**M20**), bracket access
(**M21**). **N2** is the control proving the unused-identifier case is genuinely
equivalent rather than quietly missed.

### 4. The account switcher is a `DropdownMenu`, not a `Select`

Adopted from the panel before implementation and confirmed in the code: Radix's
`Select` throws on an item with an empty-string value, and the implicit scope is
`null` — so the "my account" entry would have needed a sentinel string an account
id could collide with. A menu carries `null` directly.

### 5. Two navigation labels changed

`/` is **Home** (it renders three surfaces now) and `/account` is **Profile** (it
is the WhatsApp profile page, and "Accounts" was about to appear beside it). Both
were panel findings; no route changed.

### 6. A tooling defect corrupted three regexes, and it is recorded because it nearly shipped

The first version of the source-policy rules was written through a shell heredoc
that collapsed one level of backslash escaping, so `\b` in three regexes became a
literal **backspace byte** (`0x08`). The rules parsed, ran, and passed — against
patterns that could never match.

The first mutation pass is what found it: four mutations survived that should not
have. Every occurrence was repaired, and every rule in the new block is now
mutation-tested in both directions. No other file was affected (`grep -rP '\x08'`
over `src/` returns only the logo asset), and no pre-existing rule was touched.

## The bundle question, with a number

| | `dist/index.html` |
|---|---|
| before (`ticket/z8pmx9mf16` tree) | 1,026,213 bytes |
| after | 1,037,129 bytes |
| delta | **+10,916 bytes** (+1.06%) |

Ticket 6 shipped 1,584 bytes and **none** of its unused exports. This ticket is
where they arrive, and the built file confirms it:

| Marker | Occurrences in `dist/index.html` |
|---|---|
| `gowa-ui.account.v1` | 1 |
| `accounts.manage.all` | 1 |
| `Back to my account` | 1 |
| `Administration` | 1 |

## Validation run

Profile `ui-source`, plus `ui-build` by hand:

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | clean |
| `ui-lint` | `npm run lint` | 4 warnings — the same 4 pre-existing `only-export-components` ones |
| `ui-test` | `npm run test` | **407 passed in 27 files**, up from a 357-in-25 baseline |
| `ui-build` | `npm run build` | 1 file in `dist/`, 1,037,129 bytes |

### Mutation pass — 29 mutations, 3 controls

Every guard this ticket adds was broken on purpose, the gate shown to go red, and
the break reverted byte for byte (asserted by the harness). **29 killed — 27 by
the suite, 2 by the compiler — and 3 controls behaved.**

| # | Mutation | Verdict |
|---|---|---|
| M1 | `homeSurface` order swapped — a super admin loses the platform surface | killed |
| M2 | the Accounts entry gated on `.manage.all` — the study's named mistake | killed |
| M3 | an emptied nav group kept, rendering a bare heading | killed |
| M4 | `mayEnterAccount` drops the `.all` requirement — the URL hole reopens | killed |
| M5 | a principal belonging to no account may enter one | killed |
| M6 | the principal's own account written as an explicit scope | killed |
| M7 | the idempotence guard removed — device clear, socket teardown, reconnect | killed |
| M8 | `isForeignScope` reads an unknown own account as "yours" | killed |
| M9 | `isForeignScope` treats a blank scope as an account | killed |
| M10 | `accountName` lets a bidi override through | killed |
| M11 | `accountName` drops the length cap | killed |
| M12 | the permission-denied guard names `signOut` | killed |
| M13 | the permission-denied route redirects instead of rendering | killed |
| M14 | a `<Can>` in the file that renders the nav list | killed |
| M15 | a navigation entry disabled instead of dropped (the model) | killed |
| M16 | the shell disables an entry instead of dropping it | killed |
| M17 | `surfaces.ts` imports the account store (aliased) | killed |
| M18 | `navigation.ts` imports the auth store **relatively** | killed |
| M19 | the nav model reads a role by dot access | killed |
| M20 | the nav model reads a role by destructuring rename | killed |
| M21 | the surface module reads a role by bracket access | killed |
| M22 | `App.tsx` stops resetting the lens when a session ends | killed |
| M23 | the detail page writes the route param straight into the lens | killed |
| M24 | the detail page fabricates the entry instead of asking | killed |
| M25 | the render guard inverted — a refused id renders the account surface | killed |
| M26 | the permission argument dropped from the call | killed **by the compiler** |
| M27 | `accountScopeEntry` stops consulting the permission | killed **by the compiler** |
| M28 | the switcher mounted without the global permission | killed |
| M29 | the switcher gate narrowed to `accounts.manage` | killed |
| N1 | a role named only in a comment (control) | stayed green, correctly |
| N2 | an identifier containing `Roles` that reads nothing (control) | stayed green, correctly |
| N3 | `disabled` in a shadcn primitive (control) | stayed green, correctly |

M4 is the hole two panel lenses found independently. M23–M27 are the five ways
the detail route could have written a scope it may not, and two of them are now
type errors rather than test failures. M18 is why the store rule matches any
specifier ending in `stores/` rather than only the aliased form — the panel's
correction, proven.

## Open items

- **Nothing was verified against a running gowa server, and there was no browser
  pass.** Every assertion is made against the reference, the tests and the built
  output. In particular the plan's hand-verified item — *a persisted foreign
  scope is restored on reload and the bar is present on that first render* — is
  argued from the code (`AccountContextBar` reads the persisted store
  synchronously and renders before any request) rather than demonstrated on
  screen.
- **`accountsKey()` carries no principal.** Correctness rests on `App.tsx`
  emptying the query cache when a session ends. This ticket is the first
  dependant on that coupling; the security lens raised it and no key change is
  needed while the reset stands.
- **Both administrative reads fetch the whole account list for one scalar** — a
  count and a name — because this wire has no `GET /accounts/{id}` and no count
  endpoint. One shared key dedupes it to a single request.
- **A rollback needs one manual step**: sign out once, or the persisted scope
  outlives every control that could clear it. See `plan.md > Rollback`.
- **The reference disagrees with itself about `GET /accounts`.** Its §04 table
  says the list is restricted to the caller's own account without
  `accounts.manage.all`; the OpenAPI `account` tag says any `accounts.manage`
  holder "can list every account". Nothing here depends on which is true — the
  account summary looks its own `account_id` up in whatever comes back — but it
  is recorded for ticket 9, which will.
- **The study's `Q-1..Q-8` remain open**, `Q-4` (`account_name` on `/auth/me`)
  included: an ordinary user still sees a raw account id, deliberately.
