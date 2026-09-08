import { ArrowRight, Building2, Smartphone, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { IdText } from '@/components/shared/id-text'
import { PageHeader } from '@/components/shared/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SURFACE_PERMISSIONS } from '@/components/layout/navigation'
import { useAccounts } from '@/hooks/use-accounts'
import { useHasPermission, useHomeSurface } from '@/hooks/use-permissions'
import { toApiError } from '@/lib/api-error'
import { accountName } from '@/lib/surfaces'
import { useAuth } from '@/stores/auth'
import DashboardPage from '@/pages/dashboard'

/**
 * `/` — the dispatcher.
 *
 * Three principals, three surfaces, one route, and the choice made from
 * `permissions[]` alone (`homeSurface` in `@/lib/surfaces`, reached through the
 * one hook allowed to read the field). There is no separate "admin dashboard"
 * path: two screens doing the same job diverge within a quarter.
 *
 * The `device` arm renders the existing `DashboardPage` **unchanged** — same
 * file, same component, same query. For a principal holding neither accounts
 * permission this route is what it has always been.
 */
export default function HomePage() {
  const surface = useHomeSurface()

  if (surface === 'platform') return <PlatformHome />
  if (surface === 'account') return <AccountHome />
  return <DashboardPage />
}

/**
 * What a super administrator lands on: how many accounts exist, and the way in.
 *
 * The accounts link is gated on the same `accounts.manage` the nav entry and the
 * route use, not on the `.manage.all` that got this principal here. They are
 * different questions, and a composed role holding only the global one would
 * otherwise be offered a route that refuses it.
 */
function PlatformHome() {
  const { data: accounts, isLoading, error } = useAccounts()
  const mayManageAccounts = useHasPermission(SURFACE_PERMISSIONS.accounts)
  const mayManageUsers = useHasPermission(SURFACE_PERMISSIONS.users)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Platform"
        description="Every account on this server, and the devices behind them."
      />

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            Failed to load accounts: {toApiError(error).message}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" />
              Accounts
            </CardTitle>
            <CardDescription>Customers grouped over their devices</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="font-heading text-3xl font-semibold">{accounts?.length ?? 0}</p>
            )}
            {mayManageAccounts && (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/accounts">
                  Manage accounts
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="size-4" />
              Devices
            </CardTitle>
            <CardDescription>
              The devices of whichever account you are acting inside
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">
              Use the account switcher in the header to act inside an account. Its devices, chats
              and messaging screens then work exactly as they do in your own.
            </p>
            {mayManageUsers && (
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/users">
                  Manage users
                  <UsersRound className="size-4" />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * What an account administrator lands on: their own account, and the way in.
 *
 * The same `/accounts/:accountId` screen a super administrator opens — there is
 * no separate "admin" version of it — reached with their own id. They cannot
 * open anybody else's; `mayEnterAccount` refuses the scope and the detail page
 * refuses the id.
 *
 * `account_id` is read straight off the principal. That is the identity field,
 * not an authorization one — the rule with a single reader is `permissions`.
 */
function AccountHome() {
  const ownAccountId = useAuth((state) => state.user?.account_id ?? '')
  const { data: accounts, isLoading, error } = useAccounts()
  const mayManageUsers = useHasPermission(SURFACE_PERMISSIONS.users)
  const name = accountName(accounts, ownAccountId)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Your account" description="The account you administer, and its devices." />

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            Failed to load the account: {toApiError(error).message}
          </CardContent>
        </Card>
      )}

      {/* The reference is explicit that a blank account_id is not "no account
          yet" but "owns nothing", and that the server refuses to create a user
          in that state — so this is a pre-existing identity that predates the
          account layer, and "you have no devices" would be the wrong diagnosis
          entirely. */}
      {ownAccountId === '' ? (
        <Card>
          <CardContent className="py-6 text-sm">
            <p className="font-medium">Your user is not linked to an account</p>
            <p className="text-muted-foreground mt-1">
              Devices are owned by accounts, so there is nothing for this user to administer yet.
              An administrator has to link it to one.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" />
              {isLoading && name === null ? <Skeleton className="h-5 w-40" /> : (name ?? 'Your account')}
            </CardTitle>
            <CardDescription>
              <IdText value={ownAccountId} />
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/accounts/${encodeURIComponent(ownAccountId)}`}>
                Open the account
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            {mayManageUsers && (
              <Button asChild variant="outline" size="sm">
                <Link to="/users">
                  Manage users
                  <UsersRound className="size-4" />
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/messaging">
                Go to messaging
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
