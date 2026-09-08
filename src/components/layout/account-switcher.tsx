import { Building2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAccounts } from '@/hooks/use-accounts'
import { accountName } from '@/lib/surfaces'
import { cn } from '@/lib/utils'
import { useAccountStore } from '@/stores/account'

/**
 * How a super administrator leaves their own account.
 *
 * **Mounted only for a holder of `accounts.manage.all`** — `app-shell.tsx` makes
 * that decision, so nobody else pays for the query behind this. That permission
 * answers *may you leave your own account* and it is the only one that does; the
 * `accounts.manage` an account administrator holds opens the accounts *surface*
 * and stops there (reference §04).
 *
 * **A menu rather than a `Select`.** The implicit scope is `null`, which is not a
 * value a Radix `Select` can carry — and its empty string is reserved, so
 * "my own account" would have needed a sentinel that a real account id could in
 * principle collide with. A menu expresses `null` directly, and it lets the
 * overflow line below be rendered as text rather than as a fake option.
 *
 * The list is **capped**. `GET /accounts` has no pagination and returns every
 * account on the deployment to this principal; the assumed order of magnitude is
 * tens, and the cap is what stops a larger deployment discovering the assumption
 * as a frozen header. Searching a long list belongs to the accounts screen.
 *
 * Choosing anything here goes through `enterAccount`, which clears the device
 * selection **before** it moves the lens — so no subscriber ever observes a
 * device from the previous account under the new one. That the device switcher
 * then adopts the new account's first device is why the context bar exists.
 */

/** Beyond this the accounts screen is the right tool; see the module header. */
const MAX_LISTED_ACCOUNTS = 50

export function AccountSwitcher() {
  const { data: accounts, isLoading } = useAccounts()
  const accountId = useAccountStore((state) => state.accountId)
  const enterAccount = useAccountStore((state) => state.enterAccount)

  const listed = accounts?.slice(0, MAX_LISTED_ACCOUNTS) ?? []
  const hidden = (accounts?.length ?? 0) - listed.length
  const current = accountId === null ? null : (accountName(accounts, accountId) ?? accountId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          // Hidden below `sm`: the header is 56px and already carries the device
          // switcher, the socket badge, the theme toggle and the user menu. This
          // control belongs to one principal in a deployment, so the cost of
          // hiding it on a phone falls on almost nobody.
          className="hidden max-w-44 sm:flex"
          aria-label="Switch account"
        >
          <Building2 className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{current ?? 'My account'}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Act inside an account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => enterAccount(null)}>
          <Check className={cn('size-4', accountId !== null && 'invisible')} />
          My account
        </DropdownMenuItem>
        {listed.map((account) => (
          <DropdownMenuItem
            key={account.account_id}
            onClick={() => enterAccount(account.account_id)}
          >
            <Check className={cn('size-4', accountId !== account.account_id && 'invisible')} />
            <span className="truncate">
              {accountName(accounts, account.account_id) ?? account.account_id}
            </span>
          </DropdownMenuItem>
        ))}
        {isLoading && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">Loading accounts…</p>
        )}
        {hidden > 0 && (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {hidden} more — open Accounts to find them.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
