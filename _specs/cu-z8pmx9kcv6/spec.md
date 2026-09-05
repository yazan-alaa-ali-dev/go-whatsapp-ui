---
ticket: cu-z8pmx9kcv6
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-15
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv6"
  github: ""
---

# Specification — 03 · Create the message debug storage layer

> **No implementation detail (SP-4):** no file paths, no code, no approach or
> steps. *What* and *why* only — the *how* belongs to `plan.md`.

## Feature Name

Durable, device-scoped storage for the AI reply diagnostics payload
(`metadata_debug`), lossless in full and queryable on a stable core of fields.

## Business Goal  <!-- SP-1 -->

Every reply produced by the omni AI carries a diagnostics payload that is
currently discarded. Keeping it, keyed to the message it belongs to, lets an
operator replay the exact diagnostic state behind a single answer **and** ask
questions across many answers — by thread, session or model — without reading
JSON by hand. Because the payload's shape is owned by another team and will keep
changing, it must be stored losslessly, while only a small, stable core is
exposed as directly queryable data.

## User Story  <!-- SP-1 -->

As **the SYSTEM**,
I want **to persist the exact diagnostics payload returned with every AI reply,
keyed to its message and its device, with a stable core of its fields
individually queryable**,
so that **an operator can replay the full payload of one answer and query across
answers by thread, session or model without parsing JSON by hand**.

## Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| REQ-1 | The storage contract can record the diagnostics payload of one message, identified by the owning device and the message id. |
| REQ-2 | The payload is retained **losslessly and verbatim**: every key is preserved, including keys whose value is `null` and keys unknown to this ticket. What is read back is byte-identical to what was written. |
| REQ-3 | The retained payload is the **source of truth**; any separately queryable copy of a field is derived data and is never treated as authoritative. |
| REQ-4 | A stable core of fields is individually queryable without parsing the payload: `enabled_by`, `phone`, `intent`, `model`, `message.type`, `message.len`, `session.id`, `thread.id`, `thread.intent_complete`. |
| REQ-5 | Fields outside that core — including `source`, `memory`, `api`, `tokens`, `langsmith` — remain available through the retained payload only. |
| REQ-6 | The queryable fields are derived by the storage layer itself from the payload it is given; a caller never supplies them separately. |
| REQ-7 | Lookups scoped to one device and filtered by thread, or by session, are supported by an index rather than a full scan. |
| REQ-8 | Recording is idempotent per `(device, message)`: recording again for the same pair replaces the previous record rather than creating a second one or failing. |
| REQ-9 | A batch read returns, for one device and a set of message ids, **every stored value** for each id that has a record — the verbatim payload together with all queryable fields. Ids without a record are simply absent from the result. |
| REQ-10 | Every read and write is explicitly device-scoped; no operation returns or affects data belonging to another device. |
| REQ-11 | The `phone` value carried inside the payload is stored for cross-checking only and is never used to resolve which device a record belongs to. |
| REQ-12 | A payload that is not valid JSON is rejected before anything is stored, and the rejection is logged with the message id. |
| REQ-13 | A queryable field that is absent, `null`, or of an unexpected type is recorded as its zero value (empty text, `0`, `false`) and never causes the write to fail. |
| REQ-14 | A failed diagnostics write never aborts or fails its caller; it is logged as a warning carrying the message id. A failure to derive a field is logged at debug level and still leaves the record written. |
| REQ-15 | Each record carries the time it was created and the time it was last updated. |
| REQ-16 | A record is associated with the message it describes (device, message id, and the conversation the message belongs to), but **its existence does not depend on the message record already existing** — a diagnostics write must never fail because its message has not been stored yet. |
| REQ-17 | Because the association is not enforced by the storage engine, the existing removal paths remove diagnostics records explicitly: deleting one message, deleting a device's data, and truncating all conversations each leave no diagnostics record behind. |
| REQ-18 | A batch read for an empty set of message ids returns an empty result without querying the database, and never produces a degenerate empty-set query. |
| REQ-19 | A batch read for more ids than the backend's bound-parameter limit allows is split into several queries and still returns the complete result. |
| REQ-20 | The new operations are part of the storage contract and are available through the device-scoped access path, which supplies the device identity automatically. |

