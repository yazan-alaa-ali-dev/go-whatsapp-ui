import { useState } from 'react'
import { ArrowRight, Building2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/shared/empty-state'
import { IdText } from '@/components/shared/id-text'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateAccountDialog } from '@/features/account-admin/create-account-dialog'
import { DeleteAccountDialog } from '@/features/account-admin/delete-account-dialog'
import { useAccounts } from '@/hooks/use-accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { toApiError } from '@/lib/api-error'
import { formatDay } from '@/lib/format'
import { PERMISSIONS } from '@/lib/permissions'
import { accountName } from '@/lib/surfaces'
import type { Account } from '@/api/accounts'

/**
 * `/accounts` — every account this principal may see, and the way in and out.
 *
 * **One screen serves both audiences and there is no branch that makes it so.**
 * `GET /accounts` returns every account to a holder of `accounts.manage.all` and
 * only the caller's own to everybody else (reference §05), so an account
 * administrator sees this component with one row in it. A second "admin" screen,
 * or an `if` that swaps what is listed, would be a rendering path exercised by
 * most principals and tested by nobody.
 *
 * **The two permission booleans are hoisted here, once.** Not per row: the answer
 * is identical for every row, and `<Can>` — or a hook — inside a `.map()` opens
 * one store subscription per account for it. The rule is `src/components/shared/can.tsx`'s
 * own, and `src/lib/source-policy.test.ts` fails the build over it.
 *
 * **There is no device-count column, deliberately.** The account object carries
 * no count (study §14, `Q-7`) and one request per row to obtain one is not
 * acceptable. The count belongs to the account detail screen, where there is one
 * account to count, and to the delete dialog, which reads it live because it must.
 *
 * Route guard: `accounts.manage` (`src/App.tsx`). A principal without it never
 * reaches this file.
 */
export default function AccountsPage() {
  const { data: accounts, isLoading, error } = useAccounts()
  // `accounts.manage.all`, because that is what POST /accounts requires
  // (reference §05) — not the `accounts.manage` this route is guarded on, which
  // an account administrator holds and which opens the surface without opening
  // creation.
  const mayCreate = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE_ALL)
  // Named rather than assumed. The route guard already requires it, so this is
  // true wherever this component renders — but the control states the permission
  // it depends on, so a future change to the route cannot silently widen who is
  // offered an irreversible delete.
  const mayDelete = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE)
  const [deleting, setDeleting] = useState<Account | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Accounts"
        description="Customers grouped over their devices."
        actions={mayCreate ? <CreateAccountDialog /> : undefined}
      />

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            Failed to load accounts: {toApiError(error).message}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : accounts && accounts.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {accounts.map((account) => (
                <AccountRow
                  key={account.account_id}
                  account={account}
                  accounts={accounts}
                  mayDelete={mayDelete}
                  onDelete={setDeleting}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        !error && (
          <EmptyState
            icon={Building2}
            title="No accounts yet"
            hint={
              mayCreate
                ? 'An account groups the devices of one customer. Create the first one to start.'
                : 'There is nothing here for this user to administer yet.'
            }
          />
        )
      )}

      {/* One dialog for the whole screen, driven by which row was chosen. One
          per row would mount a mutation and a query instance per account — the
          per-row cost this file refuses everywhere else. */}
      <DeleteAccountDialog
        account={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      />
    </div>
  )
}

/**
 * One account.
 *
 * The columns the account object actually carries: name, id, SMS fallback state,
 * created date, and the way in. `mayDelete` arrives as a **prop** — the hook is
 * called once in the parent, not once per row.
 *
 * The name goes through `accountName`, which strips Unicode control and format
 * characters and caps the length: an account name is operator-chosen server text
 * and a bidi override in it can reorder what is rendered around it. The raw id
 * is always shown beside it, which is the only answer to a homoglyph.
 */
function AccountRow({
  account,
  accounts,
  mayDelete,
  onDelete,
}: {
  account: Account
  accounts: readonly Account[]
  mayDelete: boolean
  onDelete: (account: Account) => void
}) {
  const name = accountName(accounts, account.account_id)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="truncate font-medium">{name ?? 'Unnamed account'}</p>
        <IdText value={account.account_id} />
        <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={account.sms_fallback_enabled ? 'secondary' : 'outline'}>
            {/* Never "SMS enabled": this switch arms the ACCOUNT, and delivery
                also needs a gateway the deployment configures separately
                (reference §05, study §09). */}
            SMS fallback {account.sms_fallback_enabled ? 'armed' : 'off'}
          </Badge>
          <span>Created {formatDay(account.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {mayDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(account)}
            aria-label={`Delete ${account.account_id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to={`/accounts/${encodeURIComponent(account.account_id)}`}>
            Open
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </li>
  )
}
