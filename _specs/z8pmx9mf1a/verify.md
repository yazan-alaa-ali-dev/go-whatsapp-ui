---
ticket: z8pmx9mf1a
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1a"
  github: ""
---

# Verification — 10 · Build the users administration surface

**Outcome: PASSED.** All 33 acceptance criteria are mapped to an executed result.

## Runtime impact

**Did any deployment runtime file change? — NO.**

`.github/workflows/ci.yml`, `.github/workflows/release.yml`, `vite.config.ts`,
`package.json` and `index.html` are untouched. No dependency was added: every
primitive this surface renders (`Tabs`, `Checkbox`, `Select`, `AlertDialog`,
`Dialog`) already existed under `src/components/ui/`, and `Tabs` was already
used by three other surfaces. The bundle is `dist/index.html` at 1,103.32 kB
(gzip 439.03 kB).

## Validation commands

| Command | Result |
|---------|--------|
| `npm run typecheck` | ✓ `tsc -b`, no errors |
| `npm test` | ✓ 32 files, **583 tests** (baseline 508) |
| `npm run lint` | ✓ 4 warnings, all pre-existing (`components/ui/tabs,badge,button`, `hooks/use-device-guard`) |
| `npm run build` | ✓ built in 1.74s |

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| AC-1 | PASS | `useUsers` calls `listUsers({limit, offset})`; `DEFAULT_PAGE_SIZE = 100`, `MAX_PAGE_SIZE = 500` asserted. The UI asks for 100 only. |
| AC-2 | PASS | `pageState` returns exactly four fields — asserted by name — and neither the panel nor the decision module names a total or a page count (source rule). Full page → next; short page → no next. |
| AC-3 | PASS | `filterByAccount` narrows the loaded array; the panel renders the "from the page currently loaded" banner whenever a filter is active. TC-14. |
| AC-4 | PASS | `UserRow` renders username, email, account, status, roles, `token_epoch`, created. No permissions column — there is no field on the wire to build one from. |
| AC-5 | PASS | `AdminUser` carries no hash (`src/api/users.ts`, untouched); nothing on this surface names one; the credential rules pass. |
| AC-6 | PASS | `createUserPayloadFrom` returns `null` for an unresolved arm — five cases asserted — and `CreateUserPayload` is a union that will not compile with both keys. Runtime and compile-time halves. |
| AC-7 | PASS | One `createUser` call; the second arm re-titles the dialog "New customer" and the submit "Create customer". |
| AC-8 | PASS | `'roles' in payload === false` when none is chosen (asserted), so the server applies its own least-privileged default. |
| AC-9 | PASS | Status select with `disabled` offered; `status` always present in the create body. |
| AC-10 | PASS | TC-1: 30 Arabic characters = 60 bytes (accepted), 40 = 80 (rejected); 8 latin accepted, 7 rejected; 18 emoji = exactly 72 accepted, 19 rejected. The inclusive boundary is asserted rather than assumed. |
| AC-11 | PASS | `normaliseUsername` runs on change; `usernameError` covers 1/2/64/65 characters, leading `_` and `@`, and `@` mid-string accepted. |
| AC-12 | PASS | Email omitted when blank, trimmed when present. |
| AC-13 | PASS | Three seeded checkboxes plus a free-text field; `notFoundDetail` names the submitted role ids, blanks filtered out. TC-9. |
| AC-14 | PASS | Source rules: no role value compared against a non-empty literal in any of the six files; `SEEDED_ROLES` never measured against the principal; the existing bracket-access rule still passes; `src/api/users.ts` mentions still equal its declarations (that rule untouched and green). |
| AC-15 | PASS | TC-3: changing status alone yields `{status}` and the serialised JSON contains none of `account_id`, `email`, `roles`. |
| AC-16 | PASS | `isEmptyUpdate` is what the button is disabled on; TC-2 asserts `{}` for an untouched form. |
| AC-17 | PASS | TC-5: a blanked or whitespace account id produces no key at all. No path through `updatePayloadFrom` can emit an empty one. |
| AC-18 | PASS | TC-4: unchecking one of two submits the complete remainder; adding submits the complete set; removing all submits `[]`. A reorder is not a change. |
| AC-19 | PASS | The confirmation step renders "…out of every device immediately. There is no grace period" before the request; the success toast reports the new epoch. |
| AC-20 | PASS | The `isSelf` arm swaps in "This will sign **you** out of this session immediately". The source rule asserts no file in the surface names `signOut`, `endRefusedSession`, `refreshSession` or `Navigate` — no new session code. |
| AC-21 | PASS | One password field plus a confirm; no current-password field, and the dialog states why; the banner names both the epoch bump and the refresh-family revocation. |
| AC-22 | PASS | TC-8: `503` on create and on reset → `password-hashing-busy` ("Nothing was changed"). A `503` on an update returns `null` — that request carries no password, so claiming a hashing queue would be a guess. |
| AC-23 | PASS | TC-6: `403` + self + delete/disable → `self-mutation`; every other `403` → `privilege-escalation`, including a `403` on changing your own email. |
| AC-24 | PASS | `UserRow` renders the delete button only when `!isSelf`; the disable path is the edit dialog, and the row is marked "You". |
| AC-25 | PASS | TC-7: `409` on delete, and on any change that could remove administration, → `last-administrator`. |
| AC-26 | PASS | `collisionDetail` names the submitted username/email/account id and says the server does not say which. Appended on **any** `409` whose payload could collide, including one read as last-administrator, so the client never picks between two causes the server joined. |
| AC-27 | PASS | 63 tests in `src/lib/user-admin.test.ts`, covering byte length, dirty-fields-only, the empty-body guard, roles-replace and all three special rejections. |
| AC-28 | PASS | Source rules: no password in a toast, a template literal or a query key; both password dialogs call `passwordFailure` and neither calls `toActionErrorMessage`; the existing web-storage and console bans pass unchanged. |
| AC-29 | PASS | One `useHasPermission` call for the whole panel; `UserRow` is `React.memo` and a source rule asserts it calls no hook and mounts no dialog; the account label is a `useMemo` `Map`, asserted by a rule that also bans `accountName` inside the row `.map()`. |
| AC-30 | PASS | All four commands above. |
| AC-31 | PASS | TC-16: any `4xx`/`5xx` on a password-carrying request → `redacted`; `status: 0` keeps its text. The source rule asserts both dialogs call `passwordFailure(error)`, name `PASSWORD_FAILED_REDACTED`, and never reach `toActionErrorMessage`; the redacted sentence is a literal with no interpolation. |
| AC-32 | PASS | `displayText` applied at every render site. The rule **found two real violations in this ticket's own code** (a success toast and the edit confirmation's email line) — see `implement.md` deviation 1. TC-17/TC-18. |
| AC-33 | PASS | `IdText` renders the raw `user_id` in the delete confirmation and in the reset dialog; asserted by a source rule over both files. |

