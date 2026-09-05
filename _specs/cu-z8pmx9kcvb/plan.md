---
ticket: cu-z8pmx9kcvb
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-08-18
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvb"
  github: ""
---

# Plan — cu-z8pmx9kcvb

> 08 · Add the debug mode toggle proxy endpoint.
> Branch `ticket/cu-z8pmx9kcvb`, cut from `ticket/cu-z8pmx9kcv9` (ticket 06,
> PR #5) because 05's configuration/signing helpers and 06's agent conventions
> are hard dependencies and are not on `main` yet. The PR targets that branch,
> not `main`.

## Panel response (Revision 1, 2026-08-18)

The advisory panel (`senior-reviewer`, `security-reviewer`,
`performance-reviewer`) reviewed the first draft of this plan before any code was
written. Adopted findings are marked `[P-n]` where they appear below; three are
declined with reasons at the end. Everything after this section is the rewritten
plan, not the reviewed draft.

**Adopted — majors**

- `[P-1]` **senior:** the outbound HTTP call sat in `src/usecase/agent.go`, but
  **no file under `src/usecase` makes an external HTTP call** — every outbound
  integration lives under `infrastructure/`. Verified: the only `net/http` use in
  `usecase/send.go` is `http.DetectContentType`. The signed POST moves to a new
  `src/infrastructure/agent` package; `usecase/agent.go` stays thin orchestration.
- `[P-2]` **senior:** hand-rolled validation plus a new `utils.IsValidE164`
  duplicated the repo's grain (`src/validations/*_validation.go` + ozzo +
  `pkgError.ValidationError`). Validation moves there. **But** the proposed
  `is.E164` is not sufficient alone: ozzo v4.3.0's rule is `^\+?[1-9]\d{1,14}$`
  (`is/rules.go:245`) — the plus is *optional*, so `963938113282` would pass and
  AC-7 requires it rejected. The rule is `is.E164` **plus** an explicit
  leading-`+` check, per `validations/AGENTS.md`. `utils.IsValidE164` and the
  `INVALID_PHONE_FORMAT`/`INVALID_TTL` codes are dropped.
- `[P-3]` **senior:** the planned `pkg/error/agent_error.go` introduced a
  *dynamic* code/status struct into a package where every type is `type X string`
  with a fixed code. Adopted: four fixed-code string types in that exact shape.
- `[P-4]` **senior:** `logAgentConfiguration` returns early when
  `AGENT_WEBHOOK_URL` is empty (`cmd/root.go:366-371`), so a deployment setting
  **only** `AGENT_DEBUG_TOGGLE_URL` would get no URL and no header-name
  validation. The checks are factored into a helper run per configured URL,
  outside that early return.
- `[P-5]` **security:** the "admin-only" premise was unenforced — `cmd/rest.go:102`
  installs basic auth only `if len(config.AppBasicAuthCredential) > 0`, default
  none. The handler now refuses (503 `AGENT_DEBUG_DISABLED`) while no credential
  is configured, and startup says so once.
- `[P-6]` **security:** device scoping was decorative — the resolved id only
  reached a log line. `device_id` now goes in the upstream body, as ticket 06's
  payload already does (`agent_bridge.go:68`).
- `[P-7]` **security:** log injection through `phone` — the audit line is written
  on the failure branch too, where `phone` has failed validation by definition.
  Every operator-controlled value now goes through `%q`.
- `[P-8]` **security:** the new URL got none of the scheme/https validation the
  bridge URL gets (`root.go:380-392`), and `AgentWebhookSign` defaults to `false`,
  so an `http://` toggle URL would put the shared secret on the wire unwarned.
  Fixed by the same helper as `[P-4]`.
- `[P-9]` **performance:** `MaxConnsPerHost: 8` is not backpressure — Go's
  transport **queues** the caller. A non-blocking semaphore now sheds with 503
  `AGENT_DEBUG_BUSY`. This also answers the security lens's rate-limit finding.
