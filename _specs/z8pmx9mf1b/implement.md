---
ticket: z8pmx9mf1b
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf1b"
  github: ""
---

# Implementation — 11 · Add account settings and wrap the operational screens in the account

Branch `ticket/z8pmx9mf1b`, cut from `ticket/z8pmx9mf1a` — the tip of phase 2 and
the last ticket in it. The pull request targets `main`, as with every ticket in
the phase.

The work follows `plan.md` **revision 2**, which answers 35 advisory-panel
findings. Fourteen of them changed the design before any code existed, and the
scope this file describes is smaller than revision 1's by two whole concerns
(`/messaging` and the group participants panel), both cut on the panel's advice.

## Files changed

### Added (6)

| Path | Lines | What |
|------|------|------|
| `src/lib/account-settings.ts` | 146 | The fallback state read, the failure classifier, and the six copy constants the screen is mostly made of. |
| `src/lib/account-settings.test.ts` | 176 | 18 tests — including the assertions that the copy promises no delivery. |
| `src/lib/send-channel.ts` | 178 | `deliveryChannel`, `usableMessageId`, `carrierReference`, `shouldReadChatHistory`, `sendToast`, `deliveryNotice`, and the two notices. |
| `src/lib/send-channel.test.ts` | 169 | 19 tests. |
| `src/features/account-settings/sms-fallback-card.tsx` | 151 | The settings tab body; owns the mutation and the `accountsKey()` invalidation. |
| `src/components/shared/delivery-notice.tsx` | 52 | What a non-WhatsApp delivery says for itself, on both send surfaces. |

### Modified (11)

| Path | +/− | Change |
|------|-----|--------|
| `src/api/send.ts` | +45/−2 | `SendMessageWire` and `SendMessageResult` (the id omitted from the type); `sendText`'s return. |
| `src/lib/surfaces.ts` | +40 | `deviceEmptyReason`, beside the scope decisions that module already owns. |
| `src/lib/surfaces.test.ts` | +30 | Its four tests (41 → 45). The existing 41 pass **unchanged**. |
| `src/lib/source-policy.test.ts` | +257 | Twelve new rules in one `describe` (58 → 70). Nothing above it changed — the diff is 257 added, 0 removed. |
| `src/pages/account-detail.tsx` | +16 | The Settings tab; the state computed from the list the page already holds. |
| `src/pages/chats.tsx` | +42/−1 | Three permission booleans and `base_path`, hoisted above the early return. |
| `src/features/chat/message-view.tsx` | +116/−26 | Four props; composer and controls gated; `React.memo` on the row; conditional invalidation; `reset()` on submit; channel-aware toast; the notice. |
| `src/features/chat/message-media.tsx` | +49/−7 | `canDownload` / `basePath` props; `useAppInfo` removed; the query gated at `enabled`; the static label. |
| `src/features/send/text-form.tsx` | +27/−2 | The notice in place of the JSON dump for a non-WhatsApp result; channel-aware toast; `reset()` on submit. |
| `src/pages/misc.tsx` | +14/−6 | `calls.reject` around the whole card. |
| `src/pages/dashboard.tsx` | +86/−9 | The inlined account chip, the two empty states, and the create control hidden for `no-account`. |

**17 files: 6 added, 11 modified — exactly the list in `plan.md`.**

### Not touched

`src/api/accounts.ts` (already correct — `setAccountSmsFallback` builds the
boolean body literally and has done since `z8pmx9mf16`), `src/lib/permissions.ts`,
`src/hooks/use-permissions.ts`, `src/hooks/use-accounts.ts`,
`src/components/shared/can.tsx`, `src/lib/auth-messages.ts`,
`src/components/layout/navigation.ts`, `src/stores/account.ts`,
`src/features/group/participants-panel.tsx`, `src/pages/messaging.tsx`,
`src/features/chat/chat-controls.tsx`, `src/App.tsx`, and every deployment runtime
file (`vite.config.ts`, `package.json`, `index.html`, `.github/workflows/*`).
**No deployment runtime file changed** — the `/verify` statement is *no*.

## Deviations from the plan

**1 — Twelve source rules, not eight.**

The plan named eight. Three of them turned out to be doing two unrelated jobs
each, and splitting them was the difference between a failure message that names
the problem and one that says "something in this list is wrong":

- *the per-row query hook* (`useAppInfo` in `message-media.tsx`) separated from
  *the per-row permission hook* — they have different fixes;
- *the memoised row* separated from both, because it is a performance
  invariant and not a placement one;
