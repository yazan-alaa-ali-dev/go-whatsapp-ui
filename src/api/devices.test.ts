import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { http } from '@/lib/http'
import {
  getDeviceWebhook,
  setDeviceWebhookEnabled,
  updateDeviceWebhook,
  type DeviceWebhookConfig,
} from './devices'

/**
 * The three device webhook calls, driven through the real interceptor chain with
 * a stub adapter — the harness `http.test.ts` established and
 * `accounts.test.ts` reuses. Asserting the request rather than mocking the
 * client is what makes these worth anything: these shapes were read off the
 * reference's OpenAPI text, and a test that mocked the function would only
 * assert the reading back to itself.
 *
 * Only the webhook calls are covered here. The rest of this module predates the
 * ticket and is unchanged by it.
 */

const originalAdapter = http.defaults.adapter

function respondWith(results: unknown, status = 200): InternalAxiosRequestConfig[] {
  const sent: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config as InternalAxiosRequestConfig)
    const response = {
      status,
      data: { code: status >= 400 ? 'BAD_REQUEST' : 'SUCCESS', message: '', results },
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse
    if (status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, undefined, response)
    }
    return response
  }
  http.defaults.adapter = adapter
  return sent
}

beforeEach(() => {
  useAuth.setState({
    access_token: null,
    refresh_token: null,
    access_token_expires_at: null,
    user: null,
    status: 'unknown',
    endReason: null,
  })
})

afterEach(() => {
  http.defaults.adapter = originalAdapter
})

const stored: DeviceWebhookConfig = {
  device_id: 'acme-prod-1',
  webhook_url: 'https://example.com/webhook',
  webhook_secret: 'super-secret-key',
  webhook_events: 'message,message.ack',
  webhook_insecure_skip_verify: false,
  webhook_enabled: false,
}

describe('reading a device webhook', () => {
  it('carries the delivery switch, which only this endpoint returns', () => {
    // The PATCH response does not carry `webhook_enabled` — typing it as though
    // it did is how a stale value ends up rendered after a save.
    const config: DeviceWebhookConfig = stored
    expect(config.webhook_enabled).toBe(false)
  })

  it('encodes the device id in the path', async () => {
    const sent = respondWith(stored)
    await getDeviceWebhook('acme prod/1')
    expect(sent[0].method).toBe('get')
    expect(sent[0].url).toBe('/devices/acme%20prod%2F1/webhook')
  })
})

describe('disabling a webhook is not clearing it', () => {
  it('sends a real JSON boolean to the switch endpoint, and nothing else', async () => {
    // TC-13. `enabled` must be a JSON boolean: a string like "yes", a number, or
    // an omitted field is a 400 and nothing is written.
    const sent = respondWith({ device_id: 'acme-prod-1', webhook_enabled: false })
    const state = await setDeviceWebhookEnabled('acme-prod-1', false)

    expect(sent[0].method).toBe('patch')
    expect(sent[0].url).toBe('/devices/acme-prod-1/webhook/enabled')
    const body = JSON.parse(sent[0].data as string) as Record<string, unknown>
    expect(body).toEqual({ enabled: false })
    expect(typeof body.enabled).toBe('boolean')
    expect(state.webhook_enabled).toBe(false)
  })

  it('does not drop `false` the way a payload-cleaning helper would', async () => {
    // `clean()` in @/api/request drops undefined and '' — it would leave `false`
    // alone, but the point of building this body literally is that no helper is
    // ever introduced between here and the wire.
    const sent = respondWith({ device_id: 'd', webhook_enabled: false })
    await setDeviceWebhookEnabled('d', false)
    expect(Object.keys(JSON.parse(sent[0].data as string) as object)).toEqual(['enabled'])
  })

  it('sends true to resume delivery, with no other field', async () => {
    const sent = respondWith({ device_id: 'd', webhook_enabled: true })
    await setDeviceWebhookEnabled('d', true)
    expect(JSON.parse(sent[0].data as string)).toEqual({ enabled: true })
  })

  it('touches a different endpoint from the configuration write', async () => {
    // The whole distinction, asserted as two different URLs: one changes the
    // switch, the other rewrites (or erases) the stored configuration.
    const sent = respondWith(stored)
    await setDeviceWebhookEnabled('d', false)
    await updateDeviceWebhook('d', { webhook_url: 'https://example.com/webhook' })
    expect(sent[0].url).toBe('/devices/d/webhook/enabled')
    expect(sent[1].url).toBe('/devices/d/webhook')
  })
})

describe('clearing a webhook URL', () => {
  it('sends the empty string rather than omitting the field', async () => {
    // TC-14 on the wire. An omitted `webhook_url` is a 400 — the field is
    // required — and an empty one is the documented deletion.
    const sent = respondWith(stored)
    await updateDeviceWebhook('acme-prod-1', {
      webhook_url: '',
      webhook_secret: 'super-secret-key',
      webhook_events: '',
      webhook_insecure_skip_verify: false,
    })
    const body = JSON.parse(sent[0].data as string) as Record<string, unknown>
    expect(body.webhook_url).toBe('')
    expect(Object.keys(body)).toContain('webhook_url')
  })
})
