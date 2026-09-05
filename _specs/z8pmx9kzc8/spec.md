---
ticket: z8pmx9kzc8
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc8"
  github: ""
---

# Specification — 17 · Carry `account_id` and `transport` in the outbound webhook

## Business goal

Ticket 16 gave devices an account and a transport, but nothing outside the
database can see either. An integrator receiving a webhook knows which JID the
event arrived on and nothing about the operator it belongs to, so any per-account
reasoning costs a round trip back to the server — on every message.

This ticket carries both values in the event, taken from a device row the path
**already reads**. It is purely additive: every existing field keeps its value, so
no current consumer breaks.

## User story

As **an integrator consuming the outbound webhook**, I want **each event to tell me
which account and which channel it arrived on**, so that **my agent can reason
about the account without querying the server back**.

## Functional requirements

- **REQ-1** The outbound webhook payload carries the account the device belongs to
  and the channel the event arrived on.
- **REQ-2** The agent request carries the same two values.
- **REQ-3** Both values come from a device row the path already reads — no
  additional storage read on the webhook forward path.
- **REQ-4** A device that resolves to no row still forwards; the account reads as
  absent, not as a failure.
- **REQ-5** The condition in REQ-4 is observable in the log, so it is documented
  behaviour rather than a gap found later.

## Non-functional requirements

- **NFR-1** **Backward compatibility.** Every existing top-level field —
  `event`, `device_id`, `session_id`, `payload` — keeps its current value byte for
  byte. A consumer written against the pre-ticket payload keeps working unchanged.
- **NFR-2** **No added reads.** The number of storage calls per inbound message on
  the webhook forward path is unchanged, proven by counting, not by estimation.
- **NFR-3** **No data race.** The payload map is shared with the Chatwoot
  goroutine; every mutation happens synchronously before that goroutine is
  spawned.
- **NFR-4** The blast radius of widening a shared read stays inside that
  function's callers.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** The forward path runs on a **per-event goroutine**, one per inbound
  event, detached from the whatsmeow event thread with its own 30s context
  (`event_message_handler.go:224` and six sibling call sites). The ticket's own
  research says it runs on the event thread; it does not, and the distinction is
  recorded because it changes *why* the constraint holds, not *whether* it does.
  That goroutine already performs one indexed lookup — a second in the fallback
  case — and an HTTP call. A third read buys nothing and is not acceptable.
- **CON-3** `GetDeviceRecordByJID` answers `nil` when a bare number matches two
  companion slots — it refuses the ambiguity rather than guessing a sibling. That
  behaviour is load-bearing and must not change.
- **CON-4** Agent request signing is **off by default**, and the key is a single
  global shared secret with no nonce and no timestamp — i.e. replayable — while
  the destination is per-device from the database. Widening that request with
  account data is a security-relevant change, not a formatting one.

## Acceptance criteria

### Payload contract

- **AC-1** The outbound webhook payload carries two new fields: `account_id`
  (`""` when the device has no account) and `transport` (`"whatsmeow"` |
  `"meta_cloud"`, where a stored `""` reads as `whatsmeow`). `transport` passes
  through the closed list on read: a stored value outside it reports `whatsmeow`
  rather than being echoed to a consumer that may branch on it.
- **AC-2** Every existing field — `event`, `device_id`, `session_id`, `payload` —
  keeps its current value byte for byte. An existing consumer does not break.
- **AC-3** `agentRequest` gains the same two fields, `AccountID` and `Transport`.
- **AC-4** `agentResponse` is **unchanged** — nothing is added to it.

### Zero added reads

- **AC-5** The device-resolution helper on the webhook path returns the device
  **row** rather than the webhook projection, and both new values are taken from
  that row. A row is returned whenever one resolves — **including when it carries
  no usable `webhook_url`**, which is the majority case (the global
  `WHATSAPP_WEBHOOK` fallback). The "usable webhook" question is answered
  separately, so a device with an account and no dashboard webhook reports its
  account and still falls back to the global list.
- **AC-6** The number of **storage calls** per inbound message on the webhook
  forward path is **unchanged** — proven by counting in a test, not by estimation.
  Counted across **both** resolution seams, since the JID lookup does not go
  through the same seam as the session-id lookup and counting one would make the
  assertion vacuous. It is a storage-call count, not a cost guarantee: the
  per-event HTTP call dominates either way.
- **AC-7** The injection is synchronous, beside the existing `session_id`
  enrichment, before the Chatwoot goroutine is spawned; the shared payload map is
  never mutated concurrently.

### The ambiguity case

- **AC-8** When the device cannot be resolved to a row — two companion slots on
  one number, or no row for that JID — `account_id` is empty and this is treated
  as "no account", not as an error. The event is still forwarded.
- **AC-9** That case is logged, so it is documented behaviour rather than a silent
  gap discovered later.

### Security precondition

- **AC-10** `AGENT_WEBHOOK_SIGN = true` is a documented operating requirement
  before this payload is widened, and the per-destination (or per-account) key
  decision is recorded. Widening the payload with account data over an unsigned,
  globally-shared-key request is not shipped silently — it is documented in
  `readme.md`, warned about at startup, and recorded in the code that carries the
  payload.

  **Owner decision.** The review panel proposed withholding the two fields when the
  endpoint is per-device and signing is off. The owner directed that the fields be
  **sent regardless**: signing is switched off deliberately as a *testing*
  configuration in this deployment, and withholding data from that configuration
  defeats its purpose. The mitigation is therefore operational — turn signing on
  outside testing — not conditional. The residual exposure is stated in
  `verify.md > Known and accepted`.

## Out of scope

- Reading `account_id` to make a routing decision — choosing a sibling device is
  ticket 18.
- Any change to `agentResponse`, or to what the agent may do with the new fields.
- Per-destination or per-account agent keys: the decision is **recorded** here
  (AC-10), the implementation is not.
- Replay protection for the agent request. Signing covers the body alone, with no
  timestamp and no nonce, so a captured request remains replayable. That is
  **accepted residual risk**, recorded rather than solved; closing it is a
  protocol change on both sides.
- Deduplicating the device-row read across the forward and agent goroutines, and
  caching the row on the in-memory device instance. Both are recorded follow-ups
  in `plan.md > Out of scope`.
- The Meta Cloud channel itself; `transport` is reported, never written, by this
  ticket.
- Any change to `GetDeviceRecordByJID`'s ambiguity behaviour (CON-3).
