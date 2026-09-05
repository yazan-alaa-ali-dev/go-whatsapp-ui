---
ticket: z8pmx9kzc8
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc8"
  github: ""
---

# Plan — 17 · Carry `account_id` and `transport` in the outbound webhook

> **Revision 2.** The advisory panel (senior / security / performance — the three
> lenses `/review` dispatches) reviewed revision 1 against the code before any line
> was written. 23 findings were adopted, 3 declined and 2 corrected; every one is
> answered in **Panel response** at the end. One adopted finding (SEC3, the agent
> fail-closed rule) was subsequently **overridden by the owner** during
> implementation — see that row and `implement.md > D-1`.
>
> **All three lenses independently found the same defect**, and it was the whole
> point of the ticket: revision 1 kept the "has a usable `webhook_url`" gate on a
> function that now returns the row, so `account_id` would have been `""` on every
> device using the global `WHATSAPP_WEBHOOK` list — the majority deployment, and
> exactly the case the ticket exists to serve. Revision 1's byte-comparison test,
> its startup `error` log, and its claim that signing "removes replay" were also
> **removed**; a fail-closed rule for the widened agent payload, a deduped
> ambiguity log, closed-list transport enforcement and a corrected threading model
> were **added**.

## Approach

The ticket reads as "add two fields to a map". The code says otherwise, and the
difference is the whole plan.

`getWebhookConfigForDevice` (`webhook_forward.go:178`) answers **one** question
today — "what webhook config should this event use?" — by way of **two**
resolution paths:

1. **JID path** — `getDeviceRecordForTest(jid)` → `GetDeviceRecordByJID`, a full
   `*DeviceRecord` carrying `GowaAccountID` and `Transport` since ticket 16. One
   query. Its result is used **only if** the row has a non-empty `webhook_url`
   (`:187`).
2. **Session-id fallback** — `webhookConfigBySessionID(jid)` (`:213`) resolves the
   JID to a session id **in memory** (no query), then calls
   `GetDeviceWebhookConfig(sessionID)`, which returns only the four webhook
   columns. One query. Same non-empty-`webhook_url` gate (`:232`).

This ticket needs a **second, different** question answered from the same reads:
"which account and channel did this event arrive on?" Those two questions have
different right answers for the same row. A device attached to `acc_alpha` with no
dashboard webhook has **no webhook config** (correctly — the caller must fall back
to the global list) and **a perfectly good account**. Revision 1 conflated them and
would have shipped `account_id: ""` for precisely those devices.

So the design is a **split**, not a widening:

- **`resolveDeviceRowForWebhook(jid) (*DeviceRecord, error)`** answers "which row
  is this event's device?" It returns a row whenever one is found, and `nil` only
  when no row resolves at all.
- **`webhookConfigFromRecord(record) *DeviceWebhookConfig`** answers "does that row
  carry a usable webhook config?" It returns `nil` unless
  `WebhookURL != nil && *WebhookURL != ""` — **the existing gate, moved, not
  removed**. That precondition is load-bearing beyond URL selection:
  `isEventWhitelistedForDevice` (`:296`) switches from the global whitelist to the
  device whitelist on a non-nil config, so returning a config for a row with
  `webhook_events` set but no `webhook_url` would **silently stop forwarding events
  that are delivered today**.

Path 2's query changes from `GetDeviceWebhookConfig(sessionID)` to
`GetDeviceRecord(sessionID)` — **the same single primary-key seek**
(`WHERE device_id = ? LIMIT 1` in both), returning the whole row instead of four
columns. Its prerequisite: `GetDeviceRecord`'s explicit `SELECT` list does not
include the webhook columns today, even though `DeviceRecord` has fields for them,
so they come back `nil`/`""` and the type quietly lies. That is the identical
defect ticket 16 fixed for the routing columns, in the same function family.

**Control flow, unchanged in effect and in query count:**

