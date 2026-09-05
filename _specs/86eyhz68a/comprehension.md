---
ticket: 86eyhz68a
stage: verify              # the gate that last updated this record
mode: standard          # single workflow form — no other modes (ADR-009)
status: complete        # not_started | in_progress | complete
owner: developer        # the ticket owner (self-review)
updated: 2026-08-09
result: passed             # quiz outcome — were ALL answers correct? (CG-4)
score: 6/6                 # correct / total
decision: PASSED           # gate decision; `none` when the quiz failed (the notification hook reads these — ADR-011)
links:
  clickup: https://app.clickup.com/t/86eyhz68a
  github:
---

# Comprehension — 86eyhz68a

> Single-owner gate control (ADR-009 / CG-1..CG-4). At each gate the owner answers
> multiple-choice questions (**≥4 options each**) generated **from the artifact
> under review**. One section per gate — never overwrite another gate's section.
> The gate records its decision **only if 100% of answers are correct** (CG-4);
> any wrong answer blocks it. Each question's options are listed
> **alphabetically** — the correct answer's position must carry no signal.

## Review gate

> Questions derived from `plan.md` + `spec.md` (CG-2). Answered before recording
> the `/review` decision. Source: `plan.md` decisions D-1, D-3 and D-6.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | Decision D-1 makes `OMNI_AGENT_URL` optional rather than required. What is the stated reason? | (a) Because each tenant may run its own `omni_agent` instance · (b) Because the origin of `webhookUrl` is faster to resolve than reading an environment variable · **(c) Because a required new environment variable would need a change to a deployment runtime file, which AC-4 and the CLAUDE.md hard-stop forbid** · (d) Because the upstream contract puts `/debug/toggle` at the root, so no base path can be configured | (c) Because a required new environment variable would need a change to a deployment runtime file, which AC-4 and the CLAUDE.md hard-stop forbid | ✅ yes |
| 2 | D-3 answers AC-26 without adding a second route. How does the screen learn that a number has no credential? | (a) A `HEAD` request to the toggle route, which answers without calling upstream · (b) By reading `aiAgent.webhookSecret` from the number record, which the transform strips before display · **(c) One additive `debugToggle: { available, reason }` object on the contact-list read the screen already performs, answered from `WhatsAppNumber.exists` so the value is never loaded** · (d) The first click fails and the reason is cached in `sessionStorage` for later loads | (c) One additive `debugToggle: { available, reason }` object on the contact-list read the screen already performs, answered from `WhatsAppNumber.exists` so the value is never loaded | ✅ yes |
| 3 | D-6 declines to reuse `agentWebhookService.sendWebhookWithRetry`. Why? | (a) It is not exported, and exporting it would change an existing contract · **(b) Its 3-attempt 1s/2s/4s ladder can make an operator wait ~37s on a button; a control-plane toggle makes one bounded attempt and reports failure** · (c) It computes an HMAC signature the debug endpoint does not accept · (d) It cannot send a header the caller did not configure on the number | (b) Its 3-attempt 1s/2s/4s ladder can make an operator wait ~37s on a button; a control-plane toggle makes one bounded attempt and reports failure | ✅ yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a

## Verify gate

> Questions derived from `implement.md` + `spec.md` (CG-2). Answered before
> recording PASSED at `/verify`.

| # | Question (from the artifact) | Options (correct + distractors) | Owner's answer | Correct? |
|---|------------------------------|---------------------------------|----------------|----------|
| 1 | `implement.md` explains how AC-8 ("a caller cannot supply, override or influence which key is sent") is satisfied. By what mechanism? | (a) A caller-supplied `webhookSecret` is compared against the stored one and rejected on mismatch · (b) The header is stripped from the inbound request before the outbound one is built · **(c) The header is built only from `loadWebhookSecret(waNumber._id)`; no field of the request body is ever read into it, so an injected `webhookSecret` or `X-Agent-Signature` is simply ignored** · (d) The admin token's claims are used to derive the key | (c) The header is built only from `loadWebhookSecret(waNumber._id)`; no field of the request body is ever read into it, so an injected `webhookSecret` or `X-Agent-Signature` is simply ignored | ✅ yes |
| 2 | How does the route prove the target is "a contact of their own tenant's number" (AC-1) while the WhatsApp session may be disconnected? | (a) By calling `sessionManager.getSession()` and reading the chat list · (b) By checking the phone's country prefix against the number's own · (c) By trusting the contact row, since the operator never types a phone · **(d) By `Message.exists({ tenantId, waNumberId, chatId })` on the conversation key from ticket 2/4 — an index seek that needs no session** | (d) By `Message.exists({ tenantId, waNumberId, chatId })` on the conversation key from ticket 2/4 — an index seek that needs no session | ✅ yes |
| 3 | `implement.md` records one deviation affecting `public/contacts.html` beyond the new controls. What is it? | **(a) Two existing comments were reworded because the 3/4 suite matches the literal phrase "debug is on" over the file's source, and a new comment containing it would have failed that sibling suite** · (b) The diagnostics badge was moved from the message row to the contact row · (c) The conversation read was switched from the stored path to the live path so a toggle takes effect immediately · (d) `getConfig()` was changed to read the admin token from a new storage key | (a) Two existing comments were reworded because the 3/4 suite matches the literal phrase "debug is on" over the file's source, and a new comment containing it would have failed that sibling suite | ✅ yes |

- Score (optional, only if `comprehension_gates.ai_graded`): n/a
