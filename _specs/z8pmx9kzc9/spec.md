---
ticket: z8pmx9kzc9
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc9"
  github: ""
---

# Specification — 18 · Resolve the account and enforce the transport check on the reply path

## Business goal

The reply to an inbound message already leaves from the device it arrived on.
What the reply path does **not** know is which account that device belongs to, or
which channel it speaks. So there is no place to stand when ticket 19 adds
failover: nothing bounds the fallback to the account, and nothing stops a Meta
Cloud number — which is stored with a synthetic `@s.whatsapp.net` JID and is
therefore syntactically indistinguishable from a real one — from being handed to
`client.SendMessage` and failing silently on the wrong channel.

This ticket makes those two facts available at the point of delivery and turns the
second one into an enforced gate, taking both from a row the path **already
reads**. It ships no failover; it makes failover safe to add.

## User story

As **an operator**, I want **the reply path to know which account and channel it
is sending on**, so that **a Meta number can never be sent to through whatsmeow,
and a later ticket can add failover inside the account boundary**.

## Functional requirements

- **REQ-1** The arrival device's account and transport are resolved on the reply
  path and reach the delivery step.
- **REQ-2** Both values come from data the reply path already reads — no
  additional storage call on the green path.
- **REQ-3** Device selection code lives between the device-row read and the
  delivery call inside `runAgentBridge`, and nowhere else.
- **REQ-4** A **mandatory** transport check sits at the send exit of the agent
  reply path: a device whose transport is `meta_cloud` is never sent to through
  whatsmeow from it.
- **REQ-5** The check reads the recorded `transport` value, never the shape of the
  identifier.
- **REQ-6** A refusal is recorded with a coded reason, so "why did this reply not
  go out?" has a one-line answer in the log.
- **REQ-7** The values returned inside the agent's response body take no part in
  selecting the device the reply leaves from.
- **REQ-8** The `deliverAgentReply` invariant comment is **replaced** by the
  account-bounded one — the code and its comment agree after the change.

## Non-functional requirements

- **NFR-1** **No added reads on the green path.** **Device-row reads** on the
  reply path per inbound message are unchanged, proven by counting, not by
  estimation. The claim is deliberately scoped to device-row reads: it does not
  cover `NormalizeJIDFromLID`'s whatsmeow-store lookups, `StoreSentMessageWithContext`
  or `SetMessageDebug`, none of which this ticket touches.
- **NFR-2** **Untrusted input containment.** The agent response is decoded from an
  endpoint that is configurable per device; nothing in it may steer delivery.
- **NFR-3** **No behaviour change for the usable arrival device.** The
  overwhelmingly common case executes the same code it does today.
- **NFR-4** **The gate is not bypassable by a second path.** It sits at the one
  place the reply is actually sent, so a candidate introduced later passes through
  it by construction rather than by remembering to call it.
- **NFR-5** A device that resolves to no row still gets its reply delivered — an
  unresolved account is a routing gap, not a delivery outage.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** `ui/rest/send.go` and `ui/mcp/send.go` are untouched — operator-
  initiated sending keeps using the explicit device.
- **CON-3** No failover, no priority ordering, no sibling read ships here. That is
  ticket 19.
- **CON-4** The device row read inside `runAgentBridge` may be up to
  `AGENT_TIMEOUT` (90s) stale by the time the reply is delivered. It is acceptable
  as a *description of the arrival device* — the channel a device speaks does not
  change while an agent thinks — and is **not** acceptable as a freshness source
  for anything ticket 19 selects.
- **CON-5** There is today **no API that can write** `transport = 'meta_cloud'`:
  migration 53 defaults the column to `''` and the accounts API never sets it.
  The gate is therefore a guard for rows written by ticket 20 and by direct
  database access — it must be correct before such a row can exist, not after.

## Acceptance criteria

### Account resolution

- **AC-1** The arrival device's `account_id` and `transport` are resolved on the
  reply path and passed to the delivery step, taken from data already read on that
  path.
- **AC-2** The green path — arrival device usable — performs **+0 additional
  device-row reads** against the measured pre-ticket baseline. The baseline is
  measured, not estimated, and is a **pair**: 1 read when the JID row resolves,
  2 when it carries no `webhook_url` and a session id resolves. Both are counted
  through both seams (`webhookStorageForTest` and `dm.storage.GetDeviceRecord`).
- **AC-3** Device-selection code sits between the `resolveDeviceRowForWebhook`
  call and the `deliverAgentReplyFn` call inside `runAgentBridge`, and in no other
  place. (Stated by symbol, not line number: the line anchors in the ticket text
  were already stale at HEAD and this ticket moves them again.)

