---
ticket: z8pmx9mf19
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-08
links:
  clickup: "https://app.clickup.com/t/z8pmx9mf19"
  github: ""
---

# Verification — 9 · Build the account devices surface

**Outcome: PASSED.** All **38** acceptance criteria are mapped to an executed
result below; every one passes. Verification depth is `all-ac`
(`workflow_form.verification`, MO-6).

Read-only: no implementation file was modified by this stage, and no commit was
created (VF-7, VF-10).

## Validation profile

Profile **`ui-source`** plus **`ui-build`**, as `plan.md > Validation strategy`
named. Every check resolved from `.claude/project-config.yaml >
validation_checks` and run locally, non-interactively, from the repository root.

| Check | Command | Exit | Result |
|---|---|---|---|
| `ui-typecheck` | `npm run typecheck` | 0 | **pass** |
| `ui-lint` | `npm run lint` | 0 | **pass** — 4 warnings, all pre-existing (`components/ui/button.tsx`, `badge.tsx`, `tabs.tsx`, `hooks/use-device-guard.tsx`); none in a file this ticket touched |
| `ui-test` | `npm run test` | 0 | **pass** — 508 tests in 31 files |
| `ui-build` | `npm run build` | 0 | **pass** — `dist/index.html` 1,076.31 kB (gzip 432.61 kB) |

Test baseline before this ticket: **451 tests in 28 files**. After: **508 in
31** — 57 added, 0 removed, 0 skipped.

## Runtime impact (TR-3)

**No deployment runtime file changed. No.** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `vite.config.ts`, `package.json` and
`index.html` are byte-identical to `main`, and `package.json` in particular
carries no new dependency — the reply order is changed with explicit move
controls rather than a drag-and-drop package, which is a deliberate decision
recorded in `plan.md > Approach`. The build output grew by ~0.85 kB gzipped.

## Acceptance criteria

### The membership list

| AC | Result | Evidence |
|---|---|---|
| **AC-1** | pass | `account-devices.test.ts` — *lists exactly the rows, in the order the row endpoint returned them* |
| **AC-2** | pass | *keeps a row the registry did not load…* and *answers unknown when the registry has no entry*, which asserts `not.toBe('disconnected')` explicitly. Rendering side: `CONNECTION.unknown` in `account-device-row.tsx` reads "Not loaded" |
| **AC-3** | pass | *does not invent a membership row out of a registry entry* |
| **AC-4** | pass | *takes membership fields from the row and live fields from the registry* |
| **AC-5** | pass | `source-policy.test.ts` — *RULE: the membership list is built by the join, never mapped off the registry query* |
| **AC-6** | pass | `account-device-row.tsx` renders `ordinal(position)`; `source-policy.test.ts` — *RULE: the surface shows a position, never a priority…* asserts `priority` appears in no shipped line of the surface (comments are stripped before the rule looks) |
| **AC-7** | pass | The panel header states "the **first position is tried first**, then the second, and so on" |

### Reply order

| AC | Result | Evidence |
|---|---|---|
| **AC-8** | pass | *carries every device of the account, once each, in the new order* — asserts the exact payload, no duplicates, and full length |
| **AC-9** | pass | *includes a device the registry did not load*, plus `source-policy.test.ts` — *RULE: the order payload is built from the rows…*, which asserts the panel passes `rows.data` |
| **AC-10** | pass | `account-devices-panel.tsx` `reorder.onError` invalidates `accountDevicesKey(accountId)` and reports; there is no retry path and no resubmission |
| **AC-11** | pass | *refuses rather than submits above the endpoint's limit* (257 devices → `kind: 'refused'`, reason names 256) and *submits at exactly the limit* |

### Send state

| AC | Result | Evidence |
|---|---|---|
| **AC-12** | pass | *turns a blocked device usable with an empty send state* and *blocks a usable device* |
| **AC-13** | pass | Wire half: `accounts.test.ts` — *sends send_state: "" — the only way to unblock a device* (ticket 6). Rule half: `source-policy.test.ts` — *RULE: the account API module names no payload-cleaning helper*, **added by this ticket** — the spec claimed it existed and it did not |
| **AC-14** | pass | `account-device-row.tsx` renders the `Blocked` badge in place; nothing filters the list on `send_state`, and the position is `index + 1` from the row order, untouched by blocking |

### Fallback readiness

| AC | Result | Evidence |
|---|---|---|
| **AC-15** | pass | The row renders "Allowed as fallback" / "Not allowed as fallback"; the same rule asserts the word "ready" appears in no shipped line of the surface |
| **AC-16** | pass | `row.fallback_allowed !== undefined` and `row.fallback_reason &&` guard both renders; the test fixture omits both fields throughout the join tests without any failure |

### Creating and attaching

