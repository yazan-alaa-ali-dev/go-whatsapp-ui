---
ticket: z8pmx9kzc8
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-25
links:
  clickup: "https://app.clickup.com/t/z8pmx9kzc8"
  github: ""
---

# Verification — 17 · Carry `account_id` and `transport` in the outbound webhook

**Outcome: PASSED.** All 10 acceptance criteria are mapped to executed results.

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all absent from the diff.

The change is additive on the wire and read-only in storage: two new payload keys,
two new agent-request fields, one widened `SELECT` list. No schema change, no
migration, no write path touched.

## Commands run

| Command | Result |
|---|---|
| `go build -C src ./...` | clean |
| `go vet -C src ./...` | clean |
| `go test -C src -tags purego -count=1 ./...` (SQLite) | one failure: `TestResolveDocumentMIME` |
| `CHAT_STORAGE_TEST_POSTGRES_URI=… go test -C src -tags purego -count=1 ./...` (**real PostgreSQL 16**) | the same one failure: `TestResolveDocumentMIME` |

`TestResolveDocumentMIME` is **pre-existing**: it was measured failing on this
branch *before any change from this ticket* (recorded in
`plan.md > Validation strategy`) and is unrelated to it — document MIME resolution.

Both engines were run for the **whole** suite, not only the storage package,
because step 1 changes a `SELECT` list and `COALESCE` on a boolean column is
exactly where the two engines disagree. The outcome is identical on both.

### `-race` could not be run on this host

The plan made the race detector part of validation. It cannot run here: `-race`
requires cgo and this machine has no C toolchain —

```
cgo: C compiler "gcc" not found: exec: "gcc": executable file not found in %PATH%
```

— which is the same reason the suite runs under `-tags purego`
(`modernc.org/sqlite`). This is recorded as a limitation of the host, not a skipped
check.

AC-7 is instead proved **deterministically**, which is a stronger guard than a
detector that only trips when the scheduler cooperates:
`forwardToWebhooks` runs **synchronously**, and `go forwardToChatwoot(...)` is
spawned after it with the same payload map. So if the two keys are present when
`submitWebhookFn` is called, they were necessarily written before that goroutine
existed. `TestWebhookRoutingIsInjectedBeforeDelivery` asserts exactly that: moving
the injection below the `go` statement makes it **fail**, not flake.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| **AC-1** payload carries `account_id` (`""` = no account) and `transport` (`whatsmeow`/`meta_cloud`, stored `""` reads as `whatsmeow`), closed-list on read | PASS | `TestWebhookPayloadCarriesAccountAndTransport` (values present), `TestWebhookPayloadEmptyAccountIsNotAnError` (`""` is **written**, not omitted; stored `""` reports `whatsmeow`), `TestWebhookPayloadTransportPassesTheClosedList` (a stored `"smoke-signal"` reports `whatsmeow` rather than being echoed). |
| **AC-2** every existing field keeps its value; an existing consumer does not break | PASS | `TestWebhookPayloadPreservesExistingFields` compares **per field** — `event`, `device_id`, deep-equal on the inner `payload`, and `session_id` still absent on an event that had none — plus an exact key-set assertion that nothing but the two new keys appeared. Deliberately **not** a whole-document byte comparison: `json.Marshal` sorts map keys and `account_id` sorts first, so the bytes necessarily differ while every field value is unchanged. `TestWebhookPayloadDoesNotOverwriteUpstreamKeys` additionally pins that an upstream producer's values survive. |
| **AC-3** `agentRequest` gains `AccountID` and `Transport` | PASS | `TestBuildAgentRequestCarriesAccountRouting` (values + both keys present in the marshalled body), `TestBuildAgentRequestWithoutADeviceRow` (`"account_id":""` is sent, not omitted), `TestBuildAgentRequestTransportPassesTheClosedList`. |
| **AC-4** `agentResponse` is unchanged | PASS | `TestAgentResponseIsUnchanged` asserts the field set structurally by reflection — exactly `Reply` and `MetadataDebug` — so a later addition fails the test rather than passing review. |
| **AC-5** the helper returns the **row**, and a row is returned even when it carries no usable `webhook_url` | PASS | `resolveDeviceRowForWebhook` returns `*DeviceRecord`; `webhookConfigFromRecord` answers the separate "usable webhook?" question. `TestWebhookPayloadReportsAccountForGlobalFallbackDevice` is the criterion's teeth: a device with an account and **no** `webhook_url` reports `acc_alpha` **and** still falls back to the global list. `TestWebhookConfigFromRecordKeepsTheUsableURLGate` pins the other half — a row with `webhook_events` but no `webhook_url` yields `nil`, so `isEventWhitelistedForDevice` keeps the global whitelist and no currently-delivered event stops being delivered. `TestResolveDeviceRowPrecedence` / `TestResolveDeviceRowJIDWebhookWins` pin which row wins. |
| **AC-6** storage-call count per inbound message is unchanged, proven by counting | PASS | `TestWebhookForwardStorageCallCountIsUnchanged` counts across **both** seams — `webhookStorageForTest` (the JID lookup) and the storage stub (the session-id lookup) — because they are different seams and counting one would make the assertion vacuous. Exact equality: **1** when the JID row carries a usable webhook, **2** on the fallback. `TestResolveDeviceRowJIDWebhookWins` separately asserts the session path runs **0** times when the JID row suffices. Both numbers are the pre-ticket counts: the session-id read swapped `GetDeviceWebhookConfig` for `GetDeviceRecord`, the same primary-key seek (`WHERE device_id = ? LIMIT 1`) returning more columns off a leaf already in memory. |
| **AC-7** injection is synchronous, before the Chatwoot goroutine; no concurrent mutation | PASS | `TestWebhookRoutingIsInjectedBeforeDelivery`, with the ordering argument above. The injection sits in the same `if webhookAllowed` branch and the same position as the pre-existing `addWebhookSessionID`. `-race` unavailable on this host — see above. |
| **AC-8** an unresolvable device still forwards; `account_id` empty, treated as "no account" | PASS | `TestWebhookAmbiguousDeviceStillForwards`: with no row by JID and no session id, the event is **delivered**, `account_id` is present and `""`, `transport` is `whatsmeow`. Refusing to forward would turn a routing gap into a delivery outage. |
| **AC-9** that case is logged | PASS | Same test asserts the line is emitted **once**, and — after a second event on the same JID — still **once**. The line names a customer-facing phone number and this path runs per event, so it is deduped per JID per hour through the `groupNameCache` TTL pattern already in the file. |
| **AC-10** `AGENT_WEBHOOK_SIGN=true` documented as an operating requirement; key decision recorded; not shipped silently | PASS | `readme.md` carries the operating requirement and what signing does and does not protect; `cmd/root.go` warns at startup while signing is off (`cmd` package tests pass unchanged); `agent_bridge.go` records the exposure in the file that carries the payload. The per-account-key decision is recorded in `plan.md > step 6`: **not implemented**, because a per-account key would need a second secret in the database — the pattern ticket 16 refused for `meta_token_ref`. **Owner decision:** the fields are sent regardless of the signing setting (see below). |

