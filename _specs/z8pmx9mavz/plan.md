---
ticket: z8pmx9mavz
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mavz"
  github: ""
---

# Plan — 27 · Disable a device's webhook without deleting it — revision 2

> Revision 1 was reviewed against the source by the advisory panel (senior /
> security / performance) before any code was written. **26 findings, 5 major.**
> This revision adopts 15, declines 3 with reasons, and corrects 4 factual errors
> — three of revision 1's own and one of the panel's. See **Panel response**.

## Approach

One boolean column, read at the two places the device row is **already** loaded,
written by one new route.

The shape of the existing code makes this unusually small, and the plan leans on
that rather than building anything new:

- **There is exactly one webhook decision function.** All thirteen event
  families — message, receipt, call, presence, delete, group ×2, label,
  newsletter ×4 — funnel through `forwardPayloadToConfiguredWebhooks`
  (`webhook_forward.go:100`). One gate there covers every event, and there is no
  second path to forget. `forwardToWebhooks` is called from exactly one place
  (`:157`), under `if webhookAllowed`, so clearing that one flag is the complete
  and only edit needed to stop delivery — including the global fallback at `:136`,
  which sits inside the same branch.
- **Both gate sites already hold the row.** `forwardPayloadToConfiguredWebhooks`
  resolves `deviceRecord` at line 108; `runAgentBridge` resolves the *same* row
  through the *same* helper at `agent_bridge.go:635`, with a comment recording
  that it deliberately adds no read. Reading one more field off a struct that is
  already in hand costs nothing, and NFR-1 is satisfied by construction.
- **There is one shared column tail.** `deviceRoutingColumns`
  (`sqlite_repository.go:1495`) plus `scanDeviceRoutingTargets` is used by five
  read paths. Its own doc comment says it exists so that "a column added by a
  migration stays invisible … until each of these lists is extended" cannot
  happen. Adding the column there gives all five paths the value in one edit.

## Decisions

**D-1 — The field is `*bool`, not `bool`. This is the revision's central change.**

Revision 1 put `WebhookEnabled bool` on `DeviceRecord`. Go's zero value for a
`bool` is `false`, and for a field with that name `false` means **disabled** — so
every `DeviceRecord` built in Go without touching the field describes a silenced
device. The repository holds **97 such literals across 18 test files**; two lenses
found the consequence independently (the performance lens through
`TestWebhookForwardStorageCallCountIsUnchanged`, whose second subtest indexes
`h.delivered[0]` and would panic on an empty slice; the senior lens by
enumerating six more test files revision 1 had not listed). Revision 1's own claim
that "existing suites pass unedited" was therefore false, and its Files-to-change
list was incomplete — which under IM-4 makes the missing files scope creep
discovered mid-implement.

The fix is not to edit 97 fixtures. It is to choose a representation whose zero
value is the **safe** answer:

```go
// WebhookEnabled is a POINTER, and the nil case is the whole reason.
//
// nil means "this record was not loaded with the column" — a DeviceRecord built
// in Go rather than read from a SELECT that carries it. That reads as ENABLED,
// because the alternative is that every struct literal in the codebase describes
// a silenced device: a plain bool would make `false` — the zero value — mean
// "webhook off", so forgetting the field anywhere silences a tenant.
//
// Non-nil is an answer the database actually gave. The column is NOT NULL
// DEFAULT TRUE, so SQL never produces nil; only Go does.
WebhookEnabled *bool `db:"webhook_enabled"`
```

Two candidates were rejected. A plain `bool` is the defect above. An inverted
`WebhookDisabled bool` (zero value = enabled) also fixes the churn, but makes the
Go field the **negation** of the SQL column, so the next person who writes
`SELECT webhook_enabled` and scans it into `WebhookDisabled` inverts the whole
feature silently — a worse trap than the one it fixes. The pointer keeps the field
and the column meaning the same thing.

Every consumer goes through one helper, so no call site does the three-way check
by hand:

