---
ticket: cu-z8pmx9kcv7
stage: intake
mode: standard
status: in_progress
owner: developer
updated: 2026-08-16
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv7"
  github: ""
---

# Intake — 04 · Expose metadata_debug through the chat messages API

## Ticket Reference

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Slug    | `cu-z8pmx9kcv7`                                        |
| Title   | 04 · Expose metadata_debug through the chat messages API |
| Owner   | developer                                              |
| Created | 2026-08-16                                             |
| ClickUp | https://app.clickup.com/t/z8pmx9kcv7                   |

## Ticket Summary

<!-- Seeded read-only from ClickUp (CU-5); task description verbatim. -->

> **Execution order:** 04 of 15 · **Depends on:** 03 · **Blocks:** 12
>
> **Board origin:** `z8pmx9kbej` (second half) · **Reference:** `gowa-study-ar.html` §04, §06

## User Story

As **an ADMIN**,
I want to be able to **read the stored debug metadata of any outbound message through the REST API**,
so that **the dashboard can show why the AI answered the way it did, without anyone opening the database**.

Three read paths are provided deliberately: a cheap always-present `has_debug` flag for rendering a badge, a single-message endpoint for lazy expansion, and a bulk query parameter for export. The payload is an object, not a string, so it is carried as `json.RawMessage`. This ticket also adds the write side for messages initiated from outside the process (campaigns, manual sends).

# Acceptance Criteria

* * *

## Scope & Tenant Safety
1. All three read paths resolve the device from the `X-Device-Id` header and never return another device's data.

## General Behavior
1. `MessageInfo` gains `metadata_debug` typed as `json.RawMessage` with `omitempty`.
2. `MessageInfo` gains `has_debug` (boolean) which is returned on every message, populated by a cheap existence check.
3. `GET /chat/{jid}/messages?include_debug=true` embeds the full object for every message that has one.
4. Without `include_debug`, the `metadata_debug` field is absent from the response entirely.
5. `GET /message/{id}/debug` returns the full object for a single message.
6. `POST /send/message` accepts an optional `metadata_debug` string and stores it against the resulting `message_id`.

## Validation & Constraints
1. `metadata_debug` is emitted as a JSON object, never as an escaped string.
2. `GET /message/{id}/debug` returns 404 when the message exists but has no debug row.
3. A failure to store `metadata_debug` on `POST /send/message` is logged but does not fail a send that already succeeded.
4. A failure to fetch debug data while listing messages is logged and the messages are still returned.

## UI & API Consistency
1. The same device scoping and the same error envelope (`code`, `message`) apply to all new endpoints.

## Audit & Logging
1. Debug read and write failures are logged with the message id at warning level.

# Test Cases

* * *

## Happy path — debug object is returned as an object
**Given** message `M` has stored debug data
**When** `GET /chat/{jid}/messages?include_debug=true` is called with the correct `X-Device-Id`
**Then**
*   `metadata_debug` is present and parses as a JSON object without a second parse
*   `has_debug` is `true` for `M`

## Validation error — missing debug data
**Given** message `M` exists but has no debug row
**When** `GET /message/M/debug` is called
**Then**
*   The response status is 404
*   The body carries a structured `code` and `message`

## Authorization failure — request without credentials or device
**Given** basic auth is enabled and two devices are registered
**When** `GET /chat/{jid}/messages` is called without credentials
**Then**
*   The response status is 401

**When** it is called with credentials but without `X-Device-Id`

**Then**

*   The response status is 400 with code `DEVICE_ID_REQUIRED`

<!-- end ClickUp description -->

## Goal

Surface the `metadata_debug` payload stored by ticket `cu-z8pmx9kcv6` through the
REST API — a cheap `has_debug` flag on every message, an opt-in
`include_debug=true` bulk embed on the chat messages listing, and a
`GET /message/{id}/debug` single-message endpoint — plus an optional
`metadata_debug` field on `POST /send/message` for externally initiated sends,
all device-scoped via `X-Device-Id`.

