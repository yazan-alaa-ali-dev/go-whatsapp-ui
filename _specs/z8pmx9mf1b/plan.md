---
ticket: z8pmx9mf1b
stage: plan
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1b"
  github: ""
---

# Plan — 11 · Add account settings and wrap the operational screens in the account

> **Revision 2.** Revision 1 went to the advisory panel before any code was
> written. The panel returned 35 findings across three lenses; every one is
> answered in **Panel response** below, and 14 of them changed this plan. Three
> lenses raised the same defect independently — a successful `PATCH` leaving the
> switch showing a stale value — which is the finding that most justifies the
> exercise.

## Approach

Three concerns share one ticket because they share one sentence — *the screens
must be honest about the account and about what you may do*. The panel cut a
fourth (`/messaging`) and a fifth (the participants panel) as scope creep; see
**Panel response**, S3 and S5.

### 1 · The SMS fallback switch

`setAccountSmsFallback` was typed in `z8pmx9mf16` and has had no caller since. A
third tab on `/accounts/:accountId` calls it.

**The card makes no query of its own.** `AccountDetail` already holds a mounted
`useAccounts()` observer, so it computes the state and passes it in as a prop.
That makes NFR-1 structurally true rather than incidentally true (panel P11).

**A successful write invalidates `accountsKey()`.** `useAccounts()` carries
`staleTime: 5 * 60_000`, so without it the switch reads the pre-toggle value out
of the cache and snaps back for five minutes while the write actually succeeded.
All three lenses found this; it was the plan's one outright bug.

Decisions in `src/lib/account-settings.ts`, pure and tested:

- `smsFallbackState(accounts, accountId): 'on' | 'off' | 'unknown'`. `unknown`
  covers a pending list, a refused one, and one that does not carry this
  account. It exists because the alternative — rendering `false` — is a switch
  that says *disarmed* about a value nobody read, on a screen whose whole
  subject is not claiming things the server did not say.
- `smsFallbackFailure(error): 'not-found' | 'permission' | 'unknown'`. `404` is
  the reference's byte-identical answer for "gone" and "not yours", so it maps to
  the existing `ADMIN_REJECTIONS['not-found']`, which already refuses to
  distinguish the two and hands back no tenant-enumeration oracle. `403` maps to
  `PERMISSION_DENIED` — **not** to `privilege-escalation`, which is
  user-administration copy about granting permissions and would invent a cause
  the wire never stated (panel SEC4).
- The copy is exported as constants (`SMS_FALLBACK_ARMED`, `SMS_FALLBACK_GATEWAY`,
  `SMS_FALLBACK_ORDER`, `SMS_FALLBACK_EFFECT`, `SMS_FALLBACK_CREDENTIALS`,
  `SMS_FALLBACK_EXCLUSIONS`) so AC-4..AC-9 are assertions in a test file rather
  than prose nobody can run.

There is **no payload builder**. Revision 1 justified one with a claim that was
simply false — `clean()` skips `undefined` and `''` and passes `false` through
untouched — and the body that actually goes on the wire is already built
literally inside `setAccountSmsFallback`, in a file an existing source rule
already forbids from importing `clean` at all. A helper asserting a value nothing
sends is worse than no helper (panel SEC2). `src/api/accounts.test.ts:272-288`
already asserts the boolean body for `true` and for `false`.

### 2 · The SMS channel on a send result

`SendResult` is shared by twelve send endpoints and only `/send/message` reports
a channel, so the field goes on a type of its own and `sendText` alone returns
it. Every other send form is untouched.

The mandatory rule — *read `channel` before you use `message_id`* — is made a
**compile error to break**, not a comment (panel SEC1):

```ts
export interface SendMessageWire extends SendResult { channel?: string }
export type SendMessageResult = Omit<SendMessageWire, 'message_id'>
```

`result.message_id` therefore does not compile anywhere outside
`src/lib/send-channel.ts`, which owns the single documented cast. `channel` is
typed `string` rather than a two-value union deliberately: the server owns that
enum, and typing it closed makes the third branch below unreachable to the type
checker while remaining perfectly reachable at runtime.

