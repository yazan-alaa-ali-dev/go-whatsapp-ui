---
ticket: z8pmx9m6ak
title: 27 · Tenant isolation — a super-admin tier, account-scoped administration, and non-disclosing cross-account refusal
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-02
updated_at: 2026-09-02
links:
  clickup: ""
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/28"
---

# Ticket: 27 · Tenant isolation

> **This file is the single canonical record of the ticket's workflow state.**

## Delivery note — staged workflow not used

At the owner's explicit instruction this ticket is **not** run through the seven
staged workflow commands. It is implemented directly, with one substitution the
owner asked for: the advisory review panel (`senior-reviewer`, `security-reviewer`,
`performance-reviewer` — the lenses `/review` dispatches) reviews the plan **before**
any code is written, and every finding is answered in `plan.md > Panel response`.

Consequently `intake.md`, `research.md`, `review.md` and `comprehension.md` do not
exist; `spec.md`, `plan.md`, `implement.md` and `verify.md` are authored directly as
the record of what was specified, decided, changed and validated.

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14), `z8pmx9kzc7` (16),
`z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9m57v` (21), `z8pmx9m6ae` (22),
`z8pmx9m6af` (23), `z8pmx9m6ag` (24), `z8pmx9m6ah` (25) and `z8pmx9m6aj` (26), at the
owner's request.

## Origin

This ticket does not come from ClickUp. It comes from an **audit of the shipped RBAC
layer** performed against the source after ticket 26 closed, recorded in
`gowa-rbac-answers-ar.html`. The audit found six issues; this ticket closes the two
rated critical and the one rated high, all three of which are the same defect seen
from three sides:

| # | Finding | Severity |
|---|---------|----------|
| 1 | No tenant isolation on the user surface — an account's administrator can reset any other account's administrator password and log in as them | critical |
| 2 | `GET /auth/users` discloses every user in the deployment, unfiltered | high |
| 3 | `DELETE /accounts/:account_id` lets an administrator destroy another customer's account and irreversibly purge its devices | critical |

The remaining three findings (no roles-administration API; `POST /devices` accepting
webhook fields under `devices.create`; the bootstrap admin's blank account creating
orphan devices) are recorded in `spec.md > Out of scope` and are **not** addressed
here.

The root cause is stated in `spec.md > Business goal`: every guard tickets 22–26
shipped is **vertical** (it stops a caller climbing the privilege ladder), and the
layer has no **horizontal** guard between two callers on the same rung. Ticket 25
built one — `pkg/auth.MayAddressDevice` — but for devices only.

## Execution context

- ClickUp: none (audit-originated)
- Execution order: 27 of the auth/RBAC series · depends on 22, 23, 24, 25 and 26
- Reference: `gowa-rbac-answers-ar.html` §2 (the cross-account finding), §4 (account
  deletion), and the findings table
- Branch: `ticket/z8pmx9m6ak`, cut from `feat/api-docs` — the tip carrying ticket 26
  (user and account administration) and the embedded API documentation. The PR
  therefore targets that branch, not `main`.

## Owner decisions taken at intake

Three decisions were put to the owner before `spec.md` was written, because each
changes the shape of the work rather than its detail:

1. **Ticket identity.** `z8pmx9m6aj` (26) is `closed` and its PR #26 is merged, so
   the work is delivered as a **new ticket** rather than by reopening a closed one.
2. **First global administrator.** `AUTH_BOOTSTRAP_ADMIN` grants `super_admin` on a
   fresh install; a new `AUTH_SUPER_ADMIN=<username>` grants it idempotently at every
   boot for an existing deployment; **no silent automatic promotion**, and a WARN when
   none exists. Rejected: promoting every blank-account user automatically, which
   re-opens the hole without anyone reading a line about it.
3. **Refusal code.** A target outside the caller's account answers **404**,
   byte-identical to a target that does not exist. Rejected: a distinct
   `403 CROSS_ACCOUNT_DENIED`, which enumerates the other tenant's ids.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-02 | draft | ai_agent | Ticket workspace created from the post-26 source audit. Three owner decisions recorded above. |
| 2026-09-02 | spec-complete | ai_agent | `spec.md` authored directly: 23 acceptance criteria, 12 functional and 7 non-functional requirements, 6 constraints, 22 test cases. Three ACs (21-23) and six TCs were added *after* the panel review, and two (AC-5, NFR-5) were amended because the panel showed the original wording was false. |
| 2026-09-02 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed **against the source** by the advisory panel (senior / security / performance) before any code was written. **30 findings, 11 major.** All three lenses independently found the same build-breaking defect: revision 1 redefined `AdminPermissions()` without noticing that `ui/mcp/helpers/principal.go` builds the MCP system principal from it with a blank `AccountID` — every MCP tool call would have resolved nothing. The senior lens found a second one that would have shipped a NEW hole while closing one: `List` passing the caller's own blank account as a query bound issues `WHERE account_id = ''` and returns **every accountless user**, the exact wildcard `pkg/auth/scope.go` exists to forbid, arriving through a path that never consults the scope rule. The security lens found that the 404 non-disclosure claim died in `assertMayAdministerUser` (the vertical loop ran first, so a foreign *privileged* target answered 403), that `AUTH_SUPER_ADMIN` as drafted was a permanent username-keyed back door, and that NFR-5's "choke point" claim was simply false for the account layer. Two lenses independently found the upgrade **lockout**: every existing deployment's sole administrator carries `AccountID: ""` and would have lost all ~90 device routes and all 6 account routes. |
| 2026-09-02 | spec-complete | ai_agent | `plan.md` revision 2. **24 findings adopted, 2 declined with reasons, 2 corrections to revision 1, 2 recorded without change.** Both corrections were revision 1's own factual errors: the validation command lacked `-tags purego` (without it ~200 tests fail on `go-sqlite3 requires cgo` and the baseline diff is unreadable), and "no migration is written" was false once the missing index on `users.account_id` was found. Revision 2 added the boot-asserted `RequireAccountScope` middleware, the one-time upgrade promotion, and the pinned check ordering. |
| 2026-09-02 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6ak`: 8 new files, 33 modified, 1,343 insertions. Five deviations recorded in `implement.md`. The most consequential: `Create`'s account defaulting had to move **above** the request validator, because `ValidateCreateUser` refuses a blank account outright — placed where the plan put it, the defaulting was dead code and the ordinary `POST /auth/users {username, password}` was refused. |
| 2026-09-02 | verified | ai_agent | `verify.md`: all 23 acceptance criteria mapped to results. The suite is **identical to a baseline captured on the unmodified tree before the first edit** — 17 packages ok, one pre-existing `TestResolveDocumentMIME` Windows MIME quirk. Four mutation checks were run because a green suite proves little for a refusal ticket; **two were not detected and exposed genuine coverage holes**, both now closed and re-verified: the `accountContext` principal stamp was untested (every REST test runs against a fake usecase, so deleting one `if` would have 404'd every account route in production with a green suite), and the blank-scope wildcard was defended at two layers, making a mutation to either invisible through the other. Eight residual risks recorded, the sharpest being that the MCP surface holds the global tier on an unauthenticated port — unchanged by this ticket and pinned by AC-22. |
