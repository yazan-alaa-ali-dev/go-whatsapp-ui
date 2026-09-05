/**
 * The one and only API prefix, and the only place a request URL is built.
 *
 * It is relative and same-origin by construction — no scheme, no host, no port
 * — so the real backend address never reaches the browser. The reverse proxy,
 * or gowa itself when it serves this bundle, is the only party that knows it.
 *
 * The deployment must map `/api/*` on this origin to the backend (a proxy that
 * strips the prefix, or gowa run with APP_BASE_PATH=/api), and must serve the
 * bundle at the origin root — a root-absolute prefix cannot follow a sub-path
 * mount. See README > "What your deployment needs".
 */
export const API_PREFIX = '/api'

/**
 * GET /health is registered at the server root, outside APP_BASE_PATH, so it
 * has a stable address for any liveness probe. It is therefore the one path
 * that must NOT carry the prefix.
 */
export const HEALTH_PATH = '/health'

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Re-root an absolute URL the server returned (qr_link, media file_path) onto
 * the same-origin prefix. The server builds such URLs from its own Host header,
 * which is wrong behind a proxy — only the path is usable. serverBasePath is
 * APP_BASE_PATH as reported by GET /app/info; it is stripped first because the
 * prefix already stands for the server root.
 */
export function rerootServerUrl(serverUrl: string, serverBasePath = ''): string {
  let path: string
  try {
    const parsed = new URL(serverUrl)
    path = parsed.pathname + parsed.search
  } catch {
    path = serverUrl
  }
  if (serverBasePath && path.startsWith(serverBasePath)) {
    path = path.slice(serverBasePath.length)
  }
  return joinUrl(API_PREFIX, path)
}

/**
 * WebSocket URL for the page's own origin. The scheme follows the page's:
 * https: pairs with wss:, anything else with ws:. `location` is a parameter
 * only so this stays testable under the Node test environment.
 */
export function toWebSocketUrl(
  params: Record<string, string>,
  location: { protocol: string; host: string } = window.location,
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${scheme}//${location.host}${joinUrl(API_PREFIX, 'ws')}`)
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}

/**
 * Absolute same-origin URL, for the one place that needs a copy-pasteable
 * string (the cURL preview). The origin is the *page's* — the proxy address the
 * operator already has in their address bar — never the backend's.
 */
export function absoluteApiUrl(path: string, origin: string = window.location.origin): string {
  return `${origin}${joinUrl(API_PREFIX, path)}`
}