### Transport check

- **AC-4** A `transport` check is **mandatory at the send exit of the agent reply
  path**: a device with `transport = meta_cloud` can never be sent to through
  whatsmeow from that path. The scope is stated explicitly because it is not
  fleet-wide — `auto_reply.go` sends on the same client for the same inbound event
  and is **not** gated here (it reads no device row, so gating it would add a read
  to a second path); operator-initiated sends are excluded by CON-2.
- **AC-5** The check reads the `transport` column — never the shape of the
  identifier. A synthetic JID passing as a syntactically valid whatsmeow JID must
  not be sufficient to send on it.
- **AC-6** Until ticket 20 ships, a `meta_cloud` device is treated as **registered
  but not live**: it is skipped with a recorded reason, and the UI does not
  present it as a working device.
  - **Send half** — skipped with a recorded reason — is delivered by the gate.
  - **UI half** holds **by construction for every row that can exist today**: a
    `meta_cloud` row has no whatsmeow store session, so no client is built for it
    and `deriveState` reports `disconnected`.
  - **Stated limit.** It does *not* hold for a hand-edited row carrying **both** a
    live whatsmeow session and `transport = 'meta_cloud'` — that row renders as
    logged-in while the gate refuses its replies. Reachable only by direct
    database access (CON-5), and closed by ticket 20 when it owns provisioning.
    Recorded here rather than reported as a pass.

### Untrusted agent response

- **AC-7** `account_id` and `device_id` returned in the agent response are
  explicitly ignored; the selection inputs come solely from server state keyed by
  `message_id`.
- **AC-8** `metadata_debug` is stored as received and never participates in the
  selection decision.
- **AC-9** The decision is taken **when** the response arrives, not **based on**
  its content — the response supplies reply text only.

### Invariant comment

- **AC-10** The old "same client" comment at `deliverAgentReply` is **replaced**,
  not deleted: "arrival device first, then any other device under the same
  **explicit** account — and nothing outside it; with no explicit account the
  boundary stays on the device, exactly as today."

### Scope boundary

- **AC-11** `ui/rest/send.go` and `ui/mcp/send.go` are unchanged.
- **AC-12** No failover/priority logic ships here — that is ticket 19.

## Test cases

| ID | Given | When | Then |
|----|-------|------|------|
| TC-1 | A device row with `transport = meta_cloud` and a synthetic JID | The reply path attempts to deliver to it | The send is refused at the transport check with a recorded reason, and `SendMessage` is never invoked |
| TC-2 | An agent response body containing `"account_id": "acc_other"` and `"device_id": "dev_other"` | The reply is delivered | The reply still goes out on the arrival device; neither returned value affects selection |
| TC-3 | A query-counting harness and a usable arrival device | One inbound message is answered | The query count equals the measured pre-ticket baseline exactly |
| TC-4 | An arrival device attached to `acc_alpha` | The reply path runs | The delivery step receives `acc_alpha` and the device's transport |
| TC-5 | The agent returns an empty `reply` | The bridge processes the response | The device-row read count equals the baseline — **no read is added after the response arrives**, and no selection work is done. (Corrected: the ticket's original wording, "no read is performed at all", is false against the code — the row read precedes the agent call, so one read has already happened before any reply exists.) |
| TC-6 | The modified `deliverAgentReply` | The source is reviewed | The invariant comment describes the account boundary and matches what the code does |
| TC-7 | A device row whose stored transport is outside the closed list | The reply path runs | It is treated as `whatsmeow` (the closed-list read rule), not refused and not echoed |
| TC-8 | A device that resolves to no row at all | The reply path runs | The reply is delivered; the account reads as absent |
| TC-9 | A `meta_cloud` device row that has no whatsmeow store session | The device list is rendered | No client is built for it, so it renders `disconnected`. Verified by source review, not by a test: the test proposed for this was a tautology (it passes identically for `whatsmeow`) and would have recorded a false pass — see `plan.md > Panel response > P-2`. |

## Out of scope

- Failover, priority ordering, the sibling query, and the `buildAttemptOrder`
  function — ticket 19.
- Any Meta Cloud send implementation — ticket 20.
- `ui/rest/send.go`, `ui/mcp/send.go`, and every operator-initiated send path.
- Any transport-writing API. No endpoint gains the ability to set `meta_cloud`
  here.
- Marking a device `blocked` from a send failure (§5.4 of the scope document).