```go
// deviceWebhookEnabled answers "may automation run for this device's arrivals?"
// A NIL RECORD IS ENABLED, and so is a record whose flag was never loaded.
// Only a row that positively says false silences anything (spec NFR-2, AC-20).
func deviceWebhookEnabled(record *domainChatStorage.DeviceRecord) bool {
	return record == nil || record.WebhookEnabled == nil || *record.WebhookEnabled
}
```

**D-2 — The flag does not go on `DeviceWebhookConfig` at all.** Revision 1 added
it as a "read-only projection". Both the security and the senior lens pointed out
that the struct has **two** constructors — `GetDeviceWebhookConfig`
(`sqlite_repository.go:1719`) and `webhookConfigFromRecord`
(`webhook_forward.go:193`) — and only one of them would populate it, so
`cfg.WebhookEnabled` would read `false` for an enabled device: C-6 reintroduced
one struct away from the gate.

Keeping it off the type is also the more honest model. The whole premise of the
ticket is that **disabling is not configuration** — that is the difference between
this route and the deletion. So the flag gets its own repository and usecase
method, `GetDeviceWebhookEnabled` / `SetDeviceWebhookEnabled`, and
`SetDeviceWebhookConfig` becomes **structurally incapable** of writing it rather
than merely disciplined not to. The GET handler pays a second read on a cold
admin endpoint; that is the correct place to spend one.

