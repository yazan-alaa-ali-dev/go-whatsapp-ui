---
ticket: cu-z8pmx9kcvb
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-19
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvb"
  github: ""
---

# Implementation — cu-z8pmx9kcvb

08 · Add the debug mode toggle proxy endpoint.
Branch `ticket/cu-z8pmx9kcvb`, cut from `ticket/cu-z8pmx9kcv9` (ticket 06, PR #5)
because 05's signing helper and 06's agent conventions are hard dependencies and
are not on `main` yet. The PR targets that branch, not `main`.

## Files changed

### New

| File | Lines | What it holds |
|------|-------|---------------|
| `src/domains/agent/agent.go` | 65 | `DebugToggleRequest` (pointer `Enabled`/`TTLMinutes`), `DebugToggleResult` (raw body + audit values), `IAgentUsecase`, `IAgentClient`, and the `Command()`/`State()` boolean→command mapping. |
| `src/pkg/error/agent_error.go` | 70 | Five fixed-code `type X string` errors — `AGENT_DEBUG_DISABLED`, `AGENT_DEBUG_BUSY`, `AGENT_UPSTREAM_ERROR`, `AGENT_UPSTREAM_TIMEOUT`, `AGENT_UPSTREAM_INVALID_RESPONSE`. |
| `src/validations/agent_validation.go` | 47 | `ValidateAgentDebugToggle` — ozzo `Required` + `is.E164`, `NotNil` on `Enabled`, an explicit leading-`+` rule and an explicit positive-TTL rule. |
| `src/validations/agent_validation_test.go` | 128 | Table over the accepted and rejected shapes, plus the command mapping. |
| `src/infrastructure/agent/client.go` | 229 | The hardened HTTP client, the in-flight semaphore, the signed POST and the outcome mapping. |
| `src/infrastructure/agent/client_test.go` | 491 | Command/signature/`device_id` assertions in both sign modes, pass-through, every failure path, the shed-not-queue proof, and the secret-leak sweeps. |
| `src/usecase/agent.go` | 30 | `NewAgentService` / `ToggleDebug` — validate, then delegate. |
| `src/ui/rest/agent.go` | 164 | `InitRestAgent`, the handler, the audit line and the error→envelope mapping. |
| `src/ui/rest/agent_test.go` | 471 | Auth, device scoping, validation, envelope, audit line, log-injection and secret-leak coverage through the real middleware stack. |

### Modified

| File | Change |
|------|--------|
| `src/config/settings.go` | `AgentDebugToggleURL` (default `""`), documented as a separate endpoint rather than one derived from `AgentWebhookURL`. |
| `src/cmd/root.go` | `agent_debug_toggle_url` viper binding; `--agent-debug-toggle-url` flag; `logAgentConfiguration` split so `logAgentEndpointURL(label, raw)` runs per endpoint; `agentUsecase` var, import and construction. |
| `src/cmd/rest.go` | `rest.InitRestAgent(r, agentUsecase)` inside `registerDeviceScopedRoutes`. |
| `docs/openapi.yaml` | New `agent` tag and the full `/agent/debug/toggle` operation with all seven response codes. |
| `readme.md` | "Agent Debug Toggle Proxy" section with a working `curl`, and `AGENT_DEBUG_TOGGLE_URL` in the environment table. |

Nothing outside this list was touched. **No deployment runtime file was modified**
(`docker-compose.yml`, `docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`).

## Deviations from the plan

Three, all discovered while making the tests pass. Each is a correction to the
plan's *stated mechanism*, not to its intent — no acceptance criterion moved.

1. **`validation.NotNil`, not `validation.Required`, on `Enabled`.** The plan
   said `Required` on the `*bool` would reject only a missing field. It does not:
   ozzo's `Required` inspects the *pointed-to* value, and `false` is the zero
   value of a bool — so `{"phone":"…","enabled":false}`, the legitimate "turn
   debug off" request, was rejected as blank. `NotNil` checks the pointer itself,
   which is what was meant. Caught by
   `TestValidateAgentDebugToggle/valid_disable_without_ttl`.

2. **The positive-TTL rule is explicit, not `validation.Min(1)`.** Same root
   cause from the other side: ozzo skips empty values, so `Min(1)` silently
   passed a supplied `ttl_minutes: 0` — precisely the value AC-8 exists to
   reject. Replaced with a direct `!= nil && < 1` check after the ozzo pass.
   Caught by `TestValidateAgentDebugToggle/zero_ttl`.

3. **The pass-through assertion runs against the raw response bytes.** The plan
   said to assert `results` byte-identically after decoding the response into
   `utils.ResponseData`. That cannot work: `Results` is an `any`, so decoding it
   produces a `map[string]any` and re-marshalling *the test's own copy* reorders
   keys and rounds `9007199254740993` to `…92` — the test would have failed while
   the handler was correct. `agentPost` now also returns the raw body and the
   assertion runs on that. The handler was never changed; only the assertion was.

Two smaller notes:

- `strconv.Itoa` is used for the status code in the upstream-error message; the
  first draft hand-rolled an `itoa` to avoid importing `fmt`, which was pointless
  since `strconv` is already the right tool.
- `src/ui/rest/agent_test.go` asserts on logrus's own test hook
  (`logrus/hooks/test`) rather than a string sink. A sink captures the *text
  formatter's* output, in which every `%q` is escaped a second time, so the
  assertions would have been testing the formatter rather than the handler.

## Panel findings — where each one landed

All 25 adopted findings from `plan.md > Panel response` are in the code:

| Finding | Where |
|---------|-------|
| `[P-1]` HTTP out of `usecase` | `infrastructure/agent/client.go`; `usecase/agent.go` is 30 lines of orchestration |
| `[P-2]` validation in `validations/` + leading-plus | `validations/agent_validation.go:26-42` |
| `[P-3]` fixed-code error types | `pkg/error/agent_error.go` |
| `[P-4]` `[P-8]` per-endpoint URL checks | `cmd/root.go` `logAgentEndpointURL`, called for both URLs outside the `AgentEnabled()` return |
| `[P-5]` basic auth required | `ui/rest/agent.go` (503) + a startup error in `logAgentConfiguration` |
| `[P-6]` `device_id` sent upstream | `infrastructure/agent/client.go` payload |
| `[P-7]` `%q` on logged values | `ui/rest/agent.go` audit lines |
| `[P-9]` shed, don't queue | `Client.slots`, non-blocking `select` |
| `[P-10]` budget from `c.Context()` | `context.WithTimeout(ctx, c.timeout)` on the request's own context |
| `[P-11]` `[P-12]` raw body, one decode | `DebugToggleResult.Body json.RawMessage`, single `json.Unmarshal` into `upstreamAudit` |
| `[P-13]` transport mirrors the bridge | `httpClient` incl. `Proxy: http.ProxyFromEnvironment` |
| `[P-14]` two pools recorded | `client.go` comment on `maxConnsPerHost` + `plan.md > Risks` |
| `[P-15]` budget injectable | `Client.timeout` field |
| `[P-16]` over-size detected | `io.LimitReader(body, maxResponseBytes+1)` + separate 4 KiB drain |
| `[P-17]` endpoint not disclosed | `utils.RedactURL` only in `logrus` calls; messages carry no URL |
| `[P-18]` signing-error branch | `errors.Is(err, utils.ErrAgentKeyMissing)` → 503, else 502 |
| `[P-19]` body bound | `maxToggleBodyBytes` check before binding |
| `[P-20]` one DTO | Fiber binds `domainAgent.DebugToggleRequest` directly |
| `[P-21]` OpenAPI | `docs/openapi.yaml` |
| `[P-22]` no new startup warning | only logged when the toggle URL *is* configured |
| `[P-23]` `basicauth.New` in tests | `newAgentTestApp` |
| `[P-24]` rollback counts | corrected in `plan.md` |
| `[P-25]` replay risk named | `plan.md > Risks` |

## Validation run

From `src/`:

```
go build ./...      → clean
go vet ./...        → clean
go test ./...       → see verify.md
```

The ticket's own packages are green:

```
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/validations
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/infrastructure/agent
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/ui/rest
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/pkg/utils
ok  github.com/aldinokemal/go-whatsapp-web-multidevice/cmd
```

24 tests fail across `infrastructure/whatsapp` and `usecase` on this machine.
They were confirmed pre-existing by checking out the parent branch
(`ticket/cu-z8pmx9kcv9`, commit `fa02a12`) into a separate worktree and running
the same packages: **24 failures there too, the same ones.** They are
environment-specific — whatsmeow `sqlstore` behaviour and a Windows registry MIME
mapping that answers `application/x-zip-compressed` where the test expects
`application/zip`. Detail in `verify.md`.

## Commit

None. Per the delivery boundary, `/implement` creates no commit — the single
publishable commit is made by `/publish-pr`.
