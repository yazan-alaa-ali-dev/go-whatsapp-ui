---
ticket: z8pmx9mb5r
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mb5r"
  github: ""
---

# Plan — 29 · Record and return who sent each outbound message

> **Revision 2.** Revision 1 was authored before any code and reviewed by the
> advisory panel (`senior-reviewer`, `security-reviewer`, `performance-reviewer`)
> **against the source**. Their 33 findings and this plan's answer to each are in
> **Panel response** at the bottom. Where revision 1 and this text disagree, this
> text is the plan; revision 1's claims that the panel falsified are corrected
> here and named there.
>
> Two findings were structural and revision 1 could not have shipped: the
> unstamped-send warning derived its answer from a Go stack **across a goroutine
> boundary**, where it is a constant; and the read-time name resolution was
> **account-blind**, re-opening ticket 27's cross-tenant read through a field.
> Four more would have failed the build outright — two named files do not exist.

## Approach

The ticket is four seams, and the whole design is choosing them so that nothing
else in the tree has to move.

**Seam 1 — one value, one home.** `MessageOrigin{Via, By, ByLabel}` plus its
closed vocabulary and its context stamp live together in **`domains/chatstorage`**,
in a new file `origin.go`. That package is the one place all six capture points
and the storage layer can already reach: `ui/rest`, `ui/mcp/helpers`,
`infrastructure/whatsapp` and `infrastructure/chatstorage` each import it today,
and it imports nothing that could close a cycle back. The vocabulary constants are
required there by AC-4; putting the stamp beside them means the setter, the reader
and the validator cannot drift into three packages.

It is a **struct, not three loose context values**: three flat values beside each
other are three things a later edit can set two of.

**Seam 2 — the write reads the context, and the signature does not move.**
`StoreSentMessageWithContext` already reads two things out of the context it is
handed (`ClientFromContext`, `DeviceFromContext`). The origin is the third, read
in the same breath (AC-11), and `IChatStorageRepository` is untouched (C-5).

Validation and bounding live one layer lower still, in `StoreMessage` and in the
history-sync chunk loop, so AC-28 is true of *every* call site rather than of one.
**An invalid `sent_via` blanks the origin; it never refuses the row** — see
`spec.md > AC-28`, amended after two lenses independently found that refusing
inside `storeMessagesChunk` rolls back 500 rows and abandons the rest of the sync.

**Seam 3 — the echo protection is in the shared statement, not in a branch.**
`messageUpsertStatement` is already shared by `StoreMessage` and
`StoreMessagesBatch`. Writing the three columns as
`CASE WHEN excluded.c <> '' THEN excluded.c ELSE c END` puts REQ-6 in the SQL,
where the single-message echo and the history-sync re-upsert cannot diverge
(NFR-5, AC-7, AC-8). Unqualified column references inside `DO UPDATE SET` name the
**existing** row on both SQLite and PostgreSQL; the panel traced the new `''`
literals through `dbdialect.Rebind`'s single-quote scanner and confirmed they
contribute no placeholder, so `bind`'s arity guard stays satisfied and the
prepared statement in the batch path is rebound once, not per row.

**Seam 4 — the read is a projection of the row already in hand.** The three
columns join the shared `messages` `SELECT` list and `scanMessage`, so they arrive
with the page with no extra query, join or round trip (AC-25, NFR-1). The only new
work per page is one map of distinct `sent_by` values looked up in the
**in-memory** principal cache — no database query (AC-24).

That lookup is **account-scoped**. `PrincipalCache.Lookup` is keyed on `user_id`
over every user in the deployment, so an ungated resolution would hand an
account-A admin the current username of an account-B user the moment a
`super_admin` sent into that partition. The stored snapshot is still returned — it
is a fact about *this message* and is the accountability record the ticket exists
to give — but the **live** lookup is refused across the tenant boundary, because
that one is a read of another tenant's current state and a rename oracle.

### The one piece of wiring this ticket cannot avoid

`sent_by_name` must come from the principal cache, and `serviceChat` has no way to
reach it (spec D-3). The smallest honest fix, corrected from revision 1:

- put the lookup on the **concrete `*usecase.AuthService` only**, as
  `LookupSenderIdentity(userID) (username, accountID string, ok bool)` — two
  strings, not a `*Principal`, so the read path never receives a foreign
  principal's `Permissions`;
- change `initAuthUsecase` to return `*usecase.AuthService` instead of
  `domainAuth.IAuthUsecase`, so `cmd/rest.go` can reach the method;
- **`domains/auth/interfaces.go` is not touched at all.** Revision 1 proposed
  adding the method to `IAuthUsecase` on the false premise that both fakes embed
  it; `ui/rest/auth_test.go`'s `fakeAuthService` implements it member by member,
  so that edit would have broken the whole `ui/rest` test package — and it would
  have widened a domain interface for one caller;
