---
ticket: bug-in-show-messages
stage: verify
mode: standard          # single workflow form — no other modes (ADR-009)
status: blocked         # not_started | in_progress | blocked | complete
owner: developer
updated: 2026-08-01
links:
  clickup: https://app.clickup.com/t/86eyeknvp
  github:
---

# Verify — bug-in-show-messages

> Final validation and impact review before the ticket is closed.

> ## ⚠ FINAL OUTCOME: ACCEPTED BY OWNER WAIVER — **NOT VERIFIED**
>
> **No acceptance criterion was executed. Verification did not pass; it was
> waived.** On 2026-08-02 the ticket owner elected to publish without completing
> `all-ac`, taking acceptance testing on themselves after the PR is open. The
> ticket was moved to `verified` **solely to satisfy `/publish-pr`'s PB-1
> precondition** — that state does **not** mean the criteria were checked.
>
> The evidence tables below are unchanged and remain accurate: **12 of 18 criteria
> were never executed.** Anyone reading this later should treat the `verified`
> state as an administrative unblock, not as evidence. Full detail in §9.

**Verification outcome on the evidence: FAILED (blocked) — no defect found; the
acceptance evidence cannot be produced in this environment.** Verification depth is
`all-ac` (MO-6/VF-4): every criterion must map to an **executed** result. There is no
live WhatsApp session here and none will become available, so the runtime criteria are
recorded as NOT EXECUTED and will be executed by the owner. **No runtime result is
inferred, simulated or assumed anywhere in this document.**

This pass extracted every confirmation obtainable from source, so that what remains
for the live session is minimal and precise: **12 of 18 criteria now carry a static
confirmation** (up from 6), and the mechanism introduced by plan revision 6 — the
part most likely to be wrong and the reason `/review` returned the plan a sixth
time — is fully confirmed from source below.

## Verification run log

| Run | Date | New evidence available | Executed result | Outcome |
|-----|------|------------------------|-----------------|---------|
| 1 | 2026-08-01 | — | `node-source` profile passed; 6 criteria confirmed statically | **FAILED (blocked)** — `all-ac` unsatisfiable without a session |
| 2 | 2026-08-01 | none — checked `implement.md`, both runtime observations still marked *Not captured*; working tree unchanged | `node-source` profile re-executed on all four files, all exit 0; static confirmation extended to 12 criteria (§1-§2) | **FAILED (blocked)** — same reason, unchanged |
| 3 | 2026-08-01 | none — both observations still *Not captured*. **But the branch is now committed** (`3b60450`, `f4fe7ef`), made outside the workflow | New check available and executed: the reviewed mechanism is present in the **committed** content, not just the working tree — `git show HEAD:services/resilientChats.js` contains `widObject(wid)` and `getAsModel: false`; `git show HEAD:routes/history.js` contains `resolveChat(client, chatId)` in **both** handlers. So what would be published matches what was reviewed | **FAILED (blocked)** — the four NOT EXECUTED criteria are unchanged |

**Run 2 note.** The static confirmations were extended and re-executed, but no
acceptance criterion changed state, because nothing that was NOT EXECUTED can become
executed without a live session. Re-running `/verify` again without one will produce
this same outcome — the repetition is not a defect in the ticket, it is the
procedural deadlock recorded in §6: the evidence needs a deploy, and the workflow
gates deploying behind the very verification it would satisfy.

## 1. Static confirmation of the revision-6 fix

The revision-6 defect was that reusing the list row's flattened `id` string to
construct the `Chat` instance would make `this.id._serialized` undefined and throw
for **every** conversation. Confirmed line by line that the shipped code does not do
that. All references are to the working tree on `ticket/bug-in-show-messages`.

