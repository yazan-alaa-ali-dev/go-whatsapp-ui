---
ticket: z8pmx9mf17
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-07
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf17"
  github: ""
---

# Verification — 7 · Derive navigation and the home surface from permissions

## Validation profile — `ui-source` (+ `ui-build`)

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | clean |
| `ui-lint` | `npm run lint` | 0 | 4 warnings, all pre-existing `only-export-components` in `tabs.tsx`, `use-device-guard.tsx`, `button.tsx`, `badge.tsx` |
| `ui-test` | `npm run test` | 0 | **407 passed in 27 files** (baseline 357 in 25) |
| `ui-build` | `npm run build` | 0 | 1 file in `dist/`, 1,037,129 bytes |

The three files this ticket adds or rewrites account for 75 of those tests:
`surfaces.test.ts` 30, `navigation.test.ts` 13, `source-policy.test.ts` 32.

## Runtime impact (TR-3, VF-9)

**Did any deployment runtime file change? No.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are untouched — confirmed by `git status`, which lists 4 modified
and 13 added files, all under `src/` and `_specs/`.

**Does anything at runtime change for an existing principal? No, and it is
structural.** A principal holding neither accounts permission gets
`homeSurface → 'device'`, and that arm of `HomePage` renders `DashboardPage`
itself — same file, same component, same query, same empty state. Their
navigation loses no entry (`visibleNavGroups` drops only gated items, and the
seven operational entries carry no `permission` at all — asserted, not observed),
and no new request is issued: `useAccounts()` is `enabled` only with
`accounts.manage`. The two visible changes for them are labels: `Devices` → `Home`
and `Account` → `Profile`.

**What does change, and it is the point:** an account administrator lands on an
account summary and gains an Accounts entry; a super administrator lands on a
platform summary and gains an account switcher; and a foreign account scope now
puts a persistent bar above the header.

**One behaviour is newly reachable and is stated rather than buried.** Entering an
account clears the device selection, which closes the WebSocket, lets
`DeviceSwitcher`'s pre-existing auto-select adopt the new account's first device,
and reopens it. That auto-select is untouched (removing it would change behaviour
for every principal); the context bar shipping in the same change is the
mitigation, and it is why the bar sits above the header rather than above the
page content.

## Acceptance criteria — all 22 mapped to an executed result

### The home surface

| AC | Result | Evidence |
|---|---|---|
| **AC-1** — a pure function returns one of three surfaces | PASS | `homeSurface(granted)` in `src/lib/surfaces.ts`; `HomeSurface` is a closed union, so a fourth value does not compile |
| **AC-2** — `.manage.all` → platform, else `.manage` → account, else device, global first | PASS | `surfaces.test.ts` "the global permission wins over the narrower one it implies" asserts `platform` for a principal holding **both**; mutation **M1** (order swapped) is killed |
| **AC-3** — takes the array as an argument, reads no store | PASS | signature takes `readonly string[] \| null \| undefined`; `source-policy.test.ts` "the two decision modules read their argument and nothing else" bans any `stores/` import; mutations **M17** (aliased) and **M18** (relative) both killed |
| **AC-4** — `/` renders the derived surface; the device grid is unchanged | PASS | `src/pages/home.tsx` returns `<DashboardPage />` for `device`; `git status` shows `src/pages/dashboard.tsx` unmodified |
| **AC-5** — platform summarises the accounts, account summarises its own, both link | PASS | `PlatformHome` renders `accounts?.length` and links to `/accounts` and `/users`; `AccountHome` names the principal's own account and links to `/accounts/:ownId` |

### Navigation