```go
row, _ := getDeviceRecordForTest(jid)            // query 1 (may be nil)
if webhookConfigFromRecord(row) != nil { return row }   // usable webhook: done, 1 query
sessionRow := deviceRowBySessionID(jid)          // query 2 (may be nil)
if webhookConfigFromRecord(sessionRow) != nil { return sessionRow }
// Neither carries a usable webhook — the caller will fall back to the global
// list, exactly as today. We still return a row so the ACCOUNT is known.
if sessionRow != nil { return sessionRow }
return row
```

**Precedence, stated because the two paths can disagree:** the first row with a
usable webhook wins, in the existing order (JID, then session id) — that is
today's webhook behaviour, byte for byte. When neither has one, the **session
row wins** for account purposes, because it is the registry-resolved match and is
unambiguous by construction, whereas the JID row may be the blank-`jid` row that
`TestForwardPayload_DeviceRowWithBlankJID` pins. `nil` only when neither exists.

Query count: **1** when the JID row carries a usable webhook, **2** otherwise —
identical to today (AC-6).

**On threading.** The ticket's own research says this runs on the whatsmeow event
thread. **It does not.** Every caller dispatches
`forwardPayloadToConfiguredWebhooks` into its own goroutine with a fresh 30s
context (`event_message_handler.go:224`, `event_handler.go:125/:366/:392/:426`,
`event_chat_presence.go:28`, `event_call.go:46`). The "no added reads" requirement
is still honoured to the letter — it is an acceptance criterion — but the honest
justification is *don't add work to a per-event goroutine that already makes an
HTTP call*, not *don't block the socket*. CON-2 and NFR-2 are reworded in
`spec.md` accordingly, and the reads are not cheap-to-add just because the thread
is detached.

## Steps

### 1 — `GetDeviceRecord` selects the webhook columns

`sqlite_repository.go` — extend the `SELECT` list and `Scan` of `GetDeviceRecord`
(`:1530`) with `webhook_url, COALESCE(webhook_secret,''), COALESCE(webhook_events,''),
COALESCE(webhook_insecure_skip_verify, FALSE)`, exactly as `GetDeviceRecordByJID`
already does on the same table. Verified safe: the only non-test caller
(`account_repository.go:177`) checks the result for `nil` only, the wrapper is pure
delegation, and no interface or migration is affected.

`ListDeviceRecords` and `ListDeviceRecordsByAccount` are **not** widened. They are
operator-triggered list reads with no consumer for the webhook columns, and
widening them is unrelated scope; the inconsistency is recorded here rather than
left to be rediscovered.

`domains/chatstorage/chatstorage.go` — `DeviceRecord.WebhookSecret` gains
`json:"-"`. The record now travels through two more call sites, and it carries
`db` tags only, so any future handler that marshals one would emit the secret.
One tag, permanently.

### 2 — Split row resolution from webhook projection

`webhook_forward.go`:

- `getWebhookConfigForDevice` → **`resolveDeviceRowForWebhook(deviceJID)
  (*DeviceRecord, error)`**, implementing the control flow above.
- `webhookConfigBySessionID` → **`deviceRowBySessionID(deviceJID) *DeviceRecord`**,
  calling `GetDeviceRecord(sessionID)`. It returns the row it found — the usable-URL
  gate moves out of it into `webhookConfigFromRecord`.
- New **`webhookConfigFromRecord(*DeviceRecord) *DeviceWebhookConfig`** — `nil`
  unless the row has a non-empty `webhook_url`; otherwise the same four-field
  projection built today.
- `forwardPayloadToConfiguredWebhooks` builds the projection **once** at the top and
  threads it exactly as before, so `isEventWhitelistedForDevice`,
  `getWebhookURLsFromConfig` and `forwardToWebhooks` are **untouched** (NFR-4).

Both renames are deliberate rather than incidental: after this change the old names
describe the opposite of what the functions return, and a caller trusting
`getWebhookConfigForDevice` to yield a projection would be reading routing data out
of a config. The cost is two production call sites and five existing test
functions, all of which this ticket already touches.

`sqlite_repository.go:3626` — migration 60/61's comment names
`getWebhookConfigForDevice`; updated to the new name so the justification for those
indexes stays greppable.