## Non-functional criteria

| NFR | Result |
|---|---|
| **NFR-1** backward compatibility | PASS — AC-2. No existing field changed; the two keys are additive. |
| **NFR-2** no added storage reads on the forward path | PASS — AC-6, counted across both seams. |
| **NFR-3** no data race | PASS by construction and by `TestWebhookRoutingIsInjectedBeforeDelivery`; `-race` unavailable on this host. |
| **NFR-4** blast radius stays inside the callers | PASS — `isEventWhitelistedForDevice`, `getWebhookURLsFromConfig` and `forwardToWebhooks` are **untouched**: the projection is built once at the top of `forwardPayloadToConfiguredWebhooks` and threaded exactly as before. `GetDeviceRecord`'s only non-test caller nil-checks its result. |

## Known and accepted

- **The agent request carries account data over an unsigned, globally-shared key.**
  With `AGENT_WEBHOOK_SIGN=false`, `AGENT_WEBHOOK_KEY` travels verbatim in the
  header of every request, and the destination is per-device from the database — so
  any integrator that has received one agent request holds the credential that
  authenticates requests for every other device and account, and can now mint
  requests carrying an arbitrary `account_id`.

  The review panel proposed omitting the two fields on that configuration. **The
  owner directed that they be sent regardless**, because signing is switched off
  deliberately as a testing configuration and withholding data from it defeats its
  purpose. The mitigation is operational — set `AGENT_WEBHOOK_SIGN=true` outside
  testing — and is documented in `readme.md`, warned about at startup, and recorded
  in `agent_bridge.go`.

- **Signing does not remove replay.** The signature covers the request body alone,
  with no timestamp and no nonce, so a captured request stays replayable either
  way. What signing removes is the key being handed to every destination. Closing
  replay is a protocol change on both sides and is named as a follow-up rather than
  implied to be solved.

- **`account_id` leaves the deployment.** It reaches per-device integrator
  endpoints and, on fallback, the global `WHATSAPP_WEBHOOK` list — which may belong
  to a different party than the account does. `docs/webhook-payload.md` states that
  it is an opaque operator identifier and that customer names or emails must not be
  used as account ids. Per ticket 16's NFR-5 an account is not an authorization
  boundary, so no cross-account read is created.

- **The device row is still read more than once per message.** The forward
  goroutine reads it 1–2× and the agent goroutine reads it 1–2× more. They have
  different lifetimes and cancellation, so deduplicating across them is a design
  change; recorded as a follow-up alongside caching the row on `DeviceInstance`,
  which would remove the read from every path at once.

- **`ListDeviceRecords` and `ListDeviceRecordsByAccount` still omit the webhook
  columns**, so they keep the "the type quietly lies" shape that `GetDeviceRecord`
  just lost. Both are operator-triggered list reads with no consumer for those
  columns; widening them is unrelated scope.
