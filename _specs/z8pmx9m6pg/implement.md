---
ticket: z8pmx9m6pg
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6pg"
  github: ""
---

# Implementation — 28 · Fall back to SMS when every WhatsApp channel fails

Applied on branch `ticket/z8pmx9m6pg`, cut from `ticket/z8pmx9mavz` — the tip
carrying the account layer (migrations 51–61), the tenant-isolation layer
(`super_admin`, `MayAddressAccountScope`, `RequireAccountScope`), ticket 19's
reply failover, and migration 75. Per the workflow's delivery boundary **no
commit was created at this stage**; the single publishable commit is made by
`/publish-pr`.

## What was built

One boolean column, one gateway, and one **stage** called from exactly one
terminal point on each send path.

```
migration 76        accounts.sms_fallback_enabled  BOOLEAN NOT NULL DEFAULT FALSE
route               PATCH /accounts/:account_id/sms-fallback
sms_fallback.go     DeliverSMSFallback — 7 ordered checks, 1 gateway call, 1 log line
sms_gateway.go      smsGatewayConfigured, one package-level client, the guards
call site 1         deliverAgentReplyWithFailover  after BOTH whatsapp attempts
call site 2         usecase.SendText               3 structural pre-send points
opt-in              ui/rest/send.go stamps the context; MCP and Chatwoot do not
```

The final shape is the one `plan.md` **revision 2** describes. Revision 1 would
not have compiled — it specified an import cycle — and carried a
duplicate-delivery hole on the sibling attempt; the advisory panel found both
before any code was written, and `plan.md > Panel response` records all 31
findings.

## Files changed

**27 files: 8 new, 19 modified.** No deployment runtime file was touched.

### New (8)

| File | Lines | What it holds |
|---|---|---|
| `src/infrastructure/whatsapp/sms_fallback.go` | 288 | `SMSAttempt`, `SMSOutcome`, the seven coded reasons, `DeliverSMSFallback`, the semaphore, the log lines |
| `src/infrastructure/whatsapp/sms_gateway.go` | 332 | `smsGatewayConfigured`, the package-level client, `smsGatewaySendFn`, `truncateForSMS`, the ten guards |
| `src/infrastructure/whatsapp/sms_fallback_test.go` | 713 | the stage's rules, the gateway client, the 401-body rule, the concurrency bound, the classifier pin |
| `src/infrastructure/whatsapp/agent_sms_fallback_test.go` | 284 | the reply-path wiring: the five exits, the sibling split, the LID recipient |
| `src/usecase/send_sms_fallback_test.go` | 337 | the opt-in, the three eligible points, media, validation, `LoginError` ≡ `MustLogin` |
| `src/ui/rest/account_sms_fallback_test.go` | 315 | the route: 200 / idempotent / both 400s / 403 / cross-account 404 / handler order |
| `src/infrastructure/chatstorage/account_sms_fallback_test.go` | 173 | the column against a real database, the append-only guard |
| `src/pkg/utils/dialable_test.go` | 104 | `DialableE164` — 12 cases, both of its tests separately |

### Modified (19)

