---
ticket: z8pmx9mb5r
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-04
links:
  clickup: "https://app.clickup.com/t/z8pmx9mb5r"
  github: ""
---

# Implementation — 29 · Record and return who sent each outbound message

Applied on branch `ticket/z8pmx9mb5r`, cut from `ticket/z8pmx9m6pg`. No commit was
created here; the single publishable commit is `/publish-pr`'s job.

**9 new files, 31 modified.** No deployment runtime file touched.

## What was built

The value, one context stamp, six capture points, one closed vocabulary enforced at
the write, three additive columns, one permission, three response fields, and an
account-scoped read-time name resolution.

### New

| File | What |
|---|---|
| `src/domains/chatstorage/origin.go` | `MessageOrigin`, the five-value closed vocabulary, `IsValidSentVia`, the context stamp/reader, and `ShouldWarnUnstampedOrigin` (the TTL suppressor) |
| `src/domains/chatstorage/origin_test.go` | vocabulary incl. `""`, round-trip, nil ctx, absent-vs-blank, suppressor |
| `src/infrastructure/chatstorage/message_origin_test.go` | migration shape, echo + batch protection, blanking, rune-safe truncation |
| `src/usecase/chat_origin_test.go` | redaction, live resolution, the tenant bound, fallbacks, one-probe-per-sender |
| `src/usecase/send_origin_warn_test.go` | the unstamped-send alarm: silent when stamped, named when not, suppressed on repeat |
| `src/ui/rest/chat_origin_rest_test.go` | the JSON shape over the real middleware chain |
| `src/ui/rest/send_origin_test.go` | the `api` stamp, and the structural guard that every send handler uses it |
| `src/ui/rest/chatwoot_origin_test.go` | the `chatwoot` stamp, incl. independence from `CHATWOOT_SIGN_MSG` |
| `src/infrastructure/whatsapp/agent_origin_test.go` | the `ai_agent` stamp through the real round trip, through delivery, and across a failover |

### Modified — source

`domains/chatstorage/chatstorage.go` (three `Message` fields) ·
`infrastructure/chatstorage/sqlite_repository.go` (migrations 77–79, the shared
upsert's three `CASE WHEN` clauses, `normalizeMessageOrigin`,
`StoreSentMessageWithContext`, five `SELECT` lists, `scanMessage`) ·
`infrastructure/chatstorage/refresh_token_repository.go` (`truncateRunes` fast path) ·
`domains/chat/chat.go` (three `MessageInfo` fields) ·
`pkg/auth/perm.go` (the permission + catalogue entry) ·
`usecase/chat.go` (the option, the account-scoped resolver, the redaction) ·
`usecase/auth.go` (`LookupSenderIdentity`) ·
`usecase/send.go` (`warnUnstampedSend`, `unstampedSendCaller`) ·
`cmd/helpers.go` + `cmd/rest.go` (the wiring) ·
`cmd/chatstorage_migrate.go` (the copy list) ·
`ui/rest/send.go` (`sendContext` + 12 handlers) · `ui/rest/message.go` (forward) ·
`ui/rest/chatwoot.go` (`chatwootMessageOrigin` + the stamp) ·
`ui/mcp/helpers/context.go` (the MCP stamp) ·
`docs/openapi.yaml` + `ui/rest/apidocs/openapi.yaml` (the three fields).

### Modified — tests whose assertions legitimately moved

`pkg/auth/auth_test.go` (catalogue 27→28 + the id) · `usecase/auth_test.go`,
`usecase/identity_test.go`, `ui/rest/auth_test.go` (admin 25→26 permissions) ·
`infrastructure/chatstorage/{sqlite_repository_account,sqlite_repository_debug,user_admin_repository,user_repository}_test.go`
(migration count 76→79) · `infrastructure/chatstorage/account_sms_fallback_test.go` ·
`infrastructure/chatstorage/sqlite_repository_account_test.go` (the rollback list) ·
`infrastructure/whatsapp/agent_reply_routing_test.go` (the spy captures its ctx) ·
`ui/mcp/helpers/mcp_principal_scope_test.go` · `cmd/chatstorage_migrate_test.go`.

## Deviations from the plan

Seven, and four of them were found by the compiler or by a failing test rather than
by review.

**D-1 — `pkg/auth/perm_test.go` does not exist; `auth_test.go` hard-asserts the
count.** The panel caught the wrong filename before implementation; what it could not
predict is that `pkg/auth/auth_test.go:22` asserts `len(catalogue) != 27` **and** spells
out the exact 27 ids. Both were updated to 28 with the new id, and a new
`TestMessagesOriginReadIsAdminTierAndNotGlobal` asserts the tier from three directions
(admin derives it, super_admin has it, the literal user set does not, and it is not
global).

**D-2 — three more permission counts moved than the plan listed.** `usecase/auth_test.go`,
`usecase/identity_test.go` and `ui/rest/auth_test.go` each assert "admin holds 25
permissions". They are asserting the DERIVATION property — a catalogue entry must
reach admin with no grant edit — so 25→26 is the assertion doing its job, and each
now carries a one-line note saying so.

