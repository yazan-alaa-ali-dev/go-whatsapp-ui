---
ticket: cu-z8pmx9kcv9
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv9"
  github: ""
---

# Specification — cu-z8pmx9kcv9

06 · Build the omni agent bridge for inbound messages
(execution order 06 of 15 · depends on: 03, 05 · blocks: 07, 08, 10, 15 ·
reference: `gowa-study-ar.html` §05, §08)

## Business Goal

This is the ticket that makes the product work commercially: a customer writes to
a WhatsApp number and gets an AI answer back from **that same number**, with no
human in the loop and no conversation jumping to a second number. Tickets 03 and
05 built the two halves it stands on — the `message_debug` store and the agent
configuration plus phone-format helpers. This one joins them into a working
round trip.

The existing webhook path (`submitWebhook`) cannot be reused: it is
fire-and-forget, checks only the HTTP status, discards the response body, and
carries a 10-second budget with five retries. The omni API returns
`{reply, metadata_debug}` **inside** that body, and an AI answer needs a minute,
not ten seconds — and must never be retried, because a retry produces two
different answers to one question. So this ticket adds a separate outbound path
and leaves the generic webhook untouched for its other consumers.

## User Story

> As **a CUSTOMER**, I want to be able to **send a WhatsApp message and receive
> an AI answer from the same number I wrote to**, so that **I get help
> immediately without a human agent and without the conversation jumping to
> another number**.

## Functional Requirements

- **REQ-1** — On an inbound text message the service posts a payload describing
  that message to the configured agent endpoint, authenticated with the header
  and signing mode from ticket 05.
- **REQ-2** — The payload identifies both the receiving WhatsApp identity and the
  registered device, and carries the sender in the E.164 form the agent expects.
- **REQ-3** — The agent's response is parsed as `{reply, metadata_debug}`.
- **REQ-4** — A non-empty `reply` is delivered to the original sender.
- **REQ-5** — The delivered reply is persisted so it appears in chat history like
  any other outbound message.
- **REQ-6** — A non-empty `metadata_debug` is persisted against the delivered
  reply's message id.
- **REQ-7** — The bridge is invoked from the inbound-message handler alongside
  the existing auto-reply, and changes nothing about webhook forwarding.

## Non-Functional Requirements

- **NFR-1 (tenant safety)** — The reply leaves on the exact client that received
  the message. No device lookup, no "default client" fallback, no possibility of
  answering from the wrong number.
- **NFR-2 (loop safety)** — The bridge's own outbound reply comes back as an
  event; it must never trigger a second agent call.
- **NFR-3 (budget)** — The agent call has its own timeout, independent of the
  webhook path's, and performs no automatic retry.
- **NFR-4 (isolation)** — A slow, hung or failing agent must not degrade
  unrelated message processing for the same device, and must not accumulate work
  without bound.
- **NFR-5 (opt-in)** — With no agent URL configured the service behaves exactly
  as it does today: no call, no goroutine, no log noise.
- **NFR-6 (diagnosability)** — Each stage that can fail — call, send, store —
  reports its own failure, so the failing stage is identifiable from the log
  alone.

## Constraints

- No deployment runtime file is touched.
- `submitWebhook` and the webhook forward path are not modified.
- The reply must be stored through the same call the auto-reply path uses, so
  existing read endpoints render it with no change.

## Acceptance Criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-1 | The reply is sent on the exact `*whatsmeow.Client` that received the message, so the sender number can never be wrong. | NFR-1 |
| AC-2 | The outbound payload carries both `device_id` (the receiving JID) and `session_id` (the registered device id). | REQ-2 |
| AC-3 | On an inbound text message the bridge POSTs to the configured agent URL with the signing header from ticket 05. | REQ-1 |
| AC-4 | The response is parsed as `{reply, metadata_debug}`. | REQ-3 |
| AC-5 | A non-empty `reply` is delivered to the original sender. | REQ-4 |
| AC-6 | The delivered reply is persisted with `StoreSentMessageWithContext` so it appears in the chat history. | REQ-5 |
| AC-7 | A non-empty `metadata_debug` is persisted with `SetMessageDebug` against the **delivered reply's** WhatsApp message id (the id returned by `SendMessage`) — the reading the ticket-04 read path needs. | REQ-6 |
| AC-8 | The bridge is invoked from `handleMessage` next to `handleAutoReply` and does not alter the existing webhook forwarding. | REQ-7 |
| AC-9 | Messages where `IsFromMe` is true are skipped, preventing an infinite reply loop. | NFR-2 |
| AC-10 | Group, broadcast and status messages are skipped. | NFR-2 |
| AC-11 | Messages without genuine text are skipped. | REQ-1 |
| AC-12 | The agent call uses its own timeout of 60–120 seconds and performs **no** automatic retry. | NFR-3 |
| AC-13 | An empty or whitespace-only `reply` results in no message being sent. | REQ-4 |
| AC-14 | A malformed JSON response is logged and discarded without sending anything. | REQ-3, NFR-6 |
| AC-15 | The reply is indistinguishable in storage from any other outbound message, so existing endpoints render it unchanged. | REQ-5 |
| AC-16 | Every agent call logs the message id, the resolved device and the outcome. | NFR-6 |
| AC-17 | Failures to call the agent, to send, or to store are logged separately so the failing stage is identifiable. | NFR-6 |

## Test Cases

### TC-1 — Happy path: the customer receives an AI reply from the same number
**Given** two devices are paired and the agent URL is configured
**When** a customer sends a text message to device A
**Then** the agent receives a payload containing `session_id` of device A and the
sender in E.164 form; the customer receives the `reply` from device A, not device
B; the reply appears in `GET /chat/{jid}/messages`; and a `message_debug` row
exists for the reply's message id
*(covers AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-15)*

### TC-2 — Validation error: the agent returns an empty or malformed body
**Given** the agent is configured
**When** the agent responds with an empty `reply`
**Then** no WhatsApp message is sent and a log entry records the skip
**When** the agent responds with invalid JSON
**Then** no message is sent and the parse failure is logged
*(covers AC-13, AC-14, AC-17)*

### TC-3 — Authorization failure: the agent rejects the signature
**Given** the agent key is wrong
**When** a customer message arrives
**Then** the agent responds 401 and no reply is sent to the customer; the failure
is logged with the message id; and no retry storm is produced — exactly one call
was made
*(covers AC-12, AC-16, AC-17)*

### TC-4 — Loop safety: the bridge never answers itself
**Given** the bridge has just delivered a reply
**When** that outbound message is echoed back as an event
**Then** the bridge skips it because `IsFromMe` is true, and no second agent call
is made
*(covers AC-9)*

## Out of Scope

- Any change to `submitWebhook`, the webhook payload, or webhook forwarding.
- The dashboard `/agent/*` proxy and the per-contact debug toggle (ticket 08).
- Exposing `metadata_debug` through the read API (ticket 04, already delivered).
- Media, audio or non-text inbound handling (later tickets).
- Replacing the transport implementation (ticket 15).
