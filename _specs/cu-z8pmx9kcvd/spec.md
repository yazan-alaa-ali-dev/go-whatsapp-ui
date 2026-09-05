---
ticket: cu-z8pmx9kcvd
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvd"
  github: ""
---

# Specification — cu-z8pmx9kcvd

10 · Harden debug retention
(execution order 10 of 15 · depends on: 06 · blocks: 13 ·
reference: `gowa-study-ar.html` §11 task 10)

## Business Goal

Ticket 03 created `message_debug` and ticket 06 started filling it: one row per
message carrying the omni agent's diagnostics payload verbatim — the prompt
context, the session and thread identifiers, the model, the token counts, and
whatever fragments of the system prompt the agent chose to echo back. That row is
several times the size of the message it describes, and nothing ever deletes it.

Two consequences follow, and they are why this is filed as hardening rather than
as housekeeping. The first is growth: debug rows outpace the messages themselves,
so the database a customer deployment carries is dominated by diagnostics nobody
reads after the incident is closed. The second is disclosure: an unbounded table
means a copy of the database taken at any point in the future still contains
every prompt and every internal reasoning fragment the system has ever produced.
An admin needs a way to say how long that is allowed to be kept.

The card's original scope also covered webhook signing; it was removed on
2026-08-19 because enabling `AGENT_WEBHOOK_SIGN` needs no code. This ticket is
the retention cleanup only.

## User Story

> As **an ADMIN**, I want to be able to **bound how long debug data is kept**, so
> that **diagnostic payloads containing prompts and internal reasoning cannot
> accumulate indefinitely**.

## Functional Requirements

- **REQ-1** — A retention window is configurable by the operator and defaults to
  30 days.
- **REQ-2** — A job running inside the server deletes debug rows older than that
  window, on a schedule, without an operator action.
- **REQ-3** — The same job can be triggered on demand, so an admin can verify the
  behaviour instead of waiting for the schedule.
- **REQ-4** — The job deletes debug rows only. No message, chat, or any other
  record is removed or altered by it.
- **REQ-5** — The job covers the whole deployment, not one device: retention is
  an operator policy over the stored data, not a per-device operation.
- **REQ-6** — A retention window that is not a positive number of days is a
  configuration error that stops the server at startup, naming the setting.
- **REQ-7** — Every run — scheduled or manual — records how many rows it deleted
  and the cutoff instant it used.
- **REQ-8** — The on-demand trigger is an administrative operation and is
  reachable only by an authenticated admin.

## Non-Functional Requirements

- **NFR-1** — A run must not block message traffic: the deletion is bounded work
  against an index, not a full-table scan that holds the write lock while the
  gateway is receiving messages.
- **NFR-2** — A scheduled run and a manual run must not execute concurrently; the
  second one is refused rather than queued.
- **NFR-3** — A failing run is a logged warning, never a crash: a deployment must
  keep relaying WhatsApp messages when its cleanup query fails.
- **NFR-4** — No log line or API response introduced by this ticket may contain
  any part of a debug payload (the payload is the thing being protected).

## Constraints

- **CON-1** — `message_transcript` does **not** exist in the schema at
  implementation time (verified: no `CREATE TABLE message_transcript` anywhere in
  `src/`, current migration list ends at 47). The card's conditional — "plus
  `message_transcript` if that table exists at implementation time" — therefore
  resolves to `message_debug` only. No table is created to satisfy it.
- **CON-2** — Chat storage schema changes are append-only migrations in
  `getMigrations()`; existing migrations are never edited.
- **CON-3** — No deployment runtime file is touched (CLAUDE.md hard stop).
- **CON-4** — Authorization is **confirmed, not built**: this ticket adds no
  authentication mechanism. It verifies the existing basic auth already covers
  the surface, and places anything it adds inside that same surface.