**D-3 — four migration-count assertions and the rollback list.** `76 → 79` in four
test files. More interesting:
`TestAccountMigrationsApplyToAPreExistingDatabase` rolls a database back to version 50
and re-runs every migration, and it failed with `duplicate column name: sent_via` —
because its rollback list did not drop the new columns. That is the test working
exactly as its own comment describes ("a column left behind makes its migration fail
on re-application"), so the three `DROP COLUMN` statements were added. **This is the
only assurance in the suite that migrations 77–79 apply cleanly to an existing
database**, so it mattered that it went red.

**D-4 — `TestSMSFallbackColumnIsAppendedLast` was renamed, not just re-numbered.**
Ticket 28's migration is no longer last. The test now asserts it is at **index 76** —
which is a stronger statement than "last" and is the property the index-positional
list actually needs: appending after it must never move it.

**D-5 — the canonical OpenAPI file is `docs/openapi.yaml`, not the embedded copy.** I
edited `src/ui/rest/apidocs/openapi.yaml` first and
`TestEmbeddedSpecMatchesTheCanonicalOne` failed, byte-for-byte, naming both paths.
The edit was moved to the canonical file and copied down. The test is the reason the
duplication is survivable and it did its job on the first run.

**D-6 — `chatwootMessageOrigin` was extracted.** The plan built the origin inline in
`deliverChatwootReply`, which needs a device manager and cannot be reached in a unit
test — so the assertion that matters (the record is independent of
`CHATWOOT_SIGN_MSG`) would have been untestable. Pulling four lines into a pure
function made it testable, and the test now asserts BOTH that the origin is unchanged
by the setting AND that the setting really did change the message body — without that
second half it would have passed for the wrong reason.

**D-7 — `unstampedSendCaller` skips 2 frames, not 4, and the test found it.** The
first version skipped a hand-counted four frames. Written that way it depends on the
exact helper depth, and the test showed the effect immediately: called directly it
reported `testing.tRunner` rather than the caller. The skip is now 2 and the
**"first frame outside package usecase" filter does all the work** — which is also
what makes it correct in production, where `wrapSendMessage`, `SendText` and the
helper are all in `usecase`, so the surviving frame is the REST handler, the MCP tool
or the Chatwoot reply. The test asserts the *mechanism* (no `usecase.` frame, no
`unknown`, no file position) rather than a literal answer that only holds in one
call shape.

## Validation run

From `src/`, with `-tags purego` — there is no cgo toolchain on this machine, and this
is the command set the previous five tickets on this branch line used.

| | Baseline (unmodified tree, measured before the first edit) | After |
|---|---|---|
| `go build -tags purego ./...` | clean | clean |
| `go vet -tags purego ./...` | clean | clean |
| `go test -tags purego ./...` | 18 packages `ok`; **1 failure: `TestResolveDocumentMIME` (`usecase`)** | 19 packages `ok`; **the same 1 failure, nothing else** |

The extra `ok` package is `domains/chatstorage`, which had no test file before this
ticket. `TestResolveDocumentMIME` predates this branch — tickets 19 and 28 record it
too, and it is about a zip MIME string with no relation to anything here.

## Mutation checks

Most of what this ticket adds is a **guard**, and a guard passes its test by doing
nothing — which is also how a broken guard passes. Six were therefore broken
deliberately, shown to fail, and reverted. All six failed:

| # | Broken | Failing test(s) |
|---|---|---|
| 1 | the three `CASE WHEN` clauses → plain `excluded.` overwrite | `TestUpsertDoesNotBlankARecordedOrigin`, `TestBatchUpsertDoesNotBlankARecordedOrigin` |
| 2 | `IsValidSentVia` blanking disabled | `TestStoreMessageBlanksAnUnknownSentVia`, `TestBatchBlanksAnUnknownSentViaWithoutLosingTheChunk` |
| 3 | `if mayReadOrigin` → `if true` | `TestOriginIdentityIsAbsentWithoutThePermission`, `TestRESTOriginIdentityKeysAreAbsentWithoutThePermission` |
| 4 | the `MayAddressAccountScope` gate removed | `TestForeignAccountNameIsNotResolvedLive` — reported the leaked name verbatim |
| 5 | `omitempty` removed from `sent_by` / `sent_by_name` | `TestRESTOriginIdentityKeysAreAbsentWithoutThePermission`, `TestPreExistingRowsCarryNoOriginKeys` |
| 6 | `ForwardMessage` reverted to `ContextWithDevice` | `TestEverySendHandlerUsesSendContext` |

Mutation 6 is worth naming: it is the only guard against a failure that produces **no
wrong value and no error** — a new send route whose messages are simply
unattributable — and the mutation confirms the structural test is not a tautology.

## Notes carried forward

- **The `chatwoot` identity is self-asserted.** `chatwootWebhookAuthorized` admits
  every caller when `CHATWOOT_WEBHOOK_SECRET` is unset, so on such a deployment the
  stored agent id and name are what the caller said they are. Not a regression — the
  same caller can already send from the number — but it is now written into
  `chatwoot.go`, into `spec.md > D-4`, and into the OpenAPI description of both gated
  fields.
- **MCP reads the new fields on an unauthenticated port.** The system principal
  carries `SuperAdminPermissions()`, so it gains `messages.origin.read` by
  derivation. Reach-preserving by that file's own argument, but a new *class* of data
  (staff user ids and usernames), and now pinned by
  `TestMCPPrincipalHoldsTheOriginPermission`.
- **`sent_by_label` has no eraser.** It is a permanent snapshot; only a device purge
  removes it. That is what keeps a deleted user's message attributable.
- **No `lock_timeout` was added to the shared migration runner.** The hazard is
  recorded in the migration comment with operator guidance instead; see
  `plan.md > S-3` for why changing the boot contract of all 79 migrations is its own
  ticket.
