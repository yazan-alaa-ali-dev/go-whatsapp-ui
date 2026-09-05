---
ticket: 86eyhz68a
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-09
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Specification — 86eyhz68a

> What "done" means. **No implementation detail** — no file paths, no code, no
> approach. Those belong to `plan.md`.

## Business Goal

Debug mode is only useful if it can be switched on for the one conversation
under investigation. Today the diagnostic field can be stored and displayed but
never starts arriving, because nothing in the product speaks the activation
contract. Giving an admin a per-contact Enable/Disable control turns a designed
capability into an operable one, at the smallest possible blast radius: one
customer, for a bounded time, chosen from the screen where the problem is
visible.

## User Story

> As an ADMIN operating a tenant's conversations, I want to be able to turn
> `omni_agent`'s debug mode on or off for one specific contact with a button in
> the dashboard, so that I can diagnose a single conversation on demand, without
> touching any other customer and without leaving debug mode on forever.

## Functional Requirements

- **REQ-1** — An admin can turn debug mode on, and off, for a single contact of a
  WhatsApp number they are authorized for.
- **REQ-2** — Activation is expressed to `omni_agent` in the exact contract it
  already implements: a literal command string, the target customer's phone, and
  an optional TTL in minutes.
- **REQ-3** — The upstream call is authenticated with the credential belonging to
  the WhatsApp number that owns the targeted conversation, chosen by the system
  and never by the caller.
- **REQ-4** — Every result of the action — the resulting state and its expiry —
  is reported back to the operator as the outcome of that action.
- **REQ-5** — The product stores no debug state and no expiry: the flag and its
  lifetime are owned entirely by `omni_agent`.
- **REQ-6** — A request that cannot be made safely (plaintext channel, missing
  credential) is refused before anything leaves the process, with a reason the
  operator can act on.
- **REQ-7** — A failure upstream is reported as a failure, never as a success and
  never as an unhandled error.
- **REQ-8** — The use of the capability is auditable, and the credential is never
  observable.

## Non-Functional Requirements

- **NFR-1 — Confidentiality.** The credential exists in exactly one place in this
  feature: the outbound request header. It is absent from every response and
  every log line, at every level, in every environment.
- **NFR-2 — Least privilege.** Being able to see a conversation is the ceiling of
  what an operator may diagnose; nothing about this feature widens an existing
  authorization.
- **NFR-3 — Availability independence.** The control works while the WhatsApp
  session is disconnected; it is a control-plane action, not a session action.
- **NFR-4 — Boundedness.** A single operator action produces at most one upstream
  call, with a bounded wait.
- **NFR-5 — Honesty of the interface.** The screen never asserts a state the
  product does not know.

## Constraints

- The upstream contract is fixed and external; it may not be renegotiated here.
- No new credential and no credential-management surface may be introduced.
- No deployment runtime file may be modified, so nothing may *require* new
  deployment configuration.
- The disabled request-signing code stays where it is; re-enabling it is its own
  ticket.

## Acceptance Criteria

### Scope & Tenant Safety

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-1 | An admin can only toggle debug mode for a phone that is a contact of their own tenant's number; a phone outside that scope is refused. | REQ-1, NFR-2 |
| AC-2 | The credential sent upstream is always the one belonging to the WhatsApp number that owns the targeted conversation, never another number's. | REQ-3 |
| AC-3 | No Mongoose schema field is added, removed or retyped by this ticket. | Constraints |
| AC-4 | No deployment runtime file is modified. | Constraints |
| AC-5 | No change is made to the message persistence layer or to any existing webhook payload field. | Constraints |

### Authorization

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-6 | The toggle requires the same admin authorization as the other admin surfaces; an unauthorized call is refused and performs no upstream call. | REQ-1, NFR-2 |
| AC-7 | A caller authorized for tenant A cannot toggle debug mode for a contact of tenant B; the attempt is refused and makes no upstream call. | REQ-1, NFR-2 |
| AC-8 | The credential used upstream is never the caller's: it is selected server-side, and a caller cannot supply, override or influence which one is sent. | REQ-3, NFR-1 |
| AC-9 | No new anonymous surface is introduced. | NFR-2 |

### General Behavior — the toggle

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-10 | The toggle accepts the target phone, the desired state, and an optional TTL in minutes from the authenticated admin. | REQ-1 |
| AC-11 | It calls the agreed upstream endpoint with the agreed authentication header and a body of exactly the three agreed keys. | REQ-2 |
| AC-12 | The authentication header carries the targeted number's own credential. | REQ-3 |
| AC-13 | The command is the literal on/off command string — never a boolean, never enable/disable. | REQ-2 |
| AC-14 | The TTL is sent only when the caller supplied it, and is passed through unchanged; no default is invented. | REQ-2 |
| AC-15 | The upstream response (phone, enabled state, expiry) is returned to the caller unchanged in meaning. | REQ-4 |
| AC-16 | No debug state and no expiry is stored: when the TTL lapses the diagnostic field simply stops arriving. | REQ-5 |
| AC-17 | The request is rejected before any network call if the configured upstream URL is not `https://`. | REQ-6, NFR-1 |
| AC-18 | Toggling for a number with no credential configured returns a structured error naming the missing configuration, and performs no upstream call. | REQ-6 |
| AC-19 | An upstream error is surfaced as a structured error carrying its status — never as an unhandled error with a stack trace, and never as a silent success. | REQ-7 |
| AC-20 | An upstream timeout or connection failure is reported to the caller as a failure; the screen does not show the state as changed. | REQ-7, NFR-5 |

