---
ticket: z8pmx9mb5r
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-04
links:
  clickup: "https://app.clickup.com/t/z8pmx9mb5r"
  github: ""
---

# Verification — 29 · Record and return who sent each outbound message

**Outcome: PASSED.** All 34 acceptance criteria are mapped to an executed result
below. Three limits are stated rather than rounded up (AC-19, AC-27, and the
PostgreSQL run); nothing is recorded as proven that was not.

## Runtime impact

**No deployment runtime file changed.** `git status` over `docker-compose.yml`,
`docker/` and `.github/` is empty. The change is additive: three `ALTER TABLE ... ADD
COLUMN` statements with `NOT NULL DEFAULT ''`, no backfill, no index, and one
permission row the boot seeder reconciles.

The one operational note an operator needs is in the migration comment rather than
hidden: on PostgreSQL the pending batch runs in **one transaction**, so the `ALTER` on
`messages` — the largest and hottest table in a deployment — waits for the longest
in-flight transaction touching it, and **while it waits every new reader and writer of
`messages` queues behind it**. The DDL itself is O(1) metadata (SQLite always;
PostgreSQL 11+ stores the non-volatile default in `attmissingval`), so the cost is
lock shape, not rewrite. There is no `lock_timeout` on any migration path in this
repository, which is why the comment tells the operator to set one on the migrating
role or quiesce ingest. Migration 76's "sub-second" wording was deliberately **not**
reused: it earned that only because `accounts` holds one row per tenant.

A rollback needs nothing: the previous binary names these columns in no `SELECT`, no
`INSERT` column list and no struct.

## Validation run

From `src/`, `-tags purego` (no cgo toolchain on this machine; the command set the
previous five tickets on this branch line used).

| | Baseline (unmodified tree, before the first edit) | After |
|---|---|---|
| build | clean | clean |
| vet | clean | clean |
| test | 18 packages `ok`, **1 failure: `TestResolveDocumentMIME` (`usecase`)** | 19 packages `ok`, **the same 1 failure, nothing else** |

The extra `ok` is `domains/chatstorage`, which had no test file before this ticket.
`TestResolveDocumentMIME` predates this branch (tickets 19 and 28 record it) and
concerns a zip MIME string unrelated to anything here.

## Acceptance criteria

### Storage

| AC | Result | Evidence |
|---|---|---|
| **AC-1** three additive columns, `NOT NULL DEFAULT ''`, appended | PASS | `TestMessageOriginColumnsAreAppendedLast` checks the last three entries by name, type and default |
| **AC-2** no backfill; pre-existing rows read `''` | PASS | same test scans **every** migration for an `UPDATE` touching the three columns; `TestPreExistingRowsCarryNoOriginKeys` shows the read side omits them |
| **AC-3** on `messages`, not a side table | PASS | by construction; the reasoning is recorded in the migration comment and `spec.md > AC-3` |
| **AC-4** closed vocabulary in `domains/chatstorage`, refused elsewhere | PASS | `TestIsValidSentVia` (five values **and** `""` valid; 11 plausible inventions rejected), `TestSentViaConstantsAreTheDocumentedStrings` |
| **AC-5** `sent_by` is the stable identity, never a display name | PASS | `TestSendContextStampsTheAuthenticatedPrincipal` (user id, not username), `TestChatwootOriginRecordsTheAgent` (`chatwoot:42`), `TestAgentReplyCarriesNoIdentityKeys` (empty for `ai_agent`) |
| **AC-6** `sent_by_label` is a send-time snapshot, fallback only | PASS | `TestOriginIsReturnedAndTheNameIsResolvedLive` asserts the stored label is **not** rewritten by a live resolution |
| **AC-7** the upsert must not blank a recorded origin | PASS | `TestUpsertDoesNotBlankARecordedOrigin` — and it also asserts `content` **did** update, so the `CASE WHEN` is not freezing the row. **Mutation 1** |
| **AC-8** the batch shares the statement and the protection | PASS | `TestBatchUpsertDoesNotBlankARecordedOrigin`, `TestBatchUpsertWritesANonEmptyOrigin`. **Mutation 1** |
| **AC-9** no index on the three columns | PASS | `TestMessageOriginColumnsAreAppendedLast` scans every migration for `CREATE INDEX` naming them |

### Capture — write path

