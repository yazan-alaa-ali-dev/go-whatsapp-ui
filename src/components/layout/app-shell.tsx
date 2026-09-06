import { useState } from 'react'
import {
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Send,
  Settings,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { DeviceSwitcher } from '@/components/layout/device-switcher'
import { Logo } from '@/components/layout/logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { WsBadge } from '@/components/layout/ws-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PasskeyDialog } from '@/features/session/passkey-dialog'
import { cn } from '@/lib/utils'

const navGroups = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Devices', icon: LayoutDashboard }],
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
      { to: '/account', label: 'Account', icon: UserRound },
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

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {navGroups.map((group) => (
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
 * It no longer gates on anything: reaching it at all means `RequireSession`
 * already established a session, and the connect screen it used to redirect to
 * when the health probe failed has been replaced by the login screen, which
 * carries that diagnosis itself now.
 */
export function AppShell() {
  const location = useLocation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <Logo />
        </div>
        <ScrollArea className="flex-1 px-2 py-4">
          <NavContent />
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
            <NavContent onNavigate={() => setMobileNavOpen(false)} />
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
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