## Non-Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| NFR-1 | All new schema and queries are expressed in **portable SQL**, valid on the chat store's current engine and on PostgreSQL, so the separate chat-store migration ticket can switch engines without rewriting them. |
| NFR-2 | Schema evolution is **append-only**: new schema steps are added as the next available versions; no existing step is edited, reordered or removed. |
| NFR-3 | Each schema step contains exactly one SQL statement, because the schema runner executes one statement per step. |
| NFR-4 | No existing storage behaviour changes: every operation that exists today keeps its current contract and results. |
| NFR-5 | The payload's shape is owned by another team and will keep changing; storage must accept new and removed keys without a schema change and without data loss. |
| NFR-6 | Recording diagnostics is not on the critical path of sending a reply: it must not extend or block the caller's response. |

## Constraints  <!-- SP-2 -->

- The chat store runs on its current engine today; moving it to PostgreSQL is a
  **separate ticket** that this one blocks. PostgreSQL already backs the
  WhatsApp session store only. No engine, driver, or configuration change is in
  scope here.
- This ticket delivers the **storage layer only**. No producer is wired up to
  write diagnostics, and no user-facing surface reads them — that is the work of
  the tickets this one blocks (04, 06, 07, 14).
- No **deployment runtime file** is in scope (intake: deployment runtime impact
  = *No*). Touching one is a hard stop (GU-2, IM-5).
- The association with the message is **soft** — carried as data, not enforced
  by the storage engine — a decision recorded by the owner on 2026-08-15 to
  protect REQ-16 against the asynchronous ordering of message writes. Its cost
  is REQ-17: cleanup must be explicit.
- The queryable core is fixed by the payload contract cited in the ticket
  description; changing it is out of scope.

## Edge Cases

- The reference payload where `intent`, `model`, `memory`, `api`, `tokens` and
  `langsmith` are all `null` — today's normal case, not an error (REQ-13).
- A payload carrying a key this ticket has never seen (REQ-2, NFR-5).
- A payload where a core field has the wrong type (e.g. a textual message
  length) (REQ-13).
- Input that is not JSON at all — rejected, unlike the cases above (REQ-12).
- A diagnostics write arriving **before** the message it describes has been
  stored (REQ-16).
- Two devices holding the same WhatsApp message id (REQ-1, REQ-10).
- A batch read with zero ids, and one with far more ids than the engine's
  parameter limit (REQ-18, REQ-19).
- Recording twice for the same message — a correction or a retry (REQ-8).

## Acceptance Criteria  <!-- SP-3 / TR-1 -->

Observable, independently testable, pass/fail. Each maps to a requirement and is
referenced by the same ID in `verify.md` (TR-2).