## Readiness checks

Mark each check. The ticket may not leave `draft` until Readiness Status is
`READY` (RS-7).

- [x] The request has a clear, single focused outcome (one ticket = one outcome).
- [x] The goal is stated in one or two sentences.
- [x] Success is describable in observable, testable terms.
- [x] No hard-stop condition applies (see `CLAUDE.md > Hard stop conditions`).
- [x] Any deployment runtime file impact is known and called out below.

## Deployment runtime impact

**No.** Owner decision (2026-08-16): the deliverable is an API-surface change —
response DTOs, REST handlers/routes, and the service/usecase wiring onto the
existing `SetMessageDebug` / `GetMessageDebugBatch` storage layer delivered by
`cu-z8pmx9kcv6`. No **deployment runtime file** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) is in scope.

If `/research` or `/plan` finds that satisfying an acceptance criterion would
require touching one of those files, that is a hard-stop: stop and obtain
Workflow Owner direction (GU-2, IM-5) rather than widening scope here.

## Open questions

1. Does the ticket cover the embedded Vue 3 dashboard UI, or API only? The
   ClickUp user story motivates the dashboard but every acceptance criterion is
   an API criterion.
   **Owner answer (2026-08-16): API only.** The dashboard lives in a separate
   forked repository and is modified there, not in this project. What must be
   true here is that the API calls succeed and return the debug data. Any UI
   change in this repo is therefore **out of scope**.
2. Is `has_debug` expected on **all** message-listing responses only, or on every
   endpoint returning `MessageInfo`? AC "General Behavior 2" says "every
   message"; the exact set of affected endpoints is a `/research` question.
   **Owner answer (2026-08-16): not a yes/no decision — follow best practice.**
   `/research` determines every site that returns `MessageInfo` and `/plan`
   proposes the consistent treatment; the owner reviews it at the review gate.
3. `POST /send/message` accepts `metadata_debug` as a **string** (write side)
   while reads emit it as an **object** — is the string parsed/validated as JSON
   before storage, and does an invalid string fail the request or only log?
   (Validation AC 3 implies log-and-continue.)
   **Owner answer (2026-08-16), read behaviour:** when debug data is requested,
   a message that **has** debug data must return it; a message that has **no**
   debug data is a normal, expected case and must **not** return an error.
   *Consequence:* this contradicts ClickUp AC "Validation & Constraints 2"
   (`GET /message/{id}/debug` returns 404 when the message exists but has no
   debug row) — see open question 5, which must be settled before `/spec`.
   The write-side validation detail is resolved by answer 2 (best practice:
   validate the string as JSON before storing; on failure log a warning and
   never fail an already-successful send, per AC "Validation & Constraints 3").
4. Does the single-message endpoint `GET /message/{id}/debug` collide with any
   existing `/message/{id}/...` route, and which existing error-envelope helper
   produces the `code`/`message` body (e.g. `DEVICE_ID_REQUIRED`)? To be
   resolved read-only at `/research`.
   **Owner answer (2026-08-16): no collision expected — it is a separate API.**
   `/research` still confirms read-only which existing error-envelope helper
   produces the `code`/`message` body, so the new endpoint matches the existing
   contract.
5. `GET /message/{id}/debug` for a message that exists but has **no** debug row:
   ClickUp AC says **404 with a structured `code`/`message`**; owner answer 3
   says a missing debug row is normal and must **not** be an error.
   **Owner decision (2026-08-16): 404 on the single-message endpoint only.**
   `GET /message/{id}/debug` keeps the ClickUp behaviour — `404` with the
   standard `code`/`message` envelope — because that path requests one specific
   resource explicitly. The **listing** paths never error on missing debug data:
   `has_debug` is simply `false` and `metadata_debug` is absent, and a failure to
   fetch debug data while listing is logged while the messages are still
   returned. Both ClickUp criteria therefore stand as written; no AC is
   rewritten.

## Readiness Status

`READY`   <!-- set to READY once every readiness check above is marked -->
