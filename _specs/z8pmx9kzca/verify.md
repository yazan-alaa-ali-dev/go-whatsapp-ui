---
ticket: z8pmx9kzca
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-27
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzca"
  github: ""
---

# Verification — 19 · Fail over by priority inside a single account

**Outcome: PASSED.** All 24 acceptance criteria mapped to a result.

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are absent from the diff, and no migration
was appended to `getMigrations()` (AC-22).

The behavioural surface that *does* change:

- **The green path is unchanged.** A message answered by its own device runs the
  same code it did under ticket 18, addresses the customer with the same raw
  sender JID, and performs the same number of device-row reads.
- **A previously-silent failure can now produce a reply.** Where ticket 18 stopped
  after the arrival device, an arrival that is `blocked`, has no live session, or
  has no session-holding store may now be replaced by one sibling **of the same
  explicit account**. Every deployment today has `account_id = ''` on every row, so
  no sibling exists anywhere until an operator creates an account and attaches
  devices — the change is inert until then, by construction.
- **A device can now be marked `blocked` automatically.** Three terminal failures
  within 15 minutes on an accounted device. It is never lifted automatically; the
  existing `PATCH /accounts/:account_id/devices/:device_id` is the way back.
- **Four API responses gain two additive fields** (`fallback_allowed`,
  `fallback_reason`): the device list, `AttachDevice`, `SetDeviceOrder` and
  `SetDeviceSendState`.

## Commands run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME/Zip` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure |

Both engines ran the whole suite, and the outcome is identical on both. This
matters more than it did last ticket: ticket 18 touched no SQL, whereas this one
adds two statements, so the `?`-rebinding handle had to be shown working on both
dialects rather than assumed. A throwaway `postgres:16-alpine` container served the
run and was removed afterwards.

### Pre-existing failure

`TestResolveDocumentMIME/Zip` was **measured** failing on the unmodified tree —
the working tree was stashed, the test run alone, the stash restored — reporting
`application/x-zip-compressed` against an expected `application/zip`. It is the
Windows registry's MIME mapping, concerns document sending, and is untouched by
this diff. Ticket 18 recorded the same failure on the same host.

### `-race` could not be run, and it matters more here

`-race` needs cgo and this host has no C toolchain, which is also why the suite
runs under `-tags purego`. Unlike ticket 18 — which could truthfully say it
introduced no new shared mutable state — **this change does**: `agentSendFailures`,
a `sync.Map` reached by up to `agentMaxInFlight` (32) detached goroutines. It is
recorded as a genuine gap rather than waved past. What stands in for the detector:
the map is a `sync.Map`, its values are `*agentFailureCounter`, and every
read-modify-write of a counter's fields happens inside that counter's own mutex,
with the decision to write extracted under the same lock so two goroutines crossing
the threshold together cannot both issue an `UPDATE`. Beyond that, the SQL predicate
`send_state <> 'blocked'` makes a double write harmless even if one occurred.

## Mutation checks — the guards are not decorative

Most of what this ticket adds is a *refusal*, and refusals pass tests by doing
nothing. Several of the rules are also unreachable in production today (no API
writes `transport = 'meta_cloud'`; no inbound event originates on a Meta number).
So each load-bearing guard was broken deliberately:

| Mutation | Result |
|---|---|
| Switch on `agentFailedSending` | `TestFailoverNeverSwitchesAfterASend` fails on **all five** error kinds |
| Hoist one shared `context.WithTimeout` above both attempts | `TestEachAttemptGetsItsOwnBudget` fails: "the second attempt started with 48.6911ms of a 200ms budget" |
| Delete `AND account_id <> ''` from the sibling statement | `TestListAccountSiblingDevicesExcludesImplicitAccountRows` fails: "a blank account id matched 2 devices" |

**The second mutation survived the first version of its test**, which is recorded
in `implement.md` as deviation D-1 rather than quietly fixed. The original test
asserted a proxy that a shared deadline satisfies just as well; the guarantee was
only real once the budget was made adjustable and an attempt actually consumed
time.

## Acceptance criteria

### Ordering