- `deliveryChannel(result): 'whatsapp' | 'sms' | 'unrecognised'` — **only** an
  absent field or the exact literal `'whatsapp'` answers `whatsapp`. Revision 1's
  `channel === 'sms' ? 'sms' : 'whatsapp'` failed *open*: a value this dashboard
  does not know would have handed a carrier reference back as a WhatsApp id.
- `usableMessageId(result): string | null` — non-`null` only for `whatsapp`, and
  never for a blank id.
- `carrierReference(result): string` — the identifier for a non-WhatsApp result,
  through `displayText(…, MAX_CARRIER_REFERENCE)`. It is gateway-supplied text
  landing in this app's own chrome beside a sentence about what happened to the
  message, so it is stripped of Unicode control and format characters and capped,
  exactly as `accountName` has been since `z8pmx9mf17` (panel SEC3).
- `shouldReadChatHistory(result): boolean` — true only for `whatsapp`.
- `sendToast(result): string` and `deliveryNotice(result): Notice | null`.

The success **toast** is channel-aware. Two lenses caught that a static
`'Message sent'` announces a WhatsApp send in the toast while the panel beneath
it explains the message was not one; `useActionMutation` already accepts
`successMessage: (data) => string`, so this costs no machinery.

Two surfaces read a text-send result and share
`src/components/shared/delivery-notice.tsx`:

- `src/features/chat/message-view.tsx` — the change is behavioural. The success
  handler currently invalidates `['chat-messages', jid]` unconditionally; for an
  SMS result that refetches a row that does not exist and the user watches their
  message fail to appear with no explanation. `shouldReadChatHistory` gates it.
  The mutation is `reset()` on submit so a notice cannot outlive its send (panel
  P9).
- `src/features/send/text-form.tsx` — the `ResultPanel` JSON dump stays for a
  WhatsApp send; a non-WhatsApp result renders the notice **instead** of it,
  because the dump's `message_id` line is exactly the value a user would paste
  into the "Act on a message" tab.

### 3 · The four hidden controls

Each boolean is read with `useHasPermission` **above** the component that renders
a list, and travels down as a prop.

| Control | Permission | Boolean read in | Rendered by |
|---|---|---|---|
| Chat composer | `messages.send` | `src/pages/chats.tsx` | `message-view.tsx` |
| Pin / archive / disappearing | `chats.write` | `src/pages/chats.tsx` | `message-view.tsx` → `chat-controls.tsx` |
| Media download | `messages.read` | `src/pages/chats.tsx` | `message-view.tsx` → `message-media.tsx` |
| Call rejection | `calls.reject` | `src/pages/misc.tsx` | `misc.tsx` |

`chats.tsx` is the right height: `MessageView` holds the composer draft in the
same component as the unmemoised rows, so a hook inside it re-runs on every
keystroke, and `MessageMedia` is per row. The three hooks sit **above**
`chats.tsx`'s `if (!device)` early return.

Media is **hidden, not removed**: without `messages.read` a message that carries
media still says so, as static text, and offers no download. `media_type` and
`file_length` are fields of a row the principal already received under
`chats.read`, so the label discloses nothing the server withheld — and the
message list is emphatically *not* guarded on `messages.read`, which is a
documented misnomer for *download media only*. The download query is gated at
`enabled`, not only at the button, so it cannot fire a request that would 403
(panel SEC9).

Two hot-path repairs the panel asked for while these files are open:

- **`MessageBubble` becomes `React.memo`.** `messages` is already `useMemo`'d, so
  each `message` identity is stable and `canDownload` is a boolean — the memo
  holds, and 30 rows stop re-rendering on every keystroke. This is the row
  treatment `source-policy.test.ts` already enforces for `account-device-row`
  and `user-row`.
- **`useAppInfo()` stops being called per row.** `message-media.tsx` calls it
  once per media-bearing message today — one query observer and one store
  subscription each, re-run on every keystroke. `base_path` is hoisted into
  `chats.tsx` beside the permission booleans and passed down.