### 3 — Inject the two fields, synchronously

`webhook_forward.go:143`, inside the existing `if webhookAllowed` branch, beside
`addWebhookSessionID` and **before** `go forwardToChatwoot(...)`:

```go
if webhookAllowed {
    addWebhookSessionID(payload)
    addWebhookAccountRouting(payload, record, deviceJID)
}
```

`addWebhookAccountRouting` sets `payload["account_id"]` and `payload["transport"]`:

- `""` for the account when the row is nil or its account is empty — **empty means
  "no account"**, the semantics ticket 16 established; not an error, not a missing
  key (AC-1, AC-8).
- The transport passes through the **closed list**: `validations.IsValidTransport`,
  with `""` and anything outside the list reported as `whatsmeow`. A value that
  could not have been written through the accounts API is a data-integrity signal,
  not something to hand a consumer that may branch on it — the same read-side
  enforcement `usecase/account.go` already applies. The constants
  `validations.TransportWhatsmeow` / `TransportMetaCloud` are reused rather than
  respelled; `infrastructure/whatsapp` gains that import (no cycle — `validations`
  imports nothing from `infrastructure`).
- Like `addWebhookSessionID`, it does not overwrite a key already present.

Ordering is the correctness point, not the values (NFR-3): the same `payload` map
is handed to the Chatwoot goroutine a few lines below, so a write after that `go`
statement is a data race. The injection sits in the same branch and position as the
existing enrichment, which is already correct, and `-race` is part of validation.

### 4 — The ambiguity log, deduped

When `resolveDeviceRowForWebhook` returns **no row at all** for a non-empty JID —
two companion slots (`GetDeviceRecordByJID` answers `nil` on `LIMIT 2` rather than
guessing a sibling) or an unknown JID — the event still forwards with an empty
account, and that is logged (AC-9).

It is logged **once per JID per hour**, through a small TTL cache in the shape of
the `groupNameCache` already in this file (`:60-86`). A raw log line here would
print a customer-facing phone number at warn level on **every event** for an
affected device; deduping keeps the signal and removes the volume. It is
deliberately not an error and never stops the forward: refusing to deliver an event
because the account is unknown would turn a routing gap into a delivery outage.

### 5 — The agent request

`agent_bridge.go`:

- `agentRequest` gains `AccountID` and `Transport` (AC-3). `agentResponse` is
  **not touched** (AC-4).
- `runAgentBridge` builds the payload at `:291` and only then resolves the endpoint
  at `:295` — the call that reads the row. The two are reordered so the row is read
  once and used twice, **after** the `phone == ""` early return at `:288`, so a
  skipped message does not start paying a read it does not pay today.
- `agentEndpointForDevice(jid)` splits into the row resolution plus
  `agentEndpointFromRecord(record)`.
- `buildAgentRequest` takes the resolved row rather than two more positional
  strings — it already carries five, and a seventh untyped `string` parameter is a
  swap waiting to happen.

### 6 — The security precondition (AC-10)

Revision 1 got the reasoning wrong here, and the correction matters.

**What signing actually does.** `AgentSignatureValue` (`pkg/utils/agent.go:50`)
computes an HMAC over the **body alone** — no timestamp, no nonce. So
`AGENT_WEBHOOK_SIGN=true` does **not** remove replay: a captured request stays
replayable by whoever captured it. What it removes is **key disclosure**: with
`false`, the global `AgentWebhookKey` is sent verbatim in the header to every
destination, and the destination is per-device from the database — so every
integrator who ever received one agent request holds the credential that
authenticates requests for **every other device and account**.

**The fail-closed rule.** That is the configuration this ticket must not widen
silently. When the resolved endpoint is a **per-device** one (≠
`config.AgentWebhookURL`) **and** `AgentWebhookSign` is false, the request is sent
**without** `account_id` and `transport`, and the omission is logged. The call is
not skipped — skipping would break the bridge for those deployments, a behaviour
change NFR-1 forbids — and the single-global-endpoint deployment, which is the
default, is entirely unaffected. This is narrow, testable, and it is what AC-10's
"not shipped silently" asks for.

