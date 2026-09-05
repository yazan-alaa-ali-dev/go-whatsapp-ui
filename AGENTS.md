# AGENTS.md — repository map for `gowa-ui`

Orientation file for any agent (or new engineer) working here. Governance lives
in [`CLAUDE.md`](CLAUDE.md); this file only answers *where things are* and *how
this codebase is written*. **Always confirm against the actual code** — a map
drifts, the code does not.

---

## WHAT THIS IS

`gowa-ui` is the web dashboard (SPA) for the **GOWA** multi-device WhatsApp API
server. It is a pure client: it holds no data of its own, and every capability
it exposes is a call to the GOWA REST API plus a WebSocket event stream.

- **Stack:** React 19 + TypeScript, Vite 8, Tailwind CSS 4, shadcn/ui over
  radix-ui, TanStack Query (server state), zustand (client state),
  react-router-dom (`HashRouter`), axios, `sonner` toasts, `next-themes`.
- **Build:** `vite-plugin-singlefile` emits **one** `dist/index.html` with zero
  external requests. CI asserts `dist/` contains exactly one file.
- **Distribution:** a `v*` tag publishes the asset `gowa-ui.html`; the GOWA
  backend downloads `releases/latest` by that exact name and serves it at `/`.
- **npm project root = repository root.** Application code is under `src/`.

### The backend contract

[`docs/gowa-frontend-reference-ar.html`](docs/gowa-frontend-reference-ar.html) is
the **authoritative** description of the backend the UI codes against (auth,
account and device scoping, permissions, WebSocket, message shape, error codes).
Where it disagrees with what the current UI does, **the document is right and the
UI is out of date** — the UI predates several of these layers. Read it before
planning any change that touches the server contract.

---

## WHERE TO LOOK

| I need to… | Go to |
|---|---|
| Call a REST endpoint | `src/api/` (one module per API area) |
| Change the shared HTTP behaviour (auth header, device header, 401) | `src/lib/http.ts` |
| Change WebSocket connect / reconnect / event routing | `src/lib/ws.ts`, `src/lib/events.ts`, and the `onWsEvent` switch in `src/App.tsx` |
| Add or change server-state fetching | `src/hooks/` (TanStack Query) |
| Add or change client state | `src/stores/` (zustand) |
| Build a feature screen or form | `src/features/<area>/` |
| Reuse a UI primitive | `src/components/ui/` (shadcn, generated) |
| Reuse a composed widget | `src/components/shared/` |
| Change the shell / nav / device switcher | `src/components/layout/` |
| Add a route | `src/pages/` + the `<Routes>` table in `src/App.tsx` |
| Pure helpers (JID, URL, format, backoff, cURL, errors) | `src/lib/` |
| Change build / dev proxy | `vite.config.ts` — **deployment runtime, hard stop** |

---

## CODE MAP

```
src/
  api/         Typed REST clients, one module per API area:
               app, call, chat, devices, group, message, newsletter, send, user.
               types.ts holds the shared envelope + DTOs.
               request.ts defines ApiRequest/exec — a request is *described*
               first so the same value can be executed and rendered as cURL.
  lib/         Cross-cutting primitives, no React:
               http.ts   axios instance + request/response interceptors
                         (baseURL, auth, X-Device-Id, 401 handling) and the
                         results()/envelope() unwrappers for {code,message,results}
               ws.ts     WsClient singleton + useWsStore; sync() reconciles the
                         socket against connection + device selection
               events.ts the WsEvent type and the emit/onWsEvent bus
               jid/url/format/backoff/curl/api-error — pure, unit-tested
  stores/      zustand: connection (server URL + session), device (selection),
               recipient. Persisted stores use a *versioned* name
               ("gowa-ui.connection.v1") — changing a shape means changing the
               version, or you break state already saved in users' browsers.
  hooks/       TanStack Query wrappers (use-devices, use-app-info,
               use-device-avatar) and use-action-mutation / use-device-guard.
  features/    Feature UI, grouped by domain: account, call, chat, devices,
               group, message, messaging, newsletter, send, session.
  components/
    ui/        shadcn/ui primitives (generated — see components.json). Treat as
               vendored: regenerate rather than hand-edit where possible.
    shared/    Composed reusables (page-header, result-panel, curl-dialog,
               recipient-field, file-or-url-input, empty-state, action-card…).
    layout/    app-shell, device-switcher, theme-toggle, ws-badge, logo.
  pages/       One file per route: dashboard, messaging, groups, chats, account,
               misc, settings, connect. Routes are declared in App.tsx.
  App.tsx      Route table + bootstrap (connection boot, ws sync, ws → query
               invalidation).
  main.tsx     Providers: QueryClient, ThemeProvider, Tooltip, HashRouter, Toaster.
  index.css    Tailwind v4 entry + design tokens.
```

