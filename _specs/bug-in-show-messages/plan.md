---
ticket: bug-in-show-messages
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Plan — bug-in-show-messages

> Decide the approach before changing code. Plan only — no implementation here.
>
> **Revision 6** — closes the single follow-up from the sixth gate: pinning the shape
> the single-chat read returns, which is **not** the list row. Nothing else changes;
> the design has been unchanged since revision 3 and is verified line-by-line against
> the library sources. Mapping at the end.

## Approach

Read the contact list through a page-side reader that builds each row itself, in a
single `page.evaluate` per request, and never calls the library's `getChatModel`.

`getChatModel` is what throws: for a group it runs
`WidFactory.createWid(chat.id._serialized)`, `await groupMetadata.update(chatWid)`
and a participant walk (`node_modules/whatsapp-web.js/src/util/Injected/Utils.js:645-655`),
and one rejecting chat rejects the whole `Promise.all` behind `getChats` (`:621-624`).
Building rows ourselves means those statements are never executed, so a group is
**listed by construction** (AC-5). The same move removes the per-group metadata fetch,
the history loads and the `N` extra CDP round trips the endpoints pay today.

**Identifiers and the last message are resolved in-page.** WhatsApp Web renamed the
key field `_serialized` to `$1` — the reason `utils/normalizeMsgId.js` exists — but
that module runs Node-side, after the page has already failed its lookup. The reader
applies the same derivation **inside the page** (`_serialized` → `$1` → rebuild from
parts), to **both** the chat WID and the message key. The chat WID matters because the
plan's own hypothesis is that `createWid(chat.id._serialized)` receives undefined,
which would otherwise leave every row with `id: undefined`.

The last message comes from the **chat's own loaded message collection (tail first)**,
with the repaired `lastReceivedKey` lookup as fallback. That order matters:
`lastReceivedKey` is the last *received* key, so using it first would shadow an
outbound last message with a stale inbound one and regress both preview and sort order
against today's direction-agnostic `fetchMessages({limit:1})`. The store lookup uses
**`Store.Msg.get` only**; the upstream `|| await Store.Msg.getMessagesById([...])`
clause (`Utils.js:667`) is **deliberately not ported**, because it is a network fetch.

Each chat is built inside its own guard and collected with `Promise.allSettled`, so
one unbuildable chat is omitted while the rest are returned (AC-6). Ordering by the
chat's own `t` happens **in-page, before** the cap, so truncation can never silently
drop the newest conversations.

Installation self-heals with **no Node-side state**: one evaluate does probe →
install-if-needed → read, keyed on a version marker inside the page. `Client.inject()`
re-runs on every `framenavigated` (`src/Client.js:375-384`) and `LoadUtils` begins with
`window.WWebJS = {}` (`Utils.js:4`), so a Node-side flag would stay true while the
reader was wiped. The library's own `window.WWebJS.getChats` is left untouched.

### The message pane: resolve the chat, do not replace the read

Making groups visible makes the pane reachable for groups, and `client.getChatById`
resolves through `WWebJS.getChat` **with `getAsModel: true`**, which builds a chat model
and re-enters the group branch (`Utils.js:584-589`). That is the whole problem — and it
is narrower than revision 4 assumed.

`Chat.fetchMessages` already resolves its own chat with
`window.WWebJS.getChat(chatId, { getAsModel: false })` internally
(`src/structures/Chat.js:203`), and `getChatModel` is only ever called when
`getAsModel && chat` (`Utils.js:587-589`). **So `fetchMessages` never touches the group
branch.** Only `getChatById` does, and only because it needs a model to construct the
`Chat` instance.

The fix is therefore to obtain the chat handle without `getChatById`: build the `Chat`
instance from a **library-shaped** model of that one chat, and then let the existing
endpoint body run exactly as it does today. Only `fetchMessages` is used from that
instance, so the omitted group metadata is irrelevant to it.

**That model is deliberately not the list row.** The two shapes differ and confusing
them breaks everything: step 4 flattens `id` to a serialized **string** because that is
what the HTTP response contract expects (`routes/tenants.js:1039-1046`), whereas
`Chat._patch` assigns `this.id = data.id` verbatim (`structures/Chat.js:22`) and
`fetchMessages` then dereferences `this.id._serialized` (`:222`). Handing it the
flattened row would make `this.id._serialized` undefined, so the in-page
`getChat(undefined)` → `WidFactory.createWid(undefined)` would throw and **every**
conversation would fail to open — individuals as well as groups, and only when a row is
clicked. The single-chat read therefore returns the **library's** field names (step 9).