| Claim | Confirmed at | Evidence |
|-------|--------------|----------|
| The single-chat read returns `id` as a **WID-shaped object**, not the flattened string | `services/resilientChats.js:297` | `id: widObject(wid)` — where `widObject` (`:115-123`) returns `{ _serialized, user, server }`, splitting on `@` |
| …built from the **repaired** identifier | `services/resilientChats.js:294` | `const wid = chatWid(chat.id);` → `jidPart` (`:86-94`): `_serialized` → `$1` → `user@server`; returns `null` if unrepairable, and `buildChatModel` then returns `null` (`:295`) rather than a broken model |
| …and is **demonstrably not** the list-row shape | `:274` vs `:297` | list row is `id: wid` (a **string**, for the HTTP contract); single-chat model is `id: widObject(wid)` (an **object**, for `Chat._patch`). The two shapes exist side by side in one file and cannot be confused |
| Returns `formattedTitle`, `isGroup`, `unreadCount`, `t` in the **library's** field names | `services/resilientChats.js:298-302` | `formattedTitle:`, `isGroup: Boolean(chat.groupMetadata)`, `unreadCount: Number(...)`, `t: Number(...)` — exactly the fields `Chat._patch` reads (`structures/Chat.js:22,28,46,52`) |
| Resolves with **`getAsModel: false`**, so no chat model is built in-page | `services/resilientChats.js:377` | `chat = await W.getChat(chatId, { getAsModel: false });` — upstream calls `getChatModel` only when `getAsModel && chat` (`Utils.js:587-589`), so the group branch (`:645-655`) is unreachable |
| Node constructs the `Chat` instance from that model and does **not** call `client.getChatById` | `services/resilientChats.js:496`, `routes/history.js:95`, `:237` | `return ChatFactory.create(client, result.model);` (import at `:39`); both handlers call `const chat = await resolveChat(client, chatId);`. `grep` for `getChatById` in `routes/history.js` returns only comment lines (`:20`, `:91`, `:233`) — no call site |
| **Only `fetchMessages`** is used from the instance | `routes/history.js:99`, `:241` | `const messages = await chat.fetchMessages({ limit: limit || 10 });` and nothing else. (`chat.` also appears at `:334`, `:396-397`, but those are inside `/get-all-messages` (`:327`) — the pre-existing dead handler with an undefined `client`, untouched by this ticket) |

**All seven hold. No defect found in the revision-6 mechanism.**

## 2. Additional static confirmations

