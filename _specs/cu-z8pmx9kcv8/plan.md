---
ticket: cu-z8pmx9kcv8
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv8"
  github: ""
---

# Plan — cu-z8pmx9kcv8

> 05 · Add agent configuration and phone format helpers.
> Configuration + pure helpers only. No HTTP call, no event wiring, no route.
>
> **Revision 1 (2026-08-18)** — answers every finding from the advisory panel
> (senior / security / performance). Adopted items are marked `[P-n]` where they
> appear below; the three declined items are argued at the end.

## Panel response (Revision 1)

**Adopted — majors**

- `[P-1]` **senior:** `initEnvConfig` opens with `fmt.Println(viper.AllSettings())`
  (`src/cmd/root.go:80`), which dumps every viper key to stdout on every start —
  `agent_webhook_key` included, alongside the already-leaking
  `whatsapp_webhook_secret`, `chatwoot_api_token` and the `DB_URI` password.
  NFR-1/AC-10 are unachievable while that line stands, so the dump is redacted in
  place: credential-shaped keys print a fixed marker and URL-shaped keys print
  through the redactor of `[P-2]`. `src/cmd/root.go` is already in the file list;
  no new file.
- `[P-2]` **security:** the startup line must not print the agent URL verbatim —
  an endpoint routinely carries a token in userinfo or the query string. A new
  `utils.RedactURL` drops userinfo, replaces every query value with `***`, drops
  the fragment, and answers `<invalid-url>` rather than echoing an unparseable
  value. It is unit-tested, which is also the testable form of TC-3.
