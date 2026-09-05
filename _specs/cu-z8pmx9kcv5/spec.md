---
ticket: cu-z8pmx9kcv5
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-13
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcv5"
  github: ""
---

# Specification — 02 · Migrate the WhatsApp session store to PostgreSQL

> **No implementation detail (SP-4):** no file paths, no code, no approach or
> steps. *What* and *why* only — the *how* belongs to `plan.md`.

## Business Goal  <!-- SP-1 -->

WhatsApp pairing credentials currently live in a SQLite file on one machine's
local disk, which ties every paired device to that disk. Holding them in a shared
PostgreSQL database lets the service be restarted, containerised, or moved
without losing the pairings.

## User Story  <!-- SP-1 -->

As **the SYSTEM**,
I want **to keep WhatsApp pairing credentials in a shared PostgreSQL database
instead of a local SQLite file**,
so that **the service can be restarted, containerised or scaled without the
device pairings living on one machine's disk**.

## Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| REQ-1 | The WhatsApp session store is selected by the `DB_URI` runtime setting; when it names a reachable PostgreSQL database, pairing credentials are held there instead of in the local SQLite file. |
| REQ-2 | On first start against an empty PostgreSQL database the service creates the session-store tables (`whatsmeow_*`) itself; no manual schema creation or migration step is required. |
| REQ-3 | Devices are paired by QR scan against the new store, and a paired device reports itself connected and logged in. |
| REQ-4 | Pairings survive a full process restart: after restart, previously paired devices reconnect without any new QR scan. |
| REQ-5 | A `DB_URI` whose scheme is neither `file:` nor `postgres:` aborts startup with an error that names both supported schemes, and no session-store state is created. |
| REQ-6 | A syntactically valid `postgres:` URI carrying invalid credentials aborts startup with the database driver's authentication error, and the password does not appear in the failure output. |
| REQ-7 | The chat/message store and its data are unaffected by this change: only the session store moves. |
| REQ-8 | Database credentials reach the service only through the runtime environment and are never committed to the repository. |

## Non-Functional Requirements  <!-- SP-2 -->

| ID | Requirement |
|----|-------------|
| NFR-1 | The change is operator-side configuration only: it produces no repository diff — no source change and no deployment runtime file change. |
| NFR-2 | The session key cache must not be left behind on local disk when the session store moves; it either shares the session store or points at the same PostgreSQL instance. |
| NFR-3 | The cutover is reversible: restoring the previous `DB_URI` value restores the previous SQLite-backed behaviour, with no repository change to undo. |
| NFR-4 | Verification evidence is reproducible by someone other than the author from the recorded environment values and observed service responses. |

## Constraints  <!-- SP-2 -->

- **Exact scheme spelling.** The URI must be spelled `postgres://…`. The
  `postgresql://…` spelling is **not** recognised: it is treated as an unsupported
  scheme, and the resulting startup error additionally echoes the full URI —
  password included — into the log. Using the exact `postgres:` spelling avoids
  both the failure and the disclosure. The disclosure itself is a defect and is
  raised as a separate ticket (see Out of Scope).
- **No SQLite-only query parameters.** The documented SQLite default carries a
  `?_foreign_keys=on` suffix. That parameter is meaningful only to SQLite and must
  not be carried into the PostgreSQL URI, which is passed to the PostgreSQL driver
  verbatim.
- **Key-cache setting.** `DB_KEYS_URI` must be left empty (so it follows the main
  session store) or point at the same PostgreSQL instance. A leftover `file:`
  value would keep session keys on local disk and defeat the goal (NFR-2).
- **Setting precedence.** Command-line flags outrank environment variables. No
  `--db-uri` flag may be present in the service's start command, or it would
  silently override the operator's environment value.
- **Environment prerequisite (operator-provisioned).** A reachable PostgreSQL
  instance must exist, with a role whose privileges are confined to the schema
  holding the `whatsmeow_*` tables. Provisioning is the operator's responsibility
  and is a precondition of verification, not a behaviour this service performs or
  can observe (Q-3 decision, 2026-08-13).
- **Destructive cutover, accepted.** The PostgreSQL store starts empty, so every
  existing pairing is lost and must be re-scanned. Accepted by the owner at
  intake: no migration window and no data migration.

## Edge Cases

- **Unsupported scheme** (including the `postgresql://` spelling) — startup must
  abort naming `file:` and `postgres:`; covered by AC-5.
