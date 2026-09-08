import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/permissions'
import { Can } from './can'

/**
 * A real render, asserted on real markup — which is what AC-12 needs: "absent
 * from the DOM" is a claim about output, not about a return value.
 *
 * There is no jsdom and no React Testing Library here, and adding either would
 * add a dependency to a build that inlines everything into one file (NFR-3).
 * `react-dom/server` is already a dependency and `renderToStaticMarkup` answers
 * the question exactly.
 *
 * **Why the store is mocked, and why that is not a shortcut.** zustand v5's
 * `useStore` passes `api.getInitialState` as `getServerSnapshot`, so under
 * `react-dom/server` a selector sees the state the store was *created* with —
 * a component rendered after `useAuth.setState({ user })` observes `user: null`
 * and renders nothing. A test written the obvious way would therefore pass the
 * "permission absent" case for entirely the wrong reason, and fail the
 * "permission present" case looking like a bug in `<Can>`.
 *
 * So the store is replaced by the one thing a zustand hook is — a function that
 * applies a selector to state — and what is under test here is the component's
 * branch. The path from a real store to a real decision is covered separately,
 * against real zustand, in `src/hooks/use-permissions.test.ts`.
 */

const session: { permissions: string[] | null } = { permissions: null }

vi.mock('@/stores/auth', () => ({
  useAuth: (selector: (state: unknown) => unknown) =>
    selector({ user: session.permissions === null ? null : { permissions: session.permissions } }),
}))

beforeEach(() => {
  session.permissions = null
})

/** A control with an attribute worth looking for in the output. */
function SendButton() {
  return (
    <button type="button" disabled={false}>
      Send
    </button>
  )
}

describe('<Can> (AC-11, AC-12, AC-25)', () => {
  it('renders its children when the principal holds the permission (TC-1)', () => {
    session.permissions = ['chats.read', 'messages.send']

    const html = renderToStaticMarkup(
      <Can permission={PERMISSIONS.MESSAGES_SEND}>
        <SendButton />
      </Can>,
    )

    expect(html).toContain('Send')
    expect(html).toContain('<button')
  })

  it('renders nothing at all when it does not — not a disabled control (TC-2)', () => {
    // The nine permissions a seeded `user` role holds. `messages.send` is not
    // among them, and §04 says that list does not expand on its own.
    session.permissions = [
      'chats.read',
      'messages.read',
      'messages.mark',
      'devices.read',
      'devices.create',
      'devices.pair',
      'contacts.read',
      'groups.read',
      'newsletters.read',
    ]

    const html = renderToStaticMarkup(
      <Can permission={PERMISSIONS.MESSAGES_SEND}>
        <SendButton />
      </Can>,
    )

    // The whole of AC-12: not merely absent from view, absent from the output.
    expect(html).toBe('')
    expect(html).not.toContain('button')
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('Send')
  })

  it('renders nothing with no session at all (AC-13, TC-4)', () => {
    session.permissions = null

    expect(
      renderToStaticMarkup(
        <Can permission={PERMISSIONS.CHATS_READ}>
          <SendButton />
        </Can>,
      ),
    ).toBe('')
  })

  it('renders nothing for an empty permission list', () => {
    session.permissions = []

    expect(
      renderToStaticMarkup(
        <Can permission={PERMISSIONS.CHATS_READ}>
          <SendButton />
        </Can>,
      ),
    ).toBe('')
  })

  it('decides from the permission and never from the role name (AC-6, TC-3)', () => {
    // A role an operator composed, whose name this UI has never heard of. The
    // control renders because the list says so — nothing consults a name.
    session.permissions = ['chats.write']

    const html = renderToStaticMarkup(
      <Can permission={PERMISSIONS.CHATS_WRITE}>
        <span>Archive</span>
      </Can>,
    )

    expect(html).toBe('<span>Archive</span>')
  })

  it('matches the whole permission name, never a prefix', () => {
    // An `admin` holds accounts.manage and not accounts.manage.all (§04).
    // Anything built on startsWith would hand it the super_admin's surface.
    session.permissions = ['accounts.manage']

    expect(
      renderToStaticMarkup(
        <Can permission={PERMISSIONS.ACCOUNTS_MANAGE_ALL}>
          <span>Every account</span>
        </Can>,
      ),
    ).toBe('')
  })

  it('renders multiple children unwrapped, adding no element of its own', () => {
    session.permissions = ['messages.send']

    const html = renderToStaticMarkup(
      <Can permission={PERMISSIONS.MESSAGES_SEND}>
        <span>a</span>
        <span>b</span>
      </Can>,
    )

    expect(html).toBe('<span>a</span><span>b</span>')
  })
})
