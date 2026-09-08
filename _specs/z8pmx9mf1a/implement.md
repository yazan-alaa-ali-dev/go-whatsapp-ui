---
ticket: z8pmx9mf1a
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1a"
  github: ""
---

# Implementation — 10 · Build the users administration surface

Branch `ticket/z8pmx9mf1a`, cut from `ticket/z8pmx9mf19` — this surface becomes a
tab of the account detail screen that ticket built, and depends on the accounts
API layer (`z8pmx9mf16`) and the navigation guard (`z8pmx9mf17`). The pull
request targets `main`, as with every ticket in the phase.

## Files changed

### Added (8)

| Path | Lines | What |
|------|-------|------|
| `src/lib/user-admin.ts` | 572 | Every decision: byte-length validation, the create/update payload builders, the rejection classifier, the password redaction decision, the two detail builders, paging and filtering. |
| `src/lib/user-admin.test.ts` | 531 | 63 tests. |
| `src/hooks/use-users.ts` | 55 | The paged query, gated on `users.manage`. |
| `src/features/user-admin/users-panel.tsx` | 351 | The surface both screens render; owns every dialog and the delete confirmation. |
| `src/features/user-admin/user-row.tsx` | 127 | The `React.memo` row. |
| `src/features/user-admin/create-user-dialog.tsx` | 414 | Create a user, or a customer. |
| `src/features/user-admin/edit-user-dialog.tsx` | 362 | The diff and the two-step confirmation. |
| `src/features/user-admin/reset-password-dialog.tsx` | 193 | The administrative reset. |

### Modified (4)

| Path | Change |
|------|--------|
| `src/lib/surfaces.ts` | `displayText(value, max)` exported; `accountName` rewritten onto it. Behaviour byte-identical — its 41 existing tests pass untouched. |
| `src/lib/source-policy.test.ts` | Two exemption lists enumerated (5 files each) and 12 new rules that narrow them. |
| `src/pages/users.tsx` | Placeholder → the panel. |
| `src/pages/account-detail.tsx` | The two-tab shell (Devices / Users) its own comment deferred to this ticket. |

### Not touched

`src/lib/auth-messages.ts`, `src/api/users.ts`, `src/lib/query-keys.ts`,
`src/App.tsx`, and every deployment runtime file (`vite.config.ts`,
`package.json`, `index.html`, `.github/workflows/*`). **No deployment runtime
file changed** — the `/verify` statement is *no*.

## Deviations from the plan

**1 — Two leaks the new source rules caught in this ticket's own code.**

The plan's rule 11.5 ("no raw `.username` / `.email` inside a template literal")
was written as a guard against future edits. On first run it failed against two
lines written earlier the same hour:

- `create-user-dialog.tsx`: `toast.success(\`User ${created.username} created\`)`
- `edit-user-dialog.tsx`: `\`email → ${payload.email || '(cleared)'}\``

Both are exactly the hazard SEC2 described — the second sits inside the sentence
that authorises signing somebody out of every device they hold. Both now go
through `displayText`. This is recorded as a deviation rather than quietly
fixed, because it is the strongest available evidence that the rule earns its
place: the author of the rule violated it twice within the hour, and the rule,
not review, is what caught it.

**2 — Two of the new rules were written too broadly and were narrowed, once.**

- *The role-literal rule* first read `/\broles?\b[^\n]*(===|!==|==|!=)\s*['"`]/`
  and fired on `role.trim() !== ''` — a blank-entry filter that appears three
  times in this surface legitimately. It now requires a **non-empty** literal
  (`['"`][^'"`]`), so `role === 'admin'` is caught and the blank filter is not. A
  rule that flags correct code is a rule that gets deleted, which is the failure
  mode this file exists to avoid.
- *The interpolation rule* first tested the whole file for `${…​.username…}`,
  which flagged `${displayText(user.username, MAX_DISPLAY)}` — the correct code.
  It now examines **each interpolation on its own** and passes those that call
  `displayText`, so the unit of judgement is the interpolation rather than the
  file.

Neither narrowing weakens the guarantee; both were needed for the rule to state
what it means.

**3 — `MAX_DISPLAY` re-export removed.**

`create-user-dialog.tsx` briefly re-exported it "so the panel and the dialog
agree on one cap". They already agree — both import it from `@/lib/user-admin`.
Removed before the first test run.

**4 — `pageState` takes a row count rather than the row array.**

The plan wrote `pageState(rows, limit, offset)`. It needs only the length, and a
signature taking the array invites a caller to pass the *filtered* rows — which
would make an account filter that hid every row of a full page claim there is no
next page. The panel passes `users.data?.length`, the unfiltered page, and the
distinction is asserted in the panel's comment and in TC-13.

**5 — The `super_admin` checkbox has a source rule, not just a note.**

The plan recorded "do not hide it by reading a role name" under Out of scope, as
prose. Prose is what this repository replaces with rules wherever it can, so
there is now an assertion that the surface never measures `SEEDED_ROLES` against
the signed-in principal — the exact shape the tempting fix would take.

## Validation run

```
npm run typecheck   ✓  tsc -b, no errors
npm test            ✓  32 files, 583 tests (baseline 508 — 75 added)
npm run lint        ✓  4 warnings, all pre-existing in components/ui + hooks
npm run build       ✓  dist/index.html 1,103.32 kB · gzip 439.03 kB
```

The 75 new tests are 63 in `user-admin.test.ts` and 12 new rules in
`source-policy.test.ts`. `surfaces.test.ts` (41) and `auth-messages.test.ts` pass
**unchanged**, which is the evidence that neither shared module's behaviour moved
— the specific risk the senior lens raised about editing `ADMIN_REJECTIONS`, and
the reason that file was ultimately not edited at all.

No commit was created here; per the workflow the single publishable commit
belongs to `/publish-pr`.
