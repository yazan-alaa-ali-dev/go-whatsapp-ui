import { useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { PermissionDenied } from '@/components/shared/permission-denied'
import { IdText } from '@/components/shared/id-text'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AccountDevicesPanel } from '@/features/account-devices/account-devices-panel'
import { SmsFallbackCard } from '@/features/account-settings/sms-fallback-card'
import { UsersPanel } from '@/features/user-admin/users-panel'
import { useAccounts } from '@/hooks/use-accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { smsFallbackState } from '@/lib/account-settings'
import { PERMISSIONS } from '@/lib/permissions'
import { accountName, accountScopeEntry, mayEnterAccount } from '@/lib/surfaces'
import { useAccountStore } from '@/stores/account'
import { useAuth } from '@/stores/auth'

/**
 * `/accounts/:accountId` — the one administrative route that carries an id, and
 * the one place a URL can move the account scope.
 *
 * The scope behaviour is what this route carries the id for: the operational
 * screens keep their paths and read the scope from the store, which is what makes
 * a shared link to `/chats` context-free — so the administrative routes carry the
 * id and write it, and a shared link to one of *those* restores the context.
 *
 * z8pmx9mf19 filled the screen with the devices surface and deferred the `Tabs`
 * shell to whichever ticket brought a second thing to switch between, on the
 * grounds that a tab strip with one tab is structure built for a ticket that has
 * not been written. z8pmx9mf1a is that ticket: **Devices** and **Users**.
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
  // Hoisted here rather than inside the tab strip: it decides whether a tab
  // exists at all, and `GET /auth/users` requires the permission, so a tab
  // without it would manufacture a 403 for anyone who clicked it.
  const mayManageUsers = useHasPermission(PERMISSIONS.USERS_MANAGE)
  // The device count that stood here in z8pmx9mf18 is gone, and it removed a
  // duplicate RENDERING rather than a duplicate request: two observers of
  // accountDevicesKey(id) share one cache entry and one fetch either way. The
  // panel below owns that list and shows what it contains, so a bare number
  // above it was the same fact stated twice.
  const name = accountName(accounts, accountId)
  // Computed here rather than inside the settings card, from the list this
  // component already holds: there is no GET /accounts/{id}, so the list is the
  // only source, and a second observer on the same key would be a second reader
  // of a value that is already here. `unknown` while the list is pending, refused
  // or missing this account — the card renders that state rather than `false`.
  const smsFallback = smsFallbackState(accounts, accountId)

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
      <div className="flex flex-wrap items-center gap-3">
        <IdText value={accountId} />
      </div>
      {/* No `forceMount`, deliberately: Radix unmounts inactive content, so the
          users tab issues no `GET /auth/users` until somebody opens it. The
          cost is that the devices panel refetches when the tab is switched back
          — bounded by its own 30-second staleTime, and the right trade against
          a request on every visit to an account for a tab nobody looked at. */}
      <Tabs defaultValue="devices">
        <TabsList>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          {mayManageUsers && <TabsTrigger value="users">Users</TabsTrigger>}
          {/* Not gated on a further permission: this route is already behind
              `accounts.manage`, which is exactly what PATCH …/sms-fallback
              requires alongside scope. A second guard here would hide the tab
              from nobody and read like a control it is not. */}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="devices">
          <AccountDevicesPanel accountId={accountId} />
        </TabsContent>
        {mayManageUsers && (
          <TabsContent value="users">
            <UsersPanel accountId={accountId} />
          </TabsContent>
        )}
        <TabsContent value="settings">
          <SmsFallbackCard accountId={accountId} state={smsFallback} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
