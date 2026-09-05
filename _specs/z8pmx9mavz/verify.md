---
ticket: z8pmx9mavz
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mavz"
  github: ""
---

# Verification — 27 · Disable a device's webhook without deleting it

**Outcome: PASSED.** All 25 acceptance criteria are mapped to an executed result.

## Runtime impact

**Does this change any deployment runtime file? NO.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh` and the three workflow files
under `.github/workflows/` are untouched — confirmed by `git status`, which lists
19 changed paths, none of them a deployment runtime file.

It does change **database schema** (migration 75) and **runtime behaviour on the
per-event delivery path**, so the operational notes at the end of this document
are the part worth reading before a deploy.

## Suite

```
go build -tags purego ./...    clean
go vet   -tags purego ./...    clean
go test  -tags purego ./...    18 packages ok, 1 failure
```

The single failure is `TestResolveDocumentMIME/Zip`:

```
send_test.go:82: resolveDocumentMIME() = "application/x-zip-compressed", want "application/zip"
```

It is the Windows MIME-registry quirk, and it was **measured on the unmodified
tree before the first edit of this ticket**. Diffing the baseline against the
final run package by package leaves only cache markers and timings — the same 18
`ok` lines and the same one failure. Nothing this ticket touched moved the suite.

54 assertions across 26 new test functions cover the change itself; every one
passes.

## Why a green suite is weak evidence here, and what was done about it

This ticket's central claims are claims about **absence** — no HTTP request, no
agent call, no fallback. A test asserting "nothing was delivered" passes just as
happily when the path under test is broken outright, or when the test never
reached the code at all. So the suite was attacked rather than trusted: each
mutation below was introduced, run, and reverted.

**Mutation 1 — `deviceWebhookEnabled` returns `true` unconditionally** (the gate
is removed). Detected, by five tests:

```
--- FAIL: TestDeviceWebhookEnabledFailsOpenOnAbsence/explicit_false_is_the_ONLY_thing_that_silences
--- FAIL: TestDisabledDeviceDeliversNowhere
--- FAIL: TestDisabledDeviceWithNoWebhookURLDeliversNowhere
--- FAIL: TestReEnablingRestoresTheStoredConfiguration
--- FAIL: TestDisabledDeviceIsRefusedBeforeAnySiblingIsConsidered
```

**Mutation 2 — `SetDeviceWebhookConfig` also writes `webhook_enabled`** (the
settings write moves the switch). Detected:

```
device_webhook_enabled_test.go:175: editing the webhook settings re-enabled a disabled device
--- FAIL: TestSetDeviceWebhookConfigDoesNotMoveTheSwitch
```

### One mutation was NOT detected, and it exposed a real coverage hole

Under mutation 1, `TestDisabledDeviceMakesNoAgentCall` — the test carrying the
whole of **AC-16**, the "stop the robot" half of the ticket — **passed**.

The cause was in the test, not the gate. Its device row carried
`WebhookURL: deviceWebhookURL()` (`https://device.example/hook`), and
`agentEndpointFromRecord` prefers the device's own webhook over
`AGENT_WEBHOOK_URL`. So the agent request was being sent to an unrelated host and
the counter on the `httptest` server could never increment — whether the gate
worked or not. The assertion was a tautology, and it would have shipped as the
sole evidence for the acceptance criterion the operator cares about most.

Fixed by pointing the device's own webhook at the counting server, which is also
the more faithful scenario: a device that has its own webhook configured is
exactly the shape the ticket is about. Re-verified both ways — the test passes
clean, and under mutation 1 it now fails with:

```
the agent endpoint was called 1 time(s) for a disabled device; the bridge must not run at all
a reply was delivered 1 time(s) for a disabled device
```

The reason for the failure is recorded in a comment on the fixture itself, so the
next person to touch that row knows why the URL points where it does.

## Acceptance criteria

### Storage and the default

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** Migration 75, append-only, `NOT NULL DEFAULT TRUE`, no backfill | **PASS** | `TestAccountSchemaIsAppendedNotEdited` (invariants: one statement, no `UPDATE`), `TestMigration73IsAppendedLast`, the PostgreSQL dialect walk in `migrations_dialect_test.go`, and `TestAccountMigrationsApplyToAPreExistingDatabase`, which upgrades a database rolled back to version 50 |
| **AC-2** A pre-existing and a newly created device both read `true` | **PASS** | `TestNewDeviceIsWebhookEnabledByDefault` — a row inserted by `SaveDeviceRecord`, whose INSERT never names the column, against a real database. Also pins that the `*bool` scans out non-nil |
| **AC-3** Visible on every read path carrying the shared tail | **PASS** | `TestWebhookEnabledIsVisibleOnEveryDeviceReadPath` — `GetDeviceRecord`, `GetDeviceRecordByJID`, `ListDeviceRecords`; the two `account_repository.go` listings interpolate the same constant and use the same scan helper |
| **AC-4** The write touches only `webhook_enabled` and `updated_at` | **PASS** | `TestSetDeviceWebhookEnabledLeavesTheConfigurationLiterallyUnchanged` — all four columns read back from the database after a disable |
| **AC-5** `PATCH .../webhook` does not move the flag | **PASS** | `TestSetDeviceWebhookConfigDoesNotMoveTheSwitch`, **and mutation 2** |

