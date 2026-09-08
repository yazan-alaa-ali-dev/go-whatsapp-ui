import { useEffect } from 'react'
import { ArrowRight, Building2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { PermissionDenied } from '@/components/shared/permission-denied'
import { EmptyState } from '@/components/shared/empty-state'
import { IdText } from '@/components/shared/id-text'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { useAccounts } from '@/hooks/use-accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { PERMISSIONS } from '@/lib/permissions'
import { accountName, accountScopeEntry, mayEnterAccount } from '@/lib/surfaces'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'

/**
 * `/accounts/:accountId` — the one administrative route that carries an id, and
 * the one place a URL can move the account scope.
 *
 * The screen itself (devices, users, settings tabs) belongs to later tickets.
 * What is this ticket's is the scope behaviour, and it is the reason this route
 * carries the id at all: the operational screens keep their paths and read the
 * scope from the store, which is what makes a shared link to `/chats` context-free
 * — so the administrative routes carry the id and write it, and a shared link to
 * one of *those* restores the context.
 */
export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const ownAccountId = useAuth((state) => state.user?.account_id ?? null)
  // `accounts.manage.all` — *may you leave your own account*. Deliberately NOT
  // the `accounts.manage` this route is guarded on: that one is *may you use the
  // accounts surface*, and an account administrator holds it. Answering the
  // first question with the second is what would let a link scope an
  // administrator into a customer's account, where GET /devices?account_id=
  // answers 200 with an empty list rather than 403 — read as "I have no
  // devices", with no diagnosis available anywhere.
  const mayLeaveOwnAccount = useHasPermission(PERMISSIONS.ACCOUNTS_MANAGE_ALL)
  const permitted = mayEnterAccount(accountId, ownAccountId, mayLeaveOwnAccount)

  useEffect(() => {
    // There is no `if (!permitted) return` here, and that is the point rather
    // than an omission: the permission travels INTO the decision as a required
    // argument, so this effect cannot write a scope the principal may not hold
    // even if somebody deletes every guard around it. A second check here would
    // be a redundant line that reads like the thing keeping this safe.
    //
    // The current scope is read through getState() rather than subscribed to:
    // this effect is what writes it, and subscribing would make it re-run on its
    // own write.
    const entry = accountScopeEntry(
      accountId,
      ownAccountId,
      useAccountStore.getState().accountId,
      mayLeaveOwnAccount,
    )
    if (entry) useAccountStore.getState().enterAccount(entry.enter)
  }, [accountId, ownAccountId, mayLeaveOwnAccount])

  if (!permitted) return <PermissionDenied />
  return <AccountDetail accountId={accountId!} />
}

function AccountDetail({ accountId }: { accountId: string }) {
  const { data: accounts } = useAccounts()
  const name = accountName(accounts, accountId)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name ?? 'Account'}
        description="Devices, users and settings for this account."
        actions={
          <Button asChild variant="outline" size="sm">
            {/* The scope is already written by the effect above, so this is a
                plain navigation: the whole existing app — devices, chats,
                messaging — is now looking at this account. */}
            <Link to="/">
              Open this account
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />
      <IdText value={accountId} />
      <EmptyState
        icon={Building2}
        title="The account surface is not built yet"
        hint="Entering the account works: its devices are what the switcher and every operational screen now show. The membership, reply-order and settings tabs arrive with the account surfaces."
      />
    </div>
  )
}
