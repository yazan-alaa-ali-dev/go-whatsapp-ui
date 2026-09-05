---
ticket: z8pmx9mb5r
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-03
links:
  clickup: "https://app.clickup.com/t/z8pmx9mb5r"
  github: ""
---

# Specification — 29 · Record and return who sent each outbound message

## Business goal

Every outbound message this server produces is stored through one of two writes,
and both record the same identity for all of them.

`StoreSentMessageWithContext` is the sent-message write. It is reached from five
different origins — the twelve `POST /send/*` REST endpoints, the MCP send tools,
the Chatwoot outbound agent reply, the AI agent bridge, and the static auto-reply
— and it stores, for every one of them, `sender` = the sending **device's** own
WhatsApp JID and `is_from_me = true`. The device is already its own column
(`device_id`), so `sender` on an outbound row adds nothing that is not already
there, and the **authorship** of the message is discarded at the moment it is
written.

`GET /chat/{chat_jid}/messages` therefore cannot answer "who sent this". An
account admin reviewing what a customer was told sees one anonymous
`is_from_me: true` on a human reply, on an AI agent reply, and on a static
auto-reply alike. Neither a person nor an automation can be held accountable for
a specific message, and there is no way to tell a machine answer from a human one
without reading `metadata_debug` — which is itself gated behind
`messages.debug.read` and exists only when AI diagnostics were collected.

The information is present at send time on every one of those paths and is simply
dropped on the floor:

| Origin | What is already known at send time |
|---|---|
| `POST /send/*` | the authenticated principal on the Go context (`ContextWithPrincipal`, tickets 23/25) |
| MCP tool | the explicit `system:mcp` principal `ui/mcp/helpers` stamps |
| Chatwoot reply | `payload.Sender.ID` and `payload.Sender.Name` on the inbound webhook |
| AI agent bridge | that it *is* the agent — the model/session/thread are already in `message_debug` |
| Auto-reply | that it *is* the configured static reply |

This ticket captures that origin on the write and returns it on the read. It adds
three additive columns, one context stamp, five capture points, three response
fields and one permission. It backfills nothing: a row written before the
migration reads back "origin not recorded", and is never rendered as a guess.

## User story

As an **Account Admin**, I want **to see, for every message this server sent to a
WhatsApp number, which origin produced it — a named API user, an MCP tool call, a
Chatwoot agent, the AI agent webhook reply, or the static auto-reply — and to get
that origin back on the message-listing endpoint**, so that **I can tell a human
reply apart from a machine reply and hold a specific person or automation
accountable for what a customer was told, instead of seeing a single anonymous
`is_from_me: true` for all of them**.

## Functional requirements

- **REQ-1** A message row carries the **origin of its send**: the channel class
  it came through, the stable identity of who issued it within that channel, and
  a display-name snapshot taken at send time.
- **REQ-2** The channel class is a **closed vocabulary**. The storage layer
  refuses any value outside it, so no call site can invent a spelling that the
  API would then publish.
- **REQ-3** The origin is carried from the entry point to the write on the **Go
  context**, in the shape the existing device / SMS-fallback / audit-actor stamps
  already use. The sent-message write reads it there; its exported signature does
  not change.
- **REQ-4** Every outbound path that exists today stamps its origin: the REST
  send endpoints, the MCP send tools, the Chatwoot outbound reply, the AI agent
  bridge (including a failover to a sibling device), and the static auto-reply.
- **REQ-5** A path that stamps nothing stores "not recorded" and behaves in every
  other respect exactly as it does today. A forgotten stamp degrades; it never
  fails a send and never invents an actor.
- **REQ-6** A **WhatsApp echo** of a message this server already sent — which
  re-enters through the inbound / history-sync write carrying no origin — must not
  erase the origin the send path recorded.
- **REQ-7** The message-listing endpoint returns the three values. The channel
  class is ordinary display; the human identity is gated behind a **new
  permission**.
