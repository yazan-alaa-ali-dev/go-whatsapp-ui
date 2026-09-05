---
ticket: z8pmx9kzca
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-27
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzca"
  github: ""
---

# Implementation — 19 · Fail over by priority inside a single account

Applied on branch `ticket/z8pmx9kzca`, cut from `ticket/z8pmx9kzc9` — the tip
carrying the account layer (migrations 51–61), the webhook/agent account
projection, and ticket 18's reply-path transport gate. Per the workflow's delivery
boundary, **no commit was created at this stage** — the single publishable commit
is made by `/publish-pr`.

## Files changed

### New (3)

| File | What it holds |
|---|---|
| `src/infrastructure/whatsapp/agent_reply_order.go` (193) | The pure ordering rules: `replyCandidate`, `arrivalSkipReason`, `fallbackSkipReason`, `buildAttemptOrder`, and the four coded reasons that stay inside this package |
| `src/infrastructure/whatsapp/agent_reply_order_test.go` (310) | TC-1 — 13 table cases plus the two precedence tests. **No fixture of any kind**: no HTTP server, no database, no device manager, no context |
| `src/infrastructure/whatsapp/agent_reply_failover_test.go` (739) | 18 tests: the duplicate-reply rule across five error kinds, the switch, TC-2, the independent budgets, the LID guard, the transport refusal, the account boundary at the point of use, the laziness counts, the error classifier, and six marking-hygiene tests |

### Modified (9)

| File | Change |
|---|---|
| `src/infrastructure/whatsapp/agent_bridge.go` (+707/−39) | `agentAttemptOutcome`; `RowDeviceID` on the target; `Recipient`/`StorageDeviceID`/`StorageClient` on the args; the liveness seam and the outcome return in `sendAgentReply`; `classifyAgentSendError` and `agentSendFailureIsTerminal`; `deliverAgentReplyWithFailover`; `agentSiblingCandidates`; `agentDeviceLookup` + `snapshotDevicesByIdentity`; `markAgentSendFailure` and its window; `logAgentSwitch` / `logAgentNoCandidate`; the selection wiring in `runAgentBridge` |
| `src/validations/account_validation.go` (+76) | `ReasonTransportRefused`, `TransportSwitchAllowed` (§5.3, stated once), `normaliseTransport` |
| `src/infrastructure/chatstorage/account_repository.go` (+98) | `ListAccountSiblingDevices` + the unexported statement, `MarkAccountDeviceBlocked` |
| `src/domains/chatstorage/interfaces.go` (+19) | the two repository methods |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` (+13) | wrapper delegation, account-scoped not device-scoped |
| `src/domains/account/account.go` (+20) | `FallbackAllowed` / `FallbackReason` |
| `src/usecase/account.go` (+30/−…) | fills them from `TransportSwitchAllowed` |
| `src/validations/account_validation_test.go` (+67) | the §5.3 table test |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` (+189) | TC-3 (white-box), TC-4, ordering, and the change-only marking write |
| `src/usecase/account_test.go` (+77) | TC-10 |
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` (+107/−…) | ticket 18's tests rewired: new signatures, `withConnectedClients`, `RowDeviceID`, the spy's two new methods, and `TestAgentReplyRefusalIsRecorded` moved to the layer that now does the recording |
| `src/infrastructure/whatsapp/agent_bridge_test.go` (+10/−…) | three `deliverAgentReplyFn` stubs to the new signature |

**No deployment runtime file was touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows), no
migration was appended, and neither `ui/rest/send.go`, `ui/mcp/send.go`,
`webhook_forward.go` nor `auto_reply.go` appears in the diff.

```
 src/domains/account/account.go                          |  20 +
 src/domains/chatstorage/interfaces.go                   |  19 +
 src/infrastructure/chatstorage/account_repository.go    |  98 +++
 src/infrastructure/chatstorage/sqlite_repository_account_test.go | 189 ++++
 src/infrastructure/whatsapp/agent_bridge.go             | 746 ++++++++++++---
 src/infrastructure/whatsapp/agent_bridge_test.go        |  10 +-
 src/infrastructure/whatsapp/agent_reply_routing_test.go | 107 ++-
 src/infrastructure/whatsapp/chatstorage_wrapper.go      |  13 +
 src/usecase/account.go                                  |  30 +-
 src/usecase/account_test.go                             |  77 +
 src/validations/account_validation.go                   |  76 +
 src/validations/account_validation_test.go              |  67 +
 12 files changed, 1391 insertions(+), 61 deletions(-)
 + 3 new files (1242 lines)