**A startup warning, at `warn`.** `logAgentConfiguration` (`cmd/root.go:442`)
gains one line after the `AgentEnabled` gate when signing is off. **Warn, not
error**: `AGENT_WEBHOOK_SIGN=false` is the shipped default, so an error would make
every existing agent deployment emit `level=error` on upgrade for a configuration
that did not change — alert noise, not a control. Worth noting for context: the
sibling subsystem defaults `WhatsappWebhookSign = true` (`settings.go:74`); the
agent is the outlier.

**The recorded decisions.**
- *Per-destination / per-account key:* **not implemented here.** A per-account key
  needs somewhere to live, and the only candidate is the account row — a second
  secret in the database, the exact pattern ticket 16 refused for `meta_token_ref`
  (a reference, never a value). Choosing that storage shape is a ticket of its own.
- *Replay:* **accepted residual risk.** Adding a timestamp and nonce to the agent
  signature is the follow-up that actually closes it, and it is a protocol change
  on both sides. Named here so it is not mistaken for solved.

### 7 — Documentation

`docs/webhook-payload.md` — both fields in the top-level table and the sample
payload, with the empty-account semantics, and a note that `account_id` is an
**opaque operator identifier that leaves the deployment** (it reaches per-device
integrator endpoints and, on fallback, the global `WHATSAPP_WEBHOOK` list), so
customer names or emails must not be used as account ids.

`readme.md` — the `AGENT_WEBHOOK_SIGN` operating requirement and what it does and
does not protect.

### 8 — Tests

| Test | Pins |
|---|---|
| happy path | AC-1: both fields carry the row's values. |
| **existing fields unchanged** | AC-2: `event`, `device_id`, `session_id` compared **per field**, `payload` deep-equal, and the key set is exactly the old set plus the two new keys. **Not** a whole-document byte comparison: `json.Marshal` sorts map keys and `account_id` sorts first, so the serialised bytes necessarily differ — the AC is about field *values*, not document bytes. |
| **global-fallback device** | The defect all three lenses found: a device with an account and **no** `webhook_url` still reports its `account_id`, and still falls back to the global list. |
| **device whitelist not hijacked** | `webhookConfigFromRecord` returns `nil` for a row with `webhook_events` set but no `webhook_url`, so `isEventWhitelistedForDevice` keeps using the global whitelist and no currently-delivered event stops being delivered. |
| precedence | When both paths yield rows and neither has a usable webhook, the session row's account wins. |
| no account | AC-1/AC-8: `account_id` is `""`, `transport` is `"whatsmeow"` for a stored `""`. |
| transport closed list | A row holding `"smoke-signal"` reports `whatsmeow`, not the stored value. |
| **storage-call count** | AC-6: counted across **both** seams — `getDeviceRecordForTest` (the JID query) and the storage stub (the session-id query), because the JID query does not go through `dm.storage` and a stub counting only the latter would assert 1-vs-1. Exact equality: 1 with a usable device webhook, 2 on the fallback. |
| ambiguity | AC-8/AC-9: two companion slots → forward succeeds, `account_id` is `""`, the line is emitted once and **not** repeated for the next event on the same JID. |
| ordering | AC-7 + `-race`. |
| agent request | AC-3/AC-4: the marshalled body carries both fields; `agentResponse` gains none (reflection over its fields). |
| **agent fail-closed** | Per-device endpoint + `AgentWebhookSign=false` → the body carries neither field; with signing on, or on the global endpoint, it carries both. |
| `GetDeviceRecord` webhook columns | Step 1, on both engines. |