- **REQ-8** The display name is resolved **at read time** from the in-memory
  principal cache, so a renamed user is shown under their current name, with the
  stored snapshot as the fallback.

## Non-functional requirements

- **NFR-1 A listing page issues no additional query, join or round trip.** The
  three values come from the `messages` row already selected for the page, and the
  name resolution performs **zero** database queries. *(Amended after panel
  review: revision 1 said "costs exactly what it costs today", which the
  performance lens falsified — the row is three columns wider, so a full page of
  100 pays ≤300 extra column decodes and ~1.2 KB of extra PostgreSQL wire bytes.
  That cost is real, sub-millisecond, and accepted; the claim now states the
  property that is actually true, so `/verify` measures the right thing.)*
- **NFR-2 Capturing the origin never fails or delays a send**, and adds no new
  blocking call to any send path. On the REST, MCP, Chatwoot and agent paths it
  rides the existing asynchronous store. *(Amended after panel review: revision 1
  said "it rides the existing asynchronous store" of every path, which is false
  for the auto-reply — `handleAutoReply` is called inline on the whatsmeow event
  goroutine and both its send and its store already block there. That is
  pre-existing and not this ticket's doing; what this ticket adds there is one
  `context.WithValue`. Recorded rather than left as a false premise for `/verify`
  to pass against.)*
- **NFR-3 A pre-existing row is byte-identical.** All three response fields carry
  `omitempty`, so every inbound message and every row written before the
  migration returns exactly the payload it returns today.
- **NFR-4 Additive schema only.** Three `ALTER TABLE ... ADD COLUMN` statements
  with `NOT NULL DEFAULT ''`, no backfill `UPDATE`, no table rewrite, no index. A
  rolled-back binary names them in no `SELECT` and simply ignores them.
- **NFR-5 One write statement, not two.** The single-message write and the
  history-sync batch already share one upsert statement; the echo protection is
  expressed once in that statement rather than as a second code path.
- **NFR-6 The redaction shape is the one already established.** A caller without
  the permission sees the keys **absent** — not empty, not null — exactly as
  ticket 25 did for `has_debug`, and is never refused the listing over an
  optional field.

## Constraints