Everything downstream is then **unchanged**: real `Message` instances, the existing
`{id, from, from_me, isForwarded, isReply, originalMessageId, mediaUrl, caption, …}`
response contract (`routes/history.js:208-268`), `getMessageMediaSafe`,
`getQuotedMessage`, transcription, and the `loadEarlierMsgs` back-fill that keeps the
pane's depth at what it is today. **There is no pane mapper** — revision 4's was the
source of three separate AC-4 failures (`fromMe` vs `from_me`, media dropped because
the handler needs `Message` instances, and a possibly empty pane from losing the
back-fill), and deleting it removes all three at once.

**Rejected alternatives:** replacing the pane's message read (revision 4 — breaks the
response contract, media and pane depth); calling `getChatModel` first and falling back
on rejection (pays the metadata fetch per group per request for fields nobody
consumes); a `fetchMessages` fallback for list previews (raw models are not `Chat`
instances, so each needs a `getChatById` first — `2N` round trips); upgrading
`whatsapp-web.js` to `1.34.7` (keeps `getChats` on a single `Promise.all` and deletes
`window.Store`, which our live-location code reads); patching `node_modules` (a clean
rebuild discards it, NFR-6); wrapping our call in `try/catch` (the rejection happens
inside `page.evaluate`, so no partial result crosses back); hiding groups (rejected by
the spec's Constraints).

### Price of this approach — recorded deliberately

We build the list row ourselves and no longer use the library's model for it, and we
construct a `Chat` instance from our own reduced model. Both reach into library
internals and can drift silently: a future release renaming a field we read, or moving
`fetchMessages`'s resolution, would not fail loudly. Accepted because it is the only
way to stop executing the throwing statements, and mitigated by a reference comment in
the reader naming the version and the exact upstream lines it depends on
(`whatsapp-web.js@1.34.6` — `Utils.js:584-589`, `:621-624`, `:633-676`;
`structures/Chat.js:28,52,203`; `structures/Message.js:55,67,131`), plus a standing
rule that **any future upgrade of that dependency must re-check this file**.

## Steps

1. **Add the page-side reader** in a new helper module, installed as
   `window.WWebJS.__resilientChats` with a version marker, exposing the list read and
   a single-chat **model** read (step 9).
2. **Probe, install and read in one evaluate**, keyed on the in-page marker, so no
   `framenavigated` can slip between probe and call. Log one line per reinstall.
3. **Repair identifiers in-page.** One derivation — `_serialized` → `$1` → rebuild from
   parts — applied to the chat WID before it becomes a row `id` or a report identifier,
   and to the message key before it becomes `lastMessage.id`.
4. **Build each row in-page and map it to the existing response contract**
   (`routes/tenants.js:1039-1046`), so the screen needs no change (AC-16):
   `id` ← repaired chat WID; `name` ← `chat.formattedTitle`; `isGroup` ← presence of
   `chat.groupMetadata`, coerced boolean; `unreadCount` ← coerced number;
   `timestamp` ← `t`; `lastMessage` ← step 6. `formattedTitle` and `isGroup` are
   **derived**, as `Utils.js:637-646` derives them — `chat.serialize()` produces
   neither. Only these fields cross the CDP boundary; `msgs`, `groupMetadata` and the
   participant list never enter the payload.
5. **Order in-page by `t` descending, then apply the chat cap of 500**, returning a
   `truncated` count. Ordering before capping is required: the chat collection is not
   recency-ordered, so capping first would drop arbitrary — possibly the newest —
   conversations while looking like success.
6. **Resolve `lastMessage` in-page.** Read the tail of the chat's own message
   collection: use **`chat.msgs.last()`** when available, otherwise
   **`chat.msgs.getModelsArray()`** walked from the end and bounded to the last 20
   entries examined — never scanning or copying the whole collection to find one
   element. Skip protocol, e2e-notification and revoked stanzas so they cannot render
   as a preview. If nothing usable is found, look up the repaired `lastReceivedKey`
   with **`Store.Msg.get` only**; else `null`. Map to the existing contract:
   `id` ← repaired message key; `body` ← the caption when the message carries media,
   else the body, falling back to `[<type>]` for a non-`chat` type and `""` otherwise;
   `timestamp` ← `t`; `fromMe` ← `id.fromMe`; `type` ← `type`.
7. **Isolate per chat and report with fixed reason codes.** Each row is built inside
   its own guard, collected with `Promise.allSettled`. `skipped` = the chat could not be
   built and is omitted; `degraded` = the row was built but a field could not be
   resolved. Each entry carries the repaired chat identifier and a **reason code** from
   a fixed taxonomy (`chat-wid-unrepairable`, `key-unrepairable`, `builder-threw`,
   `collection-missing`, `preview-unresolved`) — never a free-form error string, which
   could quote chat content. Each list is capped at 100 entries with the remainder
   counted in `dropped`. The read is bounded by a **2-second wall-clock budget** and
   **yields to the page event loop every 50 chats**: the work is almost entirely
   synchronous, and this runs on the session's shared page — the same page that handles
   inbound messages — so it must not hold the main thread for a long stretch
   (NFR-3/AC-17). On expiry it returns what it has plus `truncated`.
8. **Log on the Node side** from the returned report: the first 10 distinct identifiers
   with their reason codes per list, deduplicated per request, plus one aggregate line
   for the remainder (AC-6, AC-7). Identifiers and reason codes go to the log **only**;
   the HTTP response carries counts, never identifiers or reasons.
9. **Add a single-chat model read** to the reader: given a chat id, resolve the chat
   with `getAsModel: false` so no chat model is constructed in-page and the group branch
   is unreachable (`Utils.js:587-589`), then return a model **in the library's field
   names** — explicitly **not** step 4's flattened response-contract row:
   - `id` — a **WID-shaped object** `{ _serialized, user, server }`, built from the
     repaired identifier (step 3). This is the field that matters: `Chat._patch`
     assigns `this.id = data.id` verbatim (`structures/Chat.js:22`) and `fetchMessages`
     dereferences `this.id._serialized` (`:222`), so a flattened string here would throw
     for every conversation.
   - `formattedTitle`, `isGroup`, `unreadCount`, `t` — the remaining fields
     `Chat._patch` reads (`:28,52`), derived exactly as in step 4.

   Node-side, construct the library's `Chat` instance from that model instead of calling
   `client.getChatById`. **Only `fetchMessages` is used from the instance**, so the
   omitted group metadata does not matter — `GroupChat._patch` merely assigns
   `data.groupMetadata`, and the getters that would dereference it are lazy and unused
   on this path. Equivalently, Node may re-wrap the repaired identifier into that shape
   before construction; what must not happen is reusing the row from step 4.
   **Nothing else about the message endpoints changes** — no pane mapper, no response
   reshaping: the existing body keeps its `Message` instances, its response contract,
   its media/quoted/transcription handling and its `loadEarlierMsgs` back-fill, so pane
   depth is exactly what it is today (AC-4, AC-16).
10. **Point both contacts endpoints at the reader** — admin (near
    `routes/tenants.js:1080`) and tenant-scoped (near `:971`) — so the two copy-pasted
    bodies converge on one path (AC-3). Existing response fields keep their exact names
    and meanings; the skipped/degraded **counts** are added as new fields alongside them
    (additive only, AC-16). An account with no chats returns an empty list successfully;
    "no chat could be built" and a collection miss are each reported distinctly so the
    screen can tell them apart (AC-8, AC-9).
11. **Update the screen** (`public/contacts.html`):
    - Replace the inline `onclick` (`:477`) with **one delegated listener**, carrying
      **only the chat id** in a `data-` attribute and resolving the row from
      `allContacts`. HTML-escaping does not secure an attribute JavaScript-string
      context — the browser entity-decodes the attribute before the JS is parsed — so
      the context is removed rather than escaped. Fix the **active-row highlight**,
      which currently relies on the implicit global `event.currentTarget` (`:505`).
    - **Escape every interpolated value** in the three interpolating templates
      (`:387`, `:468-486`, `:573-589`) — by scope, not by an enumeration of fields —
      and build the `showError` banner with `textContent`. Escape **only** in the
      render functions: escaping into `allContacts` would make `filterContacts()`
      (`:490-494`) search escaped entities.
    - Handle a **missing display name** (`:477`, `:492` currently call
      `.replace`/`.toLowerCase` on it and would throw).
    - **`encodeURIComponent` the `waNumberId`** in the request path (`:420`).
    - **Pass the full chat id** when opening a conversation instead of splitting on
      `@`, and request **30** messages instead of 50.
    - Show the actionable reason for guard outcomes (AC-12), keep the raw 500 `details`
      server-side behind a generic message, clear the loading indicator on the failure
      path as well as the success path (AC-13), and render "no conversation could be
      read" distinctly from "this number has no conversations" (AC-9).
12. **Update `routes/history.js`, both copies** — the tenant-scoped
    `POST /get-messages` (`:64-65`) and the admin one (`:196-197`) — identically, so
    neither view is fixed at the other's expense (FR-2):
    - Resolve the chat via step 9 instead of `client.getChatById`.
    - Append `@c.us` only when the identifier carries no domain, and **allow-list** the
      accepted suffixes (`@c.us`, `@g.us`, `@lid`) rather than passing any `@` through,
      so `@newsletter` and `status@broadcast` are not newly reachable.
    - Everything else in both handlers is untouched.
    **This lands in the same commit as the screen change** — screen and routes must move
    together or group rows stay broken.

## Files to change

- `services/resilientChats.js` — **new.** The page-side reader: install, version
  marker, single probe→install→read evaluate, in-page identifier repair, the row
  builder with derived fields and contract mapping, in-page last-message resolution,
  in-page ordering and capping, per-chat isolation, the reason-code report with caps,
  the 2-second budget with periodic yielding, the single-chat model read, the Node-side
  `Chat` construction, and the Node-side logging. Carries the upstream reference
  comment (steps 1-9).
- `routes/tenants.js` — both contacts endpoints read through the reader and report the
  degraded and collection-miss cases. Auth, guard responses, tenant checks and existing
  response fields unchanged (step 10).
- `public/contacts.html` — delegated listener and active-row fix, render-time escaping
  by scope, null-name handling, `encodeURIComponent`, full chat id, message limit 30,
  error/loading/degraded states (step 11).
- `routes/history.js` — in **both** `get-messages` handlers: chat resolution via the
  reader instead of `getChatById`, and the identifier allow-list. No other change to
  either handler (step 12).

No dependency, lockfile, or unrelated service file is touched — in particular
`package.json`, `package-lock.json` and `services/inboundHandlers.js` are **not** part
of this ticket. No deployment runtime file is changed (GU-2): `docker-compose.yml`,
`docker-compose.prod.yml`, `Dockerfile`, `docs/nginx-whatsapp.conf`,
`docs/build-and-push-staging.yml` and `docs/deploy-staging.yml` are all untouched.

## Validation strategy

- Validation profile: `node-source`
- Manual acceptance evidence against a live, connected WhatsApp session — this
  repository has no test runner (`npm test` is the placeholder that exits 1), so each
  criterion is proven by observation and recorded in `verify.md`:
  - Screen opens for a connected number → list renders, header resolves (AC-1, AC-10,
    AC-13).
  - Admin contacts endpoint returns the list (AC-2); the tenant-scoped endpoint returns
    the same for the same number (AC-3).
  - At least one **group** is present with its name and group badge (AC-5), and **its
    row carries a non-empty `id`** — the check that catches an unrepaired chat WID.
  - Selecting a conversation loads its messages **including a group row** (AC-4 with
    AC-5), **with media rendering and sender alignment correct** — the checks that
    catch a broken chat handle, since the response contract itself is unchanged.
  - Ordering is most-recent-first and matches WhatsApp, **including chats whose last
    message is outbound** (AC-10) — the check that catches the `lastReceivedKey`
    direction trap.
  - Existing response fields unchanged; the new counts are additive (AC-16).
  - The four guard paths — unknown number, inactive number, no session, not
    connected — stay distinguishable and the screen shows the actionable reason
    (AC-11, AC-12).
  - Unauthenticated calls to both endpoints (AC-14) — **record the actual status
    codes**: the tenant-scoped route has tenant context
    (`router.use("/tenants/current", tenantContext)`, `routes/tenants.js:115`), and
    `middleware/tenantContext.js` returns **401** on a missing or invalid bearer token
    and **403** for an inactive tenant.
  - Another tenant's number on the tenant-scoped route (AC-15).
  - Send and receive a message and confirm a webhook reply is still relayed (AC-17).
  - Rebuild the image and redeploy, then re-open the screen (AC-18).
- **How AC-6 and AC-7 are evidenced** (VF-7 forbids editing source at `/verify`):
  `degraded` entries are expected naturally on the current build — a chat whose key
  will not repair is logged while the row is still listed — and those log lines are the
  AC-7 evidence. For AC-6, which needs a chat that cannot be built at all, the evidence
  is captured **during `/implement`** by forcing one chat's builder to reject **at
  runtime from the page**, never by editing a source file: the list must still return
  the remaining chats and the skip must appear in the log. Both observations are
  recorded in `implement.md` and referenced from `verify.md`. An empty `skipped` list on
  the verification run is expected and is not a failure.
- **Preview coverage bar (AC-10):** every chat with at least one message loaded in the
  page must show a non-empty preview. Chats with no loaded messages may show an empty
  preview — the accepted consequence of never triggering a history load on the list
  path. Record the ratio. **Pane depth needs no bar**: the pane keeps
  `fetchMessages` and its `loadEarlierMsgs` back-fill, so it is unchanged from today.
- **NFR-5 — absolute budget, not a before/after.** Comparing against today is
  meaningless: today the endpoint fails fast with a 500 and does no chat work. Record
  instead, for the largest available account: chat count, group count, wall-clock for
  the request, preview coverage, and the `truncated`/`dropped` counters — against a
  **tolerance of 5 seconds**. NFR-5 has no acceptance criterion and one cannot be
  added: `/spec` accepts only `state: ready-for-research`, and although
  `spec-complete → research-complete` is a legal edge in
  `project-config.yaml > lifecycle`, no command implements it. The measurement is
  recorded as evidence beyond AC coverage (VF-2 requires AC coverage; it does not forbid
  more), and the missing edge is raised to the Workflow Owner as a governance gap.
- **Accepted cost, recorded:** opening a conversation runs the **unchanged**
  `get-messages` body — per-message media handling and audio transcription — and making
  groups visible makes that path newly reachable for groups, which is why the screen's
  request drops from 50 to 30 messages. Reducing it further, or skipping transcription
  on this read path, is a follow-up ticket.
- Record which WhatsApp Web build the session was on for every observation.

## Rollback

- All changes are additive or call-site swaps on the ticket branch; reverting the
  branch (or the single publishable commit) restores today's behaviour exactly.
- Nothing is installed at process start and no state is held outside the browser page.
  If the reader cannot install or the chat collection cannot be resolved, the endpoint
  reports the AC-9 "no conversation could be read" outcome — an explicit, logged failure
  rather than a silent empty list.
- The screen and both `routes/history.js` handlers must be reverted **together** with
  the reader — they are one commit by design (step 12).
- No dependency change, no lockfile change, no database migration, no schema change, no
  configuration change, and no deployment runtime file change — rollback is a redeploy of
  the previous image.

## Out of scope

- **`services/shipmentTracking.js` — unchanged and unaffected**, since the library's
  `getChats` is left in place. Recorded because it matters: with `getChats()` throwing,
  its existing-group lookup (`:292`) has a `catch` (`:309-311`) that only logs and falls
  through to `client.createGroup(...)` (`:314-318`), so **the system is already creating
  duplicate tracking groups on every lookup**. The same group branch also affects
  `getChatById` at `services/shipmentTracking.js:246`, `:324`, `:389` and
  `routes/admin.js:154`. All of that, and the duplicates already accumulated, are
  **follow-up ticket candidates**; this reader is the building block for that fix.
- `routes/history.js` beyond the chat resolution and the identifier allow-list — in
  particular the dead `/get-all-messages` handler (`:288`), which references an
  undefined `client` and has no auth middleware; it should be **deleted rather than
  repaired** in its own cleanup ticket.
- Reducing the message-pane cost further (transcription and media handling per message).
- Auth wiring on the tenant-scoped contacts route — **no change needed**; the earlier
  claim that it lacked middleware was wrong (`routes/tenants.js:115`).
- Upgrading `whatsapp-web.js`, and therefore any change to `services/inboundHandlers.js`
  for `window.Store` compatibility.
- The existing in-page overrides in `services/messagingService.js:132-143` and
  `services/whatsapp.js:100-110`, which carry the same wipe-on-reinject weakness this
  reader avoids. Noted so a later ticket can converge them; not touched here.
- The standalone messages page, the stored-message history feature, sending or replying
  from this screen, media rendering, and restyling beyond the loading and error states
  named in the spec.
- Showing an omitted-conversation count in the interface; the counts are returned by the
  API and used only to distinguish the degraded case.

## Follow-ups addressed (from `review.md`)

**Sixth gate (revision 6):**

| # | Required follow-up | Where it landed |
|---|--------------------|-----------------|
| 1 | Pin the shape the single-chat read returns, and state it is not the list row | Approach — "That model is deliberately not the list row"; step 9 (`id` as `{_serialized, user, server}` plus `formattedTitle`, `isGroup`, `unreadCount`, `t`) |

**Fifth gate (revision 5), retained:**

| # | Required follow-up | Where it landed |
|---|--------------------|-----------------|
| 1 | Replace step 9 with chat resolution only; delete the pane mapper; keep the existing body, contract, media handling and back-fill | Approach — "The message pane"; step 9; Validation "Accepted cost"; Files to change |
| 2 | Apply the same resolution to both `routes/history.js` copies | Step 12; Files to change |
| 3 | Budget down to 2s with periodic yielding to the page event loop | Step 7 |
| 4 | Name the message-collection accessor literally | Step 6 (`chat.msgs.last()`, else `getModelsArray()` walked from the end, bounded to 20) |
