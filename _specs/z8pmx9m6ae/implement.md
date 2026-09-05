---
ticket: z8pmx9m6ae
stage: implement
mode: standard
status: complete
owner: developer
updated: 2026-08-31
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6ae"
  github: ""
---

# Implementation — 22 · Identity foundation

Applied on branch `ticket/z8pmx9m6ae`, cut from `ticket/z8pmx9m57v` (ticket 21's
tip). Five new files, seven modified, one documentation line corrected.

## Baseline

`go test -tags purego ./...` was run on the **unmodified** tree before the first
edit. One failure existed already:

```
--- FAIL: TestResolveDocumentMIME/Zip
FAIL  github.com/aldinokemal/go-whatsapp-web-multidevice/usecase
```

It is unrelated to this ticket (document MIME sniffing) and is the same
pre-existing failure ticket 18 recorded. Every later result in this file is read
against that baseline.

**`-tags purego` is required.** Without it the SQLite driver is a CGO stub and
roughly thirty storage tests fail with "Binary was compiled with CGO_ENABLED=0".
That is an environment property, not a regression, and it cost one confused run
before it was pinned here.

## Files changed

### New

| File | What |
|---|---|
| `src/pkg/auth/perm.go` | the 25-permission catalogue, the two seeded roles, their grant sets |
| `src/pkg/auth/password.go` | bcrypt cost 12, length bounds, the timing countermeasure |
| `src/pkg/auth/auth_test.go` | TC-6, TC-7 |
| `src/infrastructure/chatstorage/user_repository.go` | the six identity repository methods |
| `src/infrastructure/chatstorage/user_repository_test.go` | TC-1, TC-3, TC-4, TC-5, TC-12 |
| `src/usecase/identity.go` | the boot seeder and the first-admin bootstrap |
| `src/usecase/identity_test.go` | TC-5, TC-8, TC-12 |

### Modified

| File | What |
|---|---|
| `src/infrastructure/chatstorage/sqlite_repository.go` | migrations 62–72 appended to `getMigrations()` |
| `src/domains/chatstorage/chatstorage.go` | `User`, `Role`, `Permission`, `RoleGrant`, the two status constants |
| `src/domains/chatstorage/interfaces.go` | the six identity methods declared |
| `src/infrastructure/whatsapp/chatstorage_wrapper.go` | the six methods delegated |
| `src/cmd/root.go` | seeder + bootstrap call sites in `initApp` |
| `src/cmd/root_test.go` | TC-9 — one case added to the existing redaction test |
| `src/infrastructure/chatstorage/sqlite_repository_account_test.go` | count assertions rescoped |
| `src/infrastructure/chatstorage/sqlite_repository_debug_test.go` | count assertion rescoped |
| `src/infrastructure/chatstorage/AGENTS.md` | "currently 61 migrations" → 72 |
| `src/.env.example` | `AUTH_BOOTSTRAP_ADMIN` documented, commented out |
| `src/go.mod` | `golang.org/x/crypto` promoted out of the `// indirect` block |

`src/go.sum` is **unchanged**: the module was already required at the resolved
version and its hashes were already present, so promoting it moved one line and
downloaded nothing.

## Deviations from the plan

### D-1 — `BootstrapAdmin` trimmed the password, contradicting its own comment

Found by `TestBootstrapAdminCredentialParsing/password_whitespace_is_preserved`,
which failed on the first run.

The function opened with `credential = strings.TrimSpace(credential)` and then
carried a comment stating the password is deliberately not trimmed. Both could
not be true: for `AUTH_BOOTSTRAP_ADMIN="admin: padded "` the outer trim removed
the password's trailing space, so an 8-character password was stored as 7 and
refused by the length bound. Had it been 9 characters it would have been stored
**silently different from what the operator typed**, and the failure would have
surfaced much later as "the password I set does not work".

Fixed by testing `strings.TrimSpace(credential) == ""` for the *is it set*
question while splitting the credential exactly as written.

### D-2 — the log line named a different user than the one stored

Observed in the test output, not asserted by any test: booting with
`AUTH_BOOTSTRAP_ADMIN="  Admin :secret"` logged
`bootstrap admin created: username="Admin"` while the row stored was `admin`.
The repository normalises (trim + lower-case); `BootstrapAdmin` only trimmed.

Fixed by logging `user.Username` — which `CreateUser` has normalised in place —
in both the created and the already-exists branches. Deliberately **not** fixed
by lower-casing in `BootstrapAdmin` too: that would put the normalisation rule in
two places, which is exactly the drift the single `normalizeUsername` chokepoint
exists to prevent.

### D-3 — the portability guard list differs from ticket 16's, on purpose

Ticket 16's schema test rejects the literal `"DEFAULT 1)"`. That guard exists to
catch `BOOLEAN ... DEFAULT 1`, which PostgreSQL rejects. It cannot be reused
verbatim here: `users.token_epoch` is an `INTEGER` whose default is legitimately
the number 1.

`TestIdentitySchemaIsPortable` therefore checks `BOOLEAN NOT NULL DEFAULT 1` and
`BOOLEAN DEFAULT 1` directly — what the original guard was always aiming at —
rather than the positional string that happened to match it. Recorded because it
looks like a weakened assertion and is not: it is a narrower guard for the same
defect, and it would still catch the construct ticket 16 was protecting against.

### D-4 — `LookupUserByUsername` was added, and is not in the plan's method list

One extra *usecase* function (not a repository method, so `IChatStorageRepository`
still grows by exactly the six the plan named). It wraps `GetUserByUsername` and
converts `sql.ErrNoRows` into `(nil, nil)`.

It exists because the raw sentinel is the kind of thing every caller gets wrong
once: ticket 23's login path must treat "no such user" as a failed login and a
read error as a 500, and the two must not collapse. Twelve lines here rather than
a bug there.

### D-5 — no `RefreshToken` domain struct

The plan already dropped every `refresh_tokens` repository method (D3 in
`plan.md`). The struct went with them: nothing in this ticket reads that table,
and a struct with no reader is the dead weight the reference document dropped
`devices.created_by_user_id` for. The table, its three indexes and the rotation
invariant are all shipped; only the Go type is deferred to the ticket that reads
it.

## What was deliberately NOT changed

- **No route, handler, middleware or basic-auth guard.** The diff touches no file
  under `src/ui/`. Basic auth remains the only enforcer, exactly as before.
- **No deployment runtime file.** `docker-compose.yml`, `docker/`, and
  `.github/workflows/` are untouched.
- **No `config` global and no cobra flag for `AUTH_BOOTSTRAP_ADMIN`.** It is read
  at the call site with `viper.GetString` and passed as an argument, so it never
  reaches `ps` output or shell history.
- **`redactedSettings()` was not edited.** It already replaces any key containing
  `auth`; the new test case pins that rather than adding a redundant rule.
- **`migrations_dialect_test.go` was not edited.** It iterates the whole list and
  picks up 62–72 automatically — it is the real portability gate, and adding a
  parallel test would have duplicated it.

## Validation run

From `src/`:

```
go build ./...                    OK
go vet ./...                      OK
go test -tags purego ./...        only the pre-existing TestResolveDocumentMIME/Zip
```

The PostgreSQL half is recorded in `verify.md`, including the one operational
detail worth carrying forward: running the **whole** chatstorage package against
the remote Supabase instance does not finish in ten minutes (each test creates,
migrates and drops its own schema over the public internet), and a killed run
leaves an orphaned `gowa_test_<pid>_<n>` schema behind. One was created and was
dropped explicitly; the database was confirmed clean afterwards.
