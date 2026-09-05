---
ticket: bug-in-show-messages
stage: implement
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Implement — bug-in-show-messages

> Record of what was actually built, following `plan.md` (revision 6).

Branch `ticket/bug-in-show-messages`, created from clean `main` at `96e77b2` — the
only branch-creation point (IM-3/GU-4). No commit was created and nothing was pushed
(IM-9); the single publishable commit belongs to `/publish-pr`.

## Run log

| # | Date | Path | Outcome |
|---|------|------|---------|
| 1 | 2026-08-01 | initial (from `approved`) | Branch created; all four planned files applied; `node-source` profile passed → `implemented` |
| — | 2026-08-01 | `/verify` | **FAILED (blocked)** — not a defect: `all-ac` unsatisfiable without a live session → back to `implementation-in-progress` |
| 2 | 2026-08-01 | **resume** (from `implementation-in-progress`) | **No code changes** — every entry in "Files to change" was already applied and is still in the working tree. Existing branch reused, no second branch (IM-3a). Static validation re-run and extended; the two runtime observations remain outstanding (below) |
| — | 2026-08-01 | `/verify` run 2 | **FAILED (blocked)** again — no new evidence; identical outcome |
| 3 | 2026-08-01 | **resume** (from `implementation-in-progress`) | **No code changes.** The working tree is now clean because the work was **committed outside the workflow** (see "Git state" below). All four planned files are present and intact in `3b60450`. → `implemented` |

**Why this resume applied nothing:** the block recorded at `/verify` was the absence
of *runtime acceptance evidence*, not unfinished code. Resuming re-validated what
exists, returned the ticket to `implemented` so `/verify` can run once the evidence
exists, and left the outstanding observations explicitly outstanding — they were not
captured, inferred or simulated.

## Changes made

- **`services/resilientChats.js` — new.** The page-side reader. One
  `page.evaluate` per request does probe → install-if-needed → read, keyed on a
  version marker held on the installed object *inside the page* (never in Node —
  `Client.inject()` re-runs on every `framenavigated` and `LoadUtils` resets
  `window.WWebJS = {}`, so a Node-side flag would stay true while the reader was
  wiped). It exposes two entry points:
  - `readChats(client)` — builds every row itself and **never calls `getChatModel`**,
    so `createWid(chat.id._serialized)`, `groupMetadata.update()` and the participant
    walk are never executed. Rows are mapped to the endpoints' existing contract
    (`id`, `name` ← `formattedTitle`, `isGroup` ← presence of `groupMetadata`,
    `unreadCount`, `timestamp` ← `t`, `lastMessage`), with `formattedTitle`/`isGroup`
    **derived** because `chat.serialize()` produces neither. Chat WIDs and message
    keys are repaired in-page (`_serialized` → `$1` → rebuild from parts), because
    `utils/normalizeMsgId.js` runs Node-side and cannot repair a lookup the page has
    already failed. The last message comes from the chat's own loaded collection
    (`msgs.last()`, else a backwards walk bounded to 20 entries, skipping protocol /
    notification / revoked stanzas), falling back to the repaired `lastReceivedKey`
    via **`Store.Msg.get` only** — the upstream `getMessagesById` clause
    (`Utils.js:667`) is deliberately not ported because it is a network fetch.
    Ordering by `t` happens in-page **before** the 500-chat cap; the read is bounded
    by a 2s wall-clock budget and yields to the page event loop every 50 chats;
    per-chat guards plus `Promise.allSettled` isolate failures into `skipped` and
    `degraded` lists (100 entries each, remainder counted in `dropped`), carrying a
    fixed reason code and a shaped identifier only — never a raw error string.
  - `resolveChat(client, chatId)` — returns a usable `Chat`/`GroupChat` **without**
    `client.getChatById`, which builds a chat model and so re-enters the group
    branch. The model is library-shaped (`id` as `{_serialized, user, server}` plus
    `formattedTitle`, `isGroup`, `unreadCount`, `t`) — deliberately *not* the
    flattened response row, whose string `id` would make `this.id._serialized`
    undefined and throw for every conversation.