## Files to change

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | `GetDeviceRecord` selects the four webhook columns; migration 60/61 comment renamed |
| `src/domains/chatstorage/chatstorage.go` | `json:"-"` on `DeviceRecord.WebhookSecret` |
| `src/infrastructure/whatsapp/webhook_forward.go` | the row/projection split; `addWebhookAccountRouting`; the deduped ambiguity log |
| `src/infrastructure/whatsapp/agent_bridge.go` | two `agentRequest` fields; row resolved once; the fail-closed rule |
| `src/cmd/root.go` | the unsigned-agent startup **warning** |
| `docs/webhook-payload.md` | the two new top-level fields + the opaque-identifier note |
| `readme.md` | the `AGENT_WEBHOOK_SIGN` operating requirement |
| `src/infrastructure/whatsapp/webhook_forward_test.go` | four `getWebhookConfigForDevice` call sites |
| `src/infrastructure/whatsapp/webhook_route_test.go` | `TestAgentEndpointForDevice`; **`webhookRouteStubStorage` must implement `GetDeviceRecord`** — it embeds a nil interface, so the swapped call would compile and panic at run time rather than fail to build |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | `buildAgentRequest` signature; the new fields |
| `src/cmd/root_test.go` | `TestLogAgentConfigurationDisabledIsSilent` asserts the exact log surface of the function step 6 changes |
| `src/infrastructure/whatsapp/webhook_account_routing_test.go` | new — payload, fallback, precedence, count, ambiguity, fail-closed |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | `GetDeviceRecord` webhook columns |

No file outside this list is touched. **No deployment runtime file is in it.**

## Validation strategy

- `go build -C src ./...`, `go vet -C src ./...`
- `go test -C src -tags purego -count=1 ./...` — this host has no cgo toolchain, so
  the tag selects `modernc.org/sqlite` and the SQLite suite runs for real. Baseline
  measured on this branch: one pre-existing failure, `TestResolveDocumentMIME`.
- `go test -C src -tags purego -race ./infrastructure/whatsapp/...` — the payload
  map is shared with a goroutine and ordering is this ticket's correctness point,
  so the race detector is part of validation, not an extra.
- The chat-storage package against **real PostgreSQL 16** — step 1 changes a
  `SELECT` list, and `COALESCE` on a boolean column is exactly where the two
  engines disagree.

## Rollback

Revert the commit. The two fields are additive, so a consumer that started reading
them simply stops seeing them; nothing it read before changes. The
`GetDeviceRecord` widening is a pure read change with no schema effect, so there is
nothing to undo in the database.

## Out of scope

Everything in `spec.md > Out of scope`, plus three things the panel raised and this
ticket deliberately does not do:

- **The duplicate row read across goroutines.** With the agent bridge on, the
  forward goroutine reads the device row 1–2× and `runAgentBridge`'s goroutine
  reads it again 1–2×. They have different lifetimes and different cancellation;
  deduplicating across them is a design change, not a tidy-up.
- **`addWebhookSessionID`'s registry walk.** It re-resolves a session id the
  resolved row often already carries. Using `record.DeviceID` unconditionally would
  populate `session_id` on events that today have none — an AC-2 violation — so the
  saving needs a "did this row come from the registry path?" guard that is worth
  its own change.
- **Caching the row on `DeviceInstance`.** Stamping `account_id`/`transport` onto
  the in-memory instance at load/connect would take the read off every path at
  once, and the codebase already has the pattern (`chatwoot.ClientRegistry` caches
  per-device config with an `Invalidate` on write). Recorded as the follow-up so
  ticket 18 does not re-derive it.

## Panel response

30 findings across three lenses. **23 adopted, 3 declined, 2 corrected.**

### The finding all three lenses found independently

| Lens | Finding | Response |
|---|---|---|
| SEC1 / SEN1 / (implied by PERF) | Revision 1 kept the "usable `webhook_url`" gate on a function that now returns the row, so `account_id` would be `""` for every device on the global `WHATSAPP_WEBHOOK` fallback — the majority deployment, and the exact case the ticket exists to serve. The step-4 warn log would then have fired **once per inbound message**. | **Adopted, and it restructured the plan.** Row resolution and webhook projection are now two functions answering two different questions; the gate moved into `webhookConfigFromRecord` rather than being removed. Verified against `webhook_forward.go:187` and `:232` — both did carry the gate. Two new tests pin it. |

