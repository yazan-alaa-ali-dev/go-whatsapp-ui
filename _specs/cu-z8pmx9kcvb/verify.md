---
ticket: cu-z8pmx9kcvb
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvb"
  github: ""
---

# Verification — cu-z8pmx9kcvb

**Outcome: PASSED** — every acceptance criterion in `spec.md` is mapped below to
an executed, named test.

## Commands run

From `src/`:

```
go build ./...   → clean
go vet ./...     → clean
go test ./validations/... ./infrastructure/agent/... ./ui/rest/... ./cmd/... ./pkg/... -count=1
```

```
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/validations           4.818s
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/agent  2.682s
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/ui/rest               9.137s
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/ui/rest/middleware    6.142s
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/cmd                  11.099s
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/pkg/utils            30.525s
```

No validation profile from `project-config.yaml` was referenced, so no
profile-execution path ran.

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** route exists, device-scoped | PASS | `TestAgentToggleHappyPath` — mounted behind a real `middleware.DeviceMiddleware` with one registered device; 200 with the upstream body. |
| **AC-2** 401 without credentials, no upstream call | PASS | `TestAgentToggleRequiresCredentials` — 401 and the client's call counter stays 0. |
| **AC-3** 400 `DEVICE_ID_REQUIRED` with several devices | PASS | `TestAgentToggleRequiresDeviceID` — two devices registered via `NewDeviceInstance` + `AddDevice`, no `X-Device-Id` → 400 / `DEVICE_ID_REQUIRED`, counter 0. |
| **AC-4** `enabled` → `#debug on` / `#debug off` | PASS | `TestToggleDebugSendsCommandAndSignature` (both sub-cases) reads the body the fake omni received; `TestDebugToggleCommandMapping` locks the mapping at the domain level. |
| **AC-5** signing header via the shared helper | PASS | `TestToggleDebugSendsCommandAndSignature` recomputes `utils.AgentSignatureValue(receivedBody)` independently and compares; `TestToggleDebugSignsWithHMACWhenEnabled` repeats it with `AGENT_WEBHOOK_SIGN=true` and asserts the `sha256=` form. |
| **AC-6** upstream body returned unmodified | PASS | `TestToggleDebugReturnsUpstreamBodyUnmodified` (byte-identical at the client) and `TestAgentToggleHappyPath` (the raw HTTP response embeds `…"trace_id":9007199254740993}` verbatim — an unknown field survived and the 2^53+1 integer was not rounded). |
| **AC-7** bad phone → 400, no upstream call | PASS | `TestAgentToggleRejectsBadInput` cases *phone without leading plus*, *phone empty*, *phone not a number* — 400, counter 0. Unit-level: `TestValidateAgentDebugToggle`. |
| **AC-8** bad TTL → 400, no upstream call | PASS | `TestAgentToggleRejectsBadInput` cases *negative ttl* and *zero ttl* — 400, counter 0. Unit-level: `TestValidateAgentDebugToggle`. |
| **AC-9** timeout is a structured error | PASS | `TestToggleDebugTimeout` — upstream blocks, budget shortened via `Client.timeout` → `AGENT_UPSTREAM_TIMEOUT`; `TestAgentToggleMapsUpstreamErrors/timeout` → 504. |
| **AC-10** non-2xx is a structured error | PASS | `TestToggleDebugUpstreamFailures` cases *non-2xx status* and *redirect is refused, not followed* → `AGENT_UPSTREAM_ERROR`; `TestAgentToggleMapsUpstreamErrors/upstream_error` → 502. |
| **AC-11** malformed upstream JSON → 502-style | PASS | `TestToggleDebugUpstreamFailures` cases *body is not JSON*, *body is a JSON array*, *body exceeds the read cap* → `AGENT_UPSTREAM_INVALID_RESPONSE`; `TestToggleDebugOversizeAndParseErrorsDiffer` proves the two causes are named differently rather than conflated. |
| **AC-12** shared `{code, message}` envelope | PASS | `TestAgentToggleMapsUpstreamErrors` decodes every case into `utils.ResponseData`, asserts the exact code, a non-empty message, and `results == nil` on failure; `TestAgentToggleRejectsBadInput` asserts a populated envelope on every 400. |
| **AC-13** audit line carries actor, phone, state, outcome | PASS | `TestAgentToggleWritesAuditLine` — exactly one record containing `actor="admin"`, `device="device-a"`, `phone="+963938113282"`, `requested=on`, `enabled=true`, `expires_at=…`. `TestAgentToggleLogsRejections` proves the failure branch logs too, so the trail has no gaps. |
| **AC-14** no key or signature in logs or responses | PASS | `TestAgentToggleNeverLeaksTheSecret` sweeps three request shapes, checking every response body and every captured log entry for the key and for `sha256=`; `TestToggleDebugErrorsNeverLeakTheSecret` does the same at the client across two failure paths with signing on. |
| **AC-15** inert while unconfigured | PASS | `TestToggleDebugDisabledWithoutURL` and `TestToggleDebugDisabledWithoutKey` → `AGENT_DEBUG_DISABLED`, counter 0; `TestAgentToggleRefusedWithoutBasicAuthConfigured` → 503 with no upstream call. |

Beyond the ACs, three properties the panel asked for are also under test:

- `TestAgentToggleAuditLineResistsLogInjection` — a `phone` carrying a real
  newline and a complete fake record produces **one** audit record with no raw
  newline, and never an unescaped `actor="root"`.
- `TestToggleDebugShedsBeyondInFlightCap` — the call beyond the cap is refused
  with `AGENT_DEBUG_BUSY` rather than queued.
- `TestAgentToggleRejectsOversizeBody` — 413 before binding, counter 0.

## Pre-existing failures (not caused by this ticket)

`go test ./...` reports **24** failures on this machine, in
`infrastructure/whatsapp` (device-manager / whatsmeow `sqlstore` tests) and
`usecase` (`TestResolveDocumentMIME/Zip`).

Confirmed pre-existing rather than assumed: the parent branch
`ticket/cu-z8pmx9kcv9` (commit `fa02a12`) was checked out into a separate git
worktree and the same packages run there — **24 failures, the same set**. The
count is identical on both branches, and this ticket touches none of those files.

Causes, for the record:

- The `sqlstore` tests exercise whatsmeow's device store, which behaves
  differently on this Windows/SQLite setup.
- `TestResolveDocumentMIME/Zip` expects `application/zip` but Go's
  `mime.TypeByExtension` reads the Windows registry, which maps `.zip` to
  `application/x-zip-compressed`.

## Runtime impact

**No deployment runtime file was modified.**

Verified against the guarded set: `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml` — none appears in this ticket's diff.

Deployment behaviour is unchanged by default. `AGENT_DEBUG_TOGGLE_URL` has no
default, and while it is empty:

- `POST /agent/debug/toggle` answers `503 AGENT_DEBUG_DISABLED` and opens no
  socket;
- no new startup log line is emitted;
- ticket 06's message bridge reads `AGENT_WEBHOOK_URL` and is untouched;
- every other route is byte-for-byte unaffected.

The one change to shared behaviour is a pure extraction: `logAgentConfiguration`
now calls `logAgentEndpointURL(label, raw)` per endpoint instead of inlining the
checks once. The checks themselves are unchanged; what changed is that they now
also run when only the toggle URL is configured, which previously would have been
skipped entirely.

Operators enabling the route need three settings together —
`AGENT_DEBUG_TOGGLE_URL`, `AGENT_WEBHOOK_KEY` and `APP_BASIC_AUTH`. Startup logs
an error naming any that is missing, and the route refuses rather than degrading
to an unauthenticated oracle.
