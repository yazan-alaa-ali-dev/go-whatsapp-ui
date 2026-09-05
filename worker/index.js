/**
 * Cloudflare Worker that serves the single-file dashboard and plays the part
 * the README calls "the reverse proxy in front of this page".
 *
 * The UI sends every request to its own origin under `/api`, and asks for
 * `/health` at the root, so a plain static host leaves it permanently
 * unreachable. This Worker is the production counterpart of the dev proxy in
 * `vite.config.ts`, and mirrors it rule for rule.
 *
 * Plain JavaScript on purpose: `tsc -b` covers only `src` and `vite.config.ts`,
 * so a `.ts` file here would look type-checked without ever being checked, and
 * checking it would mean adding @cloudflare/workers-types to package.json — a
 * deployment runtime file this repository treats as a hard stop.
 */

/** Must stay identical to API_PREFIX in src/lib/url.ts. */
const API_PREFIX = '/api'

/** Registered at the server root, outside APP_BASE_PATH — never prefixed. */
const HEALTH_PATH = '/health'

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (input: Request | URL | string) => Promise<Response> }, GOWA_ORIGIN?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    const isApi = path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)
    if (isApi || path === HEALTH_PATH) return forward(request, url, isApi, env)

    const response = await env.ASSETS.fetch(request)
    // HashRouter keeps every route behind '#', so a 404 here is a deep link or
    // a stale bookmark rather than a route — the shell answers both.
    if (response.status !== 404 || request.method !== 'GET') return response
    return env.ASSETS.fetch(new URL('/', url))
  },
}

/**
 * Send an API or health request to the backend.
 *
 * The `/api` prefix is stripped, because a default gowa mounts its routes at
 * the root; `/health` passes through untouched. A backend run with
 * `APP_BASE_PATH=/api` wants the strip removed — same note as the dev proxy.
 *
 * Passing the Request through unchanged is also what carries a WebSocket
 * upgrade: `/api/ws` reaches the backend as `/ws` with its Upgrade header
 * intact, and the 101 response is returned as-is.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {boolean} isApi
 * @param {{ GOWA_ORIGIN?: string }} env
 */
function forward(request, url, isApi, env) {
  const origin = env.GOWA_ORIGIN
  if (!origin) {
    return new Response(
      'GOWA_ORIGIN is not set on this Worker, so there is no backend to forward to.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    )
  }

  const base = new URL(origin)
  const suffix = isApi ? url.pathname.slice(API_PREFIX.length) : url.pathname
  // Built by hand rather than with new URL(path, base): a root-absolute path
  // would discard a base path, and GOWA_ORIGIN is allowed to carry one.
  const target = new URL(`${base.pathname.replace(/\/+$/, '')}${suffix || '/'}${url.search}`, base)

  return fetch(new Request(target, request))
}
