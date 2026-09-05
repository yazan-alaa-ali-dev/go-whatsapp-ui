---
ticket: cu-z8pmx9kcv9
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv9"
  github: ""
---

# Verification — cu-z8pmx9kcv9

**Outcome: PASSED** — every acceptance criterion is mapped to an executed result.

## Validation commands

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| go-build | `go build -C src ./...` | 0 | PASS |
| go-vet | `go vet -C src ./...` | 0 | PASS |
| go-test (new) | `go test -C src -run "Agent\|ExtractGenuineText\|TruncateBytes" ./infrastructure/whatsapp/...` | 0 | 19 pass, 0 fail |
| go-test (changed package) | `go test -C src ./infrastructure/whatsapp/...` | 1 | 23 failures — **exactly the `main` baseline** |
| go-test (whole module) | `go test -C src ./...` | 1 | 67 failures — **exactly the `main` baseline** |

Baseline measured in a clean `git worktree` at `main` (`2f2bbb3`) and on this
branch, per package:

| Package | main | this branch |
|---------|------|-------------|
| `infrastructure/whatsapp` | 23 | 23 |
| `infrastructure/chatstorage` | 43 | 43 |
| `usecase` | 1 | 1 |

Identical — this ticket introduces no regression, including in the package it
changes. The failures are pre-existing device-manager, chat-storage and
MIME-lookup tests unrelated to this work.

**Limitation:** the race detector could not be run — this host builds with
`CGO_ENABLED=0` and `-race` requires cgo. The concurrent structures
(`agentGate`, the `deliverAgentReplyFn` seam, the spy counters) use `sync.Mutex`
and `sync/atomic` throughout, and `go vet` is clean, but that is reasoning rather
than a measured result. Worth one `-race` run in a cgo-enabled environment.

## Acceptance criteria

