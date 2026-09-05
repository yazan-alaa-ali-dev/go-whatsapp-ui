---
ticket: bug-in-show-messages
stage: spec
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Spec — bug-in-show-messages

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Working Contacts & Messages screen — a conversation list that survives an
unreadable conversation.

## Business Goal

An administrator cannot currently see any customer conversation in the dashboard:
the conversation list fails as a whole and the screen is unusable. That removes the
only way to check what a customer sent or received without picking up the phone that
owns the WhatsApp number, and it hides delivery problems from the people expected to
answer for them. Restoring the screen returns that visibility; making the list
tolerant of a single unreadable conversation means the next upstream change costs one
missing row instead of the whole feature.

## User Story

> As an **ADMIN of the WhatsApp gateway**, I want to **open the Contacts & Messages
> screen for a connected WhatsApp number, see the conversation list load, and read the
> history of the conversation I select**, so that **I can check what a customer
> actually sent and received without opening WhatsApp on the phone or reading server
> logs**.

## Functional Requirements

- **FR-1** — Opening the Contacts & Messages screen for a **connected** WhatsApp
  number lists that number's conversations instead of failing.
- **FR-2** — The tenant-scoped view of the same screen behaves identically to the
  admin view; neither is fixed at the other's expense.
- **FR-3** — Selecting a conversation loads that conversation's message history.
- **FR-4** — **Group conversations appear in the list alongside individual ones.**
  Groups are not omitted, hidden, or filtered out.
- **FR-5** — A conversation that cannot be read **does not prevent the others from
  being listed**. The readable conversations are still returned; the unreadable one is
  omitted from the list.
- **FR-6** — Every omitted conversation is recorded in the server log with enough
  detail to identify which conversation was skipped and why.
- **FR-7** — Each listed conversation shows its display name, a preview of its last
  message, and that message's time, ordered most-recent-first.
- **FR-8** — The existing distinct failure outcomes remain distinguishable to the
  caller: unknown number, number not active, no session, and session not connected each
  keep their own outcome rather than collapsing into one generic failure.
- **FR-9** — When the screen cannot be served, it shows the **actionable reason**
  (for example, that the number must be connected first) rather than only a generic
  "failed to fetch contacts".
- **FR-10** — The screen stops showing its loading indicator once it has resolved —
  on the failure path as well as the success path.
- **FR-11** — Existing authorization is unchanged: an unauthenticated or
  unauthorized caller is rejected before any conversation data is read.
- **FR-12** — Tenant isolation is unchanged: a WhatsApp number belonging to another
  tenant remains not found on the tenant-scoped view.

## Non-Functional Requirements

- **NFR-1** — **Contract stability:** the data the screen consumes keeps its current
  shape, so the screen needs no contract change to benefit from the fix.
- **NFR-2** — **Resilience to upstream change:** a future change that breaks reading
  one conversation degrades **that conversation only**. All-or-nothing failure of the
  list is not an acceptable behaviour of the finished system.
- **NFR-3** — **No regression** in receiving inbound messages, in the webhook reply
  relay, or in any existing sending path.
- **NFR-4** — **Diagnosability:** a failure surfaces an identifiable reason in the
  server log, not only an unattributable string from the underlying automation layer.
- **NFR-5** — **Cost:** restoring the list introduces no per-conversation work that
  makes the screen materially slower than the behaviour it replaces.
- **NFR-6** — **Durability:** the fix survives a clean rebuild and redeploy of the
  service; it may not depend on a change that a fresh install would discard.

## Constraints

- **Resilience is required, not optional.** An approach that only tracks the current
  upstream defect, without making the list tolerant of one unreadable conversation,
  does **not** satisfy this spec (owner decision, 2026-08-01, recorded in
  `research.md`).
- **Groups may not be excluded** to avoid the failure. Dropping group conversations
  would make the list load, but it is explicitly rejected as a solution (owner
  decision, 2026-08-01).
- **Deployment runtime files are not modified** by this ticket.
- **There is no automated test suite in this repository**, so acceptance evidence is
  manual and observed against a live, connected WhatsApp session.
- **The failure depends on a live session and on an upstream web build that can
  change between observations**, so a reproduction can stop reproducing for reasons
  unrelated to the fix; verification must record the conditions it ran under.
