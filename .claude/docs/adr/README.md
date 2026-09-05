# Architecture Decision Records (ADRs)

Append-only log of significant or hard-to-reverse decisions. Use
[`ADR-0000-template.md`](./ADR-0000-template.md) as the starting point and number
ADRs sequentially (`ADR-0001-...md`, `ADR-0002-...md`).

Rules:

- One decision per ADR; reference the originating ticket.
- ADRs are immutable once `accepted` — to change a decision, add a new ADR that
  supersedes the old one (mark the old one `superseded by ADR-<n>`).
- A ticket references its ADRs in the relevant stage artifact.

## Index

| ADR | Title | Status | Ticket |
|-----|-------|--------|--------|
| 001 | _(reserved — not yet written)_ | — | — |
| 002 | _(reserved — not yet written)_ | — | — |
| 003 | [Ticket state ownership](./ADR-003-ticket-state-ownership.md) | accepted | workflow-phase-5.95 |
| 007 | [GitHub PR publish as a delivery-only surface](./ADR-007-github-pr-publish.md) | accepted | wf-004 |
| 008 | [Single git delivery boundary + next-step guidance](./ADR-008-delivery-commit-boundary.md) | accepted | wf-005 |

> Note: ADR-003 was assigned by the phase that created it; 001–002 are reserved
> for earlier decisions not yet retro-documented. ADR-008 extends (does not
> supersede) ADR-007.
