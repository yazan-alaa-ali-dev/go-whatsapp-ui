---
ticket: z8pmx9mf1b
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1b"
  github: ""
---

# Specification — 11 · Add account settings and wrap the operational screens in the account

## Business goal

Phase 2 built an account layer and left the screens that predate it untouched.
The result is a dashboard that is *correct on the wire and dishonest on screen*:
an ordinary user is offered a composer that every submit will 403, a message that
left over SMS is reported as a WhatsApp message with a WhatsApp id, and a user
who belongs to no account is told they have no devices yet.

This ticket closes the phase by making the existing screens tell the truth about
two things — **which account you are working in**, and **what you are allowed to
do** — and by adding the one account setting the backend exposes.

## User story

As **a user of any role**,
I want **the screens I already use to be honest about the account I am working in
and about what I am allowed to do**,
so that **I am never offered a control that will be refused, and never told a
message was sent on WhatsApp when it left over SMS**.

## Functional requirements

### The SMS fallback switch

- **REQ-1** — The account detail screen carries a **Settings** tab beside the
  existing Devices and Users tabs.
- **REQ-2** — The tab reads the account's current `sms_fallback_enabled` from
  `GET /accounts` and writes it with `PATCH /accounts/{account_id}/sms-fallback`.
- **REQ-3** — The request body carries `sms_fallback_enabled` as a **real JSON
  boolean**. A string, a number or an omitted field is a `400` and nothing is
  written, so no code path may produce one.
- **REQ-4** — While the current value is not known — the account list is pending,
  refused, or does not contain this account — the switch reports *unknown* and is
  not operable. It never renders `false` for an unread value.
- **REQ-5** — The copy states that the switch **arms the account** and that
  delivery additionally requires the deployment's SMS gateway. It never states or
  implies that SMS messages will be delivered.
- **REQ-6** — The copy states that arming an account whose gateway is
  unconfigured is **allowed and is not an error**, and that this screen cannot
  report the deployment's configuration because the response deliberately does
  not carry it.
- **REQ-7** — The copy states what the fallback does **not** cover: media,
  stickers, contacts, locations and polls have no SMS equivalent and are never
  re-sent; a group recipient and a recipient that resolves to no dialable E.164
  number get no SMS; at most one SMS per failed message, and the gateway is never
  retried.
- **REQ-8** — The copy states that the fallback is the **last stage, never the
  first**, and that it never runs for a failure that occurred **while** sending —
  one undelivered message is preferred over the same text arriving twice.
- **REQ-9** — The copy states that the call is idempotent, takes effect on the
  next send attempt, and needs no restart and no re-pairing.
- **REQ-10** — No gateway credential (URL, key, sender id) is entered on this
  screen, and the screen says they come from the deployment environment only.
- **REQ-11** — A refused write leaves the switch showing the server's value and
  reports the refusal. A `404` — which is also the answer for an account
  belonging to another tenant — is reported as the existing "not found" notice
  and never as "you do not have permission"; a `403` is reported as the existing
  permission notice and never as the user-administration copy about granting
  permissions, which would invent a cause the wire never stated.
- **REQ-11a** — An **accepted** write leaves the switch showing the value the
  server accepted. The account list it reads from is cached for five minutes, so
  a successful write must invalidate that entry; otherwise the switch reverts to
  the pre-toggle value on a write that succeeded.

### SMS-channel send results

- **REQ-12** — `POST /send/message` is the only send endpoint that reports a
  channel. Its response type carries `channel?: 'whatsapp' | 'sms'`; every other
  `/send/*` response is unchanged.
- **REQ-13** — Every reader of a text-send result determines the channel
  **before** it uses `message_id`. Reading the id without having read the channel
  must not be expressible at the call sites — it is a compile error, not a
  convention.
- **REQ-13a** — The channel decision **fails safe**. Only an absent field or the
  exact literal `whatsapp` yields a usable WhatsApp message id; a value this
  dashboard does not recognise is treated as *not WhatsApp*, because the
  alternative hands a foreign reference back as a WhatsApp id the first time the
  server adds a third channel.
- **REQ-14** — When the channel is not `whatsapp` the result is presented as a
  different channel: the identifier is labelled a **carrier reference**, an empty
  value is a normal outcome rather than an error, and the screen states that it
  is not a WhatsApp message id and cannot be used with any message endpoint.
- **REQ-14a** — The carrier reference is gateway-supplied text rendered inside
  this app's own chrome, beside a sentence about what happened to a message, so
  it passes through `displayText` — stripped of Unicode control and format
  characters, and capped — and is rendered as a text child only.
