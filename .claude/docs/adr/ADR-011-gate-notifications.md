# ADR 011: Deterministic gate notifications by reusing the existing Telegram bot

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** — (Workflow Owner governance directive; applied directly to the governance corpus)
- **Deciders:** Workflow Owner

## Context

The single-owner model (ADR-009) relies on the comprehension gate for integrity,
and every gate decision should be visible to a manager for oversight/evaluation.
The `COMPREHENSION-NOTIFY-PLAN.md` proposal specified a NEW central service
(`services/notify/`, ~80 lines) to fan out email + webhook notifications.

But the server already runs Prometheus + Grafana + **Alertmanager**, which
already delivers alerts to a **Telegram bot** (the group id lives in the
gitignored `.claude/notifications.json`, never here — NT-2) and to the
configured SMTP relay. Building a second notification service would
duplicate infrastructure that already exists and is already trusted.

Two ways to "reuse" the existing stack are possible, and they are not equal:
routing gate events through the Prometheus → Alertmanager **pipeline**, versus
reusing only the **delivery channels** (the bot and the mailbox).

## Decision

Reuse the **delivery channels**, not the alerting pipeline. Gate notifications
are sent by a **local PostToolUse hook** (`.claude/hooks/notify_gate.py`) that
fires when `comprehension.md` is written and POSTs directly to the **Telegram
Bot API**, reusing the existing Alertmanager bot.

- **Reuse the channel, not the pipeline.** No Prometheus scrape target, alert
  rule, or Alertmanager route is added. That path was rejected because it (a)
  requires editing `observability/**` — a CLAUDE.md hard-stop; (b) abuses "alert"
  semantics for routine events (an `APPROVED` is not an alert); and (c) explodes
  Prometheus label cardinality (`actor`/`ticket`/`stage`).
- **Delivery is the harness's job, not the AI's.** The hook is run deterministically
  by the harness on the artifact Write — the AI cannot forget or skip it. Same
  I/O-isolation pattern as ClickUp/GitHub logic living in scripts (ADR-005/007).
- **No new service.** The proposed `services/notify/` is dropped; the hook talks to
  Telegram directly with stdlib `urllib`. An append-only audit log can be added
  later inside the hook if evaluation reporting needs it (deferred, YAGNI).
- **Credentials via env, never committed.** `WF_TELEGRAM_BOT_TOKEN` /
  `WF_TELEGRAM_CHAT_ID` (+ optional `WF_TELEGRAM_TOPIC_ID`) are read at runtime on
  the dev machine. The server keeps the bot token in an Alertmanager secret file;
  the hook reuses the same bot **identity** via its own env copy — reading a
  credential is not modifying the observability runtime.
- **warn-first (`notifications.enforcement: warn`).** Delivery failure logs and the
  gate still completes (hook exit 0). `block` (hook exit 2) is available when a hard
  guarantee is needed; a local spool + retry is the follow-up if `block` proves too
  brittle. Enforced by NT-1..NT-3.
- **Telegram first, email later.** The same `mail.ramaaz.com` SMTP relay can be
  reused for email once needed; Telegram is public-API and the most reliable reuse.
- **Dedicated topic recommended** so gate events do not mix with ops alerts.

## Consequences

- **+** Zero new infrastructure; reuses a bot and mailbox already trusted and
  watched. The proposed central service is deleted before it is built.
- **+** The observability `hard-stop` is fully respected: no `observability/**`
  file is touched; the hook only calls the public Telegram API.
- **+** Delivery is deterministic (harness-run), auditable, and uniform — not
  dependent on the AI remembering to send.
- **−** Enforcement runs only inside the Claude Code toolchain; editing `ticket.md`
  by hand bypasses the hook. A CI reconciliation check (every `closed` ticket has a
  dispatched event) is the future backstop — deferred.
- **−** `warn` mode can miss a notice if Telegram is unreachable; `block` + spool
  closes that gap when the guarantee is worth the coupling.
- Supersedes the `services/notify/` design in `COMPREHENSION-NOTIFY-PLAN.md`
  (that doc's "ADR-010" reservation is superseded — the advisory panel took
  ADR-010; this is ADR-011).

## Alternatives considered

- **Prometheus → Alertmanager pipeline** — rejected: edits `observability/**`
  (hard-stop), abuses alert semantics, and blows up label cardinality.
- **Build the proposed `services/notify/` central service** — rejected: duplicates
  the existing Telegram/SMTP delivery the server already runs; unnecessary infra.
- **Grafana/Loki dashboard for gate events** — rejected: needs a data source under
  `observability/**` and is over-infra; the Telegram notice + (optional) local log
  suffice.
- **AI sends the notice via a tool call** — rejected: agent tools are session-owner
  only (`PushNotification`) or unwired; best-effort delivery is unacceptable for
  oversight data. The hook is deterministic.
- **`block` from day one** — rejected for v1: ties every gate to Telegram uptime;
  start `warn`, escalate to `block` + spool when needed.
