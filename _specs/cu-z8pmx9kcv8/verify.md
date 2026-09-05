---
ticket: cu-z8pmx9kcv8
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv8"
  github: ""
---

# Verification — cu-z8pmx9kcv8

**Outcome: PASSED** — every acceptance criterion is mapped to an executed result
below.

## Validation commands

| Check | Command | Exit | Result |
|-------|---------|------|--------|
| go-build | `go build -C src ./...` | 0 | PASS |
| go-vet | `go vet -C src ./...` | 0 | PASS |
| go-test | `go test -C src ./...` | 1 | PASS with a caveat — see below |
| go-test (touched packages) | `go test -C src ./pkg/utils/... ./cmd/...` | 0 | PASS |

**The `go test ./...` caveat.** 24 tests fail, all in packages this ticket does
not touch: `infrastructure/whatsapp` (device-manager and store-row tests) and
`usecase` (`TestResolveDocumentMIME/Zip`, which expects `application/zip` while
this Windows host's registry answers `application/x-zip-compressed`). The same
suite was run in a clean `git worktree` at `main` (`2f2bbb3`): **24 failures
there as well, the same set**. The failure count is therefore unchanged by this
ticket, and both packages it modifies pass in full.

## Acceptance criteria

| AC | Criterion | Evidence | Result |
|----|-----------|----------|--------|
| AC-1 | Five settings with CLI flags and env bindings | `src/config/settings.go` declares `AgentWebhookURL`, `AgentWebhookHeader`, `AgentWebhookKey`, `AgentWebhookSign`, `AgentTimeout`; `initFlags()` registers `--agent-webhook-url/-header/-key/-sign` and `--agent-timeout`; `initEnvConfig()` binds `agent_webhook_url/_header/_key/_sign` and `agent_timeout`. The env path is exercised end-to-end by the manual startup run, which set all four via the environment and saw them in the startup line. | PASS |
| AC-2 | `AGENT_WEBHOOK_SIGN=false` sends the key verbatim | `TestAgentSignatureValueBothModes` (`pkg/utils/agent_test.go`) asserts the returned value equals the configured key exactly. | PASS |
| AC-3 | `AGENT_WEBHOOK_SIGN=true` sends `sha256=<hmac>` over the exact raw body, reusing `GetMessageDigestOrSignature` | Same test asserts `"sha256=" + hmac`, with the expected digest recomputed independently in the test; `TestAgentSignatureValueSignsRawBody` shows a one-byte body difference changes the signature. `AgentSignatureValue` calls `GetMessageDigestOrSignature` — no second HMAC implementation exists. | PASS |
| AC-4 | `JIDToE164` converts a JID to E.164 with a leading plus | `TestJIDToE164`: `963938113282@s.whatsapp.net` → `+963938113282`, including the device-suffix, bare-number, whitespace and already-plus forms. | PASS |
| AC-5 | `E164ToJID` converts E.164 to a WhatsApp user JID | `TestE164ToJID`: `+963938113282` → `963938113282@s.whatsapp.net`; `TestPhoneRoundTrip` pins JID → E.164 → JID identity. | PASS |
| AC-6 | An empty agent URL disables the integration silently | `TestLogAgentConfigurationDisabledIsSilent` (`cmd/root_test.go`) asserts no error/warning/info line. Manual run with no agent variables: one `level=debug` line and a normal startup path — nothing validated, nothing raised. | PASS |
| AC-7 | `JIDToE164` returns `""` for empty or malformed values | `TestJIDToE164` covers `""`, `"@s.whatsapp.net"`, `"abc@s.whatsapp.net"` and whitespace-only — all `""`, never a partial `"+"`. | PASS |
| AC-8 | `E164ToJID` tolerates a missing plus and surrounding whitespace | `TestE164ToJID`: `" 963938113282 "` → `963938113282@s.whatsapp.net`; `"+"` alone → `""` rather than a domain-only JID. | PASS |
| AC-9 | The signing mode is read once per request | `TestAgentSignatureValueBothModes` flips `config.AgentWebhookSign` **between two calls in one process** and gets two different header values — proving the mode is not captured at init. | PASS |
| AC-10 | Startup logs the agent URL and signing mode, never the key | `TestLogAgentConfigurationNeverLogsTheKey` asserts the line names the host and `sign=true` and does not contain the key. Manual run: the emitted line is `url=…?token=%2A%2A%2A header=X-Agent-Signature sign=true timeout=1m30s`, and `grep -c "super-secret-key"` over the entire startup log returned **0**. | PASS |

## Test cases

| TC | Result | Evidence |
|----|--------|----------|
| TC-1 — both signing modes | PASS | `TestAgentSignatureValueBothModes`, `TestAgentSignatureValueSignsRawBody` |
| TC-2 — malformed phone values | PASS | `TestJIDToE164`, `TestE164ToJID` |
| TC-3 — key never disclosed | PASS | `TestLogAgentConfigurationNeverLogsTheKey`, `TestRedactedSettingsHidesCredentials`, `TestAgentSignatureErrorLeaksNothing`, plus the zero-hit grep over the real startup log |
| TC-4 — unconfigured service starts unchanged | PASS | `TestLogAgentConfigurationDisabledIsSilent` and the manual unconfigured run |

## Beyond the criteria

Three conditions the advisory panel raised are covered by tests even though no AC
demands them: signing with an empty key is refused rather than emitting a
forgeable `sha256=…` (`TestAgentSignatureValueEmptyKey`), a CRLF-bearing header
name is rejected and repaired (`TestLogAgentConfigurationRepairsInvalidHeader`),
and a plaintext endpoint warns that the key travels in clear text
(`TestLogAgentConfigurationWarnsOnPlaintextEndpoint`).

## Runtime impact

**No deployment runtime file was modified.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are all untouched — confirmed by the
changed-file list in `implement.md` and by `git status` on the branch.

The one behavioural change to an existing code path is the startup dump: it now
prints a redacted map instead of the raw `viper.AllSettings()`. That removes the
webhook secret, the Chatwoot API token and the `DB_URI` password from stdout on
every start. Everything else is inert while `AGENT_WEBHOOK_URL` is empty.
