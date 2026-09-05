---
ticket: cu-z8pmx9kcv6
stage: intake
mode: standard
status: in_progress
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Intake — 03 · Create the message debug storage layer

## Ticket Reference

| Field   | Value                                       |
| ------- | ------------------------------------------- |
| Slug    | `cu-z8pmx9kcv6`                             |
| Title   | 03 · Create the message debug storage layer |
| Owner   | developer                                   |
| Created | 2026-08-15                                  |
| ClickUp | https://app.clickup.com/t/z8pmx9kcv6        |

## Ticket Summary

<!-- Seeded read-only from ClickUp (CU-5); task description verbatim. -->

> **Execution order:** 03 of 15 · **Depends on:** — · **Blocks:** 04, 06, 07, 14
>
> **Board origin:** `z8pmx9kbej` (first half) · **Reference:** `gowa-study-ar.html` §03, §06

## User Story

As **the SYSTEM**,
I want to be able to **persist the exact** **`metadata_debug`** **object the omni AI returns with every reply, keyed to the message it belongs to, with its stable identifying fields promoted into real columns**,
so that **an operator can both replay the full diagnostic payload of a single answer and query across answers by thread, session or model without parsing JSON by hand**.

The payload is owned by the omni team and its shape will keep changing: six of its twelve top-level keys are `null` today and will be populated later. The design is therefore **hybrid** — the raw JSON is stored verbatim as the single source of truth and is never lossy, while a small, stable core of fields is copied into typed columns for filtering and indexing. Storage lives in a dedicated `message_debug` table, not as a column on `messages`, because a column would require editing eight existing SQL sites and would race with the sent-message row, which is written asynchronously in a goroutine after the HTTP response has already returned.

### Reference payload (real response, 2026-08)

```json
{
  "reply": "لا أملك معلومة مؤكدة عن هذا السؤال حالياً.\n\n📍 من أي مدينة ستُرسَل الشحنة؟",
  "metadata_debug": {
    "enabled_by": "api",
    "phone": "+963938113282",
    "intent": null,
    "source": { "file": "unknown", "func": "unknown" },
    "model": null,
    "message": { "type": "chat", "len": 26 },
    "session": { "id": "588d6cdf-3ba0-4d46-9af4-72b66c71259c" },
    "thread": {
      "id": "+963938113282::69959da0491781ef06b06511",
      "intent_complete": false
    },
    "memory": null,
    "api": null,
    "tokens": null,
    "langsmith": null
  }
}
```

# Acceptance Criteria

---

## Scope & Tenant Safety

1. Every row is keyed by the composite primary key `(device_id, message_id)` so two devices can hold the same WhatsApp message id without collision.
2. Reads and writes always require an explicit `device_id`; no query may span devices.
3. The `phone` value inside the payload is stored for cross-checking only and is never used to resolve a device.

## Schema — raw payload

1. `metadata_json` holds the complete `metadata_debug` object exactly as received, including keys whose value is `null` and any key not listed below.
2. `metadata_json` is the source of truth; a promoted column is never treated as authoritative.

## Schema — promoted columns

1. The following fields are extracted into typed columns:

| Column            | Source path              | Type    | Example                   |
| ----------------- | ------------------------ | ------- | ------------------------- |
| `enabled_by`      | `enabled_by`             | text    | `api`                     |
| `phone`           | `phone`                  | text    | `+963938113282`           |
| `intent`          | `intent`                 | text    | `null` today              |
| `model`           | `model`                  | text    | `null` today              |
| `message_type`    | `message.type`           | text    | `chat`                    |
| `message_len`     | `message.len`            | integer | `26`                      |
| `session_id`      | `session.id`             | text    | `588d6cdf-3ba0-…`         |
| `thread_id`       | `thread.id`              | text    | `+963938113282::69959da…` |
| `intent_complete` | `thread.intent_complete` | boolean | `false`                   |

1. Nested objects that are not promoted — `source`, `memory`, `api`, `tokens`, `langsmith` — remain available inside `metadata_json` only.
2. An index exists on `(device_id, thread_id)` and another on `(device_id, session_id)`.

## General Behavior

1. `SetMessageDebug(ctx, deviceID, messageID, metadataJSON)` inserts a row, or replaces it when the pair already exists.
2. The promoted columns are derived inside the repository from the JSON it is given; callers never populate them separately.
3. `GetMessageDebugBatch(ctx, deviceID, messageIDs)` returns a map keyed by message id carrying the raw JSON, containing only ids that have rows.
4. Both methods are declared on `IChatStorageRepository` and delegated in the device-scoped wrapper, which injects `device_id` automatically.

## Validation & Constraints

