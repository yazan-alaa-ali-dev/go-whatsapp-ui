import {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/stores/auth'
import { useDeviceStore } from '@/stores/device'
import { http } from '@/lib/http'
import {
  type AdminUser,
  type CreateUserPayload,
  createUser,
  deleteUser,
  listUsers,
  omitUntouched,
  resetUserPassword,
  updateUser,
} from './users'

const originalAdapter = http.defaults.adapter

function respondWith(results: unknown): InternalAxiosRequestConfig[] {
  const sent: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config as InternalAxiosRequestConfig)
    return {
      status: 200,
      data: { code: 'SUCCESS', message: '', results },
      statusText: '',
      headers: {},
      config,
    } as AxiosResponse
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
  useDeviceStore.setState({ selectedDeviceId: null })
})

afterEach(() => {
  http.defaults.adapter = originalAdapter
})

describe('an absent field and an empty one are different instructions (AC-23, TC-11)', () => {
  it('omits every untouched field', () => {
    expect(omitUntouched({ status: 'active', email: undefined, account_id: undefined })).toEqual({
      status: 'active',
    })
  })

  it('a status-only change sends status and nothing else', async () => {
    // The case the ticket names: account_id is not present, and certainly not
    // present as "". Sending it blank would be an attempt to empty an account.
    const sent = respondWith({})

    await updateUser('u1', { status: 'disabled' })

    const body = JSON.parse(sent[0].data as string)
    expect(body).toEqual({ status: 'disabled' })
    expect(Object.keys(body)).not.toContain('account_id')
  })

  it('keeps an empty string, because it is a value (TC-12)', () => {
    // Not `clean()` from @/api/request, which drops '' along with undefined.
    // `email` is documented as "unique when non-blank; several users may have
    // none", so clearing one is a plausible edit and dropping it would discard
    // the operator's change in silence.
    expect(omitUntouched({ email: '', status: undefined })).toEqual({ email: '' })
  })

  it('keeps a blank account_id and lets the server refuse it', () => {
    // Revision 1 dropped this field silently. That converts "you may not blank
    // an account" into either an unexplained no-op or — when it was the only
    // change — an empty body the server answers 400 to. Forwarding the intent
    // is the honest option: the server's rejection is the message, and there is
    // no client-invented rejection in this module.
    expect(omitUntouched({ account_id: '' })).toEqual({ account_id: '' })
  })

  it('keeps false, 0 and an empty array — only undefined means untouched', () => {
    expect(omitUntouched({ a: false, b: 0, c: [], d: undefined })).toEqual({
      a: false,
      b: 0,
      c: [],
    })
  })

  it('forwards an empty change as the empty body the server is documented to refuse', async () => {
    // A 400 rather than a no-op, deliberately: every non-empty PATCH bumps
    // token_epoch and logs the user out of every session, so "changed nothing"
    // and "logged someone out of everywhere" must not share a response.
    const sent = respondWith({})

    await updateUser('u1', {})

    expect(JSON.parse(sent[0].data as string)).toEqual({})
  })

  it('replaces the role set rather than merging into it', async () => {
    const sent = respondWith({})

    await updateUser('u1', { roles: ['admin'] })

    expect(JSON.parse(sent[0].data as string)).toEqual({ roles: ['admin'] })
  })
})