| AC | Result | Evidence |
|---|---|---|
| **AC-10** one context stamp, in the existing shape | PASS | `TestMessageOriginContextRoundTrip`, `TestContextWithMessageOriginSurvivesANilContext`, `TestMessageOriginFromContextDistinguishesAbsentFromBlank` |
| **AC-11** the write reads the context; the interface is unchanged | PASS | `TestStoreSentMessageWithContextRecordsTheStampedOrigin`; `domains/chatstorage/interfaces.go` is **not** in the changed-file list |
| **AC-12** `api` records the principal | PASS | `TestSendContextStampsTheAuthenticatedPrincipal`; `TestEverySendHandlerUsesSendContext` proves every handler routes through it. **Mutation 6** |
| **AC-13** `mcp` records `system:mcp` | PASS | `TestMCPOriginMatchesTheSystemPrincipal`, `TestMCPDefaultDeviceContextStampsTheOrigin` |
| **AC-14** `chatwoot` records the agent, independent of `CHATWOOT_SIGN_MSG` | PASS | `TestChatwootOriginIsIndependentOfTheSignature` — asserts the origin is unchanged **and** that the body did change, so it cannot pass for the wrong reason; `TestChatwootOriginNamesNoActorWithoutASenderID` |
| **AC-15** `ai_agent` with no identity | PASS | `TestRunAgentBridgeStampsTheAgentOrigin` drives the **real** round trip (agent HTTP call included) and reads the context delivery receives; `TestDeliverAgentReplyCarriesTheOriginToTheStore` |
| **AC-16** failover keeps `ai_agent` on the arrival partition | PASS | `TestFailoverKeepsTheAgentOriginOnTheArrivalPartition` — a sibling delivers after a `meta_cloud` refusal and the stored origin is still `ai_agent` |
| **AC-17** `auto_reply` with no identity | PASS | `TestAutoReplyStampsItsOrigin` (structural — see the limit below) |
| **AC-18** an unstamped path stores `''` and behaves as today | PASS | `TestStoreSentMessageWithContextStoresNoOriginWhenUnstamped` — the send **succeeds** and the row is blank |
| **AC-19** capture never fails or delays a send | PASS **with a stated limit** | see below |