| AC | Result | Evidence |
|---|---|---|
| AC-1 | **PASS** | `buildAttemptOrder` is unexported, in `agent_reply_order.go` beside its caller. No context, no I/O, no error return. `agent_reply_order_test.go` imports only `testing` and `validations` — no HTTP server, no database, no device manager, no `context`. No `domains/routing` package exists |
| AC-2 | **PASS** | `TestBuildAttemptOrder/the_arrival_is_first_even_at_the_highest_priority_number` — arrival at priority 9000 ahead of a sibling at 1 |
| AC-3 | **PASS** | `…/siblings_are_ordered_by_ascending_priority` and `…/equal_priorities_resolve_deterministically_by_device_id`; `TestListAccountSiblingDevicesOrdersByPriority` proves the same ordering in SQL |
| AC-4 | **PASS** | `…/the_order_never_exceeds_two_entries` (four eligible siblings → two entries), plus a length assertion applied to **every** case in the table |

### Account boundary

| AC | Result | Evidence |
|---|---|---|
| AC-5 | **PASS** | The predicate is in `listAccountSiblingDevices`. Proved by the **mutation**, not merely by a passing test: deleting it fails `TestListAccountSiblingDevicesExcludesImplicitAccountRows` |
| AC-6 | **PASS** | Same test — three `account_id = ''` devices yield zero siblings. `TestNoSiblingReadWithoutAnExplicitAccount` shows the reply path does not even issue the query for such a device |
| AC-7 | **PASS** | `TestBuildAttemptOrder/nothing_usable_yields_an_empty_order`; `logAgentNoCandidate` records the coded reason; `TestNoSiblingReadWithoutAnExplicitAccount` and `TestListAccountSiblingDevicesNeverCrossesAnAccount` show no cross-account and no implicit-account fallback |

### Laziness and cost

| AC | Result | Evidence |
|---|---|---|
| AC-8 | **PASS** | `TestGreenPathReadsNoSiblings` — the sibling read runs **0** times and the registry is consulted **0** times when the arrival device delivers. The device-row baseline (1 / 1 / 2) is re-asserted unchanged by `TestReplyPathDeviceRowReadsMatchBaseline`. `TestFailoverNeverSwitchesAfterASend` additionally shows 0 sibling reads after a send failure |
| AC-9 | **PASS**, with the design changed from the ticket's literal wording — see below |

### Switch rules

| AC | Result | Evidence |
|---|---|---|
| AC-10 | **PASS** | `TestTransportSwitchAllowedIsTheWholeTable/whatsmeow_to_whatsmeow`, and `…/an_empty_transport_reads_as_whatsmeow_on_both_sides` |
| AC-11 | **PASS** | `…/whatsmeow_to_meta_cloud` and `…/meta_cloud_to_meta_cloud` both refuse with `transport_refused`; `TestMetaSiblingIsRefusedNotAttempted` shows zero delivery attempts — refused, not attempted and left to fail |
| AC-12 | **PASS** | `…/meta_cloud_to_whatsmeow_with_a_known_number` (allowed) and `…/with_no_known_number` (refused); `TestBuildAttemptOrder/meta_to_whatsmeow_is_allowed_when_the_customer's_number_is_known`. Inert in production per CON-5 |
| AC-13 | **PASS** | `TestDevicesOfAccountReportsFallbackPolicy` over four devices; `TestFallbackReasonMatchesTheSendPathToken` pins that the reported token is the send path's. The field is named `fallback_allowed` — the policy half — for the reason the criterion gives |
| AC-13a | **PASS** | `TestNoFallbackWhenTheCustomerHasNoDialableNumber` (zero attempts, `customer_unreachable` recorded) and `TestFallbackAddressesTheResolvedNumber` (the arrival keeps the raw sender; the fallback gets the resolved number) |

### The duplicate-reply rule