- `[P-10]` **performance:** the 15s rationale was factually wrong —
  `middleware.DefaultRequestTimeout` is **45s** (`middleware/timeout.go:12`,
  verified), applied at `cmd/rest.go:64`. The budget is now explicitly
  `context.WithTimeout(c.Context(), …)`, so it nests inside the 45s and dies with
  a cancelled request.

**Adopted — minors**

- `[P-11]` **senior:** `map[string]any` is not "unmodified" for AC-6 —
  re-marshalling coerces numbers to `float64` and reorders keys. The body is
  carried as `json.RawMessage` and returned byte-exact.
- `[P-12]` **performance:** with `[P-11]` there is now exactly **one**
  `json.Unmarshal`, into a two-field struct for the audit line, which doubles as
  the AC-11 well-formedness check.
- `[P-13]` **performance/security:** the transport omitted `Proxy` (silently
  ignoring `HTTPS_PROXY`), `MaxIdleConnsPerHost` and `IdleConnTimeout`. It now
  mirrors `agent_bridge.go:86-101` field for field.
- `[P-14]` **performance/senior:** two pools against the same host do not compose
  (32 + 8 sockets). Recorded under Risks; unifying is out of scope (IM-4).
- `[P-15]` **performance/senior:** AC-9 was unverifiable against a package
  `const`. The budget is a struct field, overridable in-package by tests.
- `[P-16]` **performance:** `io.ReadAll(io.LimitReader(…))` truncates an
  over-limit body into a bogus parse failure. It now reads `limit+1` and names
  the over-size case; the drain is capped separately.
- `[P-17]` **security:** `RedactURL` keeps host and path (`utils/agent.go:74-95`),
  so returning it would leak an internal hostname to every caller. It now appears
  in the server log only.
- `[P-18]` **security:** `AgentSignatureValue` can also propagate
  `GetMessageDigestOrSignature`'s error (`utils/agent.go:62-65`). The mapping
  branches on `errors.Is(err, utils.ErrAgentKeyMissing)` → 503, else 502.
- `[P-19]` **security:** the inbound body was bounded only by the global Fiber
  `BodyLimit`, sized for video uploads (`cmd/rest.go:46`). The handler rejects an
  oversized body before decoding.
- `[P-20]` **senior:** `DebugToggleRequest` was declared twice; the Fiber body
  binds straight to the domain DTO, as `ui/rest/call.go:21-22` does.
- `[P-21]` **senior:** `docs/openapi.yaml` was missing from "Files to change",
  and IM-4 forbids touching an unlisted file — the route would have shipped
  undocumented. Added.
- `[P-22]` **senior:** the planned "toggle URL unset while the bridge is on"
  warning would change startup output for existing deployments, against NFR-4.
  Dropped.
- `[P-23]` **senior:** AC-2's test was impossible as written —
  `newBasicAuthMiddleware` is unexported in package `cmd`. The test installs
  `basicauth.New(...)` directly.
- `[P-24]` **senior:** the Rollback file counts disagreed with the table.
- `[P-25]` **security:** this ticket adds a second replayable request type —
  the signature covers the body with no timestamp or nonce
  (`utils/agent.go:44-49`). Owned by ticket 05; now named under Risks.

**Declined**

- **security, "log a masked or hashed phone".** AC-13 requires *the target
  phone*; a masked value would not identify which customer diagnostics were
  enabled for, which is the point of the audit line. Kept in full at `Info`, with
  `[P-7]` removing the injection risk — an accepted, deliberate PII sink.
- **senior, "route errors through `utils.PanicIfNeeded` + `Recovery`".** An
  upstream 500 or timeout is a routine outcome of a proxy, not a programming
  error; `Recovery` would log every one as `"Panic recovered in middleware"`
  (`middleware/recovery.go:24`) and bury the audit line. Errors are mapped
  explicitly, as `ui/rest/chatwoot_config.go:113` already does. The finding's
  substance is adopted in `[P-3]`.