### The endpoint

| AC | Result | Evidence |
|----|--------|----------|
| **AC-6** 200 with `{device_id, webhook_enabled}` for both values | **PASS** | `TestDisableAndEnableAnswer200WithTheNewState` (subtests `disable`, `enable`) |
| **AC-7** Idempotent | **PASS** | `TestTheRequestIsIdempotent`, `TestSetDeviceWebhookEnabledIsIdempotent` |
| **AC-8** Non-boolean or absent → 400 before any write | **PASS** | `TestAnInvalidEnabledIsRefusedBeforeAnyWrite` — five subtests (`"yes"`, `1`, `{}`, `null`, non-JSON); each asserts the usecase was **never reached**, not merely the status |
| **AC-9** Disabling a device with no stored URL succeeds | **PASS** | `TestDisabledDeviceWithNoWebhookURLDeliversNowhere`; the write names one column and reads none |
| **AC-10** `GET .../webhook` reports it; `true` when no config exists | **PASS** | `TestGetDeviceWebhookReportsTheState` (both subtests), `TestGetDeviceWebhookEnabledOnAbsentRowIsTrue` |

### Authorization and tenant safety

| AC | Result | Evidence |
|----|--------|----------|
| **AC-11** Existing permissions; catalogue unchanged | **PASS** | `TestWebhookEnabledUsesNoNewPermission` walks `SuperAdminPermissions()` and fails on any webhook permission beyond the two that already existed |
| **AC-12** `user` role → 403, no write | **PASS** | `TestWebhookEnabledRefusesACallerWithoutThePermission`; `TestEveryRouteRequiresExactlyItsSection06Permission` covers the new row |
| **AC-13** Foreign device → 404, byte-identical to a fictional id | **PASS** | `TestWebhookEnabledRefusesAForeignDeviceWithoutDisclosure` — compares the foreign and fictional answers, and asserts the usecase was never reached. `TestWebhookEnabledAdmitsTheCallersOwnDevice` is the other half |
| **AC-14** In the policy matrix; boot coverage still passes | **PASS** | `TestSection06CoversEveryRegisteredRoute`, `TestBootPolicyCoverageOnTheRealRouteSet` (both base paths) |

### Delivery behaviour

| AC | Result | Evidence |
|----|--------|----------|
| **AC-15** No request to the device URL and none to the global list | **PASS** | `TestDisabledDeviceDeliversNowhere` and `TestDisabledDeviceWithNoWebhookURLDeliversNowhere`, both with a global list configured; `TestEnabledDeviceStillDelivers` is the positive control; **mutation 1** proves they are not vacuous. Covers all 13 event families because they share one decision function |
| **AC-16** No agent call, and no sibling takeover | **PASS** | `TestDisabledDeviceMakesNoAgentCall` (**after the tautology above was fixed**), `TestDisabledDeviceIsRefusedBeforeAnySiblingIsConsidered`, `TestEnabledDeviceStillCallsTheAgent` as the control |
| **AC-17** Messages still stored; manual send still works | **PASS** | By construction and inspection: `CreateMessage` runs at `event_message_handler.go:45`, before either gate; no send path reads the flag — `grep` for `WebhookEnabled` and `deviceWebhookEnabled` returns only the storage layer, the two gates and the REST/usecase surface. The existing send suite is unchanged and green |
| **AC-18** Siblings unaffected | **PASS** | `TestDisablingOneDeviceDoesNotAffectASibling` |
| **AC-19** Resumes on the first event after the write | **PASS** | `TestReEnablingRestoresTheStoredConfiguration` — same URL, same secret, next event, no restart |
| **AC-20** Absence is not disablement | **PASS** | `TestDeviceWebhookEnabledFailsOpenOnAbsence` (4 subtests), `TestDeviceLookupFailureStillDelivers`, `TestAgentBridgeGateFailsOpenOnAnUnresolvedRow` |

### Observability

