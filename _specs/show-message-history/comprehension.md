---
ticket: show-message-history
stage: verify           # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: 2026-07-30
result: passed          # quiz outcome — were ALL answers correct? (CG-4)
score: 3/3              # correct / total
decision: PASSED        # gate decision (the notification hook reads these — ADR-011)
links:
  clickup: https://app.clickup.com/t/86eyekrvm
  github:
---

# Comprehension — show-message-history

> Single-owner gate control (ADR-009 / CG-1..CG-4). At each gate the owner answers
> multiple-choice questions (**≥4 options each**) generated **from the artifact
> under review**. One section per gate — never overwrite another gate's section.
> The gate records its decision **only if 100% of answers are correct** (CG-4);
> any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.

## Review gate

> Questions derived from `plan.md` + `spec.md` (CG-2). Answered before recording
> the `/review` decision.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Under decision D1, what does the plan do when the recipient's chat identifier is `@lid` and the contact lookup fails? | (a) Changes `extractSenderPhone` to return null, accepting the inbound ripple; (b) Falls back to storing the raw `@lid` identifier; (c) **Stores `toPhone` as null, raw id stays in `to`** ✅; (d) Stores the gateway's own number as placeholder | (c) Stores `toPhone` as null, raw id stays in `to` | yes |
| 2 | What does `plan.md`'s Rollback section say happens to data if the change is reverted? | (a) A rollback migration deletes outbound records; (b) **No migration; additive defaulted fields remain harmless** ✅; (c) The schema change is irreversible without a backup; (d) Outbound records are converted back to inbound | (b) No migration; additive defaulted fields remain harmless | yes |
| 3 | Which file in the plan's "Files to change" list is NOT covered by the `node-source` validation profile? | (a) `config/swagger/swaggerPaths.js`; (b) `models/Message.js`; (c) **`public/dashboard.html`** ✅; (d) `routes/tenants.js` | (c) `public/dashboard.html` | yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Which pre-existing behaviour did the implementation change specifically to satisfy AC-55? | (a) 500-record cap made direction-aware; (b) **Reply-success log stopped printing recipient and body** ✅; (c) Sentry context switched to a hashed recipient; (d) Storage log prefix renamed | (b) Reply-success log stopped printing recipient and body | yes |
| 2 | How does the `message_ack` handler avoid mutating an inbound record? | (a) It checks `msg.fromMe` before querying; (b) **It filters the update on `direction: "outbound"`** ✅; (c) It only runs when the session has an outbound queue; (d) It relies on inbound records having no status field | (b) It filters the update on `direction: "outbound"` | yes |
| 3 | Which accepted review finding did the implementation deliberately NOT apply, and why? | (a) **`ADMIN_JWT_SECRET` fail-fast — needs an out-of-scope file** ✅; (b) Direction filter — conflicted with legacy records; (c) Limit clamp — messages.html needs larger pages; (d) Search escaping — broke phone matching | (a) `ADMIN_JWT_SECRET` fail-fast — needs an out-of-scope file | yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

### Verify gate — third run (2026-07-30)

> Fresh questions derived from `implement.md` (deviations, ack guard, indexes).
> Score 3/3 — the gate was free to record its decision; the recorded decision is
> **FAILED** (see `verify.md`), so the ticket returns to rework, not closure.

| # | Question (from the artifact) | Options (correct + distractors, alphabetical) | Owner's answer | Correct? |
|---|------------------------------|----------------------------------------------|----------------|----------|
| 1 | What deviation from the plan did `/implement` record about the branch base? | (a) Cut from dirty main; (b) Cut from feature branch — ticket branch cut straight from `add-bot-for-createOrUpdate-shipment`; (c) **Local main fast-forwarded via `git branch -f` (zero unique commits), ticket branch cut from `main`, `origin/main` not pushed** ✅; (d) `origin/main` force-pushed | (c) Local main fast-forwarded | yes |
| 2 | In `handleMessageAck`, why can an ack code of -1 never overwrite a record that already carries a status? | (a) Early return on a negative ack code; (b) **Nothing ranks below `failed` — the conditional `updateOne` matches only statuses strictly below the incoming one** ✅; (c) The `pre("validate")` hook rejects a downgrade; (d) The filter requires `sendSucceeded: true` | (b) Nothing ranks below failed | yes |
| 3 | Which index did the implementation add instead of the planned ack-lookup index, and why? | (a) None — the plan was followed as written; (b) `{tenantId, waNumberId, status}` for the status filter; (c) `{tenantId, waNumberId, timestamp: -1}` for the message-timestamp sort; (d) **`{tenantId, waNumberId, updatedAt: -1}` — the unique index already serves the ack lookup and the default sort, while `sortBy=updatedAt` had none** ✅ | (d) updatedAt index | yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