- **C-1** No deployment runtime file is touched (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **C-2** Migrations are **index-positional** — schema version N is
  `migrations[N-1]` — so the new statements are **appended**, never inserted.
- **C-3** The permission catalogue is **append-only**: a new entry goes at the end
  of the ordered slice, because the seeder writes rows in that order inside one
  transaction and reordering changes the lock order between an old and a new
  binary during a rolling restart.
- **C-4** `pkg/auth` is a **leaf** and must stay one.
- **C-5** The seven-argument `StoreSentMessageWithContext` interface signature
  does not change, so no existing call site is edited into compiling by accident.
- **C-6** The ordinary `user` role's grant set is written literally and must not
  gain the new permission.

## Scope decisions recorded

The ticket leaves three things under-determined. Each is settled here, before any
code, rather than in the implementation.

### D-1 — `POST /message/{message_id}/forward` is an `api` origin too

The ticket's capture criterion names "every `POST /send/*` request". But
`POST /message/{message_id}/forward` is served by the **same send usecase**
(`serviceSend.SendForward` → `wrapSendMessage`), carries the same
`messages.send` guard, and stores a sent message through the same write. It is an
outbound message this server sent, authored by a named API user.

Excluding it would mean (a) a forwarded message is permanently unattributable,
and (b) the ticket's own audit criterion — WARN on a send that reaches the store
with no origin — would fire on **every forward in every deployment**, which is a
log line per message on a supported route rather than the alarm it is meant to be.

It is therefore stamped exactly like `/send/*`. This is an addition to the
ticket's list, not a change to any of its rules, and it is pinned by **AC-33**.

### D-2 — where the unstamped-send warning is emitted, and what "the path" is

*(Rewritten after panel review. Revision 1 put this warning in the storage layer
and derived the path from the Go call stack there. The security lens showed that
cannot work: the storage call on the REST/MCP/Chatwoot path happens inside the
**detached goroutine** `wrapSendMessage` launches, and a Go stack does not cross a
goroutine boundary — so the walk would have returned the same three frames for
every one of those paths, a constant dressed up as an answer. The senior lens
independently said to cut the machinery. Both are right about revision 1.)*

The ticket's criterion is "a send that reaches the store with no origin **on a
path that should have stamped one**". The place that knows a path *should* have
stamped one is the **send seam**, not the store: `wrapSendMessage` is the funnel
every REST, MCP, Chatwoot and forward send passes through, and there — before the
goroutine — the real handler frames are still on the stack.

So the warning is emitted at the three call sites that reach the sent-message
write, synchronously, on the caller's own goroutine:

| Call site | How the path is named |
|---|---|
| the send usecase funnel | one bounded stack walk — it is a funnel, so the frame is the answer |
| the agent bridge | a literal: the call site *is* the path |
| the auto-reply | a literal, same reason |

The rendering is `package.Function` only, carrying no argument, no message
content and no identity, and it is TTL-deduplicated per distinct path so an
externally-triggered path can never set this process's log volume. Pinned by
**AC-31** and **AC-32**.

### D-4 — the `chatwoot` identity is self-asserted, and the spec must say so

*(Added after panel review.)* The security lens established that
`chatwootWebhookAuthorized` returns **true when `CHATWOOT_WEBHOOK_SECRET` is
empty**, and that the middleware's own coverage map records this as the one
unauthenticated path in the deployment that can cause a send. On such a
deployment anyone who can reach the endpoint can post a webhook naming any
`Sender.ID` and `Sender.Name` — and this ticket stores that as the accountability
record and returns it on the API.

This is **not a regression this ticket introduces**: the same caller can already
send a message from the account's number today. What changes is that the forgery
now leaves a name in a record an admin will read as authoritative, so the record
must not claim more than it knows.

The decision: keep AC-14 as written — the value is what the integration reports,
and dropping it would make a correctly-secured Chatwoot deployment less useful to
punish an incorrectly-secured one — and state the boundary where a reader will
meet it. `sent_via = chatwoot` means *"the Chatwoot webhook asserted this"*, and
`sent_by` / `sent_by_name` are **verified identities only for `api` and `mcp`**,
which come from this server's own authenticated principal. That sentence goes in
the OpenAPI description of the two fields, not only in this document. The user
story's "hold a specific person accountable" is therefore exact for `api` and
`mcp`, and is an attribution of record — not proof — for `chatwoot`.

### D-3 — the name resolver has to be wired, and one binary has no cache

Resolving `sent_by_name` from the in-memory principal cache requires the chat
usecase to reach that cache. It cannot today: the cache lives on the auth service,
which is constructed only by `gowa rest` (deliberately — `gowa mcp` serves no
authenticated route and must boot without a JWT secret), while the chat usecase is
constructed for **every** subcommand.

So the resolver is **optional**. Where it is absent — `gowa mcp`, and any future
binary that serves the chat usecase without an auth service — `sent_by_name` falls
back to the stored snapshot, which is precisely the behaviour the ticket already
specifies for a lookup that misses. Pinned by **AC-24** and **AC-26**.

## Acceptance criteria

### Storage

- **AC-1** `messages` gains exactly three columns, all additive, all
  `NOT NULL DEFAULT ''`, added as new numbered migrations at the end of the
  migration list: `sent_via VARCHAR(32)`, `sent_by VARCHAR(255)`,
  `sent_by_label VARCHAR(255)`.
- **AC-2** No migration issues an `UPDATE` backfill. Every pre-existing row reads
  back `''` for all three columns, which means "origin not recorded" and is never
  rendered as a guess.
- **AC-3** The three columns live on `messages` rather than in a side table:
  unlike `message_debug` and `message_transcript` the value is known on the same
  write, is present on every outbound row, and is needed on every row of every
  listing page — a side table would add a per-page join for a value that is never
  absent.
- **AC-4** `sent_via` holds a **closed vocabulary** declared as Go constants in
  `domains/chatstorage`, and the storage layer refuses any other value the way
  `IsValidTranscriptStatus` already does: `api`, `mcp`, `chatwoot`, `ai_agent`,
  `auto_reply`, and `''`.
- **AC-5** `sent_by` holds the **stable** identity within that channel, never a
  display name: the principal's `user_id` for `api` and `mcp`,
  `chatwoot:<sender_id>` for `chatwoot`, and `''` for `ai_agent` and `auto_reply`.
- **AC-6** `sent_by_label` holds the display name **as captured at send time** — a
  snapshot, used only as a read-side fallback. It is never used for authorization
  and never for matching.
- **AC-7** The shared message upsert statement **must not blank a recorded
  origin**: its `ON CONFLICT ... DO UPDATE SET` clause writes each of the three
  columns only when the incoming value is non-empty. A WhatsApp echo of a message
  this server already sent re-enters carrying no origin and must not erase what
  the send path recorded.
- **AC-8** The history-sync batch write shares that same statement and therefore
  inherits the same protection with no separate code path.
- **AC-9** No index is added on any of the three columns: nothing in this ticket
  filters or sorts by them.

### Capture — write path

- **AC-10** A single context stamp carries the origin — a setter and its reader,
  defined once, in the same shape as the existing `ContextWithDevice` /
  `ContextWithSMSFallback` / `ContextWithAccountActor` stamps.
- **AC-11** The sent-message write reads the origin **from the context**, exactly
  as it already reads the client and the device. The seven-argument interface
  signature does not change.
- **AC-12** **`api`** — every `POST /send/*` request records `sent_via = api`,
  `sent_by` = the principal's `user_id`, `sent_by_label` = the principal's
  `username`. The principal is read from the Go context the authenticate
  middleware already stamps; the REST handlers perform no new identity lookup.
- **AC-13** **`mcp`** — a send issued by an MCP tool records `sent_via = mcp` and
  `sent_by = system:mcp`, taken from the system principal `ui/mcp/helpers` already
  stamps.
- **AC-14** **`chatwoot`** — a send issued by the Chatwoot inbound webhook records
  `sent_via = chatwoot`, `sent_by = chatwoot:<payload.Sender.ID>`,
  `sent_by_label = payload.Sender.Name`. This holds whether or not
  `CHATWOOT_SIGN_MSG` is enabled; the stored origin is independent of the
  signature prefix added to the message text.
- **AC-15** **`ai_agent`** — a reply delivered by the agent bridge records
  `sent_via = ai_agent` with `sent_by` and `sent_by_label` empty. The channel
  class is the whole answer for a machine reply; the model, session and thread
  behind it are already recorded in `message_debug`.
- **AC-16** On an agent-reply **failover** to a sibling device (ticket 19) the
  origin is still `ai_agent` and is written into the **arrival** device's
  partition, exactly like the message row and the debug row.
- **AC-17** **`auto_reply`** — a message sent by the static configured auto-reply
  records `sent_via = auto_reply` with `sent_by` and `sent_by_label` empty.
- **AC-18** An outbound path that stamps no origin stores `''` on all three
  columns and behaves in every other respect exactly as it does today.
- **AC-19** Capturing the origin never fails or delays a send: it rides the
  existing asynchronous store, and no new blocking call is added to the send path.

### Read — API surface

- **AC-20** `GET /chat/{chat_jid}/messages` returns three new fields on each
  message: `sent_via`, `sent_by`, `sent_by_name`. All three carry `omitempty`, so
  an inbound message and every pre-existing row return a **byte-identical**
  payload to today.
- **AC-21** `sent_via` is returned to any caller who may read the chat
  (`chats.read`). It names a channel class and no person, and telling an AI reply
  from a human one is ordinary display rather than an audit disclosure.
- **AC-22** `sent_by` and `sent_by_name` are returned **only** to a caller holding
  the new permission `messages.origin.read`. For a caller without it the two keys
  are **absent**, not empty and not null — the redaction shape ticket 25
  established for `has_debug`.
- **AC-23** `messages.origin.read` is appended to the permission catalogue with
  the description "Read who sent an outbound message". It is **not** added to the
  literal ordinary-user grant set; `admin` and `super_admin` receive it
  automatically through the derived admin tier.
- **AC-24** `sent_by_name` is resolved **at read time, once per page, from the
  in-memory principal cache** when `sent_via` is `api`, `sent_by` names a known
  user, **and that user is inside the reading caller's own account scope** — so a
  renamed user displays under their current name. It falls back to the stored
  `sent_by_label` in every other case: a deleted user, an `mcp` / `chatwoot`
  origin, a binary with no principal cache (D-3), or a user outside the caller's
  account. The resolution performs **zero** database queries.

  *(Amended after panel review, in two places. (1) The account-scope condition was
  added: the security lens found that `PrincipalCache.Lookup` is keyed on
  `user_id` over **every user in the deployment**, so revision 1 would have let an
  account-A admin read the **current** username of an account-B user whenever a
  `super_admin` — which `scope.go` grants every device — had sent into that
  device's partition. That is the horizontal cross-tenant read ticket 27 exists to
  close, re-opened through a field instead of a route. The stored snapshot is
  still returned, because it is a fact about **this message** and is the
  accountability record the ticket exists to provide; what is refused is the
  **live lookup**, which is a read of another tenant's current state and a rename
  oracle. (2) `mcp` was dropped from the resolved set: the performance and senior
  lenses both observed that `system:mcp` is a synthetic principal built in
  `ui/mcp/helpers` and is never in the DB-backed cache, so resolving it could only
  ever miss. It falls through to the snapshot by construction, which is the same
  answer one round-trip cheaper.)*
- **AC-25** The origin fields come from the `messages` row already selected for
  the page. No additional query, join or per-message lookup is issued, and a
  listing page costs exactly the number of round trips it costs today. *(The
  round-trip count is unchanged; the row is three columns wider — see NFR-1.)*
- **AC-26** The MCP `get_chat_messages` tool, which calls the same usecase with
  the system principal, is unchanged in behaviour and receives all three fields.
- **AC-27** The OpenAPI document describes the three response fields, the closed
  `sent_via` vocabulary, and the permission that gates `sent_by` / `sent_by_name`.

### Validation and constraints

- **AC-28** A `sent_via` value outside the closed vocabulary is rejected by the
  storage layer — **the value is refused, not the message**: the row is stored
  with the origin blanked to `''` ("not recorded", AC-18) and a WARN is logged, so
  no row is ever stored carrying the invented value and no listing ever publishes
  it. *(Amended after panel review. Revision 1 refused the whole write. The
  security and performance lenses independently found the same consequence: the
  same validation runs per row inside the 500-row history-sync chunk transaction,
  where returning an error rolls back the chunk **and abandons every chunk after
  it** — so a metadata problem would destroy message rows, including the very
  audit record this ticket exists to create. Blanking satisfies what AC-28 is for
  — "no row stored carrying it, no listing publishing it" — without letting a bad
  string delete a customer's history.)*
- **AC-29** `sent_by` and `sent_by_label` are length-bounded to their column
  widths at the write; truncation never splits a multi-byte character, and neither
  field is ever interpreted as markup by the server.
- **AC-30** No credential, token, agent endpoint URL or webhook secret is ever
  written into any of the three columns or returned in any of the three fields.

### Audit and logging

- **AC-31** A send that reaches the sent-message write with no origin is logged at
  WARN, at the send seam, with the message id and the calling path (see D-2), and
  the send still succeeds.
- **AC-32** No log line written by this ticket contains message content, and the
  path rendering carries no argument values. Every warning this ticket adds is
  **TTL-deduplicated per distinct path**, so no externally-triggered path — the
  auto-reply and the agent bridge are both reachable by anyone who messages the
  number — can set this process's log volume. *(Added after panel review: the
  performance and security lenses both cited `agentRefusalWarnTTL` and
  `unresolvedDeviceWarnCache`, the two suppressors this repository already carries
  for exactly this hazard, and ticket 28's own record of being bitten by an
  un-deduplicated per-message line.)*

### Added by this specification

- **AC-33** `POST /message/{message_id}/forward` records the same `api` origin as
  `POST /send/*`, with the same `sent_by` / `sent_by_label` (see D-1).
- **AC-34** The three columns survive `gowa chatstorage-migrate`: a message copied
  from SQLite to PostgreSQL keeps its recorded origin rather than silently
  reverting to "not recorded".

## Test cases

- **TC-1 — An API user's send records that user as the origin.** Given an active
  user `u_ahmad` holding `messages.send` and `messages.origin.read` and a paired
  device in that user's account, when they call `POST /send/message` and then
  `GET /chat/{chat_jid}/messages`: the stored row carries `sent_via = "api"`,
  `sent_by = "u_ahmad"`, `sent_by_label` = that user's username at send time; the
  response message carries `sent_via: "api"`, `sent_by: "u_ahmad"` and
  `sent_by_name` = the user's **current** username; `is_from_me` and `sender` are
  exactly what they are today. *(AC-12, AC-20, AC-21, AC-22, AC-24)*
- **TC-2 — A renamed user still resolves to their current name.** Given the
  message above was sent while the username was `ahmad`, and an admin has since
  renamed the user to `ahmad.k`: `sent_by` is still `u_ahmad`, `sent_by_name` is
  `ahmad.k` resolved from the cache, and the stored `sent_by_label` still holds
  the old snapshot and was not rewritten. *(AC-6, AC-24)*
- **TC-3 — An AI agent reply is distinguishable from a human reply.** The agent's
  reply carries `sent_via: "ai_agent"` and **no** `sent_by` or `sent_by_name` key
  at all; a reply sent by a human through `POST /send/message` in the same chat
  carries `sent_via: "api"`; the two are distinguishable without reading
  `metadata_debug`. *(AC-15, AC-20)*
- **TC-4 — A Chatwoot agent reply records the Chatwoot agent.** A Chatwoot agent
  with id `42` and name `Sara` replies: the stored row carries
  `sent_via = "chatwoot"`, `sent_by = "chatwoot:42"`, `sent_by_label = "Sara"`; a
  caller holding `messages.origin.read` sees `sent_by_name: "Sara"`; the result is
  the same whether `CHATWOOT_SIGN_MSG` is on or off. *(AC-14, AC-24)*
- **TC-5 — An echo of an already-sent message does not erase its origin.** A
  message stored with `sent_via = "api"`, then echoed back by WhatsApp through the
  inbound write with an empty origin, then re-upserted by a history sync: the row
  still reads `sent_via = "api"` with its original `sent_by` and `sent_by_label`,
  and no other column behaves differently from today. *(AC-7, AC-8)*
- **TC-6 — A caller without the permission sees no identity.** A user holding
  `chats.read` but not `messages.origin.read` lists a chat containing an API-sent
  message and an agent reply: every message carries `sent_via`; **no** message
  carries a `sent_by` or `sent_by_name` key; the request succeeds with 200 and is
  never refused with 403 over an optional field. *(AC-21, AC-22)*
- **TC-7 — Messages sent before this ticket are unchanged.** A chat whose messages
  were all stored before the migration: no message carries `sent_via`, `sent_by`
  or `sent_by_name`, and the response body is byte-identical to the one the same
  request returned before the change. *(AC-2, AC-20)*
- **TC-8 — An unstamped send does not invent an actor.** An outbound path that
  stamps no origin sends and stores a message: the row stores `''` for all three
  columns and the send succeeds; the listing omits all three fields; a WARN line
  names the message id and the calling path and contains no message content.
  *(AC-18, AC-31, AC-32)*
- **TC-9 — A rejected origin value never reaches the API, and does not cost the
  message.** A call site attempting to store `sent_via = "webhook"`: the row is
  stored with all three origin columns `''`, a WARN is logged, no row carries the
  invented value and no listing publishes it. The same value inside a 500-row
  history-sync batch blanks that one row and leaves the other 499 — and every
  later chunk — stored. *(AC-28, AC-8, AC-18)*
- **TC-10 — The MCP send tool records the system principal.** A send issued by an
  MCP tool stores `sent_via = "mcp"`, `sent_by = "system:mcp"`. *(AC-13)*
- **TC-11 — The auto-reply records itself.** A message sent by the static
  configured auto-reply stores `sent_via = "auto_reply"` with both identity
  columns empty. *(AC-17)*
- **TC-12 — A failover reply keeps the agent origin and the arrival partition.**
  An agent reply delivered by a sibling device after the arrival device failed
  stores `sent_via = "ai_agent"` on the **arrival** device's `device_id`.
  *(AC-16)*
- **TC-13 — Over-long identity values are bounded without corruption.** A
  `sent_by_label` longer than the column width, containing multi-byte characters,
  is stored truncated to the column width and is still valid UTF-8. *(AC-29)*
- **TC-14 — A forwarded message is attributable.**
  `POST /message/{message_id}/forward` stores `sent_via = "api"` with the
  forwarding user's identity. *(AC-33)*
- **TC-15 — The permission is not granted to the ordinary user role.** The
  literal `user` grant set does not contain `messages.origin.read`; the derived
  `admin` and `super_admin` sets do. *(AC-23)*
- **TC-16 — The storage migrator carries the origin across.** The message copy
  column list includes the three columns. *(AC-34)*
- **TC-17 — A foreign account's user is never resolved to their current name.**
  A message in account A's device partition whose `sent_by` names a user of
  account B (the case a `super_admin` send produces): a caller in account A
  holding `messages.origin.read` sees `sent_by` and the **stored snapshot**, and
  `sent_by_name` is *not* the foreign user's current username even after that user
  is renamed. A caller holding `users.manage.all` does see the current name.
  *(AC-24 — added after panel review)*
- **TC-18 — The unstamped warning cannot flood.** Two unstamped sends on the same
  path within the suppression window produce one WARN, and the path rendering
  contains no message content and no argument values. *(AC-31, AC-32 — added after
  panel review)*

## Out of scope

- Any **backfill** of historical rows.
- The **outbound webhook payload** and the **Chatwoot forward payload**: neither
  gains an origin field.
- **Filtering or searching** by origin; any index on the three columns.
- Any **new endpoint** and any **UI** change.
- The **SMS fallback delivery record** (ticket 28 territory).
- Recording an origin for messages the operator typed in the WhatsApp mobile app:
  they reach this server as an echo event and carry no origin this server can
  know. AC-7 guarantees only that such an echo does not *erase* a recorded origin.
- Attributing **reactions, edits, revokes, stars and read marks**. They create no
  message row and are outside "who sent this message".
- The pre-existing gap in `gowa chatstorage-migrate` whereby the `devices` copy
  list omits `gowa_account_id`, `transport` and `webhook_enabled`. It is observed
  here and left alone: fixing it is a separate ticket with its own verification,
  and AC-34 covers only the columns this ticket adds.
