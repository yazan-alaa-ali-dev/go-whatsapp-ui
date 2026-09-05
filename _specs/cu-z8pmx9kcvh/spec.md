---
ticket: cu-z8pmx9kcvh
stage: spec
mode: standard
status: complete
owner: developer
updated: 2026-08-22
links:
  clickup: "https://app.clickup.com/t/z8pmx9kcvh"
  github: ""
---

# Specification — 14 · Migrate chat storage to PostgreSQL

## Business goal

Chat storage is pinned to one SQLite file. That makes the message volume a
property of a single-writer file and makes it impossible to run more than one
instance of the service against one dataset. Allowing the same store to run on
PostgreSQL removes both limits without changing anything a client of the API can
observe.

## User story

As **the SYSTEM**, I want to keep conversations and messages in PostgreSQL
instead of a local SQLite file, so that several service instances can share one
dataset and the message volume is no longer limited by a single-writer file.

## Functional requirements

- **REQ-1** The chat-storage backend is selected from the configured URI:
  PostgreSQL or SQLite.
- **REQ-2** `CHAT_STORAGE_URI` is readable from the environment, so the store can
  be pointed at PostgreSQL without editing source.
- **REQ-3** Every statement the chat-storage repository issues carries the
  placeholder form the active driver requires.
- **REQ-4** The schema the repository creates is valid on both backends.
- **REQ-5** SQLite-only connection tuning is applied only on the SQLite path.
- **REQ-6** The connection-pool size is chosen per backend.
- **REQ-7** Existing SQLite data can be moved into PostgreSQL, and the move
  reports what it moved.
- **REQ-8** An unsupported URI aborts startup with a message naming the supported
  schemes.
- **REQ-9** The active chat-storage backend is visible in the startup log.

## Non-functional requirements

- **NFR-1** Device scoping is preserved on every migrated query — no query may
  span devices after the port.
- **NFR-2** No API response shape changes; the dashboard needs no modification.
- **NFR-3** The default configuration keeps behaving exactly as today (SQLite,
  same pragmas, same pool size).
- **NFR-4** Search and filter semantics (case sensitivity, ordering, limits) are
  the same on both backends.

## Constraints

- **CON-1** No deployment runtime file is modified (`docker-compose.yml`,
  `docker/golang.Dockerfile`, `docker/entrypoint.sh`, the three workflows).
- **CON-2** The WhatsApp session store (`DB_URI`) is out of scope — ticket 02
  already moved it; this ticket touches only the chat store.
- **CON-3** No new module dependency: `github.com/lib/pq` is already required.
- **CON-4** Existing SQLite deployments must keep working with no config change
  and no data movement.

## Acceptance criteria

| ID | Criterion | Requirement |
|----|-----------|-------------|
| AC-1 | A driver branch selects PostgreSQL or SQLite from the configured chat-storage URI. | REQ-1 |
| AC-2 | `CHAT_STORAGE_URI` is bound to the environment; setting it to a `postgres://` URI points the store at PostgreSQL with no source edit. | REQ-2 |
| AC-3 | Every query the repository issues uses the placeholder form required by the active driver (`?` on SQLite, `$N` on PostgreSQL). | REQ-3 |
| AC-4 | SQLite-specific pragmas (WAL, busy_timeout, foreign_keys) are applied only on the SQLite path. | REQ-5 |
| AC-5 | The connection-pool size is raised on the PostgreSQL path; the SQLite path keeps its current value, and an explicit `CHAT_STORAGE_MAX_OPEN_CONNS` still wins on both. | REQ-6 |
| AC-6 | Every schema migration creates a valid object on PostgreSQL — no `AUTOINCREMENT`, no `BLOB`, no integer boolean default reaches the PostgreSQL path. | REQ-4 |
| AC-7 | Device scoping is preserved on every migrated query; no query gains a cross-device reach. | NFR-1 |
| AC-8 | Existing chats, messages, reactions, edits, transcripts and debug rows can be migrated from SQLite to PostgreSQL without loss. | REQ-7 |
| AC-9 | The data migration logs per-table row counts before and after, and fails when a table's counts do not match. | REQ-7 |
| AC-10 | Row counts for chats and messages match before and after the data migration. | REQ-7 |
| AC-11 | An unsupported URI aborts startup with an error naming the supported schemes. | REQ-8 |
| AC-12 | Startup logs the active chat-storage backend. | REQ-9 |
| AC-13 | No API response shape changes; no view/dashboard file is modified. | NFR-2 |
| AC-14 | The repository test suite passes against PostgreSQL when a test database is configured, and against SQLite unconditionally. | REQ-3, REQ-4 |
| AC-15 | A query left in the wrong placeholder form is reported by a test rather than reaching production. | REQ-3 |
| AC-16 | On the PostgreSQL path, a database role that cannot create tables makes startup fail with the privilege error and leaves no migration half-applied. | REQ-4 |
| AC-17 | With no configuration change, an existing SQLite deployment behaves exactly as before (same URI handling, same pragmas, same pool size, same schema). | NFR-3, CON-4 |
| AC-18 | Search and filter semantics — chat-name search, message search, archived filter, ordering, limits — are identical on both backends for ASCII text. (Scoped to ASCII deliberately: SQLite's `LOWER()` is ASCII-only while PostgreSQL's is locale-aware, so a non-ASCII name can match on PostgreSQL and not on SQLite. That is not a regression — today's bare `LIKE` is ASCII-only on SQLite too.) | NFR-4 |
| AC-20 | Concurrent writers on a shared database do not lose a chat, message, reaction or Chatwoot link write, and the Chatwoot forward queue does not deliver a due event more than once per instance. | REQ-1 |
| AC-19 | No deployment runtime file is modified. | CON-1 |

## Out of scope

- The WhatsApp session store (`DB_URI` / whatsmeow) — ticket 02.
- The Chatwoot direct-Postgres importer (`infrastructure/chatwoot/pgimport`) —
  it already speaks PostgreSQL and owns its own connection.
- Read replicas, sharding, connection proxies, or any multi-instance
  coordination beyond sharing one database.
- Automatic data migration at startup: moving data is an operator action.
- MySQL or any third backend.
- **Pre-existing device-scope gaps.** `GetChats` is device-scoped only when the
  caller supplies a `DeviceID` filter, and `DeleteChat` deletes by `chat_jid`
  with no device predicate. Both are unchanged by this ticket. AC-7 says no query
  *gains* a cross-device reach; it does not claim every query has one today.
- **Remaining single-instance assumptions.** The debug-retention sweeper guards
  itself with an in-process mutex, so two instances can sweep concurrently — the
  sweep is idempotent, so this costs duplicate work, not data. Index migrations
  take `ACCESS EXCLUSIVE` and briefly block every instance. Both are documented
  in the operator note rather than solved here.
- Query-plan tuning for PostgreSQL: the 50 index migrations were designed for
  SQLite's planner and are carried across unchanged. Adding
  `messages(device_id, chat_jid, timestamp DESC)`, dropping the unusable
  `idx_chats_name`, and collapsing `CreateMessage`'s two chat lookups are
  recorded as follow-ups.