- **senior, "drop the usecase layer".** Every route in
  `registerDeviceScopedRoutes` takes a usecase interface, and that interface is
  what lets the handler test run without a live upstream. The primary
  recommendation — move the HTTP out of `usecase` — is adopted in `[P-1]`.

## Approach

The endpoint is a **thin, stateless proxy**. One request in, one signed request
out, the upstream body handed back byte for byte. It owns no state, caches
nothing, and retries nothing — the omni API owns the TTL, so a local copy would
diverge the moment it expired (`gowa-study-ar.html` §09).

Five decisions shape the code:

1. **Layering follows the repo's actual grain** `[P-1]`: `domains/agent` (DTOs +
   interfaces) → `infrastructure/agent` (the signed HTTP call) →
   `usecase/agent.go` (orchestration) → `validations/agent_validation.go`
   (shape) → `ui/rest/agent.go` (binding, envelope, audit). Outbound HTTP lives
   under `infrastructure/` because that is where every other outbound
   integration in this repo lives.

2. **Reuse `utils.AgentSignatureValue` verbatim** (AC-5). It already switches
   between raw key and `sha256=<hmac>` per call by reading
   `config.AgentWebhookSign`, and it already refuses to sign under an empty key.
   Calling it is the whole of REQ-4; there is nothing to add and nothing to
   duplicate.

3. **The upstream body is `json.RawMessage`, returned byte-exact** `[P-11]`. A
   typed DTO drops unknown fields; a `map[string]any` coerces integers to
   `float64` and reorders keys. Neither is "unmodified". One `json.Unmarshal`
   into a small struct extracts `enabled`/`expires_at` for the audit line and,
   by failing on any non-object body, doubles as the AC-11 check `[P-12]`.

4. **A tighter budget than the bridge, derived from the request context**
   `[P-10]`. `config.AgentTimeout` is 90s because the bridge waits on a
   generative model. This is a control-plane switch answering from a database,
   called synchronously from a handler that already sits inside a 45s server
   budget (`middleware/timeout.go:12`). 15s, taken as
   `context.WithTimeout(c.Context(), …)`, nests correctly inside that and dies
   with a cancelled request.

5. **Shed, don't queue** `[P-9]`. A non-blocking semaphore admits four
   concurrent toggles and answers 503 immediately beyond that, so a slow
   upstream cannot accumulate handler goroutines in the transport's connection
   queue.

Reason it is not built as an extension of ticket 06's `callAgent`: that function
lives in `infrastructure/whatsapp`, is unexported, is shaped around the
`agentRequest`/`agentResponse` pair, and is entered from a detached goroutine
under a gate that exists to bound *inbound message* volume. Widening it to serve
a REST handler would couple two unrelated call sites and force ticket 06's file
open again (IM-4). The one thing that must not fork — the signing helper — is
shared.

## Steps

1. **Config.** Add `config.AgentDebugToggleURL` (default `""`). Empty is the
   disabled state, mirroring `AgentWebhookURL`.
2. **Wiring.** Bind `agent_debug_toggle_url` in `initConfig`; register
   `--agent-debug-toggle-url` beside the other agent flags. Refactor
   `logAgentConfiguration`'s URL checks into `logAgentEndpointURL(label, raw)`
   and call it for **each** configured agent URL, outside the `AgentEnabled()`
   early return; move the header-name check ahead of that return `[P-4]` `[P-8]`.
   Log once at startup when the toggle URL is set while no basic-auth credential
   is configured `[P-5]`.
3. **Domain.** `domains/agent/agent.go`: `DebugToggleRequest`,
   `DebugToggleResult`, `IAgentUsecase`, `IAgentClient`.
4. **Errors.** `pkg/error/agent_error.go`: four fixed-code `type X string` values
   in the shape the package already uses `[P-3]`.
5. **Validation.** `validations/agent_validation.go`: ozzo `Required` +
   `is.E164` + an explicit leading-`+` rule, and `Min(1)` on the TTL pointer
   `[P-2]`.
6. **Infrastructure.** `infrastructure/agent/client.go`: the hardened client and
   the signed POST.