- make `NewChatService` **variadic** so all **13** existing call sites keep
  compiling untouched (`cmd/root.go:1556` plus 12 in tests — revision 1 said
  eight);
- in `cmd/rest.go`, rebuild `chatUsecase` with the option after `authUsecase` is
  constructed and before any route is registered. The panel verified the ordering
  is safe: `registerDeviceScopedRoutes` is *defined* at line 219 but *invoked* at
  line 308 and reads the package var then; nothing else in `gowa rest` captures
  it; and `gowa mcp` is a separate process that keeps the lookup-less instance.

### Why the origin is not derived at read time from `message_debug`

`message_debug` exists only when AI diagnostics were collected, is gated behind a
different permission, and says nothing about a human sender. Deriving the origin
from it would answer for one of the five channels and guess for four.

## Steps

### S-1 · The value and its vocabulary (new file)

`src/domains/chatstorage/origin.go`:

- `SentViaAPI/MCP/Chatwoot/AIAgent/AutoReply` constants (AC-4).
- `MessageOrigin{Via, By, ByLabel string}`.
- `IsValidSentVia(via string) bool` — true for the five values **and for `""`**,
  which is "not recorded" and must remain storable (AC-4, AC-18).
- `ContextWithMessageOrigin` / `MessageOriginFromContext`, unexported `struct{}`
  key, nil-ctx safe, in the shape of `ContextWithDevice` /
  `ContextWithSMSFallback` / `ContextWithAccountActor` (AC-10).
- `ShouldWarnUnstampedOrigin(path string) bool` — a `sync.Map` + one-hour TTL
  suppressor keyed on the **rendered path**, the same shape and the same reason as
  `agentRefusalWarnTTL` in `agent_bridge.go` and `unresolvedDeviceWarnCache` in
  `webhook_forward.go` (AC-32). It returns a bool and logs nothing, so this domain
  package stays free of a logging dependency; each call site warns with its own
  package's logger, which is the local convention.

### S-2 · The model

`src/domains/chatstorage/chatstorage.go` — three fields on `Message`, after
`ReferralMetadata` and before `Reactions`, so struct order matches column order:

```go
SentVia     string `db:"sent_via"`
SentBy      string `db:"sent_by"`
SentByLabel string `db:"sent_by_label"`
```

`Message` carries **no** `json` tags and is never serialised to a wire payload —
the outbound webhook and the Chatwoot forward both build `map[string]any` — so
this cannot leak into either payload (spec Out of scope; panel-verified).

### S-3 · Migrations 77, 78, 79 (appended)

`getMigrations()`, appended after migration 76, identified by **slug** as 75 and
76 are:

```sql
ALTER TABLE messages ADD COLUMN sent_via VARCHAR(32) NOT NULL DEFAULT ''
ALTER TABLE messages ADD COLUMN sent_by VARCHAR(255) NOT NULL DEFAULT ''
ALTER TABLE messages ADD COLUMN sent_by_label VARCHAR(255) NOT NULL DEFAULT ''
```

Three statements, because the list is **index-positional** and every entry is one
statement (C-2, AC-1). No backfill (AC-2). No index (AC-9).

**The comment does not reuse migration 76's wording, and this is the point the
performance lens made.** The DDL itself is O(1) metadata on SQLite always and on
PostgreSQL 11+ (`attmissingval` holds the non-volatile default) — that half of
migration 76's note is true here too. What does **not** transfer is its escape
clause: migration 76 could say "sub-second" because `accounts` holds one row per
tenant. `messages` is the largest and hottest table in the deployment, written on
every inbound event, every send and every history-sync chunk. On PostgreSQL the
whole pending batch runs in one transaction, so the `ALTER` waits for the longest
in-flight transaction touching `messages` and, **while it waits, PostgreSQL queues
every new reader and writer of `messages` behind it** — ingest stalls for the
length of the wait, not the length of the DDL. There is no `lock_timeout` on any
migration path in this repository. The comment says exactly that and tells the
operator to set `lock_timeout` on the migrating role or quiesce ingest.

Adding `SET LOCAL lock_timeout` to `runMigrationsAtomically` is **declined here**
with a reason: that function applies all 79 migrations for every deployment, and a
timeout that fires aborts the entire pending batch — turning a stall into a failed
boot. Changing the boot contract of every migration is a larger and riskier change
than this ticket, and it belongs to its own ticket with its own verification.

### S-4 · The shared upsert (AC-7, AC-8)

`messageUpsertStatement`: three columns added to the `INSERT` list, three `?` to
`VALUES`, and to `ON CONFLICT ... DO UPDATE SET`:

```sql
sent_via      = CASE WHEN excluded.sent_via      <> '' THEN excluded.sent_via      ELSE sent_via      END,
sent_by       = CASE WHEN excluded.sent_by       <> '' THEN excluded.sent_by       ELSE sent_by       END,
sent_by_label = CASE WHEN excluded.sent_by_label <> '' THEN excluded.sent_by_label ELSE sent_by_label END,
```

Both `Exec` sites (`StoreMessage`, `storeMessagesChunk`) gain the three values in
the same positions — 22 arguments.

### S-5 · Validation and bounding at the write (AC-28, AC-29)

A package-private `normalizeMessageOrigin(message *Message)` — **no error return**
— called at the top of `StoreMessage` and once per row in `storeMessagesChunk`:

- `IsValidSentVia` false → **blank all three columns** and log WARN naming the
  refused value and the message id. The row is stored; the value is not
  (`spec.md > AC-28`). This is the corrected form: revision 1 returned an error,
  which inside the chunk loop would have rolled back 500 rows and abandoned every
  later chunk of the sync.
- `SentBy` / `SentByLabel` → `truncateRunes(strings.TrimSpace(v), 255)`.
- `truncateRunes` (`refresh_token_repository.go`) gains a
  `if len(s) <= n { return s }` byte-length fast path first. It currently
  allocates a `[]rune` **before** its length check, and this ticket puts it on the
  inbound-event goroutine and inside the 500-row chunk loop. Byte length ≥ rune
  count, so the short-circuit is sound; it also benefits the refresh-token path.

`sent_via` needs no truncation: every legal value is at most 10 bytes.

### S-6 · The unstamped-send warning, at the send seam (AC-31, AC-32)

*(Redesigned — see `spec.md > D-2`.)* The storage layer does **not** walk the
stack. It stores `''` and behaves exactly as today (AC-18). The warning is emitted
at the three call sites that reach the sent-message write, each on its own
goroutine where the frames are real:

- **`usecase/send.go > wrapSendMessage`**, *synchronously, before the `go func()`*
  — this is the funnel for `api`, `mcp`, `chatwoot` and `forward`, so here the
  frame is the answer. A bounded `runtime.Callers` walk (≤8 frames, skipping
  `usecase` frames) renders one `package.Function`, e.g.
  `rest.(*Send).SendImage`, `mcp.(*service).handleSendText`,
  `rest.(*ChatwootHandler).deliverChatwootReply`.
- **`agent_bridge.go > deliverAgentReply`** and
  **`auto_reply.go > handleAutoReply`** — a literal path string; the call site *is*
  the path, so there is nothing to discover.

All three go through `ShouldWarnUnstampedOrigin(path)` first, so the walk itself
runs only when a warning is actually due and no path can flood the log. The branch
is dead in production once S-7 lands: `StoreSentMessageWithContext` has exactly
three callers and all three are stamped.

### S-7 · The five capture points (+ the sixth from D-1)

| # | Where | Stamp |
|---|---|---|
| S-7a | `ui/rest/send.go` — new `sendContext(c fiber.Ctx) context.Context`, used by all 12 handlers | `api` + principal `UserID` / `Username` |
| S-7b | `ui/rest/message.go > ForwardMessage` — the same helper (D-1, AC-33) | `api` + principal |
| S-7c | `ui/mcp/helpers/context.go > ContextWithDefaultDevice` | `mcp` + `system:mcp` |
| S-7d | `ui/rest/chatwoot.go > deliverChatwootReply` | `chatwoot` + `chatwoot:<Sender.ID>` / `Sender.Name` |
| S-7e | `infrastructure/whatsapp/agent_bridge.go > runAgentBridge` | `ai_agent`, identity empty |
| S-7f | `infrastructure/whatsapp/auto_reply.go > handleAutoReply` | `auto_reply`, identity empty |

Details that are load-bearing:

- **S-7a** replaces the identical
  `whatsapp.ContextWithDevice(c.Context(), getDeviceFromCtx(c))` expression each of
  the twelve handlers repeats today (panel-verified: exactly twelve), so the diff
  is a substitution. `SendText` keeps its SMS-fallback wrapper *outside* it:
  `whatsapp.ContextWithSMSFallback(sendContext(c))`. Two of the twelve —
  `SendPresence`, `SendChatPresence` — create no message row and are inert; the
  AC-12 test does not assert through them. A request with **no principal** still
  stamps `Via: api` with empty identity, which is what keeps AC-31 an alarm rather
  than a per-request line.
- **S-7c** goes in `ContextWithDefaultDevice`, the file's own documented "one
  place, every tool, including tools added later" (panel-verified as the single
  MCP stamp point). Values come from `SystemPrincipal()`, not a second literal.
- **S-7d** stamps on the one `ctx` `deliverChatwootReply` already builds and reuses
  for the text send and every attachment send. `sent_by` is set **only when
  `payload.Sender.ID != 0`**, so an absent sender never becomes `chatwoot:0`.
  `Contact.ID` is an `int`, so the composed key is injection-free. The stamp comes
  from the payload, not the composed text, so `CHATWOOT_SIGN_MSG` cannot change it
  (AC-14). The **trust boundary is documented, not assumed** — see `spec.md > D-4`
  and S-14.