| # | Property | Confirmed at | Evidence |
|---|----------|--------------|----------|
| S-1 | Suffix allow-list present in **both** `get-messages` copies | `routes/history.js:22`, `:87`, `:229` | `ALLOWED_CHAT_SUFFIXES = ["@c.us", "@g.us", "@lid"]`; both handlers call `toChatId(number)` (tenant-scoped handler at `:38`, admin at `:186`) |
| S-2 | `@c.us` appended **only** when no domain is present | `routes/history.js:31-36` | `if (raw.indexOf("@") === -1) return \`${raw}@c.us\`;` then the allow-list test. Executed directly: `966501234567`→`…@c.us`; `…@c.us`/`…@g.us`/`…@lid` unchanged; `x@newsletter`, `status@broadcast`, `""`, `null` → `null` |
| S-3 | Both contacts endpoints read through the reader — one path | `routes/tenants.js:1017`, `:1110` | `const result = await readChats(session.client);` in each; `grep "client.getChats()"` over the file returns nothing |
| S-4 | In-page ordering by `t` happens **before** the 500 cap | `services/resilientChats.js:324-325` | `const ordered = all.slice().sort((a, b) => (Number(b && b.t) || 0) - (Number(a && a.t) || 0));` then `const selected = ordered.slice(0, maxChats);` (`maxChats: 500`, `:45`) |
| S-5 | Last message: collection tail first, bounded | `services/resilientChats.js:177`, `:185-189` | `msgs.last()` first; else `msgs.getModelsArray()` walked backwards from `arr.length - 1` down to `Math.max(0, arr.length - scanLimit)` with `tailScan: 20` (`:49`) |
| S-6 | Fallback is repaired `lastReceivedKey` + **`Store.Msg.get` only** | `services/resilientChats.js:203-211` | `const serialized = msgKey(key);` then `store.get(serialized)`. **No `getMessagesById` call exists** — `grep` finds the identifier only at `:199`, inside the comment recording that the upstream clause is deliberately not ported |
| S-7 | Probe → install → read in a **single** `page.evaluate`, in-page marker, no Node-side flag | `services/resilientChats.js:390-397`, `:439`, `:486` | `const installed = W.__resilientChats && W.__resilientChats.__version === version; if (!installed) install();` then the read — all inside `pageEntry`, invoked by one `page.evaluate(pageEntry, READER_VERSION, …)` per request. No installation state is held in Node |
| S-8 | 2s wall-clock budget, yield every 50 chats | `services/resilientChats.js:46-47`, `:335`, `:368` | `budgetMs: 2000`, `yieldEvery: 50`; `if (Date.now() - started > budgetMs)` breaks with the remainder counted into `truncated`; `await new Promise((resolve) => setTimeout(resolve, 0));` after each batch |
| S-9 | Fixed reason codes only, 100-entry caps | `services/resilientChats.js:48`, `:306-309`, `:350`, `:359` | `reportCap: 100`; codes are the fixed set `chat-wid-unrepairable`, `key-unrepairable`, `preview-unresolved`, `builder-threw`, `collection-missing`; overflow increments `dropped` |
| S-10 | Identifiers/reasons go to the **log only**, never to the HTTP response | `services/resilientChats.js:405-425`, `routes/tenants.js:1046-1052` | `logReport()` writes `chat=… reason=…` via `console.warn`; `readChats` returns only `skippedCount`/`degradedCount`/`truncatedCount`, and the endpoints put only those counts plus `allUnreadable` in the body |
| S-11 | Upstream reference comment names the version and exact lines | `services/resilientChats.js:27-38` | "Pinned against whatsapp-web.js@1.34.6" followed by `Utils.js:584-589`, `:621-624`, `:633-676`; `structures/Chat.js:22,28,46,52`, `:203,222`; `structures/Message.js:55,67,131` |
| S-12 | Delegated listener carrying **only** the chat id | `public/contacts.html:521`, `:651-655` | `data-contact-id="${escapeHtml(contact.id)}"`; one `contactsList.addEventListener('click', …)` resolving `evt.target.closest('.contact-item')` then `selectContact(row.dataset.contactId, row)`. The row object is looked up from `allContacts` inside `selectContact` (`:549`) |
| S-13 | Active-row highlight no longer uses the implicit global `event` | `public/contacts.html:556` | `if (rowElement) rowElement.classList.add('active');` — the element is passed in explicitly |
| S-14 | Escaping at **render time only**, not into `allContacts` | `public/contacts.html:505-530`, `:625-637`, `:441` | `escapeHtml()` applied inside `renderContacts()` and `renderMessages()`; `allContacts = data.contacts` stores raw values, so `filterContacts()` (`:497-504`) searches unescaped text |
| S-15 | Null display-name handling | `public/contacts.html:513`, `:560`, `:499` | `contact.name || String(contact.id || '').split('@')[0]` in rendering and in the header; the filter uses `String(contact.name \|\| contact.id \|\| '')` |
| S-16 | `encodeURIComponent` on `waNumberId` | `public/contacts.html:439` | `…/admin/wa-numbers/${encodeURIComponent(currentWaNumberId)}/contacts` |
| S-17 | Full chat id passed; message limit 30 | `public/contacts.html:587-588` | `number: currentContactId` (no `split('@')[0]`), `limit: 30` |
| S-18 | `showError` no longer interpolates into `innerHTML` | `public/contacts.html:396-404` | builds a `div.error` and sets `box.textContent` |

## 3. Acceptance-criteria coverage (TR-2 / VF-2)

Legend — **PASS (static)**: confirmed by executing a command or reading the exact
code path; sufficient for that criterion. **NOT EXECUTED**: needs a live connected
session and/or a deployed page — no result claimed. **PARTIAL (static)**: the
mechanism is confirmed in source; the observable behaviour still needs the session.