## Acceptance Criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| **AC-1** | A scheduled job runs inside the server without operator action and deletes `message_debug` rows whose age exceeds the retention window. | REQ-2 |
| **AC-2** | The retention window is configurable through the same environment/flag mechanism as every other setting, and is 30 days when the operator sets nothing. | REQ-1 |
| **AC-3** | A run deletes rows **older** than the cutoff and leaves rows inside the window untouched, on the same table, in the same run. | REQ-2 |
| **AC-4** | A run deletes rows belonging to every device, not only one. | REQ-5 |
| **AC-5** | After a run that deleted a message's debug row, the `messages` row it described is still present and still readable through the normal read path. No row is removed from any table other than `message_debug`. | REQ-4 |
| **AC-6** | The cleanup can be triggered manually and reports what it deleted. | REQ-3 |
| **AC-7** | A retention window of zero, a negative number, or a non-numeric value stops the binary at startup with an error naming the setting. A positive value starts normally. | REQ-6 |
| **AC-8** | Every run logs the number of rows deleted and the cutoff timestamp it used — including a run that deleted nothing. | REQ-7 |
| **AC-9** | A second run requested while one is in flight is refused, not queued, and reports that state distinctly. | NFR-2 |
| **AC-10** | A failing deletion is logged and the scheduler keeps running; the process does not exit. | NFR-3 |
| **AC-11** | **Confirmation only.** The `/agent/*` routes — including the manual trigger this ticket adds — are registered behind the configured basic auth. A request without credentials receives **401** and no payload. No endpoint anywhere in the service returns `metadata_debug` outside that authenticated surface. | REQ-8, CON-4 |
| **AC-12** | The deletion is served by an index on the age column rather than a full scan of `message_debug`, **and** a run deletes in bounded batches — no single statement removes the whole backlog, so the writer lock is released repeatedly while the gateway keeps receiving messages. | NFR-1 |

## Test Cases

| ID | Case | Covers |
|----|------|--------|
| **TC-1** | Insert debug rows dated 40 days and 1 day back for two different devices; run one sweep; the 40-day rows of **both** devices are gone and the 1-day rows of both remain. | AC-3, AC-4 |
| **TC-2** | Insert a message and its debug row, age the debug row past the window, sweep, then read the message back: the message row and every other table's row count are unchanged. | AC-5 |
| **TC-3** | Sweep an empty table: the call succeeds, reports 0, and logs the count and cutoff. | AC-8 |
| **TC-4** | The sweeper computes its cutoff as *now − window* from the configured window, and a 30-day default is what an unconfigured deployment gets. | AC-2, AC-1 |
| **TC-5** | Validation: `0`, `-1` and a non-numeric value are each rejected with an error naming the setting; `1` and `30` are accepted; an *unset* setting is accepted and keeps the default. | AC-7 |
| **TC-6** | The manual trigger returns the deleted count and the cutoff to an authenticated caller. | AC-6 |
| **TC-7** | The manual trigger, called while a sweep holds the run guard, is refused with a distinct status/code and performs no deletion. | AC-9 |
| **TC-8** | A repository error surfaces as a logged failure from the scheduled path and the loop continues to the next tick. | AC-10 |
| **TC-9** | The manual trigger without credentials, on an app with basic auth installed, returns 401 and no body payload; with credentials it returns 200. | AC-11 |
| **TC-10** | With no basic-auth credential configured at all, the manual trigger refuses to act (no deletion), matching the posture ticket 08 established for `/agent/debug/toggle`. | AC-11 |
| **TC-11** | With the table populated and a cutoff matching a clear minority of rows, `EXPLAIN QUERY PLAN` for the deletion names `idx_message_debug_created_at`. | AC-12 |
| **TC-12** | A single call deletes at most the batch limit it was given, and the sweeper's loop drains the remainder across successive batches. | AC-12, NFR-1 |
| **TC-13** | The scheduled sweep runs on a deployment with **no** `APP_BASIC_AUTH` configured, even though the manual trigger refuses there. | AC-1, AC-11 |

## Out of Scope

- Webhook signing (`AGENT_WEBHOOK_SIGN`) — removed from this card on 2026-08-19;
  it is an environment change, not code.
- Creating `message_transcript` or any other new debug table (CON-1).
- Retention for messages, chats, media, or any table other than `message_debug`.
- A UI for retention (the dashboard work is ticket 12/13).
- Building any new authentication or authorization mechanism (CON-4).
- Per-device or per-chat retention policies — REQ-5 fixes the policy at the
  deployment level.
