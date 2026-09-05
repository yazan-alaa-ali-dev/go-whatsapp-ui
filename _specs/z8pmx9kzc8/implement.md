---
ticket: z8pmx9kzc8
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc8"
  github: ""
---

# Implementation — 17 · Carry `account_id` and `transport` in the outbound webhook

Applied on branch `ticket/z8pmx9kzc8`, cut from `ticket/z8pmx9kzc7` (the account
layer: migrations 51–61, `DeviceRecord.GowaAccountID`/`Transport`, the accounts
API). Per the workflow's delivery boundary, **no commit was created at this
stage** — the single publishable commit is made by `/publish-pr`.

## Files changed

### New (1)

| File | What it holds |
|---|---|
| `src/infrastructure/whatsapp/webhook_account_routing_test.go` | The payload contract, the global-fallback case, the usable-URL gate, precedence, the storage-call count across both seams, the deduped ambiguity log, and the ordering proof. |

### Modified (11)

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | `GetDeviceRecord` selects the four webhook columns; migration 60/61 comment renamed to the new function name |
| `src/domains/chatstorage/chatstorage.go` | `json:"-"` on `DeviceRecord.WebhookSecret` |
| `src/infrastructure/whatsapp/webhook_forward.go` | `resolveDeviceRowForWebhook` / `webhookConfigFromRecord` / `deviceRowBySessionID`; `addWebhookAccountRouting`; the deduped ambiguity log |
| `src/infrastructure/whatsapp/agent_bridge.go` | `AccountID`/`Transport` on `agentRequest`; row resolved once and used twice; `agentEndpointFromRecord` |
| `src/cmd/root.go` | the `AGENT_WEBHOOK_SIGN` startup warning |
| `docs/webhook-payload.md` | the two top-level fields, the sample payload, and the `account_id` semantics note |
| `readme.md` | the `AGENT_WEBHOOK_SIGN` operating requirement |
| `src/infrastructure/whatsapp/webhook_forward_test.go` | four call sites resolve a row, then derive the projection |
| `src/infrastructure/whatsapp/webhook_route_test.go` | `webhookRouteStubStorage` implements `GetDeviceRecord`; `agentEndpointForTestJID` helper |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | `buildAgentRequest` signature; four new tests |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | `GetDeviceRecord` webhook columns; the secret-never-marshalled test |

**No deployment runtime file was touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).

## The owner's decision on `AGENT_WEBHOOK_SIGN`

The security lens proposed a **fail-closed rule**: when the agent endpoint is a
per-device one and `AGENT_WEBHOOK_SIGN` is false, omit `account_id`/`transport`
from the request. Plan revision 2 adopted it, and it was implemented.

**The owner then directed that the fields be sent regardless**, because signing is
switched off deliberately as a testing configuration in this deployment, and
withholding data from that configuration defeats its purpose. The rule
(`applyAgentAccountDisclosureRule`) was **removed**; the fields are now always
sent.

What remains from that finding, because it costs nothing and loses no data:

- the startup **warning** when signing is off (`cmd/root.go`),
- the `readme.md` operating requirement,
- a comment in `agent_bridge.go` recording the exposure and why the fields are
  sent anyway.

`spec.md > AC-10` and `plan.md > Panel response` are updated to record the decision
and who made it. The residual exposure is stated plainly in `verify.md > Known and
accepted`.

## Deviations from the plan

**D-1 — the fail-closed rule was implemented, then removed on the owner's
instruction.** See above. AC-10 is satisfied by documentation, the startup warning
and the recorded key decision; the conditional omission is not part of the
delivered behaviour.

**D-2 — `agentRequest`'s new fields are not `omitempty`.** Revision 2 specified
`omitempty` so an omitted field would signal the fail-closed case. With that rule
gone, `omitempty` would have made an empty `account_id` vanish — contradicting the
semantics the webhook payload uses, where `""` means "no account" and is written
explicitly. Both fields are now always present, matching the webhook.

**D-3 — `src/cmd/root_test.go` was listed but needed no change.** The panel warned
that `TestLogAgentConfigurationDisabledIsSilent` fails if the function emits
anything when the bridge is disabled. Placing the new line **after** the
`utils.AgentEnabled()` early return — as the plan specified — means it does not
fire in that case, so the test passes unmodified. The file is listed in the plan
and left untouched, which is the safe direction.

**D-4 — `-race` could not be run on this host.** The plan made the race detector
part of validation. `-race` requires cgo and this host has no C toolchain
(`cgo: C compiler "gcc" not found`), which is also why the whole suite runs under
`-tags purego`. AC-7 is instead proved **deterministically**:
`TestWebhookRoutingIsInjectedBeforeDelivery` relies on `forwardToWebhooks` running
synchronously *before* `go forwardToChatwoot(...)` is spawned, so the two keys
being present at `submitWebhookFn` time means they were written before that
goroutine existed. Moving the injection below the `go` statement makes that test
**fail**, not flake — a stronger guard than a detector that only trips when the
scheduler cooperates. Recorded in `verify.md` as a limitation of the host, not a
skipped check.

**D-5 — `addWebhookAccountRouting` takes the JID as a third argument.** The plan's
signature was `(payload, record)`. The deduped ambiguity log needs the JID to key
its cache and to name the device in the line, and the record is `nil` in exactly
that case — so the JID cannot come from it.

## Notes on what was deliberately not done

- No routing decision is made from `account_id`; nothing reads it to choose a
  device. That is ticket 18.
- `agentResponse` is unchanged, asserted structurally by `TestAgentResponseIsUnchanged`.
- `ListDeviceRecords` and `ListDeviceRecordsByAccount` still omit the webhook
  columns — operator-triggered list reads with no consumer for them.
- The duplicate device-row read across the forward and agent goroutines, the
  registry walk in `addWebhookSessionID`, and caching the row on `DeviceInstance`
  are all recorded as follow-ups in `plan.md > Out of scope`.
