---
artifact: business-request
slug:                    # canonical id/slug for this Business Request
title:                   # one-line human title
authority: manager       # the originating authority (Manager Workflow)
owner:                   # accountable Manager (role or name)
workflow_stage: seeded   # seeded → structured → complete → qualified
provenance: open         # knowledge-first placeholder; System-of-Record identity handle when available
captured_at:             # YYYY-MM-DD (set when the raw request is captured)
---

# Business Request — <slug>

> Authoring artifact owned by the **Manager**. Source of Truth for the business
> facts it records. Carries **intent only** — no implementation, no technical
> approach, no final acceptance criteria, no priority value. `manager.intake`
> creates it in the **seeded** stage with the raw request captured; later
> commands shape and complete it.

## Raw Request (as originated)

<!-- manager.intake: the Manager's raw business request, captured verbatim.
     AI captures; it never interprets, structures, or adds facts here. -->

## Business Goal

<!-- Shaped in structuring (a later command). Intent altitude. -->

## Business Context

<!-- Shaped in structuring (a later command). Intent altitude. -->

## Priority Intent

<!-- The Manager's priority *intent* (a business fact). NOT a priority value,
     which is owned by the System of Record. -->

## Candidate Acceptance Intent

<!-- Acceptance expressed as *intent*, never as final acceptance criteria. -->

## Readiness Judgment

<!-- Filled at qualification (a later command): the readiness verdict, or the
     named gaps that hold the artifact. Empty while seeded. -->