| AC | Result | Evidence |
|---|---|---|
| **AC-17** | pass | `add-device-dialog.tsx` calls `createDeviceInAccount`; asserted by `source-policy.test.ts` — *RULE: the account surface offers exactly one creation path* |
| **AC-17a** | pass | *reports a device whose account_id came back present and blank*, *says nothing when the field is absent…*, *says nothing when the device belongs to an account*; the dialog toasts the warning on the first case only |
| **AC-18** | pass | Same rule as AC-17, scoped to `src/features/account-devices/` and `src/pages/account-detail.tsx` |
| **AC-19** | pass | *reads a 404 on create as the account…* and *separates the two 409s by the request that produced them*; both notices state that nothing was created and nothing taken over (`auth-messages.ts`) |
| **AC-20** | pass | `attachDeviceToAccount` in the dialog's `attach` arm; `deviceRejection(409, 'attach')` → `device-belongs-elsewhere`, whose title is "That device belongs to another account" |
| **AC-21** | pass | No "move" or "detach" control exists — the same rule asserts it, and the only mention of the word in the surface is the dialog header comment explaining why there is none (stripped before the rule runs) |
| **AC-22** | pass | Pair (QR), reconnect, logout behind `mayPair` (`devices.pair`); delete behind `mayDelete` (`devices.delete`); all four call the existing device endpoints. Deviation D-4 in `implement.md` records that logout and reconnect were added here |
| **AC-23** | pass | *reads a 404 as "not available" for every operation but create*; `auth-messages.test.ts` — *never turns the device 404 into a statement about permission*, asserting the notice matches no permission vocabulary; `source-policy.test.ts` — *RULE: a device 404 is classified as "not available" and never as a permission* |
| **AC-24** | pass | Every notice speaks of "the id you submitted" and every toast interpolates the id the caller passed; nothing resolves an id before rendering it |

### The device webhook

| AC | Result | Evidence |
|---|---|---|
| **AC-25** | pass | The panel opens behind `mayReadWebhook` (`DEVICES_WEBHOOK_READ`) in `account-devices-panel.tsx`; inside, `mayWrite` (`DEVICES_WEBHOOK_WRITE`) gates the save footer, the replacement field and both switches, and its absence renders the read-only sentence |
| **AC-26** | pass | *reports the value the server sent* and *assumes on when the field is absent, and marks the assumption*; the dialog renders the switch only inside `{delivery && …}`, which is `null` until the read resolves |
| **AC-27** | pass | `devices.test.ts` — *sends a real JSON boolean to the switch endpoint, and nothing else* (asserts `typeof body.enabled === 'boolean'` and that `enabled` is the only key) |
| **AC-28** | pass | *reads an empty URL as a deletion* and *warns about all three erased values and about where the events then go* (URL, secret, event list, and the fall-back); the dialog gates the save behind `confirmingClear` |
| **AC-29** | pass | *reads a URL as a plain update*; `confirmingClear` is never set for a non-empty URL |
| **AC-30** | pass | *states all four consequences* — delivery, no fallback, the agent bridge, messages still stored — rendered as a list beside the switch |
| **AC-31** | pass | *says that re-enabling needs nothing re-entered*; `devices.test.ts` — *sends true to resume delivery, with no other field* and *touches a different endpoint from the configuration write* |
| **AC-32** | pass | *names no value in the redacted sentence*, *redacts any response-bearing failure*, *keeps the text when there was no response to echo anything*; `source-policy.test.ts` — *RULE: the stored webhook secret reaches no rendered node and no message* |
| **AC-35** | pass | Same rule: the stored secret is bound to no input. The dialog reports only whether one is set, and clears `secret` / `replacementSecret` on close. Strengthened from the planned masking — deviation D-2 |
| **AC-36** | pass | *says what skipping certificate verification costs*; `INSECURE_SKIP_VERIFY_MEANS` is rendered beside that switch |
| **AC-37** | pass | *states the consequence for http*, *says nothing about an https URL or an empty one*, *notices a string that is not a URL rather than rejecting it*; the URL is still saved either way |

### Cross-cutting

| AC | Result | Evidence |
|---|---|---|
| **AC-33** | pass | All four named subjects have direct tests: the left join (5 tests), the complete-set order payload (6), the empty send state (2 here + the ticket-6 wire assertions), and disabling versus clearing (3 + 4 in `devices.test.ts`) |
| **AC-34** | pass | `source-policy.test.ts` — *RULE: the device row calls no hook…* and *RULE: the device row renders no dialog…*. The tab issues exactly two queries regardless of row count, and the panel holds one instance of each dialog |

## Mutation checks

A rule that cannot fail is not a rule, so each new decision and each new
executable rule was inverted in the working tree and the relevant test file
re-run. **26 mutants introduced, 26 killed** — but not on the first pass, and what
happened in between is worth recording, because it is the reason this step
exists.

