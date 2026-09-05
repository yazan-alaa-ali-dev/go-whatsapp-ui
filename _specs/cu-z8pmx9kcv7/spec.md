---
ticket: cu-z8pmx9kcv7
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Specification — 04 · Expose metadata_debug through the chat messages API

> **No implementation detail (SP-4):** no file paths, no code, no approach or
> steps. *What* and *why* only — the *how* belongs to `plan.md`.

## Feature Name

Debug metadata exposure through the chat messages API.

## Business Goal  <!-- SP-1 -->

The AI diagnostics payload (`metadata_debug`) is already persisted per message
but is reachable only by opening the database. Exposing it over the REST API
lets an operator see *why* the AI answered the way it did — and lets the
dashboard (a separate repository) render it — without database access, while
keeping the cost of an ordinary chat page unchanged.

## User Story  <!-- SP-1 -->

As **an ADMIN**,
I want **to read the stored debug metadata of any message through the REST API**,
so that **the dashboard can show why the AI answered the way it did, without
anyone opening the database**.

Three read shapes are deliberate: an always-present flag for rendering a badge
cheaply, a single-message read for lazy expansion, and an opt-in bulk embed for
export. A write path is added for messages initiated from outside the process
(campaigns, manual sends).

## Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| REQ-1 | Every message returned by the chat-messages API carries a boolean `has_debug`, present unconditionally, that states whether stored debug metadata exists for that message on the requesting device. |
| REQ-2 | The chat-messages API accepts an opt-in request flag `include_debug=true`; when set, every returned message that has stored debug metadata also carries `metadata_debug` holding the complete stored payload. |
| REQ-3 | When `include_debug` is not requested, no message in the response carries a `metadata_debug` field at all. |
| REQ-4 | `metadata_debug` is emitted as a JSON object, never as an escaped JSON string requiring a second parse. |
| REQ-5 | A single-message read path, `GET /message/{message_id}/debug`, returns the complete stored debug payload for one message. |
| REQ-6 | The single-message read path answers `404` with the standard structured error envelope when the message has no stored debug data. |
| REQ-7 | `POST /send/message` accepts an optional `metadata_debug` value and, on a successful send, stores it against the `message_id` it returns. |
| REQ-8 | Every new or changed path resolves the device from the `X-Device-Id` header and never returns or writes another device's data. |
| REQ-9 | A failure to retrieve debug data while listing messages does not fail the listing: the messages are still returned. |
| REQ-10 | A failure to store `metadata_debug` during a send does not fail a send that already succeeded. |
| REQ-11 | Every debug read or write failure is logged at warning level including the message id. |
| REQ-12 | All new paths use the existing response envelope (`code`, `message`) and the existing device-scoping behaviour, including its established error codes. |

## Non-Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| NFR-1 | Determining `has_debug` must not retrieve payload contents — a listing without `include_debug` never loads debug payloads, so the cost of an ordinary chat page is unchanged. |
| NFR-2 | Debug resolution for one page of messages uses a bounded number of storage lookups independent of the page size (no per-message lookup). |
| NFR-3 | A response carrying embedded payloads is bounded by an explicit, documented limit; the worst case must not be an unbounded response. |
| NFR-4 | Debug handling is secondary: it never blocks, delays, or aborts the primary operation (listing messages, sending a message). |
| NFR-5 | The stored payload is untrusted third-party content: it is passed through verbatim, never reshaped, and never logged raw. |
| NFR-6 | The change is additive for existing consumers: apart from the new always-present `has_debug`, existing responses are unchanged when the new flag is absent. |

## Constraints  <!-- SP-2 -->

- The storage layer delivered by ticket `cu-z8pmx9kcv6` is the only source of
  debug data; this ticket reads and writes through it and does not change how a
  payload is validated, decomposed, or stored.
- Device identity used to read debug data must be the same identity form used
  when the row was written, or the read silently returns nothing.
- The write side receives `metadata_debug` as a request string while the read
  side emits it as an object; the value stored must be the object the storage
  layer accepts.
- `metadata_debug` is accepted on `POST /send/message` only; no other send
  endpoint changes.
- The **inbound** write path — storing the `metadata_debug` returned in the omni
  AI webhook response — is owned by ticket 06 (`z8pmx9kcv9`) and must not be
  built here. Both paths write the same device-scoped store, so the read paths
  specified here serve ticket 06's rows unchanged.
- The MCP surface gains no `include_debug` argument; `has_debug` appears there
  only because it shares the same message representation.