- **REQ-14b** — The success **notification** names the channel. A static
  "Message sent" announces a WhatsApp send for a message that was not one, while
  the panel beneath it explains the opposite.
- **REQ-15** — An SMS result triggers no read of the chat history: the send did
  not write a WhatsApp message row, so the UI neither invalidates nor polls for
  it, and says why the message will not appear in the conversation.
- **REQ-16** — No reply, reaction, forward or revoke is offered against an SMS
  result.

### Permission-driven operational controls

- **REQ-17** — The chat composer is absent without `messages.send`.
- **REQ-18** — The pin, archive and disappearing controls are absent without
  `chats.write`.
- **REQ-19** — Downloading a message's media is gated on `messages.read` — which
  grants *downloading media only*. Reading the messages themselves comes with
  `chats.read`, so no message list may be guarded with it.
- **REQ-20** — Call rejection is absent without `calls.reject`.
- **REQ-21** — Every permission boolean is read **once, above** the message list,
  and reaches the rows as a prop. No permission hook and no `<Can>` is
  instantiated per row, in the message list or in the participant list. The
  participant list is named because it renders its full list with no windowing;
  the constraint on it is **negative** — no guard may be placed inside it — and
  is satisfied by asserting that, not by adding a guard there (see Out of scope).
- **REQ-22** — Absence **hides** a control. Nothing is rendered disabled, and no
  copy announces a capability the principal does not hold.
- **REQ-22a** — A control that is hidden must also stop its request. A guard that
  hides a download button while leaving its query enabled manufactures the `403`
  the guard existed to spare the user.

### Honest empty states and the account chip

- **REQ-23** — "This account owns no devices" and "your user belongs to no
  account" are two different messages on the device surface.
- **REQ-24** — A blank `account_id` means the user **owns nothing** — never
  "every account" — so its message points at an administrator and offers no
  "add a device" action.
- **REQ-25** — The device surface carries a chip naming the account being
  operated in, and offers no add-device action anywhere on the screen when the
  user belongs to no account.
- **REQ-26** — A principal without `accounts.manage` cannot call `GET /accounts`
  and therefore cannot resolve an id into a name. The device surface is reachable
  only by such a principal, so the chip shows the **raw id**, resolves no name,
  and issues no request to try.

### Traceable decisions and tests

- **REQ-27** — Every decision above that can be stated as a value lives in a pure
  module under `src/lib/` with an adjacent Vitest file. This repository has no
  component renderer, so a decision embedded in JSX is a decision nobody can
  assert.
- **REQ-28** — The placement rules (REQ-21, REQ-13, REQ-3) are enforced as
  runnable rules in `src/lib/source-policy.test.ts`, not as review discipline.

## Non-functional requirements

- **NFR-1** — No new endpoint is called and no request is added to any screen
  that did not already make one. The settings tab reads the account list the
  detail screen has already loaded.
- **NFR-2** — No permission check is added inside a component that re-renders per
  keystroke or per row (`message-view.tsx` holds the composer draft in the same
  component as the unmemoised rows; `participants-panel.tsx` renders its full
  list with no windowing).
- **NFR-3** — No role name is read anywhere, for any decision (reference §04).
- **NFR-4** — No server-supplied text is rendered as HTML; operator-controlled
  text rendered inside this app's own chrome passes through `displayText`.
- **NFR-5** — No deployment runtime file is modified.

## Constraints

- `GET /accounts` requires `accounts.manage`; `useAccounts()` is already gated on
  it and returns `undefined` for everybody else. Nothing in this ticket may
  become unavailable because of that — the chip and the empty states must work
  for a principal who can never load an account name.
- There is no `GET /accounts/{id}`, so the settings tab reads the list
  (study §14, `Q-5`).
- Hiding a control is an affordance, never enforcement. The server guards every
  route with `Require(permission)`; what this ticket buys is that a user is not
  offered a button that would be refused.

## Acceptance criteria