```

## What the change does

1. **Orders purely.** `buildAttemptOrder` decides which devices may be tried, from
   values alone — arrival first whatever its priority, then at most one sibling by
   ascending priority with `device_id` as the tie-break.
2. **Reads lazily.** The sibling query runs only when the arrival device cannot
   send, and only after the agent has answered. A message answered by its own
   device issues no extra query and touches the device registry zero times.
3. **Bounds the account in SQL.** `WHERE account_id = ? AND account_id <> ''`, with
   the arrival excluded in the same clause so its row never travels.
4. **Switches only on proof.** A second attempt happens only after a condition
   from a closed allowlist that proves nothing was written. Everything else,
   including errors this code has never seen, ends the message.
5. **Marks conservatively.** Three terminal failures inside 15 minutes, verified
   once more at the write, recorded change-only in SQL, and audit-logged.
6. **Tells the operator the truth.** The device list reports the same switch table
   the send path consults.

## Deviations from the plan

**D-1 — `agentDeliveryBudget`: a seam the plan did not list, added because the
test it enables caught a real gap in my own test.** The plan proposed proving
AC-16 by driving the delivery function with a two-entry order. I wrote that test,
then ran the planned mutation (deriving attempt 2's context from attempt 1's) and
**the test passed anyway** — it was asserting a proxy (that the deadline looked
roughly full), and at a 30-second budget with an instant stub, a shared deadline
looks identical to an independent one. The honest fix was to let an attempt
actually consume time, which at 30 seconds means a 22-second test. So
`agentDeliveryTimeout` gained a one-line seam, the test turns the budget down to
200 ms and burns three quarters of it, and the mutation now fails with "the second
attempt started with 48.6 ms of a 200 ms budget". Recorded because a seam added
for testability is a production change, and because the first version of that test
would have shipped a guarantee it could not check.

**D-2 — sibling connectivity reads through `agentClientConnectedFn`, not
`DeviceInstance.IsConnected()`.** The plan said the latter. They are the same
question, but asking it through two different functions means the ordering could
select a candidate the send exit then refuses — with the arrival already excluded
and nothing left to try, a fallback that silently never fires. One seam, one
answer.

**D-3 — the transport check for the arrival is written out rather than routed
through `TransportSwitchAllowed`.** Passing the arrival's transport as both `from`
and `to` gives the right answer for every case, but it asks a switch table a
non-switch question, and it would need a meaningless `customerHasPhone` argument.
`arrivalSkipReason` therefore keeps ticket 18's own rule — this build speaks one
channel — while every genuine *transition* goes through the table.

**D-4 — `TestAgentReplyRefusalIsRecorded` (ticket 18) was moved, not rewired.**
`deliverAgentReply` no longer logs a refusal, because it no longer knows what one
means: whether a device that cannot send is a skipped message or a switch to a
sibling is the caller's question. The test now drives
`deliverAgentReplyWithFailover` and asserts the same dedupe guarantee where it is
now produced. Recorded because it is a behaviour change to a ticket-18 acceptance
test, not a signature update.

**D-5 — `usecase/account.go` computes the fallback fields from the RAW transport
column, not the sanitised value the plan implied.** TC-10 failed on first run and
was right to: `devicesOfAccount` reports an out-of-list transport as `""`, and
`""` is the column default that the table reads as whatsmeow — so a row holding
`carrier-pigeon` would have been reported as an **allowed** fallback while the
reply path refuses it. That is precisely the drift NFR-6 exists to prevent, found
by the test written for it. Displaying a sanitised value and judging the stored
one are two different questions and now ask two different inputs.

**D-6 — no `agent_reply_failover.go`.** The failover lives in `agent_bridge.go` as
the plan's "Files to change" specified, rather than in a fourth file. Only
`agent_reply_order.go` is separate, because its purity is an acceptance criterion.

## The baseline, measured before the first edit

`TestReplyPathDeviceRowReadsMatchBaseline` was re-run on the **unmodified** tree of
this branch, before any change:

| Case | Device-row reads |
|---|---|
| the JID row resolves | **1** |
| no row resolves | **1** |
| the JID row carries no webhook and a session id resolves | **2** |

The `ListDevices()` counter the plan originally proposed was dropped, for the
reason the performance lens gave: `ListDevices()` is already called at least once
per inbound message on this path (`isLocalDeviceJID`, and `sessionIDForRegisteredJID`
on the JID-miss branch), so a green-path baseline of zero is unreachable and the two
counts would be conflated. The new symbols are counted instead — `siblingDevicesFn`
and `resolveCandidateInstanceFn` — and TC-9 asserts both are called **zero** times
on the green path.

## Validation run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME/Zip` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure |

Both engines ran the whole suite. PostgreSQL is not a formality here — this ticket
ships two new statements, so the dialect handle had to be shown working rather than
argued about. A throwaway `postgres:16-alpine` container was started for the run and
removed afterwards.

### Pre-existing failure

`TestResolveDocumentMIME/Zip` was **measured** failing on the unmodified tree: the
working tree was stashed, the test run alone, and the stash restored. It reports
`application/x-zip-compressed` where the test wants `application/zip` — the Windows
registry's MIME mapping — and is untouched by this diff. Ticket 18 recorded the same
failure.

### `-race` could not be run

`-race` requires cgo and this host has no C toolchain, which is also why the suite
runs under `-tags purego`. Recorded as a host limitation, not a skipped check —
and it is a real gap this time, because unlike ticket 18 this change **does** add
shared mutable state: `agentSendFailures`. It is a `sync.Map` whose values are
`*agentFailureCounter`, each carrying its own mutex, and every read-modify-write of
a counter happens under that mutex — the same shape as the `sync.Map` caches beside
it. Reviewed by inspection in place of the detector.

## Mutation checks — the guards are not decorative

Several of these rules are unreachable in production today (no API can write
`transport = 'meta_cloud'`, no inbound event originates on a Meta number), so a
green test proves less than usual. Each guard was therefore broken deliberately and
the failure recorded, then reverted.

| Mutation | Result |
|---|---|
| Let the loop switch on `agentFailedSending` | `TestFailoverNeverSwitchesAfterASend` fails on **all five** error kinds — "2 delivery attempts, want exactly 1" |
| Hoist one shared `context.WithTimeout` above both attempts (ticket 18's shape, and the tidy-up a reviewer would suggest) | `TestEachAttemptGetsItsOwnBudget` fails — "the second attempt started with 48.6911ms of a 200ms budget" |
| Delete `AND account_id <> ''` from the sibling statement | `TestListAccountSiblingDevicesExcludesImplicitAccountRows` fails — "a blank account id matched 2 devices" |

The second mutation is the one worth noting: it **survived** the first version of
that test, which is what produced deviation D-1. The check is recorded here as it
finally stands, not as it first passed.
