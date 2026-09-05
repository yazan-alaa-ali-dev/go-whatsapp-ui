---
ticket: z8pmx9kzc9
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc9"
  github: ""
---

# Verification — 18 · Resolve the account and enforce the transport check on the reply path

**Outcome: PASSED**, with one acceptance criterion (**AC-6**) passing on its send
half and on the realizable population of its UI half, and carrying a **stated
limit** on the rest. That limit is written out below rather than reported as a
pass — see [AC-6](#ac-6-in-full).

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all absent from the diff, which
contains exactly three files, all under `src/infrastructure/whatsapp/`.

There is **no schema change, no migration, no configuration key and no persisted
state**. The change is confined to one in-process code path (the AI agent reply)
and is behaviour-neutral for every device that can exist in a deployment today:
no API can write `transport = 'meta_cloud'`, so `agentSendRefusal` returns `""`
for every existing row and the path executes exactly as before.

## Commands run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure |

Both engines ran the **whole** suite. PostgreSQL adds little here — this ticket
touches no SQL, no `SELECT` list and no schema — but it was run because the branch
below it did, and an identical outcome on both is worth more than the argument
that it should be identical.

### Pre-existing failure

`TestResolveDocumentMIME` was measured failing **on this branch before any change
from this ticket** — the baseline suite was run first, precisely so this claim is
a measurement and not an assumption. It concerns document MIME resolution and is
untouched by this diff.

### `-race` could not be run on this host

`-race` requires cgo and this machine has no C toolchain (`cgo: C compiler "gcc"
not found`), which is the same reason the suite runs under `-tags purego`. Recorded
as a limitation of the host, not a skipped check. It costs nothing here: this
ticket introduces no goroutine, no shared mutable state and no new concurrency.
The one piece of shared state it adds, `agentRefusalWarnCache`, is a `sync.Map` —
the same type and the same use as the `unresolvedDeviceWarnCache` beside it.

### Mutation check — the gate tests are not decorative

The gate is **unreachable in production today** (CON-5), so a green test proves
less than usual: a gate that never fires and a gate that is broken look the same.
Both plausible breakages were therefore introduced deliberately and the suite
re-run.

| Mutation | Result |
|---|---|
| Gate made fail-**open** (`== meta_cloud` rather than `!= whatsmeow`) | `TestAgentReplyGateIsFailClosed` failed on 2 subtests |
| Gate deleted from the send exit | 3 tests failed on 4 subtests |

Both reverted; the suite is green.

## Acceptance criteria

Every criterion is mapped to an executed result (`all-ac`).

| AC | Result | Evidence |
|---|---|---|
| **AC-1** — account and transport resolved and passed to delivery, from data already read | **PASS** | `TestRunAgentBridgeCarriesTargetToDelivery`: delivery receives `acc_alpha` and `whatsmeow` from the row read at the top of `runAgentBridge`. |
| **AC-2** — +0 additional device-row reads against the measured baseline | **PASS** | `TestReplyPathDeviceRowReadsMatchBaseline`, 3 subtests: 1 / 1 / 2 reads, identical to the pre-edit measurement in `plan.md > Step 1`. Both seams counted. |
| **AC-3** — selection code between the row read and the delivery call, nowhere else | **PASS** | Source inspection of `runAgentBridge`: row read at relative line 19, `agentRoutingFromRecord` at 32, `agentSendTarget` at 33, refusal at 55, `deliverAgentReplyFn` at 82. No selection code outside that span; `git diff --stat` shows three files, all in this package. |
| **AC-4** — mandatory transport check at the send exit of the agent reply path | **PASS** | `TestAgentReplySendGateIsDifferential` (0 whatsmeow calls for `meta_cloud`, 1 for `whatsmeow`), `TestAgentReplyGateIsFailClosed`, `TestAgentSendRefusalAdmitsOnlyWhatsmeow`, plus both mutations above. |
| **AC-5** — the check reads the column, never the shape of the identifier | **PASS** | `TestAgentReplyGateReadsTheColumnNotTheJID`: a fully valid `963981201945@s.whatsapp.net` is refused on a `meta_cloud` row, and `not-a-jid-at-all` sends on a `whatsmeow` row. The gate never parses the identifier. |
| **AC-6** — registered but not live: skipped with a recorded reason, not shown as working | **PASS (send half + realizable UI half), with a stated limit** | See below. |
| **AC-7** — the agent response's `account_id`/`device_id` are ignored | **PASS** | `TestAgentReplyIgnoresAgentReturnedRouting` against a real body carrying `account_id`, `device_id` and `transport`: the target stays `acc_alpha` / arrival device / `whatsmeow`. Structural pin `TestAgentResponseIsUnchanged` still green. |
| **AC-8** — `metadata_debug` stored as received, never part of the decision | **PASS** | Same test asserts it round-trips verbatim; `TestRunAgentBridgeDeliversReplyAndDebug` unchanged and green. |
| **AC-9** — the decision is taken *when* the response arrives, not *based on* it | **PASS** | Source review: the only fields read from `response` are `Reply` (→ `sanitizeAgentReply`) and `MetadataDebug` (→ storage). The target is built before `callAgent` and never mutated afterwards. |
| **AC-10** — the invariant comment is replaced, not deleted, and matches the code | **PASS** | `deliverAgentReply`'s doc comment now states arrival-device-first, the explicit-account boundary, the device-level boundary when there is no account, and the precondition that ends at ticket 20. |
| **AC-11** — `ui/rest/send.go` and `ui/mcp/send.go` unchanged | **PASS** | `git status --short src/` lists three files; neither appears. |
| **AC-12** — no failover/priority logic ships | **PASS** | No `buildAttemptOrder`, no candidate list, no sibling query, no `priority` read anywhere in the diff. The refusal path returns; it does not try a second device. |

### AC-6 in full

**Send half — delivered and tested.** A `meta_cloud` device is skipped with a
coded reason (`transport_refused`). `TestAgentReplyRefusalIsRecorded` shows the
reason recorded once per device per hour at warn level and once per message at
debug level; `TestAgentReplySendGateIsDifferential` shows the refused device
stores **nothing** — skipped means skipped.

**UI half — holds for every row that can exist today.** A `meta_cloud` row has no
whatsmeow store session, so `LoadExistingDevices` builds no client for it and
`deriveState` (`usecase/device.go`) returns `disconnected`. It is never rendered
connected or logged in.

**The stated limit.** `deriveState` derives liveness **solely** from the whatsmeow
client and never consults `transport`. So a row carrying **both** a live whatsmeow
session **and** `transport = 'meta_cloud'` would render as logged-in while this
ticket's gate refuses its replies. Such a row is reachable only by direct database
access (CON-5: no API can write that value), and closing it belongs to ticket 20,
which owns provisioning.

This is recorded rather than reported as a pass because the test originally
planned for it — "a device with no whatsmeow client is never live" — is a
**tautology**: it passes today, unchanged, and passes identically for
`transport = 'whatsmeow'`. Two advisory lenses found this independently. Writing
a false PASS into this file would have been worse than naming the gap, so the test
was dropped and `src/usecase/device_test.go` left the change set
(`plan.md > Panel response > P-2`).

## Traceability

| Test case | Test | Result |
|---|---|---|
| TC-1 | `TestAgentReplySendGateIsDifferential`, `TestAgentReplyGateReadsTheColumnNotTheJID` | PASS |
| TC-2 | `TestAgentReplyIgnoresAgentReturnedRouting` | PASS |
| TC-3 | `TestReplyPathDeviceRowReadsMatchBaseline` | PASS |
| TC-4 | `TestRunAgentBridgeCarriesTargetToDelivery` | PASS |
| TC-5 (as corrected) | `TestRunAgentBridgeEmptyReplyAddsNoRead` | PASS |
| TC-6 | Source review of `deliverAgentReply` | PASS |
| TC-7 | `TestAgentRoutingPassesTheClosedList` | PASS |
| TC-8 | `TestRunAgentBridgeUnresolvedRowStillDelivers` | PASS |
| TC-9 (as corrected) | Source review of `deriveState`; see the stated limit | PASS with limit |

Additional tests beyond the case list: `TestAgentSendRefusalAdmitsOnlyWhatsmeow`,
`TestAgentReplyGateIsFailClosed`, `TestAgentRefusalLogCarriesNoCustomerData`,
`TestMetaCloudDeviceRefusesBeforeTheAgentCall`,
`TestAgentRoutingNilRowDivergesFromTheWebhookProjectionDeliberately` — 14 test
functions in the new file, all green on both engines.

## What a reviewer should look at first

1. **`sendAgentReply` and `agentSendMessageFn` — the order matters.** The gate is
   inside the exit; the test seam is strictly **below** it. That is what stops a
   test that counts sends from disarming the check it is measuring, and what stops
   ticket 19's fallback loop from walking around the gate by calling the seam.
2. **`agentSendRefusal` is `!= whatsmeow`, not `== meta_cloud`.** Fail-closed. A
   channel added to the closed list by a later ticket is refused here until
   someone teaches this function about it.
3. **`agentRoutingFromRecord`'s nil case deliberately differs** from
   `addWebhookAccountRouting`'s. Pinned by
   `TestAgentRoutingNilRowDivergesFromTheWebhookProjectionDeliberately`. They must
   not be unified — the webhook answer is a shipped payload contract.
4. **`agentSendTarget` is one value, not four fields.** This is the change that
   makes ticket 19 safe to write, and the reason the panel review was worth
   running before the code rather than after.
