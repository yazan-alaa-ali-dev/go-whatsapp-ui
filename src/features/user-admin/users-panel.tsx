import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { deleteUser, type AdminUser } from '@/api/users'
import { EmptyState } from '@/components/shared/empty-state'
import { IdText } from '@/components/shared/id-text'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateUserDialog } from '@/features/user-admin/create-user-dialog'
import { EditUserDialog } from '@/features/user-admin/edit-user-dialog'
import { ResetPasswordDialog } from '@/features/user-admin/reset-password-dialog'
import { UserRow } from '@/features/user-admin/user-row'
import { useAccounts } from '@/hooks/use-accounts'
import { useHasPermission } from '@/hooks/use-permissions'
import { useUsers } from '@/hooks/use-users'
import { toApiError } from '@/lib/api-error'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { PERMISSIONS } from '@/lib/permissions'
import { accountName, displayText } from '@/lib/surfaces'
import {
  DEFAULT_PAGE_SIZE,
  filterByAccount,
  isSelf,
  MAX_DISPLAY,
  notFoundDetail,
  pageState,
  userRejection,
} from '@/lib/user-admin'
import { useAuth } from '@/stores/auth'

/**
 * The identities that may sign in to this server.
 *
 * **One component serves both surfaces.** `/users` renders it unfiltered; the
 * account detail screen renders it with `accountId` fixed. A second "account
 * users" screen would be a rendering path exercised by half the principals and
 * tested by nobody.
 *
 * **The account filter narrows within the loaded page, and says so.**
 * `GET /auth/users` accepts no `account_id` (study §14, `Q-3`), so this is the
 * honest shape rather than a limitation to hide: a filter that looked
 * authoritative would report "this account has two users" when it has forty,
 * thirty-eight of them on the next page. The banner is the criterion, not a
 * courtesy.
 *
 * **This component owns every dialog, one instance each**, driven by which row
 * was chosen — the pattern `accounts.tsx` and `account-devices-panel.tsx`
 * establish, for their reason: a dialog per row mounts a mutation per row. The
 * permission boolean is hoisted here once, never per row.
 *
 * **The memoisation is what makes that pattern cheap.** Opening a dialog, typing
 * in the filter or pressing the pager is state *here*, and without a memoised
 * row every one of those re-renders the whole page of rows. The account name
 * lookup is a `Map` built once rather than `accountName` per row, which is a
 * linear scan and a regex pass each time.
 *
 * **Every operator-controlled string is sanitised before it reaches a row.**
 * `displayText` strips Unicode control and format characters and caps the
 * length — a username carrying `U+202E` reorders what is rendered around it, and
 * this surface's own create form can produce one. The raw `user_id` travels
 * alongside, which is the only answer to a homoglyph.
 *
 * Route guard: `users.manage` (`src/App.tsx`). A principal without it never
 * reaches this file.
 */
