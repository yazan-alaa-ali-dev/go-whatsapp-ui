---
ticket: z8pmx9kzca
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-27
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzca"
  github: ""
---

# Plan — 19 · Fail over by priority inside a single account

**Revision 2**, after the advisory panel (senior / security / performance)
reviewed revision 1 **against the source**. 40 findings; the response is at
`> Panel response`. Three of the four majors were raised independently by more
than one lens, and one of them — verified in whatsmeow's own source while
answering the panel — invalidated the mechanism revision 1 was built on.

Branch: `ticket/z8pmx9kzca`, cut from `ticket/z8pmx9kzc9` (ticket 18's tip: the
`agentRouting` / `agentSendTarget` projection, the `sendAgentReply` gate, and the
`agentSendMessageFn` seam below it). The PR targets that branch, not `main`.

## Anchors, not line numbers

Everything below names symbols. The line anchors in the ClickUp text
(`agent_bridge.go:295`, `agentEndpointForDevice:403`) were already stale at
ticket 18's HEAD and this ticket moves them again.

Shape at HEAD (`src/infrastructure/whatsapp/agent_bridge.go`):

```
runAgentBridge
  ├─ NormalizeJIDFromLID / JIDToE164        → sender, phone; early return when phone == ""
  ├─ resolveDeviceRowForWebhook(...)        → deviceRecord     (1–2 device-row reads)
  ├─ agentEndpointFromRecord(deviceRecord)  → endpoint
  ├─ agentRoutingFromRecord(deviceRecord)   → routing {AccountID, Transport}
  ├─ target := agentSendTarget{Client, DeviceID, AccountID, routing.sendTransport()}
  ├─ agentSendRefusal(target) != "" → logAgentRefusal, RETURN   (pre-flight refusal)
  ├─ buildAgentRequest → callAgent          (billed, up to AGENT_TIMEOUT = 90s)
  ├─ sanitizeAgentReply                     → early return when unusable
  ├─ deliverCtx = WithTimeout(ctx, agentDeliveryTimeout)
  └─ deliverAgentReplyFn(deliverCtx, args)  → sendAgentReply → agentSendMessageFn
```

The selection is inserted between `sanitizeAgentReply` and the delivery call —
the one place ticket 18's AC-3 reserved for it. The **pre-flight refusal is left
exactly as ticket 18 wrote it** (see D0).

---

## The four design decisions the panel forced

### D0 — the pre-flight refusal does **not** move

Revision 1 narrowed ticket 18's pre-flight refusal from "always refuse a
`meta_cloud` arrival before the billed agent call" to "refuse only when
`account_id == ''`", so that an accounted Meta device could fall back to a
sibling. **All three lenses rejected it**, and they were right for three separate
reasons:

- it reinstates the exhaustion case ticket 18's own comment names — a device that
  can never deliver would hold one of `agentMaxInFlight` (32) slots and up to
  `AGENT_TIMEOUT` (90 s) of goroutine and socket **per inbound message**, on a
  trigger that is unauthenticated (anyone who messages the number);
- it inverts a ticket-18 acceptance test —
  `TestMetaCloudDeviceRefusesBeforeTheAgentCall` uses
  `GowaAccountID: "acc_alpha"` with `meta_cloud` and asserts the agent is called
  **zero** times. Revision 1 described that file as "rewired to the new
  signature". It was not a rewire; it was a semantic inversion;
- and it buys nothing, because §5.3 refuses **every** transition out of a Meta
  arrival in this scope: `meta → meta` is refused, and `meta → meow` is "after
  T5". A Meta arrival has no permitted destination until ticket 20, so refusing
  before the billed call is not an optimisation that skips a possible fallback —
  it is the correct terminal answer.

Ticket 20 owns relaxing it, at the same time it makes `meta → meow` real.

### D1 — a switch is permitted only by an **enumerated, provably-nothing-sent** condition, and `ErrNotConnected` is not one of them

Revision 1 asserted that a failure returning `ErrNotConnected` proves nothing
reached WhatsApp, and built the switch rule on that. **It is false**, and the
panel's pressure on the duplicate-reply rule is what sent me to check:

`whatsmeow.SendMessage` reaches `ErrNotConnected` from **two** places that are
indistinguishable from the returned error:

- `sendNodeAndGetData` (`client.go:918`) — `sock == nil`, **before** the frame is
  marshalled or written. Nothing was sent.
- `retryFrame` (`request.go:208`, reached from `send.go:442` as
  `retryFrame(ctx, "message send", …)`) — the frame **was** written, the server
  answered with a disconnect node, and the reconnect-and-retry then found no
  socket. WhatsApp may already hold the message.

A switch on `ErrNotConnected` is therefore exactly the duplicate-reply bug the
ticket exists to prevent, arriving through the error the design most wanted to
trust. So the rule is inverted into an allowlist:

