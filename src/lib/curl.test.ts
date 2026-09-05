import { describe, expect, it } from 'vitest'
import type { ApiRequest } from '@/api/request'
import { shellQuote, toCurl } from './curl'

const base = {
  deviceId: null,
  origin: 'https://dash.example.com',
}

const textRequest: ApiRequest = {
  method: 'POST',
  path: '/send/message',
  json: { phone: '628123@s.whatsapp.net', message: 'hello' },
}

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('escapes an embedded single quote', () => {
    expect(shellQuote("don't")).toBe("'don'\\''t'")
  })

  it('leaves double quotes and backslashes untouched', () => {
    expect(shellQuote('say "hi" \\ ok')).toBe('\'say "hi" \\ ok\'')
  })
})

describe('toCurl', () => {
  it('renders method, prefixed same-origin url, and a json body indented under -d', () => {
    expect(toCurl(textRequest, base)).toBe(
      [
        "curl -X POST 'https://dash.example.com/api/send/message' \\",
        "  -H 'Content-Type: application/json' \\",
        "  -d '{",
        '    "phone": "628123@s.whatsapp.net",',
        '    "message": "hello"',
        "  }'",
      ].join('\n'),
    )
  })

  it('carries no credential — there is none to render', () => {
    const command = toCurl(textRequest, base)
    expect(command).not.toContain('-u ')
  })

  it('includes the url-encoded device header when a device is selected', () => {
    expect(toCurl(textRequest, { ...base, deviceId: 'my device/1' })).toContain(
      "-H 'X-Device-Id: my%20device%2F1'",
    )
  })

  it('builds on the page origin, never on a backend address', () => {
    const command = toCurl(textRequest, { ...base, origin: 'http://localhost:5173' })
    expect(command).toContain("'http://localhost:5173/api/send/message'")
  })

  it('escapes a body containing an apostrophe so the command stays runnable', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/send/message',
      json: { message: "don't" },
    }
    expect(toCurl(request, base)).toContain('"message": "don\'\\\'\'t"')
  })

  it('renders multipart fields, using the filename for a file', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/send/image',
      form: {
        phone: '628123@s.whatsapp.net',
        image: new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
        compress: true,
      },
    }
    const command = toCurl(request, base)
    expect(command).toContain("-F 'phone=628123@s.whatsapp.net'")
    expect(command).toContain("-F 'image=@photo.jpg'")
    expect(command).toContain("-F 'compress=true'")
    expect(command).not.toContain('Content-Type: application/json')
  })

  it('skips empty and undefined multipart fields, matching what is sent', () => {
    const request: ApiRequest = {
      method: 'POST',
      path: '/send/image',
      form: { phone: '628123@s.whatsapp.net', caption: '', image_url: undefined },
    }
    const command = toCurl(request, base)
    expect(command).not.toContain('caption')
    expect(command).not.toContain('image_url')
  })
})
