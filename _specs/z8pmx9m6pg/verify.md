---
ticket: z8pmx9m6pg
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6pg"
  github: ""
---

# Verification — 28 · Fall back to SMS when every WhatsApp channel fails

**Outcome: PASSED.** All 51 acceptance criteria are mapped to an executed result
below. Three carry a stated limit rather than a clean pass, and they are named as
such rather than rounded up.

## Runtime impact

**Does this change any deployment runtime file? NO.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` do not appear in the diff.

**Does it change runtime behaviour on an existing deployment? NO, and this is the
claim that matters most.** The stage is off unless the operator sets three
environment variables *and* an account admin arms the account. With no gateway
configured, `DeliverSMSFallback` returns at its first check having performed no
database read, made no outbound call and written no log line at any level. The
one schema change is additive with `DEFAULT FALSE` and no backfill, so an
upgraded database reports every account disarmed.

There is one behaviour change on the happy path and it is stated rather than
hidden: a successful `POST /send/message` now carries `"channel": "whatsapp"` in
`results`. Every other `/send/*` endpoint is byte-identical (`omitempty`, and
only `SendText` sets it).

## Validation run

From `src/`, with `-tags purego` — there is no cgo toolchain on this machine, and
this is the command set the previous four tickets on this branch line used:

```
go build -tags purego ./...     clean
go vet   -tags purego ./...     clean
go test  -tags purego ./...     every package ok EXCEPT one pre-existing failure
```

| | Baseline (unmodified tree, measured before the first edit) | After |
|---|---|---|
| build | clean | clean |
| vet | clean | clean |
| test | 1 failure: `TestResolveDocumentMIME/Zip` (`usecase`) | **the same 1 failure, nothing else** |

That failure predates this branch — ticket 19's `verify.md` records it too.

### PostgreSQL: what was and was not proven

Migration 76's portability is covered by `migrations_dialect_test.go`'s dialect
walk and by `TestAccountMigrationsApplyToAPreExistingDatabase`, which rolls a
database back to version 50 and re-runs the whole list. **The suite was not run
against a live PostgreSQL server**: Docker Desktop is not running on this
machine, so the `postgres:16-alpine` container the harness documents could not be
started. This is the same coverage ticket 75 shipped with and is recorded as a
gap rather than described as if a server had answered.

The statement itself has an exact precedent two lines above it in the same list
(`ALTER TABLE devices ADD COLUMN webhook_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
migration 75), which does ship on both engines.

### Mutation checks

Most of what this ticket adds is a **refusal**, and a refusal passes its test by
doing nothing — which is also how a broken guard passes. Four guards were
therefore broken deliberately, shown to fail, and reverted. All four failed:

| # | Broken | Failing test |
|---|---|---|
| 1 | the `Server == DefaultUserServer` test in `DialableE164` | `TestDialableE164/an_unresolved_@lid…`, `TestSMSFallbackRefusals/an_unresolved_@lid…` |
| 2 | its 8–15 digit E.164 bound | `TestDialableE164/too_short…`, `/longer_than…`, `TestSMSFallbackRefusals/a_number_that_is_not_E.164-shaped…` |
| 3 | attempt 2's three-way split, collapsed back to one | `TestSiblingFailureDuringSendingNeverProducesAnSMS` |
| 4 | `context.WithoutCancel` in the stage | `TestSMSStageBudgetSurvivesAnExhaustedCaller` |

**Mutation 4 initially PASSED**, which is the single most useful thing this
verification produced. The first version of that test asserted a proxy — that
`ctx.Deadline()` still looked roughly full — and a cancelled parent leaves the
deadline looking identical, because `WithTimeout` stamps it before propagating
the cancellation. The test was rewritten to make the gateway spy refuse a dead
context, exactly as `http.Client.Do` would, and the mutation then failed. Without
the mutation run, AC-17 would have shipped with a test that could not fail.

## Acceptance criteria

### Scope and tenant safety

| AC | Result | Evidence |
|---|---|---|
| **AC-1** SMS runs only for a device of the caller's own account | **PASS (by construction)** | The stage's account comes from the DEVICE (`DeviceInstance.AccountID()`), never from the caller, and `RequireDeviceOwnership` / `DeviceMiddleware` (tickets 25/27) already refuse a device outside the caller's account before `SendText` runs. Nothing new was built and nothing weakened. |
| **AC-2** Another `account_id` → 404, non-disclosing | **PASS** | `TestSMSFallbackRefusesAForeignAccountWithoutDisclosure` (404, usecase never reached, id not echoed) + the new row in `TestAccountScopeGuardRefusesAForeignAccountBeforeTheHandler` |
| **AC-3** `super_admin` on any account | **PASS** | `TestSMSFallbackAdmitsASuperAdminOnAnyAccount` |
| **AC-4** stored on the account row | **PASS** | migration 76 is `ALTER TABLE accounts`; `TestSMSFallbackColumnIsAppendedLast` |
| **AC-5** no effect on any other account | **PASS** | `TestSMSFallbackIsPerAccount` (real database, two accounts) |

### Authorization

| AC | Result | Evidence |
|---|---|---|
| **AC-6** requires `accounts.manage` | **PASS** | the route line; `policy_matrix_test.go` row; `TestSMSFallbackAdmitsTheCallersOwnAccount` |
| **AC-7** read requires `accounts.manage`, via the existing read route | **PASS** | `GET /accounts` is unchanged except for the field; `TestNewAccountHasTheSMSFallbackDisabled` asserts it through `ListAccounts` |
| **AC-8** `user` role → 403 | **PASS** | `TestSMSFallbackRefusesTheOrdinaryUserRole` (403, code `PERMISSION_DENIED`, usecase never reached) |
| **AC-9** sending needs only `messages.send` | **PASS** | `ui/rest/send.go` route line unchanged; the stage reads no permission |
| **AC-10** no new permission | **PASS** | `pkg/auth/perm.go` is not in the diff |

### General behaviour

| AC | Result | Evidence |
|---|---|---|
| **AC-11** only after every WhatsApp attempt failed | **PASS** | `TestSiblingDeliveryMeansNoSMS` (sibling delivers ⇒ 0 gateway calls), `TestDeliveredReplyNeverProducesAnSMS` |
| **AC-12** only when armed AND configured | **PASS** | `TestSMSFallbackRefusals/a_disabled_account…`, `TestSMSFallbackUnconfiguredGatewayCostsNothing`, `TestSMSFallbackIsIncompleteWithoutEveryRequiredValue` |
| **AC-13** E.164 recipient; group/@lid get none | **PASS** | `TestDialableE164` (12 cases), `TestSMSFallbackRefusals` (@lid, group, short), `TestSendTextGroupRecipientGetsNoSMS`; mutations 1 and 2 |
| **AC-14** body unchanged, no prefix or branding | **PASS** | `TestSMSFallbackDeliversAfterEveryWhatsAppChannelFailed` asserts the exact text; `TestSMSGatewaySendsTheDocumentedRequest` asserts the payload leaving the process |
| **AC-15** at most one SMS per message | **PASS (structural)** | one call site per path, each behind `if out.Delivered { return }` / a single pre-send branch; `TestSMSFallbackDelivers…` asserts exactly 1 call |
| **AC-16** the stage runs once; no gateway retry | **PASS** | `TestSMSGatewayFailureIsReportedAndNeverRetried` (exactly 1 call after a failure) |
| **AC-17** its own timeout budget | **PASS** | `TestSMSStageBudgetSurvivesAnExhaustedCaller`, **and mutation 4** — see the note above, this AC is only honestly covered because the mutation was run |
| **AC-18** no WhatsApp message row | **PASS (by construction)** | `DeliverSMSFallback` holds no storage write; the only repository method it calls is `GetAccountSMSFallback`. `TestMediaSendsNeverFallBackToSMS` and the read counters pin that no other repository call is made. |
| **AC-19** disabled ⇒ exactly today's behaviour | **PASS** | `TestSendTextReturnsTodaysErrorWhenTheSMSDoesNotDeliver` (same `ErrWaCLI` value), `TestSendTextWithNoGatewayIsUnchangedAndCostsNoRead`, `TestLoginErrorIsWhatMustLoginPanicsWith` (the REST body cannot change), `TestSendTextWithoutTheOptInNeverFallsBack` (MCP and Chatwoot) |

### Fallback eligibility and delivery safety

| AC | Result | Evidence |
|---|---|---|
| **AC-20** only from a pre-send refusal | **PASS** | `TestSendTextFallsBackToSMSWhenThereIsNoClient`, `TestReplyFallsBackToSMSWhenNoWhatsAppChannelIsLeft`, `TestTransportRefusedArrivalReachesTheSMSStage`, `TestSiblingRefusedPreSendReachesTheSMSStage` |
| **AC-21** a failure DURING sending never produces an SMS | **PASS** | `TestFailureDuringSendingNeverProducesAnSMS`, `TestSiblingFailureDuringSendingNeverProducesAnSMS`, `TestClassifyAgentSendErrorAcceptsExactlyTwoSentinels`; **mutation 3**. This is the ticket's central safety property and the one revision 1 of the plan got wrong. |
| **AC-22** a successful send never triggers an SMS, including on a storage-write failure | **PASS** | `TestDeliveredReplyNeverProducesAnSMS`. The storage-write half is structural: `wrapSendMessage` stores in a detached goroutine AFTER returning success, and `SendText` returns before it runs — the stage is on the error path and cannot be reached from there. |
| **AC-23** a `blocked` device is skipped, and that is a valid route in | **PASS** | `TestSiblingFailureDuringSendingNeverProducesAnSMS` and `TestSiblingRefusedPreSendReachesTheSMSStage` both drive `arrival.Blocked = true`; ticket 19's ordering rules are unchanged (`agent_reply_order.go` is not in the diff) |
| **AC-24** validation failures never reach the stage | **PASS** | `TestSendTextValidationFailuresNeverReachTheStage` (empty message, empty phone: 0 reads, 0 gateway calls). The `ParseJID` error is excluded by the closed `errors.As(&InvalidJID)` allowlist. |

### Form fields

| AC | Result | Evidence |
|---|---|---|
| **AC-25** both required; refused before any write | **PASS (as amended)** | `TestAnInvalidSMSFallbackValueIsRefusedBeforeAnyWrite` — six bodies, all 400, usecase never called. The AC was **amended after panel review** from "before the database is touched" to "before any write": satisfying the literal wording would have put body validation ahead of the existence/scope check and produced a cross-tenant oracle (400 for a foreign id with a bad body, 404 with a good one). `spec.md` records the amendment. |
| **AC-26** credentials never accepted in the body | **PASS** | `SetSMSFallbackRequest` has one field; `TestSMSFallbackResponseCarriesNothingElse` |

### Configuration

| AC | Result | Evidence |
|---|---|---|
| **AC-27** URL, credential, sender id, timeout from the environment | **PASS** | `config/settings.go`, `cmd/root.go > initEnvConfig` |
| **AC-28** credential never stored, returned or logged | **PASS** | read from `config` at call time in `sendSMSViaGateway`; `TestSMSGatewayNeverQuotesAnAuthFailureBody`; `TestRedactedSettingsHidesCredentials` now names `sms_gateway_key`; the response type has no field for it |
| **AC-29** incomplete config disables it; stated once at startup | **PASS** | `logSMSFallbackConfiguration` names the missing variables; `TestSMSFallbackUnconfiguredGatewayCostsNothing` asserts **0 log lines** per message (see deviation D-1) |
| **AC-30** every value documented in `src/.env.example` | **PASS** | all five, with defaults, the gateway contract, and the residual-risk note |

### Behaviour after saving

| AC | Result | Evidence |
|---|---|---|
| **AC-31** 200 returns `account_id` + the new value | **PASS** | `TestSMSFallbackEnableAndDisableAnswer200WithTheNewState` |
| **AC-32** takes effect on the next send, no restart | **PASS (by construction)** | the value is read per failed message in `DeliverSMSFallback` step 5; there is no cache anywhere on the path |
| **AC-33** idempotent | **PASS** | `TestSMSFallbackIsIdempotent` (REST), `TestSetAccountSMSFallbackRoundTripsAndIsIdempotent` (storage, five writes) |
| **AC-34** the existing read route returns it | **PASS** | `TestNewAccountHasTheSMSFallbackDisabled` reads it back through `ListAccounts` |
| **AC-35** pre-existing accounts report `false` | **PASS** | `TestNewAccountHasTheSMSFallbackDisabled` — the row is written by `CreateAccount`, which never mentions the column, so the value comes from the DEFAULT exactly as it does for an upgraded row |
| **AC-36** append-only migration, `DEFAULT FALSE` | **PASS** | `TestSMSFallbackColumnIsAppendedLast` (last position, no `UPDATE`), the four count assertions at 76, `TestAccountMigrationsApplyToAPreExistingDatabase` |

### Validation and constraints

| AC | Result | Evidence |
|---|---|---|
| **AC-37** non-boolean or missing → 400 BAD_REQUEST, nothing written | **PASS** | `TestAnInvalidSMSFallbackValueIsRefusedBeforeAnyWrite` — `"yes"`, `1`, `{}`, `null`, empty, non-JSON; all 400 with code `BAD_REQUEST`, one identical body |
| **AC-38** unknown `account_id` → 404, same shape | **PASS** | `TestAnUnknownAccountAnswers404` (code `ACCOUNT_NOT_FOUND`, id not echoed) |
| **AC-39** arming with no gateway is allowed | **PASS** | the usecase performs no gateway check; `TestSMSFallbackEnableAndDisableAnswer200WithTheNewState` runs with no gateway configured and answers 200 |
| **AC-40** a gateway failure does not mask the original error | **PASS** | `TestSMSGatewayFailureIsReportedAndNeverRetried` (own log line, `Sent=false`); `DeliverSMSFallback` returns no error, so a call site cannot substitute one; `TestSendTextReturnsTodaysErrorWhenTheSMSDoesNotDeliver` |
| **AC-41** truncation only if documented, and recorded | **PASS** | `TestTruncateForSMS` (5 cases incl. a rune boundary), `TestSMSFallbackRecordsTruncation` |

### API consistency

| AC | Result | Evidence |
|---|---|---|
| **AC-42** REST is the only surface | **PASS** | no UI file in the diff |
| **AC-43** `POST /send/message` reports the channel | **PASS** | `TestSendTextFallsBackToSMSWhenThereIsNoClient` asserts `channel: "sms"`; the WhatsApp half is `response.Channel = ChannelWhatsApp` on the success line, with `TestSuccessfulWhatsAppSendReportsItsChannel` pinning the vocabulary. **Stated limit:** the WhatsApp half is not driven end to end, because a successful send needs a live websocket that cannot exist in a test. |
| **AC-44** documented in `docs/openapi.yaml`, at `/api-docs`, with examples | **PASS** | the new path with two request and two response examples; `sms_fallback_enabled` on `Account`; `SendMessageResponse` with a `whatsapp` and an `sms` example; the spec parses and both copies are byte-identical |
| **AC-45** errors follow `ResponseData` | **PASS** | the handler returns `accountBadBody` / `accountError`, both of which build `utils.ResponseData`; asserted in the 400 and 404 tests |
| **AC-46** a policy-matrix row for the new route | **PASS** | `policy_matrix_test.go`; the boot assertion `AssertPolicyCoverage` would refuse to start otherwise |

### Audit and logging

| AC | Result | Evidence |
|---|---|---|
| **AC-47** an audit line per enable/disable, `[ACCOUNTS] actor=…` style | **PASS** | `usecase/account.go > SetSMSFallback` — `[ACCOUNTS] actor=%q set account=%q sms_fallback_enabled=%t`, the same shape as `SetDeviceSendState` beside it |
| **AC-48** one line per attempt: account, device, message id, outcome, coded reason | **PASS** | `TestTransportRefusedArrivalReachesTheSMSStage` asserts the coded WhatsApp reason is in the line |
| **AC-49** one line per skip with the coded reason | **PASS (extended)** | `smsSkipped` writes it; the returned reason is asserted for all seven cases. **Three reasons beyond the ticket's four** were added and are recorded in `spec.md`: `no_account`, `fallback_state_unknown`, `gateway_busy`. **`gateway_unconfigured` writes no line at all** — see deviation D-1; the fact is stated once at startup, which is what AC-29 asks for, and an existing test caught the per-message version. |
| **AC-50** never the credential, never the body | **PASS** | `TestSMSGatewayFailureIsReportedAndNeverRetried` asserts neither appears in any captured line; `TestSMSGatewayNeverLogsTheMessageBody`; `TestSMSGatewayNeverQuotesAnAuthFailureBody` |
| **AC-51** a refusal discloses nothing about the other account | **PASS** | `TestSMSFallbackRefusesAForeignAccountWithoutDisclosure` asserts the account id is not echoed in the body; the usecase is never reached, so it writes no line about it either |

## Stated limits

Three, named rather than rounded up:

1. **AC-43's WhatsApp half is not driven end to end.** A successful send requires
   a live websocket. The constant is pinned and the code path is one line; the
   SMS half is fully exercised.
2. **No live PostgreSQL run.** Docker Desktop is not running here. Migration 76's
   portability rests on the dialect walk, the pre-existing-database upgrade test,
   and an exact precedent two migrations earlier.
3. **AC-1 and AC-18 are satisfied by construction, not by a new test.** AC-1 is
   the device-ownership guard tickets 25/27 already ship and this ticket does not
   touch; AC-18 is the absence of a storage write, pinned indirectly by the read
   counters. Neither has a test that could fail only for this ticket's reasons,
   and inventing one would have been a tautology.

## Residual risk, carried forward

Recorded in `spec.md > Residual risk` and in `src/.env.example`, and declined here
as scope rather than solved:

1. **No SMS spend cap.** Any caller holding `messages.send` can spend the
   deployment's SMS budget, one message per request. Bounded by: one SMS per
   failed message, no gateway retry, the E.164 shape test, the 8-slot semaphore,
   and the two switches an operator and an admin must both throw. The security
   lens raised it as a `major`; the next ticket inherits the finding intact.
2. **The agent path holds an `agentCalls` slot while the stage runs**, growing
   the worst-case hold from 180s to 190s (−5% on the 32-slot ceiling) during an
   account-wide outage. Releasing it earlier restructures ticket 19's concurrency
   design.