- **The exact upstream failure has not yet been observed directly.** Evidence narrows
  it to conversations of a kind that individual conversations are not, and the owner has
  confirmed the single-conversation path still succeeds; the spec therefore specifies
  the required behaviour, not the defect.

## Edge Cases

- A connected number with **no conversations at all** → an empty list is a valid,
  successful result, not an error.
- **Every** conversation unreadable → the screen must say that no conversation could
  be read, rather than presenting a silently empty list as if the number had none.
- A conversation with **no last message** (never used, or fully cleared) → it is
  listed, with an empty preview, rather than dropped or causing a failure.
- A conversation whose **last message is media** rather than text → the preview shows
  the message kind instead of empty text (existing behaviour, preserved).
- A conversation with **no display name** → identified by its number instead of an
  empty row.
- **Non-conversation entries** (broadcast/channel-type entries) present in the
  account → they must not break the list, whether or not they are shown.
- The **session disconnects while the screen is loading** → the caller gets the
  not-connected outcome, not an unattributed failure.
- An account with a **large number of conversations** → the list still returns within
  the screen's existing tolerance (NFR-5).

## Open Questions

- For the fully-degraded case (no conversation readable), is an explicit "could not
  read any conversation" outcome preferred over an empty list? The spec assumes yes
  (Edge Cases, AC-9); confirm at the review gate.
- If the underlying defect turns out to affect individual conversations as well as
  the suspected kind, does the scope of this ticket extend to them, or does that
  become a follow-up? Current evidence says individual conversations are unaffected.
- Should the omitted-conversation count be visible to the administrator on the
  screen (e.g. "2 conversations could not be loaded"), or is a server-side log
  sufficient? The spec currently requires only the log (FR-6).

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID    | Acceptance criterion | Maps to requirement |
|-------|----------------------|---------------------|
| AC-1  | Opening the screen for a connected WhatsApp number renders a conversation list instead of an error banner. | FR-1 |
| AC-2  | The admin request that currently fails returns a successful result carrying the conversation list. | FR-1 |
| AC-3  | The tenant-scoped view of the screen returns the same successful result for the same number. | FR-2 |
| AC-4  | Selecting a conversation from the list loads and displays that conversation's messages. | FR-3 |
| AC-5  | Group conversations are present in the returned list and visible on the screen. | FR-4 |
| AC-6  | When one conversation cannot be read, the request still succeeds and the remaining conversations are listed. | FR-5, NFR-2 |
| AC-7  | Every skipped conversation appears in the server log, identifying which one was skipped and why. | FR-6, NFR-4 |
| AC-8  | A connected number with no conversations returns a successful empty list, not a failure. | FR-1 (edge case) |
| AC-9  | When no conversation at all can be read, the screen states that explicitly instead of showing an empty list. | FR-9 (edge case) |
| AC-10 | Each listed conversation shows its name, last-message preview, and time, ordered most-recent-first. | FR-7 |
| AC-11 | Unknown number, inactive number, missing session, and disconnected session each remain distinguishable outcomes. | FR-8 |
| AC-12 | On a failure the screen shows the actionable reason, not only a generic "failed to fetch contacts". | FR-9 |
| AC-13 | The screen's loading indicator is cleared once the screen resolves, on both the success and the failure path. | FR-10 |
| AC-14 | An unauthenticated or unauthorized request is rejected and no conversation data is returned. | FR-11 |
| AC-15 | A WhatsApp number owned by another tenant is still not found on the tenant-scoped view. | FR-12 |
| AC-16 | The data the screen consumes keeps its existing shape — the screen works without a contract change. | NFR-1 |
| AC-17 | Inbound message handling, the webhook reply relay, and existing sending paths behave as before. | NFR-3 |
| AC-18 | The fix is present and effective after a clean rebuild and redeploy of the service. | NFR-6 |

## Out of Scope

- The standalone messages page that exists separately from this screen.
- The stored-message history feature and its endpoints, delivered by the
  `show-message-history` ticket.
- Sending, replying to, or otherwise mutating conversations from this screen.
- Any redesign or restyling of the Contacts & Messages screen beyond the loading and
  error states named in FR-9, FR-10 and their criteria.
- Repairing the other flows that read conversations (shipment tracking group
  discovery, the bulk message-history endpoint). If the fix benefits them, that is
  welcome, but they are not verified by this ticket and no criterion covers them.
- Media rendering or download behaviour inside a conversation.
- Showing an omitted-conversation count in the interface (see Open Questions).