| AC | Result | Evidence |
|---|---|---|
| AC-14 | **PASS** | `TestFailoverSwitchesOnlyOnAProvedPreSendRefusal`; `TestBlockedArrivalFallsBackToASibling`; `TestClassifyAgentSendError` pins the allowlist |
| AC-15 | **PASS** | `TestFailoverNeverSwitchesAfterASend` across `ErrMessageTimedOut`, `ErrNotConnected`, `ErrServerReturnedError`, `context.DeadlineExceeded` **and an error the code has never seen** — exactly one delivery attempt in each case. Mutation-verified |
| AC-16 | **PASS** | `TestEachAttemptGetsItsOwnBudget`, mutation-verified after the first version of it was found not to be (D-1) |

### Marking

| AC | Result | Evidence |
|---|---|---|
| AC-17 | **PASS** | `TestMarkingRequiresRepeatedTerminalFailures` (no write before the threshold, exactly one at it); `TestMarkAccountDeviceBlockedIsChangeOnly` proves the change-only guarantee is a SQL predicate — a second mark reports no change and writes nothing; the audit line is emitted at the marking site with actor `agent_bridge` |
| AC-18 | **PASS** | `TestTransientFailuresNeverMark` over six error kinds including two unrecognised ones — zero writes after nine consecutive failures each; `TestARecoveryResetsTheFailureCount`; `TestARecoveredSessionIsNotMarked` |
| AC-19 | **PASS by construction** — see below |
| AC-20 | **PASS** | `TestBlockedArrivalFallsBackToASibling` asserts `arrival_blocked` reaches the log; `TestNoFallbackWhenTheCustomerHasNoDialableNumber` asserts `customer_unreachable`; ticket 18's `TestAgentReplyRefusalIsRecorded`, moved to the layer that now records, still asserts one warn line per device across five messages with every refusal visible at debug |

### Load balancing / index

| AC | Result | Evidence |
|---|---|---|
| AC-21 | **PASS** | There is no rotation in the tree. `buildAttemptOrder` returns the arrival whenever it is usable and otherwise the *first* eligible sibling in a deterministic order; `TestBuildAttemptOrder/equal_priorities_resolve_deterministically_by_device_id` pins that repeated failures answer from the same number |
| AC-22 | **PASS** | Not shipped, with the reasoning recorded — see below |

## The three criteria that need more than a row

### AC-9 — one pass, but not the pass the ticket named

The ticket asked for connectivity to come from "one `ListDevices()` snapshot". The
implementation does something **cheaper** that satisfies the same requirement, and
the difference is recorded rather than glossed:

The requirement's substance is "not K passes with nested locks" — `getDeviceByJID`
walks the device map twice and takes an `RLock` per instance through
`ADJID()`/`JID()`, so K candidates cost O(K·N). A full snapshot fixes that but is
not free: it takes `1 + 2N` locks, a sort and two allocations *before the first
candidate is examined*. An account holds a handful of devices and only the first
eligible sibling is ever used, so at realistic K the snapshot is the more expensive
of the two.

`agentDeviceLookup` therefore tries `manager.GetDevice(record.DeviceID)` first —
one map hash under one `RLock`, no instance locks, no allocation, correct because
`AddDevice` persists `instance.ID()` as `devices.device_id` — and builds **one**
memoised snapshot only for rows that key misses. Never K passes, and usually no
pass at all.

`TestGreenPathReadsNoSiblings` shows the green path resolves nothing.
`TestSnapshotSkipsEmptyIdentities` and `TestCandidateLookupFailsClosedWithoutARegistry`
cover the two ways the fallback path can go wrong.

### AC-19 — satisfied by construction, and nothing was shipped for it

Meta `131047` (closed 24-hour window) and `131026` (ineligible recipient) must
never mark a device. **No code was written for this**, deliberately:

- there is no Meta send path in the tree, so no error can carry either code;
- and `agentSendFailureIsTerminal` is an **allowlist** — `ErrNotLoggedIn` and
  `ErrClientIsNil` only — so anything unrecognised is transient and marks nothing.

A predicate with no caller would have been a guess at a shape ticket 20 will
define, while creating the impression the rule is enforced today. What is asserted
instead is the behaviour: `TestTransientFailuresNeverMark` includes two errors
carrying those codes in their text and shows nine consecutive failures produce zero
writes. **Carried forward as a named requirement on ticket 20**: when the Meta
error type exists, neither code may enter the terminal list.

