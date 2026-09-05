---
ticket: z8pmx9m6pg
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6pg"
  github: ""
---

# Plan — 28 · Fall back to SMS when every WhatsApp channel fails

> **Revision 2**, rewritten after the advisory panel (senior / security /
> performance) reviewed revision 1 **against the source**, before any code was
> written. Revision 1 would not have compiled — it specified an import cycle — and
> it carried a duplicate-delivery hole on the sibling attempt. Both are corrected
> here. Every finding is answered in **Panel response** at the end.

## Approach

One boolean column on `accounts`, one deployment-level gateway, and one **stage**
function that each send path calls at exactly one terminal point.

```
migration 76      accounts.sms_fallback_enabled  BOOLEAN NOT NULL DEFAULT FALSE
route             PATCH /accounts/:account_id/sms-fallback
new files         infrastructure/whatsapp/sms_fallback.go   the stage: order, reasons, logging
                  infrastructure/whatsapp/sms_gateway.go    config view + one HTTP call behind a seam
call site 1       usecase.serviceSend.SendText              three structural pre-send points
call site 2       deliverAgentReplyWithFailover             one terminal exit, after both attempts
```

### Where the stage lives — `infrastructure/whatsapp`, not a new package

Revision 1 put it in a new `infrastructure/sms` package on the reasoning that
"`infrastructure/whatsapp` cannot import `usecase`, so the stage must live below
both". That reasoning is **wrong and it does not compile**:

- `usecase/send.go:23` already imports `infrastructure/whatsapp`. That package
  **is** the one both callers can reach; there is nothing to be "below".
- The stage must answer "did this failure prove nothing was written?", which is
  `agent_bridge.go`'s knowledge, and `agent_bridge.go` must import the stage to
  call it. `whatsapp → sms → whatsapp` is a cycle.

So the stage is two files inside `infrastructure/whatsapp`. Outbound vendor HTTP
already lives there — `agent_bridge.go > callAgent` and
`webhook_forward.go > submitWebhookFn` both do it — so this is the established
home, not a new precedent. It also deletes revision 1's step 9 entirely:
`classifyAgentSendError` stays **unexported**, which the security lens showed
matters (see PR-S4).

### Which failures are eligible — structural, never error-sniffed

This is the ticket's central safety property (AC-20, AC-21), so it is decided by
**where control is**, not by inspecting an error value.

**Agent path.** `sendAgentReply` already returns an explicit
`agentAttemptOutcome`, and exactly one of its three values —
`agentRefusedPreSend` — means "nothing reached the socket". The stage is eligible
**only** on that value, for the last attempt made. Nothing is re-derived and
nothing is classified twice.

**Send path.** `SendText` has three structural pre-send points, and **no error is
classified at all**:

| # | Point | Today | Eligible |
|---|---|---|---|
| 1 | `client == nil` | returns `pkgError.ErrWaCLI` | yes |
| 2 | `utils.LoginError(client) != nil` — no live session | `MustLogin` panics inside `ValidateJidWithLogin` | yes |
| 3 | `ValidateJidWithLogin` returns `pkgError.InvalidJID` | returned | yes |
| — | `ParseJID`'s plain `fmt.Errorf` (a malformed phone) | returned | **no** — AC-24 |
| — | anything from `client.SendMessage` | returned | **no** |

The last row is the one revision 1 got wrong. It proposed exporting
`classifyAgentSendError` and asking it about send-path errors. But `SendText`
never sees a raw whatsmeow error worth classifying: `normalizeSendError`
(`usecase/send.go:163`) may substitute `ErrWaReachoutTimelock`, and `ErrWaCLI` /
`InvalidJID` are this layer's own types that the whatsmeow allowlist returns
`false` for. Widening that allowlist to fit would have widened the set that
authorizes a **second WhatsApp send** on the agent path. So: after point 2 the
session is proven live, and any `SendMessage` failure after that is treated as
"may already hold it" and ends the message. One lost message beats two.

