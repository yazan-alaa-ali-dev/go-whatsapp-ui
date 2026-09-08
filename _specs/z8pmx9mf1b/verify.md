---
ticket: z8pmx9mf1b
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1b"
  github: ""
---

# Verification — 11 · Add account settings and wrap the operational screens in the account

**Outcome: PASSED.** Every acceptance criterion is mapped to an executed result
below (`all-ac`). Verification is read-only: no implementation file was modified
and no commit was created here.

## Commands

```
npm run typecheck   ✓  tsc -b, no errors
npm test            ✓  34 files, 636 tests (baseline 583 — 53 added)
npm run lint        ✓  4 warnings, all pre-existing in components/ui + hooks
npm run build       ✓  dist/index.html 1,111.06 kB · gzip 441.28 kB
```

`tsc -b` is evidence rather than hygiene on this ticket: `SendMessageResult`
omits `message_id`, so a green typecheck **is** the proof of AC-12.

## Runtime-impact statement

**No deployment runtime file changed.** `git status` lists 17 paths, none of them
`vite.config.ts`, `package.json`, `index.html` or `.github/workflows/*`. The
build emits the single `dist/index.html` the release contract requires.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| **AC-1** | PASS | `account-detail.tsx` renders a third `TabsTrigger`/`TabsContent` pair holding `SmsFallbackCard`, with `state={smsFallbackState(accounts, accountId)}` computed from the `useAccounts()` list the page already holds. `smsFallbackState` tested in `account-settings.test.ts`. |
| **AC-2** | PASS | `setAccountSmsFallback(accountId, enabled: boolean)` writes `{ sms_fallback_enabled: enabled }` literally; `accounts.test.ts` asserts the sent body for `true` **and** for `false`; the source rule *"the fallback body is a boolean, and no cleaner is named anywhere near it"* asserts the signature and that the card names no payload cleaner. |
| **AC-3** | PASS | `smsFallbackState` answers `unknown` for a pending list, an empty one, one lacking the account, and a non-boolean field (4 assertions). The card renders `disabled={!known \|\| toggle.isPending}` and a sentence saying the value could not be read. |
| **AC-4** | PASS | `SMS_FALLBACK_ARMED` names the account level and says the message "may then be delivered". Asserted, together with the rule that no sentence anywhere in the copy contains a delivery promise (four phrasings checked). |
| **AC-5** | PASS | `SMS_FALLBACK_GATEWAY` asserted to contain "two switches", "gateway configuration", "is not an error", "does not report" and "cannot tell you". |
| **AC-6** | PASS | `SMS_FALLBACK_EXCLUSIONS` asserted to name media, stickers, contacts, locations, polls, "never re-sent", the group recipient, `E.164`, "At most one SMS" and "never retried". |
| **AC-7** | PASS | `SMS_FALLBACK_ORDER` asserted to contain "last stage, never the first", "while sending" and "arriving twice". |
| **AC-8** | PASS | `SMS_FALLBACK_EFFECT` asserted to contain "next send attempt", "no restart", "re-pairing" and "idempotent". |
| **AC-9** | PASS | The card renders no credential input of any kind; `SMS_FALLBACK_CREDENTIALS` asserted to contain "never entered here" and "deployment environment". |
| **AC-10** | PASS | `smsFallbackFailure` → `not-found` on 404, `permission` on 403, `unknown` on 400/409/500/503 and on a transport failure (4 tests). The card maps them to `ADMIN_REJECTIONS['not-found']`, `PERMISSION_DENIED` and `toActionErrorMessage`; the displayed value is `state`, which comes from the server's list and is untouched by a failed mutation. |
| **AC-10a** | PASS | The mutation's `onSuccess` invalidates `accountsKey()`; the source rule *"a successful fallback write invalidates the list the switch reads from"* asserts it, and **failed** when the line was deliberately removed (see the mutation run below). |
| **AC-11** | PASS | `SendMessageWire` / `SendMessageResult` live in `src/api/send.ts` and are returned by `sendText` alone; `SendResult` is unchanged and every other `/send/*` signature is untouched (`git diff` on that file is confined to the new type and `sendText`). |
| **AC-12** | PASS | `SendMessageResult` is `Omit<SendMessageWire, 'message_id'>`, so a reader elsewhere does not compile — `npm run typecheck` green is the assertion. Reinforced by the source rule limiting `.message_id` / `SendMessageWire` to two files, which **failed** when a `mutation.data?.message_id` read was injected into `text-form.tsx`. |
| **AC-12a** | PASS | `deliveryChannel` answers `whatsapp` only for an absent field or the exact literal; `'SMS'`, `'WhatsApp'`, `'telegram'`, `'whatsapp '`, `''` and `'sms\n'` all answer `unrecognised` (6 assertions). `usableMessageId` returns `null` for `sms` and for `unrecognised` regardless of the id. |
| **AC-13** | PASS | `deliveryNotice` returns `SMS_DELIVERY_NOTICE` for `sms`; `DeliveryNotice` renders its title and description and the reference from `carrierReference`. An empty reference renders "The carrier reported no reference." — a sentence, not an error state — and `carrierReference` is asserted to answer `''` for a blank and for an absent id. |
| **AC-13a** | PASS | `carrierReference` strips `U+202E` (`'carrier‮4711'` → `'carrier4711'`) and the isolates (`'⁦ref⁩'` → `'ref'`), and caps at `MAX_CARRIER_REFERENCE` with an ellipsis. The source rule asserts the notice renders only through `carrierReference` and contains no `href`, `<a>` or clipboard call. |
| **AC-13b** | PASS | `sendToast` asserted to contain "SMS"/"not by WhatsApp" for an SMS result and "does not recognise" for an unknown one; the source rule asserts both surfaces pass `successMessage: sendToast` and neither carries the static `'Message sent'`. |
| **AC-14** | PASS | `shouldReadChatHistory` is true only for WhatsApp (4 assertions); `message-view.tsx` gates its `invalidateQueries` on it, asserted by source rule. The SMS notice states the message "will not appear in the conversation" and why. Nothing polls: there is no interval or refetch added anywhere. |
| **AC-15** | PASS | Neither send surface offers a per-result action, and for a non-WhatsApp result `text-form.tsx` renders the notice **instead of** `ResultPanel` — so the id a user might have copied is not on screen. The notice states no reply, reaction, forward or revoke can be built on it (asserted). Both surfaces call `mutation.reset()` on submit, so a notice cannot outlive its send. |
| **AC-16** | PASS | The composer `<form>` is inside `{mayCompose && …}` in `message-view.tsx`, with `mayCompose` read from `PERMISSIONS.MESSAGES_SEND` in `chats.tsx`. Source rule asserts the permission is read there. |
| **AC-17** | PASS | `{mayWriteChats && <ChatControls chat={chat} />}` — the whole dropdown, containing pin, unpin, archive and the four disappearing options, is absent. `chat-controls.tsx` itself is unchanged. |
| **AC-18** | PASS | `MessageMedia` returns a static `<p>` label when `!canDownload`, so no button exists; the message list is **not** guarded on `messages.read`, asserted by a negative source rule that would fire on `mayDownloadMedia && <ScrollArea`. |
| **AC-19** | PASS | The whole "Reject call" `ActionCard` is inside `{mayRejectCalls && …}` in `misc.tsx`; source rule asserts `PERMISSIONS.CALLS_REJECT` is read there. |
| **AC-20** | PASS | Source rule *"neither unwindowed list opens a permission subscription of its own"* covers `message-view.tsx`, `message-media.tsx`, `chat-controls.tsx`, `chat-list.tsx` and `participants-panel.tsx` for `useHasPermission`, `useHasAnyPermission`, `useHasAllPermissions`, `usePermissions` and `<Can>`. It **failed** when a `useHasPermission` call was injected into `message-view.tsx`. |
| **AC-21** | PASS | Source rule asserts no `disabled={…may*/can*…}` in `message-view.tsx`, `message-media.tsx`, `misc.tsx` or `chats.tsx`. The only `disabled` props present are driven by `isPending` and an empty draft. |
| **AC-21a** | PASS | `enabled: open && canDownload` on the media query, asserted by source rule; plus an early return before it, so neither the request nor the observer exists without the permission. |
| **AC-22** | PASS | `dashboard.tsx` branches on `deviceEmptyReason(ownAccountId)` between "This account has no devices yet" and "Your user does not belong to an account". Both strings asserted by source rule. |
| **AC-23** | PASS | The `no-account` `EmptyState` carries no `action`, **and** the page header's `<CreateDeviceDialog />` is gated on `belongsToAnAccount`. The source rule asserting the header gate **failed** when the gate was deliberately removed — which is the exact defect the advisory panel predicted (finding `S8`). |
| **AC-24** | PASS | `AccountChip` renders `<IdText value={accountId} />` beside "You are working in account", and is rendered only when `belongsToAnAccount`. Source rule asserts the `IdText` render. |
| **AC-25** | PASS | Source rule asserts `dashboard.tsx` names neither `useAccounts(` nor `accountName(`, so no name is resolved and no request is issued; it also asserts the file does not import `stores/account`. |
| **AC-26** | PASS | Three pure modules with adjacent tests: `account-settings.ts` (18), `send-channel.ts` (19), and `deviceEmptyReason` in `surfaces.ts` (4). None imports React, a store, or axios. |
| **AC-27** | PASS | Twelve rules added to `source-policy.test.ts`, covering the per-row hooks, the `message_id` readers, the fail-safe channel, the sanitised reference, the toast, the invalidation, the boolean body, the chip and the two empty states. |
| **AC-28** | PASS | Recorded in `plan.md > Follow-up requests` and `implement.md > Follow-up requests`: an `account_name` on `GET /auth/me` (study §14, `Q-4`). No name is faked anywhere. |
| **AC-29** | PASS | The existing rule *"no shipped file names `role` or `roles` outside the five that only display one"* passes with its allowlist unchanged; none of this ticket's 17 files is on it. |
| **AC-30** | PASS | `git status` — 17 paths, no deployment runtime file. |