- **`routes/tenants.js`** — both contacts endpoints (admin and tenant-scoped) now
  read through `readChats` instead of `client.getChats()` + a per-chat
  `fetchMessages({limit:1})`. Auth, guard responses, tenant checks, the existing sort
  and the existing response fields are unchanged; `allUnreadable`, `skippedCount`,
  `degradedCount` and `truncatedCount` are added alongside them (additive only).
- **`routes/history.js`** — both `get-messages` handlers resolve the chat via
  `resolveChat` instead of `getChatById`, and normalize identifiers through a new
  `toChatId()` allow-list (`@c.us`, `@g.us`, `@lid`; bare numbers still get `@c.us`).
  Everything downstream is untouched: `Message` instances, the response contract,
  media/quoted/transcription handling, and the `loadEarlierMsgs` back-fill.
- **`public/contacts.html`** — the inline `onclick` is replaced by one delegated
  listener with only the chat id in a `data-` attribute and the row resolved from
  `allContacts` (HTML-escaping cannot secure an attribute JS-string context: the
  browser entity-decodes the attribute before the JS in it is parsed). Added
  `escapeHtml` applied at **render time only** to every interpolated value in the
  contact and message templates; `showError` now builds its banner with
  `textContent`; the active-row highlight takes the matched element explicitly;
  a missing display name falls back to the number in rendering, selection and
  search; `waNumberId` is `encodeURIComponent`-encoded in the request path; the
  full chat id is sent when opening a conversation (not `split('@')[0]`); the
  message limit is 30; and the loading indicator is cleared on the failure path,
  with "no conversation could be read" rendered distinctly from "no conversations".

## Git state — changed since resume 3 (read before `/publish-pr`)

`/implement` created no commit and pushed nothing on any of its three runs (IM-9).
**Two commits were nevertheless made on this branch outside the workflow**, between
`/verify` run 2 and resume 3. Recorded as fact, not as a workflow action:

| Commit | Message | What it actually contains |
|--------|---------|---------------------------|
| `3b60450` | "feat: implement resilient chat reading and improve error handling" | **This ticket's work** — all four planned files (`services/resilientChats.js`, `routes/tenants.js`, `routes/history.js`, `public/contacts.html`) plus most of `_specs/bug-in-show-messages/`. Accurate. |
| `f4fe7ef` | "feat(memory): add memory and session reporting to /health endpoint" | **Neither** — it contains no `/health` change. It carries this ticket's `comprehension.md` + `ticket.md` and `docs/TICKET-bug-in-show-messages.md`, **plus ~2,300 lines of unrelated memory-consumption material**: `docs/clickup-memory-tickets.json`, `docs/memory-consumption-research-AR.html`, and seven `docs/tickets/memory-consumption/TICKET-MEM-*.md`. |

Two consequences the owner should decide on **before** `/publish-pr`:

1. **`f4fe7ef` would contaminate this ticket's PR.** `/publish-pr` stages the
   implemented source plus `_specs/<slug>/` (PB-9), but it pushes the **branch**, so
   every commit on it lands in the PR — including the memory-consumption documents,
   which belong to a different effort and were never in this plan's "Files to change"
   (IM-4). Options: move those paths to their own branch and drop them from here, or
   accept a PR whose diff is mostly unrelated documentation.
2. **`f4fe7ef`'s message does not describe its contents**, which will mislead anyone
   reading the history later.

**One thing this changes for the better:** the branch is now committable/deployable,
which breaks the procedural deadlock recorded in `verify.md` §6 — the acceptance
checklist can finally be run. That deadlock remains a real governance gap (it was
resolved here by acting outside the workflow, not by the workflow), and is still
raised for the Workflow Owner.

## Changes prepared

> `/implement` creates **no commit** (IM-9 / ADR-008); it recorded no SHAs of its
> own. The SHAs above were created outside the workflow and are recorded for
> traceability only.

- `services/resilientChats.js` — new (untracked)
- `routes/tenants.js` — modified
- `routes/history.js` — modified
- `public/contacts.html` — modified