### AC-22 — the index is not shipped, and cardinality is why

`idx_devices_account_priority` ships "only if justified". It is not:

- `devices` holds one row per WhatsApp slot — tens — so both SQLite and PostgreSQL
  choose a sequential scan at this cardinality, and `ORDER BY priority, device_id`
  needs a sort either way;
- **every row today carries `account_id = ''`**, which the predicate excludes, so
  the index would have near-zero selectivity on the only value present;
- verified against the schema: `devices` carries `idx_devices_created_at`,
  `idx_devices_jid`, `idx_devices_ad_jid` and `idx_devices_meta_pni`, and **no**
  index on `account_id`;
- and `TestAccountSchemaDefersLaterTicketMigrations` **already fails** if it is
  appended — the enforcement predates this decision.

The laziness argument is deliberately *not* used: a correlated outage puts every
in-flight message into the failure branch at once, so that branch is bursty rather
than cold. Cardinality carries the decision on its own. The migration list is
append-only, so an index added now could never be removed; it belongs to the ticket
that first observes a real account population.

## Traceability

| Test case | Where | Result |
|---|---|---|
| TC-1 | `TestBuildAttemptOrder` (13 cases), `TestArrivalSkipReasonPrecedence`, `TestFallbackSkipReasonIsCoded`, `TestBuildAttemptOrderDoesNotMutateItsInput` | PASS |
| TC-2 | `TestBlockedArrivalFallsBackToASibling` | PASS |
| TC-3 | `TestListAccountSiblingDevicesExcludesImplicitAccountRows` (white-box, real database, mutation-verified) | PASS |
| TC-4 | `TestListAccountSiblingDevicesNeverCrossesAnAccount` | PASS |
| TC-5 | `TestFailoverNeverSwitchesAfterASend` (5 error kinds) | PASS |
| TC-6 | `TestEachAttemptGetsItsOwnBudget` | PASS |
| TC-6a | `TestNoFallbackWhenTheCustomerHasNoDialableNumber` | PASS |
| TC-7 | `TestMetaSiblingIsRefusedNotAttempted` | PASS |
| TC-8 | `TestMarkingRequiresRepeatedTerminalFailures`, `TestTransientFailuresNeverMark`, `TestARecoveryResetsTheFailureCount`, `TestARecoveredSessionIsNotMarked`, `TestADeviceWithNoAccountIsNotMarked`, `TestMarkAccountDeviceBlockedIsChangeOnly` | PASS |
| TC-9 | `TestGreenPathReadsNoSiblings` | PASS |
| TC-10 | `TestDevicesOfAccountReportsFallbackPolicy`, `TestFallbackReasonMatchesTheSendPathToken` | PASS |
| TC-11 | `TestSnapshotSkipsEmptyIdentities`, `TestCandidateLookupFailsClosedWithoutARegistry` | PASS |

TC-3's original wording asked for "the SQL predicate is what excluded them". That is
only checkable past the Go guard, so it is a white-box test on the unexported
statement — the plan's reasoning, and the reason the Go guard was **kept** rather
than deleted to make the test meaningful.

## What a reviewer should look at first

1. **`classifyAgentSendError` and the `agentAttemptOutcome` comments.** This is the
   ticket. The plan's first revision was built on "`ErrNotConnected` proves nothing
   was sent", which is false — whatsmeow returns that sentinel both before the
   frame is written and from the post-send reconnect retry (`send.go:442` →
   `request.go:208`). The rule is now an allowlist with unknown on the no-switch
   side.
2. **The liveness read's position.** It is inside `sendAgentReply`, at the send
   instant — not where the device row was read, which is up to 90 seconds earlier
   and inside a window where auto-reconnect makes the socket legitimately flap.
3. **`deliverAgentReplyArgs`.** Three things that must not swap together, and the
   comments saying why: the sending device, the storing device, and the customer's
   address.
4. **`markAgentSendFailure`.** Four guards on the only destructive action this path
   can take, on an externally triggered path.