7. **Usecase.** `usecase/agent.go`: `NewAgentService(client)`, `ToggleDebug` —
   validate, map the boolean to the command string, delegate.
8. **Handler.** `ui/rest/agent.go`: `InitRestAgent` + `ToggleDebug` — body-size
   guard, bind, basic-auth gate, call, audit log, error mapping.
9. **Registration.** Construct `agentUsecase` in `root.go` beside the others and
   register `rest.InitRestAgent(r, agentUsecase)` inside
   `registerDeviceScopedRoutes` in `cmd/rest.go`. Verified ordering: basic auth
   is installed at `cmd/rest.go:113`, before `registerDeviceScopedRoutes` at
   `cmd/rest.go:141-142`, and that group carries `DeviceMiddleware` (AC-2, AC-3).
10. **Tests.** `infrastructure/agent/client_test.go`,
    `validations/agent_validation_test.go`, `ui/rest/agent_test.go`.
11. **Docs.** `docs/openapi.yaml` `[P-21]` and `readme.md`.

## Detailed design

### Domain (`domains/agent/agent.go`)

```go
type DebugToggleRequest struct {
    Phone      string `json:"phone"       form:"phone"`
    Enabled    *bool  `json:"enabled"     form:"enabled"`
    TTLMinutes *int   `json:"ttl_minutes" form:"ttl_minutes"`
}
```

The Fiber body binds straight to this DTO `[P-20]`, as `ui/rest/call.go` does.

