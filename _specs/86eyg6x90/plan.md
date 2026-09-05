---
ticket: 86eyg6x90
stage: plan
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
revision: 3             # rewritten at /plan (revision mode) after round-2 CHANGES_REQUESTED
owner: developer
updated: 2026-08-02
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Plan — 86eyg6x90

> Decide the approach before changing code. Plan only — no implementation here.

## Why this revision exists

Revision 2 was returned on 13 `major` findings. The central one: the function
that throws **is** `loadEarlierMsgs`, so calling it from our own `page.evaluate`
runs identical code — on the chats that fail today the first batch throws and the
reader falls back to page-held messages, which is revision 1's outcome with a
banner added. Revision 2's claim that "a static PASS is no longer compatible with
a silently empty panel" was therefore unestablished.

The owner elected to **harden** the in-page reader rather than abandon it.
Revision 3 keeps that shape and fixes what was wrong with it, while stating
plainly what it cannot promise.

### What this plan does not establish

The loading extension **may be a no-op**. If `loadEarlierMsgs` is broken for a
chat, our call to it fails exactly as the library's does, and the operator sees
the page-held messages plus a warning saying the history could not be extended.
That is a better outcome than today's error page, and an honest one — but it is
not a guarantee that the full history appears. No acceptance criterion in this
plan is written as though it were. The unresolved root cause (OQ-1) is the reason
this plan is built to degrade truthfully rather than to depend on the extension
succeeding.

## Approach

**Clamp first.** Before any retrieval, the handler derives
`effectiveLimit = min(max(1, parseInt(limit, 10) || DEFAULT_LIMIT), MAX_LIMIT)`
and uses it on **both** paths. This matters more than it looks: the primary call
is otherwise unchanged, and the library's own `while (msgs.length < limit)` loop
(`Chat.js:207-212`) is unbounded in `limit`. A non-numeric `limit` also makes
`limit > 0` false, which skips both that loop *and* the library's trim, so the
whole held history would flow into the media/transcription pipeline. One clamp at
the top of the handler removes both hazards, and it is the only change made to
the primary path.

**Primary path unchanged otherwise.** `chat.fetchMessages({ limit: effectiveLimit })`
remains the success path (AC-10).

**Fallback: one bounded in-page read.** On a thrown error the handler makes a
single `page.evaluate`, passed as **a function with serialized arguments** —
`page.evaluate(fn, chatId, opts)`, never an interpolated body. The chat id is
data, and the reader treats it as an opaque lookup key only. This form is
required because `toChatId()` (`routes/history.js:31-36`) validates only the
trailing suffix: `"');<payload>//@c.us"` satisfies its allow-list, so an
interpolated evaluate body would execute caller-controlled text inside the live
production page. Inside the page the reader:

1. resolves the chat with `window.WWebJS.getChat(chatId, { getAsModel: false })`
   — pinned, because `getAsModel: true` and `client.getChatById` re-enter
   `getChatModel`'s group branch, which is the defect ticket `bug-in-show-messages`
   just fixed (`services/resilientChats.js:467-481`). If `window.WWebJS` is
   absent (the page was re-injected), the reader returns an empty result rather
   than throwing;
2. reads the messages the chat currently holds and applies the library's own
   notification filter;
3. if fewer than `limit` are held, calls `loadEarlierMsgs` — **`MAX_LOAD_BATCHES = 1`
   batch**, escalating to at most `MAX_ESCALATION_BATCHES = 2` further batches
   **only** while the held count is still below `limit` and budget remains. One
   WhatsApp batch typically already exceeds the dashboard's request of 30, so the
   normal cost is a single round trip. Each batch is wrapped in its own `try`,
   so a throwing batch ends the loading loop instead of failing the request. The
   loop also stops when a batch returns nothing;
