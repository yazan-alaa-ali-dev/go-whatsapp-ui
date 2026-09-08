import {
  Building2,
  LayoutDashboard,
  MessagesSquare,
  Send,
  Settings,
  UserRound,
  Users,
  UsersRound,
  Wrench,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { PERMISSIONS, hasPermission, type Permission } from '@/lib/permissions'

/**
 * What the sidebar offers, and to whom.
 *
 * The table used to live inside `app-shell.tsx`. It is here because the decision
 * — *which entries exist for this principal* — has to be provable, and this
 * repository has no component renderer in its test environment: a filter written
 * inside JSX is a filter nobody can assert. `visibleNavGroups` is pure, takes the
 * permission array as an argument, reads no store, and has its own test file.
 *
 * It lives under `components/layout/` rather than in `src/lib/` for one concrete
 * reason: the icons are lucide components, and `src/lib/` contains no React and
 * no lucide import at all. That layer being node-pure is worth more than the
 * symmetry of putting both of this ticket's decision modules in one directory.
 *
 * **Nothing here names a role.** Permissions are compile-time constants in the
 * backend; roles are database rows an operator can recompose without a redeploy
 * (reference §04), so an entry shown by role name is an entry that lies the first
 * time somebody composes a fourth role. `src/lib/source-policy.test.ts` fails the
 * build over it.
 *
 * Hiding an entry is an affordance, never enforcement — see `@/lib/permissions`.
 * The server guards every route it serves.
 */

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  /**
   * Shown only to a principal holding this. Absent means *always shown* — the
   * session guard above the shell is the only condition.
   *
   * **There is no `disabled` here and there must never be.** A disabled control
   * still announces that the capability exists, and announcing an administrative
   * surface to somebody who cannot open it is worse than not mentioning it. The
   * filter below removes the item; there is nowhere for a flag to live.
   */
  permission?: Permission
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * The permission each administrative surface is gated on — declared once,
 * because it is read twice: by the navigation entry here, and by the route guard
 * in `src/App.tsx`. Two literals would be two things to keep in step, and the
 * one that drifts is the one nobody notices, because a route stricter than its
 * entry only fails for the principal who clicks it.
 *
 * **`accounts.manage`, not `accounts.manage.all`, and that is the whole point.**
 * The pair answer different questions (§04): the first is *may you use the
 * accounts surface at all*, the second is *may you leave your own account*. An
 * account administrator holds only the first — and is this surface's primary
 * audience — so gating it on the global permission would hide the accounts screen
 * from precisely the people it is for. The study (§05) names this as the mistake
 * to expect.
 *
 * Leaving your own account is gated separately, on `accounts.manage.all`, and in
 * the pure layer: see `mayEnterAccount` in `@/lib/surfaces`.
 */
export const SURFACE_PERMISSIONS = {
  accounts: PERMISSIONS.ACCOUNTS_MANAGE,
  users: PERMISSIONS.USERS_MANAGE,
} as const

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Overview',
    // `Home` rather than `Devices`: this route is a dispatcher now and renders
    // one of three surfaces, so the old label was right for one principal in
    // three. Each surface names itself in its own PageHeader.
    items: [{ to: '/', label: 'Home', icon: LayoutDashboard }],
  },
  {
    label: 'Messaging',
    items: [
      { to: '/messaging', label: 'Messaging', icon: Send },
      { to: '/chats', label: 'Chats', icon: MessagesSquare },
    ],
  },
  {
    label: 'Directory',
    items: [
      { to: '/groups', label: 'Groups', icon: Users },
      // Relabelled from `Account`. This is the WhatsApp profile — avatar, push
      // name, privacy, contacts — and it has always been that; the old label
      // only became a problem when `Accounts` appeared four lines below it, one
      // character away and about something else entirely.
      { to: '/account', label: 'Profile', icon: UserRound },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        to: '/accounts',
        label: 'Accounts',
        icon: Building2,
        permission: SURFACE_PERMISSIONS.accounts,
      },
      { to: '/users', label: 'Users', icon: UsersRound, permission: SURFACE_PERMISSIONS.users },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/misc', label: 'Channels & Calls', icon: Wrench },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

/**
 * The entries this principal may use.
 *
 * An item whose permission is not held is **dropped**, not flagged, and a group
 * left with no items is dropped with it — otherwise a principal with no
 * administrative rights renders an "Administration" heading over nothing.
 *
 * Called in render from `usePermissions()`, never as a zustand selector: it
 * returns a fresh array, and zustand v5 compares snapshots with `Object.is`, so
 * selecting through it is the render loop `NO_PERMISSIONS` exists to prevent.
 */
export function visibleNavGroups(granted: readonly string[] | null | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (item) => item.permission === undefined || hasPermission(granted, item.permission),
    ),
  })).filter((group) => group.items.length > 0)
}