### Verify gate — fourth run (2026-07-30)

> Fresh questions derived from `implement.md` (the AC-55 rework #2) + `spec.md`.
> Score 3/3 — the gate was free to record its decision; the recorded decision is
> **FAILED**, on missing runtime evidence alone (AC-55 now passes).

| # | Question (from the artifact) | Options (correct + distractors, alphabetical) | Owner's answer | Correct? |
|---|------------------------------|----------------------------------------------|----------------|----------|
| 1 | What does the new `redactWaIds` helper mask, and why was it needed? | (a) Bare phone numbers only; (b) **Digits before `@` inside a composite identifier — a `sessionKey` is `<waNumberId>:<serialized id>` and a serialized id carries the customer's number in the middle** ✅; (c) Mongo ObjectIds; (d) The whole message body, replaced by its length | (b) Digits before @ in ids | yes |
| 2 | Why did the two `[LOCATION_POLL]` tick lines stop logging `lat`/`lng`, and what replaced them? | (a) **Coordinates are the content of a location share — replaced by `seqChanged` / `coordsChanged`, keeping `seq` and `changeCount`** ✅; (b) Downgraded to `console.warn`, which AC-55 does not constrain; (c) The lines were deleted entirely; (d) Coordinates were rounded to two decimals | (a) Coordinates are content | yes |
| 3 | Which acceptance criteria still lack an executed result, and why? | (a) **AC-1, AC-6, AC-7, AC-62 — they need a live session and a reachable database** ✅; (b) AC-15..AC-20, because the ack listener cannot be inspected; (c) AC-34..AC-46, because the dashboard is not JavaScript source; (d) None — the profile covers every criterion | (a) AC-1, AC-6, AC-7, AC-62 | yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

**Owner attestation recorded at this gate (not a quiz question):** asked whether
the manual runtime procedure (steps 1, 4, 5) had been executed against a live
session and database — answered **"No — not run yet"**. That answer is what makes
this run FAILED.

### Verify gate — fifth run (2026-07-30)

> Questions derived from `implement.md` (plan step 30 — the executed runtime
> evidence) + `spec.md` (the AC-62 amendment). Score 3/3; recorded decision
> **PASSED**.

| # | Question (from the artifact) | Options (correct + distractors, alphabetical) | Owner's answer | Correct? |
|---|------------------------------|----------------------------------------------|----------------|----------|
| 1 | The harness found that during a MongoDB outage the reply is never sent at all. Root cause? | (a) `message_ack` never fires so the relay refuses to send; (b) Storage throws and the exception escapes before `sendMessage`; (c) The typing delay depends on a DB read and never completes; (d) **The per-number webhook URL is read from MongoDB (`getWebhookConfig` → `WhatsAppNumber.findById`), so no webhook response and no reply exist** ✅ | (d) Webhook URL lives in Mongo | yes |
| 2 | Why was the failing half of AC-62 transferred out instead of fixed here? | (a) It is a new regression caused by this ticket; (b) **The fix needs `services/agentWebhookService.js` / `handleInboundMessage` — outside the approved "Files to change" list, so applying it would violate IM-4** ✅; (c) It is a spec error describing unwanted behaviour; (d) D6 made runtime criteria optional | (b) It needs out-of-scope files | yes |
| 3 | How was the runtime evidence produced without touching production? | (a) A `mongo:7` **throwaway container on host port 27018**, `MONGODB_URI` forced before any repo module loaded, the harness aborting unless the URI is `127.0.0.1:27018`, `SENTRY_DSN` blanked ✅; (b) `mongodb-memory-server` added to devDependencies; (c) Records written to production then deleted; (d) A read-only connection to the production Atlas replica | (a) Throwaway container on 27018 | yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