- `[P-3]` **security:** signing with an empty key yields a well-formed,
  forgeable `sha256=…`. `AgentSignatureValue` therefore returns a sentinel error
  (`ErrAgentKeyMissing`, fixed text — it interpolates neither key nor body, per
  the panel's NFR-1 note) when the key is empty, in both modes, and startup logs
  an error when the URL is set but the key is not.
- `[P-4]` **security:** a non-`https` endpoint with a verbatim key leaks the
  secret on every message. Startup emits one `Warn` when the scheme is not
  `https`, and the README states that plain-key mode requires TLS.
- `[P-5]` **performance:** the timeout default is now stated explicitly —
  `90 * time.Second`, `time.Duration`, bound by `DurationVarP` and the
  `GetString != "" → GetDuration > 0` guard used by `whatsapp_presence_pulse_*`
  (`root.go:202-210`) — with its rationale on the setting itself.

**Adopted — minors**

- `[P-6]` **senior:** `logAgentConfiguration()` moves from `src/cmd/helpers.go`
  into `src/cmd/root.go` beside `initApp`, which already runs exactly once for
  both the REST and MCP servers via `cobra.OnInitialize`. `helpers.go` drops out
  of the file list.
- `[P-7]` **senior:** `E164ToJID` is built from the existing
  `CleanPhoneForWhatsApp` + `config.WhatsappTypeUser` (trim and leading-plus
  handling come free) instead of becoming a third phone→JID variant; the
  `chatwootLinkChatJID` twin (`src/ui/rest/chatwoot.go:127-136`) is named in the
  doc comment and deliberately left alone.
- `[P-8]` **performance:** the digit test is a plain byte loop and the JID split
  uses `strings.Cut` — no `regexp`, no `strings.Split` slice allocation on a
  per-message path.
- `[P-9]` **performance:** `AgentSignatureValue`'s doc states that the agent
  settings are init-only and that it is called once per request; if ticket 08
  ever needs runtime mutation it must move to `sync/atomic` rather than lock a
  per-message read.
- `[P-10]` **security:** `AgentWebhookHeader` gets an explicit exported default
  (`config.DefaultAgentWebhookHeader = "X-Agent-Signature"`) and is validated at
  startup against the RFC 7230 token grammar
  (`utils.IsValidHTTPHeaderName`, unit-tested); an invalid name warns and falls
  back to the default instead of failing at the first message.
- `[P-11]` **security:** a non-empty `AGENT_WEBHOOK_URL` is parsed at startup;
  an unparseable value, a missing host, or a non-`http(s)` scheme logs an error
  (through the redactor). It does **not** abort startup — AC-6 makes the empty
  case silent, and a typo in an optional integration must not take a WhatsApp
  gateway down.
- `[P-12]` **security:** the doc comment on `AgentSignatureValue` records that
  the receiver must validate exactly one mode (accepting either creates a
  downgrade path) and that the signature covers the body only, so a captured
  request is replayable — both are contract notes ticket 06 must carry to the
  omni team.
- `[P-13]` **senior:** the new tests save and restore the `config` globals with
  `t.Cleanup` and are not `t.Parallel()`, since `src/pkg/utils` already holds
  in-package tests that would see leaked state.
- `[P-14]` **senior/security:** the README rows state that the key has no
  default and must not be committed; the missing `.env.example` block is recorded
  as a follow-up for ticket 06, when the file is no longer dirty.

**Declined, with reasons**

- **performance — drop `AgentTimeout` to 10–15s.** The peer is a generative
  model; `gowa-study-ar.html` §08 fixes the budget at 60–120s precisely because a
  reply routinely takes tens of seconds, and 15s would time out correct replies.
  The reviewer's real concern — unbounded in-flight calls at one goroutine per
  message — is genuine but belongs to the caller, so it is recorded on the
  setting and in "Out of scope" as a requirement on ticket 06: bound concurrency
  with a worker pool or semaphore.
- **security — use a distinct header (`X-Hub-Signature-256`) for signed mode.**
  AC-1/AC-2/AC-3 define one *configured* header carrying both modes, and the
  omni contract in §08 names it. Changing the wire shape unilaterally would break
  the agreed integration; the downgrade risk is documented instead `[P-12]`.
- **security — add a timestamp/nonce to the signed material.** Same reason: it
  changes the signed payload the omni team validates against. Recorded for 06 to
  raise with them rather than decided here.
- **senior — drop `AgentEnabled()` as speculative.** Kept: it acquires a caller
  in this ticket (the startup check) and is the single expression of AC-6
  ("empty URL disables the integration"), which 06 and 08 must not each re-derive.

## Approach

Three additive pieces, each following a pattern the repository already uses, so
tickets 06 and 08 find a finished seam instead of a decision:

1. **Configuration (AC-1, AC-6).** Five package-level variables in
   `src/config/settings.go` (`AgentWebhookURL`, `AgentWebhookHeader`,
   `AgentWebhookKey`, `AgentWebhookSign`, `AgentTimeout`), each with a persistent
   cobra flag in `initFlags()` and a viper binding in `initEnvConfig()` —
   byte-for-byte the shape used by the Chatwoot and webhook settings next to
   them. `AgentWebhookURL` defaults to `""`, which is the disabled state: nothing
   validates it at startup, so an unconfigured deployment behaves exactly as it
   does today (AC-6). The key defaults to `""` rather than to the study
   document's `test-key-123`, so a shared secret can never be shipped in the
   binary.

2. **One signing seam (AC-2, AC-3, AC-9).** A new `src/pkg/utils/agent.go`
   exposing `AgentSignatureValue(body []byte) (string, error)`, which reads
   `config.AgentWebhookSign` **on every call** and returns either the key
   verbatim or `"sha256=" + utils.GetMessageDigestOrSignature(body, key)`. The
   whole flip lives in one `if` inside one function, so enabling HMAC later is an
   environment change (AC-9) and the digest primitive is reused, not
   re-implemented (NFR-3). A companion `AgentEnabled()` gives 06/08 one
   definition of "configured" instead of each re-testing the URL. `pkg/utils`
   already imports `config` (`general.go`, `whatsapp.go`), so no new dependency
   edge is created.

3. **Phone helpers (AC-4, AC-5, AC-7, AC-8).** `JIDToE164` and `E164ToJID` added
   to the existing `src/pkg/utils/phone.go`, beside `NormalizePhoneE164` /
   `ExtractPhoneFromJID`. They are deliberately *not* folded into
   `NormalizePhoneE164`: that function returns a bare `"+"` for
   `"@s.whatsapp.net"`, which is precisely the partial result AC-7 forbids, and
   it has four existing call sites whose behaviour must not shift. `E164ToJID`
   builds the JID from `config.WhatsappTypeUser`, the constant every other JID
   builder in the repository uses.

Startup visibility (AC-10) is one `logrus.Infof` emitted from `initApp()` in
`src/cmd/root.go` via a small `logAgentConfiguration()` helper in
`src/cmd/helpers.go` — the file that already owns cross-server startup wiring, so
both the REST and MCP servers get it from one place. It prints URL, header name,
signing mode and timeout, and never the key. When the URL is empty it emits a
`Debug` line only, keeping "disabled" silent (AC-6).

## Steps

1. `src/config/settings.go` — add the five variables in one commented block
   after the Chatwoot block, stating that an empty URL disables the integration.
2. `src/cmd/root.go` — add five `rootCmd.PersistentFlags()` registrations in
   `initFlags()` and five viper reads in `initEnvConfig()`
   (`agent_webhook_url`, `agent_webhook_header`, `agent_webhook_key`,
   `agent_webhook_sign`, `agent_timeout`), using the `GetString != ""` guard for
   strings/durations and `viper.IsSet` for the boolean — the guards already used
   for `app_ui_*` and `chatwoot_*`, and `DurationVarP` + `GetDuration > 0` for
   the timeout `[P-5]`.
3. `src/cmd/root.go` — redact the `viper.AllSettings()` startup dump `[P-1]`, and
   add `logAgentConfiguration()` beside `initApp`, called from it `[P-6]`. The
   line reports URL (redacted `[P-2]`), header, signing mode and timeout; it
   warns on a non-`https` scheme `[P-4]`, errors on a malformed URL `[P-11]` or a
   missing key `[P-3]`, and falls back to the default header name when the
   configured one is not a valid HTTP token `[P-10]`.
4. `src/pkg/utils/phone.go` — add `JIDToE164` and `E164ToJID`.
5. `src/pkg/utils/agent.go` — new file: `AgentEnabled()`,
   `AgentSignatureValue()`.
6. `src/pkg/utils/phone_test.go` — new table-driven tests (TC-2).
7. `src/pkg/utils/agent_test.go` — new table-driven tests (TC-1, TC-3), computing
   the expected HMAC independently in the test so a regression in the production
   path cannot self-certify.
8. `README.md` — five rows in the environment-variable table and one flag bullet.

### Behavioural detail worth fixing now

- `JIDToE164` trims whitespace, cuts at `@`, drops a whatsmeow device/agent
  suffix (`963938113282:12@s.whatsapp.net` → `+963938113282`, the exact shape
  `evt.Info.Sender.String()` produces in ticket 06), tolerates a leading `+`
  already present, and returns `""` unless what remains is **all digits** — so
  `""`, `"@s.whatsapp.net"` and `"abc@s.whatsapp.net"` all return `""` (AC-7)
  instead of a plausible-looking `"+abc"`.
- `E164ToJID` trims whitespace, drops a leading `+`, and returns `""` for an
  empty result rather than the domain-only `"@s.whatsapp.net"` (AC-8).
- Server/domain filtering (`@lid`, `@g.us`, `@newsletter`) is **not** done here.
  A `@lid` user part is numeric but is not a phone number; the caller in ticket
  06 already guards groups and broadcasts before it reaches these helpers, and
  putting the policy in a format converter would hide it. Documented on the
  function so 06 makes the choice explicitly.

## Files to change

| File | Change |
|------|--------|
| `src/config/settings.go` | +`DefaultAgentWebhookHeader` const, +5 settings (`AgentWebhookURL`, `AgentWebhookHeader`, `AgentWebhookKey`, `AgentWebhookSign`, `AgentTimeout`) |
| `src/cmd/root.go` | +5 flags in `initFlags()`, +5 env bindings in `initEnvConfig()`, redact the `viper.AllSettings()` dump `[P-1]`, +`logAgentConfiguration()` called from `initApp()` `[P-6]` |
| `src/pkg/utils/phone.go` | +`JIDToE164`, +`E164ToJID` |
| `src/pkg/utils/agent.go` | **new** — `AgentEnabled()`, `AgentSignatureValue()`, `RedactURL()`, `IsValidHTTPHeaderName()` |
| `src/pkg/utils/agent_test.go` | **new** — signing-mode, redaction and header-name tests |
| `src/pkg/utils/phone_test.go` | **new** — conversion tests |
| `README.md` | +5 env rows, +1 flag bullet |

No other file is touched. No deployment runtime file is touched. `.env.example`
is deliberately excluded: it carries unrelated uncommitted edits in this working
tree, and staging it would drag them into this ticket's commit.

## Validation strategy

Profile `go-source` (`.claude/project-config.yaml > validation_profiles`):

- `go build -C src ./...` — the module compiles.
- `go vet -C src ./...` — no suspicious constructs.
- `go test -C src ./...` — full suite, including the two new test files.

Plus a manual startup check for AC-10/AC-6: run the binary once with
`AGENT_WEBHOOK_URL` set (expect one info line with URL + sign mode, no key) and
once unset (expect a clean start with no agent line and no error).

## Rollback

Every change is additive and inert while `AGENT_WEBHOOK_URL` is empty — nothing
existing reads the new settings or helpers in this ticket. Rollback is
`git revert` of the single publishable commit, or simply leaving
`AGENT_WEBHOOK_URL` unset, which returns the service to exactly today's
behaviour with no migration, no schema change and no data to undo.

## Out of scope

- The HTTP client / `AgentTransport` interface and the outbound call (06).
  **Carried requirement for 06:** with a 90s budget and no retry, the bridge must
  bound how many agent calls are in flight (worker pool or semaphore) instead of
  one goroutine per inbound message — see the declined performance finding.
- `handleAgentBridge` and its placement in the event chain (06).
- Adding the five keys to `.env.example` — deferred to 06 `[P-14]`; the file
  carries unrelated uncommitted edits in this working tree.
- `/agent/*` dashboard proxy routes and the debug toggle (08).
- `.env.example`, `docker-compose.yml`, and every other deployment runtime file.