| AC | Result | Evidence |
|----|--------|----------|
| **AC-21** Audit line + websocket broadcast on every write | **PASS** | By inspection of `usecase/device.go`: `[ACCOUNTS] actor=%q set device=%q webhook_enabled=%t`, matching `account.go:485`'s shape, and `DEVICE_WEBHOOK_CONFIG_UPDATED` with `AccountID: s.accountOf(deviceID)`. The actor is `auditActor(c)` — the deviation recorded in `plan.md > D-8` |
| **AC-22** Debug line on a skip; no secret in any new line | **PASS** | The debug line and the hourly throttled warn are in `forwardPayloadToConfiguredWebhooks`; the bridge has its own debug line. No new line references `WebhookSecret` — `TestTheResponseCarriesNoWebhookSecret` additionally pins that the new endpoint's response carries exactly two keys |
| **AC-23** Refusals disclose nothing | **PASS** | The 403 and 404 bodies are produced by the existing `Require` and `RequireDeviceOwnership` guards, unmodified; AC-13's byte-comparison covers the 404 |

### The stated limit

| AC | Result | Evidence |
|----|--------|----------|
| **AC-25** The flag is read off the row the delivery path resolves | **PASS, as a documented limit** | `TestStaleJIDRowGovernsTheGate` pins it, and its assertion text says in words that this is the boundary described in the spec rather than a regression to fix silently |

### Non-functional

| NFR | Result | Evidence |
|-----|--------|----------|
| **NFR-1** No new read on any request path | **PASS** | `TestWebhookForwardStorageCallCountIsUnchanged` (exact equality: 1 read on the JID path, 2 on the fallback) and `TestReplyPathDeviceRowReadsMatchBaseline` both pass **with no edit**; `TestDisabledDeviceIsRefusedBeforeAnySiblingIsConsidered` additionally asserts exactly 1 read on the disabled bridge path |
| **NFR-2** Fail open on absence | **PASS** | AC-20 |
| **NFR-3** Default is the column's | **PASS** | AC-1, AC-2 |
| **NFR-4** One shared column tail | **PASS** | AC-3 |
| **NFR-5** No secret logged | **PASS** | AC-22 |
| **NFR-6** No deployment runtime file | **PASS** | Runtime-impact statement above |
| **NFR-7** Reversible by reverting code alone | **PASS** | Argued in `plan.md > Rollback`; the previous binary's SELECT lists are explicit, so the extra column is invisible to it |

### Documentation

| AC | Result | Evidence |
|----|--------|----------|
| **AC-24** Documented in both OpenAPI copies | **PASS** | The document parses; the new path carries `patch` with 200/400/403/404/500 and two request examples; `webhook_enabled` is on both existing responses; `TestEmbeddedSpecMatchesTheCanonicalOne` passes, which is what proves the served copy matches |

## Residual risks

1. **The stated limit (AC-25).** Where a stale row holds the JID and carries a
   usable webhook while the live slot is reachable only through the registry,
   disabling the live slot does not silence delivery through the stale row.
   Pinned by a test and explained in `plan.md > Panel response`. Closing it costs
   a second query on every inbound event and inverts a precedence rule a prior
   ticket deliberately pinned.
2. **The write is not account-scoped in SQL** (`WHERE device_id = ?`). Tenant
   isolation rests on the route-line ownership guard, which AC-13 now tests at
   request level. The sibling `SetDeviceWebhookConfig` is equally unscoped and
   does something strictly more dangerous — it re-points a webhook to a
   caller-controlled URL — so this ticket does not widen the exposure. Declined
   deliberately (`plan.md > Declined, D-b`).
3. **"Disabled" is not "quiet".** Inbound speech-to-text still runs (a billed
   third-party call), media is still downloaded and then discarded, the built-in
   auto-reply and Chatwoot still fire, and no socket or memory is released. All
   four are named in `spec.md > Out of scope`; an operator expecting a footprint
   reduction will not get one.
4. **The switch is invisible in the device list.** `GET /devices/{id}/webhook`
   reports it, `GET /devices` does not. An operator scanning a fleet cannot see
   which devices are silenced without a request per device. The hourly warn line
   is the mitigation; a list field was declined as a response-shape change no AC
   asks for.
5. **The new endpoint appears in the publicly served `/api-docs`.** That is the
   existing, recorded behaviour of that surface, not a change made here.
6. **`GET .../webhook` still echoes `webhook_secret`,** on both of its existing
   fields and now beside a new one. Pre-existing; explicitly out of scope; the
   new endpoint does not participate in it.
7. **The migration is additive but not reversible in SQL.** A rollback leaves an
   unused column. Harmless — the previous binary never names it — but a
   subsequent re-application of migration 75 against a database that kept the
   column would fail with `duplicate column name`. That is exactly the failure
   `TestAccountMigrationsApplyToAPreExistingDatabase` caught during
   implementation, and it only arises if someone hand-edits `schema_info`.

## Operational note

Nothing changes for an existing deployment on upgrade: migration 75 adds a column
whose default is `TRUE`, rewrites no row, and every device keeps delivering
exactly as before. The first behavioural change happens only when an
administrator calls the new endpoint.