- **Unreachable host on a valid `postgres:` URI** — startup aborts with a
  connection error; no session-store tables exist afterwards (AC-5's "no state
  created" expectation applies equally here).
- **Valid URI, wrong password** — startup aborts with the driver's authentication
  error and must not disclose the password; covered by AC-6.
- **Empty store on first start** — zero devices are loaded and each must be
  paired by QR; this is expected behaviour, not a fault (AC-2).
- **`DB_KEYS_URI` left at a `file:` value** — a misconfiguration that would split
  keys from sessions; guarded by the key-cache constraint and AC-3.

## Acceptance Criteria  <!-- SP-3 / TR-1 -->

Observable, independently testable, pass/fail. Each maps to a requirement and is
referenced by the same ID in `verify.md` (TR-2).

| ID | Criterion | Maps to |
|----|-----------|---------|
| AC-1 | With `DB_URI` set to a reachable `postgres://` URI over an empty database, the service starts without error and the `whatsmeow_*` tables exist in that database afterwards. | REQ-1, REQ-2 |
| AC-2 | After the switch, a device paired by QR scan reports `is_connected=true` and `is_logged_in=true` via its device status endpoint. | REQ-3 |
| AC-3 | After a full process stop and start, the previously paired device again reports `is_connected=true` and `is_logged_in=true` with no new QR scan required. | REQ-4, NFR-2 |
| AC-4 | The chat/message store setting is unchanged and its data remains readable after the cutover; no chat data is lost or relocated. | REQ-7 |
| AC-5 | Starting with a `DB_URI` whose scheme is neither `file:` nor `postgres:` aborts startup with an error naming both supported schemes, and no `whatsmeow_*` tables are created in the target database. | REQ-5 |
| AC-6 | Starting with a valid `postgres:` URI carrying an invalid password aborts startup with the driver's authentication error, and the password string does not appear anywhere in the startup output. | REQ-6 |
| AC-7 | All database credentials are supplied through the runtime environment, no credential value appears in any repository file, and this ticket leaves the repository with no source or deployment runtime file diff. | REQ-8, NFR-1 |

## Test Cases

At least one per acceptance criterion; each states precondition, action, and
expected result, and is reproducible by someone other than the author.

### TC-1 — Empty PostgreSQL store initialises itself (covers AC-1)

- **Given** a reachable, empty PostgreSQL database and `DB_URI` set to its
  `postgres://` URI, with `DB_KEYS_URI` empty
- **When** the service is started
- **Then** startup completes without error, and querying the target database
  shows the `whatsmeow_*` tables present

### TC-2 — Device pairs against the new store (covers AC-2)

- **Given** the service running on the PostgreSQL session store with no devices
- **When** a device is paired by scanning the QR code
- **Then** that device's status reports `is_connected=true` and
  `is_logged_in=true`

### TC-3 — Pairing survives a full restart (covers AC-3)

- **Given** a device paired as in TC-2
- **When** the service process is fully stopped and started again
- **Then** the device reports `is_connected=true` and `is_logged_in=true`, and no
  QR scan was requested or performed

### TC-4 — Chat data untouched by the cutover (covers AC-4)

- **Given** chat history present before the cutover and the chat-store setting
  recorded
- **When** the session store is switched to PostgreSQL and the service restarted
- **Then** the chat-store setting is unchanged and the previously present chat
  history is still readable

### TC-5 — Unsupported scheme aborts with a clear error (covers AC-5)

- **Given** `DB_URI` set to a URI whose scheme is neither `file:` nor `postgres:`
  (for example the `postgresql://` spelling)
- **When** the service is started
- **Then** startup aborts, the error names both `file:` and `postgres:` as the
  supported schemes, and the target database contains no `whatsmeow_*` tables

### TC-6 — Wrong password fails without disclosing it (covers AC-6)

- **Given** `DB_URI` spelled `postgres://` with a valid host but an invalid
  password
- **When** the service is started
- **Then** startup aborts with the driver's authentication error, and the full
  captured startup output contains no occurrence of the password string

### TC-7 — Credentials stay out of the repository (covers AC-7)

- **Given** the ticket's configuration applied through the runtime environment
- **When** the repository working tree and this ticket's changes are inspected
- **Then** no credential value appears in any repository file, and the ticket has
  produced no source file or deployment runtime file diff

## Open Questions

- **Q-1 (blocks `/verify`, not `/plan`).** Which PostgreSQL instance is used for
  verification, and who provisions the role and schema described in the
  environment-prerequisite constraint? Without it, AC-1..AC-6 cannot be evidenced,
  since this ticket has no repository diff for the build/vet/test checks to
  exercise.

## Out of Scope  <!-- SP-5 -->

- **The two Audit & Logging criteria from the source task** — "startup logs record
  which database backend is active" and "each successful pairing is logged with
  its device id". Neither is satisfied by the current code, and both would require
  a source change, contradicting this ticket's configuration-only scope. Raised as
  a **follow-up ticket** (Q-2 decision, 2026-08-13).
- **The unsupported-scheme password disclosure** — an unsupported `DB_URI` scheme
  echoes the full URI, including the password, into the startup error. A real
  information-leak defect, but fixing it is a source change. Raised as a
  **separate defect ticket**; mitigated here only by the exact-spelling constraint
  (Q-4 decision, 2026-08-13).
- **Migrating the chat/message store to PostgreSQL** — a separate database and a
  separate ticket (14).
- **Any data migration of existing pairings** from SQLite to PostgreSQL. The
  cutover is destructive by agreement; devices are re-paired by QR.
- **Any source code change or deployment runtime file change**, per the
  operator-env-only scope agreed at intake.
- **Provisioning the PostgreSQL instance, role, or schema** — an operator
  responsibility recorded as a constraint, not verified as a behaviour of this
  service.
