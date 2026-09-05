---
ticket: 86eyhz682
stage: spec
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz682
  github:
---

# Spec — 86eyhz682

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Stored-first conversation reading with an on-demand WhatsApp fallback and
per-message diagnostics.

## Business Goal

A conversation must open in milliseconds instead of seconds, keep opening while
the WhatsApp session is down, and show the AI agent's reasoning for the messages
that carry it — without giving up the older history that only WhatsApp holds,
and without weakening tenant isolation.

## User Story

> As an ADMIN operating the contacts dashboard for a tenant, I want to read a
> conversation from MongoDB by default, with a WhatsApp fetch available on
> demand and a diagnostics badge on messages that carry one, so that
> conversations open in milliseconds, keep working while the WhatsApp session is
> down, and expose the AI agent's reasoning without a separate lookup.

## Functional Requirements

- **REQ-1** A read surface returns the messages of one conversation for one
  tenant and one WhatsApp number, in the canonical conversation order, in pages
  of a bounded size.
- **REQ-2** That surface never depends on the WhatsApp session: it answers
  identically whether the session is connected, disconnected or absent.
- **REQ-3** A returned message carries at least its direction, body, timestamp,
  delivery status, conversation key and diagnostic payload.
- **REQ-4** Tenant scope is resolved from the caller's own authenticated
  context; no caller-supplied value can widen it.
- **REQ-5** The dashboard opens a conversation from the stored surface by
  default, and can extend the visible range without re-reading what it already
  holds.
- **REQ-6** The dashboard can fetch older history from WhatsApp on demand,
  through the existing live path, unchanged.
- **REQ-7** The dashboard shows a diagnostics affordance on exactly those
  messages that carry a diagnostic payload, and can display that payload.
- **REQ-8** A payload recorded as truncated is presented as a truncation notice
  rather than as data or as a failure.
- **REQ-9** The screen never asserts a global debug-mode state, because the
  gateway does not track the flag or its expiry.
- **REQ-10** Refusals and fallbacks are auditable without recording message
  content, whole customer numbers or secrets.

## Non-Functional Requirements

- **NFR-1** A conversation read is served by an existing index: equality on
  tenant, number and conversation key, with the sort walking the index rather
  than blocking in memory.
- **NFR-2** Work per request is bounded regardless of caller input — page size,
  page number and identifier length all have server-side ceilings.
- **NFR-3** Externally supplied diagnostic content is treated as untrusted
  wherever it is displayed.
- **NFR-4** The change is additive: existing consumers of the message-list
  contract keep working unmodified.

## Constraints

- No deployment runtime file may be modified.
- The persistence layer, the capture listener and the storage caps delivered by
  ticket 2/4 must not change.
- The live path, its in-page backtracking and its failure-cause classification
  must not be removed or modified.
- Contact names and photos are not in the database and must keep coming from
  WhatsApp.
- Media rendering, and the per-contact Enable/Disable control, belong to other
  tickets.

## Edge Cases

- A conversation with no stored messages at all.
- A conversation whose history predates the gateway entirely.
- A conversation key that is empty, malformed, oversized, or names a chat type
  that is deliberately not stored.
- A page size far above the maximum, and a negative one; a page number beyond
  the end, and a negative one.
- Two messages sharing one timestamp (one-second WhatsApp resolution).
- A conversation in which no message carries diagnostics; and one in which the
  stored payload is only the truncation marker.
- A caller authenticated for one tenant presenting a valid key from another.
- No credentials at all.
- The WhatsApp session unavailable while stored messages exist.

## Open Questions

- None outstanding. The two intake questions (how the WhatsApp number reaches
  the read surface, and the status code for an unauthenticated request) are
  decided in `plan.md` and recorded there with their rationale.

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.
> The IDs below follow the ticket's own order, group by group.