| ID | Criterion | Maps to |
|----|-----------|---------|
| AC-1 | Recording the reference payload for a device and message id, then reading it back, returns a payload **byte-identical** to the input. | REQ-1, REQ-2 |
| AC-2 | After recording the reference payload, the queryable fields hold `enabled_by = api`, `phone = +963938113282`, `message.type = chat`, `message.len = 26`, `session.id = 588d6cdf-3ba0-4d46-9af4-72b66c71259c`, `thread.id = +963938113282::69959da0491781ef06b06511`, `thread.intent_complete = false`. | REQ-4, REQ-6 |
| AC-3 | Fields outside the queryable core (`source`, `memory`, `api`, `tokens`, `langsmith`) are retrievable from the retained payload and are not exposed as separate queryable fields. | REQ-5 |
| AC-4 | Selecting the records of one device filtered by thread, and separately by session, is served by an index — confirmed by the engine's query plan, not by a table scan. | REQ-7 |
| AC-5 | Recording twice for the same device and message id leaves exactly one record, carrying the second payload. | REQ-8 |
| AC-6 | A batch read for a device and a set of message ids returns, for each id that has a record, the verbatim payload **and** every queryable field; ids without a record are absent from the result. | REQ-9 |
| AC-7 | A batch read issued for device B does not return a record written by device A, even when both used the same message id; and two devices can each hold a record for the same message id. | REQ-1, REQ-10 |
| AC-8 | The `phone` value inside a payload is never used to select or resolve a device: a read for a device returns nothing on the strength of a matching `phone` alone. | REQ-11 |
| AC-9 | Recording a value that is not valid JSON stores no record and logs the rejection with the message id. | REQ-12 |
| AC-10 | Recording the reference payload — where `intent` and `model` are `null` — succeeds, stores those two as empty text, and leaves both keys present with their `null` values in the retained payload. | REQ-13, REQ-2 |
| AC-11 | Recording a payload carrying an unknown key succeeds and the unknown key is present, in full, in the retained payload. | REQ-2, NFR-5 |
| AC-12 | Recording a payload whose core field has an unexpected type succeeds, stores that field's zero value, and does not abort the write. | REQ-13 |
| AC-13 | A diagnostics write that fails returns control to its caller without failing it, and the failure is logged as a warning carrying the message id. | REQ-14 |
| AC-14 | Every record exposes a creation time and a last-update time; re-recording for the same message advances the last-update time. | REQ-15, REQ-8 |
| AC-15 | Recording diagnostics for a message that has **not** been stored yet succeeds. | REQ-16 |
| AC-16 | After deleting a single message, after deleting a device's data, and after truncating all conversations, no diagnostics record belonging to the removed scope remains. | REQ-17 |
| AC-17 | A batch read for an empty set of ids returns an empty result and executes no query. | REQ-18 |
| AC-18 | A batch read for 1200 ids returns the complete result, split across more than one query. | REQ-19 |
| AC-19 | Both operations are reachable through the storage contract and through the device-scoped access path, which supplies the device identity without the caller passing it. | REQ-20 |
| AC-20 | The new schema steps are appended as the next available versions, each containing exactly one statement; no pre-existing step is edited, reordered or removed. | NFR-2, NFR-3 |
| AC-21 | The whole module builds, passes static analysis, and the existing test suite passes unchanged — no existing storage behaviour is altered. | NFR-4 |
| AC-22 | The new schema and queries use only constructs valid on both the current engine and PostgreSQL — no engine-specific upsert, type name, or auto-increment syntax. | NFR-1 |
| AC-23 | No deployment runtime file is modified. | Constraints |

## Test Cases

At least one per acceptance criterion; each states precondition, action, and
expected result, and is reproducible by someone other than the author.

### TC-1 — The reference payload is stored and decomposed (covers AC-1, AC-2)

- **Given** a store with the schema applied
- **When** the reference payload from the ticket description is recorded for a
  device and a message id, then read back
- **Then** the retained payload is byte-identical to the input, and the queryable
  fields hold exactly the values listed in AC-2

### TC-2 — Non-core fields stay inside the payload (covers AC-3)

- **Given** a stored reference payload
- **When** its record is read back
- **Then** `source`, `memory`, `api`, `tokens` and `langsmith` are obtainable
  from the retained payload, and none of them appears as a separate queryable
  field

### TC-3 — Querying across answers by thread and by session (covers AC-4)

- **Given** three records stored for the same thread and the same device, and a
  further set stored for the same session
- **When** the records are selected by device and thread, and by device and
  session
- **Then** all matching records are returned and the engine's query plan shows
  an index being used in both cases

### TC-4 — Re-recording replaces (covers AC-5, AC-14)

- **Given** a record already stored for a device and message id
- **When** a second, different payload is recorded for the same pair
- **Then** exactly one record exists, it carries the second payload, its creation
  time is unchanged and its last-update time has advanced

### TC-5 — Batch read returns every stored value (covers AC-6, AC-19)

- **Given** records stored for two of three requested message ids on one device
- **When** the batch read is performed for all three ids, once through the
  storage contract directly and once through the device-scoped access path
  without passing a device explicitly
