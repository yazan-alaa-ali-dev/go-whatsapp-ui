import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEALTH_PATH } from '@/lib/url'
import { probeHealth, useConnection } from './connection'

type ProbeResponse = { status: number; headers: Record<string, string> }

function answering(response: ProbeResponse) {
  return vi.spyOn(axios, 'get').mockResolvedValue(response)
}

afterEach(() => {
  vi.restoreAllMocks()
  useConnection.setState({ status: 'booting' })
})

describe('probeHealth', () => {
  it('asks for the health path at the root, unprefixed', async () => {
    const get = answering({ status: 200, headers: { 'content-type': 'application/json' } })
    await probeHealth()
    expect(get.mock.calls[0][0]).toBe(HEALTH_PATH)
    expect(get.mock.calls[0][0]).not.toContain('/api')
  })

  it('accepts a 200 that is not html', async () => {
    answering({ status: 200, headers: { 'content-type': 'application/json' } })
    await expect(probeHealth()).resolves.toBe('connected')
  })

  it('accepts a plain-text 200 — the body is not pinned by the contract', async () => {
    answering({ status: 200, headers: { 'content-type': 'text/plain' } })
    await expect(probeHealth()).resolves.toBe('connected')
  })

  it('rejects a 200 that is html — an SPA fallback answering for a dead backend', async () => {
    answering({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    await expect(probeHealth()).resolves.toBe('unreachable')
  })

  it('rejects a 503, which /health uses to report itself unhealthy', async () => {
    answering({ status: 503, headers: { 'content-type': 'text/plain' } })
    await expect(probeHealth()).resolves.toBe('unreachable')
  })

  it('rejects a text/plain gateway error', async () => {
    answering({ status: 502, headers: { 'content-type': 'text/plain' } })
    await expect(probeHealth()).resolves.toBe('unreachable')
  })

  it('reports a rejected session distinctly from an unreachable one', async () => {
    answering({ status: 401, headers: {} })
    await expect(probeHealth()).resolves.toBe('unauthorized')
  })

  it('treats a network failure as unreachable', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(probeHealth()).resolves.toBe('unreachable')
  })
})

describe('boot', () => {
  it('deletes the key an older bundle used for the address and password', async () => {
    answering({ status: 200, headers: { 'content-type': 'application/json' } })
    const removed: string[] = []
    vi.stubGlobal('localStorage', {
      removeItem: (key: string) => removed.push(key),
    })

    await useConnection.getState().boot()

    expect(removed).toContain('gowa-ui.connection.v1')
    expect(useConnection.getState().status).toBe('connected')
    vi.unstubAllGlobals()
  })

  it('survives storage being blocked instead of taking the app down', async () => {
    answering({ status: 200, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('localStorage', {
      removeItem: () => {
        throw new Error('storage disabled')
      },
    })

    await expect(useConnection.getState().boot()).resolves.toBeUndefined()
    expect(useConnection.getState().status).toBe('connected')
    vi.unstubAllGlobals()
  })
})

// `markUnauthorized` was removed by z8pmx9md6z. Its only consumer was the
// connect screen, and a 401 from a guarded route now means a session ended
// rather than an origin being refused — see src/lib/http.ts. `probeHealth`
// still reports `unauthorized`, because a 401 on the *public* /health really
// does mean something in front of gowa is refusing this origin.