- **S-7e** stamps on the detached context at the top of `runAgentBridge`, the
  single context both the arrival attempt and the sibling failover travel on, so
  AC-16 holds by construction. It is **not** stamped in `detachedEventContext`,
  which the transcription stage shares.
- **S-7f** stamps once at the top of the auto-reply handler.

### S-8 · Read — the response fields (AC-20)

`src/domains/chat/chat.go > MessageInfo`, after the transcript block, all three
`omitempty` (NFR-3, AC-20, AC-22):

```go
SentVia    string `json:"sent_via,omitempty"`
SentBy     string `json:"sent_by,omitempty"`
SentByName string `json:"sent_by_name,omitempty"`
```

### S-9 · Read — the permission (AC-23)

`src/pkg/auth/perm.go`:

- `PermMessagesOriginRead = "messages.origin.read"` beside the other
  `PermMessages*` constants;
- `{PermMessagesOriginRead, "Read who sent an outbound message"}` **appended to the
  end** of `catalogue`, carrying the append-only comment (C-3);
- **not** added to `userPermissions`; `AdminPermissions()` and
  `SuperAdminPermissions()` pick it up by derivation.

Panel-verified: it does not become a global permission (`globalPermissions` is the
enumerated two), `SeedIdentity` rebuilds grants every boot so existing admins gain
it on upgrade, and `AssertPolicyCoverage` walks routes→guards, so an unwired
permission does not break the boot. It gates two response fields, not an endpoint.

**`src/pkg/auth/auth_test.go` must change with it**: line 22 hard-asserts
`len(catalogue) != 27` and lines 42-56 spell out the exact set. Both are updated
(27→28, plus the new id). Every other count assertion in the tree is derived from
`len(auth.Catalogue())` and survives. *(Revision 1 named `pkg/auth/perm_test.go`,
which does not exist.)*

### S-10 · Read — the usecase (AC-21, AC-22, AC-24, AC-25)

`src/usecase/chat.go`:

- `type SenderIdentityLookup func(userID string) (username, accountID string, ok bool)`,
  plus `ChatServiceOption` / `WithSenderIdentityLookup` and the variadic
  constructor. A func type, not an interface, and two strings, not a `*Principal`.
- In `GetChatMessages`, beside the two existing permission reads:
  `mayReadOrigin := principal.HasPermission(pkgAuth.PermMessagesOriginRead)`.
- `resolveOriginNames(principal, messages) map[string]string` returns nil
  immediately when `mayReadOrigin` is false — a caller who may not see the name
  must not cause the server to resolve one, the "redaction is a skip, not a
  filter" rule ticket 25 set — or when no lookup is wired. Otherwise: one pass,
  distinct `sent_by` values only, **only where `SentVia == api`** (`system:mcp` is
  synthetic and can never be in the cache), one in-memory lookup each, and the
  resolved name is used **only if**
  `pkgAuth.MayAddressAccountScope(principal, accountID, pkgAuth.PermUsersManageAll)`
  — the same helper every other cross-account read in this tree uses.
- Per message: `SentVia` always; and only when `mayReadOrigin`, `SentBy` and
  `SentByName = resolved[SentBy]` falling back to `message.SentByLabel`.

### S-11 · Read — the SELECT lists and the scanner (AC-25)

The three columns are appended to the message column list in **five** places
(`GetMessageByID`, `GetMessageByIDAndDevice`, `GetMessages`, `SearchMessages`,
`getMessageByDeviceAndChatIDAndMessageID`) and to `scanMessage`, in the same
order. Panel-verified that these are exactly the five feeding `scanMessage`.

The `INSERT` in `applyMessageEdit`'s not-found branch is deliberately left alone:
it names its columns explicitly and the `NOT NULL DEFAULT ''` supplies the value —
an edit of a message this server never stored has no origin to record. Its
`UPDATE` branch touches `content`/`updated_at` only, so an edit never disturbs a
recorded origin.

### S-12 · Wiring the lookup

- `src/usecase/auth.go`: `func (s *AuthService) LookupSenderIdentity(userID string) (string, string, bool)`
  → `s.principals.Lookup(userID)`, returning `Username` and `AccountID` only,
  nil-receiver safe.
- `src/cmd/helpers.go`: `initAuthUsecase` returns `*usecase.AuthService`.
- `src/cmd/rest.go`: rebuild `chatUsecase` with
  `usecase.WithSenderIdentityLookup(authUsecase.LookupSenderIdentity)` immediately
  after the `authUsecase == nil` fatal check, with the comment explaining why it
  cannot happen in `initApp`.
