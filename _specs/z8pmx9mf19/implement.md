---
ticket: z8pmx9mf19
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf19"
  github: ""
---

# Implementation — 9 · Build the account devices surface

Applied on branch `ticket/z8pmx9mf19`, cut from `ticket/z8pmx9mf18` (this surface
is the account detail screen ticket 8 left as an empty state, so the branch is
cut from that ticket rather than from `main`).

**No commit was created here.** Committing is the delivery boundary's job —
`/publish-pr` creates the single publishable commit (PB-8, IM-9).

## Files changed

**Added (9)**

| File | What it is |
|---|---|
| `src/lib/account-devices.ts` | The membership decisions: the left join, the reply position, the order payload, the send-state toggle, the orphan-create check, and the device rejection classifier. Pure. |
| `src/lib/account-devices.test.ts` | 21 tests over the above. |
| `src/lib/device-webhook.ts` | The webhook decisions: save effect, the four consequences of disabling, the deletion warning, the TLS-verification consequence, the URL notice, the enabled default, the payload, and the redacted-failure classifier. Pure. |
| `src/lib/device-webhook.test.ts` | 19 tests over the above. |
| `src/api/devices.test.ts` | 7 tests driving the three webhook calls through the real interceptor chain. |
| `src/hooks/use-account-registry-devices.ts` | The registry half of the join, keyed and requested off one computed scope. |
| `src/features/account-devices/account-devices-panel.tsx` | The surface: both queries, the memoised join, four mutations, hoisted permissions, and one instance of every dialog. |
| `src/features/account-devices/account-device-row.tsx` | One device, presentational. `memo()`, no hook, no dialog. |
| `src/features/account-devices/add-device-dialog.tsx` | Create inside the account, or attach an existing slot. No third mode. |

**Edited (9)**

| File | Change |
|---|---|
| `src/api/devices.ts` | Split `DeviceWebhookSettings` (the `PATCH` result) from `DeviceWebhookConfig` (the `GET` result, carrying `webhook_enabled`); added `setDeviceWebhookEnabled` and `DeviceWebhookState`. |
| `src/lib/auth-messages.ts` | Five `AdminRejection` entries for the device vocabulary. |
| `src/lib/auth-messages.test.ts` | **Deviation D-1** — see below. |
| `src/lib/query-keys.ts` | `deviceWebhookKey(deviceId)`, producing the tuple the dialog already built inline. |
| `src/lib/source-policy.test.ts` | Nine new executable rules. |
| `src/features/devices/webhook-dialog.tsx` | The delivery switch, the deletion confirmation, the read-only arm, id-based props, the never-rendered secret, and the redacted save failure. |
| `src/features/devices/device-card.tsx` | Four lines: the dialog's new props. |
| `src/features/devices/create-device-dialog.tsx` | Reports a device created belonging to no account; the two webhook fields removed. |
| `src/pages/account-detail.tsx` | Mounts the panel in place of the empty state; drops the duplicated device count. |

**18 paths, against the 17 the plan listed.** The extra one is D-1 below.

