# gowa-ui

A web dashboard for [go-whatsapp-web-multidevice](https://github.com/aldinokemal/go-whatsapp-web-multidevice) (gowa).

The whole app builds into **one HTML file** with no external dependencies. Host it anywhere (or just open it in a browser) and point it at your gowa server. The backend stays a pure API; the UI ships separately — same idea as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and its [Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center).

Built with React 19, TypeScript, Vite, Tailwind CSS 4, and shadcn/ui.

> **Status**: feature parity with gowa's embedded dashboard. Tagging a `v*` release publishes `gowa-ui.html`.

## How to use it

The dashboard sends **every** request to its own origin, under the relative
prefix `/api`. It has no server-URL field and stores no address: whatever serves
this page must also route the API. That leaves one supported deployment shape:

**Served behind the same origin as gowa** — gowa serves `gowa-ui.html` at `/`,
or a reverse proxy serves the file and forwards the API. Either way the browser
only ever talks to the address already in its address bar.

Hosting the file on an unrelated static host, or opening it from `file://`, is no
longer supported: there is no URL to point at a backend, and `file://` has no
origin to route from.

## What your deployment needs

- **`/api/*` on this origin must reach the backend** — either a reverse proxy
  that strips the `/api` prefix, or gowa run with `APP_BASE_PATH=/api`.
- **`/health` on this origin must reach the backend root.** This one is a boot
  gate: `/health` is registered outside `APP_BASE_PATH`, so it is requested
  unprefixed. Map only `/api` and the dashboard reports itself unreachable
  forever while the API works perfectly.
- **Serve the bundle at the origin root.** `/api` is root-absolute, so a
  dashboard mounted under a sub-path would send its requests to the wrong place.
  (Routing itself is unaffected — `HashRouter` works at any mount path.)
- **Rewrite absolute URLs in responses, if the internal host matters to you.**
  gowa builds `qr_link` and media `file_path` from its own `Host` header, so the
  internal address travels inside the JSON body. The UI never *uses* it — it
  re-roots every such URL onto `/api` — but stripping it from the payload is the
  proxy's job, not the browser's.
- **Device selection** — `X-Device-Id` header (URL-encoded) or `?device_id=` query.
- **Server info** — `GET /app/info` (version, media size limits).

CORS is no longer needed: nothing this dashboard sends is cross-origin.

### Cloudflare Workers

`wrangler.jsonc` and `worker/index.js` are that reverse proxy, for the one host
this repository is actually deployed to. The Worker serves `dist/index.html` and
forwards `/api/*` (WebSocket included, prefix stripped) and `/health` to the
backend — the same two rules as the dev proxy in `vite.config.ts`.

Two things are yours to set, because neither belongs in source:

- **`name` in `wrangler.jsonc`** must match the Worker the build is connected
  to in the Cloudflare dashboard.
- **`GOWA_ORIGIN`** — the backend's address, as a Worker variable or secret
  (`npx wrangler secret put GOWA_ORIGIN`). Until it is set the Worker answers
  `/api` and `/health` with 503, and the dashboard reports itself unreachable.

A base path is allowed (`https://host/gowa`) and is kept in front of every
forwarded path.

> **Upgrading from a build with the Server URL field?** That build persisted the
> server address **and a plaintext password** in `localStorage` under
> `gowa-ui.connection.v1`. This version deletes the key on first load, but the
> secret was readable by anything running in the page for as long as it sat
> there, and your browser's password manager may still hold a copy. Treat it as
> exposed and rotate it.

## Development

```bash
cp .env.example .env   # set VITE_DEFAULT_SERVER_URL if your gowa isn't on :3000
npm install
npm run dev
```

That's the whole setup — there is nothing to connect. Vite's dev proxy stands in
for the production reverse proxy: it forwards `/api/*` (WebSocket included) to
`VITE_DEFAULT_SERVER_URL` with the prefix stripped, and `/health` to the same
target unchanged. If your backend runs with `APP_BASE_PATH=/api`, drop the
`rewrite` line from the `/api` entry in `vite.config.ts`.

Other scripts: `npm run build` (single-file production build into `dist/index.html`), `typecheck`, `lint`, `format`, `preview`.

### Single-file rules

The build must stay one file with zero external requests:

- No `import()` or `React.lazy` — code splitting breaks single-file output.
- No CDN scripts, external fonts, or remote images — everything is bundled and inlined.
- `HashRouter` only — it survives `file://` and any mount path.

CI checks that `dist/` contains exactly one file.

### Regenerating the logo

The source logo lives in the backend repo: [`src/views/assets/gowa.svg`](https://github.com/aldinokemal/go-whatsapp-web-multidevice/blob/main/src/views/assets/gowa.svg). It's ~864 KB (an SVG wrapping embedded 1024px rasters), so we don't inline it — we bundle rasterized copies instead. To regenerate them after a branding change:

```bash
rsvg-convert -w 128 -h 128 gowa.svg -o /tmp/gowa-logo.png
cwebp -q 90 /tmp/gowa-logo.png -o src/assets/gowa-logo.webp   # sidebar logo
rsvg-convert -w 64 -h 64 gowa.svg -o /tmp/gowa-favicon.png     # then re-embed as the
                                                               # base64 favicon in index.html
```

## Releases

Every `v*` tag publishes exactly one asset named **`gowa-ui.html`** (plus a `.sha256` checksum). The gowa backend fetches `releases/latest` by that exact name, verifies the checksum, caches the file, and serves it at `/`. Don't rename the asset.

## Roadmap

- [x] **M0** — scaffold: single-file build, app shell, dark mode, CI/release workflows
- [x] **M1** — connect screen, device manager, QR/pair-code login, logout/reconnect, WebSocket events
- [x] **M2** — send suite (message, image, file, video, sticker, contact, location, audio, poll, link, presence)
- [x] **M3** — message actions (delete, revoke, react, update, read, star, forward) + call reject
- [x] **M4** — groups (create, join, info, participants, settings, invite links)
- [x] **M5** — account (avatar, push name, privacy, contacts) + newsletters
- [x] **M6** — chats (list, message viewer, composer, pin, archive, disappearing timers)
- [x] **M7** — parity audit vs the embedded dashboard → v1.0.0
- [x] **v1.1.0** — per-device webhook editor (URL, secret, events, TLS verify) on the device card
- [x] **v1.1.1** — group participants viewer: table with admin badges + inline add/promote/demote/remove

Still to do: Chatwoot config module, full WebAuthn passkey flow.
