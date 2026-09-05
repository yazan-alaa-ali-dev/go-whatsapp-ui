---
ticket: z8pmx9m6pg
title: 28 · Fall back to SMS when every WhatsApp channel fails
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-03
updated_at: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6pg"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/30"
---

# Ticket: 28 · Fall back to SMS when every WhatsApp channel fails

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
`z8pmx9m6ak` (27 · tenant isolation) and `z8pmx9mavz` (27 · webhook switch), at
the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m6pg>
- Related: ticket `19` (sibling-device reply failover), ticket `27` (tenant isolation)
- Branch: `ticket/z8pmx9m6pg`, cut from `ticket/z8pmx9mavz` — the tip carrying the
  account layer (migrations 51–61), the identity/tenant-isolation layer
  (`super_admin`, `MayAddressAccountScope`, `RequireAccountScope`), ticket 19's
  reply failover, and migration 75. The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-03 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-09-03 | spec-complete | ai_agent | `spec.md` authored directly: 51 acceptance criteria, 8 functional and 5 non-functional requirements, 5 constraints, 18 test cases. It records one **scope decision** the ticket left ambiguous — "every WhatsApp attempt available for that message" is read per path, and adding a sibling chain to `POST /send/message` is out of scope, which the ticket's own test cases settle (the only sibling test case is written on the agent path). |
| 2026-09-03 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. |
| 2026-09-03 | spec-complete | ai_agent | `plan.md` revised: **25 of 31 panel findings adopted, 3 declined with reasons, 3 recorded as already correct** — see `plan.md > Panel response`. Two were structural and revision 1 could not have shipped: (1) it specified an **import cycle** — a new `infrastructure/sms` package calling back into `whatsapp` while `whatsapp` imported it — on a rationale ("the stage must live below both") that was simply false, since `usecase` already imports `infrastructure/whatsapp`; the first `go build` would have failed. (2) It carried a **duplicate-delivery hole**: `agent_bridge.go`'s attempt-2 branch collapses `agentFailedSending` and `agentRefusedPreSend` into one `!= agentDelivered` test and discards the refusal reason, so the described refactor would have made a failure *during* the sibling send SMS-eligible — the customer receiving the same answer twice, from two channels, which is the one outcome the whole design exists to prevent. Two spec ACs were amended as a result (AC-25's ordering would have created a cross-tenant oracle; NFR-1's cost claim was falsified by the plan's own text). |
| 2026-09-03 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m6pg`; 8 new files, 19 modified, no deployment runtime file touched. Seven deviations recorded in `implement.md`, two of them found by tests rather than by review: an existing refusal-visibility test caught the stage adding a per-message log line to every deployment that has the feature off, and the first `usecase` run caught a **nil package logger** that would have crashed the send the stage was called to rescue. |
| 2026-09-03 | verified | ai_agent | `verify.md`: all 51 acceptance criteria mapped to results. The suite is at the baseline — one pre-existing failure (`TestResolveDocumentMIME/Zip`, measured on the unmodified tree before the first edit), nothing new. Because most of what this ticket adds is a **refusal**, and a refusal passes its test by doing nothing, the four load-bearing guards were broken as **mutations** and shown to fail, then reverted. **Mutation 4 initially passed** — the AC-17 budget test was asserting a proxy (`ctx.Deadline()` looks identical on a cancelled parent), so it was rewritten to measure the thing itself and only then did the mutation fail. Three limits are stated rather than rounded up: AC-43's WhatsApp half is not driven end to end, there was no live PostgreSQL run (Docker not available; migration 76 rests on the dialect walk and an exact precedent two migrations earlier), and AC-1/AC-18 are satisfied by construction. Two residual risks are carried forward rather than solved — no SMS spend cap, and the agent path holding its gate slot for the stage's duration. |