| AC | Result | Evidence |
|---|---|---|
| **AC-6** — Accounts appears with `accounts.manage`, not `.manage.all` | PASS | `navigation.test.ts` "accounts.manage — NOT accounts.manage.all — is what shows the Accounts entry" and "the global permission alone opens no surface"; mutation **M2** killed |
| **AC-7** — Users appears with `users.manage` | PASS | `navigation.test.ts` "users.manage shows the Users entry, on its own" |
| **AC-8** — the account switcher appears only with `accounts.manage.all` | PASS | `source-policy.test.ts` "the shell mounts the account switcher behind the global permission"; mutations **M28** (unconditional) and **M29** (gate narrowed) both killed |
| **AC-9** — an unavailable entry is absent, not disabled | PASS | `navigation.test.ts` asserts the exact key set of every item and the whole visible path list; `source-policy.test.ts` bans `disabled` in the model **and** the shell; mutations **M15** and **M16** killed, control **N3** correctly green |
| **AC-10** — booleans hoisted once per screen; no per-row `<Can>` | PASS | `AppShell` opens exactly two subscriptions and `NavContent` takes `groups` as a prop; `source-policy.test.ts` bans `<Can[\s/>]` in any file that also renders a list; mutation **M14** killed |

### Routes

| AC | Result | Evidence |
|---|---|---|
| **AC-11** — the three routes exist behind the session guard | PASS | `src/App.tsx`: all three are nested inside `<Route element={<RequireSession />}>` → `<AppShell />` |
| **AC-12** — the detail route writes the scope; own account → implicit; already-scoped → nothing | PASS | `accountScopeEntry`; `surfaces.test.ts` covers all four rows of its table; mutations **M6** (own written explicitly) and **M7** (idempotence dropped) killed |
| **AC-12a** — no foreign scope from a URL without `.manage.all`; the route renders the refusal | PASS | `mayEnterAccount`, folded into `accountScopeEntry` as a required argument; `surfaces.test.ts` "an account administrator may enter only their own" and "a principal who may not leave their own account writes nothing, whatever the URL says"; mutations **M4**, **M5**, **M23**, **M24**, **M25** killed by tests and **M26**, **M27** by the compiler |
| **AC-13** — a refused route renders a surface; no refresh, no logout | PASS | `RequirePermission` returns `<PermissionDenied />`; `source-policy.test.ts` bans `signOut\|endRefusedSession\|refreshSession\|Navigate` in both files; mutations **M12** and **M13** killed. The server half was already true and is untouched: `src/lib/http.ts` recovers only a `401` |
| **AC-14** — the existing operational routes are unchanged | PASS | `git diff src/App.tsx` changes only the `/` element and adds two guarded blocks; `navigation.test.ts` "the operational entries are never gated" asserts the seven ungated paths |

### Account context bar

| AC | Result | Evidence |
|---|---|---|
| **AC-15** — a foreign scope shows a persistent bar naming the account, with a way back | PASS | `AccountContextBar` in `AppShell`, above the header; `surfaces.test.ts` `isForeignScope` covers implicit, blank, own, foreign, and unknown-own; mutations **M8** and **M9** killed |
| **AC-15a** — it renders from the scope alone; the id is always shown; the name is sanitised | PASS | `ForeignAccountBar` renders unconditionally and `accountName` returns `null` while pending, on failure, and for an unknown or blank name; `IdText` renders the raw id beside it; `surfaces.test.ts` covers bidi overrides, isolates, zero-width marks, an all-stripped name and the cap; mutations **M10** and **M11** killed |
| **AC-16** — leaving returns the scope to implicit and clears the device, in one action | PASS | the bar calls `enterAccount(null)`, whose atomicity (device cleared **before** the lens moves) is asserted in `stores/account.test.ts` from ticket 6 |

### Role names stay out of decisions

| AC | Result | Evidence |
|---|---|---|
| **AC-17** — no new file decides anything from a role | PASS | `source-policy.test.ts` bans `role`/`roles` (case-insensitively) in both decision modules, and the repository-wide rule covers every other added file; mutations **M19** (dot), **M20** (destructuring rename), **M21** (bracket access) killed; controls **N1** (comment) and **N2** (identifier reading nothing) correctly green |
| **AC-18** — the allowlist is widened only for a role displayed or assigned, with written justification | PASS | **nothing was widened.** No added file names a role. The one rule that did fire was the *password* rule, on the `/users` placeholder copy; the copy was rewritten rather than exempted — see `implement.md > Deviations 3` |
| **AC-19** — the build-failing source policy passes | PASS | `npm run test` → `source-policy.test.ts` 32 passed, including the six new rules |

