import { formFields, type ApiRequest } from '@/api/request'
import { absoluteApiUrl } from '@/lib/url'

const INDENT = '  '

export interface CurlOptions {
  deviceId?: string | null
  /** The page's own origin. A parameter only so this is testable off-browser. */
  origin?: string
}

/** Quote a value for a POSIX shell: close, escape, reopen around each quote. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Render a request as a runnable curl command. The URL and the headers mirror
 * what the axios interceptor attaches, so the command is the request the UI
 * would send. The address is the page's own origin — the proxy the operator
 * already reached this dashboard through, never the backend behind it.
 */
export function toCurl(request: ApiRequest, opts: CurlOptions): string {
  const url = opts.origin ? absoluteApiUrl(request.path, opts.origin) : absoluteApiUrl(request.path)
  const parts = [`curl -X ${request.method} ${shellQuote(url)}`]

  // Every endpoint rendered here is guarded, so the command needs the bearer
  // token the interceptor adds — but a copied credential is a leaked one, so
  // this stands in for it exactly as `@filename` stands in for a picked file.
  parts.push(`-H ${shellQuote('Authorization: Bearer <token>')}`)

  if (opts.deviceId) {
    parts.push(`-H ${shellQuote(`X-Device-Id: ${encodeURIComponent(opts.deviceId)}`)}`)
  }
  if (request.json) {
    parts.push(`-H 'Content-Type: application/json'`)
    // Indent the pretty-printed body to sit under -d. Only the printer's own
    // newlines match; newlines inside a value are already JSON-escaped.
    const body = JSON.stringify(request.json, null, 2).replaceAll('\n', `\n${INDENT}`)
    parts.push(`-d ${shellQuote(body)}`)
  }
  for (const [key, value] of formFields(request.form ?? {})) {
    // A browser never learns a picked file's path, so the name stands in for it.
    const field = value instanceof File ? `${key}=@${value.name}` : `${key}=${value}`
    parts.push(`-F ${shellQuote(field)}`)
  }
  return parts.join(` \\\n${INDENT}`)
}

/** True when the command carries a file placeholder the user must edit. */
export function hasFileField(request: ApiRequest): boolean {
  return formFields(request.form ?? {}).some(([, value]) => value instanceof File)
}