`Enabled` is a **pointer**: with a plain `bool`, a body that omits or misspells
the field decodes to `false` and silently turns debug *off* for a number the
admin meant to turn *on*. `validations/AGENTS.md` names this exact anti-pattern
("do not use `validation.Required` on a plain `bool` when `false` is valid; use
a pointer"). `TTLMinutes` is a pointer for the mirror-image reason: it is
genuinely optional, and `0` must be distinguishable from "not supplied" so AC-8
can reject it.

`DebugToggleResult` carries `Body json.RawMessage` plus the two audit values.

### Validation (`validations/agent_validation.go`)

```go
validation.ValidateStructWithContext(ctx, &request,
    validation.Field(&request.Phone, validation.Required, is.E164),
    validation.Field(&request.Enabled, validation.Required),
    validation.Field(&request.TTLMinutes, validation.Min(1)),
)
// then, because is.E164 accepts a missing plus (is/rules.go:245):
if !strings.HasPrefix(request.Phone, "+") { … }
```

Wrapped as `pkgError.ValidationError`, per the package's convention. All of it
runs before a socket is opened (AC-7, AC-8).

### Upstream call (`infrastructure/agent/client.go`)

```go
body, _ := json.Marshal(map[string]any{
    "command":     command,        // "#debug on" | "#debug off"
    "phone":       req.Phone,
    "ttl_minutes": req.TTLMinutes, // omitted when nil
    "device_id":   deviceID,       // [P-6]
})
signature, err := utils.AgentSignatureValue(body)   // ticket 05 — one source of truth
```

`device_id` is sent because omni already understands that field — ticket 06's
message payload carries it (`agent_bridge.go:68`) — and without it `X-Device-Id`
would be a header this endpoint validates and then throws away `[P-6]`.

The client mirrors `agent_bridge.go:86-101` field for field `[P-13]`:
`Proxy: http.ProxyFromEnvironment`, `MaxConnsPerHost`/`MaxIdleConnsPerHost`/
`MaxIdleConns`, `IdleConnTimeout: 90s`, a 10s dialer, `TLSHandshakeTimeout: 10s`,
and `CheckRedirect` returning `http.ErrUseLastResponse` — Go's default client
**follows** redirects and re-sends headers, which would hand the signing header
to whatever host a hostile upstream named. A 3xx therefore arrives as a plain
non-2xx and becomes `AGENT_UPSTREAM_ERROR` (AC-10).

The response is read through `io.LimitReader(body, maxResponseBytes+1)` so an
over-limit body is *detected* rather than silently truncated into a parse failure
`[P-16]`; the connection-reuse drain is capped separately and small.

Outcome mapping (AC-9, AC-10, AC-11, AC-15):

| Condition | Code | Status |
|-----------|------|--------|
| `AgentDebugToggleURL` empty | `AGENT_DEBUG_DISABLED` | 503 |
| no basic-auth credential configured `[P-5]` | `AGENT_DEBUG_DISABLED` | 503 |
| `errors.Is(err, utils.ErrAgentKeyMissing)` | `AGENT_DEBUG_DISABLED` | 503 |
| in-flight semaphore full `[P-9]` | `AGENT_DEBUG_BUSY` | 503 |
| `context.DeadlineExceeded` | `AGENT_UPSTREAM_TIMEOUT` | 504 |
| transport error, non-2xx status, other signing error `[P-18]` | `AGENT_UPSTREAM_ERROR` | 502 |
| body not valid JSON, or over the size cap | `AGENT_UPSTREAM_INVALID_RESPONSE` | 502 |

Client-facing messages name the failure and **nothing else** `[P-17]`: no
endpoint, no upstream body (which carries the customer's phone and could carry
anything at all), no signature. The redacted endpoint goes to the server log only.

### Audit log (`ui/rest/agent.go`, AC-13)

```go
logrus.Infof("[AGENT-DEBUG] actor=%q device=%q phone=%q requested=%s outcome=%s",
    actor, deviceID, req.Phone, state, outcome)
```

`%q` on every operator-controlled value, so a newline in `phone` cannot forge a
second audit record `[P-7]`. `actor` is `basicauth.UsernameFromContext(c)`.
`outcome` is `enabled=<v> expires_at=<v>` on success and the error code on
failure — one line per attempt either way, so the trail has no gaps. Neither
branch touches the key or the signature (AC-14).

## Files to change

| File | Change | Why |
|------|--------|-----|
| `src/config/settings.go` | PATCH | `AgentDebugToggleURL` |
| `src/cmd/root.go` | PATCH | env binding, flag, URL-check refactor, `agentUsecase` |
| `src/cmd/rest.go` | PATCH | `rest.InitRestAgent` inside `registerDeviceScopedRoutes` |
| `src/domains/agent/agent.go` | NEW | DTOs + `IAgentUsecase` + `IAgentClient` |
| `src/pkg/error/agent_error.go` | NEW | four fixed-code error types |
| `src/validations/agent_validation.go` | NEW | ozzo shape + leading-plus rule |
| `src/validations/agent_validation_test.go` | NEW | AC-7 / AC-8 table |
| `src/infrastructure/agent/client.go` | NEW | hardened client + signed POST |
| `src/infrastructure/agent/client_test.go` | NEW | upstream behaviour vs `httptest` |
| `src/usecase/agent.go` | NEW | validate → command string → delegate |
| `src/ui/rest/agent.go` | NEW | `InitRestAgent` + handler |
| `src/ui/rest/agent_test.go` | NEW | auth, device scope, envelope, audit |
| `docs/openapi.yaml` | PATCH | document the route |
| `readme.md` | PATCH | endpoint + `AGENT_DEBUG_TOGGLE_URL` |

**No deployment runtime file is touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflow YAMLs).

## Validation strategy

