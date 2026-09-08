import { LogOut, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/stores/auth'

/**
 * Who is signed in, and the way out.
 *
 * `signOut()` is the only voluntary teardown in the app: it revokes the
 * refresh-token family server-side and clears every cookie. Everything the user
 * then sees — the query cache emptying, the socket closing, the trip to the
 * login screen — is a consequence of the session state changing, not of
 * anything this component does. That is why there is no `navigate()` here.
 *
 * `role` is shown as identity, not as authority: this repository reads rights
 * from `permissions[]` (z8pmx9md71), never from a role name.
 */
export function UserMenu() {
  const user = useAuth((state) => state.user)
  const signOut = useAuth((state) => state.signOut)

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <UserRound className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-medium">{user.username}</span>
          <span className="text-muted-foreground text-xs font-normal">{user.role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
