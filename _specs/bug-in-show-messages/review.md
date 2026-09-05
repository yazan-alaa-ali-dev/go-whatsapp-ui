---
ticket: bug-in-show-messages
stage: review
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: reviewer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Review — bug-in-show-messages

> Review gate — run by the ticket owner themselves (self-review). A comprehension
> check at the gate is the integrity control. Evaluates the spec and plan before
> any implementation.

## Review Scope

Seventh gate pass, over `plan.md` **revision 6** and `spec.md` (AC-1..AC-18). The
three lenses were continued from their existing context and scoped to the single
delta revision 6 introduced. All three returned **ready to implement**, each having
verified the change against the installed library sources rather than the plan's text.

Across the seven passes the gate returned the plan six times, on defects that were
verified every time and that shrank steadily — 13 follow-ups, then 16, then 4, then 1,
then none. The design itself has been unchanged since revision 3.

## Plan Summary

A page-side reader builds each contact row itself and never calls the library's
`getChatModel`, so the statements that throw — `WidFactory.createWid(chat.id._serialized)`,
`groupMetadata.update(chatWid)` and the participant walk (`Utils.js:645-655`) — are
never executed and a group is listed **by construction** rather than rescued after a
failure. Identifiers and the last message are repaired and resolved in-page, since
`utils/normalizeMsgId.js` runs Node-side and cannot repair a lookup the page has
already failed. Ordering by `t` happens in-page before the 500-chat cap; per-chat
guards plus `Promise.allSettled` give the tolerance; the report is bounded with fixed
reason codes under a 2-second budget that yields every 50 chats. The screen gains a
delegated listener, render-time escaping, null-name handling and `encodeURIComponent`.
For the message pane, only the **chat resolution** changes: the reader supplies a
library-shaped model, Node constructs the `Chat` instance instead of calling
`getChatById`, and the existing endpoint body — `Message` instances, response
contract, media, transcription, `loadEarlierMsgs` back-fill — runs unchanged.

## Risks

- The reader is the sole producer of the row shape and the pane's chat handle, both
  depending on library-internal contracts that can drift **silently** rather than
  loudly. Mitigated by the reference comment naming the exact upstream version and
  lines, and the standing rule that any dependency upgrade must re-check that file.
- The exact upstream exception is still unobserved; it will be captured during
  `/implement` from the `degraded` report and recorded in `implement.md`.
- Verification is manual against a live session on a WhatsApp Web build that can move
  between runs — every observation records the build it ran against.
- Making groups visible makes the message pane reachable for groups, whose per-message
  media handling and transcription cost is accepted and recorded, with the screen's
  request reduced from 50 to 30.

## Assumptions

- **Verified at this gate:** `Chat.fetchMessages` (`structures/Chat.js:192-225`) uses
  only `this.client` and `this.id._serialized`, and resolves in-page via
  `window.WWebJS.getChat(chatId, { getAsModel: false })` at `:204`; `getChatModel` runs
  only when `getAsModel && chat` (`Utils.js:587-589`), so the group branch is
  unreachable on that path.
- **Verified at this gate:** `Chat._patch` assigns `this.id = data.id` verbatim
  (`:22`) and reads `data.formattedTitle` / `data.unreadCount` / `data.t`
  (`:28,46,52`); `GroupChat._patch` only assigns `data.groupMetadata`
  (`GroupChat.js:18-22`), whose getters are lazy and unused here, so omitting group
  metadata from the model is safe.
- **Verified in an earlier pass:** `Store.Msg.get()` is a synchronous local lookup and
  cannot reach the network; the upstream `getMessagesById` clause (`Utils.js:667`) is
  deliberately not ported.
- The throw originates in `getChatModel`'s group branch — supported by the owner's
  confirmation that the single-chat path succeeds, and not yet proven by an observed
  exception.

## Open Questions

- NFR-5 has no acceptance criterion and one **cannot** be added within this ticket:
  `/spec` accepts only `state: ready-for-research`, and although
  `spec-complete → research-complete` is a legal edge in
  `project-config.yaml > lifecycle`, **no command implements it**. The measurement is
  carried as `verify.md` evidence beyond AC coverage, and the missing edge is raised to
  the Workflow Owner as a governance gap.
- Whether the pre-existing duplicate tracking groups (created today on every lookup
  because `getChats()` throws) warrant a cleanup ticket, alongside deleting the dead
  `/get-all-messages` handler.

## Panel Findings (advisory)

> Findings from the advisory review panel (senior / security / performance) run
> at Step 1a — read-only lenses over `plan.md` + `spec.md` (ADR-010 / RP-1).
> **Advisory only:** these inform the owner; they never block the decision (RP-2).

