---
ticket: z8pmx9kzca
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-27
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzca"
  github: ""
---

# Specification — 19 · Fail over by priority inside a single account

## Business goal

Ticket 18 taught the reply path which account the arrival device belongs to and
which channel it speaks, and put a mandatory transport gate at the send exit. It
shipped **no failover**: when the arrival device cannot send, the reply is simply
not sent.

This ticket adds the failover — and the four guards that make it safe rather than
harmful. The dangerous version of this feature is easy to write and hard to
notice: it retries a send that WhatsApp already accepted (the customer receives
the same answer twice, from two different numbers), it walks out of the account
and answers from a stranger's number, it re-reads the fleet on every green
message, and it writes `UPDATE devices` on every transient socket drop.

The deliverable is therefore not "a retry". It is a **pure ordering function**, a
**lazy** sibling read confined to the failure branch, an account boundary
enforced **in SQL**, and a switch rule that fires only on failures that happen
**before** anything was sent.

## User story

As **an operator whose first number got blocked**, I want **the reply to go out
from the next number in the same account**, so that **the customer still gets an
answer instead of silence — and never from a number belonging to someone else**.

## Functional requirements

- **REQ-1** An unexported pure function orders the send candidates: the arrival
  device first, then siblings of the same explicit account by ascending priority.
- **REQ-2** The account boundary is a SQL predicate on the sibling query, not a
  filter written in Go.
- **REQ-3** The sibling read is **lazy**: it is issued only when the arrival
  device cannot send, and only after the agent has answered.
- **REQ-4** Connectivity for sibling candidates is read from **one**
  `ListDevices()` snapshot, not from a per-candidate registry walk.
- **REQ-5** The §5.3 transport switch table decides which transitions are
  permitted, and is stated **once** in the tree so the send path and the operator
  surface cannot disagree about it.
- **REQ-6** A switch happens only on a **pre-send** failure. A failure that occurs
  while sending is logged and left alone.
- **REQ-7** Each delivery attempt gets its own timeout budget.
- **REQ-8** `send_state = 'blocked'` is written only after a repeat threshold on a
  **terminal** signal, and only when the stored value actually changes.
- **REQ-9** Every switch and every refusal is logged with a coded reason.
- **REQ-10** The operator-facing device list reports, per device, whether a reply
  arriving on a sibling may fail over to it — and the coded reason when it may
  not.

## Non-functional requirements

- **NFR-1** **The green path pays nothing.** A message answered by its arrival
  device performs **+0 device-row reads** and **+0 `ListDevices()` snapshots**
  against the ticket-18 baseline. Proven by counting, not by estimation.
- **NFR-2** **No duplicate reply is possible.** Per inbound message, at most one
  send can have been **accepted** by WhatsApp. A second attempt is issued only
  after a condition drawn from a closed allowlist that *proves* the first wrote
  nothing; every other failure — including an unrecognised one — ends the message.
- **NFR-3** **The account boundary survives a coding mistake.** A sibling of
  another account, or an implicit-account (`account_id = ''`) row, is not merely
  filtered out — it is never returned by the query.
- **NFR-4** **No write amplification.** A device failing repeatedly produces at
  most one `UPDATE devices` per state change, not one per failure.
- **NFR-5** **The ordering function is testable with no mocks** — no context, no
  I/O, no error return, no HTTP or database fixture.
- **NFR-6** **The operator surface does not promise more than the send path
  does.** The eligibility a device is shown with is computed by the same function
  the send path consults.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** `ui/rest/send.go` and `ui/mcp/send.go` are untouched — operator-
  initiated sending keeps using the explicit device.
- **CON-3** No Meta Cloud send implementation ships here. Every transition whose
  destination is `meta_cloud` is refused with a reason, not attempted.
- **CON-4** The device row read in `runAgentBridge` may be up to `AGENT_TIMEOUT`
  (90 s) stale when delivery starts. It is acceptable as a description of the
  **arrival** device (ticket 18, CON-4) and is **not** acceptable as the freshness
  source for a **selected** sibling — hence REQ-3's "after the agent response".
- **CON-5** There is today no API that can write `transport = 'meta_cloud'`, and
  no inbound event can originate on a Meta number. Every `meta → *` row of the
  switch table is therefore **unreachable in production until ticket 20**; it is
  specified and tested, not exercised.
- **CON-6** No load balancing. Priority exists for failure only.
- **CON-7** No new `domains/routing` package. Every `src/domains/*` package today
  is DTOs and interfaces with no algorithms.
- **CON-8** **The account boundary prevents accidents, not privilege escalation.**
  Basic auth here is a flat credential list with no per-credential scope, so any
  authenticated caller can attach any device to any account, and no detach
  endpoint exists. After this ticket that action reroutes live customer traffic.
  This grants **no new capability** — the same credential can already send from
  any device directly through `POST /send/message` with `X-Device-Id` — but it is
  stated because the user story's "never from a number belonging to someone else"
  means "never outside the `account_id` column", and that column is writable by
  anyone holding the shared credential. The mitigation available today is
  `PATCH /accounts/:account_id/devices/:device_id` with `send_state=blocked`,
  which removes a device from failover immediately.

