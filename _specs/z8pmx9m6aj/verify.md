---
ticket: z8pmx9m6aj
stage: verify
mode: standard
status: complete
owner: developer
updated: 2026-09-01
links:
  clickup: "https://app.clickup.com/t/z8pmx9m6aj"
  github: ""
---

# Verification — 26 · User and account administration

**Outcome: PASSED**, with two items carried forward (§ Residual risks 1 and 2).

## Runtime impact

**No deployment runtime file changed.** `docker-compose.yml`,
`docker/golang.Dockerfile`, `docker/entrypoint.sh`,
`.github/workflows/build-docker-image.yaml`, `.github/workflows/release.yml` and
`.github/workflows/set-latest-tag.yaml` are untouched — confirmed by `git status`.

**One additive schema change**: migration 73,
`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)`. It
backfills nothing and rewrites no row. NFR-1 was amended for it at the panel's
insistence (AC-5's revoke is `WHERE user_id = ?` and no index led with that column).

**Six new routes**, all under `/auth/users`, all requiring `users.manage`, none naming
`:device_id` — so ticket 25's ownership assertion is unaffected.

## How the suite was run

The repository ships **two SQLite drivers**, selected by build tag, and that turned
out to matter: the `purego` tag (modernc.org/sqlite) needs no C compiler, so **the
whole suite runs on this machine** — which the previous ticket's verification did not
establish. Both tags were run, and both were compared against a **git worktree at
`bf5a28d`** (the unmodified ticket-25 tip) rather than against remembered numbers.

| | baseline (`bf5a28d`) | after | verdict |
|---|---|---|---|
| `-tags purego` | 1 failing test | 1 failing test | **identical** |
| default (cgo) | 139 leaf failures / 3 packages | 174 leaf failures / 3 packages | see below |

**`purego`** — the meaningful run. `go build ./...` and `go vet ./...` clean. The one
failure is `TestResolveDocumentMIME/Zip`, a Windows MIME-registry quirk, **byte-for-byte
present in the baseline** and unrelated to this ticket. Sixteen packages pass,
including all four this ticket touches.

**default (cgo)** — this machine has no C compiler. The 35 extra failures are exactly
the 30 new `infrastructure/chatstorage` tests plus five subtests, each failing at
`InitializeSchema` with the *same* message as the 139 baseline failures:
`Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work`. **No new
failing package**, and no failure with a cause of its own. The eight end-to-end tests
**skip** rather than fail, because they `Ping` the driver before using it.

New tests: **95** (36 repository, 26 usecase, 13 REST, 8 end-to-end, 12 validation).

## Acceptance criteria

| AC | Result | Evidence |
|----|--------|----------|
| **AC-1** — atomic create, account or user | **PASS** | `TestCreateUserWithInlineAccountCommitsBothRows`; atomicity by `TestCreateUserRollsBackTheAccountWhenTheUserInsertFails` — a real duplicate-username race, asserting **no orphan account row survives**. Also `…RollsBackWhenARoleIsUnknown`. End to end: `TestEndToEndAdminCreatesAnAccountAndItsUser`. |
| **AC-2** — list / get / patch / delete | **PASS** | `TestUserAdminCreateAnswers201` (201), `TestListUsersIsBoundedAndOrdered`, `TestGetUnknownUser` / `TestDeleteUnknownUser` (404 after delete), `TestUserAdminErrorMappings` for every code. |
| **AC-3** — roles via `user_roles`, permissions are the union | **PASS** | `TestPermissionUnionIsDeduplicatedAndSorted` (overlapping roles → deduplicated, sorted); `TestUpdateReplacesRolesRatherThanMerging`. The union is served by `BuildPrincipals` at `/auth/me`, unchanged by this ticket. |
| **AC-4** — a change bumps `token_epoch`, old tokens die at once | **PASS**, with the honest caveat below | `TestUpdateBumpsTheEpochInTheSameStatement` (engine-side `+ 1`); **`TestEndToEndARoleChangeRejectsTheOldTokenImmediately`** drives a real token through the real middleware and asserts 401 on the very next request. |
| **AC-5** — delete revokes every refresh family | **PASS** | `TestDeleteUserRevokesEveryRefreshFamily` — **two** families revoked, a third user's left live; `TestEndToEndDeletingAUserKillsTheirSession` (access token 401, refresh token unrotatable, login refused). |
| **AC-6** — `users.manage` on all six, `Require` first, coverage passes | **PASS** | `TestUserAdminRoutesPassPolicyCoverage`; and — because coverage is **order-blind** — `TestUserAdminRoutesRefuseUnauthenticated` (401 anonymous) plus `TestUserAdminRoutesRequireUsersManage` and `…AdmitTheSeededUserRoleNowhere` (403), each asserting the usecase was **never reached**. |
| **AC-7** — password set/changed, hash absent from the type | **PASS** | `TestUserAdminViewMarshalsNoPasswordField` (no field exists), `TestTheStoredValueIsABcryptHashAndNotThePlaintext` (and the hash **verifies**), `TestChangePasswordBumpsTheEpochAndRevokesTheLineage`. |
| **AC-8** — `account_id` not unique | **PASS** | `TestUsersAccountIDIsNotUnique` (schema level), `TestTwoUsersShareOneAccount`, `TestEndToEndTwoUsersInOneAccountSeeTheSameDevices` — both resolve to `acme` and both pass `MayAddressDevice`. |
| **AC-9** — end to end | **PASS in part; three steps not executable here** — see below | `TestEndToEndAdminCreatesAnAccountAndItsUser`. |
| **AC-10** — no hash, refresh token or digest in any body | **PASS** | `TestUserAdminResponsesCarryNoSecret` (every route), `TestEndToEndNoResponseCarriesAHash` (real stack, incl. the plaintext passwords), `TestAdministrationReadsSelectNoPasswordHash` (the column is never even selected). |
| **AC-11** — 404 unknown account, 409 duplicate username | **PASS** | `TestCreateUserRefusesAnUnknownAccount`, `TestCreateUserNormalisesTheUsername` (`SARA` vs `sara` → 409), `TestEndToEndConflictsAndMissingAccounts`. |
| **AC-12** — every mutation audit-logged with the acting `user_id` | **PASS** | `TestUserAdminContextCarriesActorAndPrincipal`, `TestActorReachesTheContext`. Observed in the run: `[USERS] actor="usr_admin" updated user="usr_sara" … epoch=1` — actor present, no credential. |
| **AC-13** — a created user must carry a real account | **PASS** | `TestCreateRefusesABlankAccount`, `TestCreateUserRefusesABlankAccount` (repository), `TestEndToEndAUserCreatedWithoutAnAccountIsRefused`, `TestAccountSelectionIsExactlyOne`. |
| **AC-14** — the last administrator cannot be removed (widened by the panel) | **PASS** | `TestDeletingTheLastAdministratorIsRefused`, **`TestAnyStatusTransitionAwayFromActiveTripsTheInterlock`** (four values, not just `disabled`), `TestStrippingUsersManageFromTheLastAdministratorIsRefused`, `TestTheInterlockCountsOperatorComposedRoles`. |
| **AC-15** — a committed write is visible to the next request | **PASS**, with the caveat below | `TestEveryMutationReloadsThePrincipalCache` (all four verbs), `TestAFailedReloadDoesNotFailTheWrite`, `TestASucceedingRetryIsNotRetriedAgain`. |
| **AC-16** — the privilege ceiling (added by the panel) | **PASS** | `TestCreateRefusesGrantingAPermissionTheCallerLacks`, `TestChangePasswordRefusesAMorePrivilegedTarget`, `TestDeleteRefusesAMorePrivilegedTarget`, `TestCeilingFailsClosedForAnUnidentifiedCaller`, `TestSelfDeleteAndSelfDisableAreRefused`, `TestCreateAllowsGrantingASubsetOfTheCallersOwn`. |

### AC-9, stated honestly

Six of the nine steps run against the **real** stack — real SQLite with the production
migrations, the real seeder, the real `BootstrapAdmin`, the real `AuthService` (real
HS256 signing and parsing, real principal cache), the real `Authenticate` middleware,
the real `Require` guard, the real routes:

boot with `AUTH_BOOTSTRAP_ADMIN` → log in as that admin → create account `acme` with
user `sara` (role `user`) in one call → attach a device to `acme` → log in as `sara` →
`sara` may address `acme`'s device and **not** `globex`'s and **not** the un-accounted
one.

**Three steps need a live whatsmeow session and a paired phone**, which no in-process
test can provide: `GET /chats` returning data, `POST /send/message` actually reaching
WhatsApp, and `GET /chat/:jid/messages` rendering a stored transcript. For those, what
is asserted is the part **this ticket owns and decides** — and it is asserted twice:

- `sara` holds `chats.read`; she does **not** hold `messages.send`,
  `messages.debug.read` or `messages.transcript.read`;
- a route carrying the real `middleware.Require(messages.send)` **refuses her real
  token with 403** (`assertGuardRefuses`).

That is exactly what the send guard reads, and exactly what `usecase/chat.go`'s
fail-closed redaction reads. What is not proved here is that whatsmeow returns
messages — which this ticket does not change.

### AC-4 / AC-15, stated honestly

The panel corrected a claim the plan made wrongly, and the corrected version is what
ships. "No 15-minute window" holds **whenever the cache reload succeeds** — which is
the normal path, is retried once on failure, and is proved end to end. If **both**
reload attempts fail, the write still stands and the exposure is:

| change | if the reload fails twice |
|---|---|
| status → disabled | access token valid until expiry (≤15 min); the next `Refresh` **does** revoke the whole family (`usecase/auth.go:360-365`). |
| roles / account | access token valid until expiry; `Refresh` does **not** revoke (`:367-376`) — it retries the reload and returns 500 if that fails. Self-heals on the next successful reload. |
| delete | `Refresh` fails at `GetUserByUserID` (`:344`) and returns 401; the access token survives to expiry. |

The failure is logged at ERROR and never swallowed. Returning 500 was rejected: the
write has already committed, and telling an administrator their destructive change
failed when it succeeded is worse than a bounded window.

## Mutation testing

Seven defects injected, **all seven detected**, each by the test written to catch it.

| # | Injected defect | Detected by |
|---|---|---|
| 1 | Privilege ceiling always passes | `TestCreateRefusesGrantingAPermissionTheCallerLacks` — a supervisor created themselves an `admin`. |
| 2 | `ReloadPrincipals` never called | `TestEveryMutationReloadsThePrincipalCache` **and** `TestEndToEndARoleChangeRejectsTheOldTokenImmediately`: *"the OLD token still works after a role change: status = 200"*. |
| 3 | Epoch bump dropped from the UPDATE | `TestUpdateBumpsTheEpochInTheSameStatement`. |
| 4 | Account committed before the user insert | `TestCreateUserRollsBackTheAccountWhenTheUserInsertFails`: *"ORPHAN ACCOUNT: 1 row(s) survived"* — and `…RollsBackWhenARoleIsUnknown`. |
| 5 | Interlock keyed on the literal `"disabled"` | `TestAnyStatusTransitionAwayFromActiveTripsTheInterlock` — failed on `suspended`, `inactive` and `""`, i.e. **exactly the hole the panel found**. |
| 6 | Delete stops revoking refresh families | `TestDeleteUserRevokesEveryRefreshFamily`: *"2 refresh token(s) still live"*, both still rotatable. |
| 7 | PATCH binds `account_id` unconditionally | `TestAStatusOnlyUpdateLeavesEveryOtherColumnAlone`: *"account_id = "", want acme — a status-only PATCH blanked the account"*. |

Mutants 5 and 7 are the security lens's two majors, reproduced and caught.

## A defect the tests found during implementation

The first implementation of the interlock asked only *"would this leave zero active
administrators?"* and never *"does this user administer at all?"* — so disabling an
**ordinary** user in a deployment with no live administrator was refused with "you
cannot remove the last user who can administer users". Wrong, and unactionable. Fixed
by `assertKeepsAnAdministratorTx` and pinned by three regression tests (D-2 in
`implement.md`).

## Residual risks carried forward

1. **Last-admin write skew on PostgreSQL.** At READ COMMITTED (the driver default;
   `dbHandle.Begin` exposes no isolation option) two *concurrent* removals of two
   *different* administrators can each see the other as active and both commit.
   Closing it needs `FOR UPDATE` (no SQLite equivalent — it would break the
   one-statement-for-both-engines rule) or SERIALIZABLE with retry. **SQLite, the
   default deployment, serialises writers and is unaffected.** Documented in
   `countOtherActiveAdminsTx`. **Flagged for the owner.**
2. **`-race` was not run** — it needs cgo, which this machine lacks. The new code adds
   no goroutine and no shared mutable state; the only concurrency it touches is the
   existing `PrincipalCache` atomic pointer swap, unchanged.
3. **PostgreSQL was not exercised.** `POSTGRES_TEST_URI` is unset, so every repository
   test ran on SQLite. The statements are dialect-free (`?` form through the rebinding
   handle) and the `ON CONFLICT` semantics this ticket relies on are documented against
   both engines — but the PG paths, including `isUniqueViolation` against `lib/pq`'s
   real message, are asserted from string fixtures rather than a live server.
4. **No live boot.** `AssertPolicyCoverage` is proved via `PolicyCoverageViolations`
   over an app with the routes registered, not by starting the server.
5. **`ReloadPrincipals` is O(N) per write** (three full-table reads). At operator rate
   this is nothing; a scripted bulk import of N users is O(N²) row reads. The
   performance lens proposed debouncing; it was **declined** because AC-15 requires the
   write to be visible to the *next* request. Revisit if a bulk-import endpoint is
   added.
6. **A stale-cache read amplification exists in ticket 23's code**, not this one: a
   cache miss makes `Login` and `Refresh` each issue their own snapshot read. Declined
   as out of scope; recorded for a follow-up.
7. **No rate limiter on the two hashing routes.** Declined with reasons
   (`throttle.go` argues the limiter is "necessary and NOT sufficient"; the routes sit
   behind `Require(users.manage)`; a 10/min bucket would break bulk provisioning). The
   process-wide verify slot **is** applied.
8. **`isUniqueViolation` is a string match.** Conservative by construction — a miss
   degrades a 409 to a 500, never the reverse — but a driver that rephrased its message
   would silently lose the 409.

## Conclusion

All 16 acceptance criteria are mapped to executed results. The suite under `purego` is
**identical to the baseline**; under cgo the only new failures share the baseline's own
cause, in the baseline's own packages. Seven injected defects were all detected.

**PASSED.**