Three of them (M24–M26) **survived** initially. The rule meant to catch them had
been written with a shell heredoc that silently replaced each `\b` with a literal
backspace byte (`0x08`), so its regexes were `/\x08priority\x08/` and matched
nothing: the rule passed on every input, including the ones it existed to reject.
It was found by the mutation run, not by review, and not by the suite — which was
green throughout. The file was rewritten without a heredoc, the repository was
scanned for further control-byte damage (`grep -rlP` over `src/` and `_specs/`;
none outside a pre-existing, deliberate bidi fixture in `surfaces.test.ts`), and
the three mutants were re-run and killed.

Every file was restored afterwards and the suite re-run green.

| # | Mutation | Killed by |
|---|---|---|
| M1 | `connectionOf` answers `disconnected` for an unloaded row | `account-devices.test.ts` |
| M2 | The join is built from the registry instead of the rows | `account-devices.test.ts` |
| M3 | The order payload carries only the two swapped ids | `account-devices.test.ts` |
| M4 | The 256-entry ceiling is not enforced | `account-devices.test.ts` |
| M5 | Unblocking sends `undefined` instead of the empty string | `account-devices.test.ts` |
| M6 | An absent `account_id` is read as belonging to nobody | `account-devices.test.ts` |
| M7 | A device `404` is classified as a permission problem | `account-devices.test.ts` |
| M8 | Both `409`s collapse to one notice | `account-devices.test.ts` |
| M9 | An absent `webhook_enabled` is read as off | `device-webhook.test.ts` |
| M10 | An empty URL is treated as a plain update | `device-webhook.test.ts` |
| M11 | The save payload trims the signing secret | `device-webhook.test.ts` |
| M12 | A failed save renders the server's own text | `device-webhook.test.ts` |
| M13 | An `http` URL raises no notice | `device-webhook.test.ts` |
| M14 | The switch endpoint receives a string instead of a boolean | `devices.test.ts` |
| M15 | The panel maps the registry query into its list | `source-policy.test.ts` |
| M16 | The order payload is built from the joined list | `source-policy.test.ts` |
| M17 | The account surface imports the generic `addDevice` | `source-policy.test.ts` |
| M18 | The row mounts a dialog itself | `source-policy.test.ts` |
| M19 | The row calls a permission hook of its own | `source-policy.test.ts` |
| M20 | The stored secret is bound to an input | `source-policy.test.ts` |
| M21 | The webhook save renders the server's raw error | `source-policy.test.ts` |
| M22 | The account API module reaches for the payload cleaner | `source-policy.test.ts` |
| M23 | The device `404` classifier stops naming the notice | `source-policy.test.ts` |
| M24 | The row renders the raw `priority` | `source-policy.test.ts` (after the fix above) |
| M25 | The fallback label says "ready" | `source-policy.test.ts` (after the fix above) |
| M26 | The surface offers a detach control | `source-policy.test.ts` (after the fix above) |

## Test cases

| TC | Result | Note |
|---|---|---|
| TC-1 | pass | AC-1, AC-2 |
| TC-2 | pass | AC-3 |
| TC-3 | pass | AC-4 |
| TC-4 | pass | AC-8, AC-9 — the payload from a three-device set including one the registry lost |
| TC-5 | pass | AC-10 — invalidate and report; no resubmission exists in the code path |
| TC-6 | pass | AC-11 |
| TC-7 | pass | AC-12, AC-13, AC-14 |
| TC-8 | pass | AC-15 |
| TC-9 | pass | AC-16 |
| TC-10 | pass | AC-17, AC-18 |
| TC-11 | pass | AC-19 |
| TC-12 | pass | AC-20, AC-23 |
| TC-13 | pass | AC-27, AC-31 |
| TC-14 | pass | AC-28 |
| TC-15 | pass | AC-26 |
| TC-16 | pass | AC-25 |

## Limits of this verification

Stated rather than left implied:

1. **No component was rendered.** This repository has no renderer in its test
   environment, which is why every decision was lifted into a pure function in
   the first place. Where an AC is about *rendering* — the position ordinal, the
   badges, the read-only arm — the evidence above is the source, an executable
   source rule, or both, never an executed render. Three of those (AC-6, AC-15,
   AC-21) were promoted from inspection to an executable rule while writing this
   file, precisely because a claim in a document is the thing this repository
   refuses to rely on. Six still rest partly on reading the source: AC-7, AC-14,
   AC-16, AC-24, AC-25, AC-30.
2. **No request reached a gowa server.** The API tests drive the real axios
   interceptor chain against a stub adapter, so they prove the request this
   client *sends*; they cannot prove what the backend does with it. Every wire
   shape here was read off the reference's OpenAPI text and its prose.
3. **`Q-1` is still open.** Whether `POST /devices` attaches to the caller's
   account is unanswered by the reference, and this ticket does not answer it —
   it reports the result instead. If the backend does attach, the warning simply
   never fires.