- No **deployment runtime file** (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
  `.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
  `.github/workflows/set-latest-tag.yaml`) is modified.

## Edge Cases

- A message with no stored debug data: `has_debug` is `false`, `metadata_debug`
  is absent, and the listing still succeeds — absence is normal, not an error.
- `include_debug=true` on a chat where no message has debug data: a normal
  response with no `metadata_debug` field anywhere.
- A search-filtered listing behaves exactly like an unfiltered one with respect
  to `has_debug` and `metadata_debug`.
- A chat that has never been stored: the existing empty response is returned
  unchanged, with no error.
- A message id that belongs to another device: treated as having no debug data.
- A request without a device identifier, or with an unknown one: the existing
  `400 DEVICE_ID_REQUIRED` / `404 DEVICE_NOT_FOUND` envelopes, unchanged.
- With basic auth enabled, a request without credentials: `401`, unchanged.
- A `metadata_debug` value the storage layer refuses (not a JSON object, or over
  the size limit): the send still succeeds and a warning is logged.
- A storage failure during a listing: messages are returned without debug data
  and a warning is logged.

## Acceptance Criteria  <!-- SP-3 / TR-1 -->

Observable, independently testable, pass/fail. Each maps to a requirement and is
referenced by the same ID in `verify.md` (TR-2).

| ID | Criterion | Maps to |
|----|-----------|---------|
| AC-1 | Every message object in a chat-messages response contains `has_debug`, whether or not `include_debug` was requested. | REQ-1 |
| AC-2 | `has_debug` is `true` exactly for those messages that have stored debug data for the requesting device, and `false` otherwise. | REQ-1 |
| AC-3 | With `include_debug=true`, every returned message that has stored debug data also carries `metadata_debug` holding the complete stored payload. | REQ-2 |
| AC-4 | Without `include_debug`, no message in the response carries a `metadata_debug` field. | REQ-3 |
| AC-5 | `metadata_debug` parses as a JSON object in a single parse — it is never a quoted, escaped string. | REQ-4 |
| AC-6 | With `include_debug=true`, a message without stored debug data carries no `metadata_debug` field (omitted, not `null`). | REQ-2 |
| AC-7 | `GET /message/{message_id}/debug` returns `200` with the complete stored payload for a message that has one. | REQ-5 |
| AC-8 | `GET /message/{message_id}/debug` returns `404` with a structured `code` and `message` when the message has no stored debug data. | REQ-6 |
| AC-9 | A `POST /send/message` carrying `metadata_debug` results in that payload being retrievable afterwards, through both read paths, against the returned `message_id`. | REQ-7 |
| AC-10 | A `POST /send/message` without `metadata_debug` stores nothing: the resulting message reports `has_debug: false`. | REQ-7 |
| AC-11 | All three read paths are device-scoped: a message id belonging to another device yields no debug data (`has_debug: false`, or `404` on the single-message path). | REQ-8 |
| AC-12 | Device and authentication errors are unchanged: no device identifier → `400` `DEVICE_ID_REQUIRED`; unknown device → `404` `DEVICE_NOT_FOUND`; with basic auth enabled and no credentials → `401`. | REQ-8, REQ-12 |
| AC-13 | When the debug lookup fails during a listing, the listing still returns its messages successfully, without debug data, and logs a warning. | REQ-9 |
| AC-14 | When storing `metadata_debug` fails during a send, the send still returns success with its `message_id`, and a warning naming the message id is logged. | REQ-10 |
| AC-15 | Every debug read or write failure is logged at warning level with the message id, and the raw payload is never logged. | REQ-11, NFR-5 |
| AC-16 | Every new response — success and error alike — uses the existing envelope (`code`, `message`). | REQ-12 |
| AC-17 | A listing without `include_debug` retrieves no payload contents. | NFR-1 |
| AC-18 | Debug resolution for one page of messages costs a bounded number of storage lookups that does not grow with the number of messages on the page. | NFR-2 |
| AC-19 | The size of a response carrying embedded payloads is bounded by an explicit documented limit, and the behaviour at that limit is defined. | NFR-3 |
| AC-20 | Existing consumers are unaffected: aside from `has_debug`, responses are byte-identical to today's when `include_debug` is absent, and the MCP message-listing tool exposes no `include_debug` argument. | NFR-6 |
| AC-21 | A search-filtered listing reports `has_debug` and embeds `metadata_debug` exactly as an unfiltered listing does. | REQ-1, REQ-2 |
| AC-22 | The inbound (omni webhook response) write path is not implemented here and the existing generic webhook behaviour is unchanged. | Constraints |
| AC-23 | The validation profile for Go source passes, and no deployment runtime file is modified. | Constraints |

## Test Cases

At least one per acceptance criterion; each states precondition, action, and
expected result, and is reproducible by someone other than the author.

### TC-1 — Debug object is returned as an object (covers AC-1, AC-3, AC-5)

- **Given** message `M` in chat `C` has stored debug data for device `A`
- **When** the chat messages of `C` are requested with `include_debug=true` and the correct device header
- **Then** `M` carries `has_debug: true` and a `metadata_debug` that parses as a JSON object without a second parse

### TC-2 — The flag is opt-in (covers AC-4, AC-17)

- **Given** the same message `M` with stored debug data
- **When** the chat messages are requested without `include_debug`
- **Then** `has_debug` is still `true`, no message carries a `metadata_debug` field, and no payload content was retrieved

### TC-3 — Absence is normal (covers AC-2, AC-6)

- **Given** chat `C` contains message `N` with no stored debug data
- **When** the chat messages are requested with and then without `include_debug=true`
- **Then** `N` reports `has_debug: false` in both cases, and in neither case is a `metadata_debug` key present for `N` (omitted, not `null`)

### TC-4 — Single-message read, happy path (covers AC-7, AC-16)

- **Given** message `M` has stored debug data for device `A`
- **When** `GET /message/M/debug` is called with device `A`
- **Then** the response is `200`, carries the complete stored payload as an object, and uses the standard envelope

### TC-5 — Single-message read, missing debug data (covers AC-8)

- **Given** message `N` exists but has no stored debug row
- **When** `GET /message/N/debug` is called
- **Then** the response status is `404` and the body carries a structured `code` and `message`

### TC-6 — Write side from an outbound send (covers AC-9, AC-10)

- **Given** a device that can send messages
- **When** `POST /send/message` is called once with a valid `metadata_debug` object and once without it
- **Then** the first message's `message_id` reports `has_debug: true` and returns the same payload from both read paths; the second reports `has_debug: false` and `404` on the single-message path

### TC-7 — Device isolation (covers AC-11)

- **Given** device `A` has stored debug data for message `M`
- **When** device `B` lists the same chat and calls `GET /message/M/debug`
- **Then** `B` sees `has_debug: false` (or no such message) and receives `404`; no data belonging to `A` is exposed

### TC-8 — Authorization and device errors (covers AC-12)

- **Given** basic auth is enabled and two devices are registered
- **When** the chat messages are requested without credentials
- **Then** the status is `401`
- **When** they are requested with credentials but without a device identifier
- **Then** the status is `400` with code `DEVICE_ID_REQUIRED`; an unknown device identifier yields `404` `DEVICE_NOT_FOUND`

### TC-9 — Degradation on read failure (covers AC-13, AC-15)

- **Given** the debug lookup is made to fail for a chat that has messages
- **When** the chat messages are requested with `include_debug=true`
- **Then** the response is successful and lists the messages, carries no debug data, and a warning naming the message id is logged without the raw payload

### TC-10 — Degradation on write failure (covers AC-14, AC-15)

- **Given** a send that succeeds, carrying a `metadata_debug` the storage layer refuses (not a JSON object, or over the size limit)
- **When** `POST /send/message` is called
- **Then** the send response is success and carries its `message_id`, a warning naming the message id is logged, and no debug row exists for that message

### TC-11 — Bounded cost and bounded size (covers AC-18, AC-19)

- **Given** a chat page containing many messages that all have stored debug data
- **When** the page is requested with `include_debug=true`
- **Then** the number of storage lookups does not grow with the number of messages on the page, and the response respects the documented size bound with the defined behaviour at that bound

### TC-12 — Search path parity (covers AC-21)

- **Given** chat `C` where a search term matches messages that have stored debug data
- **When** the chat messages are requested with that search term, with and without `include_debug=true`
- **Then** `has_debug` and `metadata_debug` behave exactly as in the unfiltered listing

### TC-13 — No regression and no scope creep (covers AC-20, AC-22, AC-23)

- **Given** the change set for this ticket
- **When** the Go validation profile is run and the diff is reviewed
- **Then** build, vet and tests pass; responses are otherwise unchanged when `include_debug` is absent; the MCP message-listing tool has no `include_debug` argument; the generic webhook path is untouched; and no deployment runtime file is modified

## Open Questions

All intake and research questions were answered by the owner on 2026-08-16 (see
`intake.md` and `research.md`). Two decisions are deliberately deferred to
`/plan`, where they belong:

1. The explicit bound behind AC-19 (page cap, payload guard, or both) — the
   owner directed "apply best practice"; the plan proposes it and the review
   gate decides.
2. How `has_debug` is obtained without loading payloads (AC-17/NFR-1) — the
   owner chose the "cheap existence check" option; the plan states its shape.

## Out of Scope  <!-- SP-5 -->

- Any dashboard or UI change — the dashboard is a separate forked repository,
  and this repository no longer embeds a UI.
- The inbound omni AI bridge (storing `metadata_debug` from the webhook
  response) — ticket 06, `z8pmx9kcv9`.
- Exposing `include_debug` on the MCP surface.
- Updating `docs/openapi.yaml` or any other API documentation.
- Accepting `metadata_debug` on send endpoints other than `POST /send/message`.
- Changing the debug storage schema, its validation, its promoted columns, or
  adding a retention/purge policy.
- Filtering or querying messages *by* debug fields (thread, session, model).
- Any change to a deployment runtime file.