- *the fail-safe channel decision* separated from *the id-reader rule*, because
  the first is about `send-channel.ts`'s own logic and the second is about every
  other file in the repository.

The count went up; nothing was added that the plan did not describe.

**2 — The four negative rules were tested by breaking them, deliberately.**

A rule of the form `expect(pattern.test(source)).toBe(false)` passes just as
happily when the pattern is wrong as when the code is right, and this ticket adds
several. So four violations were injected into the working tree — a
`result.message_id` read in `text-form.tsx`, a `useHasPermission` inside
`message-view.tsx`, the `accountsKey()` invalidation deleted from the card, and
the create control un-gated on `dashboard.tsx` — and the suite was run. Exactly
those four rules failed, and no others. The mutation was then reverted and the
full suite re-run green.

This is recorded as a deviation because it is work the plan did not list, and
because it is the evidence that the rules in this ticket are load-bearing rather
than decorative. It is also the only way to demonstrate a *negative* in a
repository with no component renderer.

**3 — `deviceEmptyReason` takes one argument, and the account lens is never
imported.**

The plan's revision 1 had two functions and an amendment to the "the account lens
is imported only where the scope is owned or applied" allowlist. Two lenses
flagged the unplanned exemption; revision 2 removed the need for it by observing
that `dashboard.tsx` is reached only through `home.tsx`'s `device` arm, for whom
`scopedDeviceFilter` answers `null` and the lens cannot narrow anything. The
implementation follows revision 2, and `src/lib/source-policy.test.ts`'s existing
allowlist is byte-for-byte unchanged.

**4 — Prettier was run on this ticket's files only.**

149 of the repository's source files already fail `prettier --check` at `HEAD`,
and CI runs `typecheck`, `lint` and `build` but no format check. Running
`npm run format` would have rewritten 138 files outside the approved list — a
scope-creep diff far larger than the ticket. So `prettier --write` was run against
the 14 files this ticket touches. `src/lib/source-policy.test.ts` was clean at
`HEAD`, and its diff is **257 added, 0 removed**, which is the proof that only the
appended block was reformatted. `src/lib/surfaces.test.ts` was *already*
unformatted at `HEAD` and was left as found, so no pre-existing line moved.

**5 — The unrecognised-channel state produced a second notice.**

The plan described `deliveryChannel` returning three values but specified copy for
one of them. A reachable state needs something to render, so
`UNRECOGNISED_DELIVERY_NOTICE` exists beside `SMS_DELIVERY_NOTICE`. It claims
nothing about what happened — it cannot — and withholds the identifier for the
same reason.

## Follow-up requests recorded by this ticket

1. **To the backend team (study §14, `Q-4`): an `account_name` on
   `GET /auth/me`.** A principal without `accounts.manage` cannot call
   `GET /accounts`, and `dashboard.tsx` is rendered only by such a principal, so
   the account chip there can show nothing but the raw `account_id`. No name is
   invented and no query is mounted that could never resolve. One field on
   `/auth/me` closes it.
2. **To the backlog (panel `S3`): gate `/messaging`.** The seeded `user` role
   holds neither `messages.send` nor `messages.mark`, yet the sidebar offers them
   a compose surface whose every submit will be refused. The panel rejected doing
   it here on the decisive ground that such a gate must move
   `navigation.ts`'s `SURFACE_PERMISSIONS` and the route guard with it —
   otherwise the entry points at a page that refuses the principal, which is the
   exact drift that file was written to prevent.

## Validation run

```
npm run typecheck   ✓  tsc -b, no errors
npm test            ✓  34 files, 636 tests (baseline 583 — 53 added)
npm run lint        ✓  4 warnings, all pre-existing in components/ui + hooks
npm run build       ✓  dist/index.html 1,111.06 kB · gzip 441.28 kB
git status          ✓  17 files, no deployment runtime file
```

The 53 new tests are 18 in `account-settings.test.ts`, 19 in
`send-channel.test.ts`, 4 in `surfaces.test.ts` and 12 rules in
`source-policy.test.ts`.

`surfaces.test.ts`'s 41 existing assertions and `accounts.test.ts`'s pass
**unchanged**, which is the evidence that neither module's behaviour moved —
`accounts.test.ts` in particular already asserted the boolean fallback body for
`true` and for `false`, which is why this ticket added no payload builder for it.

`tsc -b` is itself an acceptance criterion here: `SendMessageResult` omits
`message_id`, so a compile that succeeds is the proof that no file outside
`src/lib/send-channel.ts` reads the id without the channel decision.

No commit was created here; per the workflow the single publishable commit
belongs to `/publish-pr`.