### Senior lens

| # | Finding | Response |
|---|---|---|
| SEN2 | The projection must keep the usable-URL precondition, or `isEventWhitelistedForDevice` switches to the device whitelist and silently stops forwarding events delivered today | **Adopted.** Stated explicitly in the Approach and pinned by its own test row — this was the non-obvious half of the split, and no listed test would have caught it. |
| SEN3 | Precedence between the two rows is unstated, and `TestForwardPayload_DeviceRowWithBlankJID` pins exactly that collision | **Adopted.** Rule written into the Approach: first usable webhook wins in the existing order; when neither has one the **session row** wins for account purposes, because the JID row may be the blank-`jid` row that test pins. Asserted. |
| SEN4 | `webhook_route_test.go` breakage is understated: `TestAgentEndpointForDevice` calls the renamed function, and `webhookRouteStubStorage` embeds a **nil** interface — the swapped call compiles and **panics at run time** | **Adopted.** Both named in Files to change. The nil-embed detail is the valuable half: it would have surfaced as a panic in an unrelated test, not a compile error. |
| SEN5 | `src/cmd/root_test.go` is missing; `TestLogAgentConfigurationDisabledIsSilent` asserts the exact log surface step 6 changes | **Adopted.** Added, and the new line is placed after the `AgentEnabled` early return so that test's premise holds. |
| SEN6 | The startup **error** exceeds AC-10 and makes every existing deployment emit `level=error` on upgrade for a config that did not change | **Adopted** — downgraded to `warn`. Converges with SEC3: a log line was never the control. The control is the fail-closed rule. |
| SEN7 | The counting stub cannot see both queries — the JID query goes through `webhookStorageForTest`, not `dm.storage`, so it would assert 1-vs-1 | **Adopted.** The test counts **both** seams. This would have made AC-6's "exact equality" vacuous. |
| SEN8 | Reuse `validations.TransportWhatsmeow`/`TransportMetaCloud` rather than a third spelling in the infrastructure layer | **Adopted**, and merged with SEC5 — the same import also brings `IsValidTransport` for read-side enforcement. |
| SEN9 | The double rename is discretionary churn — make it a conscious decision | **Adopted as a conscious decision, recorded.** Both names now describe the opposite of what the functions return; a caller trusting `getWebhookConfigForDevice` to yield a projection would read routing data out of a config. Cost: two call sites and five test functions this ticket already touches. |
| SEN10 | Keep the row resolution **after** the `phone == ""` early return | **Adopted.** Otherwise skipped messages start paying a read they do not pay today. |
| SEN11 | Step 1 widening verified safe; `docs/webhook-payload.md` is the only consumer surface — no MCP, no gowa-ui, no OpenAPI schema | Confirmed independently; no action. |

### Security lens

| # | Finding | Response |
|---|---|---|
| SEC2 | "Signing removes replay" is **wrong**: `AgentSignatureValue` covers the body alone with no timestamp or nonce, so a captured request stays replayable | **Corrected.** Verified at `pkg/utils/agent.go:50`. The recorded decision now says what signing actually does — removes **key disclosure** to every destination — and names the nonce/timestamp change as the follow-up that closes replay, as accepted residual risk. Revision 1's claim was the kind of security reasoning that is worse than none. |
| SEC3 | With `Sign=false` the global key goes verbatim to every **per-device** endpoint, so every such integrator already holds the credential for all other devices — and this ticket lets that key mint requests carrying an arbitrary `account_id`. A startup line does not prevent it | **Adopted, then OVERRIDDEN BY THE OWNER.** The fail-closed rule was implemented (per-device endpoint **and** unsigned → omit the two fields) and then **removed**: the owner directed that signing is off deliberately as a *testing* configuration, so the fields must be sent regardless — withholding data from a test configuration defeats its purpose. The finding's analysis stands and is retained as documentation: the startup warning, the `readme.md` operating requirement, and a comment in `agent_bridge.go` recording the exposure. The residual risk is accepted and recorded in `verify.md > Known and accepted`. |
| SEC4 | The ambiguity log names a phone number at warn level, per event | **Adopted.** After the row fix the case is genuinely rare, but the log is deduped per JID per hour through the `groupNameCache` pattern already in the file. |
| SEC5 | `transport` is echoed verbatim for a row outside the closed list | **Adopted.** `validations.IsValidTransport`; anything outside the list reports `whatsmeow`. Same read-side enforcement `usecase/account.go` already applies. |
| SEC6 | Widening `GetDeviceRecord` puts `webhook_secret` on a record travelling through more call sites, and `DeviceRecord` carries `db` tags only | **Adopted.** `json:"-"` on the field, and the new log lines carry scalars (jid, device id) — never the record. |
| SEC7 | `account_id` becomes an externally visible identifier, reaching the global fallback list too | **Adopted** into `docs/webhook-payload.md`: it is an opaque operator identifier that leaves the deployment, so customer names/emails must not be used as account ids. |
| SEC8 | Attacker-influence trace is clean; no deployment runtime file implicated | Confirmed; no action. |