Exactly the four files listed in `plan.md` "Files to change" (IM-4). No deployment
runtime file was touched (IM-5/GU-2).

## Deviations from plan

- **None in scope or file set.** One implementation detail worth recording: the plan
  specifies both `Promise.allSettled` isolation *and* yielding every 50 chats. These
  are combined by processing the chat list in batches of 50 — each batch through
  `Promise.allSettled`, then a yield — which satisfies both literally rather than
  choosing between them.
- The reader reads `unreadCount` and `t` from `chat.serialize()` when available and
  falls back to the direct property, because upstream only ever reads those through
  `serialize()`; `formattedTitle` is read directly, as `getChatModel` does, since it
  is a getter and absent from the serialized output.

## Validation run during implementation

Validation profile `node-source` (`node --check <file>`):

- `node --check services/resilientChats.js` — **PASS**
- `node --check routes/tenants.js` — **PASS**
- `node --check routes/history.js` — **PASS**
- `node --check` on the script block extracted from `public/contacts.html` — **PASS**
  (the profile covers JavaScript files; the page's script was extracted and checked
  the same way rather than left unvalidated)

Additional checks run here, recorded as evidence:

- `require('./services/resilientChats')` loads and exports `readChats` / `resolveChat`;
  `whatsapp-web.js/src/factories/ChatFactory` resolves from this package layout.
- `toChatId()` behaviour, exercised directly:
  `966501234567` → `966501234567@c.us`; `…@c.us` → unchanged; `120363…@g.us` →
  unchanged; `…@lid` → unchanged; `x@newsletter` → `null`; `status@broadcast` →
  `null`; `""`/`null` → `null`. Bare numbers keep today's behaviour and no
  disallowed domain becomes reachable.
- Sink audit of `public/contacts.html`: five `innerHTML` sites remain — one clearing
  assignment and two static empty-state literals (no interpolation), plus the two
  templates now escaped. The only remaining `onclick` attributes are the static
  `goBack()` and `loadMessages()` handlers, which interpolate nothing.
- `git status` confirms the working tree contains exactly the four planned files and
  `git log` confirms **no commit** was created on the branch (IM-9).

### Static confirmation added at resume 2

`verify.md` §1-§2 now confirms from source, with quoted lines, that the mechanism
introduced by plan revision 6 is correctly implemented — the single-chat model
returns `id` as a WID-shaped object (`services/resilientChats.js:297`, built by
`widObject` at `:115-123`) and **not** the flattened string used by the list row
(`:274`); it resolves with `getAsModel: false` (`:377`); Node builds the instance via
`ChatFactory.create` (`:496`); no `getChatById` call site remains in
`routes/history.js`; and only `fetchMessages` is used from the instance (`:99`,
`:241`). Eighteen further static properties (S-1…S-18) are confirmed there too.

This raises static coverage from 6 to 12 of the 18 acceptance criteria. It does not
substitute for the runtime evidence below, and no criterion has been marked passed on
the strength of it.

## Outstanding — runtime evidence not captured here

Two observations the plan assigns to `/implement` **could not be made in this
environment**, because both need a live, connected WhatsApp session and a deployed
page, which is not available where this ran. They are not code work — the planned
code is complete — but they are unfulfilled plan obligations and are recorded rather
than glossed:

1. **The real upstream exception.** The plan expects the first direct observation of
   the defect to come from the `degraded`/`skipped` report once the reader runs
   against a live session, recorded verbatim here. **Not captured.** Until it is, the
   root cause remains the hypothesis stated in `research.md` — that the throw is in
   `getChatModel`'s group branch — which this implementation makes moot for the list
   (it never calls that code) but does not confirm.
2. **AC-6 evidence.** The plan requires forcing one chat's builder to reject **at
   runtime from the page** (never by editing source, VF-7) and observing that the list
   still returns the remaining chats with the skip logged. **Not captured.**

Both must be gathered against a connected session before `/verify` can map AC-6 to a
passing result (VF-2). Recording the WhatsApp Web build at that time is also still
required.