### General Behavior — the control in the UI

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-21 | The conversations screen renders Enable and Disable controls on the contact row, targeting that contact's phone. | REQ-1 |
| AC-22 | The controls are two explicit actions, not a two-state switch — the product does not know the current debug state. | NFR-5 |
| AC-23 | Activating a control sends that contact's phone; the operator never types a phone number to target it. | REQ-1, NFR-2 |
| AC-24 | After a successful call, the returned state and expiry are displayed for that contact as the result of this action, not as a persistent "debug is on" state. | REQ-4, NFR-5 |
| AC-25 | The displayed result is not cached across page loads, because there is no stored state to restore it from. | REQ-5, NFR-5 |
| AC-26 | When the number has no credential configured, the controls are shown as unavailable with the reason, rather than failing on click. | REQ-6, NFR-5 |
| AC-27 | An optional TTL can be supplied by the operator; leaving it empty sends no TTL at all. | REQ-2 |

### Validation & Constraints

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-28 | A missing or malformed phone, and any state value other than on/off, are rejected as a bad request — not as an unhandled error. | REQ-1 |
| AC-29 | A TTL that is not a positive integer is rejected before any upstream call. | REQ-2 |
| AC-30 | Every validation rule enforced by the screen is enforced identically by the API. | REQ-1 |

### UI & API Consistency

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-31 | The contact-row control and the API agree on the same target-phone rules and the same TTL rules. | REQ-1, REQ-2 |
| AC-32 | The settings modal is unchanged; no credential field is added anywhere in the UI. | Constraints |
| AC-33 | Existing routes keep their current contracts; this ticket adds one route. | Constraints |

### Audit & Logging

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-34 | The credential never appears in any log line, at any level, in any environment — including when it is used for this new call. | NFR-1 |
| AC-35 | The existing non-selection and response-stripping protections on the credential continue to apply, and the new surface exposes the value in no response. | NFR-1 |
| AC-36 | A rejected non-HTTPS attempt is logged with the tenant, the number and the reason, and without the credential. | REQ-8, NFR-1 |
| AC-37 | Every enable and disable is logged with the acting tenant, the WhatsApp number, the target phone and the action. | REQ-8 |
| AC-38 | The existing log lines around the agent webhook are audited so that the pattern of printing the webhook URL is not extended to credentials. | REQ-8, NFR-1 |

## Test Cases

| ID | Case | Covers |
|----|------|--------|
| TC-1 | Debug mode is enabled for one contact from the conversations screen, with a TTL of 120 minutes: the agreed endpoint receives the agreed header and body; the returned state and expiry are displayed; the log records tenant, number, phone and action and contains no credential. | AC-11..AC-15, AC-21, AC-24, AC-34, AC-37 |
| TC-2 | Disabling sends the literal off command for the same phone, with no TTL, and the result is displayed. | AC-13, AC-14, AC-24 |
| TC-3 | Omitting the TTL sends a body with the command and phone only; no default is supplied. | AC-14, AC-27 |
| TC-4 | Enabling for one contact does not affect another: only the first contact's phone is sent, and no request is made for the second. | AC-1, AC-23 |
| TC-5 | The diagnostic field starts arriving after enabling: the reply carries it, the stored record carries it, and the badge appears on that message. | AC-16 (integration with 2/4 and 3/4) |
| TC-6 | No state is stored or restored: after the TTL expires and the screen is reloaded, no "debug is on" indicator is shown, no stored flag is read, and messages that carried diagnostics still show their badge. | AC-16, AC-25 |
| TC-7 | A plaintext channel is refused before any network call; the response states the HTTPS requirement; the rejection is logged without the credential. | AC-17, AC-36 |
| TC-8 | A number with no credential fails cleanly: a structured error names the missing configuration, no request is sent, no unhandled error is produced. | AC-18, AC-26 |
| TC-9 | The credential is never exposed by the new surface, on success and on failure: no response body and no log line contains it. | AC-34, AC-35 |
| TC-10 | An upstream failure is not reported as success: a 500 and a timeout each produce a structured error carrying the status or the timeout, the screen does not display the state as changed, and no stack trace reaches the caller. | AC-19, AC-20 |
| TC-11 | A malformed request — missing phone, and a negative TTL — is rejected as a bad request with a structured error, and no upstream call is made in either case. | AC-28, AC-29, AC-30 |
| TC-12 | Another tenant's contact cannot be toggled, and an unauthenticated request is refused: both are refused with no upstream call, and the cross-tenant refusal is logged with the acting tenant. | AC-6, AC-7, AC-9 |

## Out of Scope

- Any new credential, and any credential-management UI.
- Re-enabling request signing for the webhook — the disabled code stays where it
  is; it is its own small ticket.
- Any change to webhook authentication itself.
- Any change to `omni_agent`.
- Storing the diagnostic field (ticket 2/4) and displaying it (ticket 3/4); both
  work whether or not this ticket has shipped.
- Enabling debug mode for a whole WhatsApp number (all of its customers) — that
  is a different upstream contract.
- A global feature switch for debug mode in production.
