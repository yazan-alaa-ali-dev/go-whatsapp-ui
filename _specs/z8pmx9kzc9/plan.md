---
ticket: z8pmx9kzc9
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc9"
  github: ""
---

# Plan — 18 · Resolve the account and enforce the transport check on the reply path

> **Revision 2.** Revision 1 was authored before any code and reviewed by the
> advisory panel (senior / security / performance) against the **source**, not
> against its own prose. Every finding is answered in
> [Panel response](#panel-response) below. Three findings changed the design; two
> were declined with reasons; three claims in revision 1 were corrected.

## Anchors, not line numbers

Revision 1 cited `agent_bridge.go:295` and `:315`. All three lenses found those
anchors already stale at HEAD — the row read is at `:309` and the delivery call at
`:338`, and this ticket moves them again. Every anchor below is therefore a
**symbol**:

| Anchor | Symbol |
|---|---|
| "the row read" | the `resolveDeviceRowForWebhook` call inside `runAgentBridge` |
| "the delivery call" | the `deliverAgentReplyFn` call inside `runAgentBridge` |
| "the send exit" | the single `SendMessage` call reached from `deliverAgentReply` |

AC-3 is read the same way: *device-selection code sits between the row read and
the delivery call inside `runAgentBridge`, and in no other place.*

## Approach

Three changes in one file, plus tests.

1. **Resolve.** `runAgentBridge` already reads the arrival device's row **once**
   and uses it twice (endpoint selection, agent payload). Widen that value's *use*
   to a third consumer — the delivery arguments. The read is not repeated, not
   moved, not widened. That is what makes AC-2 true by construction.
2. **Gate.** A transport refusal fires in two places, for two different reasons:
   *pre-flight*, right after the row read, so a device that can never deliver does
   not burn a paid agent call; and *at the send exit*, mandatory, so a candidate
   ticket 19 introduces passes the gate whether or not ticket 19 remembers to
   call it. The pre-flight is an optimisation; the exit gate is the guarantee.
3. **Rewrite the invariant comment** so comment and code state the same boundary.

No failover branch, no sibling query, no `buildAttemptOrder`. Ticket 19 owns all
three; this ticket makes the ground they stand on safe.

## The three design changes the panel forced

### D1 — the routing facts travel *with* the client, not beside it

**Security-major and performance-major, independently.** Revision 1 put
`AccountID` and `Transport` on `deliverAgentReplyArgs` as two more flat fields
next to `Client` and `DeviceID`. Nothing binds them. Ticket 19 swaps `Client` to a
sibling; if it does not also swap `Transport`, the gate validates the **arrival**
device and sends on the **sibling** — fail-open, silently. Revision 1's own
fail-open justification ("the arrival device of an inbound whatsmeow event *is* a
live whatsmeow session") is true today and **false the moment ticket 19 ships**,
which is the only world in which this gate can fire at all.

So the four values become one indivisible value:

```go
// agentSendTarget names the device a reply may leave from: the live client, its
// identity, and the two routing facts that decide whether it may send at all.
type agentSendTarget struct {
	Client    *whatsmeow.Client
	DeviceID  string
	AccountID string
	Transport string // normalised: always "whatsmeow" or "meta_cloud"
}
```

`deliverAgentReplyArgs` carries `Target agentSendTarget` instead of `Client` and
`DeviceID`. A client swap that leaves the transport behind stops being a review
item for ticket 19 and becomes impossible to write.

### D2 — the gate and the send exit are the same function; the test seam is *below* it

**Security-major.** Revision 1 put the check at the top of `deliverAgentReply` and
then extracted the `SendMessage` call into a package-level `agentSendFn` var for
testing. That created a second exit *below* the gate: a ticket-19 retry loop
calling `agentSendFn` per candidate walks straight around the check — defeating
NFR-4, the plan's own central claim.

The fix keeps the seam and removes the bypass by ordering them:

```go
// sendAgentReply IS the send exit. The gate is inside it, so there is no way to
// reach the whatsmeow call from this package without passing the refusal first.
func sendAgentReply(ctx context.Context, target agentSendTarget, to types.JID, msg *waE2E.Message) (whatsmeow.SendResponse, error) {
	if reason := agentSendRefusal(target); reason != "" {
		return whatsmeow.SendResponse{}, fmt.Errorf("%s: device %s speaks %q, which has no live channel yet", reason, target.DeviceID, target.Transport)
	}
	return agentSendMessageFn(ctx, target.Client, to, msg)
}

// agentSendMessageFn is the seam for the whatsmeow call ONLY. It sits BELOW the
// gate deliberately: a test that counts sends therefore cannot disarm the very
// check it is measuring.
var agentSendMessageFn = func(ctx context.Context, client *whatsmeow.Client, to types.JID, msg *waE2E.Message) (whatsmeow.SendResponse, error) {
	return client.SendMessage(ctx, to, msg)
}
```

The senior lens also corrected revision 1's stated reason for the seam. Revision 1
assumed a `nil` client would panic, so a "no panic" test would prove the refusal.
It does not: whatsmeow returns `ErrClientIsNil`, which is **indistinguishable from
a refusal** at the call site — both end with nothing sent and nothing stored. The
seam is therefore not a convenience, it is the only way to assert TC-1 at all, and
the assertion must be **differential**: a `meta_cloud` target produces 0 calls, a
`whatsmeow` target produces 1.

### D3 — the gate is fail-closed, and normalisation happens at the delivery boundary

**Security-major.** Revision 1 refused only on the literal `meta_cloud` and let
`""`, an unknown value and an unresolved row through — fail-open on a security
gate. The `""` branch was harmless while it only fed a payload field; it stops
being harmless the moment it feeds a send decision.

The transport is therefore **normalised as it enters the target**, so the gate only
ever sees one of two values and can be written fail-closed:

```go
// sendTransport is the transport as the SEND decision must read it. "", an
// unresolved row, and any value outside the closed list all read as whatsmeow —
// the same read-side rule the webhook projection applies — so a routing gap never
// becomes a delivery outage (NFR-5).
func (r agentRouting) sendTransport() string

// agentSendRefusal is fail-closed by construction: anything that is not the one
// channel this build can actually speak is refused, including a value added to
// the closed list by a later ticket and not yet handled here.
func agentSendRefusal(target agentSendTarget) string {
	if target.Transport != validations.TransportWhatsmeow {
		return agentRefusalTransport
	}
	return ""
}
```

`buildAgentRequest` keeps the raw projection (`nil` row → `""`), so the agent
payload stays byte-identical to today's. The normalised value exists only on the
send path. **This divergence is deliberate and is recorded in the code**, because
the senior lens is right that "one projection" would otherwise invite a future
ticket to unify it with `addWebhookAccountRouting` — whose `nil` row → `whatsmeow`
answer is a *shipped payload contract*, pinned by
`webhook_account_routing_test.go:489`.

## Steps

### Step 1 — the pre-ticket baseline (done, before any edit)

Measured on the unmodified tree with a throwaway test file, then deleted —
the permanent test file cannot take the "before" number, because it references
struct fields that do not exist yet and so will not compile on the pre-change
tree (performance lens, finding 5).

```
go test -C src -tags purego -count=1 -run TestZZBaseline -v ./infrastructure/whatsapp/
```

| Case | Device-row reads |
|---|---|
| JID row resolves and carries a `webhook_url` | **1** |
| JID row carries no `webhook_url`, no session id resolves | **1** |
| No row resolves at all | **1** |
| JID row carries no `webhook_url` **and** a session id resolves | **2** (1 JID + 1 registry) |

**The baseline is a pair, not a single number**, and the second read goes through
a *different* seam (`dm.storage.GetDeviceRecord`, not `webhookStorageForTest`) —
so a test counting only the first seam would report "1" for a path that really
costs 2. The permanent test counts **both** seams, exactly as
`TestWebhookForwardStorageCallCountIsUnchanged` does.

**Scope of the claim.** AC-2/NFR-1 are about **device-row reads on the reply
path**. They do not count `NormalizeJIDFromLID`'s whatsmeow-store lookups, nor
`StoreSentMessageWithContext`, nor `SetMessageDebug` — none of which this ticket
touches. The wording is narrowed in `spec.md` accordingly rather than left to
imply a wider measurement than was taken. For the record, the whole-message
device-row cost is **2 to 4**: the bridge and the forward path each resolve the
row independently and concurrently.

### Step 2 — one narrow routing projection

```go
// agentRouting is the pair of routing facts a device row carries, resolved ONCE
// per message.
type agentRouting struct{ AccountID, Transport string }

func agentRoutingFromRecord(record *domainChatStorage.DeviceRecord) agentRouting
```

Semantics are **exactly** today's `buildAgentRequest` block, moved unchanged:

| Row | `AccountID` | `Transport` |
|---|---|---|
| `nil` | `""` | `""` |
| transport `""` | row's account | `whatsmeow` |
| transport in the closed list | row's account | that value |
| transport outside the closed list | row's account | `whatsmeow` |

Named `agentRoutingFromRecord`, not `accountRoutingFromRecord`, and its doc
comment states the `nil`-case divergence from `addWebhookAccountRouting`
explicitly — the two are **not** copies of one projection and must not be unified.

Resolved once, immediately after the row read, and fed to both consumers, so
ticket 19's selection code cannot be inserted *between* two independent
resolutions and let the agent payload and the delivery target silently disagree.

### Step 3 — carry the target to the delivery step

`runAgentBridge` builds one `agentSendTarget` from the client it already holds and
the routing it just resolved, and passes it in `deliverAgentReplyArgs`. No new
read, no new call, no re-resolution.

Two strings are carried rather than the `*DeviceRecord` itself, deliberately: the
delivery window is up to 30 seconds, and pinning the record would hold its
`WebhookSecret` and `WebhookEvents` strings alive for that whole time. Recorded in
the code so ticket 19 does not "simplify" it by stashing the pointer.

### Step 4 — refuse pre-flight, before the paid call

**Performance-major.** With the gate only at the send exit, every inbound message
to a `meta_cloud` device spends a billed HTTP round trip, one of the 32
process-wide in-flight slots, and up to 90 seconds of goroutine and pooled socket
— to produce a guaranteed refusal. The per-chat rate limit bounds one
conversation, not one device across conversations, so a single mis-tagged device
can hold the whole slot budget with calls that cannot be delivered.

So the same helper is called once more, right after the routing is resolved and
before `callAgent`: zero new reads, same reason token, one early return.

This is **not** a violation of "the decision is taken when the response arrives"
(AC-9). That rule exists so *fallback selection* is not made on a 90-second-stale
row. Refusing a device that has no live channel at all is not a selection, it is a
pre-condition — and the check is pure, so TC-5 (empty reply) still performs no
work and no read beyond the baseline.

### Step 5 — the send exit

As set out in **D2**. The gate lives in `sendAgentReply`; `deliverAgentReply`
calls it instead of `args.Client.SendMessage` and reports the refusal.

### Step 6 — logging the refusal

`Warnf`, not `Errorf`, and deduplicated per device per hour by reusing the exact
shape of `shouldWarnUnresolvedDevice`, plus a `Debugf` per message so nothing is
invisible.

Two lenses asked for the dedupe (unbounded, externally-triggered log volume); the
senior lens argued none was needed because the line names no phone number. The
content argument is right and the volume argument is independent of it: a
`meta_cloud` row receiving traffic emits one line per inbound message, forever,
driven by whoever chooses to message the number. Both are honoured — `Warn` level
(senior), TTL dedupe (security, performance), coded reason preserved (REQ-6).

The line carries message id, device id, account id and the reason token. No
customer phone, no reply text, no response body — consistent with this file's
existing discipline.

### Step 7 — the agent response cannot steer delivery

`agentResponse` declares two fields, so `json.Unmarshal` already discards
`account_id` and `device_id`, and **a structural pin already exists**:
`TestAgentResponseIsUnchanged` (`agent_bridge_test.go:372`) fails if the type
gains a field. Revision 1 proposed re-inventing it.

So this step is narrowed to what is actually missing: a comment stating the
property, and one **behavioural** test — a real response body carrying
`account_id` and `device_id` is decoded and the reply still leaves on the arrival
target. The trust boundary itself is unchanged and is **not** closed by this
ticket: the endpoint is per-device from the database and `AGENT_WEBHOOK_SIGN` is
off by default. The comment must not imply otherwise.

### Step 8 — replace the invariant comment

Rewritten, not deleted — and carrying the precondition the senior lens identified:

> The reply leaves from the device the message arrived on — which, on every path
> that exists today, *is* a live whatsmeow session, because the only entry is an
> inbound whatsmeow event. From ticket 19 it may fall back to another device under
> the same **explicit** account and never outside it; with no explicit account the
> boundary stays on the arrival device, exactly as today. When ticket 20
> synthesises an inbound event for a Meta number that precondition ends — and the
> gate below is what makes it end **safely**, because that row says `meta_cloud`
> and is refused rather than mis-sent.

### Step 9 — tests

New file `src/infrastructure/whatsapp/agent_reply_routing_test.go`:

| Test | Covers |
|---|---|
| `TestAgentReplySendGateIsDifferential` | TC-1 / AC-4 — `meta_cloud` → 0 whatsmeow calls, `whatsmeow` → 1 |
| `TestAgentReplyGateReadsTheColumnNotTheJID` | TC-1 / AC-5 — a real-looking JID on a `meta_cloud` row is refused; a synthetic JID on a `whatsmeow` row sends |
| `TestAgentReplyGateIsFailClosed` | D3 — an unknown transport reaching the target is refused, not sent |
| `TestAgentReplyRefusalIsRecorded` | REQ-6 / AC-6 — the coded reason appears once per device, not once per message |
| `TestAgentReplyIgnoresAgentReturnedRouting` | TC-2 / AC-7 (behavioural half) |
| `TestReplyPathDeviceRowReadsMatchBaseline` | TC-3 / AC-2 — both seams, both baseline cases |
| `TestRunAgentBridgeCarriesTargetToDelivery` | TC-4 / AC-1 |
| `TestRunAgentBridgeEmptyReplyAddsNoRead` | TC-5 |
| `TestAgentRoutingPassesTheClosedList` | TC-7 |
| `TestRunAgentBridgeUnresolvedRowStillDelivers` | TC-8 / NFR-5 |
| `TestMetaCloudDeviceRefusesBeforeTheAgentCall` | Step 4 — 0 HTTP calls to the agent |

`src/usecase/device_test.go` is **dropped** from the change set — see declined
finding **P-2**.

### Step 10 — validation

`go build -C src ./...`, `go vet -C src ./...`,
`go test -C src -tags purego -count=1 ./...` on SQLite and on real PostgreSQL,
and the read-count comparison against the Step 1 numbers.

## Files to change

| File | Change |
|---|---|
| `src/infrastructure/whatsapp/agent_bridge.go` | `agentRouting` + `agentRoutingFromRecord` + `sendTransport`; `agentSendTarget`; `deliverAgentReplyArgs.Target` replacing `Client`/`DeviceID`; the pre-flight refusal; `sendAgentReply` + `agentSendRefusal` + `agentSendMessageFn` + the reason constant; the dedupe cache; the rewritten invariant comment; the `agentResponse` and `agentDeliveryTimeout` comments |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | Existing literals updated for `args.Target` |
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` | **New.** The eleven tests above |

Nothing else. In particular **not** `webhook_forward.go` (its projection is a
shipped contract, not a duplicate), **not** `auto_reply.go` (see **A-6**), **not**
`ui/rest/send.go`, **not** `ui/mcp/send.go`, and no deployment runtime file.

## Validation strategy

| AC | How it is validated |
|---|---|
| AC-1 | `TestRunAgentBridgeCarriesTargetToDelivery` |
| AC-2 | `TestReplyPathDeviceRowReadsMatchBaseline` against the Step 1 pair |
| AC-3 | Diff inspection by symbol anchor |
| AC-4 | `TestAgentReplySendGateIsDifferential` + `TestAgentReplyGateIsFailClosed` |
| AC-5 | `TestAgentReplyGateReadsTheColumnNotTheJID` |
| AC-6 | Send half: `TestAgentReplyRefusalIsRecorded`. UI half: source review, with the stated limit (**P-2**) |
| AC-7 | `TestAgentReplyIgnoresAgentReturnedRouting` + existing `TestAgentResponseIsUnchanged` |
| AC-8 | Existing `TestRunAgentBridgeDeliversReplyAndDebug`, unchanged |
| AC-9 | Source review: the only `response` field read after the call is `Reply` |
| AC-10 | Source review of the rewritten comment |
| AC-11 | `git diff --stat` shows neither file |
| AC-12 | `git diff --stat` shows no selection/ordering function |

## Rollback

Revert the commit. The reply path returns to sending unconditionally on the
arrival client, which is today's behaviour. No migration, no schema change, no
configuration key, no persisted state, and every new symbol is unexported and
private to one package — so the revert is total and carries no residue.

## Out of scope

Everything in `spec.md > Out of scope`, plus these notes recorded **for ticket
19**, each one a panel finding worth more here than rediscovered later:

- **There is no index on `devices(gowa_account_id)`.** Migrations 60/61 added only
  `idx_devices_jid` and `idx_devices_ad_jid`. The sibling query is a table scan
  until ticket 19 ships its own index — and it must stay lazy regardless.
- **Resolve a candidate's live client with `DeviceManager.GetDevice(sessionID)`**
  (an O(1) map hit), never `getDeviceByJID`, which is two full passes over the
  registry under `RLock` — the O(K·N) the scope document warns about.
- **A sibling candidate must fail *closed*.** The fail-open reading of an
  unresolved row is safe only for the *arrival* device, and only because an
  inbound whatsmeow event proves a live session. That proof does not extend to a
  sibling: if a candidate's row does not resolve, refuse it.
- **`agentDeliveryTimeout` is per attempt, not per message.** Its comment is
  updated to say so, so ticket 19 builds its `context.WithTimeout` inside the
  attempt loop instead of reusing one 30-second `deliverCtx` across candidates.
- **`resolveDeviceRowForWebhook`'s precedence was tuned for webhook selection** —
  on the fallback path the session row deliberately wins over the JID row, chosen
  for account attribution, not for a send decision. This ticket promotes that
  function from "picks an endpoint" to "can refuse a customer reply". Blast radius
  is nil today (CON-5); re-read that comment before adding candidates on top of it.
- **`auto_reply.go` sends on the same client for the same inbound event and is not
  gated** — see **A-6**.

---

## Panel response

Thirty-one findings across three lenses. **Nineteen adopted**, **two declined with
reasons**, **three claims in revision 1 corrected**, the rest recorded as notes.

The panel's most valuable work was not agreement — it was that **two lenses
independently found the same structural defect from opposite directions**
(security via trust boundaries, performance via the cost of a sibling re-read):
revision 1's flat `Transport` field does not travel with `Client`, so the gate
this whole ticket exists to build would have validated one device and sent on
another the moment ticket 19 shipped. Revision 1 would have passed its own tests
and shipped a gate that disarms itself one ticket later.

### Adopted

| # | Lens | Finding | What changed |
|---|---|---|---|
| A-1 | security, performance | `AccountID`/`Transport` as flat fields do not travel with `Client`; ticket 19 swaps one and not the others | **D1** — one `agentSendTarget` value; the split becomes impossible to write |
| A-2 | security | `agentSendFn` creates a second send exit *below* the gate, defeating NFR-4 | **D2** — the gate lives in `sendAgentReply`; the seam sits below it |
| A-3 | security | Fail-open on `""`/unknown/nil is the defect once it feeds a send decision | **D3** — normalise at the boundary, gate is `!= whatsmeow → refuse` |
| A-4 | performance | The paid agent call happens before the gate; a mis-tagged device burns a slot and 90s per message | **Step 4** — pre-flight refusal before `callAgent` |
| A-5 | all three | Line anchors `:295`/`:315` already stale at HEAD | Every anchor is now a symbol; AC-3 restated |
| A-6 | security | AC-4's absolute wording is false — `auto_reply.go:61` sends on the same client for the same event, ungated | AC-4 scoped to the agent reply path in `spec.md`; auto-reply recorded as a known ungated path. **Not** gated here: it reads no device row, so gating it would add a read to a second path — ticket 20's job when it owns provisioning |
| A-7 | senior | TC-5 "no read is performed at all" is **false** — one read already happened before any reply exists | TC-5 reworded in `spec.md` |
| A-8 | performance | The baseline is a pair, not a number, and the second read uses a different seam | Step 1 records both; the test counts both seams |
| A-9 | performance | The permanent test file cannot produce the "before" number — it will not compile pre-change | Throwaway file, command and numbers recorded, file deleted |
| A-10 | performance | NFR-1's wording implies a wider measurement than was taken | Narrowed to "device-row reads on the reply path" in `spec.md` |
| A-11 | senior | A `nil` client returns `ErrClientIsNil`, not a panic — indistinguishable from a refusal | Seam justification corrected; TC-1 assertion made **differential** |
| A-12 | senior | Name the helper for its narrow contract and record the `nil`-case divergence | `agentRoutingFromRecord`, divergence in the doc comment |
| A-13 | senior | Record **why** the helper exists rather than reusing the payload's fields | Recorded: coupling the gate to the outbound request payload would disarm it the moment those fields are redacted — which ticket 17 had actually implemented before the owner overrode it |
| A-14 | performance | Resolve routing once, feeding both consumers | Step 2 — resolved immediately after the read |
| A-15 | security, performance | Unbounded `Errorf` per inbound message | Step 6 — `Warn` + per-device-per-hour dedupe + `Debug` per message |
| A-16 | all three | Step 6 duplicated the existing `TestAgentResponseIsUnchanged` | Step 7 narrowed to the behavioural half; the existing pin is cited |
| A-17 | performance | `agentDeliveryTimeout`'s comment describes a per-message budget that ticket 19 will split | One line marking it **per attempt** |
| A-18 | performance | No index on `gowa_account_id`; use `GetDevice`, not `getDeviceByJID` | Both recorded under Out of scope |
| A-19 | performance, senior | Carrying strings rather than `*DeviceRecord` avoids pinning the row for 30s; `resolveDeviceRowForWebhook`'s precedence was tuned for a different question | Both recorded in code and under Out of scope |

### Declined

**P-1 — "the third copy of the projection should be reconciled with
`addWebhookAccountRouting`."** The security lens read the `nil`-row divergence
(`""` here, `whatsmeow` there) as an inconsistency the plan makes permanent. The
senior lens read the same two functions and reached the opposite conclusion: they
are **not** copies, the `whatsmeow` answer is a shipped payload contract pinned by
`webhook_account_routing_test.go:489`, and unifying them would change bytes on the
wire for every existing consumer.

The senior reading is correct, and the security lens's *concern* is answered
anyway — but at the delivery boundary rather than by unification. `""` is
normalised to `whatsmeow` **on the send path only** (**D3**), so the gate never
sees it, while the payload keeps its exact current bytes. The divergence is
written into the code as deliberate rather than left to be "fixed".

**P-2 — "make the UI half of AC-6 real by having the device layer read
`transport`."** Declined, and this one is a genuine gap that must be stated rather
than papered over.

The senior and security lenses independently found that the test revision 1
assigned to AC-6 — an instance with no whatsmeow client is never live — is a
**tautology**: it passes today, unchanged, and passes identically for
`transport = 'whatsmeow'`. It proves nothing about a Meta device. Recording it as
AC-6's evidence would have put a false PASS in `verify.md`.

I considered closing it properly: a `transport` field on `DeviceInstance`,
populated in `loadFromRegistry` where the row is already in hand, and consulted by
`deriveState`. It is about six lines and costs no read. **Both lenses said don't**,
and on reflection they are right: it would make a third package start consulting a
routing column that **no code writes** (CON-5 — no API can set `meta_cloud`), to
guard a state that cannot yet exist. That is dead code in a package this ticket
otherwise does not touch, and provisioning is ticket 20's.

So the honest position, recorded in `spec.md` and to be repeated in `verify.md`:

- AC-6's **send half** — skipped with a recorded reason — is delivered by the gate
  and tested.
- AC-6's **UI half** holds **by construction for every row that can exist today**:
  a `meta_cloud` row has no whatsmeow store session, so no client is ever built for
  it, so `deriveState` reports `disconnected`.
- It does **not** hold for a hand-edited row that has *both* a live whatsmeow
  session and `transport = 'meta_cloud'`. That row renders as logged-in while the
  new gate refuses its replies. It is reachable only by direct database access,
  and it is ticket 20's to close when it owns provisioning.

The test is dropped and `src/usecase/device_test.go` leaves the change set.

### Corrections to revision 1

1. **"A nil client would panic, so a no-panic test proves the refusal."** False —
   whatsmeow returns `ErrClientIsNil`. Both outcomes look identical from the call
   site, so revision 1's TC-1 test could not have distinguished a working gate
   from a broken one. The assertion is now differential.
2. **"TC-5: no read is performed at all."** False — the row read precedes the
   agent call, so exactly one read has already happened before any reply exists.
   The criterion, not the code, was wrong.
3. **"The green path performs 1 read."** Incomplete. It is 1 *or* 2 depending on
   whether the JID row carries a `webhook_url` and a session id resolves, and the
   second read is invisible to the seam revision 1 proposed to count with. Both
   numbers are now measured, and both seams counted.

### Recorded, no change

- The gate is **unreachable today** — CON-5 verified against migration 53, the
  device upsert and the account repository: no `UPDATE ... SET transport` exists
  outside tests. This is not an argument against shipping it; it is the argument
  that the gate's *shape*, not its current behaviour, is all this review can
  protect. Which is precisely why **D1**, **D2** and **D3** were worth taking.
- The refusal log leaks nothing: message id, device id (already logged four times
  in this file), an opaque account id, and a reason token.
- No deployment runtime file is touched; the rollback is a pure revert.
- Pre-existing and deliberately left alone: `isLocalDeviceJID` calls `ListDevices()`
  — which allocates and sorts — on the whatsmeow event goroutine per candidate
  message. Noted only so it is not later mistaken for this ticket's regression.