Supporting directories: `docs/` (backend reference), `_specs/` (workflow ticket
artifacts), `.claude/` (workflow config, commands, rules, agents),
`scripts/` (ClickUp intake + GitHub publish helpers), `authoring/`.

---

## CONVENTIONS

- **Layering.** `api/` → `hooks/` + `stores/` → `features/` + `components/` →
  `pages/`. UI does not call axios directly; it goes through `api/`, usually via
  a hook. `lib/` is imported by anything but imports no React.
- **Server state is TanStack Query's, client state is zustand's.** Do not mirror
  fetched data into a store. Invalidate by `queryKey` (e.g. `['devices']`) —
  WebSocket events drive invalidation in `App.tsx`.
- **Imports use the `@/` alias** for `src/` (`vite.config.ts` + `tsconfig`).
  Relative imports are for immediate siblings only.
- **Naming:** files are `kebab-case.tsx`; components are `PascalCase`; hooks are
  `useThing` in `use-thing.ts`. Types/interfaces live next to the client that
  returns them (`src/api/<area>.ts`) or in `src/api/types.ts` when shared.
- **The envelope.** Every REST response is `{code, message, results}`. Unwrap it
  with `results()` / `envelope()` from `src/lib/http.ts`, never by hand.
- **Errors** go through `toApiError` (`src/lib/api-error.ts`) so status and code
  are usable; user-facing failures surface as `sonner` toasts.
- **Styling** is Tailwind utility classes with `cn()` (`src/lib/utils.ts`);
  variants use `class-variance-authority`. No CSS modules, no styled-components.
- **Tests** are colocated Vitest files (`src/lib/jid.test.ts`) and cover the pure
  helpers in `lib/` and `stores/`. New pure logic gets a test.
- **Comments explain *why*.** The codebase is deliberately light on comments and
  uses full sentences when it does comment — match that, do not add narration.

---

## ANTI-PATTERNS (these break the build or the product)

1. **No dynamic `import()` / `React.lazy`.** Code splitting defeats the
   single-file build. Everything must land in one chunk.
2. **No external requests at runtime** — no CDN script, remote font, or remote
   image. Assets are bundled and inlined (`src/assets/`, base64 favicon).
3. **`HashRouter` only.** It survives `file://` and any mount path the backend
   serves the file under. Never switch to `BrowserRouter`.
4. **Never hard-code a server origin.** The base URL comes from the connection
   store; `VITE_DEFAULT_SERVER_URL` only prefills the dev connect screen and the
   `/gowa` dev proxy.
5. **Do not treat hidden UI as authorization.** Permission-driven rendering is a
   UX affordance; the server enforces. Equally, do not branch on a role *name* —
   roles are composable, so branch on the permission list.
6. **Do not bypass the interceptors.** One-off axios calls skip auth, device
   scoping, and 401 handling. The deliberate exception is `probeServer` in
   `src/stores/connection.ts`, which must stay interceptor-free.
7. **Do not change a persisted store's shape without bumping its version name.**
8. **Do not add a dependency** for something radix-ui, lucide-react, TanStack
   Query, zustand, or `src/lib/` already covers — it is inlined download weight.
9. **Do not touch deployment runtime files** (`.github/workflows/ci.yml`,
   `.github/workflows/release.yml`, `vite.config.ts`, `package.json`,
   `index.html`) outside an approved `/implement` — see `CLAUDE.md`.

---

## VALIDATION COMMANDS

Run from the repository root. Canonical definitions:
`.claude/project-config.yaml > validation_checks`.

| Command | What it proves |
|---|---|
| `npm run typecheck` | `tsc -b` — the project type-checks |
| `npm run lint` | oxlint — no lint errors |
| `npm run test` | vitest run — colocated unit tests pass |
| `npm run build` | `tsc -b && vite build` — the single-file bundle builds |
| `npm run dev` | dev server on :5173 with the `/gowa` proxy |

Validation profiles: `ui-source` (typecheck + lint + test) is the default for
application changes; `ui-build` adds the production build and is required when
a change can break the bundle. `npm run format:check` currently fails on
pre-existing drift and is therefore not in either profile.
