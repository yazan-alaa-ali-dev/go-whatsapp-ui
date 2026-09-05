import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'
import { isApiError, toApiError } from './api-error'

function axiosErrorWithResponse(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
    statusText: '',
    headers: {},
    config: {},
  } as AxiosResponse)
}

describe('toApiError', () => {
  it('extracts the gowa envelope from an axios error', () => {
    const error = toApiError(
      axiosErrorWithResponse(404, { code: 'DEVICE_NOT_FOUND', message: 'device not found' }),
    )
    expect(error).toEqual({ status: 404, code: 'DEVICE_NOT_FOUND', message: 'device not found' })
  })

  it('maps a missing response to NETWORK_ERROR', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK'))
    expect(error.status).toBe(0)
    expect(error.code).toBe('NETWORK_ERROR')
  })

  it('falls back to HTTP_ERROR when the body is not an envelope', () => {
    const error = toApiError(axiosErrorWithResponse(502, '<html>bad gateway</html>'))
    expect(error.status).toBe(502)
    expect(error.code).toBe('HTTP_ERROR')
  })

  it('passes ApiError objects through and wraps plain errors', () => {
    const passthrough = { status: 401, code: 'AUTHENTICATION_ERROR', message: 'nope' }
    expect(toApiError(passthrough)).toBe(passthrough)
    expect(isApiError(toApiError(new Error('boom')))).toBe(true)
    expect(toApiError(new Error('boom')).message).toBe('boom')
  })

  /**
   * AC-18 otherwise rests on a source scan, which cannot see what a value
   * carries at runtime. An axios error holds the whole request config, headers
   * included; what leaves this function must not.
   */
  it('drops the request that failed, so a bearer token cannot ride out on an error', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.header-payload.signature'
    const failed = new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 401,
      data: { code: 'AUTHENTICATION_ERROR', message: 'token rejected' },
      statusText: '',
      headers: {},
      config: { headers: { Authorization: `Bearer ${token}` } },
    } as unknown as AxiosResponse)

    const serialised = JSON.stringify(toApiError(failed))

    expect(serialised).not.toContain(token)
    expect(serialised).not.toContain('Bearer')
    expect(Object.keys(toApiError(failed))).toEqual(['status', 'code', 'message'])
  })
})