**AC-19, stated exactly.** The store-side work is unchanged: the origin rides the
existing asynchronous goroutine, and `context.WithoutCancel` carries the stamp into
it. What this ticket **does** add on the synchronous path is one context-value read
per send (`warnUnstampedSend`'s `MessageOriginFromContext`) — a walk of a
handful-deep context chain and a type assertion, tens of nanoseconds, no I/O, no lock.
The stack walk it guards runs **only** when the stamp is absent, which
`TestWarnUnstampedSendIsSilentForAStampedContext` pins. Calling that "no new blocking
call" would be a claim the code does not support, so it is written down instead. Also
recorded during the panel review and carried in `spec.md > NFR-2`: the **auto-reply**
path's store was already synchronous on the whatsmeow event goroutine before this
ticket; that is pre-existing and this ticket adds one `context.WithValue` there.

### Read — API surface

| AC | Result | Evidence |
|---|---|---|
| **AC-20** three `omitempty` fields; pre-existing rows byte-identical | PASS | `TestPreExistingRowsCarryNoOriginKeys`, `TestRESTOriginReachesAPrivilegedCaller`. **Mutation 5** |
| **AC-21** `sent_via` to any `chats.read` caller | PASS | `TestOriginIdentityIsAbsentWithoutThePermission` asserts `sent_via` is **present** for a caller holding only `chats.read` |
| **AC-22** `sent_by`/`sent_by_name` only with the permission; keys absent | PASS | `TestRESTOriginIdentityKeysAreAbsentWithoutThePermission` reads generic JSON, so "absent" is a property of the bytes; status is 200, never 403. **Mutations 3 and 5** |
| **AC-23** appended to the catalogue, not in the user set, derived by admin | PASS | `TestMessagesOriginReadIsAdminTierAndNotGlobal` (three directions), `pkg/auth/auth_test.go` count 28 + exact id, and the three admin-count assertions moved 25→26 |
| **AC-24** resolved once per page from the cache, zero queries, scoped | PASS | `TestOriginIsReturnedAndTheNameIsResolvedLive` (rename resolves), `TestOriginNamesAreResolvedOncePerDistinctSender` (10 messages → 1 probe), `TestUnresolvableSendersFallBackToTheStoredLabel`, `TestNoLookupWiredFallsBackToTheSnapshot`, `TestForeignAccountNameIsNotResolvedLive` + `TestGlobalTierResolvesAForeignAccountName`. **Mutation 4** |
| **AC-25** no additional query, join or round trip | PASS | the usecase stub counts every loader the feature could add and asserts `extraReads == 0` |
| **AC-26** MCP `get_chat_messages` unchanged, receives all three | PASS | it calls the same usecase with the system principal; `TestMCPPrincipalHoldsTheOriginPermission` pins the reach. `gowa mcp` has no principal cache, so `sent_by_name` is the stored snapshot — the documented degraded mode (`spec.md > D-3`), asserted by `TestNoLookupWiredFallsBackToTheSnapshot` |
| **AC-27** OpenAPI documents the fields, vocabulary and gate | PASS **with a stated limit** | `docs/openapi.yaml` (canonical) + the embedded copy, enum on `sent_via`, the permission named on both gated fields, and the `chatwoot` trust boundary. `TestEmbeddedSpecMatchesTheCanonicalOne` proves the two files agree **byte-for-byte**; nothing machine-checks the prose against the code |

### Validation and constraints

| AC | Result | Evidence |
|---|---|---|
| **AC-28** an unknown `sent_via` never reaches the API | PASS | `TestStoreMessageBlanksAnUnknownSentVia` (row kept, value gone), `TestBatchBlanksAnUnknownSentViaWithoutLosingTheChunk` (the other rows survive). **Mutation 2** |
| **AC-29** length-bounded, never mid-rune, never markup | PASS | `TestOriginIdentityIsTruncatedWithoutSplittingARune` (400 Arabic runes → 255, still valid UTF-8), `TestOriginIdentityShorterThanTheBoundIsUnchanged` |
| **AC-30** no credential, token, endpoint URL or secret in the columns or fields | PASS | by construction, and the construction is small enough to state exhaustively: the only values written are `principal.UserID`/`Username`, `chatwoot:<Sender.ID>`/`Sender.Name`, or `""`. No code path reads config, a token, a webhook secret or an agent endpoint into a `MessageOrigin` |

### Audit and logging

| AC | Result | Evidence |
|---|---|---|
| **AC-31** an unstamped send warns with the message id and the path; the send succeeds | PASS | `TestWarnUnstampedSendNamesTheMessageAndThePath`; the send path is untouched — the warning has no error return and no branch |
| **AC-32** no message content; no argument values; deduplicated | PASS | the same test asserts no file position and no content; `TestWarnUnstampedSendSuppressesRepeatsFromOnePath` (5 → 1), `TestShouldWarnUnstampedOriginSuppressesRepeats`, `TestShouldWarnUnstampedOriginIsPerPath`, `TestShouldWarnUnstampedOriginIgnoresABlankPath` |

### Added by this specification

| AC | Result | Evidence |
|---|---|---|
| **AC-33** the forward route records the same `api` origin | PASS | `TestEverySendHandlerUsesSendContext`. **Mutation 6** — reverting `ForwardMessage` to the raw `ContextWithDevice` fails it with the route named |
| **AC-34** the three columns survive `gowa chatstorage-migrate` | PASS | `TestMessagesCopyListCarriesTheSendOrigin` |

## Mutation checks

A guard passes its test by doing nothing — which is also how a broken guard passes.
Six were broken deliberately, shown to fail, and reverted. **All six failed**; the
table is in `implement.md`. Two are worth repeating here:

- **Mutation 4** (the account-scope gate removed) failed with the leaked name printed
  verbatim: `sent_by_name = super.renamed, want the stored snapshot`. That is the
  cross-tenant read the security lens found in revision 1 of the plan, reproduced on
  demand.
- **Mutation 6** guards a failure with **no wrong value and no error** — a new send
  route whose messages are simply unattributable. It confirms the structural test is
  not a tautology.

## Limits — what was NOT proven

Three, stated rather than rounded up.

1. **No live PostgreSQL run.** Docker is not available on this machine, so the suite
   was not run against `postgres:16`. What *is* covered: `migrations_dialect_test.go`
   renders the whole list without a database, and
   `TestAccountMigrationsApplyToAPreExistingDatabase` rolls a database back to version
   50 and re-applies every migration — that test **failed first** on `duplicate column
   name: sent_via` until its rollback list was extended, which is direct evidence it
   actually exercises 77–79. The three statements are plain `ADD COLUMN` with the
   exact shape migrations 75 and 76 already ship on both engines. Same gap tickets 27
   and 28 shipped with.
2. **AC-17 (auto-reply) is asserted structurally, not end to end.** `handleAutoReply`
   needs a live whatsmeow client to reach its store, so the test asserts the stamp is
   present in the function and that the constant is in the closed vocabulary. The
   behavioural half — that a stamped context reaches the row — is covered generically
   by `TestStoreSentMessageWithContextRecordsTheStampedOrigin`. The same limit applies
   to the MCP stamp; both are recorded rather than described as end-to-end.
3. **The byte-identity check for NFR-3 was done by assertion, not by capture.** No
   response was captured from a running server before and after and compared as bytes;
   instead `TestPreExistingRowsCarryNoOriginKeys` asserts that all three keys are
   absent from the marshalled body for a row with no origin, which is the property
   that makes the bytes identical. A captured-pair comparison would be stronger.

## Residual risks carried forward

- **The `chatwoot` identity is self-asserted** on a deployment with no
  `CHATWOOT_WEBHOOK_SECRET`. Documented in three places; not closed. Hardening that
  endpoint is its own ticket.
- **MCP serves the new fields on an unauthenticated port.** Reach-preserving, pinned
  by a test, and recorded — but it is a new class of data (staff user ids and
  usernames) reachable by anything that can reach the MCP port.
- **No `lock_timeout` on the migration runner.** The hazard is documented with
  operator guidance; changing the boot contract of all 79 migrations is its own ticket.