Point 3 is matched with `errors.As(err, &invalidJID)`. That type has exactly one
production site inside `ValidateJidWithLogin` (`pkg/utils/whatsapp.go:982`, "not
on whatsapp"); `ParseJID` returns a plain error, so the type test is a closed
allowlist here, and a test pins it.

### The evaluation order inside the stage

```
1  gateway not completely configured  -> skip gateway_unconfigured, DEBUG only, no read
2  the failure did not prove nothing was written -> skip failure_during_sending
3  the originating device has no account (account_id == "")  -> skip no_account
4  the recipient has no dialable E.164 number -> skip no_dialable_number
5  read accounts.sms_fallback_enabled  (the ONLY database access)
       error -> skip fallback_state_unknown ; false -> skip fallback_disabled
6  no free stage slot -> skip gateway_busy
7  truncate if a maximum is configured; ONE gateway call with its OWN budget; log
```

Steps 1–4 and 6 are in-process. **Step 5 is the only read, and it is reached only
on a deployment that has configured a gateway** — so NFR-1 holds by construction:
every deployment that exists today stops at step 1.

Step 1 returns at **debug** level and nothing louder. Revision 1 would have
written an info line per failed message on every deployment that has the feature
off, with a stranger-controlled trigger — the exact unbounded-log pattern
`agentRefusalWarnTTL` exists to prevent, and a direct contradiction of AC-29
("stated once at startup rather than repeated per message").

Two skip reasons beyond the ticket's four are added, and named in the spec:
`no_account` (the majority state of a deployment that never configured accounts)
and `fallback_state_unknown` (a storage read that failed — reporting that as
"disabled" would be a lie an operator would chase). `gateway_busy` is the seventh
and belongs to the concurrency bound below.

### The agent path — five exits, one of which carries three outcomes

`deliverAgentReplyWithFailover` has **five** terminal exits, not four:

| Line | Exit | SMS |
|---|---|---|
| 970 | attempt 1 delivered | never |
| 975 | attempt 1 `agentFailedSending` | never — may already hold it |
| 999 | no candidate after the arrival was skipped | eligible |
| 1008 | the chosen candidate is not in the target map | eligible |
| 1030 | attempt 2 finished — **three outcomes in one fall-through** | only on `agentRefusedPreSend` |

Line 1024 is `outcome, _, err := deliverAgentReplyFn(...)`: it **discards the
refusal reason**, and `1030` collapses `agentFailedSending` and
`agentRefusedPreSend` into a single `!= agentDelivered` test. A naive extraction
would therefore make a failure *during* the sibling send SMS-eligible — the
duplicate delivery this whole design exists to prevent.

So the refactor is:

```go
type whatsappOutcome struct {
    Delivered bool   // any attempt succeeded — never any SMS
    PreSend   bool   // the LAST attempt proved nothing was written
    Reason    string // the coded reason the chain failed
}
```

`deliverAgentReplyWithFailover`'s body moves into
`deliverAgentReplyOverWhatsApp(...) whatsappOutcome`; each of the five exits
returns the value its own case implies; **line 1024 is edited** to keep the
refusal reason; and the wrapper becomes:

```go
out := deliverAgentReplyOverWhatsApp(ctx, args, arrival, customerHasPhone, fallbackRecipient)
if out.Delivered { return }
DeliverSMSFallback(ctx, SMSAttempt{ ..., PreSend: out.PreSend, Reason: out.Reason })
```

One call, unreachable on a delivered message. The straight-line two-attempt shape
ticket 19 argued for is preserved: this adds a return type, not a loop.

The recipient handed to the stage is **`fallbackRecipient`** — the resolved
`sender` — never `args.Recipient`, which is deliberately the *raw*
`evt.Info.Sender` (`agent_bridge.go:755`) and may be an `@lid`.

### The recipient number — one helper, in `pkg/utils`

```go
// pkg/utils/phone.go
func DialableE164(jid types.JID) string
```

`""` unless `jid.Server == types.DefaultUserServer` **and** the digits are 8–15
long. Both halves are load-bearing:

- Without the server test, `JIDToE164` returns `+123456789` for `123456789@lid` —
  a real phone number belonging to a stranger. It reads only the user part, and
  says so in its own comment.
- Without the length test the server test is **vacuous on the send path**, because
  there the JID is *constructed* from caller input by `utils.FormatJID`, which
  stamps `DefaultUserServer` on anything without an `@`. `validatePhoneNumber`
  (`validations/send_validation.go:41`) rejects only empty and leading-zero — no
  length bound at all.

It lives in `pkg/utils` beside `JIDToE164` rather than in a new package, so the
agent path's existing `customerHasPhone` and this rule cannot drift apart.

### Budgets and concurrency

```go
stageCtx, cancel := context.WithTimeout(context.WithoutCancel(parent), config.SMSGatewayTimeout)
```

- **`SMS_GATEWAY_TIMEOUT` default `10s`**, with dial `5s` and TLS handshake `5s`,
  taken from `stt/httpx.go:70-79`'s arithmetic: a dead host must fail *inside* the
  budget, not consume it before the request leaves.
- **`WithoutCancel`** is what makes the budget independent (AC-17) rather than
  "whatever the WhatsApp attempts left over". On the send path the request context
  carries `middleware.DefaultRequestTimeout` (45s), and a WhatsApp attempt that
  burned it would otherwise hand the stage a dead context.
- **A non-blocking semaphore of 8** bounds it. `WithoutCancel` with no bound lets a
  hung gateway pin request goroutines past the request deadline, unbounded in
  count, precisely when every send is failing. Full ⇒ skip `gateway_busy` — a
  drop, never a queue, which is `agentGate.acquire`'s own precedent.
- **Accepted, recorded:** on the agent path the stage runs inside the goroutine
  that still holds an `agentCalls` slot, so the worst-case hold grows from
  `120s + 2×30s = 180s` to `190s` (−5% on the 32-slot ceiling), during an outage.
  Releasing the slot earlier means restructuring `handleAgentBridgeWithText`'s
  `defer release()`, which is ticket 19's concurrency design and out of scope. The
  10s cap is the mitigation; the arithmetic is recorded so the next ticket can
  decide differently.

### The gateway contract

```
POST <SMS_GATEWAY_URL>
Authorization: Bearer <SMS_GATEWAY_KEY>
Content-Type: application/json

{"to":"+9639...","from":"<SMS_SENDER_ID>","text":"..."}
```

Any 2xx is a success; `message_id` or `id` in a JSON body, if present, is echoed
as the reference. Guards taken from `infrastructure/stt/httpx.go` by its own
numbered list — https-or-loopback (1), redirects never followed (2), the
credential never echoed (5), a **dedicated `*http.Transport`** with explicit
proxy/dial/TLS budgets (3/4/6), `safeURL` redaction (7), bounded control-stripped
`errorDetail` (8), drain-before-close (12), `*url.Error` unwrap (11), explicit
`ContentLength` (13) — **plus that file's three prose rules, restated verbatim in
`sms_gateway.go`**:

1. no byte of a 401/403 body reaches an error, a reason or a log line — an SMS
   gateway's 401 routinely echoes the key;
2. no byte of a 2xx body reaches an error;
3. **no request payload struct is ever `%v`/`%+v`'d** — this payload holds the
   customer's message and number, so one `%+v` prints both.

**One client, built at package init**, never per request (`httpx.go:94-102`): a
per-call client costs a fresh TCP+TLS handshake on a blocked request goroutine and
leaves a socket in `TIME_WAIT` per SMS. `http.Client.Timeout` is left **unset** —
`config.SMSGatewayTimeout` is still zero at package init, so putting it on the
struct would freeze "no timeout"; the per-call `stageCtx` is the budget.

Configuration is **complete** only when URL, key and sender id are all non-empty.

### The three callers of `SendText`, and the explicit opt-in

`SendText` has three entry points, not one: `ui/rest/send.go:40`
(`POST /send/message`), `ui/mcp/send.go:86` (an MCP tool, which stamps a *system*
principal and has no authentication at all), and `ui/rest/chatwoot.go:550` (the
Chatwoot outbound reply). The spec's scope names only the first.

Left implicit, an MCP tool call and a Chatwoot agent reply would silently start
spending gateway money — and the Chatwoot path would then record a WhatsApp
delivery that never happened, because `chatwoot.go:562` feeds `resp.MessageID`
into `storeChatwootOutboundLink`, which no-ops on `""`.

So the stage is **opt-in per entry point**, stamped on the context by the REST
`/send/message` handler alone:

```go
// infrastructure/whatsapp/context_device.go
func ContextWithSMSFallback(ctx context.Context) context.Context
func SMSFallbackAllowed(ctx context.Context) bool
```

Same shape as `ContextWithDevice` and `ContextWithAccountActor`, and — unlike a
request field — not settable from the wire. MCP and Chatwoot are then byte-identical
to today, which is what makes AC-19 provable rather than argued.

### Preserving today's behaviour exactly on the send path

`utils.MustLogin` **panics**; the stage cannot run from an `if err`. The fix is a
non-panicking reader with `MustLogin` rebuilt on top of it, preserving its check
order exactly:

```go
func LoginError(client *whatsmeow.Client) error {   // nil / not connected / not logged in, IN THAT ORDER
func MustLogin(client *whatsmeow.Client) { if err := LoginError(client); err != nil { panic(err) } }
```

`SendText` then reads it once and, on failure **with the stage allowed**, tries
SMS. If the SMS does not deliver, control **falls through to the untouched
`ValidateJidWithLogin` call**, which panics from exactly where it panics today,
with exactly the value it panics with today. Nothing about the failure path
changes for any caller — no new error return, no new panic site, no changed body.
`middleware.Recovery` renders it identically because it never sees a difference.

## Steps

1. **Schema.** Append migration 76 with the append-only rationale **and the
   PostgreSQL lock paragraph named for `accounts`** (ACCESS EXCLUSIVE for the
   pending batch; sub-second at one row per tenant). Bump the four
   `len(migrations) != 75` assertions to 76. No rollback-list entry is needed —
   `TestAccountMigrationsApplyToAPreExistingDatabase` already does
   `DROP TABLE IF EXISTS accounts`.
2. **Storage.** `domainChatStorage.Account.SMSFallbackEnabled bool`; the column in
   `ListAccounts`' SELECT; `SetAccountSMSFallback` and `GetAccountSMSFallback` on
   the repository (both refusing a blank id via `errBlankAccountID()`, and
   `GetAccountSMSFallback` returning `ErrAccountNotFound` on `sql.ErrNoRows`);
   both on `IChatStorageRepository` with a comment saying **why** this is a
   single-column getter and not the `GetAccount` that
   `interfaces.go:181-185` deliberately refuses — NFR-1's one indexed read;
   delegated in `chatstorage_wrapper.go`.
3. **Domain.** `domainAccount.Account.SMSFallbackEnabled`;
   `SetSMSFallbackRequest{ Enabled *bool }` (a **pointer**, so an omitted field is
   distinguishable from `false`); `SMSFallbackState{AccountID,
   SMSFallbackEnabled}`; the usecase method on `IAccountUsecase`.
   **No new sentinel error and no new validator** — see step 6.
4. **Usecase.** `serviceAccount.SetSMSFallback`: `requireAccount` (existence +
   tenant bound, unchanged), write, `[ACCOUNTS] actor=...` audit line, return the
   state. `ListAccounts` maps the new field.
5. **REST.** One route line, `Require(PermAccountsManage)` then `scope` then the
   handler — the order the other seven use and that `AssertPolicyCoverage` cannot
   check. One policy-matrix row.
6. **The 400.** `if request.Enabled == nil { return accountBadBody(c) }` in the
   handler. A body carrying `"yes"` fails inside `c.Bind().Body` and already
   answers `accountBadBody`, so both halves of TC-8 return **one identical
   `400 BAD_REQUEST` body**. This deletes revision 1's sentinel, validator and
   `accountError` case — which would also have been dead code, because
   `accountError` tests `errors.As(err, &generic)` **before** its switch.
7. **Config.** Five settings in `config/settings.go`, bound in
   `cmd/root.go > initEnvConfig`, documented in `src/.env.example`, plus
   `logSMSFallbackConfiguration()` beside the existing startup log functions
   (AC-29). No cobra flag — a credential in `ps` output is the reason
   `HAMSA_API_KEY` has none either.
8. **The stage.** `sms_fallback.go` (order, reasons, semaphore, log lines) and
   `sms_gateway.go` (config view, package-level client, `smsGatewaySendFn` seam,
   the guards). **Neither imports `usecase`; the eligibility answer arrives as a
   plain `bool` on `SMSAttempt`.**
9. **Agent path.** Extract `deliverAgentReplyOverWhatsApp`, split the three-way
   fall-through at line 1030, keep the refusal reason at line 1024, add the single
   `DeliverSMSFallback` call.
10. **Send path.** `utils.LoginError`; `utils.DialableE164`;
    `domainSend.GenericResponse.Channel string json:"channel,omitempty"`; the
    three eligible points; `Channel` set on both outcomes of `SendText` only.
11. **Docs.** The new path plus `sms_fallback_enabled` and `channel` in
    `docs/openapi.yaml`, then copied to `src/ui/rest/apidocs/openapi.yaml`.

## Files to change

### New (5)

| File | What it holds |
|---|---|
| `src/infrastructure/whatsapp/sms_fallback.go` | `SMSAttempt`, `SMSOutcome`, the seven coded reasons, `DeliverSMSFallback`, the semaphore, the log lines |
| `src/infrastructure/whatsapp/sms_gateway.go` | `smsGatewayConfigured`, the package-level client, `smsGatewaySendFn` seam, the HTTP call and its guards |
| `src/infrastructure/whatsapp/sms_fallback_test.go` | ordering, one-call, budget, gateway-failure, truncation, LID, 401-body |
| `src/usecase/send_sms_fallback_test.go` | the three eligible points, the ineligible ones, media, opt-in |
| `src/ui/rest/account_sms_fallback_test.go` | 200 / idempotent / 400 (both halves) / 403 / cross-account 404 / handler order |

### Modified (17)

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 76 |
| `src/infrastructure/chatstorage/account_repository.go` | `ListAccounts` column; `SetAccountSMSFallback`; `GetAccountSMSFallback` |
| `src/domains/chatstorage/chatstorage.go` | `Account.SMSFallbackEnabled` |
| `src/domains/chatstorage/interfaces.go` | the two methods + the "why not GetAccount" note |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | the two delegations |
| `src/domains/account/account.go` | `Account.SMSFallbackEnabled`; `SetSMSFallbackRequest`; `SMSFallbackState` |
| `src/domains/account/interfaces.go` | `SetSMSFallback` |
| `src/usecase/account.go` | `SetSMSFallback`; `ListAccounts` mapping |
| `src/ui/rest/account.go` | route line; handler |
| `src/ui/rest/policy_matrix_test.go` | one row |
| `src/config/settings.go` | five settings |
| `src/cmd/root.go` | env binding; `logSMSFallbackConfiguration` |
| `src/.env.example` | the documented block, including the residual-risk note |
| `src/pkg/utils/whatsapp.go` | `LoginError`; `MustLogin` rebuilt on it |
| `src/pkg/utils/phone.go` | `DialableE164` |
| `src/domains/send/send.go` | `GenericResponse.Channel` |
| `src/usecase/send.go` | the three eligible points; `Channel` |
| `src/infrastructure/whatsapp/agent_bridge.go` | `whatsappOutcome`; the extraction; line 1024; the single stage call |
| `src/infrastructure/whatsapp/context_device.go` | `ContextWithSMSFallback` / `SMSFallbackAllowed` |
| `src/ui/rest/send.go` | the opt-in stamp on `SendText` only |
| `docs/openapi.yaml` + `src/ui/rest/apidocs/openapi.yaml` | the new path and the two fields |

Plus the four migration-count assertions
(`sqlite_repository_account_test.go`, `sqlite_repository_debug_test.go`,
`user_repository_test.go`, `user_admin_repository_test.go`).

**No deployment runtime file is touched** (C-1).

### The existing tests, and why none of them breaks

Revision 1 claimed the agent failover tests break "by signature". They do not:
they stub `deliverAgentReplyFn` and call `deliverAgentReplyWithFailover`, and
neither signature changes.

The real hazard is that ~9 existing tests will now **execute** the new stage. It
is defused by step 1 of the order: the gateway configuration is read from
`config.*` package variables, which are empty in every test that does not set
them, so `DeliverSMSFallback` returns at step 1 having done nothing and logged
nothing above debug. The new tests set and restore those variables through one
`t.Cleanup` helper in `sms_fallback_test.go`.

## Validation strategy

From `src/`, with `-tags purego` (no cgo toolchain here; this is what the last
four tickets on this branch line used):

```
go build -tags purego ./...
go vet   -tags purego ./...
go test  -tags purego ./...
```

**Baseline, measured on the unmodified tree before the first edit:** build clean,
vet clean, test = every package `ok` except one pre-existing failure,
`TestResolveDocumentMIME/Zip` in `usecase` — the same failure ticket 19 recorded.
Anything else after the change is mine.

Migration 76's PostgreSQL portability is covered by
`migrations_dialect_test.go`'s dialect walk and
`TestAccountMigrationsApplyToAPreExistingDatabase`, exactly as migration 75's was
(`CHAT_STORAGE_TEST_POSTGRES_URI` is not set here; the gap is recorded, not
hidden).

| TC | Where |
|---|---|
| TC-1, TC-7 | `sms_fallback_test.go`, `httptest` gateway counting requests |
| TC-2, TC-4, TC-6 | `sms_fallback_test.go` — each skip reason, request count 0 |
| TC-3 | `sms_fallback_test.go` — sibling delivers, `smsGatewaySendFn` never called |
| TC-5, TC-8, TC-9, TC-10, TC-16 | `account_sms_fallback_test.go` |
| TC-11, TC-13, TC-17 | `send_sms_fallback_test.go` |
| TC-12 | `TestAccountMigrationsApplyToAPreExistingDatabase` + a default assertion |
| TC-14 | `sms_fallback_test.go` — an already-cancelled parent still yields a full budget |
| TC-15 | `sms_fallback_test.go` — unconfigured ⇒ zero repository calls, zero non-debug lines |
| TC-18 | `sms_fallback_test.go` — truncation, rune-boundary |

Additional pins the panel asked for: the `InvalidJID` allowlist; `redactedSettings`
naming `sms_gateway_key`/`sms_gateway_url`; a `smsFallbackReads` counter on the
reply-path spy asserted **0** on the green path; a 401 body never reaching a log
line; and `classifyAgentSendError`'s accepted set pinned to exactly
`{ErrClientIsNil, ErrNotLoggedIn}` so a later widening is a test failure.

**Mutation checks.** Four guards here pass their tests by refusing, so each is
broken deliberately, shown to fail the suite, and reverted:

1. delete the `Server == DefaultUserServer` test in `DialableE164` — the LID case
   must start texting a stranger;
2. delete its 8–15 digit bound — the send path's constructed-JID case must fail;
3. set `PreSend: true` unconditionally in the agent wrapper — the sibling
   `agentFailedSending` case must produce a gateway request;
4. drop the `WithoutCancel` — TC-14 must fail.

## Rollback

Revert the commit. The column survives and is read by nothing: the previous binary
names it in no SELECT list, and its default is `FALSE`, so no account is armed.
`DROP COLUMN` is available and unnecessary.

Without any deploy the feature is switchable off at three levels: unset
`SMS_GATEWAY_URL` (whole deployment), `PATCH .../sms-fallback` with `false` (one
account), or `PATCH /accounts/:id/devices/:device_id` with `send_state: blocked`
(unrelated, but it is how an operator stops one number).

## Out of scope

Everything in `spec.md > Out of scope`, and in particular the sibling-device chain
on `POST /send/message`, which the scope decision records as a separate ticket.

Also declined, with reasons, in the Panel response below: a per-account SMS spend
cap, and restructuring `handleAgentBridgeWithText`'s gate release.

---

# Panel response

31 findings across the three lenses. **25 adopted, 3 declined with reasons, 3
recorded as already-correct.** Two of the adopted ones were structural: revision 1
**would not have compiled**, and it carried a **duplicate-delivery hole**.

## The two defects that mattered

**PR-1 — the import cycle (senior, major).** Revision 1 put the eligibility check
inside a new `infrastructure/sms` package, which would call
`whatsapp.SendErrorProvesNothingWritten`, while `agent_bridge.go` would import
`infrastructure/sms` to call the stage. `whatsapp → sms → whatsapp`. The stated
rationale — "`usecase` can't be imported, so the stage must live below both" — was
also simply false: `usecase/send.go:23` already imports
`infrastructure/whatsapp`. **Adopted in full**: the stage moves into
`infrastructure/whatsapp`, three of six new files disappear, the export
disappears, and the eligibility answer arrives as a plain `bool` on `SMSAttempt`.
Worth stating plainly: revision 1's first `go build` would have failed.

**PR-2 — the sibling attempt could send a duplicate (security, major).**
`agent_bridge.go:1030` collapses `agentFailedSending` and `agentRefusedPreSend`
into one `!= agentDelivered` test, and `:1024` discards the refusal reason. The
"every `return` becomes `return whatsappOutcome{...}`" refactor revision 1
described would therefore have made a failure **during** the sibling send
SMS-eligible — a customer receiving the same text from WhatsApp *and* SMS, which
is the single outcome AC-21 exists to prevent. **Adopted**: five exits enumerated,
the three-way fall-through split, line 1024 edited, and mutation check 3 added so
a later edit that reintroduces it fails the suite.

## Adopted — safety and correctness

| # | Lens | Finding | Change |
|---|---|---|---|
| PR-3 | security | `DialableE164`'s server test is **vacuous on the send path**: the JID is constructed by `FormatJID`, which stamps `DefaultUserServer` on any input, and `validatePhoneNumber` has no length bound | added the 8–15 digit E.164 bound; mutation check 2 |
| PR-4 | senior | `SendText` has **three** callers — REST, MCP (unauthenticated), Chatwoot — and the spec names one | explicit opt-in stamped by the REST handler alone; MCP and Chatwoot byte-identical |
| PR-5 | senior | On SMS success `MessageID` is empty; `chatwoot.go:562` would record a WhatsApp delivery that never happened | moot under PR-4, and the field's meaning on an SMS outcome is now documented |
| PR-S4 | security | the exported classifier is unsound for the send path (`ErrWaCLI`, `normalizeSendError`) and widening it would widen the set authorizing a **second WhatsApp send** | the export is deleted; send-path eligibility is three structural points and no error classification |
| PR-6 | senior | `ValidateJidWithLogin` also returns `ParseJID`'s plain error — "err != nil" would make a malformed phone eligible, contradicting AC-24 | closed allowlist on `pkgError.InvalidJID` only, with a test |
| PR-7 | security | the agent path must pass `fallbackRecipient`, not `args.Recipient`, which is the **raw** sender and may be `@lid` | named explicitly; asserted with a LID arrival |
| PR-8 | both | empty `account_id` has no branch: `GetAccountSMSFallback("")` would be a wasted call and an error log on the majority of deployments | in-process step 3, coded `no_account`, before the read |
| PR-9 | senior | the precheck must keep `MustLogin`'s check **order** (`IsConnected` then `IsLoggedIn`) to return the same value | `LoginError` written as three ordered branches, `MustLogin` rebuilt on it |
| PR-10 | security | the `stt` **prose** rules were dropped — 401/403 bodies, and `%+v` on a payload holding the customer's message and number | all three restated verbatim in `sms_gateway.go`; a 401-body test |
| PR-11 | security | no dedicated `Transport`: `HTTP_PROXY` would silently route the Bearer credential and the customer's text | explicit transport with proxy/dial/TLS decisions |
| PR-12 | senior | `sms_fallback_enabled: "yes"` fails in `Bind()` and never reaches a validator, so TC-8's two halves would return two bodies — and the new `accountError` case is dead anyway, because `errors.As(&generic)` runs first | nil-check in the handler → one `accountBadBody`; sentinel, validator and case all deleted |
| PR-13 | senior | AC-25's "before the database is touched" conflicts with `requireAccount`-first and would create a cross-tenant oracle (400 vs 404) | `requireAccount` stays first; **spec AC-25 reworded to "before any write"** |

## Adopted — cost and operability

| # | Lens | Finding | Change |
|---|---|---|---|
| PR-14 | perf | the `gateway_unconfigured` skip would log **per failed message on every deployment that has the feature off**, with a stranger-controlled trigger — contradicting AC-29 | step 1 returns at debug and nothing louder |
| PR-15 | perf | `WithoutCancel` with no bound pins request goroutines past the 45s deadline, unbounded, exactly when every send fails; both cited precedents are not analogous | non-blocking semaphore of 8, `gateway_busy` as a drop |
| PR-16 | perf | the timeout default was never pinned, so every budget claim was unevaluable | 10s, dial 5s, TLS 5s, with the arithmetic |
| PR-17 | perf | one client at package init, and **`Client.Timeout` must stay unset** because config is still zero at init | both adopted, with the reason recorded in the file |
| PR-18 | perf | NFR-1's "no additional work on the green path" is falsified by the precheck itself (`IsConnected`/`IsLoggedIn` read twice, ~30ns) | **spec NFR-1 reworded** to "no additional database read"; the duplicate read is accepted and recorded rather than restructuring `ValidateJidWithLogin` |
| PR-19 | perf | migration 76's comment copied the cost half of the 51–61 block and dropped the **lock** half | the ACCESS EXCLUSIVE paragraph, named for `accounts` |
| PR-20 | perf | nothing pins the new read | a `smsFallbackReads` counter on the reply-path spy, asserted 0 on the green path |
| PR-21 | senior | ~9 existing tests will now **execute** the stage — shared mutable config | defused by step 1 + one `t.Cleanup` helper; the wrong "signature" claim is retracted |
| PR-22 | senior | a second single-column account getter lands under a comment explaining why `GetAccount` was refused | kept, with the NFR-1 reason written into the interface comment |
| PR-23 | security | startup redaction works **only by name** (`key`, `url` fragments) | a `redactedSettings` test naming both keys |
| PR-24 | security | pin the handler order with a 404 probe | added to `account_sms_fallback_test.go` |
| PR-25 | security | `classifyAgentSendError`'s accepted set should be pinned | test added, so a later widening fails |

## Declined, with reasons

**PR-D1 — a per-account SMS/hour cap and a deployment-wide daily cap (security,
major).** Declined as scope. It is a new feature with its own configuration,
storage and error surface, in a ticket whose acceptance criteria never mention
spend. The concern is real and is answered where it can be answered cheaply:
AC-15 already caps one message at one SMS, the semaphore bounds concurrency, and
the residual — an authenticated `messages.send` holder can spend the deployment's
SMS budget one message at a time — is now **written into `spec.md` and
`src/.env.example`** so an operator arms the gateway knowing it. Recorded here so
the next ticket can pick it up with the finding intact.

**PR-D2 — drop "rejected recipient" from the eligible set (security, major).**
Declined: AC-20 names it explicitly ("no live session, no usable transport, or a
**rejected recipient**"), and it is the case the feature is most obviously *for* —
a customer who is not on WhatsApp. The abuse concern is bounded instead by PR-3's
E.164 shape test and PR-D1's disclosure, and the allowlist is narrowed to the one
`InvalidJID` site with a test that pins it.

**PR-D3 — release the `agentCalls` slot before the stage (perf, major).**
Declined as scope: `release()` is deferred in `handleAgentBridgeWithText`'s
goroutine and moving it restructures ticket 19's concurrency design. Mitigated by
the 10s cap, and the arithmetic is recorded above (180s → 190s worst-case hold,
−5% on the 32-slot ceiling, only during an account-wide outage) so the trade is
visible rather than invisible.

## Recorded as already correct

- Tenant isolation on the new route: `Require(PermAccountsManage)` +
  `RequireAccountScope()` **second**, and `requireAccount`'s non-disclosing 404,
  match the seven existing routes exactly (security).
- The scope decision on the sibling chain: `SendText` resolves one client with no
  candidate machinery, and `replyCandidate`/`buildAttemptOrder` are unexported —
  genuinely a separate ticket (senior).
- Migration count 75 → 76 across four assertions; the `BOOLEAN NOT NULL DEFAULT`
  precedent at `sqlite_repository.go:3961`; `Channel` with `omitempty` keeping
  every other send endpoint byte-identical; `WithoutCancel`'s precedent; and
  `whatsappOutcome` costing no heap allocation (senior, perf).