| Condition | Outcome | Switch? | Why |
|---|---|---|---|
| the transport gate refuses | `agentRefusedPreSend` | **yes** | pure check, `agentSendMessageFn` never called |
| `agentClientConnectedFn(client) == false`, checked at the **send instant** | `agentRefusedPreSend` | **yes** | the next thing `SendMessage` does is the same `sock == nil` test (`client.go:915-919`); nothing can have been written |
| `ErrClientIsNil`, `ErrNotLoggedIn` | `agentRefusedPreSend` | **yes** | returned at the top of `SendMessage` (`send.go:186-205`), before any frame |
| `err == nil` | `agentDelivered` | — | |
| **everything else** — `ErrNotConnected`, `ErrMessageTimedOut`, `ErrServerReturnedError`, `context.DeadlineExceeded`, any unknown error | `agentFailedSending` | **no** | may already have been accepted. One lost message beats two contradictory ones |

Unknown is on the **no-switch** side. A whatsmeow version that adds an error this
function has not been taught about cannot cause a duplicate reply.

This also answers the performance lens's strongest finding without weakening the
feature. Revision 1 read `client.IsConnected()` when the *agent response arrived*
— up to 90 s before the send, inside a window where `EnableAutoReconnect` makes
the socket legitimately flap, so one dropped keepalive would have switched the
customer's reply to a different number for a device that reconnects in seconds.
Reading it **at the send instant** is not a prediction at all: it is the same
condition the very next call would hit, one microsecond later.

Residual trade-off, recorded rather than hidden: a socket that is down at the
send instant but would recover within the 30 s delivery budget still causes a
switch rather than a wait. §5.2 already made that choice — "`meow` session not
connected → **skip now**, temporary, not written to the database" — and the cost
of the alternative (waiting, then possibly losing the reply) is worse than the
cost of this one (the customer sees a different number once).

### D2 — the *sending* device, the *storage* device and the *customer's address* are three separate things

`agentSendTarget` describes **one** device completely (ticket 18's invariant: the
fields travel together so a half-swap cannot be written). On a switch they all
swap together. Two things must **not** swap with them, and the panel caught both:

