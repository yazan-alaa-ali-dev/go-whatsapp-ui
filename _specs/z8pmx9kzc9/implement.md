---
ticket: z8pmx9kzc9
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc9"
  github: ""
---

# Implementation — 18 · Resolve the account and enforce the transport check on the reply path

Applied on branch `ticket/z8pmx9kzc9`, cut from `ticket/z8pmx9kzc8` — the tip
carrying the account layer (migrations 51–61, `DeviceRecord.GowaAccountID` /
`Transport`, the accounts API) and the webhook/agent account projection. Per the
workflow's delivery boundary, **no commit was created at this stage** — the single
publishable commit is made by `/publish-pr`.

## Files changed

### New (1)

| File | What it holds |
|---|---|
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` | 13 tests: the differential send gate, the column-not-shape assertion, the fail-closed direction, the recorded-and-deduped refusal, the no-leak check, the pre-flight refusal, the read-count baseline (3 cases), the target hand-off, the empty-reply case, the unresolved-row case, the closed list, the deliberate webhook divergence, and the untrusted-response behavioural test |

### Modified (2)

| File | Change |
|---|---|
| `src/infrastructure/whatsapp/agent_bridge.go` | `agentRouting` + `agentRoutingFromRecord` + `sendTransport`; `agentSendTarget`; `deliverAgentReplyArgs.Target` replacing `Client`/`DeviceID`; the pre-flight refusal in `runAgentBridge`; `sendAgentReply` + `agentSendRefusal` + `agentSendMessageFn` + `agentRefusalTransport`; `agentRefusalWarnCache` + `shouldWarnAgentRefusal` + `logAgentRefusal`; the rewritten `deliverAgentReply` invariant comment; widened comments on `agentResponse` and `agentDeliveryTimeout`; `buildAgentRequest` takes `agentRouting` |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | Six `buildAgentRequest` call sites now pass `agentRoutingFromRecord(...)` — which keeps every existing assertion end-to-end (row → payload) and extends its coverage to the extracted projection; one `args.DeviceID` → `args.Target.DeviceID` |

**No deployment runtime file was touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows), and
neither `ui/rest/send.go`, `ui/mcp/send.go` nor `webhook_forward.go` appears in
the diff.

```
 src/infrastructure/whatsapp/agent_bridge.go      | 317 +++++++++++++++++++----
 src/infrastructure/whatsapp/agent_bridge_test.go |  18 +-
 src/infrastructure/whatsapp/agent_reply_routing_test.go  (new)
```

## What the change does

1. **Resolve once.** `runAgentBridge` projects the device row it already read into
   an `agentRouting` and builds one `agentSendTarget` from it. Both the agent
   payload and the delivery step are fed from that single projection, so they can
   never describe different devices.
2. **Refuse pre-flight.** A target that cannot send is refused immediately after
   the row read — before the billed agent call, before a gate slot is held for up
   to 90 seconds.
3. **Refuse at the exit.** `sendAgentReply` holds the mandatory check and is the
   only way to reach whatsmeow from this path.
4. **Say what is true.** The `deliverAgentReply` invariant comment now describes
   the account boundary, and names the precondition (an inbound whatsmeow event
   proves a live session) together with the ticket that ends it.

## Deviations from the plan

**D-1 — the delivery repo spy is new, not reused.** The plan's test list assumed
the existing `agentRepoSpy` would serve. It cannot: it overrides only
`SetMessageDebug`, so the successful half of the differential test panics on
`StoreSentMessageWithContext` through its nil embedded interface. A
`replyRepoSpy` covering both writes was added in the new test file. This is what
made the extra assertion possible — a refused device stores **nothing**, which is
the "skipped" half of AC-6 and was not in the plan's assertion list.

**D-2 — the test target carries an empty `*whatsmeow.Client`, not `nil`.** The
first draft passed `nil`, which panics in the success path at
`args.Target.Client.Store`. The fix is in the **test**, not the code: production
cannot reach `deliverAgentReply` with a nil client — `handleAgentBridgeWithText`
returns early on `client == nil` — so the delivery step is entitled to assume one,
and adding a nil guard would have been test scaffolding pushed into production
code. Recorded because the choice was deliberate.

**D-3 — the existing `buildAgentRequest` tests were rewired rather than rewritten.**
The plan said the signature change would break no build because the literals are
keyed; that was right for `deliverAgentReplyArgs` and wrong for
`buildAgentRequest`, whose final parameter changed type. Each call site now wraps
its record in `agentRoutingFromRecord(...)`, which preserves the original
assertion exactly (a row still produces the same payload) and additionally covers
the extracted function. No assertion was weakened or deleted.

**D-4 — one extra test beyond the plan's list.** `TestAgentRefusalLogCarriesNoCustomerData`
pins that the refusal line carries no customer number and no reply text. The
security lens found no leak in the proposed line; this keeps that true rather than
leaving it to a future edit.

**D-5 — `TestAgentSendRefusalAdmitsOnlyWhatsmeow` added as a unit.** The
behavioural tests cover the gate through delivery; this states the admitted set in
one place so a reader sees the closed list without tracing a call chain.

## The baseline, measured before the first edit

Recorded in `plan.md > Step 1`. A throwaway test file was written on the
unmodified tree, run, and **deleted** — the permanent test could not take the
"before" number, because it references struct fields that did not exist yet and so
would not compile there.

| Case | Pre-ticket device-row reads |
|---|---|
| JID row resolves and carries a `webhook_url` | 1 |
| JID row carries no `webhook_url`, no session id resolves | 1 |
| No row resolves at all | 1 |
| JID row carries no `webhook_url` **and** a session id resolves | 2 |

`TestReplyPathDeviceRowReadsMatchBaseline` asserts the same numbers after the
change, counting **both** seams.

## Validation run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure |

`TestResolveDocumentMIME` is **pre-existing**: measured failing on this branch
**before any change from this ticket** (see `verify.md > Pre-existing failure`),
and unrelated to it — document MIME resolution.

### Mutation check — the gate tests actually catch a broken gate

Because the gate is unreachable in production today (no API can write
`transport = 'meta_cloud'`), a test that passes proves less than usual. Both
plausible ways to break it were introduced deliberately and the suite was re-run:

| Mutation | Caught by |
|---|---|
| Gate made fail-**open** (`== meta_cloud` instead of `!= whatsmeow`) | `TestAgentReplyGateIsFailClosed` — 2 subtests failed |
| Gate deleted from the send exit entirely | `TestAgentReplySendGateIsDifferential`, `TestAgentReplyGateReadsTheColumnNotTheJID`, `TestAgentReplyGateIsFailClosed` — 4 subtests failed |

Both mutations were reverted and the suite re-run green.