### 4 · Honest empty states and the account chip

One pure addition to `src/lib/surfaces.ts`:

- `deviceEmptyReason(ownAccountId): 'no-account' | 'no-devices'`.

**It takes the own account and nothing else, and the account lens is not
imported anywhere.** Two lenses flagged that reading `useAccountStore` would need
an amendment to the existing "the account lens is imported only where the scope
is owned or applied" allowlist. The amendment is unnecessary, because the scope
cannot matter here: `dashboard.tsx` is reachable only through `home.tsx`'s
`device` arm — a principal holding neither accounts permission — for whom
`scopedDeviceFilter` answers `null` and the lens has no effect on the device list
at all. The account they are operating in is their own `account_id`, always. That
also collapses revision 1's second function, which the senior lens correctly
called two exported predicates for one rule.

The chip is **inlined in `dashboard.tsx`**, not a new shared component: one
mount, no second consumer, and its only decision already lives in `surfaces.ts`.
It renders the **raw account id and no name**, and it calls `useAccounts()` not
at all. Revision 1 mounted that hook here, which added a query observer that can
*never* resolve on this surface and falsified the invariant written in
`use-accounts.ts`'s own header — "the device surface, which never renders a
caller of this hook" — while listing that file as untouched. Showing the id is
not a compromise: it is exactly what study §14 `Q-4` says is available, and the
follow-up request for an `account_name` on `GET /auth/me` is recorded rather than
worked around.

`<CreateDeviceDialog />` is hidden when the reason is `no-account`. AC-23 says
the blank-`account_id` state offers no add-device action, and revision 1 changed
only the `EmptyState` — which already had no action — while leaving the create
control in the header above it (panel S8).

### 5 · Rules, not review discipline

Eight new rules in `src/lib/source-policy.test.ts`, in one `describe`, enumerated
in **Steps** below rather than left as a count (panel SEC6).

## Panel response

Findings are `S`n (senior), `SEC`n (security), `P`n (performance).

### Findings that changed the plan (14)