| AC ID | Check / test case | Command (resolved) | Exit | Output summary | Result |
|-------|-------------------|--------------------|------|----------------|--------|
| AC-1 | Screen renders a conversation list for a connected number | — | — | Needs a connected session | **NOT EXECUTED** |
| AC-2 | `GET /api/admin/wa-numbers/:id/contacts` returns the list | — | — | Reader wired at `routes/tenants.js:1110` (S-3); response never observed | **PARTIAL (static)** |
| AC-3 | Tenant-scoped endpoint returns the same for the same number | — | — | Same reader, same path (`:1017`, S-3), so the two bodies cannot diverge; response never observed | **PARTIAL (static)** |
| AC-4 | Selecting a conversation loads its messages, incl. a group row | — | — | **The mechanism is fully confirmed in §1** (WID-shaped model, `getAsModel: false`, `ChatFactory`, no `getChatById`, only `fetchMessages`), plus S-1/S-2 for the group id and S-17 for passing it. Rendering never observed | **PARTIAL (static)** |
| AC-5 | Group conversations present, with name and group badge | — | — | `isGroup` derived from `chat.groupMetadata` without calling `getChatModel`; badge rendered at `contacts.html:526`. Presence in a real list never observed | **PARTIAL (static)** |
| AC-6 | One unreadable conversation is skipped, the rest still listed | — | — | Isolation implemented (per-chat guard + `Promise.allSettled`, `services/resilientChats.js:339-341`); requires a **runtime-forced rejection from the page** per `plan.md` Validation strategy → "How AC-6 and AC-7 are evidenced". Not captured at `/implement` | **NOT EXECUTED** |
| AC-7 | Every skipped conversation appears in the log with chat + reason | — | — | `logReport()` confirmed (S-9, S-10); log lines only exist once the reader runs against a session | **NOT EXECUTED** |
| AC-8 | Connected number with no chats returns an empty list successfully | — | — | `allUnreadable` is set only when `contacts.length === 0 && skippedCount > 0`, so a genuinely empty account stays a plain success | **PARTIAL (static)** |
| AC-9 | "None readable" stated distinctly from "no conversations" | — | — | Endpoint sets `allUnreadable` (`routes/tenants.js:1049`) and on a collection miss (`:1026`); `loadContacts()` branches to a distinct banner before `renderContacts()` (`contacts.html:456-462`) | **PASS (static)** |
| AC-10 | Name, preview, time, most-recent-first ordering | — | — | In-page ordering by `t` confirmed (S-4) and the endpoint's existing sort retained; the **outbound-last-message** case is exactly what needs a real session | **NOT EXECUTED** |
| AC-11 | Unknown number / inactive / no session / not connected stay distinct | `grep` over `routes/tenants.js` | 0 | All four guards intact in both endpoints (`:992`, `:996`, `:1004`, `:1010`; `:1083`, `:1089` + session guards); untouched | **PASS (static)** |
| AC-12 | Screen shows the actionable reason, not a generic failure | — | — | `showError()` renders the server's `data.error` via `textContent` (S-18); the 500 branch's `details` is not surfaced | **PASS (static)** |
| AC-13 | Loading indicator cleared on success **and** failure | — | — | Success → `updateHeaderInfo()`; `catch` → `clearLoadingIndicator()` (`contacts.html:467-476`) | **PASS (static)** |
| AC-14 | Unauthenticated request rejected before any conversation data | `grep` over `routes/tenants.js`, `server.js`, `middleware/tenantContext.js` | 0 | `adminAuth` on the admin route (`tenants.js:1072`); `router.use("/tenants/current", tenantContext)` (`:116`); `tenantContext` returns 401/403 before any handler body runs | **PASS (static)** |
| AC-15 | Another tenant's number stays not-found on the tenant-scoped view | — | — | `WhatsAppNumber.findOne({_id: id, tenantId})` → 404 on miss; unchanged by this ticket | **PASS (static)** |
| AC-16 | Existing response fields unchanged; new fields additive | field-by-field read | — | `success`, `waNumberId`, `tenantId`, `phoneNumber`, `label`, `contacts` unchanged; `allUnreadable`, `skippedCount`, `degradedCount`, `truncatedCount` added. Row keeps `id`, `name`, `isGroup`, `unreadCount`, `lastMessage`, `timestamp`; `lastMessage` keeps `{id, body, timestamp, fromMe, type}` | **PASS (static)** |
| AC-17 | Inbound handling, webhook relay and sending behave as before | `git status` | 0 | No inbound/send file is in the diff — the four changed files are the reader, the two route files and the screen. "Behaves as before" remains a runtime claim | **PARTIAL (static)** |
| AC-18 | Fix present and effective after a clean rebuild and redeploy | — | — | Needs a rebuild and redeploy | **NOT EXECUTED** |

