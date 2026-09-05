---
ticket: z8pmx9m4nd
title: Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks
mode: standard
state: closed
status: active
owner: developer
created_at: 2026-08-29
updated_at: 2026-08-29
links:
  clickup: "https://app.clickup.com/t/z8pmx9m4nd"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/19"
---

# Ticket: Make Hamsa the primary speech-to-text provider, with ElevenLabs Scribe v2 and OpenAI as ordered fallbacks

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

This mirrors the delivery shape of tickets `cu-z8pmx9kcvh` (14), `z8pmx9kzc7`
(16), `z8pmx9kzc8` (17), `z8pmx9kzc9` (18) and `z8pmx9kzca` (19), at the owner's
request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9m4nd>
- Standalone · depends on `cu-z8pmx9kcva` (07 — voice-note transcription) · blocks nothing
- Scope: **inbound voice-note transcription only**
- Branch: `ticket/z8pmx9m4nd`, cut from `ticket/z8pmx9kzca` — the current tip,
  which is the only place ticket 07's transcription path exists (`main` does not
  yet carry it). The PR therefore targets that branch, not `main`.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-08-29 | draft | ai_agent | Ticket workspace created from the ClickUp task. |
| 2026-08-29 | spec-complete | ai_agent | `spec.md` authored directly (22 acceptance criteria, 32 functional and 5 non-functional requirements, 4 constraints, 18 test cases). |
| 2026-08-29 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed by the advisory panel (senior / security / performance) **against the source**, before any code was written. Research settled the ticket's central unknown: Hamsa publishes a **synchronous** realtime route (`POST /v1/realtime/stt`, `audioBase64`), so none of the three candidate mechanisms the ticket proposed — all of which either publish the customer's recording at a fetchable URL or break the final-`transcript_status` contract — was needed. |
| 2026-08-29 | spec-complete | ai_agent | `plan.md` revised: **34 panel findings, 15 major — 19 adopted, 3 declined with reasons, 5 claims of revision 1 corrected.** Two lenses independently found the same structural defect from opposite directions (performance via slot occupancy, senior via a documented latency contract): revision 1's timeout model gave each provider the full stage ceiling, so a **hung** primary consumed all of it and the fallbacks were never started. Revision 1 would have passed its own tests and shipped a failover that works for a rejected key and not for the failure operators actually add a fallback for. Raising the ceiling to compensate was worse still — `event_message_handler.go:75-78` holds the admission slot across transcription *plus* the agent bridge *plus* the webhook forward, so it would have cut process-wide throughput from ~16 to ~6.4 voice notes/min and tripled a latency `readme.md` publishes. Replaced with proportional budget sharing at an unchanged 30s ceiling — better on every axis and less code. Two further corrections: `Reason()` built from a wrapped vendor error would have let a remote body inject newlines and **forge audit records**; and revision 1's enumeration of the couplings to repoint was one short — it missed the `stageCtx` timeout the entire ceiling design depends on. |
| 2026-08-29 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9m4nd`: 10 new files in `src/infrastructure/stt/` (2,915 lines with tests), 6 modified. Five plan deviations recorded in `implement.md`. `src/infrastructure/elevenlabs/stt.go` deliberately untouched — its 541-line suite passing unmodified is the evidence that the single-provider path still behaves as it did. |
| 2026-08-29 | verified | ai_agent | `verify.md`: all 22 acceptance criteria mapped to results. Baseline **measured** by stashing the whole working set — **111 failures before, 111 after**, no new failure; 105 are the `CGO_ENABLED=0` sqlite stub and the rest a pre-existing Windows MIME difference. Beyond the unit tests, the wiring was verified against the **real binary**: an unknown chain entry is fatal and names it, an unconfigured provider is skipped with one warning and the process starts, a legacy deployment reports today's engine string and today's 16 MiB limit, and a three-provider chain reports in configured order. AC-18 passes on its send half — asserted that no `mediaUrl`, `webhookUrl` or `processingType` is ever sent — and carries an explicitly **stated limit**: Hamsa has never been called for real, so whether its endpoint accepts ogg/opus and whether the auth scheme is `Token` or `Bearer` remain unsettled. Both fail closed into the fallback and both are configuration-fixable, so neither can break an existing deployment. No deployment runtime file touched. |