- **`src/domains/auth/interfaces.go` is not touched.**

### S-13 · The storage migrator (AC-34)

`src/cmd/chatstorage_migrate.go` — three names appended to the `messages` entry of
`chatStorageTables`. Without it, `gowa chatstorage-migrate` copies every message
and silently resets its origin to "not recorded".

### S-14 · OpenAPI (AC-27, D-4)

`src/ui/rest/apidocs/openapi.yaml > components.schemas.ChatMessage` — the three
properties, the enumerated `sent_via` vocabulary, one sentence naming
`messages.origin.read` and the absent-key shape, and one sentence stating that
`sent_by` / `sent_by_name` are **verified only for `api` and `mcp`**; a `chatwoot`
identity is asserted by the webhook (spec D-4).

### S-15 · Tests

| File | Covers |
|---|---|
| `src/domains/chatstorage/origin_test.go` (new) | AC-4, AC-10, AC-32 — vocabulary incl. `""`, round-trip, nil ctx, absent stamp, TTL suppressor |
| `src/infrastructure/chatstorage/message_origin_test.go` (new) | AC-1/2 (migration list shape + count), AC-7/8 (echo + batch re-upsert), AC-28 (blanking, and the batch keeps its other rows), AC-29 (rune-safe truncation), AC-11/18 (stamped ctx reaches the row; unstamped stores `''`) |
| `src/usecase/chat_origin_test.go` (new) | AC-21/22 (redaction shape), AC-24 (rename resolves, miss falls back, nil lookup falls back, **foreign account is not resolved — TC-17**), AC-25 (no extra repo call) |
| `src/ui/rest/chat_origin_rest_test.go` (new) | AC-20/22 — the JSON body omits the keys, in the shape `chat_redaction_rest_test.go` uses |
| `src/ui/rest/send_origin_test.go` (new) | AC-12/AC-33 — `sendContext` stamps `api` + principal, and `ForwardMessage` uses it |
| `src/pkg/auth/auth_test.go` (modify) | AC-23 — count 27→28, the id in the exact set, user set excludes / admin+super_admin include |
| `src/infrastructure/whatsapp/agent_reply_routing_test.go` (modify) | AC-15/16 — `replyRepoSpy.StoreSentMessageWithContext` captures its `ctx` (today it discards it) and asserts `ai_agent` on both the arrival and the failover attempt |
| `src/ui/mcp/helpers/mcp_principal_scope_test.go` (modify) | AC-13/AC-26 — the MCP stamp, and the permission reaching the system principal stays pinned |
| `src/cmd/chatstorage_migrate_test.go` (modify) | AC-34 — the three columns in the copy list |

Mutation testing at `/verify`: the guards that pass their test by *not* acting —
the `CASE WHEN` echo protection, the `IsValidSentVia` blanking, the
`mayReadOrigin` redaction, the account-scope gate on the name lookup, and the
`omitempty` on the two gated fields — are each broken deliberately and shown to
fail, then reverted. A test that passes against a disabled guard is recorded as a
false pass and rewritten, not counted.

## Files to change

**New (5 source-adjacent, all tests except one)**

1. `src/domains/chatstorage/origin.go`
2. `src/domains/chatstorage/origin_test.go`
3. `src/infrastructure/chatstorage/message_origin_test.go`
4. `src/usecase/chat_origin_test.go`
5. `src/ui/rest/chat_origin_rest_test.go`
6. `src/ui/rest/send_origin_test.go`

**Modified (17)**

1. `src/domains/chatstorage/chatstorage.go` — three `Message` fields
2. `src/infrastructure/chatstorage/sqlite_repository.go` — migrations 77–79, the
   upsert, `normalizeMessageOrigin`, `StoreSentMessageWithContext`, five SELECT
   lists, `scanMessage`
3. `src/infrastructure/chatstorage/refresh_token_repository.go` — `truncateRunes`
   byte fast path
4. `src/domains/chat/chat.go` — three `MessageInfo` fields
5. `src/pkg/auth/perm.go` — the permission constant and catalogue entry
6. `src/pkg/auth/auth_test.go` — catalogue count and exact set
7. `src/usecase/chat.go` — option, lookup, redaction, account-scoped resolution
8. `src/usecase/auth.go` — `LookupSenderIdentity`
9. `src/usecase/send.go` — the unstamped-send warning at the send seam
10. `src/cmd/helpers.go` — `initAuthUsecase` return type
11. `src/cmd/rest.go` — rebuild `chatUsecase` with the lookup
12. `src/cmd/chatstorage_migrate.go` — three column names
13. `src/cmd/chatstorage_migrate_test.go` — the copy-list assertion
14. `src/ui/rest/send.go` — `sendContext` + 12 handlers
15. `src/ui/rest/message.go` — `ForwardMessage`
16. `src/ui/rest/chatwoot.go` — `deliverChatwootReply`
17. `src/ui/mcp/helpers/context.go` — `ContextWithDefaultDevice`
18. `src/ui/mcp/helpers/mcp_principal_scope_test.go` — the pinned reach
19. `src/infrastructure/whatsapp/agent_bridge.go` — `runAgentBridge`, the warn line
20. `src/infrastructure/whatsapp/agent_reply_routing_test.go` — ctx-capturing spy
21. `src/infrastructure/whatsapp/auto_reply.go` — the handler
22. `src/ui/rest/apidocs/openapi.yaml` — `ChatMessage`

