import { useState } from 'react'
import { Menu } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AccountContextBar } from '@/components/layout/account-context-bar'
import { AccountSwitcher } from '@/components/layout/account-switcher'
import { DeviceSwitcher } from '@/components/layout/device-switcher'
import { Logo } from '@/components/layout/logo'
import { visibleNavGroups, type NavGroup } from '@/components/layout/navigation'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { WsBadge } from '@/components/layout/ws-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PasskeyDialog } from '@/features/session/passkey-dialog'
import { usePermissions, useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { cn } from '@/lib/utils'

/**
 * The entries, rendered.
 *
 * `groups` arrives as a **prop** and this component reads no store, which is not
 * incidental: it is rendered twice — the sidebar and the mobile sheet — so a hook
 * call here would undo the hoisting in `AppShell` and open two subscriptions and
 * run two filter passes for one answer that is the same in both places.
 */
function NavContent({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="text-muted-foreground px-3 text-[11px] font-medium tracking-wider uppercase">
            {group.label}
          </p>
          {group.items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-full px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

/**
 * The shell every application route renders inside.
 *
 * It gates on no *session*: reaching it at all means `RequireSession` already
 * established one, and the connect screen it used to redirect to when the health
 * probe failed has been replaced by the login screen, which carries that
 * diagnosis itself now.
 *
 * What it does gate on, since z8pmx9mf17, is `permissions[]` — and it does so
 * with exactly **two** subscriptions however far the navigation table grows:
 * one array read for the entries, one boolean for the account switcher. Both are
 * hoisted here; `NavContent` takes its groups as a prop, and nothing per entry
 * or per row reads the store.
 *
 * `usePermissions()` returns the store's own array (or the frozen
 * `NO_PERMISSIONS`), so the snapshot is stable and `visibleNavGroups` runs in
 * render over it — never as a selector, which would return a fresh array every
 * call and produce the `useSyncExternalStore` loop that constant exists to
 * prevent.
 *
 * The stated cost: this re-renders when the `user` object's identity changes,
 * which `storeTokenPair` does on a refresh carrying a principal — roughly twice
 * an hour. The routed subtree is spared because `<Outlet/>` hands back the same
 * element identity out of route context and React bails out; the header subtree
 * does re-render, and it is four cheap components.
 */
export function AppShell() {
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const groups = visibleNavGroups(usePermissions())
  // `accounts.manage.all` — *may you leave your own account*. The narrower
  // `accounts.manage` opens the accounts surface and answers nothing about
  // moving between accounts (reference §04).
  const mayLeaveOwnAccount = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE_ALL)

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Logo />
        </div>
        <ScrollArea className="flex-1 px-2 py-4">
          <NavContent groups={groups} />
        </ScrollArea>
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="bg-sidebar w-72 p-0">
          <SheetHeader className="border-b">
            <SheetTitle asChild>
              <div>
                <Logo />
              </div>
            </SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-2 pb-4">
            <NavContent groups={groups} onNavigate={() => setMobileNavOpen(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Above the header, deliberately. The device switcher below it is the
            control that will hand this operator one of the foreign account's
            devices — a warning printed underneath the thing it warns about is a
            warning in the wrong place. */}
        <AccountContextBar />
        <header className="flex h-14 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2 md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <Logo />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {mayLeaveOwnAccount && <AccountSwitcher />}
            <DeviceSwitcher />
            <WsBadge />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <div key={location.pathname} className="stagger mx-auto flex max-w-5xl flex-col gap-5">
            <Outlet />
          </div>
        </main>
      </div>
      <PasskeyDialog />
    </div>
  )
}
