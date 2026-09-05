---
ticket: 86eyg6x90
stage: spec
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-02
links:
  clickup: https://app.clickup.com/t/86eyg6x90
  github:
---

# Spec — 86eyg6x90

> Define *what* must be true when done. **No implementation details, no file
> names, no code.**

## Feature Name

Reliable message-history display on the admin contacts dashboard.

## Business Goal

An administrator cannot currently review customer conversations from the
dashboard: opening a contact fails for all but one chat, and the history that
does appear reads backwards. Message history is the dashboard's reason to exist,
so today the screen cannot be relied on to answer "what was said to this
customer". This ticket restores that: every conversation opens, is readable in
the order it happened, and when something does go wrong the administrator is told
what failed and why instead of facing a blank panel.

## User Story

> As an **administrator**, I want to **open any contact on the dashboard and read
> that conversation's message history in the order it happened**, so that **I can
> review what was exchanged with a customer without the screen failing or showing
> the conversation backwards**.

## Functional Requirements

- **FR-1 — History retrieval succeeds for every conversation.** Requesting the
  message history of a contact returns that conversation's messages. Success must
  not depend on which conversation is selected or on how many messages it happens
  to hold.
- **FR-2 — Partial results are delivered, never discarded.** When the underlying
  messaging integration cannot supply the full requested number of messages, the
  messages that *are* available are still returned and displayed. A partial
  result is a success outcome, not a failure.
- **FR-3 — A failure is explained, not hidden.** Whenever history is incomplete
  or cannot be retrieved, the administrator is shown a clear statement of what
  happened and what caused it. This is shown *together with* whatever messages
  were retrieved (per FR-2), and is expressed in terms an operator can act on —
  never a blank panel, never a bare "undefined", never only a generic message.
- **FR-4 — Conversations read in chronological order.** The displayed
  conversation runs oldest-first: the earliest message at the top, the most
  recent at the bottom, with displayed times increasing down the panel.
- **FR-5 — Displayed order matches the retrieved order.** The order shown to the
  administrator is the order the retrieval produced. The display must not impose a
  second, contradicting ordering of its own.
- **FR-6 — The newest message is in view on open.** After a conversation is
  opened, the panel is positioned at the most recent message.
- **FR-7 — One failing conversation does not disable the screen.** If a
  conversation cannot be retrieved, the contact list stays usable and other
  conversations can still be opened.
- **FR-8 — Existing successful behaviour is preserved.** Conversations that
  already retrieve successfully today continue to do so, returning no fewer
  messages than before, with unchanged message content, sender attribution, and
  media handling.

## Non-Functional Requirements

- **NFR-1 — Session safety.** Retrieval must not destabilise, disconnect, or
  restart the live messaging session it runs against; that session also carries
  production traffic.
- **NFR-2 — Bounded work.** A single history request must remain bounded in time
  and in the number of messages processed. No unbounded retry, no unbounded
  loading loop.
- **NFR-3 — Diagnosability.** A retrieval failure is recorded server-side with
  enough context to identify which connected number and which contact were
  involved, and what the underlying cause was.
- **NFR-4 — Confidentiality in logs.** Diagnostic records must not contain
  conversation content.
- **NFR-5 — Safe rendering.** Message content and any error text shown to the
  administrator must remain escaped, so that message text cannot alter the page.
- **NFR-6 — Reversibility.** The change must be small enough to revert cleanly
  and be individually verifiable.

## Constraints

- **C-1 — Scope is the dashboard's contacts screen and the single history
  endpoint it calls.** Other message-history endpoints in the system are
  explicitly untouched (see Out of Scope).
- **C-2 — Ordering is corrected in the presentation layer.** The order produced
  by retrieval is treated as authoritative; this ticket does not introduce
  server-side re-sorting. (Owner decision, `research.md` Q6.)
- **C-3 — The third-party messaging library is not modified.** It is vendored
  dependency code; the fix lives in this project's own code.
- **C-4 — No deployment runtime file is changed.** No acceptance criterion here
  requires one (CLAUDE.md hard-stop, GU-2).
- **C-5 — Verification is static.** No live messaging session is available to the
  verification gate, so every criterion below is written to be decidable by
  inspecting the delivered change and running the project's available checks. The
  owner will separately confirm real behaviour against a live session after
  closure; that manual confirmation is **not** a precondition of the gate. (Owner
  decision, `research.md` Q8.)
- **C-6 — Root cause is not assumed.** The likely cause identified during
  research is unconfirmed. The solution must satisfy FR-1/FR-2 without depending
  on that explanation being correct.