*(22 modified, 6 new. Revision 1's list was wrong in three ways the panel caught:
it named `src/infrastructure/chatstorage/errors.go` and `src/pkg/auth/perm_test.go`,
**neither of which exists**; it listed `src/domains/auth/interfaces.go`, which is
no longer touched; and it left two entries conditional, which IM-2/IM-4 forbid.
`ErrMessageOriginRejected` is gone entirely — the blanking design needs no
sentinel.)*

**Not touched:** every deployment runtime file (C-1) — `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`, and the three workflow files;
`src/domains/auth/interfaces.go`; `runMigrationsAtomically`.

## Validation strategy

Run from `src/`, with **`-tags purego`** — there is no cgo toolchain on this
machine, and this is the command set the previous five tickets on this branch line
used:

1. **Baseline first**, on the unmodified tree, before the first edit:
   `go build -tags purego ./...`, `go vet -tags purego ./...`,
   `go test -tags purego ./...` — recorded verbatim.
   **Already measured:** build clean, vet clean, 18 packages `ok`, **one**
   pre-existing failure: `TestResolveDocumentMIME` in `usecase`. It predates this
   branch; tickets 19 and 28 record it too.
2. After implementation: the same three commands, compared against that baseline.
3. Targeted: `go test -tags purego ./domains/... ./infrastructure/chatstorage/...
   ./usecase/... ./ui/rest/... ./ui/mcp/... ./pkg/auth/...
   ./infrastructure/whatsapp/... ./cmd/...`
4. **PostgreSQL**: `migrations_dialect_test.go` renders the whole list without a
   database, and `TestAccountMigrationsApplyToAPreExistingDatabase` re-runs it from
   an older version. If a live PostgreSQL 16 is reachable the suite is run against
   it and the outcome recorded; if not, that is stated as a **gap** in `verify.md`
   rather than rounded up.
5. **Byte-identity check for NFR-3/AC-20**: a listing response for a chat of rows
   with no origin, captured before and after, compared as bytes.

No validation profile from `project-config.yaml` is referenced.

## Rollback

Reverting the commit removes every behavioural change. The three columns remain in
any database that ran the migration, and that is harmless and intended: the
previous binary names them in no `SELECT`, in no `INSERT` column list and in no
struct, and their `NOT NULL DEFAULT ''` means every write it performs still
succeeds. There is no data to undo: the ticket writes no backfill and deletes
nothing.

One thing the rollback does **not** undo, stated because it is easy to miss: the
`messages.origin.read` row seeded into the `permissions` table and the grant rows
that reference it survive. They are inert without the code that reads them, and
`SeedIdentity` reconciles them on the next boot either way.

## Out of scope

As `spec.md > Out of scope`. Named again because they are the tempting adjacent
changes:

- No backfill; no origin on the outbound webhook or the Chatwoot forward payload;
  no filtering, sorting or index on the three columns; no new endpoint; no UI.
- No change to the `devices` copy list in `gowa chatstorage-migrate`, though it is
  missing three columns of its own.
- No `lock_timeout` added to the shared migration runner (S-3 records why).
- No route gains or loses a guard; `messages.origin.read` gates fields only.
- No change to ticket 19's failover ordering or to ticket 28's SMS stage.
- No change to the Chatwoot webhook's authentication (spec D-4 documents the
  boundary; changing `chatwootWebhookAuthorized` is its own ticket).

---

## Panel response

The advisory panel reviewed **revision 1 against the source**. It returned **33
findings**: 8 major, 15 minor, 10 informational. **24 adopted, 4 declined with
reasons, 5 recorded as already correct.** Two lenses independently found the same
defect twice (the batch-abort, and the account-blind lookup), which is what raised
both from "minor" to "change the design".

### The two findings that made revision 1 unshippable

**The unstamped-send stack walk returns a constant.** *(security, major)*
Revision 1 walked the Go stack inside `StoreSentMessageWithContext` to name "the
path". The lens traced the only usecase caller — `usecase/send.go:79-101` — and
found it is a **detached goroutine**. A Go stack does not cross a goroutine
boundary, so the walk would have returned
`StoreSentMessageWithContext → deviceChatStorage wrapper → wrapSendMessage.func1 →
runtime.goexit` **identically for `api`, `mcp`, `chatwoot` and `forward`** — a
constant presented to an operator as a diagnosis. The senior lens reached the same
conclusion from the other side ("cut the stack walker"). **Adopted**: the warning
moved to the send seam (S-6, spec D-2), where the frames are real, with literals
at the two direct call sites that need no discovery. Revision 1 would have passed
a test asserting "a WARN is emitted" and shipped a warning that could never
identify anything.

