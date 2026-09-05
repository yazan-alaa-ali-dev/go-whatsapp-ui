---
ticket: cu-z8pmx9kcv5
stage: intake
mode: standard
status: in_progress
owner: developer
updated: 2026-08-13
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Intake — 02 · Migrate the WhatsApp session store to PostgreSQL

## Ticket Reference

| Field | Value |
|-------|-------|
| Slug | `cu-z8pmx9kcv5` |
| Title | 02 · Migrate the WhatsApp session store to PostgreSQL |
| Owner | developer |
| Created | 2026-08-13 |
| ClickUp | https://app.clickup.com/t/z8pmx9kcv5 |

## Ticket Summary

<!-- Seeded read-only from ClickUp (CU-5); task description verbatim. -->

> **Execution order:** 02 of 15 · **Depends on:** — · **Board origin:** `z8pmx9kbd2` (first half)
>
> **Reference:** `gowa-study-ar.html` §11 task 02, §12

## User Story
As **the SYSTEM**,
I want to be able to **keep WhatsApp pairing credentials in a shared PostgreSQL database instead of a local SQLite file**,
so that **the service can be restarted, containerised or scaled without the device pairings living on one machine's disk**.

Only the whatsmeow session store (`DB_URI`, currently `file:storages/whatsapp.db`) is in scope. The chat/message store is a separate database handled by ticket 14. The code already supports this: `whatsapp/database.go:37` contains an explicit `postgres:` branch, so no Go code is written in this ticket.

# Acceptance Criteria

* * *

## Scope & Tenant Safety
1. Only `DB_URI` is changed; `CHAT_STORAGE_URI` and the chat data are untouched.
2. The PostgreSQL role used by the service owns only the schema holding `whatsmeow_*` tables.

## General Behavior
1. Setting `DB_URI=postgres://…` starts the service without errors and creates the `whatsmeow_*` tables automatically.
2. Every device is re-paired by scanning a QR code, because the new store starts empty.
3. After a full process restart the devices reconnect without any new QR scan.

## Validation & Constraints
1. An unsupported URI scheme (neither `file:` nor `postgres:`) aborts startup with a clear error naming the supported schemes.
2. Database credentials are supplied through environment variables and never committed to the repository.

## Audit & Logging
1. Startup logs record which database backend is active.
2. Each successful pairing is logged with its device id.

# Test Cases

* * *

## Happy path — device survives a restart on PostgreSQL
**Given** `DB_URI` points at a reachable PostgreSQL instance
**And** a device has been paired by QR
**When** the service is stopped and started again
**Then**
*   `GET /devices/{id}/status` returns `is_connected=true` and `is_logged_in=true`
*   No QR scan is required

## Validation error — unreachable or malformed database URI
**Given** `DB_URI` points at an unreachable host or uses an unknown scheme
**When** the binary is started
**Then**
*   Startup aborts with an error naming the supported schemes `file:` and `postgres:`
*   No partially initialised store is left behind

## Authorization failure — wrong database credentials
**Given** `DB_URI` carries an invalid password
**When** the binary is started
**Then**
*   Startup fails with the driver authentication error
*   The error message does not print the password

<!-- end ClickUp description -->

## Goal

Run the whatsmeow session store on PostgreSQL instead of the local SQLite file
by pointing `DB_URI` at a PostgreSQL instance, so device pairings survive
restarts and are no longer bound to one machine's disk — without touching the
chat/message store (`CHAT_STORAGE_URI`).

## Readiness checks

Mark each check. The ticket may not leave `draft` until Readiness Status is
`READY` (RS-7).

- [x] The request has a clear, single focused outcome (one ticket = one outcome).
- [x] The goal is stated in one or two sentences.
- [x] Success is describable in observable, testable terms.
- [x] No hard-stop condition applies (see `CLAUDE.md > Hard stop conditions`).
- [x] Any deployment runtime file impact is known and called out below.

## Deployment runtime impact

**No.** Owner decision (2026-08-13): the deliverable is an **operator-side
environment change only** — `DB_URI=postgres://…` is supplied through the
runtime environment, outside the repository. No tracked file is modified, and
in particular **no deployment runtime file** (`docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml`,
`.github/workflows/set-latest-tag.yaml`) is in scope. No hard-stop applies.

If `/research` or `/plan` finds that satisfying an acceptance criterion would
require touching one of those files, that is a hard-stop: stop and obtain
Workflow Owner direction (GU-2, IM-5) rather than widening scope here.

## Open questions

1. **Open (environment prerequisite, not a blocker).** Is a target PostgreSQL
   instance available, and who provisions the role/schema owning the
   `whatsmeow_*` tables (AC "Scope & Tenant Safety" 2)? Given the operator-env
   scope, provisioning is an operator responsibility outside the repository;
   the ticket verifies the resulting behaviour, not the provisioning.
2. **Answered (owner, 2026-08-13).** Purely an operator-side environment change.
   The ticket produces workflow artifacts and verification evidence; it has no
   repository diff and no deployment runtime file in scope.
3. **Answered (owner, 2026-08-13).** The QR re-pairing of every device is
   accepted as expected, destructive cutover behaviour — no migration window is
   required and no SQLite → PostgreSQL data migration is in scope. This is an
   acceptance criterion, not a risk to mitigate.
4. **Open — to be resolved by read-only investigation at `/research`.** Are the
   audit/logging criteria ("startup logs the active backend", "each pairing
   logged with its device id") already satisfied by the existing code, or do
   they imply Go changes that would contradict both "no Go code is written" and
   the operator-env-only scope agreed above?

## Readiness Status

`READY`   <!-- set to READY once every readiness check above is marked -->
