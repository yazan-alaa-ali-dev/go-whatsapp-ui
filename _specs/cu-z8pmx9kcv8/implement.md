---
ticket: cu-z8pmx9kcv8
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv8"
  github: ""
---

# Implementation — cu-z8pmx9kcv8

05 · Add agent configuration and phone format helpers.
Branch `ticket/cu-z8pmx9kcv8`, cut from `main` at `2f2bbb3`.

## Files changed

| File | Change |
|------|--------|
| `src/config/settings.go` | `DefaultAgentWebhookHeader` const; five settings — `AgentWebhookURL`, `AgentWebhookHeader`, `AgentWebhookKey`, `AgentWebhookSign`, `AgentTimeout` (90s) |
| `src/cmd/root.go` | five persistent flags; five viper bindings; `redactedSettings()` replacing the raw `viper.AllSettings()` dump; `logAgentConfiguration()` called from `initApp()` |
| `src/cmd/root_test.go` | **new** — startup-log and settings-dump tests (see deviation below) |
| `src/pkg/utils/agent.go` | **new** — `AgentEnabled`, `AgentSignatureValue`, `RedactURL`, `IsValidHTTPHeaderName`, `ErrAgentKeyMissing` |
| `src/pkg/utils/agent_test.go` | **new** — signing modes, empty key, redaction, header-name validation |
| `src/pkg/utils/phone.go` | `JIDToE164`, `E164ToJID`, unexported `isAllDigits` |
| `src/pkg/utils/phone_test.go` | **new** — conversion and round-trip tests |
| `README.md` | AI-agent flag section; five rows in the environment-variable table |

No deployment runtime file was touched. `.env.example` was deliberately left
alone (it carries unrelated uncommitted edits in this working tree).

## How each panel finding landed

Every adopted finding from the advisory panel (`plan.md > Panel response`) is in
the code:

- `[P-1]` `redactedSettings()` (`root.go`) replaces the verbatim
  `fmt.Println(viper.AllSettings())`. Credential-shaped keys (`key`, `secret`,
  `token`, `password`, `auth`, `uri`, `dsn`) print `***redacted***`; URL-shaped
  values print through `utils.RedactURL`. This also closes the pre-existing leak
  of `whatsapp_webhook_secret`, `chatwoot_api_token` and the `DB_URI` password.
- `[P-2]` `utils.RedactURL` drops userinfo and the fragment, replaces every query
  value, and answers `<invalid-url>` instead of echoing an unparseable value.
- `[P-3]` `AgentSignatureValue` returns `ErrAgentKeyMissing` in **both** modes
  when the key is empty; startup logs an error for the same condition.
- `[P-4]` startup warns when the endpoint is not `https`; README carries the same
  warning.
- `[P-5]` `AgentTimeout` is a `time.Duration`, default `90 * time.Second`, bound
  with `DurationVarP` and the `GetString != "" → GetDuration > 0` guard.
- `[P-6]` the startup logger lives in `root.go` beside `initApp`; `helpers.go`
  was not touched.
- `[P-7]` `E164ToJID` is `CleanPhoneForWhatsApp` + `config.WhatsappTypeUser`; the
  `chatwootLinkChatJID` twin is named in the doc comment and left alone.
- `[P-8]` `isAllDigits` is a byte loop; the JID is split with `strings.Cut`. No
  regexp, no slice allocation.
- `[P-9]`/`[P-12]` the init-only caveat, the once-per-request contract, the
  single-mode requirement on the receiver and the replay limitation are all on
  the `AgentSignatureValue` doc comment.
- `[P-10]` `IsValidHTTPHeaderName` (RFC 7230 token grammar); an invalid name
  warns once and falls back to `X-Agent-Signature`.
- `[P-11]` a non-empty URL is parsed at startup; unparseable, host-less, or
  non-`http(s)` values log an error without aborting startup.
- `[P-13]` both new test files save and restore the `config` globals with
  `t.Cleanup` and none call `t.Parallel()`.
- `[P-14]` the README rows state that the key has no default and must not be
  committed.

## Deviations from the plan

1. **`src/cmd/root_test.go` added** (not in the plan's file list). The senior
   lens's `[P-1]` finding was explicit that TC-3 must not pass unverified, and
   both the startup line and the settings dump live in `package cmd`, so the
   assertion cannot be written from `pkg/utils`. The file adds five tests —
   the key never reaches the log, the disabled state emits nothing above debug,
   a plaintext endpoint warns, an invalid header name is repaired, and the dump
   redacts credentials — and changes no production file.

2. **Nothing else.** No file outside the table above was modified.

## Validation run

Profile `go-source`, from the repository root:

| Check | Command | Result |
|-------|---------|--------|
| go-build | `go build -C src ./...` | exit 0 |
| go-vet | `go vet -C src ./...` | exit 0 |
| go-test | `go test -C src ./...` | 24 pre-existing failures, unchanged |

The 24 failures live in `infrastructure/whatsapp` (device-manager/store tests)
and `usecase` (`TestResolveDocumentMIME/Zip`, which asserts `application/zip`
while this Windows host's registry answers `application/x-zip-compressed`).
They were measured on a clean `main` worktree at `2f2bbb3` and on this branch:
**24 on both**, so this ticket introduces no regression. Every package this
ticket touches — `pkg/utils`, `cmd` — passes.

Manual startup check (built binary, scratchpad working directory):

- **Configured** (`AGENT_WEBHOOK_URL=…?token=super-secret-key`,
  `AGENT_WEBHOOK_KEY=super-secret-key`, `AGENT_WEBHOOK_SIGN=true`,
  `APP_DEBUG=true`) →
  `agent integration enabled: url=https://agent.example.com/omni_api/webhook/whatsapp/chat?token=%2A%2A%2A header=X-Agent-Signature sign=true timeout=1m30s`;
  `grep -c "super-secret-key"` over the whole log = **0**.
- **Unconfigured** → one `level=debug` line
  (`agent integration disabled: AGENT_WEBHOOK_URL is empty`) and nothing at
  info, warning or error.

(Both runs then exit on `CGO_ENABLED=0 … go-sqlite3 requires cgo`, a property of
the local build environment reached after the agent logging under test.)

## No commit created

Per the delivery boundary, `/implement` creates no commit; the changes stay as
working-tree edits on `ticket/cu-z8pmx9kcv8` until `/publish-pr` stages them.