**The name resolution was account-blind.** *(security, major; senior, minor)*
`PrincipalCache.Lookup` is keyed on `user_id` across **every user in the
deployment**, and revision 1 called it with no account check. Two live paths
produce a row whose `sent_by` names a foreign user: a `super_admin` sending
through a tenant's device — `scope.go` grants it every device — and a user moved
between accounts. An account-A admin would have read an account-B user's
**current** username, which is precisely the horizontal read `perm.go` says ticket
27 exists to close, re-opened through a field instead of a route. **Adopted**: the
live lookup is gated on `MayAddressAccountScope`, the snapshot still returned
(S-10, spec AC-24, TC-17). The distinction matters and is recorded: the snapshot
is a fact about *this message*; the live lookup is a read of another tenant's
current state and a rename oracle.

### Findings that would have failed the build

| Finding | Lens | Answer |
|---|---|---|
| `src/pkg/auth/perm_test.go` **does not exist**; the real file `auth_test.go:22` hard-asserts `len(catalogue) != 27`, so appending breaks it | senior, major | **Adopted.** S-9 and Files to change now name `auth_test.go` and update the count and the spelled-out set. |
| `src/infrastructure/chatstorage/errors.go` **does not exist**; `ErrMessageTranscriptRejected` lives in `sqlite_repository.go:2815` | senior, major | **Adopted, and the need removed** — the blanking design (below) needs no sentinel at all. The file is gone from the list. |
| `fakeAuthService` (`ui/rest/auth_test.go:28-67`) implements `IAuthUsecase` **member by member**, so adding a method breaks the whole `ui/rest` test package — and revision 1's "both fakes embed the interface" was simply false | senior + security, major | **Adopted.** `IAuthUsecase` is not touched; the lookup goes on the concrete `*AuthService` and `initAuthUsecase` returns it (S-12). This also answers the separate finding that handing out a `*Principal` is wider than a display-name resolver needs. |
| `NewChatService` has **13** call sites, not 8 | senior, minor | **Adopted** (count corrected). The variadic keeps them all compiling either way. |
| Two "Files to change" entries were conditional; `cmd/chatstorage_migrate_test.go` **does** exist | senior, minor | **Adopted.** Both resolved to definite entries (IM-2/IM-4). |

### Findings on data safety

| Finding | Lens | Answer |
|---|---|---|
| Refusing an invalid `sent_via` inside `storeMessagesChunk` rolls back 500 rows **and abandons every later chunk** — a metadata problem destroying message rows, including the audit record this ticket adds | security + performance, minor (**both, independently**) | **Adopted, in the stronger form the security lens proposed**: blank the origin, keep the row (S-5, spec AC-28/TC-9). This satisfies what AC-28 is actually for — no row carrying the value, no listing publishing it — without letting a bad string delete history. |
| The `chatwoot` identity is **attacker-writable**: `chatwootWebhookAuthorized` returns true when `CHATWOOT_WEBHOOK_SECRET` is empty, the one unauthenticated path that can cause a send | security, major | **Adopted as documentation, declined as a code change.** Recorded as spec **D-4** and written into the OpenAPI text: `sent_by`/`sent_by_name` are verified only for `api`/`mcp`. It is **not a regression this ticket introduces** — the same caller can already send from the number today; what changes is that the forgery now leaves a name an admin reads as authoritative, so the record must not claim more than it knows. Hardening the webhook is its own ticket. |
| `sent_by_label` is a permanent name snapshot with no eraser | security, info | **Recorded.** It is intentional (AC-6): it is the fallback that makes a deleted user's message still attributable. Only the device purge removes it. Noted here rather than given code. |

### Findings on cost