| ID    | Acceptance criterion | Maps to requirement |
|-------|----------------------|---------------------|
| AC-1  | The new endpoint resolves tenantId and waNumberId from the authenticated caller's own context and never from a client-asserted authorization value. | REQ-4 |
| AC-2  | A caller cannot read a conversation belonging to another tenant, even by supplying a valid chatId from that tenant; the response is empty or 403, never another tenant's messages. | REQ-4 |
| AC-3  | Every query issued by the endpoint is filtered on tenantId and waNumberId before chatId, so it is served by the compound index added in the previous ticket. | NFR-1 |
| AC-4  | No deployment runtime file is modified. | Constraints |
| AC-5  | No change is made to the persistence layer, the message_create listener or the storage caps. | Constraints |
| AC-6  | The new endpoint sits behind the same authentication and authorization used by the existing admin message routes; no new anonymous surface is added. | REQ-4 |
| AC-7  | An unauthenticated or wrongly-scoped request is refused and returns no message data in the body. | REQ-4 |
| AC-8  | The dashboard hides the conversation view for a caller who is not authorized to read it, rather than rendering an empty view that implies no messages exist. | REQ-4, REQ-5 |
| AC-9  | The endpoint returns the messages of one conversation for the caller's tenant and number. | REQ-1 |
| AC-10 | Results are ordered by timestamp then creation time, ascending — the order defined by the previous ticket. | REQ-1 |
| AC-11 | The endpoint supports pagination with an explicit page size, defaulting to 50 messages per page. | REQ-1 |
| AC-12 | The page size is bounded by a server-side maximum; a caller-supplied value above it is clamped, not honoured. | NFR-2 |
| AC-13 | The endpoint responds successfully while the WhatsApp session is disconnected; it never returns the 503 produced by the live path. | REQ-2 |
| AC-14 | Each returned message carries at minimum its direction, body, timestamp, delivery status, conversation key and diagnostic payload. | REQ-3 |
| AC-15 | A conversation key with no stored messages returns an empty list with a success status, not an error. | REQ-1 |
| AC-16 | The contacts screen loads a conversation from the new endpoint by default. | REQ-5 |
| AC-17 | A "Fetch from WhatsApp" control invokes the existing live path unchanged, for history predating the gateway. | REQ-6 |
| AC-18 | The live path, its in-page backtracking and its failure-cause classification are not removed or modified. | REQ-6, Constraints |
| AC-19 | The contact list continues to be sourced from WhatsApp for names and photos, with the "last message" preview taken from MongoDB. | REQ-5, Constraints |
| AC-20 | When the session is disconnected, the conversation still opens from MongoDB and the "Fetch from WhatsApp" control is shown as unavailable with a reason, rather than failing silently. | REQ-2, REQ-6 |
| AC-21 | Scrolling or paging through a long conversation loads further pages without re-fetching the whole conversation. | REQ-5 |
| AC-22 | A 🔎 badge is rendered on a message if and only if its diagnostic payload is present and non-null. | REQ-7 |
| AC-23 | Activating the badge opens a panel showing the diagnostic payload for that message. | REQ-7 |
| AC-24 | A payload stored as a truncation marker is displayed as an explicit truncation notice, not as an error and not as raw JSON noise. | REQ-8 |
| AC-25 | The screen never displays a global "debug mode is on/off" state. | REQ-9 |
| AC-26 | When no message in a conversation carries diagnostics, no badge and no panel appear, and no warning is shown. | REQ-7, REQ-9 |
| AC-27 | Diagnostic data is displayed only in the dashboard; it is never included in any text sent to a customer. | REQ-7 |
| AC-28 | A malformed or empty conversation key returns 400 with a structured error, not a 500. | NFR-2 |
| AC-29 | A non-numeric, negative or over-maximum page parameter is rejected or clamped deterministically, and the rule is the same in the UI and in the API. | NFR-2 |
| AC-30 | The endpoint returns a structured error body for every failure case, matching the shape used by the existing admin routes. | NFR-4 |
| AC-31 | The shared message allow-list exports the conversation key and the diagnostic payload. | REQ-3 |
| AC-32 | The existing admin message-list contract is unchanged; the new fields are additive. | NFR-4 |
| AC-33 | The UI and the API enforce the same page-size bound and the same tenant scoping — neither adds a rule the other does not. | NFR-2, REQ-4 |
| AC-34 | A read refused for tenant-scope reasons is logged with the caller's tenant and the requested resource, without message content. | REQ-10 |
| AC-35 | No log line contains a full diagnostic payload, a full customer phone number, or any secret. | REQ-10 |
| AC-36 | Falling back to the live WhatsApp path is logged with the tenant and number, so the frequency of that fallback is measurable. | REQ-10 |

## Test Cases

| ID   | Case | Covers |
|------|------|--------|
| TC-1 | A conversation of 120 stored messages opens from MongoDB: the first 50 are returned, ordered as they appear in WhatsApp, with no call to the live path. | AC-9..AC-11, AC-16 |
| TC-2 | With the session disconnected, a conversation with stored messages still displays; no 503; the fetch control is unavailable with a stated reason. | AC-13, AC-20 |
| TC-3 | With a connected session, activating "Fetch from WhatsApp" calls the existing live path unchanged and shows older messages; backtracking and cause classification behave exactly as before. | AC-17, AC-18 |
| TC-4 | In a conversation where two replies carry diagnostics, the badge appears on exactly those two; opening one shows that message's payload; no global debug indicator appears. | AC-22, AC-23, AC-25, AC-26 |
| TC-5 | A message whose stored payload is the truncation marker shows an explicit truncation notice with the byte count; no error; the rest of the conversation renders. | AC-24 |
| TC-6 | An admin for tenant A requesting a valid chatId belonging to tenant B is refused; no tenant B message is in the body; the refusal is logged without content. | AC-2, AC-7, AC-34, AC-35 |
| TC-7 | A request with no valid credentials is refused with a structured error and no message data. | AC-6, AC-7 |
| TC-8 | A page size far above the maximum, and a negative one, both return a deterministic bounded page and never a 500; the UI applies the same bound. | AC-12, AC-29, AC-33 |
| TC-9 | A conversation key with no stored messages returns success with an empty list, and the screen offers "Fetch from WhatsApp". | AC-15 |

## Out of Scope

- Media rendering from storage (owned by `86eye6ezn`).
- The per-contact Enable/Disable control and the toggle endpoint (owned by 4/4,
  `86eyhz68a`) — it is added to the same screen independently, so neither ticket
  blocks or redefines the other's part.
- The contact list's names and photos, which stay sourced from WhatsApp.
- Any deployment runtime file.
- Tracking debug-mode state or expiry: `omni_agent` owns the flag and its TTL.