**The conversation.** The inbound question is stored in the arrival device's
partition; writing the answer into the sibling's would leave the operator looking
at a chat with a question and no answer, and another with an answer and no
question. So `deliverAgentReplyArgs` gains `StorageDeviceID` **and**
`StorageClient` (the arrival's), and `storeAgentDebug` uses **both**:
`SetMessageDebug` is keyed on `(device_id, message_id)`, and its `chat_jid` comes
from `NormalizeJIDFromLID(ctx, recipient, …)` — which is a **per-device** lookup
(`jid_utils.go` reads `client.Store.LIDs`). Revision 1 fixed the device key and
left the chat key resolving through the *sibling's* client, which would have
de-partitioned the debug row from the message row on exactly the failover path.
`StoreSentMessageWithContext` already normalises with `ClientFromContext(ctx)`
(the arrival), so using the arrival client here makes the two agree.

**The customer's address.** `deliverAgentReply` addresses the customer as
`utils.FormatJID(evt.Info.Sender.String())` — the **raw** sender, which
`directInboundSkipReason` permits to be `<n>@lid`. A LID is meaningful only
inside the LID map of the device that saw it. A sibling that has never spoken to
this customer has no such mapping: at best the send fails, at worst it resolves
elsewhere. That is "the reply reaches the wrong person" — the failure this ticket
exists to prevent — arriving *around* the SQL boundary rather than through it.

So `customerHasPhone` stops being decorative and becomes the load-bearing guard
for **every** switch, not just `meta → meow`:

```go
// The customer is addressable by a device OTHER than the arrival one only when the
// LID resolved to a real phone-number JID. runAgentBridge already computed this
// resolution for the agent payload; nothing new is read.
customerHasPhone := sender.Server == types.DefaultUserServer
```

`buildAttemptOrder` returns **no fallback at all** when it is false, with the
coded reason `customer_unreachable`. The arrival attempt keeps addressing the raw
sender exactly as today (zero behaviour change on the green path); a fallback
attempt addresses the resolved `sender`, carried explicitly on the args.

### D3 — marking is driven by the **send error**, is window-bounded, and its change-only guarantee lives in SQL

Revision 1 called `markAgentSendFailure` from the switch branch, which two lenses
independently showed can never carry a send error — so AC-17 was unimplementable
as drawn, and if the *refusal reason* had fed the counter instead, three brief
reconnects would have written `send_state='blocked'` on a healthy number that
`spec.md` says is never cleared automatically. A stranger, by messaging the
number three times during a 30-second real logout, could have taken it out of
service until an operator noticed.

Four changes:

1. **The error, not the reason, is classified.** Terminal is exactly
   `ErrNotLoggedIn` (the store no longer holds a device JID) and `ErrClientIsNil`
   — "this slot has no session at all", §5.4's "permanent disconnect / pairing
   refusal". Everything else, **including unknown**, is transient and is never
   written. (Note the deliberate asymmetry with the transport gate, which is
   fail-*closed*: refusing to send is inaction, marking is an action that takes a
   working number out of service and is never lifted automatically. Its default
   must be "do not".)
2. **A bounded window.** `agentBlockAfterFailures` (3) failures within
   `agentBlockFailureWindow` (15 min). Without a window, three occurrences months
   apart latch. Any non-terminal outcome resets the counter.
3. **Verified immediately before the write.** `client.Store.ID == nil` is
   re-checked at the write, so the mark records a state that is true now, not one
   inferred from three past errors.
4. **The change-only guarantee is a SQL predicate, not an in-memory latch.**
   Revision 1's latch is empty after every restart and survives an operator
   clearing the flag by hand. `SetAccountDeviceSendState` cannot help — it is an
   unconditional `UPDATE devices SET send_state = ?, updated_at = ?` and answers
   zero-rows as `ErrDeviceNotFound`, which the REST endpoint maps to 404. So a
   **separate** method ships for the automatic path:

```go
// MarkAccountDeviceBlocked writes send_state='blocked' ONLY when the stored value
// differs, and reports whether it changed anything.
//
// Separate from SetAccountDeviceSendState — the operator's endpoint — because their
// zero-rows answers mean different things: there, zero rows is "not this account's
// device" (404); here it is the ordinary "already blocked" (no write, no error).
MarkAccountDeviceBlocked(accountID, deviceID string) (changed bool, err error)
```

```sql
UPDATE devices SET send_state = 'blocked', updated_at = ?
WHERE device_id = ? AND account_id = ? AND send_state <> 'blocked'
```

That makes "only when the value actually changes" true across restarts and across
processes, rather than true only within one process's memory. And it is audited:
the marking site emits the same `[ACCOUNTS] actor=… set device=… send_state=…`
line `usecase/account.go` emits, with actor `agent_bridge` — otherwise an operator
finding a number blocked would have nothing recording what did it.

---

## Steps

### Step 1 — the baseline, measured before the first edit

`TestReplyPathDeviceRowReadsMatchBaseline` already counts device-row reads through
both seams and pins the pair. It was **re-run on this branch's unmodified tree**
before any edit: **1 read** (JID row resolves), **1 read** (no row resolves),
**2 reads** (session-id fallback). Recorded in `implement.md`.

The `ListDevices()` counter revision 1 proposed is **dropped**: the performance
lens showed `ListDevices()` is already called at least once per inbound message
on the green path (`isLocalDeviceJID`, and `sessionIDForRegisteredJID` on the
JID-miss branch), so a green-path baseline of zero is unreachable and the two
counts would be conflated. What is counted instead is the **new symbols**, which
are package-level function variables and therefore countable:
`siblingDevicesFn` and `resolveCandidateInstanceFn`. TC-9 asserts both are called
**zero** times on the green path.

### Step 2 — the switch table (`validations/account_validation.go`)

Only what genuinely crosses a package boundary moves here. The senior lens was
right that `validations/` is the home for the closed lists the **account layer**
validates, not for another package's log vocabulary:

```go
// ReasonTransportRefused is the coded reason a transition the §5.3 table forbids
// was not attempted. It is here rather than beside its consumer because BOTH the
// send path and the operator-facing device list report it.
const ReasonTransportRefused = "transport_refused"

// TransportSwitchAllowed is §5.3, and it is the ONLY statement of that table in
// the tree.
func TransportSwitchAllowed(from, to string, customerHasPhone bool) (bool, string)
```

| from → to | result | reason |
|---|---|---|
| `whatsmeow → whatsmeow` | allowed | — |
| `whatsmeow → meta_cloud` | refused | `transport_refused` |
| `meta_cloud → meta_cloud` | refused | `transport_refused` |
| `meta_cloud → whatsmeow`, phone known | allowed | — |
| `meta_cloud → whatsmeow`, phone unknown | refused | `transport_refused` |
| any value outside the closed list | refused | `transport_refused` |

`""` normalises to `whatsmeow` (migration 53's default). The last row is ticket
18's fail-closed direction: a channel a later ticket adds is refused until someone
teaches this function about it.

`agent_bridge.go`'s `agentRefusalTransport` becomes an alias of
`validations.ReasonTransportRefused`, so ticket 18's tests and call sites are
untouched while the token has one definition. `arrival_blocked`,
`arrival_disconnected` and `customer_unreachable` stay **in package `whatsapp`**
beside it — they are produced and consumed there and nowhere else.

### Step 3 — the pure ordering function (`agent_reply_order.go`, new)

This file is pure. No registry, no `DeviceManager`, no client, no context — so its
table test needs no fixture of any kind (AC-1, NFR-5, TC-1). The registry lookup
revision 1 put here moves to Step 5.

```go
type replyCandidate struct {
    DeviceID  string // devices.device_id — the ROW key, not the JID (see D-C)
    Transport string // "" reads as whatsmeow
    Priority  int    // lower = tried first, among FALLBACKS only
    Blocked   bool   // send_state == "blocked"
    Connected bool   // see below — a FACT, never a prediction
}

func arrivalSkipReason(arrival replyCandidate) string
func fallbackSkipReason(arrival, candidate replyCandidate, customerHasPhone bool) string
func buildAttemptOrder(arrival replyCandidate, siblings []replyCandidate, customerHasPhone bool) []replyCandidate
```

`arrivalSkipReason` order is deliberate — `Blocked` (operator intent) → transport
(what the row says the device speaks) → `Connected`. Transport **must** precede
connectivity: a `meta_cloud` device has no whatsmeow client to be connected with,
so the other order would report `arrival_disconnected` for every Meta row and name
the wrong cause in the log.

`Connected` on the arrival starts **true** — ticket 18's documented reasoning: the
sole entry to this path is an inbound whatsmeow event, so the arrival device
provably had a live session. It becomes `false` only when a send attempt **proved**
otherwise (D1). It is never a guess.

`buildAttemptOrder`:

1. append `arrival` iff `arrivalSkipReason(arrival) == ""` — always first, whatever
   its numeric priority (AC-2);
2. if `!customerHasPhone`, return now — no fallback is addressable (D2);
3. sort a copy of `siblings` by `(Priority, DeviceID)` — the SQL already orders that
   way; re-sorting a slice of tens costs nothing and makes the contract independent
   of the caller's `ORDER BY` (AC-3);
4. append the first sibling with `fallbackSkipReason(...) == ""` (AC-11, AC-12);
5. return — length ≤ 2 by construction (AC-4).

No rotation, no round-robin (AC-21).

`fallbackSkipReason` is exported *within the package* and is what Step 9 reuses,
so the operator surface and the send path answer from one function (NFR-6).

### Step 4 — the lazy sibling read

`domains/chatstorage/interfaces.go`:

```go
// ListAccountSiblingDevices returns the OTHER devices of one EXPLICIT account,
// in reply order.
ListAccountSiblingDevices(accountID, excludeDeviceID string) ([]*DeviceRecord, error)
// MarkAccountDeviceBlocked — see D3.
MarkAccountDeviceBlocked(accountID, deviceID string) (bool, error)
```

`infrastructure/chatstorage/account_repository.go`. The blank-id guard **stays** —
the security and senior lenses both objected to revision 1 deleting it, and both
were right: it is this file's documented invariant #1, pinned by an existing test,
and removing a live guard to make another test fail is not a defence. The two
guards answer different questions and both ship:

```go
func (r *SQLiteRepository) ListAccountSiblingDevices(accountID, excludeDeviceID string) ([]*domainChatStorage.DeviceRecord, error) {
    accountID = strings.TrimSpace(accountID)
    if accountID == "" {
        return nil, errBlankAccountID() // invariant #1 of this file
    }
    return r.listAccountSiblingDevices(accountID, excludeDeviceID)
}
```

```sql
SELECT device_id, display_name, jid, COALESCE(ad_jid, ''), created_at, updated_at, <deviceRoutingColumns>
FROM devices
WHERE account_id = ? AND account_id <> '' AND device_id <> ?
ORDER BY priority ASC, device_id ASC
```

`AND account_id <> ''` is **defence in depth, and the plan says so** rather than
claiming it is load-bearing. Given a non-blank binding it is implied by
`account_id = ?`; it earns its place by being the thing that still holds if a
future caller loses the Go guard. The security lens also showed revision 1's
mutation claim was half wrong: deleting the predicate breaks TC-3 but **not**
TC-4, because `account_id = 'acc_alpha'` excludes `acc_beta` on its own. So the
predicate is proved by a **white-box** test that calls the unexported
`listAccountSiblingDevices("")` directly, bypassing the guard — which is the only
way to exercise it honestly — and TC-4's mutation claim is dropped.

`deviceRoutingColumns` / `scanDeviceRoutingTargets` are reused verbatim. Wrapper
delegation goes in `chatstorage_wrapper.go` beside the other account methods. The
repository is the `chatStorageRepo` **already passed into** `runAgentBridge`.

### Step 5 — resolving a candidate's live instance (`agent_bridge.go`)

Revision 1 specified one `ListDevices()` snapshot. The performance lens showed,
with the lock arithmetic, that at realistic K it is **worse** than what it
replaces: the registry is keyed by `instance.ID()`, and `AddDevice` persists that
same string as `devices.device_id` — so `manager.GetDevice(record.DeviceID)` is
**one map hash under one `RLock`, zero instance locks, zero allocations**, while
the snapshot costs `1 + 2N` locks, a sort and two allocations before the first
candidate is examined. An account holds 1–3 devices and `buildAttemptOrder` needs
only the *first* eligible sibling, so K is effectively 1 — where the snapshot is
strictly worse.

Both are correct; the ticket's requirement is "not K passes with nested locks".
So: keyed lookup first, and **one** lazily-built snapshot as the fallback for
slots the registry holds under a JID key:

```go
// resolveCandidateInstance answers "which live session is this row?", in the order
// that costs least.
//
//  1. GetDevice(record.DeviceID) — one hash under one manager RLock. Hits for every
//     device created through AddDevice, which persists instance.ID() as device_id.
//  2. one snapshot, built AT MOST ONCE per message and memoised, for the rest.
//
// What it must never become is getDeviceByJID per candidate: that walks the map
// TWICE and takes an RLock per instance through ADJID()/JID(), so K siblings is
// O(K·N) with nested locks (the scope note, rev 2).
//
// A nil DeviceManager, a nil instance, or a record matching nothing answers
// (nil, false) — NOT CONNECTED. Fail-closed: a sibling carries none of the proof
// of liveness the arrival device has.
```

The snapshot **skips empty keys**. The security lens found that revision 1's flat
map would key an unpaired instance (`JID() == ""` after `ResetClient`) under `""`,
where a blank-`jid` device row — a documented, tested case — would then match it
and send on a client belonging to another device.

And before a sibling is used, `client.Store.ID` is checked against the row's
`jid`/`ad_jid`; a mismatch is refused. The registry is a cache of the same table,
and disagreeing with it is a reason to stop, not to guess.

### Step 6 — the send exit, the outcome, and the two attempts

```go
// agentAttemptOutcome — see D1 for the full table and why unknown is agentFailedSending.
type agentAttemptOutcome int
const (
    agentDelivered agentAttemptOutcome = iota
    agentRefusedPreSend // provably nothing reached WhatsApp — the ONLY switchable outcome
    agentFailedSending  // may already have been accepted — NEVER switch
)
```

`sendAgentReply` keeps the gate inside it and `agentSendMessageFn` below it
(ticket 18: a gate a caller can walk around is not a gate), and now returns the
outcome explicitly instead of making `deliverAgentReply` re-derive the refusal by
calling `agentSendRefusal` a second time — that re-derivation is precisely the
seam a later edit desynchronises:

```go
func sendAgentReply(ctx, target, to, message) (whatsmeow.SendResponse, agentAttemptOutcome, string, error)
```

The liveness read goes through a seam, `agentClientConnectedFn`, for the same
reason `agentSendMessageFn` is one: a test cannot construct a connected
`*whatsmeow.Client` (it needs a websocket), and `(&whatsmeow.Client{}).IsConnected()`
is `false`. It sits **inside** `sendAgentReply`, above `agentSendMessageFn`, so it
cannot be walked around either.

`deliverAgentReply` returns `(agentAttemptOutcome, string, error)`.

The delivery is written **straight-line, not as a loop**. A loop over a
two-element order invites a later edit to raise the bound; a rule this dangerous
should be readable in one pass:

```go
// deliverAgentReplyWithFailover — at most two attempts, at most one of which can
// have reached WhatsApp (D1).
1. reason := arrivalSkipReason(arrival)
2. if reason == "":
       attempt 1 on the arrival, with its OWN context.WithTimeout(ctx, agentDeliveryTimeout)
       delivered      → return
       failedSending  → markAgentSendFailure(arrival, err); log; return    ← AC-15, no switch
       refusedPreSend → markAgentSendFailure(arrival, err)                 ← may mark, may switch
                        arrival.Connected/Blocked updated from what was PROVED
                        reason = the refusal's coded reason
3. // failure branch — LAZY, and after the agent response (AC-8)
   siblings := siblingDevicesFn(accountID, rowDeviceID)   // skipped when accountID == ""
   order := buildAttemptOrder(arrival, siblings, customerHasPhone)
4. if no fallback → logAgentNoCandidate(reason); return                    ← AC-7
5. logAgentSwitch(reason)                                                  ← AC-20
6. attempt 2, with its OWN context.WithTimeout(ctx, agentDeliveryTimeout)  ← AC-16
   not delivered → markAgentSendFailure(fallback, err); log; return
```

Each attempt's context is derived from `ctx`, never from the previous attempt's —
deriving attempt 2 from attempt 1's expired context is the shared-budget bug the
scope note names, and it is not fixable by ordering the `cancel()` calls.

Honest note the performance lens asked for: because every pre-send refusal is an
in-memory check that performs no I/O, an attempt that refuses cannot actually
consume 28 of its 30 seconds in production. AC-16 is a **structural** guarantee,
proved by a direct unit test of this function, not a claim about observed timing.

### Step 7 — wiring in `runAgentBridge`

The pre-flight refusal is **unchanged** (D0). After `sanitizeAgentReply`:

```go
arrival := replyCandidate{
    DeviceID:  rowDeviceID,            // "" when the row did not resolve → no siblings
    Transport: routing.Transport,
    Priority:  rowPriority,
    Blocked:   rowSendState == validations.SendStateBlocked,
    Connected: true,                   // proven by the inbound event; see D1
}
customerHasPhone := sender.Server == types.DefaultUserServer
```

`agentSendTarget` gains `RowDeviceID` — `devices.device_id`, distinct from
`DeviceID`, which `resolveAgentDeviceID` fills with a **JID**. Marking uses only
`RowDeviceID`; using the other would match zero rows and report a routing change
that did not happen. `deliverAgentReplyArgs` gains `StorageDeviceID`,
`StorageClient` and `FallbackRecipient` (D2).

A sibling read that errors is logged and treated as **no siblings** — never fatal.

### Step 8 — Meta's non-marking codes (AC-19)

Revision 1 asked the panel whether to ship an uncalled predicate. **Both lenses
that answered said no**, and gave the better answer: AC-19 is already satisfied
**by construction**, not by a branch.

There is no Meta send path, so no error can carry 131047 or 131026 (CON-5); and
even if one could, D3's classifier marks only on an enumerated terminal list, so
**unknown ⇒ transient ⇒ no marking**. A predicate with no caller would be a shape
guess that ticket 20 rewrites, while creating the impression the rule is enforced
now. Nothing ships; the rule is recorded in `verify.md` as satisfied by the
transient-by-default classifier, and carried forward as a named requirement on
ticket 20's terminal list.

### Step 9 — the operator surface (AC-13, REQ-10)

```go
// FallbackAllowed reports whether the §5.3 TABLE permits a reply that arrived on a
// whatsmeow sibling to be re-sent from this device, and FallbackReason carries the
// coded reason when it does not.
//
// It is the POLICY half and says so in its name: the send path additionally
// requires send_state != 'blocked' (already reported beside this field) and a live
// session (already reported by GET /devices). Naming it "eligible" would promise a
// working fallback for a device that is merely disconnected — the exact thing
// AC-13 forbids.
//
// Computed from the same validations.TransportSwitchAllowed the send path
// consults, from a whatsmeow arrival — the only kind that exists before ticket 20.
FallbackAllowed bool   `json:"fallback_allowed"`
FallbackReason  string `json:"fallback_reason,omitempty"`
```

Filled in `usecase/account.go > devicesOfAccount`, from the values that function
has **already** normalised through the closed lists, so a row holding an
out-of-list transport reports refused rather than being echoed.

### Step 10 — the M-i index decision (AC-22)

**Decision: do not ship it.** The load-bearing reason is **cardinality**, not
laziness — the performance lens correctly refused revision 1's laziness argument,
since a correlated outage (a restart, a network blip) puts every in-flight message
into the failure branch at once, so that branch is not cold, it is bursty:

- `devices` holds one row per WhatsApp slot — tens — so both SQLite and PostgreSQL
  choose a sequential scan at this cardinality regardless, and
  `ORDER BY priority, device_id` needs a sort either way;
- today every row carries `account_id = ''`, which the predicate excludes, so the
  index would be degenerate — near-zero selectivity on the only value present;
- verified: `devices` carries `idx_devices_created_at`, `idx_devices_jid`,
  `idx_devices_ad_jid`, `idx_devices_meta_pni` and **no index on `account_id`**;
- and `TestAccountSchemaDefersLaterTicketMigrations` **actively fails** if
  `idx_devices_account_priority` is appended — the enforcement already exists.

The migration list is append-only, so an index added now can never be un-added. It
belongs to the ticket that first observes a real account population.

### Step 11 — tests

| File | Tests |
|---|---|
| `validations/account_validation_test.go` (extend) | the §5.3 table, all six rows including the fail-closed default |
| `infrastructure/whatsapp/agent_reply_order_test.go` (**new**) | TC-1, no fixtures at all: arrival-first at the highest priority number, blocked/disconnected excluded, priority order, `device_id` tie-break, ≤ 2 entries, `transport_refused` for a Meta sibling, `meta → meow` both ways on `customerHasPhone`, no fallback at all when `customerHasPhone` is false; `arrivalSkipReason` precedence (blocked > transport > connectivity) |
| `infrastructure/whatsapp/agent_reply_failover_test.go` (**new**) | the D1 outcome table (each error → outcome, with `ErrNotConnected` and `ErrMessageTimedOut` on the **no-switch** side); TC-5; TC-6 (per-attempt budget, unit-tested on the delivery function); TC-7; TC-9 (both new seams called zero times on the green path); the D2 splits (reply stored against the arrival, `senderJID` from the sibling, debug chat JID normalised with the arrival client, fallback addressed by the resolved sender); TC-8 marking hygiene (terminal vs transient, the window, the SQL change-only predicate, the audit line); the empty-key and `Store.ID`-mismatch refusals |
| `infrastructure/chatstorage/sqlite_repository_account_test.go` (extend) | TC-3 (white-box, blank id bound directly → the predicate excludes), TC-4 (cross-account), arrival exclusion, ordering, and `MarkAccountDeviceBlocked`'s change-only behaviour. SQLite **and** PostgreSQL through the existing dual harness |
| `usecase/account_test.go` (extend) | TC-10 |
| `infrastructure/whatsapp/agent_reply_routing_test.go`, `agent_bridge_test.go` (**rewire**) | ticket 18's tests against the new signatures, and a `withConnectedClients` helper — the liveness seam is new at the send exit, so a ticket-18 target must now state that it is live |

Mutation checks (ticket 18's discipline — several gates here are unreachable in
production, so a green test proves less than usual): switch on `agentFailedSending`
→ TC-5 must fail; derive attempt 2's context from attempt 1's → TC-6 must fail;
delete `AND account_id <> ''` → TC-3's white-box case must fail. Applied, recorded,
reverted.

### Step 12 — validation

`go build -C src ./...`, `go vet -C src ./...`,
`go test -C src -tags purego -count=1 ./...` (SQLite), and the same with
`CHAT_STORAGE_TEST_POSTGRES_URI` set (real PostgreSQL) — new SQL ships here, so
both dialects must be shown, not argued. `-tags purego` because this host has no
C toolchain, which is also why `-race` cannot run (ticket 18 recorded the same).

## Files to change

| File | Change |
|---|---|
| `src/validations/account_validation.go` | `ReasonTransportRefused`, `TransportSwitchAllowed` |
| `src/validations/account_validation_test.go` | the table test |
| `src/domains/chatstorage/interfaces.go` | `ListAccountSiblingDevices`, `MarkAccountDeviceBlocked` |
| `src/infrastructure/chatstorage/account_repository.go` | both statements; guard kept, predicate kept |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | TC-3, TC-4, marking |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | wrapper delegation |
| `src/infrastructure/whatsapp/agent_reply_order.go` | **new** — pure ordering only |
| `src/infrastructure/whatsapp/agent_reply_order_test.go` | **new** — TC-1 |
| `src/infrastructure/whatsapp/agent_bridge.go` | outcome + liveness seam in the send exit; the straight-line two-attempt delivery; `RowDeviceID`; `StorageDeviceID`/`StorageClient`/`FallbackRecipient`; candidate resolution; switch/refusal logging with dedupe; failure classification and marking |
| `src/infrastructure/whatsapp/agent_reply_failover_test.go` | **new** |
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` | **rewire** (signatures + liveness) |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | **rewire** — three `deliverAgentReplyFn` stubs and `agentRepoSpy` |
| `src/domains/account/account.go` | `FallbackAllowed` / `FallbackReason` |
| `src/usecase/account.go` | fill them from the shared function |
| `src/usecase/account_test.go` | TC-10 |

**Not touched:** every deployment runtime file (CON-1), `ui/rest/send.go`,
`ui/mcp/send.go` (CON-2), `webhook_forward.go`, `auto_reply.go`, and
`getMigrations()` (Step 10).

## Validation strategy

No validation profile is named; the commands are Step 12's, on both database
backends, plus the three mutation checks.

## Rollback

Revert the commit. Without it the reply path stops after the arrival device, which
is ticket 18's behaviour exactly. No schema change to unwind (Step 10). The two
new `AccountDevice` fields disappear from **four** shipped responses — the device
list, `AttachDevice`, `SetDeviceOrder` and `SetDeviceSendState` all return
`AccountDevice` — which is an additive-field removal no client depends on yet.

## Out of scope

Everything in `spec.md > Out of scope`, and specifically: no Meta send, no
migration, no country routing, no automatic unblocking, no rotation, no detach
endpoint.

---

## Panel response

Three read-only lenses reviewed revision 1 **against the source**: 40 findings —
12 major, 16 minor, 12 info/nit. **28 adopted, 4 declined with reasons, and 3
claims of revision 1 corrected**, one of which was load-bearing.

The panel's most valuable property this round was **convergence**. Three of the
four majors were raised independently by two or three lenses arriving from
different directions, and revision 1 would have passed its own tests in every
case:

- **All three lenses** rejected moving ticket 18's pre-flight refusal — the
  performance lens on billed-call cost, the security lens on unauthenticated
  resource exhaustion plus permanent silent rerouting, the senior lens on the
  ticket-18 acceptance test it inverts. → **D0**, the change is dropped entirely.
- **Performance and senior** independently found that revision 1's marking call
  sat in the one branch that can never carry a send error, so AC-17 was
  unimplementable as drawn — and the performance lens went further: if the
  *refusal reason* had fed the counter instead, three brief reconnects would
  permanently block a healthy number. → **D3**.
- **Performance and senior** independently rejected reading `client.IsConnected()`
  when the agent response arrives. Answering them sent me into whatsmeow's source,
  where I found the mechanism revision 1 was **built on** is false. → **D1**.
- **Security and senior** independently found the same de-partitioning bug in
  `storeAgentDebug`, from opposite ends — and the security lens found the deeper
  one beneath it: the recipient JID is resolved in the *arrival* device's LID
  namespace and would have been handed to a sibling that cannot resolve it. →
  **D2**.

### Adopted

**Majors** — D0 (pre-flight refusal restored, all three lenses); D1 (switch
allowlist; `ErrNotConnected` moved to the no-switch side; liveness read at the
send instant, perf + senior); D2 (LID recipient and `customerHasPhone` made
load-bearing, security; debug chat JID normalised with the arrival client,
security + senior); D3 (marking driven by the send error, window-bounded,
re-verified before the write, change-only in SQL, audited — perf + security +
senior).

**Minors** — keep `errBlankAccountID()` **and** the predicate, and prove the
predicate white-box (security + senior); drop the false TC-4 mutation claim
(security); keyed `GetDevice` lookup before any snapshot (performance); skip empty
keys in the snapshot and verify `Store.ID` against the row (security); dedupe the
new log lines through `shouldWarnAgentRefusal` and key any cache by device id, not
message id (perf + security); keep `agent_reply_order.go` genuinely pure and state
the nil-`DeviceManager` behaviour (senior); `fallbackSkipReason` shared with the
operator surface so the two cannot drift (senior); rename to `fallback_allowed`
and say it is the policy half (security); `sync.Map` for the counter and a
`resetAgentSendFailures` test helper (security + senior); add
`agent_bridge_test.go` to Files to change and add `ListAccountSiblingDevices` to
`agentRepoSpy`, treating a failed sibling read as "no siblings" rather than a
panic (senior); specify the candidate→target mapping explicitly (senior); AC-19
satisfied by construction, nothing shipped (security + senior); cardinality, not
laziness, as Step 10's reason, citing the test that already enforces it
(performance); Rollback names four endpoints (senior); Step 1 counts the new seams
rather than `ListDevices()` (performance); AC-16 restated as structural and
unit-tested rather than a production-timing claim (performance).

### Declined

**Dec-1 — "attach alone should not be sufficient for failover; add an explicit
per-device opt-in" (security, major).** The concern is accurate and now stated in
`spec.md > CON-8`: any authenticated caller can attach any device, there is no
detach endpoint, and after this ticket that action reroutes live customer traffic.
Declined because it grants **no new capability**: the same credential can already
send from any device directly through `POST /send/message` with `X-Device-Id`,
read any chat, and block any device. Failover adds no privilege an attacker did
not already hold more directly, and `domains/account/account.go` already documents
the account as "an organizational grouping within ONE trust domain, not an
authorization boundary". A new `fallback_enabled` column would also mean a
migration this ticket's own AC-22 refuses. The mitigation that exists today is
recorded instead: `PATCH /accounts/:id/devices/:device_id` with
`send_state=blocked` removes a device from failover immediately.

**Dec-2 — "keep the arrival in the order as a last resort; never remove it when no
usable sibling exists" (senior, major).** Declined: AC-7 requires an explicit
recorded refusal when nothing usable remains, and the two conditions that remove
the arrival are `send_state='blocked'` (a deliberate operator instruction, which
this would override) and a **proved** send-time refusal (retrying it would repeat
a failure that just happened). The behaviour-change half of the finding was real
and is adopted in D1 — the arrival is no longer removed by a *prediction*, only by
a fact.

**Dec-3 — "pick one boundary: either the Go guard or the SQL predicate, not both"
(senior, minor).** Declined in favour of the security lens's version of the same
finding: keep both, and be honest in the comment about which one is load-bearing.
Deleting either to make a test meaningful is how a defence becomes decorative.

**Dec-4 — "add a grace period / minimum-duration-disconnected check before
declaring the arrival disconnected" (performance, major).** The premise is adopted
in D1 — the check moved from 90 s before the send to the send instant, which
removes the flap window the finding is about. The grace period itself is declined:
§5.2 already chose "skip now" over waiting, a wait spends the delivery budget the
reply needs, and at the send instant "not connected" is no longer a prediction.
The residual trade-off is recorded in D1 rather than argued away.

### Corrections to revision 1

**C-1 — "a failure returning `ErrNotConnected` proves nothing reached WhatsApp"
is false.** `whatsmeow.SendMessage` reaches that sentinel from two
indistinguishable places, one of them **after** the frame was written
(`retryFrame` at `send.go:442` → `request.go:208`). Revision 1's central switch
rule would have produced the exact duplicate reply the ticket exists to prevent.
Found while answering the panel; the design is rebuilt around an allowlist (D1).

**C-2 — "`buildAttemptOrder` returning two entries is a test-only shape."**
Revision 1 argued production could only ever reach one send, which was
self-consistent but wrong once D1 landed: a *proved* pre-send refusal on the
arrival is a real production path to a two-entry order. The two-attempt case is
real, and is exercised as such.

**C-3 — "the green path pays nothing" (NFR-1) is overstated.** It is true for the
two quantities NFR-1 names — device-row reads and the new seams — and false as a
general claim: `buildAttemptOrder` allocates its result slice on every answered
message. Immaterial against a 90-second HTTP call, but recorded rather than
restated broadly.

### Recorded, no change

`AccountDevice` already exposes `jid`, `transport`, `send_state` and `priority` to
the same flat-auth caller, `DeviceRecord.WebhookSecret` carries `json:"-"`, and
`Account` has no `meta_token_ref` field — so `fallback_reason` and the new log
lines leak nothing new (security, info). The `ListDevices()` snapshot releases the
manager `RLock` before taking any instance `RLock`, so it introduces no new lock
ordering (security, info). `agentResponse` gains no field, so ticket 18's NFR-2
containment survives — and the `TestAgentResponseIsUnchanged` discipline is
extended to `agentSendTarget` and `deliverAgentReplyArgs`, which are the new
places a field could quietly appear (security, info — adopted as a test). No
deployment runtime file is touched (security, info).