| Lens | Severity | Finding | Ref | Owner's disposition |
|------|----------|---------|-----|---------------------|
| senior | info | **Ready to implement.** Step 9's pinned `id` shape `{_serialized, user, server}` is exactly what `Chat._patch` stores verbatim (`Chat.js:22`) and what `fetchMessages` dereferences (`:222`) before passing it in-page to `getChat(chatId, {getAsModel:false})` (`:204`), so the group branch stays unreachable and the handle works. `isGroup` drives `ChatFactory.create` to `GroupChat`, whose `_patch` only assigns `data.groupMetadata` — `undefined` is harmless, the getters being lazy and unused. `formattedTitle`/`unreadCount`/`t` cover the rest of `_patch`. | plan step 9 | **Accept — no action.** Closes the sixth gate's sole follow-up. |
| security | info | **Ready to implement.** Step 9 pins the shape and explicitly rejects step 4's flattened row, matching `Chat._patch` and the `this.id._serialized` dereference; the Approach states the same reasoning, so the two cannot drift apart at implement time. No new security or AC defects. | plan step 9, Approach | **Accept — no action.** |
| performance | info | **Ready to implement.** No new unbounded-work, hot-path or AC-failure concerns: one evaluate per contacts request, order-by-`t` before the 500 cap, tail read bounded to 20 entries, `Store.Msg.get` only, 100-entry report lists, 2s budget with a yield every 50 chats on the shared inbound page, and pane depth unchanged because `fetchMessages` and its back-fill are untouched. | plan steps 5-9 | **Accept — no action.** |

No open findings remain. Every finding raised across the seven passes is either closed
in the plan or recorded as an out-of-scope follow-up ticket candidate.

## Decision

`APPROVED`

- Rationale: the plan is complete against PL-1..PL-5 with traceability to the
  acceptance criteria, and its central claims are verified against the installed
  library rather than asserted — that `fetchMessages` self-resolves with
  `getAsModel: false` and so never reaches the group branch, that `Chat._patch`
  consumes exactly the fields the pinned model supplies, and that omitting group
  metadata is harmless on this path. All three advisory lenses independently return
  **ready to implement** with no open findings. The scope is four files, the change is
  additive or a call-site swap in every case, rollback is a branch revert with no
  dependency, lockfile, schema, configuration or deployment-runtime change, and a
  failed install degrades to today's bug rather than to a new failure mode. The
  comprehension check passed 3/3 at 100% (CG-4), including the two questions whose
  correct answer changed across revisions. Approving.

## Approvals

> Single self-approval by the ticket owner (no distinct reviewer, no second approver).

- Approver (owner): hassan (`developer`) — approved 2026-08-01 after the comprehension
  check passed 3/3 (`comprehension.md`, attempt 2).

## ADR reference

> Optional — record an ADR only if the decision is notable; otherwise "none".

- ADR: none. The notable decision — building rows ourselves instead of using the
  library's chat model, and the drift risk that buys — is recorded in `plan.md` under
  "Price of this approach", with the version and upstream lines it depends on.

## Comprehension check

**Passed, 3/3 (100%) — CG-1..CG-4 satisfied.** Recorded in `comprehension.md`
(attempt 2, against revision 6). Attempt 1, against revision 2a, failed 2/3 and
correctly blocked the gate at that time; both attempts are retained.

## Required Follow-up Actions

None blocking — implementation may begin.

Carried into `/implement` and `/verify` as obligations already stated in `plan.md`:

- Capture the **real upstream exception** from the `degraded` report during
  `/implement` and record it verbatim in `implement.md` — the first direct observation
  of the defect, which the research stage could not obtain.
- Capture the **AC-6 evidence** during `/implement` by forcing one chat's builder to
  reject **at runtime from the page**, never by editing a source file (VF-7).
- Record the **WhatsApp Web build** for every observation.

Follow-up ticket candidates recorded in `plan.md` "Out of scope", not part of this
ticket:

- The `getChats()` failure in `services/shipmentTracking.js:292`, which today falls
  through to `createGroup` and is **already creating duplicate tracking groups on every
  lookup**, plus the duplicates already accumulated; the same group branch also affects
  `getChatById` at `:246`, `:324`, `:389` and `routes/admin.js:154`.
- Deleting the dead `/get-all-messages` handler (`routes/history.js:288`), which
  references an undefined `client` and has no auth middleware.
- Converging the existing in-page overrides in `services/messagingService.js:132-143`
  and `services/whatsapp.js:100-110`, which carry the wipe-on-reinject weakness this
  reader avoids.
- Reducing the message-pane cost further (per-message media handling and audio
  transcription).