**Coverage: all 18 mapped — 8 PASS (static), 6 PARTIAL (static), 4 NOT EXECUTED,
0 failing.** `all-ac` requires an executed result for each, so **PASSED cannot be
recorded**.

### Evidence beyond AC coverage (NFR-5)

Not collected — chat count, group count, wall-clock against the 5-second tolerance,
preview coverage, `truncated`/`dropped`, and the WhatsApp Web build all require the
live read. NFR-5 has no acceptance criterion and one cannot be added (see Open
items), so this does not change the arithmetic above, but it remains outstanding.

## 4. Commands run

- `node --check services/resilientChats.js` — exit 0
- `node --check routes/tenants.js` — exit 0
- `node --check routes/history.js` — exit 0
- `node --check <script block extracted from public/contacts.html>` — exit 0

  ```
  PASS  services/resilientChats.js
  PASS  routes/tenants.js
  PASS  routes/history.js
  PASS  public/contacts.html (extracted script)
  ```

- `toChatId()` exercised directly — see S-2 for the input/output table.
- `git status --porcelain` — exactly the four planned files plus this ticket's
  `_specs/` artifacts.
- `git log --oneline -1` — `96e77b2` (`main`'s tip): **no commit** created by
  `/implement` (IM-9) or `/verify` (VF-10).

No implementation file was modified by this command (VF-7).

## 5. Deployment runtime impact review

- Were any deployment runtime files (`docker-compose*.yml`, `Dockerfile`,
  `docs/nginx-whatsapp.conf`, `docs/*-staging.yml`) changed by this ticket? **No.**
- The only changed paths are `services/resilientChats.js`, `routes/tenants.js`,
  `routes/history.js` and `public/contacts.html`. None of `docker-compose.yml`,
  `docker-compose.prod.yml`, `Dockerfile`, `docs/nginx-whatsapp.conf`,
  `docs/build-and-push-staging.yml` or `docs/deploy-staging.yml` appears in the diff,
  and none was listed in the approved `plan.md` (GU-2/IM-5 hold).
- No dependency, lockfile, schema, migration or configuration change, so the
  deployment surface is unchanged and rollback is a redeploy of the previous image.

## 6. Open items for the Workflow Owner

1. **Procedural deadlock — verification requires a deploy, but deploying requires a
   commit that only a successful verification unlocks.** Completing `all-ac` needs the
   branch running against a connected session. `/implement` creates **no** commit
   (IM-9) and `/verify` creates none (VF-10); the single publishable commit is owned
   by `/publish-pr`, whose precondition is `state ∈ {verified, closed}` (PB-1) — i.e.
   it runs only *after* verification succeeds. The workflow therefore has no defined
   route from "code written" to "code deployed for acceptance testing". Today the only
   way through is an out-of-band deploy of the working tree, which the workflow neither
   describes nor sanctions. **Raised for a governance decision** — it will recur on
   every ticket whose acceptance criteria are runtime-observable, which is most of them
   in this repository.
2. **NFR-5 has no acceptance criterion and one cannot be added.** `/spec` accepts only
   `state: ready-for-research`, and although `spec-complete → research-complete` is a
   legal edge in `project-config.yaml > lifecycle`, **no command implements it**. The
   measurement is carried as evidence beyond AC coverage instead.
3. **Follow-up ticket candidates** already recorded in `plan.md` "Out of scope": the
   pre-existing duplicate tracking-group creation in `services/shipmentTracking.js`;
   deleting the dead `/get-all-messages` handler (`routes/history.js:327`, undefined
   `client`, no auth middleware); converging the older in-page overrides in
   `services/messagingService.js` and `services/whatsapp.js`; reducing the
   message-pane per-message cost.

## 9. Owner waiver — recorded 2026-08-02

**Decision.** The ticket owner (hassan) elected to **waive verification** and publish
the branch, taking the live acceptance testing on themselves afterwards.

**What is true at the moment of this waiver:**

- **No acceptance criterion has been executed.** Coverage stands at 8 PASS (static),
  6 PARTIAL (static), 4 NOT EXECUTED, 0 failing — and "static" means read from source,
  not observed running.
- `all-ac` (MO-6/VF-4) is **not** satisfied. VF-3 — "PASSED requires every AC result
  to pass" — is **not** satisfied.
- The defect's real exception has **never been observed**. The root cause remains the
  hypothesis in `research.md`; the implementation makes it moot for the contact list
  by never calling the failing code, but does not confirm it.
- The two riskiest behaviours are **unverified**: whether a group row carries a
  non-empty `id` (an unrepaired chat WID would break opening it), and whether ordering
  is correct for a chat whose last message is outbound (the `lastReceivedKey`
  direction trap).

**What this waiver does and does not do:**

- It moves `ticket.md > state` to `verified` **only** so `/publish-pr` clears PB-1.
- It records **no** `PASSED` result and **no** `verification-passed` history event,
  because neither happened. The history event is `verification-waived`.
- It does **not** close the ticket. `closed` would assert the work is done; the
  acceptance testing is still outstanding, so the ticket stays open.
- The comprehension check (CG-1..CG-4) was **not** run for this outcome. CG-1 gates
  the recording of PASSED, and no PASSED is being recorded.

**Deviation from the workflow, stated plainly.** This departs from **VF-3** (PASSED
requires all ACs to pass), **VF-5** (only a passing `/verify` advances to `verified`),
and **CL-1**. It is an owner decision taken with the consequences above in view, not
an oversight and not an inference by the assistant. **The `verify.md` §8 checklist
remains the outstanding work** and should be run before this PR is merged.

**Recommended guard:** the PR should not be merged until §8 has been executed. If any
check there fails, the correct response is `/implement` (resume) to fix it — not to
treat this waiver as acceptance.

## 7. Sign-off

- Outcome: **waived by the owner** (2026-08-02) — see §9. On the evidence alone the
  outcome was **blocked**: verification not executable here, no defect found.
- Final ticket state: `verified` (`status: active`) **by waiver, not by verification**
  — set only to satisfy `/publish-pr`'s PB-1. **Not** closed: the acceptance testing
  in §8 is still outstanding.
- Sign-off: hassan (`developer`) — single self sign-off.
- Commit: none created at verify (VF-10 / ADR-008).
- Notes: the comprehension check was not run. CG-1 gates the recording of **PASSED**;
  since PASSED is not recorded, the quiz would gate nothing, and CG-4 (any wrong
  answer records no decision) is incoherent applied to a FAILED outcome. It runs at
  the re-verify, where PASSED is on the table.

## 8. Live acceptance checklist — executable in one session

Prerequisites: the branch `ticket/bug-in-show-messages` deployed, and a WhatsApp
number in `active` status with a **connected** session that has **at least one group
chat** and at least one chat whose **last message was sent by us** (outbound).

**Record first**

- [ ] **WhatsApp Web build string.** In the page's DevTools console:
      `document.querySelector('meta[name="version"]')?.content || window.Debug?.VERSION`
      — record whatever it returns, next to the date/time. Every observation below is
      only valid against this build.
- [ ] Server log follow: `docker compose logs -f whatsapp-server`.

**A. Contact list — AC-1, AC-2, AC-5, AC-10**

- [ ] Open `https://<host>/contacts.html?waNumberId=<id>`.
- [ ] **AC-1** — the left pane lists conversations (not the red "Failed to fetch
      contacts" banner), and the header shows the phone number instead of "Loading…".
- [ ] **AC-2** — DevTools ▸ Network ▸ `GET /api/admin/wa-numbers/<id>/contacts` is
      **200** with `success: true` and a non-empty `contacts` array. Save the response
      JSON.
- [ ] **AC-5** — at least one row shows the **👥 Group** badge, **and in the saved JSON
      that row's `id` is a non-empty string ending `@g.us`.** *(An empty or `undefined`
      `id` here means the chat WID was not repaired — a real defect, not a UI nit.)*
- [ ] **AC-10** — rows are newest-first and match WhatsApp's own order; each shows a
      name, a preview and a time. **Then find a chat whose last message you sent** and
      confirm its preview is that outbound message, not an older inbound one, and that
      it sits in the right position. *(This is the `lastReceivedKey` direction trap.)*

**B. Message pane — AC-4**

- [ ] Click an **individual** contact — messages load, media renders, your own
      messages are right-aligned.
- [ ] Click the **group** row — messages load the same way. *(This is what plan
      revision 6 exists for; a 500 here means the chat handle is wrong.)*

**C. Empty and degraded states — AC-8, AC-9**

- [ ] **AC-8** — if a connected number with no conversations is available, the screen
      shows the empty state and the response is `200` with `contacts: []` and
      `allUnreadable: false`.
- [ ] **AC-9** — record `skippedCount` / `degradedCount` / `truncatedCount` from the
      saved JSON. If `allUnreadable` is ever `true`, the banner must read "No
      conversation could be read…", not an empty list.

**D. AC-6 / AC-7 — forced rejection, from the page only (VF-7: do not edit source)**

In the DevTools console of the WhatsApp Web page (the Puppeteer page, not the
dashboard), break exactly one chat's build, then reload the dashboard:

```js
// Pick the first chat and make its serialize() throw, so the per-chat guard fires.
const c = (window.Store?.Chat || window.require('WAWebCollections').Chat).getModelsArray()[0];
console.log('target chat:', c.id?._serialized || c.id?.$1);
c.serialize = () => { throw new Error('forced'); };
```

- [ ] **AC-6** — reload `contacts.html`: the request is still **200** and the other
      conversations are listed; only the targeted one is missing.
- [ ] **AC-7** — the server log shows `[contacts] skipped chat=<id> reason=<code>`
      naming that chat, with a code from the fixed set. Confirm no message text
      appears in the line.
- [ ] Reload the WhatsApp Web page to undo the console patch.

**E. Guards and authorization — AC-11, AC-12, AC-14, AC-15**

- [ ] **AC-11** — record the status and body for: an unknown `waNumberId` (**404**), a
      number with `status != active` (**400**), a number with no session (**503**), and
      a number whose session exists but is disconnected (**400**).
- [ ] **AC-12** — for the disconnected case the banner shows "…is not connected.
      Please connect the WhatsApp number first.", not a generic failure.
- [ ] **AC-13** — on that same failure the header is **not** stuck on "Loading…".
- [ ] **AC-14** — `curl` both endpoints with **no** `Authorization` header and record
      the actual codes: admin → `adminAuth`'s rejection; tenant-scoped → **401** from
      `tenantContext` (403 if the tenant is inactive). Confirm no conversation data.
- [ ] **AC-15** — call the tenant-scoped endpoint with a credential for tenant A and a
      `waNumberId` owned by tenant B → **404**, no data.

**F. AC-3 — tenant-scoped parity**

- [ ] With a tenant API credential, `GET /api/tenants/current/wa-numbers/<id>/contacts`
      returns the same conversation set as A.

**G. No regression — AC-17**

- [ ] Send a message to the connected number from another phone; confirm it is
      received and that the AI-agent webhook reply is still relayed back.

**H. Rebuild — AC-18**

- [ ] Rebuild the image and redeploy, reopen `contacts.html`, confirm the list still
      loads. *(This is what proves the fix is not a live-page-only artifact.)*

**I. NFR-5 numbers (evidence, not an AC)**

- [ ] For the largest available account, record: chat count, group count, wall-clock
      for the contacts request (tolerance **5 s**), how many rows came back with an
      empty preview (preview coverage), and `truncatedCount` / `dropped`.

**J. The real exception — outstanding from `/implement`**

- [ ] From the log, copy **verbatim** the first `[contacts] degraded chat=… reason=…`
      or `skipped` line produced by real (unforced) traffic, and paste it into
      `implement.md`. This is still the first direct observation of the defect; the
      root cause remains the `research.md` hypothesis until it exists.

**When the checklist is complete:** run `/implement bug-in-show-messages` (resume
path) to record the captured evidence in `implement.md`, which returns the ticket to
`implemented`; then `/verify bug-in-show-messages`.