- **Then** both calls return two entries, each carrying the verbatim payload and
  all queryable fields, and the third id is absent

### TC-6 — Device isolation (covers AC-7, AC-8)

- **Given** device A has recorded diagnostics for message `M`, whose payload
  carries a `phone` value
- **When** a batch read is performed for device B with message id `M`, and
  device B separately records its own payload for the same message id
- **Then** device B's read does not contain `M` and exposes nothing belonging to
  device A; both devices' records coexist; and no lookup resolves a device from
  the payload's `phone`

### TC-7 — Malformed input is rejected (covers AC-9)

- **Given** a store with the schema applied
- **When** a value that is not valid JSON is recorded
- **Then** no record is written and a rejection is logged carrying the message id

### TC-8 — Null, unknown and wrongly-typed fields (covers AC-10, AC-11, AC-12)

- **Given** the reference payload, a variant carrying an unknown key, and a
  variant whose message length is textual
- **When** each is recorded
- **Then** all three writes succeed; `intent` and `model` are stored as empty
  text while their keys remain present with `null` in the retained payload; the
  unknown key is retained in full; and the wrongly-typed field is stored as its
  zero value

### TC-9 — A failing write never breaks its caller (covers AC-13)

- **Given** a store in which the diagnostics write cannot succeed
- **When** a caller records diagnostics
- **Then** the caller continues normally and a warning carrying the message id
  is logged

### TC-10 — Diagnostics may precede their message (covers AC-15)

- **Given** a store in which no message record exists for a given message id
- **When** diagnostics are recorded for that message id
- **Then** the write succeeds and the record is readable

### TC-11 — Removal paths leave nothing behind (covers AC-16)

- **Given** diagnostics records stored for several messages across two devices
- **When** one message is deleted, then one device's data is deleted, then all
  conversations are truncated
- **Then** after each step no diagnostics record belonging to the removed scope
  remains, and records outside that scope are untouched

### TC-12 — Batch edges (covers AC-17, AC-18)

- **Given** a store with the schema applied
- **When** a batch read is performed with zero ids, and separately with 1200 ids
- **Then** the empty call returns an empty result having executed no query, and
  the large call returns the complete result using more than one query

### TC-13 — Schema evolution and portability (covers AC-20, AC-22)

- **Given** the schema step list before the change
- **When** it is compared with the list after the change
- **Then** only new steps are appended at the next available versions, each
  holds exactly one statement, no earlier step differs, and no step uses a
  construct that is invalid on either the current engine or PostgreSQL

### TC-14 — No regression, no runtime-file change (covers AC-21, AC-23)

- **Given** the working tree containing the change
- **When** the module is built, statically analysed and its test suite run, and
  the changed-file list is inspected
- **Then** all three checks pass and no deployment runtime file appears in the
  changed-file list

## Open Questions

None blocking. The five questions raised at `/research` were all answered by the
owner on 2026-08-15 and are reflected above: portable SQL with no engine change
(NFR-1, Constraints); the batch read returns all stored values, not the payload
alone (REQ-9, AC-6); creation and update times are required (REQ-15); the
message association is soft, with explicit cleanup (REQ-16, REQ-17).

One item is **deliberately deferred to `/plan`**, being a *how*: the exact
naming and column layout of the new storage area, including the fact that a soft
association carries the conversation identifier alongside the message id — a
column the originating ticket description does not list.

## Out of Scope  <!-- SP-5 -->

- Wiring any producer to record diagnostics, and any user-facing surface that
  reads them (tickets 04, 06, 07, 14).
- Moving the chat/message store to PostgreSQL, and any driver or connection
  configuration change.
- Making non-core payload fields (`source`, `memory`, `api`, `tokens`,
  `langsmith`) individually queryable.
- Retention, archival or purging policy for diagnostics beyond the removal paths
  in REQ-17.
- Any change to a deployment runtime file.
- Backfilling diagnostics for messages that predate this change.
