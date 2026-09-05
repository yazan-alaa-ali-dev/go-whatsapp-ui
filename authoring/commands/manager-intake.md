---
command: manager.intake
description: Capture a raw business request as a seeded Business Request (Manager Workflow, C1).
owner: manager
---

# manager.intake

First command of the Manager Workflow. Captures the Manager's raw business
request as the **seed** of a Business Request and opens its provenance anchor as
a knowledge-first placeholder. It originates no business fact and stops at the
**seeded** stage.

This contract is self-contained: it states its own preconditions and
postconditions and depends on nothing outside `authoring/`.

## Purpose

Promotion consumes only qualified intent, and something must first capture the
raw need. `manager.intake` is that origination point: it turns a raw business
request into a seeded Business Request that later commands (structure, refine,
qualify) can shape, complete, and qualify.

## Owner

**Manager** — the authority and only Source of Truth. The AI Agent participates
as a **processor** only (instantiate the template, capture the raw text, record
the transition); it originates and decides nothing.

## Inputs

- `slug` (required) — id/slug for the Business Request; pattern
  `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- `raw_request` (required) — the Manager's raw business request text.
- `title` (optional) — one-line human title; defaults to a short form of the
  raw request if omitted.
- Acting authority (must be **Manager**).

## Outputs

- One seeded Business Request at `authoring/workspace/<slug>/business-request.md`,
  with the raw request captured verbatim and the provenance anchor **open**.

## Preconditions — validate BEFORE writing (abort on any failure)

- A non-empty `raw_request` exists.
- `slug` matches `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- `authoring/workspace/<slug>/` does **not** already exist (single origination).
- The acting authority is the **Manager**.

If any precondition fails, **write nothing** (atomic), report the reason, and
hold. An authority conflict is escalated to the **Owner**.

## Actions (only on all-clear)

1. Read `authoring/templates/business-request.md`.
2. Write `authoring/workspace/<slug>/business-request.md` with front-matter
   filled: `slug`, `title`, `authority: manager`, `owner` (the Manager),
   `workflow_stage: seeded`, `provenance: open`, and `captured_at:` today
   (`YYYY-MM-DD`).
3. Fill **only** the `## Raw Request (as originated)` section with the raw
   request, captured verbatim. Leave Business Goal, Business Context, Priority
   Intent, Candidate Acceptance Intent, and Readiness Judgment as their template
   placeholders — shaping them is a later command's job.

## Postconditions — validate AFTER writing

- `authoring/workspace/<slug>/business-request.md` exists and is the only file
  created.
- `workflow_stage` is `seeded`.
- The raw request is captured verbatim; **no business fact was invented,
  interpreted, or structured**.
- `provenance` is present and `open` (knowledge-first).

## Produced Artifact State

**Seeded** — an emerging Business Request holding the raw request, provenance
open, at intent altitude.

## Failure Behaviour (Hold-and-Escalate)

On any deficiency: surface it, **hold** in the Authoring Domain, and change
nothing (atomic — a failed run writes no file). Escalate cross-role or
governance conflicts to the **Owner**. Never fabricate a fact to proceed.

## AI Responsibilities

- **May:** instantiate the template, capture the raw request verbatim, fill the
  identity / stage / provenance / `captured_at` front-matter, and record the
  seeded transition.
- **Must never:** originate, alter, or interpret any business fact; set a
  priority; structure the request into the fact-classes (that is a later
  command); render any verdict; or open a live external integration.

## MUST NOT (scope / isolation)

- Create or modify anything **outside `authoring/`**.
- Introduce a dependency on any other part of the repository (no external
  commands, rules, helpers, or runtime configuration).
- Perform any live external integration; provenance stays an open placeholder.
- Promote, schedule, prioritize, or advance the artifact beyond **seeded**.

## Report

State what was created (`authoring/workspace/<slug>/business-request.md`), the
produced state (`seeded`), and the next step.

## Next step

- **Current state:** `seeded`
- **Next command:** `manager.structure <slug>` (not yet implemented)
- **Required actions:** none — the raw request is captured.
- **Optional actions:** none.
- **Terminal?** no.