## Test cases

| TC | Result |
|---|---|
| **TC-1** | PASS — `accounts.test.ts:272-288` unchanged and green for `true` and `false`; source rule on the signature and the absent cleaner. |
| **TC-2** | PASS — 4 assertions on `smsFallbackState`. |
| **TC-3** | PASS — the "no delivery promise" rule plus the gateway assertions. |
| **TC-4** | PASS — 3 assertions over `SMS_FALLBACK_EXCLUSIONS`. |
| **TC-5** | PASS — 4 assertions on `smsFallbackFailure`. |
| **TC-6** | PASS — `deliveryChannel`, 3 tests including 6 unrecognised inputs. |
| **TC-7** | PASS — `usableMessageId`, 4 tests. |
| **TC-8** | PASS — `carrierReference`, 5 tests including bidi, cap, and both empty cases. |
| **TC-9** | PASS — `sendToast` / `deliveryNotice`, 5 tests. |
| **TC-10** | PASS — `shouldReadChatHistory`, 2 tests. |
| **TC-11** | PASS — source rule, verified by injection. |
| **TC-12** | PASS — source rule + `tsc -b`, verified by injection. |
| **TC-13** | PASS — source rule on the four controls and the absent `disabled`. |
| **TC-14** | PASS — source rules on the card, verified by injection for the invalidation. |
| **TC-15** | PASS — `deviceEmptyReason`, 4 tests over blank, whitespace, `null`, `undefined` and a real id. |
| **TC-16** | PASS — source rules on the chip and the empty states, verified by injection for the header gate. |
| **TC-17** | PASS — see Commands and the runtime-impact statement. |