### Testing

| AC | Result | Evidence |
|---|---|---|
| **AC-20** — tests cover the three outcomes, the pair distinction, an empty session, and a composed unknown role | PASS | `surfaces.test.ts` — six `homeSurface` cases including `null`/`undefined`/`[]` and two composed grant sets that share only `accounts.manage`; `navigation.test.ts` — the pair distinction from the navigation side |

## Test cases — all 14 executed

| # | Case | Result |
|---|---|---|
| TC-1 | account administrator: Accounts entry present, switcher absent, account surface at `/` | PASS — `navigation.test.ts` (entry), `source-policy.test.ts` (switcher gate), `surfaces.test.ts` (surface) |
| TC-2 | super administrator: platform surface at `/`, switcher present | PASS — `surfaces.test.ts`, `source-policy.test.ts` |
| TC-3 | ordinary user: device grid at `/`, Accounts and Users absent from the model entirely | PASS — `navigation.test.ts` asserts the whole visible path list equals the seven operational routes |
| TC-4 | a composed role with an unknown name but `accounts.manage` derives the account surface | PASS — `surfaces.test.ts`; two disjoint grant sets give the same answer |
| TC-5 | leaving a foreign account makes the scope implicit and clears the device in one action | PASS — `stores/account.test.ts` (ticket 6, atomicity), plus the bar's call site |
| TC-6 | an empty session derives the device surface and an empty gate set | PASS — `surfaces.test.ts`, `navigation.test.ts` |
| TC-7 | `users.manage` alone shows Users and not Accounts | PASS — `navigation.test.ts` |
| TC-8 | the scope is written on entry and not rewritten when it already names that account | PASS — `surfaces.test.ts`; mutation **M7** |
| TC-9 | foreign is foreign; own, implicit and blank are not | PASS — `surfaces.test.ts`, five cases including unknown-own |
| TC-10 | the permission-denied surface names no teardown and performs no navigation | PASS — `source-policy.test.ts`; mutations **M12**, **M13** |
| TC-11 | `npm run test` passes `source-policy.test.ts`, new rules included | PASS — 32 tests in that file |
| TC-12 | the navigation model names no role and imports no store | PASS — `source-policy.test.ts`; mutations **M17**–**M21** |
| TC-13 | an admin opening another account's URL writes no scope and is refused; their own writes the implicit scope | PASS — `surfaces.test.ts`; mutations **M4**, **M23**–**M27** |
| TC-14 | a name with a bidi override, a zero-width joiner, or 200 characters is sanitised and capped; unknown resolves to nothing | PASS — `surfaces.test.ts`, six cases |

## What the implementation corrected in the plan

- **The permission had to move inside `accountScopeEntry`.** The plan's two-call
  shape passed every unit test *and* left the scope hole reopenable by deleting
  one line — proven by a mutation that survived. Making the permission a required
  argument turned that into a compile error. This is the single most important
  thing the mutation pass bought, because it is the defect two panel lenses found
  in the first place.
- **Two more source rules than planned**, both covering decisions that live in
  JSX where this environment cannot render them.
- **A tooling defect nearly shipped three dead rules.** A shell heredoc collapsed
  `\b` into a literal backspace byte; the rules passed against patterns that could
  never match. Only the mutation pass found it.

## Open items

- **No browser pass and no running gowa server.** The plan's hand-verified item —
  a persisted foreign scope restored on reload, with the bar present on the first
  render — is argued from the code rather than demonstrated: `AccountContextBar`
  reads the persisted store synchronously and renders before any request. It
  should be confirmed on screen when a server is available.
- **A rollback needs one manual step** (sign out once), because this is the first
  change that can leave a non-null persisted scope behind.
- **`GET /accounts` is read twice for two scalars**, and the reference disagrees
  with itself about whether it returns every account to an `accounts.manage`
  holder. Neither affects this ticket; both are recorded for ticket 9.