| AC | How it is validated |
|----|---------------------|
| AC-1 | `ui/rest/agent_test.go` mounts the route behind a real `DeviceMiddleware` with one registered device and asserts 200 on a well-formed call. |
| AC-2 | Same app with `basicauth.New(...)` installed `[P-23]` and no `Authorization` header → 401, upstream call counter 0. |
| AC-3 | Two devices registered (`NewDeviceInstance` + `AddDevice`) and no `X-Device-Id` → 400 / `DEVICE_ID_REQUIRED`, counter 0. |
| AC-4 | `httptest` upstream records the body; asserts `#debug on` / `#debug off` for both booleans, and that `device_id` is present `[P-6]`. |
| AC-5 | The same upstream asserts `config.AgentWebhookHeader` is present and equals `utils.AgentSignatureValue(receivedBody)`, recomputed independently in the test, in **both** sign modes. |
| AC-6 | Upstream returns an object with an extra unknown field and a large integer id; the response `results` is asserted byte-identical, proving no field dropped and no `float64` coercion `[P-11]`. |
| AC-7, AC-8 | `validations/agent_validation_test.go` table (`963938113282`, `+0…`, empty, `ttl_minutes` `-5` and `0`) plus a handler test asserting 400 and counter 0. |
| AC-9 | Upstream blocks; the client's budget field is shortened in-test `[P-15]` → 504 `AGENT_UPSTREAM_TIMEOUT`. |
| AC-10 | Upstream returns 500, then 302 → 502 `AGENT_UPSTREAM_ERROR` in both cases (proving redirects are not followed). |
| AC-11 | Upstream returns `not json`, then an over-cap body → 502 `AGENT_UPSTREAM_INVALID_RESPONSE`, with distinct messages `[P-16]`. |
| AC-12 | Every error assertion decodes into `utils.ResponseData` and checks `code` and `message` are non-empty. |
| AC-13 | A `logrus` test hook captures the line; asserts actor, phone, state and outcome are present, and that a newline-bearing phone cannot forge a second record `[P-7]`. |
| AC-14 | The same hook's full output, plus every response body in the suite, is asserted **not** to contain the configured key or the computed signature. |
| AC-15 | Empty `AgentDebugToggleURL` → 503 `AGENT_DEBUG_DISABLED`, counter 0; and empty `AppBasicAuthCredential` → 503 `[P-5]`. |

Commands, run from `src/`:

```
go build ./...
go vet ./...
go test ./validations/... ./infrastructure/agent/... ./usecase/... ./ui/rest/... ./cmd/... ./pkg/...
```

No validation profile from `project-config.yaml` is referenced.

## Risks

- `[P-14]` Two connection pools now target the same omni host — ticket 06's
  `MaxConnsPerHost: 32` plus this one's 8 — so the process's upstream socket
  footprint is 40, not 8. Unifying them means editing `agent_bridge.go`, out of
  scope here (IM-4); left for whichever ticket next opens that file.
- `[P-25]` `AgentSignatureValue` signs the body with no timestamp or nonce
  (`utils/agent.go:44-49`), so this ticket adds a second replayable request type:
  a captured `#debug on` can be replayed to re-enable debug for that number after
  its TTL lapses. Owned by ticket 05's scheme, not fixable here.
- The full customer phone number is written to an `Info` log line by AC-13. A
  deliberate, accepted PII sink (see Declined), not an oversight.
- `DeviceMiddleware` adds `DEVICE_NOT_FOUND` (404) and
  `DEVICE_MANAGER_UNAVAILABLE` (503) failure modes to this route, so the toggle
  fails on a fresh install with no devices paired — the accepted consequence of
  REQ-2.

## Rollback

Every change is additive. Reverting means deleting the **nine** new files and
undoing the **five** patches `[P-24]`; nothing existing changes shape, so there is
no data or schema to migrate back. The one edit to shared code —
`logAgentConfiguration`'s URL checks moving into a helper — is a pure extraction
covered by `cmd/root_test.go`.

Operationally the switch is finer than a revert: leaving `AGENT_DEBUG_TOGGLE_URL`
unset makes the endpoint answer `AGENT_DEBUG_DISABLED` without dialling out,
while every other route — including ticket 06's bridge, which reads a different
variable — is untouched (AC-15).

## Out of scope

- The dashboard toggle UI and its three states — ticket 12.
- Any read/status endpoint for current debug state.
- Storing or caching debug state in GOWA.
- Editing ticket 05's `utils/agent.go` or ticket 06's `agent_bridge.go`
  (including unifying the two HTTP clients — see Risks).
- MCP exposure of the toggle.
- Per-actor or per-phone *rate* limiting. Concurrency is bounded `[P-9]`; rate is
  left to the omni side's own throttle, named here as the compensating control.