| ID | Criterion | Requirement |
|---|---|---|
| **AC-1** | The account detail screen has a Settings tab that shows the account's current `sms_fallback_enabled`, read from `GET /accounts`. | REQ-1, REQ-2 |
| **AC-2** | Toggling it issues `PATCH /accounts/{account_id}/sms-fallback` with `sms_fallback_enabled` as a JSON boolean — never a string, a number, or an omitted field. | REQ-3 |
| **AC-3** | Before the value is known the switch is not operable and does not display `false`. | REQ-4 |
| **AC-4** | The copy says the account is armed and that it takes effect once the deployment's SMS gateway is configured. It makes no promise of delivery. | REQ-5 |
| **AC-5** | The copy says arming an account whose gateway is unconfigured is allowed and is not an error, and that this screen cannot report the deployment's configuration. | REQ-6 |
| **AC-6** | The copy states every exclusion: media, stickers, contacts, locations and polls; group recipients; recipients with no dialable number; one SMS maximum per failed message; no gateway retry. | REQ-7 |
| **AC-7** | The copy states that the fallback is the last stage, never the first, and never runs for a failure that occurred while sending. | REQ-8 |
| **AC-8** | The copy states that the call is idempotent, takes effect on the next send attempt, and needs no restart and no re-pairing. | REQ-9 |
| **AC-9** | No gateway credential field exists on the screen, and the copy says credentials come from the deployment environment only. | REQ-10 |
| **AC-10** | A refused toggle reports the refusal and leaves the displayed value equal to the server's; a `404` is reported as "not found" and a `403` as the permission notice, never as user-administration copy. | REQ-11 |
| **AC-10a** | An accepted toggle invalidates the cached account list, so the switch shows the value the server accepted rather than reverting to the pre-toggle one. | REQ-11a |
| **AC-11** | `POST /send/message` has its own response type carrying `channel`; no other send response changes. | REQ-12 |
| **AC-12** | Reading `message_id` off a text-send result outside the channel decision module does not compile; the id is obtained only from a decision that took the channel into account. | REQ-13 |
| **AC-12a** | Only an absent `channel` or the exact literal `whatsapp` yields a usable WhatsApp message id; any other value is treated as not-WhatsApp. | REQ-13a |
| **AC-13** | A non-WhatsApp result is labelled by its channel, its identifier is labelled a carrier reference, and an empty identifier renders without an error. | REQ-14 |
| **AC-13a** | The carrier reference is stripped of Unicode control and format characters, capped, and rendered as a text child only. | REQ-14a |
| **AC-13b** | The success notification names the channel that delivered the message. | REQ-14b |
| **AC-14** | A non-WhatsApp result invalidates and polls no chat-message query, and the screen says the message will not appear in the conversation. | REQ-15 |
| **AC-15** | No reply, reaction, forward or revoke action is offered against a non-WhatsApp result, and its notice does not outlive the send it describes. | REQ-16 |
| **AC-16** | Without `messages.send` the chat composer is absent from the tree. | REQ-17 |
| **AC-17** | Without `chats.write` the pin, archive and disappearing controls are absent from the tree. | REQ-18 |
| **AC-18** | Without `messages.read` the media download control is absent; the message list itself is not guarded on it. | REQ-19 |
| **AC-19** | Without `calls.reject` the call rejection surface is absent. | REQ-20 |
| **AC-20** | Each permission boolean is read once above the message list and passed down as a prop; no permission hook and no `<Can>` appears inside the message list's or the participant list's component. | REQ-21 |
| **AC-21** | No control in this ticket is rendered disabled in place of hidden. | REQ-22 |
| **AC-21a** | The media download query is disabled without the permission, so hiding the button fires no request that would be refused. | REQ-22a |
| **AC-22** | The device surface distinguishes "this account owns no devices" from "your user belongs to no account". | REQ-23 |
| **AC-23** | The blank-`account_id` state points at an administrator and offers no add-device action anywhere on the screen, the page header included. | REQ-24 |
| **AC-24** | The device surface shows a chip naming the account being operated in, and shows nothing when there is no account. | REQ-25 |
| **AC-25** | The chip shows the raw account id, invents no name, and issues no request to resolve one. | REQ-26 |
| **AC-26** | Every new decision is a pure function under `src/lib/` with an adjacent test asserting it. | REQ-27 |
| **AC-27** | `src/lib/source-policy.test.ts` fails the build if a permission hook appears inside the message list or the participant list, if a text-send result reads `message_id` without the channel decision, or if the fallback payload is built from anything but a boolean. | REQ-28 |
| **AC-28** | The follow-up request to the backend team — an account name on `GET /auth/me` (study §14, `Q-4`) — is recorded in this ticket rather than worked around by faking a name. | REQ-26 |
| **AC-29** | No role name is read for any decision added by this ticket. | NFR-3 |
| **AC-30** | No deployment runtime file (`vite.config.ts`, `package.json`, `index.html`, `.github/workflows/*`) is modified. | NFR-5 |

## Test cases