## Mutation run — the evidence for the negative rules

Half of this ticket's rules assert that something is **absent**, and such a rule
passes just as happily when its pattern is wrong as when the code is right. Four
violations were therefore injected into the working tree and the suite run:

| Injected violation | Rule that fired |
|---|---|
| `mutation.data?.message_id` in `text-form.tsx` | `message_id` and `channel` are named in two files only |
| `useHasPermission(...)` in `message-view.tsx` | neither unwindowed list opens a permission subscription |
| `accountsKey()` invalidation deleted from the card | a successful fallback write invalidates the list |
| `<CreateDeviceDialog />` un-gated in `dashboard.tsx` | the two empty states are distinct, and the blank one offers no control |

**Exactly four tests failed and no others** (`4 failed | 66 passed`). The
mutation was reverted and the full suite re-run green at 636.

## Advisory panel — outcomes carried into verification

- **P10 (recorded as verification evidence, as the plan said):** the conditional
  invalidation is a small net saving as well as a correctness fix. An absent
  `channel` still invalidates, so nothing that worked before behaves differently;
  what is removed is a prefix invalidation that marked every cached
  `['chat-messages', jid, …]` variant stale in order to refetch the one mounted
  query for a row that was never written.
- **P1 / P2:** `MessageBubble` is now `React.memo` and `useAppInfo()` no longer
  runs per row — both asserted by source rule, so the improvement cannot be
  quietly undone.
- **S3 / S5:** the two concerns the panel cut are absent from the diff.
  `src/pages/messaging.tsx` and `src/features/group/participants-panel.tsx` are
  untouched, and `git status` confirms it.

## Conclusion

**PASSED.** All 35 acceptance criteria and 17 test cases are mapped to executed
results; typecheck, tests, lint and build are green; no deployment runtime file
changed. The ticket transitions `implemented → verified → closed`.