4. **sorts by `t`, then takes the tail of at most `limit`, and only then maps**
   through `window.WWebJS.getMessageModel`. The order matters twice: mapping
   before slicing would materialise and serialise the entire held cache
   regardless of `limit` (revision 1's cost, relocated into the page), and taking
   an unsorted tail can drop the newest messages, because batches are *prepended*
   and the library itself sorts by `t` before its equivalent splice
   (`Chat.js:214-217`). This sorting is **selection inside the reader**, not the
   presentation re-ordering C-2 excludes;
5. returns `{ models, held, returned, exhausted, truncated }`.

In Node the returned models are re-wrapped with
`new Message(client, m)` — the same step the library performs at `Chat.js:224`.
Without it the untouched downstream pipeline breaks: it consumes `Message`
instances (`msg.hasQuotedMsg`, `await msg.getQuotedMessage()`,
`msg.id._serialized`, and `getMessageMediaSafe(msg)` → `msg.downloadMedia()` /
`msg.getChat()`), so plain serialized objects would silently lose media, reply
linkage and timestamps, or throw inside `Promise.all`.

**Real wall-clock bound.** `LOAD_DEADLINE_MS = 4000` is enforced by racing **each
batch** against the remaining budget inside the evaluate, not by checking the
clock between batches. A checked-between-batches deadline never fires on the case
that matters: `loadEarlierMsgs` awaits a server round trip, so a stalled batch
would hang the evaluate until Puppeteer's `protocolTimeout` (~180 s by default),
pinning both the request and an in-flight evaluate on the page that serves live
inbound traffic. The race makes 4 s the true cap; the handler does not rely on
`protocolTimeout` as a backstop.

**Cause codes, and a warning only when there is something to warn about.**
Revision 2 would have shown a banner on essentially every conversation — a chat
that legitimately holds fewer than `limit` messages (the first edge case in
`spec.md`) would have been reported as truncated, and `PRIMARY_FETCH_FAILED`
would have shown a banner even when `limit` was satisfied. Revision 3
distinguishes exhaustion from truncation:

| code | meaning | banner? |
|---|---|---|
| `HISTORY_COMPLETE` | fallback ran; a batch returned nothing, so the chat's history is exhausted — the operator is seeing everything there is | **no** |
| `HISTORY_LOAD_TRUNCATED` | fallback ran; loading stopped at the batch bound, the deadline, or a batch error, with fewer than `limit` returned | yes |
| `PAGE_CACHE_ONLY` | fallback ran; no further history could be loaded at all, with fewer than `limit` returned | yes |
| `FETCH_UNAVAILABLE` | the fallback itself failed; no messages are available | yes (error branch) |

A banner is emitted **only** when `returned < limit` **and** the cause is
`HISTORY_LOAD_TRUNCATED` or `PAGE_CACHE_ONLY`. When `returned >= limit` the
request is reported as the success it is, with no banner — the fact that the
primary call threw is a server-side log detail, not an operator concern.

**No raw error text on any path.** `warning.message` is a **constant string
selected by cause code**, with no interpolation of any error- or page-derived
value. The hard-failure branch is mapped to `FETCH_UNAVAILABLE` and its retained
`details` is passed through `sanitiseErrorText()`. Revision 2 asserted that raw
`error.message` never reaches the response body while its Step 6 preserved
exactly that — and revision 2 made it worse, because the error there is now a
Puppeteer `evaluate` error carrying the evaluated source and the serialized
argument. No path returns `error.message` verbatim; this is a checkable condition
at `/verify`.

**Ordering.** The API returns messages oldest → newest; the page reverses them.
Delete that reversal so the page renders the order it was given (C-2). The
existing scroll-to-bottom then satisfies AC-8.

## Steps

1. Bring local `main` up to date with `origin/main` (34 commits behind; PR #30
   `66daf3b`). Confirm the working tree is clean apart from `_specs/86eyg6x90/`.
2. Create the implementation branch
   **`ticket/fix-message-history-fetch-and-order`** from the updated `main`, per
   the GU-4 waiver recorded in `review.md > Owner elections recorded at this gate`.
3. In `routes/history.js`, add adjacent to the admin handler: the constants
   `DEFAULT_LIMIT = 10`, `MAX_LIMIT = 50`, `MAX_LOAD_BATCHES = 1`,
   `MAX_ESCALATION_BATCHES = 2`, `LOAD_DEADLINE_MS = 4000`; the cause-code set;
   the `sanitiseErrorText()` helper; and the in-page reader function. Add the
   `whatsapp-web.js/src/structures/Message` import.
4. Carry an **UPSTREAM CONTRACT** comment block at the reader, in the style of
   `services/resilientChats.js:26-37`, pinning what it depends on:
   `window.WWebJS.getChat(id, { getAsModel: false })`,
   `window.Store.ConversationMsgs.loadEarlierMsgs` (`WAWebChatLoadMessages`,
   registered at `Store.js:84`), `window.WWebJS.getMessageModel`
   (`Utils.js:539`), `chat.msgs.getModelsArray()`, and the message field `t`.
   Cross-reference it from `resilientChats.js`'s header so the project's record of
   pinned internals lists both readers. *(Adding that one cross-reference line is
   the sole edit to `resilientChats.js`; see Files to change.)*
5. In `POST /api/admin/get-messages` (`routes/history.js:186`), derive
   `effectiveLimit` immediately after the existing input validation and use it in
   place of `limit || 10` at `:241`.
6. Wrap the retrieval at `:241`: primary call unchanged; on a thrown error, one
   `page.evaluate(fn, chatId, opts)` performing the bounded read; re-wrap the
   returned models with `new Message(client, m)`; derive the cause code from
   `{ held, returned, exhausted, truncated }`.
7. Slice to `effectiveLimit` **before** the `Promise.all` mapping at `:243` —
   stated here as a checkable condition, in-page (step 4 of Approach) and in Node.
8. Log one line on the fallback path with the `[contacts]` prefix used by this
   screen's other degraded paths (`resilientChats.js:418,447,492`), carrying:
   `waNumberId`, the requested chat id, the cause code, `err.name`, and
   `sanitiseErrorText(err.message)`. Per the AC-14 reading recorded in
   `review.md`, `sanitiseErrorText()` **redacts before truncating** — strip
   control characters, redact digit runs of 7 or more **including runs containing
   `[\s.\-()+]` separators**, then truncate to 200 characters. Redacting after
   truncation would let a split run fall below the threshold and survive. No
   message body or message text is ever logged (AC-13, AC-14).
9. Pass `{ retries: 0 }` to `getMessageMediaSafe` from this handler. **Stated
   accurately:** this removes one direct attempt and its 1500 ms sleep, but
   `utils/media.js:50-59` re-fetches unconditionally via
   `chat.fetchMessages({ limit: 30 })` — the same limited call that just threw for
   this chat — so the doomed re-entry is *reduced, not removed*. Eliminating it
   would require changing `utils/media.js`, which is out of scope. The residual
   cost is recorded in the runtime-impact statement at `/verify`.
10. If the fallback itself throws, return the existing `500` shape with
    `error` unchanged, `details` passed through `sanitiseErrorText()`, and a new
    `cause: "FETCH_UNAVAILABLE"` field.
11. Extend the success response so a degraded retrieval carries
    `warning: { message, cause, returned, requested }` alongside `success: true`
    and `messages`. The field is **absent** whenever no banner is warranted, so
    existing consumers and the healthy path are unaffected (AC-10).
12. In `public/contacts.html`, delete the `.reverse()` in `renderMessages`
    (`:623`) and render the array as received (AC-6, AC-7). Leave
    `scrollTop = scrollHeight` in place (AC-8).
13. Add a warning container **outside** the scrolling `#messagesList` (under
    `.messages-header`), so the banner is not scrolled out of view by AC-8's
    scroll-to-bottom. `renderMessages` **clears that container unconditionally on
    entry** and repopulates it only when `warning` is present — otherwise a
    truncation banner from contact A survives onto contact B's complete history.
    The banner is built with `document.createElement` and `textContent`, reusing
    the pattern `showError` already establishes at `:397-405`; no `innerHTML`, no
    escape-and-interpolate (AC-4, AC-15).
14. In `loadMessages` (`:568`), pass `warning` to `renderMessages` on the success
    path, and on the failure branch show the `cause` alongside `error` so the
    operator gets more than a generic message (AC-5, FR-3) — the page currently
    reads `data.error` only (`:594-596`).
15. Run the validation profile against the changed JavaScript source and record
    the result; inspect the HTML change manually (see Validation strategy).
16. Write `implement.md` recording files changed, deviations, and validation run.
    Create **no** commit (IM-9).

## Files to change

- `routes/history.js` — **only** the `POST /api/admin/get-messages` handler
  (declared `:186`, retrieval `:241`, mapping `:243`, response `:317`, catch
  `:318`), plus the constants, cause-code set, `sanitiseErrorText()`, the in-page
  reader with its UPSTREAM CONTRACT block, and the `structures/Message` import.
  The other two handlers — `/get-messages` (`:38`, retrieval `:99`) and
  `/get-all-messages` (`:327`, retrieval `:334`) — **must remain byte-for-byte
  unchanged** (AC-17).
- `public/contacts.html` — **only** `loadMessages` (from `:568`),
  `renderMessages` (from `:609`), and the addition of the warning container
  element under `.messages-header`. No other function touched (AC-17).
- `services/resilientChats.js` — **one comment line only**, cross-referencing the
  second reader from the existing UPSTREAM CONTRACT header (`:26-37`). No code
  change. This file was declared out of scope in revision 2 on a misreading of
  AC-17 (see "Placement" below); AC-17 constrains the *other two endpoints*, and
  this file is on this endpoint's path.

No other file is in scope: nothing under `node_modules/` (C-3), no deployment
runtime file (C-4/AC-16), no `package.json`, no swagger file.

### Placement — argued on its merits

Revision 2 justified putting the reader in `routes/history.js` as "the two-file
diff required by AC-16/AC-17". That was a misread: AC-17 requires the change to
stay on the contacts screen and the endpoint it calls, and requires the *other
two* endpoints to be untouched — `services/resilientChats.js` is on this
endpoint's path, not one of them.

The real trade-off is: putting the op in `resilientChats.js` reuses its installed
reader, its `READER_VERSION` reinstall handling and its in-page budget/yield
guards, at the cost of touching a module the previous ticket just stabilised and
of bumping `READER_VERSION`, which forces a reinstall in every live page.
Keeping the reader local to the handler avoids that blast radius and keeps the
fallback's lifetime tied to the one endpoint that needs it, at the cost of a
second place to re-check on a library upgrade. **This plan keeps it local** and
pays that cost explicitly through the UPSTREAM CONTRACT block and the
cross-reference (step 4), so no coupling goes unrecorded.

## Validation strategy

- Validation profile: `node-source`
- Applies to `routes/history.js` and `services/resilientChats.js` — the profile's
  check parses changed JavaScript source; a non-zero exit blocks (AC-18).
- `public/contacts.html` is **not** covered by the profile: the change lives in a
  `<script>` block inside an HTML file, which the profile's check cannot parse.
  The gap is stated rather than papered over, and is covered by inspection at
  `/verify`: the reversal is gone, the rendered array is the array received, the
  scroll-to-bottom remains, the banner container sits outside `#messagesList`, it
  is cleared unconditionally on entry, and it is built via
  `createElement`/`textContent`.
- Remaining criteria are assessed by reading the delivered diff against
  `spec.md`, per C-5 (no live messaging session is available to the gate):
  - AC-1..AC-3 — the fallback exists, runs only on a thrown error, and returns
    the messages it has rather than converting the request into a failure.
  - AC-9, AC-11, AC-12 — the change is confined to one handler; the evaluate is
    a single call with a per-batch race against `LOAD_DEADLINE_MS`, at most
    `MAX_LOAD_BATCHES + MAX_ESCALATION_BATCHES` batches, no retry of the failing
    call, and no session-lifecycle change; `effectiveLimit` bounds both paths.
  - AC-13, AC-14 — the log line carries both identifiers, the cause code,
    `err.name` and a sanitised message that redacts before truncating; no message
    body.
  - AC-15 — no `innerHTML` sink receives server-supplied text on the new path.
  - AC-16, AC-17 — `git diff` shows exactly the three files above, the third
    being a single comment line, and the other two message-history handlers are
    unchanged.
- **Live behaviour is confirmed by the owner personally after closure** and is
  not a gate precondition (C-5, `research.md` Q8). A `/verify` PASS means "the
  code satisfies the criteria", not "the dashboard was observed working". This
  plan does **not** repeat revision 2's claim that a static PASS is incompatible
  with an empty panel: if `loadEarlierMsgs` is broken for a chat, the operator
  sees the page-held messages and a truthful warning, and `/verify` cannot
  distinguish that from a full recovery.

## Rollback

- Nothing is committed at `/implement` (IM-9), so before publication the change
  is discarded with `git restore` on the three files listed above.
- After publication it is a single commit, reverted with `git revert <sha>`, or
  the branch is simply not merged.
- Each edit is independently reversible: the ordering fix is one deleted
  expression; the `resilientChats.js` edit is one comment line; the fetch changes
  are additive except the clamp, and reverting restores today's behaviour because
  the primary call and the existing `catch` shape are otherwise untouched
  (NFR-6).
- No migration, no state change, no deployment artefact — rollback needs no
  coordination.

## Out of scope

- The other two message-history handlers (`:99`, `:334`), which retain the same
  latent defect by owner decision (`research.md` Q4).
- Any server-side re-ordering of the retrieved result (C-2). The reader's sort is
  tail *selection*, not presentation ordering.
- Modifying, upgrading, patching, or forking `whatsapp-web.js` (C-3).
- Changing `utils/media.js` — so the unconditional re-fetch at `:50-59` remains
  (step 9).
- Aligning `resilientChats.js:52`'s raw-error return with the cause-code approach
  adopted here — a follow-up ticket.
- Introducing a test framework or a test runner.
- Any change to deployment runtime files (C-4).
- Confirming the root-cause hypothesis against a live session (OQ-1), and the
  owner's own post-closure manual testing (C-5).

## Deviations requiring owner acceptance at `/review`

1. **In-page use of WhatsApp-Web internals.** The fallback calls
   `loadEarlierMsgs` and `getMessageModel` through `page.evaluate`. Accepting this
   plan accepts a bounded, fallback-only dependency on those internals, confined
   to `routes/history.js` and recorded in an UPSTREAM CONTRACT block.
2. **Branch name.** `ticket/fix-message-history-fetch-and-order`, per the GU-4
   waiver already recorded in `review.md`. Restated here for traceability only —
   the waiver lives at the gate, not in this document.
3. **`services/resilientChats.js` is touched** by one comment line, where
   revision 2 declared it untouched. This is a widening of "Files to change" and
   needs acceptance.
4. **Reading of AC-14** — sanitised diagnostic substance, per the reading
   recorded in `review.md`.

## Risk accepted by this plan

- **The extension may be a no-op.** If `loadEarlierMsgs` fails for a chat, the
  operator sees page-held messages plus a truthful warning, not the full history.
  This is the honest outcome, not a recovery, and it is why no AC is written as
  though full history were guaranteed.
- **`loadEarlierMsgs` mutates the live production page.** Unlike the read-only
  reader in `resilientChats.js`, each successful load permanently grows that
  chat's in-memory collection in the Chromium session that also serves inbound
  traffic. The endpoint has no rate limit, so repeated opens compound heap growth.
  `MAX_LOAD_BATCHES = 1` keeps the per-open increment to roughly one WhatsApp
  batch; the retained total is stated in `/verify`'s runtime-impact line.
- **Expected cost regime.** Where loading works, the page then holds ≥ `limit`, so
  the primary call stops entering the failing branch — the cost is once per chat
  per session, not per click. Where loading is genuinely broken
  (`PAGE_CACHE_ONLY`, the case this ticket exists for) the primary call throws and
  the fallback re-runs on **every** open, indefinitely. No negative cache is
  added; if that proves costly in practice, a short-lived per-chat negative cache
  is the follow-up.
- **No single-flight or dedupe.** An admin clicking down the contact list, or
  several admins browsing, produces concurrent evaluates on the one page,
  including for chats already abandoned in the UI (`loadMessages` has no abort).
  Accepted for this ticket; an in-flight map keyed by `waNumberId:chatId` is the
  follow-up.
- **Sanitisation is heuristic.** `sanitiseErrorText()` reduces, but cannot prove
  the absence of, sensitive content in third-party error strings. With the
  hard-failure branch now sanitised too, the residual exposure is bounded to
  server logs and to a sanitised `details` field.
- **In-page evaluate is version-coupled.** A `whatsapp-web.js` or WhatsApp Web
  change can alter the internals the reader depends on. It returns an empty
  result rather than throwing when expected shapes are absent, so the worst case
  degrades to today's behaviour plus a `PAGE_CACHE_ONLY` warning.

## Accepted drift (recorded, no action)

- **AC-12 wording under-states NFR-2.** AC-12 asserts only "no unbounded retry or
  loop"; NFR-2 additionally requires a bound on messages processed. This plan
  bounds the work in fact (clamp + batch cap + per-batch deadline + slice before
  map), and the wording gap is recorded rather than silently relied on.
- **Swagger doc drift.** The new `warning` field is not documented;
  `GetMessagesResponse` is shared with the untouched `/get-messages`, so it
  cannot be extended without implying that endpoint emits it too.