## Traceability — test cases

TC-1..TC-15 and TC-17 are unit tests in `src/lib/user-admin.test.ts`; TC-16 is
the `passwordFailure` block there; TC-18 is `surfaces.test.ts` passing unchanged
(41 tests); TC-19 is the 12 new rules in `src/lib/source-policy.test.ts`; TC-20
is the command table above. All executed, all passing.

## Notes for the record

**The advisory panel changed this ticket materially.** 28 findings, 17 of which
changed the design. Two were the difference between a correct implementation and
a defective one:

- **SEC1** — without `passwordFailure`, a `400` whose message quoted the
  rejected password would have printed it inside the dialog still holding it.
  The plan as first written routed exactly there.
- **S5** — the first plan amended two shared `ADMIN_REJECTIONS` entries. That
  would have broken `auth-messages.test.ts`, which pins both descriptions, and
  left a "what you sent" promise dangling on the account-delete surface, which
  consumes `not-found` and sends nothing of the kind.

**A rule caught its own author twice.** The interpolation rule was written as a
guard against future edits and immediately failed against two lines written
earlier the same hour. Recorded in `implement.md` rather than silently fixed,
because it is the clearest evidence available that the rule is load-bearing.

**One limitation is shipped deliberately and stated on screen.** `GET
/auth/users` accepts no `account_id` and returns no total (study §14, `Q-3`), so
the account filter narrows within the loaded page and the screen says so, and the
pager is next/previous with no page count. Both are worked *with*. Asking the
backend for a filter and a total remains the recorded ask.

**One tempting fix is deliberately not made.** An `admin` who ticks
`super_admin` receives the server's `403`. Hiding that box by reading the
signed-in principal's *role* is the role-as-authority shape this entire ticket
exists to prevent, so it is not done — and a source rule now makes that
enforceable rather than a note somebody deletes.
