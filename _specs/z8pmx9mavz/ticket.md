---
ticket: z8pmx9mavz
title: 27 · Disable a device's webhook without deleting it
mode: standard
state: verified
status: active
owner: developer
created_at: 2026-09-03
updated_at: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mavz"
  github: "https://github.com/yazan-alaa-ali-dev/go-whatsapp-web-multidevice/pull/29"
---

# Ticket: 27 · Disable a device's webhook without deleting it

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
`z8pmx9m6af` (23), `z8pmx9m6ag` (24), `z8pmx9m6ah` (25), `z8pmx9m6aj` (26) and
`z8pmx9m6ak` (27 · tenant isolation), at the owner's request.

## Execution context

- ClickUp: <https://app.clickup.com/t/z8pmx9mavz>
- Backbone: Devices & Webhooks · Actor: `Account Admin`, `System` · Estimate 12h
- Related: `z8pmx9m6ng` (raw idea), `z8pmx9m6ak` (tenant isolation)
- Branch: `ticket/z8pmx9mavz`, cut from `ticket/z8pmx9m6ak` — the tip carrying the
  tenant-isolation layer (`super_admin`, `MayAddressDevice`, the account-scoped
  device ownership guard) that this ticket's cross-account refusal depends on. The
  PR therefore targets that branch, not `main`.

## The problem in one paragraph

There is exactly one way today for an account admin to stop a device's webhook:
empty `webhook_url`. That is a **deletion**, and it fails three ways at once — it
erases the secret and the event list, it does not stop the events but *redirects*
them to the deployment-wide `WHATSAPP_WEBHOOK` list, and it does not stop the
automatic replies, because the same URL is the AI agent endpoint and clearing it
makes the bridge fall back to the global `AGENT_WEBHOOK_URL`. The admin who wants
to answer one customer by hand has no switch they own. This ticket adds one: a
single boolean column, one route, and two gates on paths that already read the
device row.

## State history

| When | State | By | Note |
|------|-------|----|------|
| 2026-09-03 | draft | ai_agent | Ticket workspace created from the ClickUp task. Two read-only source explorations mapped the webhook config surface and the event/agent delivery path before anything was written. |
| 2026-09-03 | spec-complete | ai_agent | `spec.md` authored directly: 25 acceptance criteria, 10 functional and 7 non-functional requirements, 8 constraints, 16 test cases. AC-25, C-8, TC-15/16 and four Out-of-scope entries were added **after** the panel review, and REQ-3, NFR-1, C-2 and C-6 were amended because the panel showed the original wording was false or too wide. |
| 2026-09-03 | spec-complete | ai_agent | `plan.md` revision 1 authored, then reviewed **against the source** by the advisory panel (senior / security / performance) before any code was written. **26 findings, 5 major.** |
| 2026-09-03 | spec-complete | ai_agent | `plan.md` revision 2. **15 findings adopted, 3 declined with reasons, 4 corrections.** Two lenses independently found the same defect from opposite directions: revision 1 stored the flag as a plain `bool`, whose zero value (`false`) means *disabled*, so every `DeviceRecord` literal in the codebase — **97 across 18 test files** — would have described a silenced device. Revision 1's headline claim that the read-count tests "pass untouched" was therefore false *because of its own design*. Revision 2 changed the representation to `*bool` (nil = enabled), which made the claim literally true and required no fixture edits. Two lenses also independently found that the gate reads whichever row won URL-precedence rather than necessarily the arrival device; the redesign was **declined** — it inverts `TestResolveDeviceRowJIDWebhookWins`, a prior ticket's deliberately pinned invariant, and costs a query on every inbound event — and the boundary is instead stated as AC-25 and pinned by a test. Three of revision 1's own factual errors were corrected, and one panel claim (that `TestWebhookForwardStorageCallCountIsUnchanged` does not exist) was verified false and rejected. |
| 2026-09-03 | implemented | ai_agent | Implementation applied on `ticket/z8pmx9mavz`: 3 new files, 16 modified. Six deviations recorded in `implement.md`. The most consequential was found by an existing test rather than by review: `TestAccountMigrationsApplyToAPreExistingDatabase` rolls a database back to schema version 50 and re-runs every migration, and migration 75 failed on it with `duplicate column name: webhook_enabled` — a real upgrade path that would not have booted. |
| 2026-09-03 | verified | ai_agent | `verify.md`: all 25 acceptance criteria mapped to results. The suite is **identical to a baseline captured on the unmodified tree before the first edit** — 18 packages ok, one pre-existing `TestResolveDocumentMIME` Windows MIME quirk. Two mutation checks were run because a green suite proves little for a ticket whose subject is the *absence* of traffic; **one was not detected and exposed a genuine tautology**: `TestDisabledDeviceMakesNoAgentCall`, the sole evidence for AC-16, pointed the agent endpoint at an unrelated host and so passed with the gate removed entirely. Fixed and re-verified in both directions. Seven residual risks recorded, the sharpest being the stated limit at AC-25 and that "disabled" stops outbound automation without stopping transcription, media download or resource use. |