| ID | Case | Covers |
|---|---|---|
| **TC-1** | The existing `src/api/accounts.test.ts` assertions that the request body is `{ sms_fallback_enabled: <boolean> }` for `true` and for `false` pass unchanged, and the source rule below keeps the module free of any payload cleaner. | AC-2 |
| **TC-2** | An account list that is pending, refused, or does not contain the id yields the *unknown* state and never `off`. | AC-3 |
| **TC-3** | The armed copy is asserted to name the gateway condition and to contain no promise of delivery. | AC-4, AC-5 |
| **TC-4** | The exclusion copy is asserted to name every excluded kind, the group recipient, the undialable recipient, the one-SMS cap and the absence of retry. | AC-6 |
| **TC-5** | A `404` from the toggle classifies as `not-found`; a `403` as `permission`; every other status as `unknown`, so nothing is invented. | AC-10 |
| **TC-6** | `deliveryChannel` answers `whatsapp` for an absent field and for `whatsapp`, `sms` for `sms`, and `unrecognised` for any other value. | AC-12, AC-12a |
| **TC-7** | `usableMessageId` answers `null` for `sms` and for `unrecognised` whatever the id, `null` for an empty or whitespace id, and the id otherwise. | AC-12, AC-12a |
| **TC-8** | `carrierReference` returns the empty string for a WhatsApp result, strips a bidi override from a carrier reference, caps a long one, and answers the empty string for an absent id — so an empty `message_id` renders with no error path. | AC-13, AC-13a |
| **TC-9** | `sendToast` and `deliveryNotice` name the channel: no notice for WhatsApp, an SMS notice stating the id is a carrier reference that works with no message endpoint, and a distinct notice for an unrecognised channel. | AC-13, AC-13b, AC-15 |
| **TC-10** | `shouldReadChatHistory` is true only for a WhatsApp result. | AC-14 |
| **TC-11** | Source rule: the message list, the media component, the chat controls, the chat list and the participants panel contain no `useHasPermission`, no `usePermissions` and no `<Can>`. | AC-20, AC-27 |
| **TC-12** | Source rule: `message_id` and `channel` of a send result are named only in `src/api/send.ts` and `src/lib/send-channel.ts`; `tsc` proves the rest, since the exposed type omits the field. | AC-12, AC-27 |
| **TC-13** | Source rule: the composer, the chat controls, the media download and the call rejection each sit behind a hoisted boolean named for their permission, and none is rendered with a permission-driven `disabled`. | AC-16..AC-19, AC-21 |
| **TC-14** | Source rule: the settings card names no payload-cleaning helper and invalidates `accountsKey()` on success; the carrier reference reaches a rendered node only through `carrierReference`. | AC-2, AC-10a, AC-13a, AC-27 |
| **TC-15** | `deviceEmptyReason` answers `no-account` for a blank, whitespace-only, `null` or `undefined` own account, and `no-devices` for any real id. | AC-22, AC-23 |
| **TC-16** | Source rule: the device surface renders the raw account id, calls no `accountName` and imports no account-list hook, branches on `deviceEmptyReason`, and mounts no create control for `no-account`. | AC-23, AC-24, AC-25, AC-27 |
| **TC-17** | `npm run typecheck`, `npm test`, `npm run lint` and `npm run build` are green, and `git status` shows no deployment runtime file changed. | AC-30 |

## Out of scope

- The diagnostics panel, voice-note transcripts, the message origin badge, the
  Chatwoot integration, and the debug and retention toggles. Those are
  message-display features unrelated to the account layer and belong to a later
  phase (the ticket says so).
- Editing an account's name — there is no endpoint (study §14, `Q-5`).
- Any change to `GET /accounts`' own gating, to the account switcher, or to the
  account context bar. The chip added here answers a different question ("which
  account am I in") from the bar ("you are in somebody else's account"), and the
  bar stays exactly as `z8pmx9mf17` built it.
- Adding an `account_id` filter or a total to `GET /auth/users`. Recorded as
  `Q-3` and unchanged.
- Gating the newsletter surface, the groups surface or the profile surface. Only
  the four controls the ticket names are gated.
- **Gating the standalone `/messaging` surface.** Revision 1 of the plan proposed
  it and the advisory panel rejected it as scope creep, on the decisive ground
  that such a gate must move `navigation.ts`'s `SURFACE_PERMISSIONS` and the
  route guard with it — a sidebar entry pointing at a page that refuses the
  principal is the exact entry/route drift that file was written to prevent.
  Recorded as a follow-up ticket in `plan.md > Follow-up requests`.
- **Gating the group detail sheet's participant actions.** Also proposed in
  revision 1 and rejected: seven sibling forms in the same sheet need the same
  `groups.write`, so gating one of the eight is a half-truth. AC-20's constraint
  on that panel is negative — no guard may be placed inside it — and is met by
  asserting that.