1. The migrations are appended as the next available numbers (44 for the table, 45 and 46 for the two indexes); no existing migration is edited, reordered or removed.
2. Each migration contains exactly one SQL statement, because the runner executes one statement per migration.
3. A `null`, absent or wrongly-typed field is written as the column's zero value (empty text, `0`, `false`) and **never** aborts the write.
4. Because a promoted column cannot distinguish `null` from an empty string, any question of the form "did omni report this field at all?" is answered from `metadata_json`, not from the column.
5. A payload that is not valid JSON is rejected before insert and the failure is logged with the message id.
6. A payload containing keys unknown to this ticket is stored successfully and in full; unknown keys are never dropped.
7. `GetMessageDebugBatch` called with an empty id slice returns an empty map without executing any SQL, and never emits `IN ()`.
8. Batches larger than 500 ids are split into several queries to stay within the SQLite variable limit.

## UI & API Consistency

1. The stored JSON is byte-comparable with what the agent returned, so the dashboard renders the same object the agent produced.

## Audit & Logging

1. A failed debug write is logged as a warning including the message id, and never aborts the caller.
2. A field-extraction failure is logged at debug level and does not prevent the row from being written.

# Test Cases

---

## Happy path — the real payload is stored and decomposed

**Given** a migrated database
**When** `SetMessageDebug` is called with the reference payload above
**Then**

- `metadata_json` read back is byte-identical to the input
- `session_id` is `588d6cdf-3ba0-4d46-9af4-72b66c71259c`
- `thread_id` is `+963938113282::69959da0491781ef06b06511`
- `intent_complete` is `false`, `message_type` is `chat`, `message_len` is `26`
- `enabled_by` is `api` and `phone` is `+963938113282`

## Happy path — query across answers by thread

**Given** three replies stored for the same `thread.id` on one device
**When** rows are selected by `(device_id, thread_id)`
**Then**

- All three rows are returned using the index, without scanning the table

## Validation error — null fields and unknown fields

**Given** the reference payload where `intent`, `model`, `memory`, `api`, `tokens` and `langsmith` are `null`
**When** the row is written
**Then**

- `intent` and `model` are stored as empty text and the write succeeds
- `metadata_json` still contains those keys with their `null` values

**When** a payload arrives carrying a new key `guardrails` that this ticket does not know

**Then**

- The write succeeds and `guardrails` is present in `metadata_json`

## Validation error — malformed payload and batch edges

**Given** a migrated database
**When** `SetMessageDebug` is called with a string that is not valid JSON
**Then**

- No row is written and the failure is logged with the message id

**When** `GetMessageDebugBatch` is called with an empty slice

**Then**

- An empty map is returned and no SQL is executed

**When** it is called with 1200 ids

**Then**

- The call succeeds and the work is split across several queries

## Authorization failure — device scoping is enforced

**Given** device A has stored debug data for message `M`
**When** `GetMessageDebugBatch` is called for device B with message id `M`
**Then**

- The result does not contain `M`
- No data belonging to device A is exposed

<!-- end ClickUp description -->

## Goal

Add a dedicated, device-scoped `message_debug` storage layer that persists the
omni AI `metadata_debug` payload verbatim as JSON alongside a small set of
promoted, indexed columns (session, thread, message, model), exposed through
`SetMessageDebug` / `GetMessageDebugBatch` on the chat-storage repository.

## Readiness checks

Mark each check. The ticket may not leave `draft` until Readiness Status is
`READY` (RS-7).

- [x] The request has a clear, single focused outcome (one ticket = one outcome).
- [x] The goal is stated in one or two sentences.
- [x] Success is describable in observable, testable terms.
- [x] No hard-stop condition applies (see `CLAUDE.md > Hard stop conditions`).
- [x] Any deployment runtime file impact is known and called out below.

## Deployment runtime impact

**No.** Owner decision (2026-08-15): the deliverable is a storage-layer change
only — chat-storage migrations, repository methods, the repository interface and
its device-scoped wrapper. No **deployment runtime file** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) is in scope.

If `/research` or `/plan` finds that satisfying an acceptance criterion would
require touching one of those files, that is a hard-stop: stop and obtain
Workflow Owner direction (GU-2, IM-5) rather than widening scope here.

## Open questions

1. Which storage backend do the new migrations target — the SQLite chat store
   (`CHAT_STORAGE_URI`) as the AC's "SQLite variable limit" wording implies, or
   also PostgreSQL following ticket `cu-z8pmx9kcv5`? This decides the column
   types (`boolean`, JSON) and the 500-id batch bound. To be resolved read-only
   at `/research`. : PostgreSQL
2. Are migration numbers 44/45/46 in fact the next available ones in the chat
   storage migration list? To be confirmed read-only at `/research`. yes
3. Is this ticket storage-layer only — no caller wired up to write debug rows
   (that being downstream tickets 04/06/07/14) — so "done" is the repository
   API plus its tests, not an end-to-end path? yes there is another ticket about that

## Readiness Status

`READY` <!-- set to READY once every readiness check above is marked -->