## Edge Cases

- A conversation holding fewer messages than the number requested.
- A conversation holding many more messages than the number requested.
- A conversation with no messages at all.
- A conversation that cannot be resolved for the connected number.
- The messaging integration failing part-way, after some messages are available.
- A conversation whose messages are all of non-text kinds (media, voice,
  location, contact cards, unsupported types).
- Group conversations and conversations addressed by a non-standard identifier
  form.
- A request arriving without the required identifiers, or without authorisation.
- Message or error text containing characters that would otherwise be interpreted
  as page markup.

## Open Questions

- **OQ-1 — The precise cause of the retrieval failure is unconfirmed.** Research
  established what is *not* the variable (every conversation was requested with
  the same message count and only one succeeded) but could not confirm the
  mechanism without a live session. C-6 requires the solution to be robust to this
  remaining uncertainty; it is therefore not a blocker for this specification.
- **OQ-2 — Whether the same latent defect affects the other history endpoints.**
  Deliberately left unanswered: those endpoints are out of scope by owner
  decision. If confirmed later, a separate ticket should cover them.

## Acceptance Criteria Mapping

> Give each criterion a stable ID (AC-1, AC-2, …); `verify.md` references these.

| ID    | Acceptance criterion | Maps to requirement |
|-------|----------------------|---------------------|
| AC-1  | Requesting a contact's message history no longer fails on the code path that produced the reported error; the delivered change removes the condition under which that request aborts instead of returning messages. | FR-1 |
| AC-2  | Retrieval success does not depend on how many messages a conversation already holds: a conversation holding fewer messages than requested is handled by the same successful path as one holding more. | FR-1, C-6 |
| AC-3  | When fewer messages than requested can be obtained, the available messages are returned to the dashboard rather than the whole request being turned into a failure. | FR-2 |
| AC-4  | When retrieval is incomplete or fails, the dashboard shows an explanatory message stating what happened and its cause, alongside any messages that were retrieved. | FR-3 |
| AC-5  | The failure path never leaves the message panel blank and never renders an absent value as literal text such as "undefined". | FR-3 |
| AC-6  | The conversation is displayed oldest-first: the earliest message renders at the top of the panel and the most recent at the bottom, with displayed times increasing downward. | FR-4 |
| AC-7  | The display applies no ordering transformation that contradicts the order retrieval produced; ordering is asserted in exactly one place. | FR-5 |
| AC-8  | After a conversation is opened, the panel is positioned so the most recent message is in view. | FR-6 |
| AC-9  | A conversation that fails to load leaves the contact list operable and other conversations openable; the failure is contained to that conversation. | FR-7 |
| AC-10 | Conversations that retrieve successfully today still do: message content, sender attribution, reply linkage, and media/voice handling are unchanged, and no fewer messages are returned than before. | FR-8 |
| AC-11 | Retrieval runs without destabilising, disconnecting, or restarting the live messaging session. | NFR-1 |
| AC-12 | A single history request remains bounded: no unbounded retry and no unbounded loading loop is introduced. | NFR-2 |
| AC-13 | A retrieval failure is recorded server-side identifying the connected number and the contact involved together with the underlying cause. | NFR-3 |
| AC-14 | No conversation content appears in diagnostic records. | NFR-4 |
| AC-15 | Message content and error text rendered to the administrator remain escaped. | NFR-5 |
| AC-16 | No deployment runtime file is modified, and no third-party dependency source is modified. | C-3, C-4 |
| AC-17 | The change is confined to the dashboard contacts screen and the single history endpoint that screen calls; the other message-history endpoints are byte-for-byte unchanged. | C-1, NFR-6 |
| AC-18 | Every changed source unit passes the project's available static checks. | C-5, NFR-6 |

## Out of Scope

- The two message-history endpoints that the contacts screen does not call; their
  latent exposure to the same defect is acknowledged and deliberately deferred
  (owner decision, `research.md` Q4).
- Any server-side re-ordering of retrieved messages (C-2).
- Modifying, upgrading, patching, or forking the third-party messaging library.
- Introducing a test framework or a test runner to the project.
- Sending messages, media upload, transcription behaviour, and contact-list
  retrieval — none are part of this defect.
- Redesign of the dashboard's appearance or layout beyond what AC-4..AC-8
  require.
- Any change to deployment runtime files or infrastructure.
- Confirming the root-cause hypothesis against a live session (OQ-1) and the
  owner's own post-closure manual testing (C-5).