**D-3 — `PATCH /devices/:device_id/webhook/enabled`, a sub-resource.** It keeps
the settings route and the switch textually separate, which is the ticket's whole
point ("the `webhook_url` is not sent … that is the essential difference from the
deletion"). A `?enabled=` query parameter on the existing route was rejected: it
would make the two operations share a handler and a permission check, and the
first refactor that forgets the branch re-introduces the deletion.

**D-4 — `enabled` is bound as `*bool`.** With a plain `bool`, an absent field and
an explicit `false` are the same value and AC-8 becomes untestable. With `*bool`,
absence is `nil` and is refused; `"yes"` and `1` fail the JSON unmarshal and are
refused by the bind-error branch.

**D-5 — The gate is per event, not cached.** The row is already read per event.
A cache would break AC-19 ("the first inbound event after the write") and add a
staleness surface for no measured problem. A cached flag on `DeviceInstance`
refreshed by the writer — the shape `SetDeviceAccount` uses — was considered and
rejected as a second copy of state bought for a saving that does not exist, since
the read it would avoid is already being paid.

**D-6 — Sibling failover is not gated.** Ticket 19 lets an enabled device's reply
go out through a sibling when the arrival device cannot send. The flag answers "do
this device's arrivals drive automation", not "may this device carry a reply". A
customer who wrote to an *enabled* device is entitled to the answer; which SIM it
leaves from is a routing question the admin did not touch.

**D-7 — Chatwoot is untouched.** `chatwootAllowed` is computed independently at
`webhook_forward.go:119` and the gate does not modify it. Chatwoot has its own
per-device configuration and its own enable.

**D-8 — The audit actor is `auditActor(c)`**, the same helper the account surface
uses (`ui/rest/account.go:122`). It yields the principal's user id, falling back
to the username. The ticket says "username"; using the *same* identity the
existing `[ACCOUNTS]` lines carry is worth more than the literal wording, because
it is what makes the two sets of lines correlate for one operator.

**D-9 — Broadcast on every successful write, not only on a change,** and reuse
`DEVICE_WEBHOOK_CONFIG_UPDATED` rather than minting a code. Detecting "a change"
needs a read-before-write that NFR-1 exists to avoid, and the sibling
`PATCH .../webhook` already broadcasts unconditionally. **Stated deliberately
rather than inherited** (senior lens): an existing consumer cannot tell a settings
change from a toggle by the code alone — it must read the new `webhook_enabled`
key, which is additive and safe. A distinct code was rejected as a wire-format
addition for a distinction no consumer has asked for.

**D-10 — Two log lines, at two levels.** A `debug` line per skipped event (AC-22,
and the house style at `webhook_forward.go:122`), **plus** one throttled `warn`
per device per hour, on the first skip. The security lens flagged the
silent-outage vector: the flag survives restarts, there is no UI, and `debug` is
below the default level, so an accidental disable is indistinguishable from a
broken integration. The warn also matches the ticket's own wording — "when the
**first** event is skipped … a line records the reason". It reuses the existing
`shouldWarnUnresolvedDevice` TTL-cache shape in the same file
(`webhook_forward.go:410-430`), so it is a copy of a local pattern, not a new one.

## Steps

### Step 1 — Migration 75 (storage)

`src/infrastructure/chatstorage/sqlite_repository.go`

Append after the migration-74 element (currently ending at line 3854), inside
`getMigrations()`, one statement with a comment in the house style. The comment
names the **slug**, not "ticket 27" — migration 74 already carries "(ticket 27)"
for the tenant-isolation ticket, and a second one would make the list ambiguous:

```go
// _____________________________________________________________________
// Migration 75 (z8pmx9mavz): the per-device webhook switch.
//
// DEFAULT TRUE and NOT NULL, so every row that exists is enabled without a
// backfill UPDATE and an upgraded deployment behaves bit-identically ...
`ALTER TABLE devices ADD COLUMN webhook_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
```

One statement, no `UPDATE`, no `BLOB`, no `AUTOINCREMENT` — satisfies the
invariants at `sqlite_repository_account_test.go:62-87`. `NOT NULL` with a default
matches `deviceRoutingColumns`' stated precondition ("every column is NOT NULL
with a default, so none needs a COALESCE").

Then move the count from 74 to 75 in the four tests that pin it. Each site needs
**three** edits, not one — the comparison, the count inside its `t.Fatalf` string,
and the surrounding comment:

| File | Sites |
|------|-------|
| `sqlite_repository_account_test.go` | `:30` comparison, `:31` message |
| `user_repository_test.go` | `:37` comparison, `:38` message |
| `user_admin_repository_test.go` | `:928` comparison, `:920-926` comment |
| `sqlite_repository_debug_test.go` | `:582` comparison, `:583` message |

### Step 2 — The column on every read path (storage)

`src/infrastructure/chatstorage/sqlite_repository.go`

- Extend `deviceRoutingColumns` (`:1495`) with `, webhook_enabled`.
- Extend `scanDeviceRoutingTargets` (`:1500`) with `&rec.WebhookEnabled`, in the
  same position.

`ListDeviceRecords` (`:1515`), `GetDeviceRecord` (`:1558`),
`GetDeviceRecordByJID` (`:1583`) and both listings in `account_repository.go`
(`:234`, `:408`) all interpolate the constant and all use the scan helper, so all
five gain the column together. Update the constant's doc comment: the tail is no
longer routing-only.

### Step 3 — The write and the read (storage + interface + wrapper)

- `src/domains/chatstorage/chatstorage.go` — add
  `WebhookEnabled *bool \`db:"webhook_enabled"\`` to `DeviceRecord`, carrying the
  D-1 comment. **`DeviceWebhookConfig` is not touched** (D-2).
- `src/domains/chatstorage/interfaces.go` — declare
  `SetDeviceWebhookEnabled(deviceID string, enabled bool) error` and
  `GetDeviceWebhookEnabled(deviceID string) (bool, error)`.
- `src/infrastructure/chatstorage/sqlite_repository.go` — implement both.
  The write is
  `UPDATE devices SET webhook_enabled = ?, updated_at = ? WHERE device_id = ?`,
  0 rows → `sql.ErrNoRows`, mirroring `SetDeviceWebhookConfig` (`:1686`). The
  read is `SELECT webhook_enabled FROM devices WHERE device_id = ? LIMIT 1`,
  returning **`true`** for `sql.ErrNoRows` so a missing row reads as enabled
  (AC-10). `SetDeviceWebhookConfig`'s UPDATE column list is left exactly as it is
  — that is what makes AC-5 structural.
- `src/infrastructure/whatsapp/chatstorage_wrapper.go` — add both delegating
  methods beside the other webhook delegations (`:501-521`). **C-3**: omitting one
  is a build break, which is the point.

### Step 4 — The usecase

`src/usecase/device.go`, `src/domains/device/interfaces.go`

Add `SetDeviceWebhookEnabled(ctx, deviceID string, enabled bool) error` and
`GetDeviceWebhookEnabled(ctx, deviceID string) (bool, error)`, modelled on
`SetDeviceWebhookConfig` (`:458-487`): nil-manager guard,
`GetDevice(deviceID)` → `pkgError.ErrDeviceNotFound`, nil-storage guard — so the
404 path is the same one AC-13 relies on. Then the write, then:

```go
logrus.Infof("[ACCOUNTS] actor=%q set device=%q webhook_enabled=%t",
	accountActorFromContext(ctx), deviceID, enabled)
```

matching `account.go:485`'s `set device=… send_state=…` line, and the broadcast:
`DEVICE_WEBHOOK_CONFIG_UPDATED`, `AccountID: s.accountOf(deviceID)`,
`Result: {"device_id": …, "webhook_enabled": …}`.

### Step 5 — The REST surface

`src/ui/rest/device.go`

- Route line, in the guard order C-5 requires:
  ```go
  app.Patch("/devices/:device_id/webhook/enabled",
      middleware.Require(pkgAuth.PermDevicesWebhookWrite), owns, rest.UpdateDeviceWebhookEnabled)
  ```
- Handler `UpdateDeviceWebhookEnabled`: bind
  `struct{ Enabled *bool \`json:"enabled"\` }`; bind error → 400 `BAD_REQUEST`
  "Invalid request body"; `Enabled == nil` → 400 `BAD_REQUEST` "enabled is
  required and must be a boolean". Both refusals precede the service call (AC-8).
  Then `usecase.ContextWithAccountActor(c.Context(), auditActor(c))` (D-8), the
  service call, `utils.PanicIfNeeded(err)`, and 200 with **exactly**
  `{"device_id", "webhook_enabled"}` — no `DeviceWebhookConfig` is marshalled and
  no secret is echoed.
- `GetDeviceWebhook`: call `GetDeviceWebhookEnabled` and add `webhook_enabled` to
  the results map. Note the neighbouring fields default to `""`/`false` when the
  config is nil; this one defaults to **`true`**, and that asymmetry is the point
  (AC-10).

### Step 6 — The two gates

`src/infrastructure/whatsapp/webhook_forward.go`

Add `deviceWebhookEnabled` (D-1) and a `shouldWarnDisabledWebhook` TTL cache in
the shape of `shouldWarnUnresolvedDevice` (`:410-430`), then in
`forwardPayloadToConfiguredWebhooks`, immediately after the projection is taken
(`:115`):

```go
webhookAllowed := isEventWhitelistedForDevice(eventName, webhookConfig) &&
	!shouldIgnoreWebhookJID(payload)

if webhookAllowed && !deviceWebhookEnabled(deviceRecord) {
	webhookAllowed = false
	logrus.Debugf("Webhook route for %s: the device's webhook is disabled; %s is not delivered, and the global WHATSAPP_WEBHOOK list is NOT a fallback", deviceJID, eventName)
	if shouldWarnDisabledWebhook(deviceJID) {
		logrus.Warnf("Webhook route for %s: the device's webhook is DISABLED; events are being dropped deliberately until it is re-enabled", deviceJID)
	}
}
```

`webhookAllowed = false` is sufficient **and complete**: `webhookURLs` and
`webhookConfig` are consumed only by `forwardToWebhooks` at `:157`, which is
called only under `if webhookAllowed`, and the global fallback at `:136` sits
inside that same branch. Revision 1 additionally set `webhookConfig = nil`; the
senior lens showed it is dead, so it is dropped — one less thing to reason about
beside the already-dead `:141-143` branch, which is left alone because it is not
this ticket's code. `chatwootAllowed` is untouched (D-7).

`src/infrastructure/whatsapp/agent_bridge.go`

In `runAgentBridge`, between the row resolution (`:635-639`) and
`agentEndpointFromRecord` (`:640`):

```go
if !deviceWebhookEnabled(deviceRecord) {
	log.Debugf("[AGENT] skipping message %s on device %s: the device's webhook is disabled", evt.Info.ID, deviceID)
	return
}
```

Placement is load-bearing three ways: **after** the read (no new query, NFR-1),
**before** the endpoint choice (so `AGENT_WEBHOOK_URL` is never used as a fallback
for a silenced device), and **before** `agentSendRefusal` and the failover (so no
sibling candidate is built, AC-16).

What this placement **does not** avoid, recorded because the performance lens
asked for it rather than left implicit: by the time `runAgentBridge` runs, the
event has already taken one of the 32 process-wide `agentMaxInFlight` slots and
the per-chat counter (`:587`), spawned a goroutine (`:595`), and — for an `@lid`
sender — paid a LID→PN store lookup in `NormalizeJIDFromLID`. All are promptly
released and none is an HTTP call. The alternative, gating in
`handleAgentBridgeWithText`, runs on whatsmeow's event goroutine and holds no
row, so it would add a **synchronous database read to every inbound message on
every deployment** to save a slot in the rare disabled case. Rejected.

### Step 7 — Policy matrix and OpenAPI

- `src/ui/rest/policy_matrix_test.go` — add
  `{"PATCH", "/devices/:device_id/webhook/enabled", pkgAuth.PermDevicesWebhookWrite}`
  to the device block (`:92-104`). Without it
  `TestSection06CoversEveryRegisteredRoute` fails.
- `docs/openapi.yaml` is edited, then **copied**:
  `cp docs/openapi.yaml src/ui/rest/apidocs/openapi.yaml`. They are one file plus
  a copy, not two edits — `TestEmbeddedSpecMatchesTheCanonicalOne`
  (`apidocs_test.go:29`) asserts byte equality and names both paths on failure.
  Content: the new path with `patch`, request/response examples and 400/403/404/500;
  and `webhook_enabled` added to the `get` and `patch` response schemas of
  `/devices/{device_id}/webhook`.

### Step 8 — Tests

New `src/infrastructure/whatsapp/webhook_disable_test.go`:

- disabled device → zero calls to `submitWebhookFn`, **with a global list
  configured** (AC-15);
- **disabled device with no `webhook_url` at all** → still zero (TC-16 — the case
  the deletion workaround gets wrong today, and the security lens's stated worry);
- disabled device → the agent endpoint is never called (AC-16);
- enabled sibling still delivers while its neighbour is disabled (AC-18);
- `deviceWebhookEnabled(nil)`, a record with a nil flag, and a failing row read
  all deliver (AC-20);
- re-enable → same URL, same secret, next event (AC-19);
- **the stated limit** (AC-25 / TC-15): stale JID row enabled + live session row
  disabled still delivers, with the assertion text saying so in words.

New `src/infrastructure/chatstorage/device_webhook_enabled_test.go`:

- a row created with no explicit value reads back `true` through a **real SQLite
  database** — this is what pins that `**bool` scanning works, not just that the
  helper compiles (AC-2);
- `SetDeviceWebhookEnabled(false)` leaves URL/secret/events/skip-verify literally
  unchanged (AC-4);
- `SetDeviceWebhookConfig` after a disable leaves it disabled (AC-5);
- visible through `GetDeviceRecord`, `GetDeviceRecordByJID`, `ListDeviceRecords`
  (AC-3);
- `GetDeviceWebhookEnabled` on an absent row returns `true` (AC-10).

New `src/ui/rest/device_webhook_enabled_test.go`:

- 200 + body for `true`/`false`, and idempotence (AC-6, AC-7);
- `"yes"`, `1`, `{}` → 400 with **no service call recorded** (AC-8);
- `GET .../webhook` reports `webhook_enabled`, `true` for a nil config (AC-10);
- **an `admin` of account A gets a byte-identical 404 on the new route for a
  device of account B, and B's row is unchanged** (AC-13). The security lens
  showed why this cannot be left to the boot assertion:
  `PolicyCoverageViolations` scans the whole handler slice and is explicitly
  **order-blind**, so a mis-ordered `owns` boots green and passes the policy
  matrix. Only a request-level test proves the guard actually runs.

Existing suites are expected to pass **unedited** apart from the four migration
counts. Under D-1 that is now literally true: every `DeviceRecord` literal leaves
`WebhookEnabled` nil, which reads as enabled.

## Files to change

| File | Change |
|------|--------|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 75; `deviceRoutingColumns` + `scanDeviceRoutingTargets`; `SetDeviceWebhookEnabled`; `GetDeviceWebhookEnabled` |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | migration count 74 → 75 (assertion + message) |
| `src/infrastructure/chatstorage/user_repository_test.go` | migration count 74 → 75 (assertion + message) |
| `src/infrastructure/chatstorage/user_admin_repository_test.go` | migration count 74 → 75 (assertion + comment) |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | migration count 74 → 75 (assertion + message) |
| `src/infrastructure/chatstorage/device_webhook_enabled_test.go` | **new** — storage tests |
| `src/domains/chatstorage/chatstorage.go` | `DeviceRecord.WebhookEnabled *bool` |
| `src/domains/chatstorage/interfaces.go` | declare the two methods |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | delegate both |
| `src/infrastructure/whatsapp/webhook_forward.go` | `deviceWebhookEnabled`; `shouldWarnDisabledWebhook`; the delivery gate |
| `src/infrastructure/whatsapp/agent_bridge.go` | the bridge gate |
| `src/infrastructure/whatsapp/webhook_disable_test.go` | **new** — delivery-gate tests |
| `src/domains/device/interfaces.go` | declare the two usecase methods |
| `src/usecase/device.go` | implement them: 404, write, audit line, broadcast |
| `src/ui/rest/device.go` | route line; `UpdateDeviceWebhookEnabled`; `webhook_enabled` in `GetDeviceWebhook` |
| `src/ui/rest/device_webhook_enabled_test.go` | **new** — REST tests incl. cross-account 404 |
| `src/ui/rest/policy_matrix_test.go` | one route→permission row |
| `docs/openapi.yaml` | new path + `webhook_enabled` on the existing two |
| `src/ui/rest/apidocs/openapi.yaml` | `cp` of the above |

Revision 1 ended this list with "fake/mock usecases will need the new method".
That was **wrong** (senior lens): `device_test.go:21`, `device_account_test.go:20`
and `:257`, `account_lifecycle_test.go:88` and the `IChatStorageRepository` stubs
all **embed** their interface, so a new method needs no stub edit. The clause is
deleted so the list stays exact under IM-4.

**No deployment runtime file is touched.**

## Validation strategy

From `src/`, with `-tags purego` (without it roughly two hundred tests fail on
`go-sqlite3 requires cgo` and the diff against a baseline is unreadable):

```
go build -tags purego ./...
go vet  -tags purego ./...
go test -tags purego ./...
```

A **baseline was captured on the unmodified tree before the first edit**: 18
packages ok, one pre-existing failure — `TestResolveDocumentMIME/Zip`, a Windows
MIME-registry quirk (`application/x-zip-compressed` vs `application/zip`)
unrelated to this ticket. The final run is diffed against it, so a pre-existing
failure is never reported as caused by this change.

Targeted runs, each tied to what it proves:

- `./infrastructure/chatstorage/... -run 'Migration|Device|Schema'` — AC-1..AC-5
- `./infrastructure/whatsapp/... -run 'Webhook|Agent|Forward'` — AC-15..AC-20,
  AC-25, NFR-1
- `./ui/rest/... -run 'Webhook|Policy|Coverage|Section06'` — AC-6..AC-14

**Two mutation checks**, because a green suite proves little for a ticket whose
subject is the *absence* of traffic — a test asserting "no request was made" also
passes when the whole path is broken. Revision 1 listed four; the senior lens
noted the ritual was heavier than a one-column change warrants, so the two that
map to an AC are kept and the two that only restate the helper are dropped:

1. Make `deviceWebhookEnabled` return `true` unconditionally → the delivery and
   bridge tests must fail. *(Proves AC-15/AC-16 are not vacuous.)*
2. Add `webhook_enabled` to `SetDeviceWebhookConfig`'s UPDATE list → AC-5 must
   fail. *(Proves the structural claim in D-2 is actually load-bearing.)*

If a mutation is **not** detected, the coverage hole is real and is closed before
`verify.md` records a pass.

## Rollback

Revert the commit. The database keeps the column: migration 75 is additive with a
default, no row was rewritten, and the previous binary never names
`webhook_enabled` — its `SELECT` lists are explicit, so an extra column is
invisible to it. A deployment that recorded schema version 75 and then rolled the
binary back runs unchanged, with every device delivering exactly as before,
including any device that had been disabled: its flag becomes inert, which is the
correct reading of "the feature is gone".

No data is destroyed and no down-migration is needed. The only residue is an
unused column.

## Out of scope

As `spec.md > Out of scope`: no UI; no account- or deployment-level disable; no
change to the built-in auto-reply; Chatwoot untouched; inbound transcription and
media auto-download still run; sibling failover not gated; no new permission; the
existing `PATCH .../webhook` handler's secret echo left alone.

---

## Panel response

The advisory panel (senior / security / performance) reviewed **revision 1 against
the source** before any code was written: **26 findings, 5 major**. 15 adopted, 3
declined, 4 corrections. The two findings that changed the shape of the work are
first.

### The two structural findings

**1. `bool` was the wrong type — adopted, and it is the revision's main change.**
The performance and senior lenses arrived from opposite directions at the same
defect. Performance: revision 1's NFR-1 evidence
(`TestWebhookForwardStorageCallCountIsUnchanged`) builds `DeviceRecord` literals
with no flag, so the gate would silence them and its second subtest, which indexes
`h.delivered[0]`, would fail outright — meaning revision 1's headline claim "the
read-count tests pass untouched" was false *because of revision 1's own design*.
Senior: the Files-to-change list named two test files when at least six contain
such literals. Counting them gives **97 across 18 files**. Revision 1's answer
would have been to edit 97 fixtures — i.e. to spend the whole ticket teaching the
codebase to work around a badly chosen zero value, while leaving the same landmine
armed for the next `DeviceRecord` anyone writes. D-1 changes the representation
instead: `*bool`, nil = enabled, one helper. The fixtures need no edit, and NFR-1's
claim becomes literally true rather than aspirational.

**2. The gate reads whichever row won URL-precedence, not necessarily the arrival
device — recorded as a stated limit (AC-25), redesign declined.** Found
independently by the senior and security lenses.
`resolveDeviceRowForWebhook` returns the first row carrying a usable
`webhook_url`: the JID row, else the session row. In the blank-JID case the
function's own comment documents, a stale row holding the JID can win over the
live slot, so disabling the live slot would not silence delivery through the
stale row's webhook.

The finding is correct. The suggested fix — "gate on either resolved row" —
is **declined**, for a reason that only appears when you look at what pins the
current behaviour: `TestResolveDeviceRowJIDWebhookWins` asserts the session path
runs **exactly zero** times when the JID row carries a webhook, and calls that
"today's behaviour and the reason the query count stays at one". Consulting the
second row means either a second query on the green path — breaking NFR-1 and the
exact-equality read-count assertion — or rewriting a prior ticket's deliberate,
documented precedence rule from inside a ticket about a boolean column. Both are
larger and riskier than the hole. A cached flag on `DeviceInstance` was also
considered (D-5) and rejected as a second copy of state.

So the limit is **stated rather than hidden**: AC-25 describes it, TC-15 pins it
with a test whose assertion text says in words that this is the documented
boundary, and it is listed as a residual risk. It is also not new — the same
ambiguity already decides which `account_id` ticket 17 stamps on those events. The
honest summary is that this ticket honours the flag on the row the delivery path
uses, and that in one documented resolution corner that is not the row the admin
sees.

### Adopted

| # | Lens | Finding | What changed |
|---|------|---------|--------------|
| 3 | security, senior | `WebhookEnabled` on `DeviceWebhookConfig` has two constructors and only one would set it — C-6 reintroduced beside the gate | **D-2**: the flag is off that struct entirely; its own `Get`/`Set` methods, and `SetDeviceWebhookConfig` becomes structurally unable to write it |
| 4 | security | `AssertPolicyCoverage` is **order-blind** (`hasGuard` scans the whole handler slice), so a mis-ordered `owns` boots green and passes the policy matrix; revision 1 had no cross-account test | **Step 8**: an explicit request-level test that an admin of A gets a byte-identical 404 on the new route for B's device, and B's row is unchanged |
| 5 | security | Silent-outage vector: the only signal is a `debug` line, below default level; the flag survives restarts | **D-10**: a throttled `warn` on first skip per device, reusing `shouldWarnUnresolvedDevice`'s TTL shape — which also matches the ticket's own "first event" wording |
| 6 | performance, security, senior | Transcription still runs (a billed third-party call), media is still downloaded and discarded, auto-reply and Chatwoot still fire — all upstream of the gate | **spec REQ-3 narrowed**; four new Out-of-scope entries naming transcription, media download, footprint, Chatwoot |
| 7 | senior | `webhookConfig = nil` in the gate is dead code | Dropped; `webhookAllowed = false` only |
| 8 | senior | Step 1 said "move the count from 74 to 75" but each site also carries the number in a `t.Fatalf` string and a comment; two line refs were off by 2 | Step 1 now lists assertion + message + comment per site, with corrected line numbers |
| 9 | senior | C-2 claimed a MySQL dialect walk; there is none | **spec C-2 corrected** — SQLite and PostgreSQL only |
| 10 | senior | "Fake usecases will need the new method" is false — they embed the interface | Clause deleted so the file list stays exact under IM-4 |
| 11 | senior | The two `openapi.yaml` copies are one file plus a `cp` | Step 7 states the copy direction and names the test that enforces it |
| 12 | senior | Migration 74 already says "(ticket 27)"; a second would be ambiguous | The new comment uses the slug `z8pmx9mavz` |
| 13 | senior | Reusing `DEVICE_WEBHOOK_CONFIG_UPDATED` is fine but should be a decision, not an inheritance | **D-9** now states it and says what a consumer can and cannot distinguish |
| 14 | performance | The agent gate sits after `agentCalls.acquire`, the goroutine spawn and a LID→PN store lookup; revision 1's rationale named only the slot | Step 6 records all three and why the cheaper-looking alternative costs a read on every message |
| 15 | senior | The four-mutation ritual is heavier than a one-column change warrants | Reduced to the two that map to an AC (AC-15/AC-16 and AC-5) |

### Declined

| # | Lens | Finding | Why not |
|---|------|---------|---------|
| D-a | senior, security | Gate on both candidate rows / resolve by session id | See structural finding 2 — it inverts `TestResolveDeviceRowJIDWebhookWins`, a deliberate pinned invariant, and costs a query on every inbound event. Replaced by AC-25 + TC-15 |
| D-b | security | The `UPDATE` is unscoped (`WHERE device_id = ?`); an account-scoped precedent exists at `account_repository.go:363` | The sibling `SetDeviceWebhookConfig` is equally unscoped and does something strictly more dangerous — it re-points a webhook to a caller-controlled URL. Scoping only the new one needs the caller's account threaded into the usecase, a cross-cutting change to every device route, and would leave the sharper hole open beside the closed one. The control is the route-line guard, now tested at request level (adoption 4). Recorded as a residual risk |
| D-c | security | Surface `webhook_enabled` on the device list | A response-shape change on a route no AC mentions. `GET .../webhook` already answers the question (AC-10) |

### Corrections

- **The senior lens's major 3 is wrong.**
  `TestWebhookForwardStorageCallCountIsUnchanged` **does** exist, at
  `webhook_account_routing_test.go:400`, with the harness counter at `:109-114`.
  NFR-1's evidence is real. Verified before revising.
- **The security lens's last info item is wrong.** The two `openapi.yaml` copies
  *are* pinned in sync, byte-for-byte, by `TestEmbeddedSpecMatchesTheCanonicalOne`
  (`apidocs_test.go:29`). C-7 is enforced, not merely asserted.
- **Revision 1's "existing suites pass unedited" was false** under its own design
  (structural finding 1). It is true under revision 2's.
- **Revision 1's claim that mock usecases would need the new method was false** —
  they embed the interface.