describe('the administration user type (AC-20, AC-21, TC-13)', () => {
  it('carries the nine documented fields and neither of the two absent ones', async () => {
    const user: AdminUser = {
      user_id: 'u1',
      username: 'sara',
      email: 'sara@acme.com',
      account_id: 'acc-a',
      status: 'active',
      roles: ['user'],
      token_epoch: 3,
      created_at: '2026-01-14T09:12:00Z',
      updated_at: '2026-02-02T11:40:00Z',
    }
    respondWith([user])

    const [read] = await listUsers()

    expect(Object.keys(read).sort()).toEqual([
      'account_id',
      'created_at',
      'email',
      'roles',
      'status',
      'token_epoch',
      'updated_at',
      'user_id',
      'username',
    ])
    // The effective union of grants is what GET /auth/me answers, and it is the
    // only endpoint that answers it — a users table has no source for it.
    expect(Object.keys(read)).not.toContain('permissions')
    // The field does not exist on the server type at all, so this is true by
    // construction rather than by a serialisation tag.
    expect(Object.keys(read)).not.toContain('password_hash')
  })

  it('is a flat array with no total, and invents none (AC-22)', async () => {
    respondWith([{ user_id: 'u1' }, { user_id: 'u2' }])

    const users = await listUsers({ limit: 2, offset: 0 })

    expect(Array.isArray(users)).toBe(true)
    expect(users).toHaveLength(2)
  })

  it('sends limit and offset as query parameters, and nothing when unpaged', async () => {
    const sent = respondWith([])

    await listUsers({ limit: 100, offset: 200 })
    await listUsers()

    expect(sent[0].params).toEqual({ limit: 100, offset: 200 })
    expect(sent[1].params).toBeUndefined()
  })

  it('an empty envelope is an empty page', async () => {
    respondWith(undefined)
    await expect(listUsers()).resolves.toEqual([])
  })
})

describe('creating a user names exactly one account (AC-19)', () => {
  it('sends an existing account by id', async () => {
    const sent = respondWith({})
    const payload: CreateUserPayload = {
      username: 'sara',
      password: 'correct-horse-battery',
      account_id: 'acc-a',
    }

    await createUser(payload)

    expect(sent[0].url).toBe('/auth/users')
    expect(JSON.parse(sent[0].data as string)).toEqual(payload)
  })

  it('sends a new account inline, in the same request', async () => {
    // Both rows commit or neither does, so "create a new customer" is one
    // atomic operation rather than two — and there is no window in which a user
    // exists with no account, a state that can address no device at all.
    const sent = respondWith({})
    const payload: CreateUserPayload = {
      username: 'sara',
      password: 'correct-horse-battery',
      account: { account_id: 'acc-new', name: 'New Co' },
    }

    await createUser(payload)

    expect(JSON.parse(sent[0].data as string)).toEqual(payload)
  })

  it('does not send the two together — the union makes that shape impossible', () => {
    // A compile-time check, recorded as a runtime assertion so the intent is
    // visible in the report: `account_id?: never` on one arm and `account?:
    // never` on the other mean the both-fields object does not type. The
    // server's 400 remains the control; a client-side shape is never
    // enforcement.
    const both = {
      username: 'sara',
      password: 'x',
      account_id: 'acc-a',
      account: { account_id: 'acc-new', name: 'New Co' },
    }
    // @ts-expect-error exactly one of account_id / account may be given
    const rejected: CreateUserPayload = both
    expect(rejected).toBeDefined()
  })

  it('does not send neither — the union requires one arm', () => {
    const neither = { username: 'sara', password: 'x' }
    // @ts-expect-error an account is required: a user with none can address no device
    const rejected: CreateUserPayload = neither
    expect(rejected).toBeDefined()
  })
})

describe('delete and the administrative password reset', () => {
  it('deletes by id and expects no body back', async () => {
    const sent = respondWith(undefined)

    await expect(deleteUser('u1')).resolves.toBeUndefined()
    expect(sent[0].method).toBe('delete')
    expect(sent[0].url).toBe('/auth/users/u1')
  })

  it('resets a password with no current_password field', async () => {
    // Deliberately absent: this is an administrative reset on someone else's
    // account, and asking an administrator for the value they are replacing
    // would be asking for one they legitimately do not know.
    const sent = respondWith(undefined)

    await resetUserPassword('u1', 'a-new-secret-value')

    expect(sent[0].url).toBe('/auth/users/u1/password')
    const body = JSON.parse(sent[0].data as string)
    expect(Object.keys(body)).toEqual(['password'])
  })

  it('percent-encodes the user id in every path', async () => {
    const sent = respondWith({})

    await updateUser('u/1', { status: 'active' })
    await resetUserPassword('u/1', 'x')

    expect(sent[0].url).toBe('/auth/users/u%2F1')
    expect(sent[1].url).toBe('/auth/users/u%2F1/password')
  })
})