### Performance lens

| # | Finding | Response |
|---|---|---|
| PERF1 | The whole latency premise is false — the forward path runs in a **detached goroutine** with its own 30s context, not on the whatsmeow event thread | **Corrected.** Verified at `event_message_handler.go:224` and six other call sites. The ticket's own research says otherwise and is wrong. CON-2 and NFR-2 are reworded in `spec.md`; AC-6 is still honoured to the letter, but the honest reason is "don't add work to a per-event goroutine", not "don't block the socket". |
| PERF2 | The AC-2 byte-comparison test **cannot pass**: `json.Marshal` sorts map keys and `account_id` sorts first | **Adopted.** Per-field assertions plus an exact key-set check. The AC is about field values; revision 1's test description contradicted the AC it claimed to prove. |
| PERF3 | The counting test proves method calls, not query cost, and is blind to `sessionIDForRegisteredJID`'s `ListDevices()` sort + per-device `ParseJID` | **Adopted in part.** AC-6 is scoped honestly to **storage method calls**, stated as such rather than implied to be a cost guarantee, and counted across both seams (SEN7). The `allocs/op` benchmark is **declined**: the same function builds a fresh `http.Transport` per call with no connection reuse, so a benchmark would measure that and mislead. Recorded rather than measured. |
| PERF4 | `addWebhookSessionID` re-walks the registry for a session id the row often already carries | **Declined, explicitly.** Using `record.DeviceID` unconditionally would populate `session_id` on events that today have none — an AC-2 violation — so it needs a provenance guard. Written into **Out of scope** rather than left unremarked, which is what the reviewer asked for. |
| PERF5 | The row is read 2–4× per message across the two goroutines; step 5 dedupes only one half | **Adopted for the wording, declined for the fix.** REQ-3/NFR-2 narrowed to "the webhook forward path", which is what the ticket delivers. Cross-goroutine deduplication is a design change (different lifetimes, different cancellation), recorded in Out of scope. |
| PERF6 | The central claim is **true** and cheaper than argued: both are PK seeks with `LIMIT 1`, differing by ~9 column decodes off a leaf already in memory | Confirmed independently; the Approach now states it in one sentence instead of three paragraphs. |
| PERF7 | Two map keys are noise; `submitWebhook` builds a fresh `http.Transport` per call — that one line costs more per event than everything this ticket measures | Noted; **out of scope** and deliberately not touched. Recorded so AC-6 is not read as "this path is tuned". |
| PERF8 | `ListDeviceRecords`/`ListDeviceRecordsByAccount` keep the same "the type quietly lies" defect for the webhook columns | **Adopted as a stated reason**, not a change: both are operator-triggered list reads with no consumer for those columns. Widening them is unrelated scope. |
| PERF9 | Cache the row on `DeviceInstance` — takes the read off every path at once; the `chatwoot.ClientRegistry` pattern already exists | **Adopted as a recorded follow-up** in Out of scope, so ticket 18 does not re-derive it. |
