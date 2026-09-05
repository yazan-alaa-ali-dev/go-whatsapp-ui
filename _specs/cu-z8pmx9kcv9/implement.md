---
ticket: cu-z8pmx9kcv9
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv9"
  github: ""
---

# Implementation — cu-z8pmx9kcv9

06 · Build the omni agent bridge for inbound messages.
Branch `ticket/cu-z8pmx9kcv9`, cut from `ticket/cu-z8pmx9kcv8` (ticket 05, PR #4)
because 05's configuration and phone helpers are a hard dependency that is not on
`main` yet. The PR therefore targets `ticket/cu-z8pmx9kcv8`, not `main`.

## Files changed

| File | Change |
|------|--------|
| `src/infrastructure/whatsapp/agent_bridge.go` | **new** — the whole bridge (~470 lines) |
| `src/infrastructure/whatsapp/agent_bridge_test.go` | **new** — 19 tests |
| `src/infrastructure/whatsapp/auto_reply.go` | inline text check → `extractGenuineText(evt) != ""` (−19 lines) |
| `src/infrastructure/whatsapp/event_message_handler.go` | +1 call line between `handleAutoReply` and `handleWebhookForward` |
| `readme.md` | one paragraph describing the bridge under the AI-agent section |

No deployment runtime file was touched. `submitWebhook`, `webhook_forward.go` and
the webhook payload are untouched (AC-8). `.env.example` stays excluded, as in 05.

## Structure

| Symbol | Role |
|--------|------|
| `handleAgentBridge` | called from `handleMessage`; runs the guards and takes a gate slot **on the event goroutine**, then detaches |
| `runAgentBridge` | one round trip: build → call → sanitise → deliver |
| `callAgent` | exactly one POST; signature, redirect refusal, size cap, parse |
| `deliverAgentReply` (behind `deliverAgentReplyFn`) | send on the receiving client, store the message, store the debug payload |
| `agentGate` | one in-flight call per chat + 10 replies/chat/minute + 32 process-wide |
| `agentSkipReason` | the guard chain, returning the reason for the log |
| `extractGenuineText` | shared with `auto_reply.go` — one definition of "a message worth answering" |
| `sanitizeAgentReply` | UTF-8 validity, rune cap, control-character stripping that preserves `\n` and `\t` |
| `resolveAgentDeviceID` | the tenant-safety resolution; the bridge declines when it returns `""` |

## How each panel finding landed

Every adopted finding from `plan.md > Panel response` is in the code:

- `[P-1]` two contexts: `config.AgentTimeout` for `callAgent`,
  `agentDeliveryTimeout = 30s` for the send and both writes.
- `[P-2]` `NormalizeJIDFromLID` before `utils.JIDToE164`; an empty result aborts
  with a log naming the server (not the identity).
- `[P-3]` `TestExtractGenuineText` covers all four preserved branches plus a
  caption and an empty message — the safety net the refactor had none of.
- `[P-4]` `CheckRedirect: http.ErrUseLastResponse`;
  `TestCallAgentDoesNotFollowRedirects` asserts the redirect target is never
  contacted and never sees the signature header.
- `[P-5]` `sanitizeAgentReply`: `utf8.ValidString`, `agentMaxReplyRunes = 4096`
  (dropped, not truncated), control characters stripped **except** `\n` and `\t`.
- `[P-6]` `resolveAgentDeviceID` uses the context instance then
  `client.Store.ID.ToNonAD()`; `handleAgentBridge` returns with an error log when
  it cannot resolve, so nothing ever relies on `ClientFromContext`'s global
  fallback.
- `[P-7]` `SetMessageDebug` is called with the resolved device id explicitly.
- `[P-8]` `agentGate` — the three bounds in one acquire.
- `[P-9]` the gate is acquired in `handleAgentBridge`, before `go`, after the
  guards.
- `[P-10]` explicit `http.Transport`: `MaxConnsPerHost`/`MaxIdleConnsPerHost`/
  `MaxIdleConns` = `agentMaxInFlight`, `IdleConnTimeout` 90s, 10s `DialContext`
  and `TLSHandshakeTimeout`.
- `[P-11]` `agentSkipReason` skips `ProtocolMessage` forms; the skip is in the
  guard, not the shared extractor, so auto-reply's behaviour on edits is
  unchanged.
- `[P-12]` `client == nil` / `chatStorageRepo == nil` early returns;
  `AgentSignatureValue` failure returns **before** the request is built.
- `[P-13]` `truncateBytes` caps `text` at 8 KiB and `name` at 256 bytes without
  splitting a rune.
- `[P-14]` 512 KiB `io.LimitReader`; body drained with `io.Copy(io.Discard, …)`
  before `Close` on every path; a `metadata_debug` over 256 KiB is skipped with a
  warning rather than submitted to certain rejection.
- `[P-15]` every logged URL goes through `utils.RedactURL`; no body, header value
  or payload is ever logged.
- `[P-16]` default verifying TLS; no skip-verify toggle on this path.
- `[P-17]` `isLocalDeviceJID` skips a sender that is itself a device paired on
  this server.
- `[P-18]` the drop log names device and message id.
- `[P-19]` "calling agent" is `Debug`; the outcome is one `Info` line.
- `[P-20]`/`[P-21]` reference and AC-7 wording corrected in the artifacts.

The four declined findings are argued in `plan.md > Panel response > Declined`.

## Deviations from the plan

None. The file list matches the plan exactly.

## Validation run

| Check | Command | Result |
|-------|---------|--------|
| go-build | `go build -C src ./...` | exit 0 |
| go-vet | `go vet -C src ./...` | exit 0 |
| go-test (new tests) | `go test -C src -run "Agent\|ExtractGenuineText\|TruncateBytes" ./infrastructure/whatsapp/...` | 19 pass, 0 fail |
| go-test (whole module) | `go test -C src ./...` | 67 failures — **identical to clean `main`** |

The 67 failures were measured in a clean `git worktree` at `main` (`2f2bbb3`) and
on this branch, per package:

| Package | main | this branch |
|---------|------|-------------|
| `infrastructure/whatsapp` | 23 | 23 |
| `infrastructure/chatstorage` | 43 | 43 |
| `usecase` | 1 | 1 |

Identical, so this ticket introduces no regression — including in
`infrastructure/whatsapp`, the package it changes.

> **Correction to ticket 05's record.** `_specs/cu-z8pmx9kcv8/verify.md` reports
> "24 pre-existing failures" for `go test ./...`. That number is the count for
> `infrastructure/whatsapp` + `usecase` only — the two packages compared there.
> The whole-module figure is 67; `infrastructure/chatstorage` contributes the
> other 43, all pre-existing on `main`. The comparison and its conclusion (no
> regression) stand; only the scope of the number was mislabelled.

## No commit created

Per the delivery boundary, `/implement` creates no commit; the changes stay as
working-tree edits on `ticket/cu-z8pmx9kcv9` until `/publish-pr` stages them.