| File | Change |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migration 76 + the append-only and PostgreSQL-lock rationale |
| `src/infrastructure/chatstorage/account_repository.go` | the column in `ListAccounts`; `SetAccountSMSFallback`; `GetAccountSMSFallback` |
| `src/domains/chatstorage/chatstorage.go` | `Account.SMSFallbackEnabled` + why it is a plain `bool`, not a `*bool` |
| `src/domains/chatstorage/interfaces.go` | the two methods + why this is a single-column getter |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | both delegations, account-scoped not device-scoped |
| `src/domains/account/account.go` | `Account.SMSFallbackEnabled`, `SetSMSFallbackRequest`, `SMSFallbackState` |
| `src/domains/account/interfaces.go` | `SetSMSFallback` |
| `src/usecase/account.go` | `SetSMSFallback` + the audit line; `ListAccounts` mapping |
| `src/ui/rest/account.go` | route line; `SetSMSFallback` handler |
| `src/ui/rest/policy_matrix_test.go` | one route→permission row |
| `src/ui/rest/account_scope_rest_test.go` | the new route added to the **existing** order-pinning table; `reachStub` |
| `src/ui/rest/account_auth_test.go` | `recordingAccountUsecase.SetSMSFallback` |
| `src/config/settings.go` | five settings |
| `src/cmd/root.go` | env binding; `logSMSFallbackConfiguration` |
| `src/cmd/root_test.go` | `sms_gateway_key` / `sms_gateway_url` added to the redaction test |
| `src/.env.example` | the documented block, including the residual-risk note |
| `src/pkg/utils/whatsapp.go` | `LoginError`; `MustLogin` rebuilt on it |
| `src/pkg/utils/phone.go` | `DialableE164` |
| `src/domains/send/send.go` | `GenericResponse.Channel` + the two constants |
| `src/usecase/send.go` | the three pre-send points; `smsFallback`; `Channel` |
| `src/infrastructure/whatsapp/agent_bridge.go` | `whatsappOutcome`; the extraction; the sibling split; the stage call |
| `src/infrastructure/whatsapp/context_device.go` | `ContextWithSMSFallback` / `SMSFallbackAllowed` |
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` | `smsFallbackReads` on `replyRepoSpy` |
| `docs/openapi.yaml` + `src/ui/rest/apidocs/openapi.yaml` | the new path, `sms_fallback_enabled`, `SendMessageResponse` |
| the four migration-count assertions | 75 → 76 |

```
 30 files changed, 1314 insertions(+), 35 deletions(-)
 + 8 new files (2546 lines, of which 1926 are tests)
```

`plan.md`'s prediction that **no existing test would break by signature** held:
`deliverAgentReplyFn` and `deliverAgentReplyWithFailover` both kept their
signatures, and none of the nine stubs was touched.

## What the change does

1. **Refuses first, cheaply.** Seven ordered checks, of which exactly one touches
   the database and it is reached only on a deployment that has configured a
   gateway. Every deployment that exists today stops at check 1 having read
   nothing and logged nothing.
2. **Decides eligibility structurally, never by sniffing an error.** The agent
   path reads `sendAgentReply`'s explicit `agentAttemptOutcome`; the send path
   knows it from where control is. No error taxonomy was invented and
   `classifyAgentSendError` stayed unexported.
3. **Sends at most once.** One call site per path, each unreachable on a
   delivered message, and no retry above or below the gateway.
4. **Refuses a recipient no carrier can address.** `DialableE164` demands both a
   phone-number server and an 8–15 digit E.164 shape.
5. **Keeps its own budget, bounded.** `WithoutCancel` + 10s, behind a non-blocking
   semaphore of 8 that drops rather than queues.
6. **Tells the operator the truth once.** One line per attempt, one per skip, one
   at startup for the deployment state, and never the body or the credential.

## Deviations from the approved plan

**D-1 — the `gateway_unconfigured` skip logs NOTHING, not even at debug, and an
existing test is what found it.** The plan said debug. On the first full run
`TestAgentReplyRefusalIsRecorded` failed with `debug lines = 10, want 5`: it
counts refusal lines to prove ticket 18's dedupe, and the new stage was adding
one per message. That is not a test being brittle — it is the exact
per-message-line-on-every-deployment problem PR-14 objected to, caught one level
lower than the panel caught it. The reason still travels in the returned
`SMSOutcome`, which is what the tests assert, so nothing is lost.

**D-2 — `smsLog()` was added: the package logger is nil until `InitWaDB` runs.**
Not in the plan, and it is a production defect rather than a test artifact.
`log` is assigned inside `InitWaDB`, not at package initialisation; everything
else in `infrastructure/whatsapp` runs only after that, but this stage is reached
from `usecase.SendText`, which a caller can drive independently. A nil
dereference would have crashed the send the stage was called to rescue. It
degrades to `waLog.Noop` instead. Found by the first `usecase` test run, which
panicked at the success line.

**D-3 — `TestSMSStageBudgetSurvivesAnExhaustedCaller` was rewritten after its own
mutation passed.** The first version asserted a **proxy** — that `ctx.Deadline()`
still looked roughly full — and mutation 4 (delete `context.WithoutCancel`)
**passed it**. `WithTimeout` stamps the deadline before propagating the parent's
cancellation, so a dead context and a live one look identical through
`Deadline()` alone. The gateway spy now refuses a context whose `Err()` is
non-nil, exactly as `http.Client.Do` would, and the mutation fails with *"a
cancelled caller stopped the SMS stage — its budget is not independent"*.
Recorded prominently because the first version would have shipped an AC-17
guarantee it could not check — the same trap ticket 19's deviation D-1 recorded.

**D-4 — the cross-account ordering assertion went into the EXISTING table, not a
new test.** `account_scope_rest_test.go` already owns the "the scope guard is the
second handler" assertion for six routes; the seventh joined it rather than
getting a private copy. My own `smsScopedAccountApp` was renamed to avoid
colliding with that file's `scopedAccountApp` and kept only for what the table
does not cover — super_admin, the `user` role, and the caller's own account.

**D-5 — `POST /send/message` got its own OpenAPI response schema.**
`SendResponse` is shared by twelve send endpoints and only this one reports a
channel, so widening it would have documented a field the other eleven never set.
`SendMessageResponse` sits beside it, and a test pins that `SendResponse` did not
grow the field.

**D-6 — no `validations.ValidateSetSMSFallback` and no new sentinel error.** The
plan's revision 2 already recorded this after PR-12, but it is a deletion from
revision 1's file list and is repeated here so the diff is not surprising: the
nil check lives in the handler because a non-boolean value fails inside Fiber's
`Bind` and never reaches a validator, so a validator could only ever have caught
half of TC-8 — and the two halves would have answered with two different bodies.

**D-7 — `agentRefusalDuringSend` is a new coded reason.** Not named in the plan.
Splitting attempt 2's three-way fall-through left the mid-send branch with no
token to report, and `""` in a log line reading "whatsapp failed with " is worse
than useless. One constant, beside `agentRefusalTransport`.

## The baseline, measured before the first edit

On the unmodified tree, from `src/`, with `-tags purego` (there is no cgo
toolchain on this machine; this is what the previous four tickets on this branch
line used):

```
go build -tags purego ./...     clean
go vet   -tags purego ./...     clean
go test  -tags purego ./...     every package ok EXCEPT one pre-existing failure:
                                TestResolveDocumentMIME/Zip in usecase