| Finding | Lens | Answer |
|---|---|---|
| The migration comment's "window is bounded by the transaction" is wrong, and migration 76's "sub-second" wording does not transfer: `messages` is the hottest table, there is no `lock_timeout` anywhere, and a queued `ACCESS EXCLUSIVE` stalls **all** message reads and writes | performance, major | **Adopted at the stated minimum**: S-3 rewrites the comment honestly and tells the operator what to do. The `SET LOCAL lock_timeout` code change is **declined with a reason** — `runMigrationsAtomically` applies all 79 migrations on every boot, and a firing timeout aborts the whole batch, turning a stall into a failed boot. That is a boot-contract change and needs its own ticket. |
| NFR-1's "a listing page costs exactly what it costs today" is **false**: the row is three columns wider (≤300 extra decodes and ~1.2 KB per 100-row page) | performance, minor | **Adopted**: NFR-1 reworded to the property that is true — no additional query, join or round trip — so `/verify` measures the right thing. The lens also corrected the page cap: **100** (`chat_validation.go`), not 1000. |
| NFR-2's "it rides the existing asynchronous store" is **false for the auto-reply**, which is inline on the whatsmeow event goroutine | performance, info | **Adopted**: NFR-2 amended. The blocking send there is pre-existing; this ticket adds one `context.WithValue`. Recorded so `/verify` does not pass against a false premise. |
| `truncateRunes` allocates a `[]rune` **before** its length check, and this ticket puts it on the inbound-event goroutine and in the 500-row chunk loop | performance, minor | **Adopted**: one-line byte-length fast path (S-5). Benefits the refresh-token path too. |
| The warning has no dedup, and this repo has already been bitten by a per-message log line (ticket 28) — the auto-reply and agent paths are triggerable by anyone who messages the number | performance + security, minor | **Adopted**: `ShouldWarnUnstampedOrigin`, a `sync.Map`+TTL suppressor keyed on the rendered path, the same shape as `agentRefusalWarnTTL` and `unresolvedDeviceWarnCache` (S-1, S-6, spec AC-32). It also makes the stack walk free on a mis-wired deployment. |
| Resolving `mcp` can only ever miss — `system:mcp` is synthetic and never in the DB-backed cache | performance + senior, minor | **Adopted**: live resolution is `api`-only; `mcp` falls through to the snapshot by construction (S-10, spec AC-24). |
| Three ALTER statements vs one costs nothing on PostgreSQL and only three lock acquisitions on SQLite | performance, info | **Adopted as a correction to the comment**: keep the three-statement form (C-2 requires it), do not credit "three vs one" as a cost. |
| MCP gains the permission by derivation on an unauthenticated port, and this is a new *class* of data (staff user ids and usernames) | security + senior, minor | **Adopted as an explicit record**, not a refusal. By `ui/mcp/helpers/principal.go`'s own documented reasoning this is reach-preserving — `cmd/mcp.go` serves SSE with no authentication, so anything reaching the port already drives every tool. It is written against AC-26, into the OpenAPI note, and pinned by extending `mcp_principal_scope_test.go`. |
| `sent_via` is ungated and the read-only `user` role holds `chats.read`, so ordinary users learn which replies were machine-generated | security, info | **Recorded as the decision it is** (AC-21), not an oversight. |
| `SendPresence`/`SendChatPresence` create no message row, so 2 of the 12 handlers are inert | senior, info | **Adopted**: the AC-12 test does not assert through them (S-7a). |

### Claims the panel verified as correct

Recorded because a verified claim is worth as much as a corrected one, and because
`/verify` should not re-derive them:

- **Exactly five** message `SELECT` lists feed `scanMessage`; the other two
  `messages` column lists are writes, and leaving `applyMessageEdit`'s `INSERT`
  alone is correct — the `NOT NULL DEFAULT ''` supplies the value.
- `dbdialect.Rebind` skips `''` as an empty single-quoted literal, so the
  `CASE WHEN ... <> ''` clauses add **no** placeholder and `bind`'s arity guard
  stays true at 22 args. `rebindTx.Prepare` rebinds once and `stmt.Exec` does not
  re-rewrite, so the batch path is unaffected. Unqualified columns in
  `DO UPDATE SET` resolve to the existing row on both engines.
- `cmd/rest.go` ordering is safe: `registerDeviceScopedRoutes` is defined at 219
  but invoked at 308 and reads the package var then; nothing else captures
  `chatUsecase`; `gowa mcp` is a separate process.
- `context.WithoutCancel(ctx)` preserves the stamp into the async store, and both
  failover attempts derive from one ctx, so AC-16 holds from a single stamp.
- `ContextWithDefaultDevice` is the single MCP stamp point, and
  `detachedEventContext` really is shared with transcription — so S-7e's choice of
  `runAgentBridge` is right.
- Appending to `catalogue` reaches `admin`/`super_admin` by derivation, misses the
  literal `userPermissions`, does not become global, preserves the documented lock
  order, and does **not** break `AssertPolicyCoverage` (which walks routes→guards,
  never permissions→routes). `SeedIdentity` rebuilds grants every boot, so existing
  admins gain it on upgrade.
- Redaction fails closed (absent principal → nil → `HasPermission` false), the same
  shape as ticket 25.
- `Message` carries only `db` tags, so it cannot leak into the outbound webhook or
  the Chatwoot forward payload.
- `chatwoot.Contact.ID` is an `int`, so `chatwoot:<id>` is injection-free, and
  `deliverChatwootReply` really does build one reusable ctx.
- No deployment runtime file is touched by any step.
