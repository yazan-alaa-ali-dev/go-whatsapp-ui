---
ticket: z8pmx9m57v
title: 21 · Make the account a real owner of devices — account-scoped device creation, account on every device query, and a complete account lifecycle
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-08-30
updated_at: 2026-08-30
links:
  clickup: "https://app.clickup.com/t/z8pmx9m57v"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/20"
---

# Ticket: 21 · Make the account a real owner of devices

> **This file is the single canonical record of the ticket's workflow state.**

## Delivery note — staged workflow not used

At the owner's explicit instruction this ticket is **not** run through the seven
staged workflow commands. It is implemented directly, with one substitution the
owner asked for: the advisory review panel (`senior-reviewer`,
`security-reviewer`, `performance-reviewer` — the lenses `/review` dispatches)
reviews the plan **before** any code is written, and every finding is answered in
`plan.md > Panel response`.

Consequently `research.md`, `review.md` and `comprehension.md` do not exist;
`intake.md`, `spec.md`, `plan.md`, `implement.md` and `verify.md` are authored
directly as the record of what was requested, specified, decided, changed and
validated.

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14), `z8pmx9kzc7`
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18), `z8pmx9kzca` (19) and `z8pmx9m4nd`,
at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m57v> (status `claude ai to do`)
- Completes the account layer of tickets 16-19 · depends on 16 · blocks nothing
- Branch: `ticket/z8pmx9m57v`, cut from `ticket/z8pmx9m4nd` — the current tip and
  the only place the account layer exists (`main` does not carry it). The PR
  therefore targets that branch, not `main`.

## Owner decisions carried into the work

| # | Decision |
|---|----------|
| D1 | The account stays an **organizational / routing** layer, not an access boundary. Tenancy is a later ticket. |
| D2 | A **new** creation route; `POST /devices` keeps working untouched. The two paths coexist deliberately, and a later ticket adopts the one where `account_id` is mandatory. |
| D3 | The change is documented (`readme.md` — and `docs/openapi.yaml`, found during planning). |
| D4 | No backfill: existing account-less devices are attached manually by the owner. |
| D5 | An account is deleted together with its devices — the subscription-cancellation scenario, analysed in `intake.md > Scenario S-2`. |
| D6 | The cascade selects devices **by `account_id`**, and the account row goes last, so nothing is left inconsistent. |

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-30 | draft | ai_agent | Ticket workspace created; the ClickUp task was authored from a read-only investigation of the account layer (six gaps, G1-G6, located by symbol). |
| 2026-08-30 | draft | ai_agent | `intake.md` recorded the owner's six decisions and the subscription-cancellation scenario (S-2) with its recommended answer. |
| 2026-08-30 | spec-complete | ai_agent | `spec.md` authored directly: 21 acceptance criteria, 11 functional and 7 non-functional requirements, 6 constraints, 20 test cases. |
| 2026-08-30 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-08-30 | spec-complete | ai_agent | `plan.md` revised: **35 panel findings, 8 major — 22 adopted, 3 declined with reasons, 2 corrections to the panel, 3 claims of revision 1 corrected.** Revision 1 **would not have compiled**: `deviceChatStorage` mirrors every account repository method explicitly and the new one was not mirrored. Two lenses independently found the same structural defect from opposite directions — security via the UPDATE-first upsert, senior via `loadFromRegistry`'s deliberate skipping: revision 1's central claim, "the account on the first row is true by construction", was **false**, because a device id that exists as a row but not in the registry takes the UPDATE branch, leaving the account unwritten while the shadowed row's identity is overwritten and a 200 is returned — and revision 1's own tests ran on an empty table and could not have caught it. The performance lens found the cascade would tear devices in half at the 45-second request deadline, since `PurgeDevice` deletes the device row whether or not its context is alive, leaving rows deleted with live whatsmeow sessions that the next boot re-adopts as fresh account-less slots. The security lens found `GET /devices` is not covered by the guard that makes `/accounts` answer 503, so publishing the routing columns there would hand the account topology to anonymous callers. Two panel suggestions were corrected in turn: `RemoveDevice` as the ghost-slot cleanup would **deadlock** on `m.mu`, and validating the `account_id` filter unconditionally would turn plain `GET /devices` into a 400. |
| 2026-08-30 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m57v`: 6 new test files (38 test functions), 14 files modified, plus `readme.md` and `docs/openapi.yaml`. Five plan deviations recorded in `implement.md`. The baseline was measured on the untouched tree before the first edit. |
| 2026-08-30 | verified | ai_agent | `verify.md`: all 21 acceptance criteria mapped to results. The decisive finding was that `readme.md` documents a **`purego`** build tag providing a pure-Go SQLite — so the whole suite runs against a **real database** on a host with no cgo, where the measured baseline was 132 stub failures. Under it the suite passes except `TestResolveDocumentMIME/Zip`, a Windows MIME difference recorded as pre-existing in four earlier tickets. Because the code is new, a green suite proves little on its own: the four load-bearing guards were broken deliberately as **mutations** and shown to fail, then restored. AC-18 passes with an explicitly **stated limit** — the local database predates migrations 51+ (no `accounts` table, no `account_id` column, zero devices), so there was nothing to delete and the reset refused to touch it rather than report a vacuous success; the deployment procedure is recorded with its statements. Two purge residues are stated rather than claimed fixed: shared media files, and a device row the registry never loaded. No deployment runtime file touched. |