```

That failure is the same one ticket 19 recorded and predates this branch.
Anything else after the change is mine.

## Validation run

Identical command set, after the change:

```
go build -tags purego ./...     clean
go vet   -tags purego ./...     clean
go test  -tags purego ./...     every package ok EXCEPT TestResolveDocumentMIME/Zip
```

**Nothing new. One pre-existing failure, unchanged.**

### The mutation checks

Four of this ticket's guards pass their tests by REFUSING, and a refusal is also
how a broken guard passes. Each was broken deliberately, shown to fail, and
reverted:

| # | Mutation | Result |
|---|---|---|
| 1 | delete the `Server == DefaultUserServer` test in `DialableE164` | **FAIL** — `TestDialableE164/an_unresolved_@lid_is_NOT_a_phone_number` and `TestSMSFallbackRefusals/an_unresolved_@lid_gets_no_SMS` |
| 2 | delete its 8–15 digit bound | **FAIL** — `too_short`, `longer_than_E.164_allows`, and `a_number_that_is_not_E.164-shaped_gets_no_SMS` |
| 3 | collapse attempt 2's outcomes back to one `PreSend: true` | **FAIL** — `TestSiblingFailureDuringSendingNeverProducesAnSMS` |
| 4 | drop `context.WithoutCancel` from the stage | **FAIL** — `TestSMSStageBudgetSurvivesAnExhaustedCaller` (only after D-3; it passed before) |

Mutation 3's automated revert could not disambiguate — its mutated line is
byte-identical to the branch above it — so `agent_bridge.go` was restored by hand
and the whole suite re-run to confirm. Mutation 4 was then re-run in isolation,
because the leftover from 3 had masked its result the first time.

**No deployment runtime file was touched** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows), and
`src/ui/mcp/`, `src/ui/rest/chatwoot.go`, `webhook_forward.go`, `auto_reply.go`
and `agent_reply_order.go` do not appear in the diff.