| # | Finding | Response |
|---|---|---|
| **SEC5 / S2 / P3** | Nothing invalidates `accountsKey()` after a successful `PATCH`; `staleTime` is five minutes, so the switch snaps back to the old value on a write that succeeded. | **Accepted.** The mutation invalidates `accountsKey()` on success. Three lenses found this independently; it was a real defect, not a style point. AC-10 is extended to state what the switch shows after an *accepted* write, which it previously left unspecified. (`accounts.tsx` carries no fallback badge — S2's second clause does not hold; `grep sms_fallback src/` finds only `api/`.) |
| **SEC1** | `usableMessageId` returning `null` is not enough: `result.message_id` still compiles, and `deliveryChannel` written the obvious way fails **open** on an unrecognised value, handing a carrier reference back as a WhatsApp id. | **Accepted, both halves.** `SendMessageResult` is `Omit<…, 'message_id'>`, so reading the id outside `send-channel.ts` is a compile error; and only an absent field or the exact `'whatsapp'` yields a usable id — `unrecognised` is a third state that fails safe. This is the finding that changed the design most: the first version was correct for the two values the reference lists today and wrong for the first one it adds. |
| **SEC2** | The justification for `smsFallbackPayload` is factually wrong — `clean()` passes `false` through — and the payload it asserts is not the payload that is sent. | **Accepted.** The helper is deleted and the false claim removed. `src/api/accounts.ts` builds the body literally, an existing rule already forbids that file from naming a payload cleaner, and `accounts.test.ts:272-288` already asserts the boolean for both values. A rule asserting a value nothing sends invites someone to relax the real guard later. |
| **SEC3** | The carrier reference reaches a rendered node uncapped and unstripped; `IdText` applies neither. | **Accepted.** `carrierReference()` runs it through `displayText`, it is rendered as a text child only, and a source rule holds it there. |
| **SEC4** | `privilege-escalation` renders user-administration copy on a screen about an account setting. | **Accepted.** `403` maps to `PERMISSION_DENIED`; `404 → not-found` is kept exactly as planned, which the lens confirmed hands back no enumeration oracle. |
| **SEC7 / P6 / S9** | The chip's `useAccounts()` is provably dead on the only surface it mounts, contradicts NFR-1, and falsifies `use-accounts.ts`'s header while that file is listed as untouched. | **Accepted, and further.** The chip makes no query at all and is inlined in `dashboard.tsx` rather than added to `components/shared/` for one caller. The raw id is the whole chip. |
| **S1 / P7** | The chip needs the account lens, which trips the existing import allowlist that the plan never proposed to amend. | **Accepted, by removing the need.** `deviceEmptyReason` takes the own account only; no file imports `stores/account`; the allowlist is untouched. An unplanned exemption added at implement time is precisely what the `z8pmx9mf1a` entry in that file warns against. |
| **S3 / S4 / S6 / SEC8 / P4** | Gating `/messaging` is scope creep, `operational-controls.ts` exists only to serve it, and it would leave the sidebar entry pointing at a page that refuses the principal — requiring `navigation.ts`, which is on the untouched list. | **Accepted; deferred.** `/messaging`, `operational-controls.ts` and its test are removed. Revision 1 flagged this as the one place it exceeded the ACs and asked to be pushed back on; three lenses pushed back. The entry/route drift argument is decisive on its own — a gate that needs `navigation.ts` to move with it is a different ticket. Recorded as a follow-up below. |
| **S5** | The `groups.write` gate on the participants panel contradicts this spec's own Out of scope and half-gates the sheet: seven sibling forms need the same permission and stay open. | **Accepted.** Dropped. AC-20 is a *negative* constraint — no permission hook and no `<Can>` inside either list component — and is satisfied today; a source rule asserts it, which is what keeps it true. I had written the gate to stop AC-20's participants clause reading as vacuous; half-gating a sheet is a worse answer than asserting the negative. |
| **S8** | `<CreateDeviceDialog />` stays mounted above the `no-account` empty state, so AC-23 passes on the empty state and fails on the screen. | **Accepted.** The create control is hidden for `no-account`. |
| **S10 / P8** | Both surfaces toast `'Message sent'` unconditionally, announcing a WhatsApp send for an SMS result. | **Accepted.** `sendToast(result)` through the existing `(data) => string` form. |
| **S7** | `deviceEmptyReason` is derivable from `effectiveAccountId` — two functions and two test blocks for one predicate. | **Accepted.** One function remains, and the S1/P7 answer above removed the other's only caller anyway. |
| **P1** | `MessageBubble` is unmemoised, so 30 rows re-render on every keystroke; the plan touches this exact file while declining the row treatment enforced elsewhere. | **Accepted.** `React.memo`. `messages` is already `useMemo`'d, so the identities are stable and the memo holds. |
| **P2** | `message-media.tsx` calls `useAppInfo()` per row — one observer and one subscription per media message, re-run per keystroke — and `canDownload` does not remove it, because hooks run before an early return. | **Accepted.** `base_path` is hoisted into `chats.tsx` and passed down. The same argument the plan already accepted for the permission booleans, one prop wider. |

### Findings accepted as written into the plan (5)

| # | Finding | Response |
|---|---|---|
| **SEC6** | No planned rule asserts the chip's own safety, and two of the six rules were unnamed. | **Accepted.** Eight rules, all enumerated in Steps. The chip's rule is now *renders the raw id and resolves no name* — stronger than the original suggestion, because with no name there is nothing to sanitise. |
| **SEC9** | `MessageMedia` must not reach `open === true` without `canDownload`, or the query fires a request that will 403. | **Accepted.** Gated at `enabled`, and an early return before it. |
| **SEC10** | AC-15 is satisfied by the notice's wording rather than by construction, and "Modified (11)" listed 14 rows. | **Accepted.** The "not a WhatsApp message id / works with no message endpoint" sentence is kept whole and adjacent to the reference; the file list is corrected and counted. |
| **P9** | `mutation.data` outlives its send, so an SMS notice persists through the next submit — misleading in the chat pane. | **Accepted.** `reset()` on submit. |
| **S11** | The three `useHasPermission` calls must sit above `chats.tsx`'s `if (!device)` early return. | **Accepted.** Written into step 8 so it is not discovered by a lint failure. |

### Findings made moot by another change (4)

`SEC8` and `P4` (the `/messaging` action list and its initial selection) fall with
`S3`. `P5` (the participants panel's residual per-keystroke cost) falls with
`S5`. `S9`'s placement question is answered by inlining the chip.

### Findings recorded, no change (5)

| # | Finding | Response |
|---|---|---|
| **SEC** (media) | The static media label leaks nothing, and not guarding the message list on `messages.read` is correct. | Confirmation of the design; no change. |
| **P10** | The conditional invalidation is correct and a small net saving — an absent `channel` still invalidates, and the skip removes a prefix invalidation that marked every cached variant stale for a row never written. | Recorded in `verify.md` as evidence for AC-14. |
| **P11** | The third tab adds no request; prefer passing the state into the card as a prop, and do not add `forceMount`. | The prop is adopted (see §1); no `forceMount`. |
| **P12** | Hoisting `groups.write` into the sheet would have been the correct height and cost nothing. | Noted — the gate is dropped on `S5`'s correctness grounds, not on cost. |
| **P13** | The additions to `surfaces.ts` cost nothing, and "the existing assertions pass unchanged" is the right evidence. | Kept in the validation strategy. |
| **S12** | The ticket bundles several outcomes against "one ticket = one focused outcome". | Recorded, not acted on. It is one ClickUp ticket and one reviewable unit; with `S3` and `S5` accepted it is down to three concerns and 17 files, and splitting a ticket the owner defined is a governance decision rather than a plan decision. |

### Follow-up requests recorded by this ticket

1. **To the backend team (study §14, `Q-4`):** an `account_name` field on
   `GET /auth/me`. A principal without `accounts.manage` cannot call
   `GET /accounts`, so the account chip on the device surface can only show a raw
   id. No name is invented in its place. (AC-28.)
2. **To the backlog (panel `S3`):** a ticket gating `/messaging` on
   `messages.send` / `messages.mark`, moving `navigation.ts`'s
   `SURFACE_PERMISSIONS` and the route guard together with it. The seeded `user`
   role is offered a compose surface that every submit will refuse; that is real,
   and it is not this ticket.

## Steps

1. `src/lib/account-settings.ts` + `.test.ts` — state read, failure classifier,
   six copy constants.
2. `src/lib/send-channel.ts` + `.test.ts` — `deliveryChannel`, `usableMessageId`,
   `carrierReference`, `shouldReadChatHistory`, `sendToast`, `deliveryNotice`.
3. `src/lib/surfaces.ts` — `deviceEmptyReason`; tests appended to
   `src/lib/surfaces.test.ts`.
4. `src/api/send.ts` — `SendMessageWire`, `SendMessageResult`, `sendText`'s type.
5. `src/features/account-settings/sms-fallback-card.tsx` — the tab body; takes
   the state as a prop, owns the mutation, invalidates `accountsKey()`.
6. `src/pages/account-detail.tsx` — the third tab, state computed from the list
   it already holds.
7. `src/components/shared/delivery-notice.tsx` — the non-WhatsApp outcome.
8. `src/pages/chats.tsx` — three permission booleans and `base_path`, all hoisted
   **above** the `if (!device)` early return.
9. `src/features/chat/message-view.tsx` — four props; composer and controls
   gated; `React.memo` on `MessageBubble`; conditional invalidation; `reset()` on
   submit; channel-aware toast; the notice.
10. `src/features/chat/message-media.tsx` — `canDownload` and `basePath` props;
    `useAppInfo` removed; query gated at `enabled`; static label when absent.
11. `src/features/send/text-form.tsx` — the notice in place of the dump for a
    non-WhatsApp result; channel-aware toast.
12. `src/pages/misc.tsx` — `calls.reject`.
13. `src/pages/dashboard.tsx` — the inlined chip, the two empty states, the
    create control hidden for `no-account`.
14. `src/lib/source-policy.test.ts` — one `describe` with eight rules:
    1. neither list component opens a permission subscription (`message-view`,
       `message-media`, `chat-controls`, `chat-list`, `participants-panel`);
    2. `message_id` and `channel` of a send result are read only in
       `src/lib/send-channel.ts`;
    3. the carrier reference reaches a rendered node only through
       `carrierReference` / `displayText`;
    4. the four gated controls sit behind a hoisted boolean and none is rendered
       with a permission-driven `disabled`;
    5. the settings card names no payload-cleaning helper and passes a boolean;
    6. the settings card invalidates `accountsKey()` on success;
    7. the device surface's chip renders the raw id and resolves no account name;
    8. the device surface branches on `deviceEmptyReason` and mounts no create
       control for `no-account`.
15. `implement.md`, `verify.md`, `ticket.md`.

## Files to change

### Added (6)

| Path | What |
|---|---|
| `src/lib/account-settings.ts` | SMS fallback state, failure classifier, copy. |
| `src/lib/account-settings.test.ts` | Their tests. |
| `src/lib/send-channel.ts` | The channel decisions and the notices. |
| `src/lib/send-channel.test.ts` | Their tests. |
| `src/features/account-settings/sms-fallback-card.tsx` | The settings tab body. |
| `src/components/shared/delivery-notice.tsx` | The send outcome, by channel. |

### Modified (11)

| Path | Change |
|---|---|
| `src/api/send.ts` | `SendMessageWire` / `SendMessageResult`; `sendText`'s return type. |
| `src/lib/surfaces.ts` | `deviceEmptyReason`. |
| `src/lib/surfaces.test.ts` | Its tests. |
| `src/lib/source-policy.test.ts` | Eight new rules in one `describe`. |
| `src/pages/account-detail.tsx` | The Settings tab. |
| `src/pages/chats.tsx` | Three permission booleans and `base_path`, hoisted. |
| `src/features/chat/message-view.tsx` | Props, gating, `React.memo`, conditional invalidation, toast, notice. |
| `src/features/chat/message-media.tsx` | `canDownload` / `basePath` props; no hook. |
| `src/features/send/text-form.tsx` | Notice and toast by channel. |
| `src/pages/misc.tsx` | `calls.reject`. |
| `src/pages/dashboard.tsx` | The chip, the two empty states, the gated create control. |

**17 files: 6 added, 11 modified.**

### Not touched

`src/api/accounts.ts` (already correct — it builds the boolean body literally),
`src/lib/permissions.ts`, `src/hooks/use-permissions.ts`, `src/hooks/use-accounts.ts`,
`src/components/shared/can.tsx`, `src/lib/auth-messages.ts`,
`src/components/layout/account-context-bar.tsx`,
`src/components/layout/navigation.ts`, `src/stores/account.ts`,
`src/features/group/participants-panel.tsx`, `src/pages/messaging.tsx`,
`src/features/chat/chat-controls.tsx`, `src/App.tsx`, and every deployment
runtime file.

## Validation strategy

- `npm run typecheck` — `tsc -b`. The `Omit` on `SendMessageResult` is checked
  here: any file that reads `message_id` off a text send fails to compile.
- `npm test` — the new files plus the whole existing suite.
  `surfaces.test.ts`'s and `accounts.test.ts`'s existing assertions must pass
  **unchanged**, which is the evidence that neither module's behaviour moved.
- `npm run lint`.
- `npm run build` — the single-file bundle.
- `git status` — no deployment runtime file.

## Rollback

Every change is additive or a guard around existing JSX. `git revert` of the
single publishable commit restores the previous behaviour exactly: the composer,
the controls, the media button and the call form return unconditionally, the
settings tab disappears, and `sendText`'s return type widens back. No stored
state, no migration, no persisted key changes, no query key added or removed.

## Out of scope

Everything in `spec.md > Out of scope`, plus, on the panel's advice: gating
`/messaging`, gating any part of the group detail sheet, and any change to
`use-accounts.ts`, `navigation.ts` or the account lens allowlist.