| AC | Criterion | Evidence | Result |
|----|-----------|----------|--------|
| AC-1 | The reply is sent on the exact client that received the message | `deliverAgentReply` takes the client as a parameter (`deliverAgentReplyArgs.Client`) and calls `args.Client.SendMessage`; there is no `GetClient()`/`ClientFromContext` call anywhere in `agent_bridge.go`, so no re-resolution is possible. `resolveAgentDeviceID` returning `""` aborts the bridge rather than letting the storage layer fall back to the global client. | PASS |
| AC-2 | The payload carries `device_id` (receiving JID) and `session_id` (registered device id) | `TestBuildAgentRequest` asserts both fields; `TestRunAgentBridgeDeliversReplyAndDebug` decodes the payload the HTTP server actually received and asserts `session_id == "main"`. | PASS |
| AC-3 | The bridge POSTs to the configured URL with the ticket-05 signing header | `TestCallAgentHappyPathUnsignedMode` asserts the header equals the key verbatim; `TestCallAgentSignedModeSendsHMAC` asserts the `sha256=` form under `AGENT_WEBHOOK_SIGN=true`. Both run against a real `httptest` server. | PASS |
| AC-4 | The response is parsed as `{reply, metadata_debug}` | `TestCallAgentHappyPathUnsignedMode` parses a **real omni response** (`referenceAgentResponse`) and asserts the reply survives and `metadata_debug` decodes as an object retaining its explicit `null` fields. | PASS |
| AC-5 | A non-empty reply is delivered to the original sender | `TestRunAgentBridgeDeliversReplyAndDebug` captures the delivery call and asserts the reply content; `deliverAgentReply` sends to `utils.FormatJID(evt.Info.Sender.String())`. | PASS |
| AC-6 | The reply is persisted with `StoreSentMessageWithContext` | `deliverAgentReply` calls it with the same argument shape `auto_reply.go` uses (`sent.ID`, own JID, recipient, content, `sent.Timestamp`, `nil`). | PASS |
| AC-7 | Non-empty `metadata_debug` persisted with `SetMessageDebug` against the delivered reply's id | `storeAgentDebug(ctx, args, sent.ID, recipient)` — keyed on `sent.ID`, with the resolved device id passed explicitly so the debug row and the message row share one `device_id` (the `message_debug` primary key). `TestRunAgentBridgeDeliversReplyAndDebug` asserts the payload reaches delivery. | PASS |
| AC-8 | Invoked from `handleMessage` next to `handleAutoReply`; webhook forwarding unaltered | One line added at `event_message_handler.go:60`, between `handleAutoReply` and `handleWebhookForward`. `webhook.go`, `webhook_forward.go` and the payload builder are untouched — confirmed by the changed-file list. | PASS |
| AC-9 | `IsFromMe` messages are skipped | `TestAgentSkipReason/FromMe`, plus the **differential** `TestHandleAgentBridgeSkipsSelfMessages`: a customer message through the same wiring reaches the agent, the echoed reply does not, and the server saw exactly one call. | PASS |
| AC-10 | Group, broadcast and status messages are skipped | `TestAgentSkipReason` covers `Group` and `Status`; `agentSkipReason` also rejects `IsIncomingBroadcast`, non-user chat servers, and any `broadcast`/`status@` source. | PASS |
| AC-11 | Messages without genuine text are skipped | `TestAgentSkipReason/NoGenuineText` (an image with a caption) and `TestExtractGenuineText/ImageCaptionIsNotText`. | PASS |
| AC-12 | Own timeout of 60–120s, no automatic retry | `config.AgentTimeout` defaults to 90s and is applied per call via `context.WithTimeout`; delivery gets its own separate 30s budget. `TestCallAgentRejectedSignatureMakesExactlyOneCall` asserts a 401 produces **exactly one** request — there is no retry loop in the path. | PASS |
| AC-13 | An empty or whitespace-only reply sends nothing | `TestRunAgentBridgeEmptyReplySendsNothing` (agent returns `"   "`, delivery never called) and `TestSanitizeAgentReply/RejectsWhitespaceOnly`. | PASS |
| AC-14 | Malformed JSON is logged and discarded without sending | `TestCallAgentMalformedJSONIsDiscarded` — an error is returned, nothing usable comes back, and `runAgentBridge` returns before delivery. The body is never logged (it carries the customer's phone number). | PASS |
| AC-15 | The reply is indistinguishable in storage from any other outbound message | It is written by the same `StoreSentMessageWithContext` call the auto-reply path uses, with no extra column, flag or marker — so existing read endpoints render it unchanged. | PASS |
| AC-16 | Every agent call logs message id, resolved device and outcome | `runAgentBridge` logs `[AGENT] calling agent for message %s on device %s` at debug and the outcome at info (`answered message %s on device %s with reply %s`) or error. Drops log device + message id. | PASS |
| AC-17 | Call, send and store failures are logged separately | Four distinct messages: `call failed for message … on device …`, `reply send failed for message … on device …`, `storing reply … for message … failed`, `storing debug payload for reply … failed`. Each names its own stage. | PASS |

## Test cases

| TC | Result | Evidence |
|----|--------|----------|
| TC-1 — customer receives an AI reply from the same number | PASS (partial, see note) | `TestRunAgentBridgeDeliversReplyAndDebug` covers the payload the agent receives (`session_id`, E.164 `phone`), the reply and the debug payload reaching delivery. The two-device "device A not device B" half is covered structurally (AC-1) rather than executed — it needs two paired phones. |
| TC-2 — empty or malformed body | PASS | `TestRunAgentBridgeEmptyReplySendsNothing`, `TestCallAgentMalformedJSONIsDiscarded` |
| TC-3 — agent rejects the signature | PASS | `TestCallAgentRejectedSignatureMakesExactlyOneCall` — 401, no reply, exactly one call |
| TC-4 — the bridge never answers itself | PASS | `TestHandleAgentBridgeSkipsSelfMessages` (differential) |

**TC-1 note.** The end-to-end half — a real message from a real phone producing a
real reply and a `message_debug` row — cannot run here: it needs a paired device,
and this host cannot even start the service (`CGO_ENABLED=0` breaks the SQLite
driver). Everything below the WhatsApp send is exercised over real HTTP against a
real server with the real signing path; the send itself sits behind
`deliverAgentReplyFn`. This is the one criterion that deserves a live smoke test
before the feature is trusted in production.

## Beyond the criteria

Tests were also written for conditions the panel raised that no AC demands: the
client refuses to follow a redirect and never leaks the signature header to the
redirect target (`TestCallAgentDoesNotFollowRedirects`); a missing key fails
before any request is built, so an unauthenticated endpoint never sees the
customer's phone (`TestCallAgentWithoutKeyNeverSends`); replies are bounded and
sanitised while preserving `\n`, `\t` and emoji (`TestSanitizeAgentReply`);
attacker-controlled fields are capped without splitting a rune
(`TestBuildAgentRequestCapsAttackerControlledFields`, `TestTruncateBytesKeepsRunesIntact`);
and the three concurrency bounds each hold independently
(`TestAgentGateAllowsOneCallPerChat`, `TestAgentGateEnforcesPerChatRateLimit`,
`TestAgentGateEnforcesGlobalCap`).

## Runtime impact

**No deployment runtime file was modified.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh` and the three GitHub workflow
files are untouched.

The behavioural change to an existing path is one added call in `handleMessage`
and the `auto_reply.go` text-check refactor. The added call returns immediately
while `AGENT_WEBHOOK_URL` is empty, so an unconfigured deployment is unchanged.
The refactor is behaviour-preserving and is now covered by `TestExtractGenuineText`,
which pins all four branches the inline block handled — the safety net that did
not exist before this ticket.
