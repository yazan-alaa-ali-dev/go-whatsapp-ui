---
ticket: z8pmx9mb5r
title: 29 · Record and return who sent each outbound message
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-03
updated_at: 2026-09-04
links:
  clickup: "https://app.clickup.com/t/z8pmx9mb5r"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/31"
---

# Ticket: 29 · Record and return who sent each outbound message

> **This file is the single canonical record of the ticket's workflow state.**

## Delivery note — staged workflow not used

At the owner's explicit instruction this ticket is **not** run through the seven
staged workflow commands. It is implemented directly, with one substitution the
owner asked for: the advisory review panel (`senior-reviewer`,
`security-reviewer`, `performance-reviewer` — the lenses `/review` dispatches)
reviews the plan **before** any code is written, and every finding is answered in
`plan.md > Panel response`.

Consequently `intake.md`, `research.md`, `review.md` and `comprehension.md` do
not exist; `spec.md`, `plan.md`, `implement.md` and `verify.md` are authored
directly as the record of what was specified, decided, changed and validated.

This mirrors the delivery shape of tickets `z8pmx9kzc9` (18), `z8pmx9kzca` (19),
`z8pmx9m6ak` (27 · tenant isolation), `z8pmx9mavz` (27 · webhook switch) and
`z8pmx9m6pg` (28 · SMS fallback), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mb5r>
- Related: ticket `19` (sibling-device reply failover), ticket `24` (audit actor),
  ticket `25` (`message_debug` read gating), ticket `07` (voice-note transcript)
- Branch: `ticket/z8pmx9mb5r`, cut from `ticket/z8pmx9m6pg` — the tip carrying the
  account layer (migrations 51–61), the identity/tenant-isolation layer
  (`super_admin`, `MayAddressAccountScope`), ticket 19's reply failover, the
  per-device webhook switch (migration 75) and the SMS fallback stage
  (migration 76). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-03 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-03 | spec-complete | ai_agent | `spec.md` authored directly: 34 acceptance criteria, 8 functional and 6 non-functional requirements, 6 constraints, 18 test cases. It records four **scope decisions** the ticket left open — that `POST /message/{id}/forward` is an `api` origin too (it reaches the same write through the same usecase, and excluding it would fire the ticket's own audit warning on every forward), where the unstamped-send warning belongs, that the name resolver has to be wired and one binary has no cache, and that the `chatwoot` identity is self-asserted. |
| 2026-09-03 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-04 | spec-complete | ai_agent | `plan.md` revised: **24 of 33 panel findings adopted, 4 declined with reasons, 5 recorded as already correct** — see `plan.md > Panel response`. Two were structural and revision 1 could not have shipped. (1) The unstamped-send warning derived "the path" from a Go stack walk inside the storage layer — which is reached from the **detached goroutine** `wrapSendMessage` launches, and a Go stack does not cross a goroutine boundary, so it would have returned an identical constant for `api`, `mcp`, `chatwoot` and `forward` alike: a constant presented to an operator as a diagnosis, and a test asserting "a WARN is emitted" would have passed. (2) The read-time name resolution was **account-blind** — `PrincipalCache.Lookup` is keyed on `user_id` across every user in the deployment, so an account-A admin would have read an account-B user's *current* username whenever a `super_admin` had sent into that partition, reopening ticket 27's horizontal read through a response field. Four further findings would have failed the build outright: two named files (`pkg/auth/perm_test.go`, `infrastructure/chatstorage/errors.go`) **do not exist**, and the planned `IAuthUsecase` change would have broken `ui/rest`'s member-by-member fake. Two spec ACs were amended as a result (AC-28's refusal was destroying message rows inside the history-sync chunk; NFR-1's cost claim was falsified). |
| 2026-09-04 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9mb5r`; 9 new files, 31 modified, no deployment runtime file touched. Seven deviations recorded in `implement.md`, four of them found by the compiler or a failing test rather than by review — including the canonical OpenAPI file being `docs/openapi.yaml` rather than the embedded copy, and `unstampedSendCaller`'s hand-counted frame skip, which the test immediately showed reporting the wrong frame. |
| 2026-09-04 | verified | ai_agent | `verify.md`: all 34 acceptance criteria mapped to results. The suite is at the baseline — one pre-existing failure (`TestResolveDocumentMIME`, measured on the unmodified tree before the first edit), nothing else. Because most of what this ticket adds is a **guard**, and a guard passes its test by doing nothing, six were broken as **mutations** and shown to fail, then reverted; mutation 4 reproduced the cross-tenant username leak verbatim, and mutation 6 guards a failure that produces no wrong value and no error. Three limits are stated rather than rounded up (no live PostgreSQL run; AC-17 and AC-13 asserted structurally; the NFR-3 byte-identity check done by assertion rather than by capture), and three residual risks are carried forward rather than solved. |