## Acceptance criteria

### Ordering

- **AC-1** `buildAttemptOrder(arrival, siblings, customerHasPhone)` is an
  **unexported pure function** beside its single caller in `agent_bridge.go`: no
  context, no I/O, no error return, and no new `domains/routing` package.
- **AC-2** The arrival device is attempted first whenever it is usable, regardless
  of its numeric priority — including when its priority is the highest number in
  the account.
- **AC-3** Siblings are ordered by ascending `priority`, and equal priorities
  resolve deterministically by `device_id`.
- **AC-4** The returned order never exceeds **two** entries: the arrival device
  and at most one fallback.

### Account boundary

- **AC-5** The sibling query carries `account_id = ? AND account_id <> ''` in SQL.
  No Go-side guard performs that exclusion — removing the SQL predicate must break
  the isolation test.
- **AC-6** A device with `account_id = ''` produces **no siblings**, and is never
  returned as a sibling for anyone else.
- **AC-7** There is no fallback to another account and none to implicit-account
  rows. When no usable candidate remains, the path refuses explicitly with a
  recorded coded reason.

### Laziness and cost

- **AC-8** The sibling read executes **only** in the failure branch, and only
  after the agent response has arrived. On the green path the query count against
  the ticket-18 baseline is **+0**, measured through the same seams ticket 18
  counted with.
- **AC-9** Resolving the live session of K sibling candidates costs **at most one
  pass** over the device registry — never K passes each walking the device map
  twice under nested `RLock`s (which is what `getDeviceByJID` does). The primary
  path is a keyed lookup on `devices.device_id` (one map hash, one lock, no
  instance locks); a single memoised `ListDevices()` snapshot is the fallback for
  slots the registry holds under a JID key. The green path resolves no candidate
  at all and therefore builds no snapshot.

### Switch rules (§5.3)

- **AC-10** `whatsmeow → whatsmeow` is allowed unconditionally.
- **AC-11** `whatsmeow → meta_cloud` and `meta_cloud → meta_cloud` are refused
  with the coded reason `transport_refused` — not attempted and left to fail.
- **AC-12** `meta_cloud → whatsmeow` requires a genuinely known customer phone
  number **and** a connected whatsmeow session on the candidate. It is inert in
  production until ticket 20 (CON-5) and is specified and table-tested here.
- **AC-13** The switch table is written **once**. The operator-facing device list
  and the send path read the same function; a device the table forbids as a
  fallback destination is reported as not allowed **with its coded reason** rather
  than presented as a working fallback that fails on the first real message. The
  reported field names the **policy** half explicitly (`fallback_allowed`), since
  the send path additionally requires `send_state != 'blocked'` and a live
  session — both already reported elsewhere in the API. A field named for
  eligibility would promise a working fallback for a merely disconnected device,
  which is the thing this criterion forbids.
- **AC-13a** **A fallback must be addressable by a device other than the arrival
  one.** An inbound sender may be a `@lid` identity, and a LID resolves only
  inside the LID map of the device that saw it. When the sender did not resolve to
  a phone-number JID, **no** fallback is selected and the path refuses with the
  coded reason `customer_unreachable` — a sibling that cannot address the customer
  would at best fail and at worst reach someone else.

### The duplicate-reply rule

- **AC-14** A switch happens **only** on a condition drawn from a closed allowlist,
  every member of which *proves* nothing was written to the socket: the row says
  `blocked`; the transport transition is refused by the table; the client reports
  not-connected **at the send instant**; or the whatsmeow call returned one of the
  errors it produces before touching the frame (`ErrClientIsNil`,
  `ErrNotLoggedIn`).
- **AC-15** Every other failure — timeout, connection drop, a server error, a
  cancelled context, **and any error the classifier does not recognise** — is
  logged and produces **no** switch and **no** second send. `ErrNotConnected` is
  explicitly on this side: whatsmeow returns that same sentinel both before the
  frame is written and from the post-send reconnect retry, so it cannot prove the
  message was not already accepted.
- **AC-16** Each attempt receives its own `agentDeliveryTimeout` budget, not a
  share of one shared deadline.

### Marking

- **AC-17** `send_state = 'blocked'` is written only after a repeat threshold of
  **terminal** send failures on the same device **within a bounded time window**,
  and only when the stored value actually changes — no `UPDATE devices` per
  failure. The change-only guarantee is a **SQL predicate**, so it survives a
  restart and a second process; an in-process latch cannot provide it. The write
  is audit-logged with the same weight as the operator's own `send_state` write.
