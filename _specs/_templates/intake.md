---
ticket: <slug>
stage: intake
mode: standard
status: in_progress
owner: developer
updated: <YYYY-MM-DD>
links:
  clickup: ""
  github: ""
---

# Intake — <title>

## Ticket Reference

| Field | Value |
|-------|-------|
| Slug | `<slug>` |
| Title | <title> |
| Owner | <owner> |
| Created | <YYYY-MM-DD> |
| ClickUp | <url or —> |

## Ticket Summary

<The request as received. When seeded from ClickUp, this is the task description
verbatim (CU-5) — seeded read-only; no workflow state is derived from it.>

## Goal

<The outcome in one or two sentences.>

## Readiness checks

Mark each check. The ticket may not leave `draft` until Readiness Status is
`READY` (RS-7).

- [ ] The request has a clear, single focused outcome (one ticket = one outcome).
- [ ] The goal is stated in one or two sentences.
- [ ] Success is describable in observable, testable terms.
- [ ] No hard-stop condition applies (see `CLAUDE.md > Hard stop conditions`).
- [ ] Any deployment runtime file impact is known and called out below.

## Deployment runtime impact

<yes/no + which files. Deployment runtime files (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) may only be modified inside an approved
`/implement` stage and only when listed in `plan.md` (GU-2, IM-5).>

## Open questions

<Anything that must be answered before research, or "none".>

## Readiness Status

`NOT_READY`   <!-- set to READY once every readiness check above is marked -->