export function UsersPanel({ accountId }: { accountId?: string }) {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<string>('all')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [resetting, setResetting] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState<AdminUser | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const page = useMemo(() => ({ limit: DEFAULT_PAGE_SIZE, offset }), [offset])
  const users = useUsers(page)
  const { data: accounts } = useAccounts()

  // Hoisted once. `users.manage` is what the route is guarded on and what every
  // one of these endpoints requires; `users.manage.all` is deliberately not read
  // here, because `GET /accounts` is already scoped by the server and an unused
  // permission boolean reads like a control it is not.
  const mayManage = useHasPermission(PERMISSIONS.USERS_MANAGE)
  // A primitive selector, so the snapshot survives a store write that replaces
  // `user` with a structurally identical object.
  const signedInUserId = useAuth((state) => state.user?.user_id ?? null)

  // One Map, not `accountName` per row: that helper scans the account list and
  // runs a regex on every call, which over a hundred rows is a hundred of each,
  // on every re-render.
  const accountLabels = useMemo(() => {
    const labels = new Map<string, string>()
    for (const account of accounts ?? []) {
      const name = accountName(accounts, account.account_id)
      if (name) labels.set(account.account_id, name)
    }
    return labels
  }, [accounts])

  const effectiveFilter = accountId ?? (filter === 'all' ? undefined : filter)
  const rows = useMemo(
    () => filterByAccount(users.data, effectiveFilter),
    [users.data, effectiveFilter],
  )
  // On the LOADED page, not on the filtered view: whether another page exists is
  // a fact about the request, and a filter that hid every row of a full page
  // would otherwise claim there is no next one.
  const paging = useMemo(
    () => pageState(users.data?.length ?? 0, DEFAULT_PAGE_SIZE, offset),
    [users.data, offset],
  )
  // With `keepPreviousData` the rows on screen belong to the previous page while
  // the next is in flight, so the pager is frozen until the real page lands —
  // otherwise a second press advances the offset past a page nobody saw.
  const pagerBusy = users.isPlaceholderData || users.isFetching

  const onEdit = useCallback((user: AdminUser) => setEditing(user), [])
  const onReset = useCallback((user: AdminUser) => setResetting(user), [])
  const onDelete = useCallback((user: AdminUser) => setDeleting(user), [])

  const remove = useMutation({
    mutationFn: (user: AdminUser) => deleteUser(user.user_id),
    onSuccess: (_result, user) => {
      toast.success(`${displayText(user.username, MAX_DISPLAY)} deleted`)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      setDeleting(null)
    },
    onError: (error, user) => {
      const rejection = userRejection(error, 'delete', {
        targetIsSelf: isSelf(user.user_id, signedInUserId),
        mayCollide: false,
        mayRemoveAdmin: true,
      })
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        const detail =
          rejection === 'not-found' ? notFoundDetail({ userId: user.user_id }) : ''
        setFailure(`${notice.title}. ${notice.description}${detail ? ` ${detail}` : ''}`)
      } else {
        setFailure(toActionErrorMessage(error))
      }
      setDeleting(null)
    },
  })

  const loading = users.isLoading

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Rendered only when the account list is actually available.
              `useAccounts` is gated on `accounts.manage`, which a `users.manage`
              holder need not have — an empty select would be a control that
              looks broken rather than one that is absent. */}
          {!accountId && accounts && accounts.length > 0 && (
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every account</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.account_id} value={account.account_id}>
                    {accountLabels.get(account.account_id) ?? account.account_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!accountId && !accounts && (
            <p className="text-muted-foreground text-xs">
              Accounts are shown by id — reading their names needs the accounts permission.
            </p>
          )}
        </div>
        {mayManage && <CreateUserDialog accountId={accountId} />}
      </div>

      {/* The criterion, on screen. This endpoint has no account filter, so
          narrowing happens over the rows this page happened to load — and a
          screen that did not say so would be presenting a partial answer as an
          authoritative one. */}
      {effectiveFilter && (
        <div className="border-muted-foreground/30 text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
          Showing the users of this account <strong>from the page currently loaded</strong>. The
          server has no account filter on this endpoint, so a user of this account on another
          page is not counted here — page through to see the rest.
        </div>
      )}

      {users.error && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-sm">
            Failed to load users: {toApiError(users.error).message}
          </CardContent>
        </Card>
      )}

      {failure && (
        <Card className="border-destructive/50">
          <CardContent className="text-destructive py-4 text-xs">{failure}</CardContent>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-40" />
      ) : rows.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <ul className="flex flex-col divide-y">
              {rows.map((user) => (
                <UserRow
                  key={user.user_id}
                  user={user}
                  username={displayText(user.username, MAX_DISPLAY)}
                  email={displayText(user.email, MAX_DISPLAY)}
                  accountLabel={accountLabels.get(user.account_id) ?? null}
                  roleLabels={user.roles.map((role) => displayText(role, MAX_DISPLAY))}
                  isSelf={isSelf(user.user_id, signedInUserId)}
                  busy={remove.isPending}
                  onEdit={onEdit}
                  onReset={onReset}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        !users.error && (
          <EmptyState
            icon={UsersRound}
            title={effectiveFilter ? 'No users of this account on this page' : 'No users yet'}
            hint={
              effectiveFilter
                ? 'This page of the list holds none. Page through, or create the first user of this account.'
                : 'A user is an identity that can sign in. Create the first one to start.'
            }
          />
        )
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Derived from the rows actually rendered, never from the offset:
            while a page is in flight the rows on screen are the previous
            page's, and an offset-derived range would mislabel them. There is no
            total on this endpoint, so there is no "of N" to add. */}
        <p className="text-muted-foreground text-xs">
          {rows.length === 0 ? 'No rows' : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
          {offset > 0 && ` · from position ${offset + 1}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!paging.canPrevious || pagerBusy}
            onClick={() => setOffset(paging.previousOffset)}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!paging.canNext || pagerBusy}
            onClick={() => setOffset(paging.nextOffset)}
          >
            Older
          </Button>
        </div>
      </div>

      <EditUserDialog
        user={editing}
        isSelf={isSelf(editing?.user_id ?? '', signedInUserId)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <ResetPasswordDialog
        user={resetting}
        onOpenChange={(open) => {
          if (!open) setResetting(null)
        }}
      />

      {/* Inline rather than its own file: this is a title, one sentence and two
          buttons. `delete-account-dialog.tsx` earns a file through a two-step
          typed confirmation over a live device count, because that delete
          destroys WhatsApp session keys which re-pairing recovers only with
          physical access to a phone. A user delete is recoverable by creating
          the user again, so the ceremony is proportionate — but the
          IDENTIFICATION is not left to a label: the raw user_id is shown,
          because `admin` and `аdmin` are one click apart and a recreated user
          gets a new id anyway. */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {displayText(deleting?.username, MAX_DISPLAY) || 'this user'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every session and every refresh-token family this user holds is revoked in the same
              transaction — a deleted user whose 30-day refresh lineage survived would be a
              credential for a row that no longer exists. This cannot be undone; recreating the
              user produces a different id.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleting && <IdText value={deleting.user_id} />}
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                setFailure(null)
                if (deleting) remove.mutate(deleting)
              }}
            >
              Delete user
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