No deployment runtime file was touched — `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are all unmodified — and no dependency was added.

## Deviations from the approved plan

### D-1 — `src/lib/auth-messages.test.ts` was edited, and the plan did not list it

**Required, not discretionary.** That file asserts a **closed set** over
`Object.keys(ADMIN_REJECTIONS)`, so the five new entries the plan does list broke
it. The five keys were added to its `KEYS` array with the note explaining why the
device vocabulary needs five entries rather than reusing `not-found`.

One assertion was added while there, and it is the runtime half of `AC-23`: the
`device-not-available` notice must match no permission vocabulary, and must state
both that the device may not exist *and* that it may belong to another account —
because the backend answers identically for the two on purpose, and picking one
would hand back the oracle it withheld.

### D-2 — the stored webhook secret is not rendered at all, rather than masked

Plan step 6, answering panel finding SEC-1, said the field would be
`type="password"` with an explicit reveal and no reveal in the read-only arm.
That is not reachable in this repository: `src/lib/source-policy.test.ts` already
carries `RULE: 'password' is named only where the form holds it and the request
type declares it`, allowlisting four files, and `type="password"` in the webhook
dialog fails it.

Widening that allowlist was rejected — it guards a real credential path and would
have been widened for a *presentational attribute*. What was implemented instead
is the security lens's own first-choice mitigation, which the plan had recorded
and not taken: **the stored secret is never rendered.** The panel says whether a
secret is set and offers a replacement field; the stored value stays in state,
travels back in the payload so an unrelated save cannot destroy it, and reaches no
DOM node.

This is strictly stronger than masking — a masked input still holds the real
value in a DOM attribute any injected script can read. It costs the operator the
ability to read a secret back, which the reference gives no endpoint for anyway.
`spec.md > REQ-31 / AC-35` were updated to the delivered behaviour and the rule
that forced it.

### D-3 — a ninth source rule was added, beyond the eight the plan listed

`verify.md` was going to evidence `AC-6` (no raw `priority` rendered), `AC-15`
(never the word "ready") and `AC-21` (no detach control) with a `grep` recorded
in prose. That is the kind of claim this repository deliberately does not accept
— a rule nobody can run is a rule that decays — so the three were folded into one
executable rule over `src/features/account-devices/`. `SOURCES` strips comments
before any rule reads it, so the paragraphs in those files that *explain* each
rule do not trip it.

Writing it exposed a defect worth recording: the first version was applied
through a shell heredoc that replaced every `\b` with a literal backspace byte,
leaving three regexes that could never match. The suite stayed green and the rule
was useless. The mutation run is what caught it — see `verify.md > Mutation
checks`.

### D-4 — logout and reconnect were added to the row

`AC-22` names four device actions — pair, logout, reconnect, delete — and the
plan's step 5 described only pair and delete. The two missing ones were added as
`devices.pair`-gated icon buttons driven by one mutation in the panel.

They are offered on **every** row, including one the registry did not load, while
pairing is not: pairing opens a dialog that takes a `RegistryDevice` and polls
`deviceStatus` against a live session, and manufacturing an entry for a row the
registry has not loaded is the invented row this surface exists to refuse. Logout
and reconnect address the device by id and need no entry.

## Validation run

| Check | Command | Result |
|---|---|---|
| `ui-typecheck` | `npm run typecheck` | pass (exit 0) |
| `ui-lint` | `npm run lint` | pass (exit 0) — 4 warnings, all pre-existing in `components/ui/button.tsx`, `badge.tsx`, `tabs.tsx` and `hooks/use-device-guard.tsx`; none in a file this ticket touched |
| `ui-test` | `npm run test` | pass — **508 tests in 31 files** (baseline 451 in 28) |
| `ui-build` | `npm run build` | pass — `dist/index.html` 1,076.31 kB (gzip 432.61 kB), up ~0.85 kB from baseline |

`npm run format:check` is deliberately not in the profile (the repository carries
pre-existing drift the CI does not check either), but every file this ticket
added or edited was run through `prettier --write`, so it contributes none.

## Notes on what was built

- **The join is the ticket.** `joinAccountDevices` is a left join on the rows and
  nothing in the panel iterates the registry query into a list — asserted by a
  source rule, because the failure is silent: the screen still renders, it just
  omits devices, and the reorder that follows is refused with a `400` nothing
  explains.
- **`orderSubmission` takes the row array, not a list of ids.** Provenance in the
  signature, the trick `deleteRequestFor` established in ticket 8. A source rule
  asserts the panel hands it `rows.data` rather than the joined list.
- **The panel owns every dialog, one instance each**, and the row calls no hook
  and renders no dialog — both halves asserted, because the first rule alone
  cannot see a `useQuery`-bearing child mounted per row.
- **The empty string survives everywhere it matters.** `toggledSendState` returns
  it, `src/api/accounts.ts` still names no payload-cleaning helper (now an
  executable rule rather than a paragraph), and `webhookPayloadFrom` always sends
  `webhook_url` because its empty value is the documented deletion.