- **AC-18** A transient failure — socket drop, timeout, context cancellation, **or
  any error the classifier does not recognise** — is never written to the
  database; the device is skipped for that attempt only. Unknown is transient by
  default, deliberately the opposite default from the transport gate: refusing to
  send is inaction, while marking takes a working number out of service and is
  never lifted automatically.
- **AC-19** Meta `131047` (closed 24-hour window) and `131026` (ineligible
  recipient) never mark a device: the number is fine, the conversation or the
  destination is not. Satisfied **by construction** rather than by a branch — no
  Meta send path exists (CON-5), and AC-18's transient-by-default classifier makes
  any unrecognised code non-marking. Carried forward as a named requirement on
  ticket 20's terminal list.
- **AC-20** Every switch and every no-candidate refusal is logged with a coded
  reason drawn from a closed vocabulary (`arrival_blocked`,
  `arrival_disconnected`, `transport_refused`, `customer_unreachable`), so "why
  did the reply come from this number?" — and "why did it not go out at all?" —
  each have a one-line answer. The lines are **deduped per device**: the trigger
  is external (anyone who messages the number) and the permanent reasons would
  otherwise let a stranger set this process's log volume.

### Load balancing

- **AC-21** There is none. No round-robin, no rotation, no distribution: the
  arrival device is used whenever it is usable.

### Optional index

- **AC-22** `idx_devices_account_priority` (M-i) ships **only if** justified. The
  decision is recorded with its reasoning either way; a migration that is not
  justified is not appended.

## Test cases

| ID | Given | When | Then |
|----|-------|------|------|
| TC-1 | An arrival candidate and siblings with mixed priorities, blocked flags and connection states | `buildAttemptOrder` is called (table test, no mocks) | The arrival is first in every usable case, even at the highest priority number; blocked and disconnected candidates are excluded; the result never exceeds two entries; the test compiles and runs with no HTTP or database fixture |
| TC-2 | `D1` marked `blocked`, sibling `D2` connected in the same account | A message arrives on `D1` | The reply goes out from `D2`, and the log carries reason `arrival_blocked` |
| TC-3 | Several devices, all with `account_id = ''` | The arrival device is blocked | No sibling is selected, the send is refused explicitly, and the **SQL predicate** is what excluded them — proven by executing the real query against a real database |
| TC-4 | `D1` in `acc_alpha` blocked, and a connected device in `acc_beta` | The fallback is built | The `acc_beta` device is never a candidate — the query does not return it |
| TC-5 | The first attempt fails *after* the whatsmeow call was made — `ErrMessageTimedOut`, `ErrNotConnected`, a server error, an unrecognised error | The delivery path handles that failure | No switch occurs, no second send is issued, and the failure is logged. Table-driven over the whole outcome classification |
| TC-6 | A delivery function driven with a two-entry order whose first entry is refused pre-send after consuming its deadline | The switch occurs | The second attempt runs with a fresh full budget, not the remainder. Unit-tested on the delivery function: every pre-send refusal is an in-memory check performing no I/O, so this is a **structural** guarantee, not an observed production timing |
| TC-6a | An inbound sender that did not resolve to a phone-number JID, with a usable sibling available | The arrival is refused pre-send | No fallback is selected; the reason recorded is `customer_unreachable` |
| TC-7 | A whatsmeow arrival whose only sibling is a `meta_cloud` device | The fallback is built | The candidate is refused with reason `transport_refused` and no send is attempted on it |
| TC-8 | A device that fails terminally repeatedly, then whose flag is cleared | The threshold is crossed and later the value is already `blocked` | `UPDATE devices` was issued only on the actual value change; `131047` and `131026` produced no marking at all; a transient error produced no marking |
| TC-9 | A usable arrival device | The reply is delivered | Neither the sibling read nor the candidate-resolution seam is called even once, and device-row reads equal the measured ticket-18 baseline exactly |
| TC-10 | An account holding a `meta_cloud` device and a `whatsmeow` device | The account's device list is rendered | Each reports `fallback_allowed`, and the refused one carries the same `transport_refused` token the send path records — both read from one function |
| TC-11 | A sibling row whose `jid`/`ad_jid` is blank, or whose live session's `Store.ID` disagrees with the row | The fallback is resolved | The candidate is refused rather than matched to an unrelated instance — an empty key never joins a row to a session |

## Out of scope

- Any Meta Cloud send implementation, any inbound Meta event — ticket 20.
- Country-based routing and the extended fallback matrix (out of the scope
  document by design).
- Load balancing, rotation, or any use of priority outside failure.
- `ui/rest/send.go`, `ui/mcp/send.go`, and every operator-initiated send path.
- Automatic clearing of `send_state = 'blocked'`: it is lifted by the operator
  through the existing `PATCH /accounts/:account_id/devices/:device_id`.
- Marking a device blocked from any path other than the agent reply path.
