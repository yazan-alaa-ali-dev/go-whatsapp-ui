import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { updateUser, type AdminUser, type UserStatus } from '@/api/users'
import { IdText } from '@/components/shared/id-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAccounts } from '@/hooks/use-accounts'
import { ADMIN_REJECTIONS, toActionErrorMessage } from '@/lib/auth-messages'
import { accountName, displayText } from '@/lib/surfaces'
import {
  collisionDetail,
  editableFrom,
  emailError,
  isEmptyUpdate,
  mayRemoveAdministration,
  MAX_DISPLAY,
  notFoundDetail,
  SEEDED_ROLES,
  updatePayloadFrom,
  userRejection,
  type EditableUser,
} from '@/lib/user-admin'

/**
 * Editing a user, in two steps: the diff, then the sentence that says what
 * saving it does.
 *
 * **The confirmation is not politeness.** Every non-empty `PATCH` on this
 * endpoint increments `token_epoch`, and every access and refresh token that
 * user holds is refused on its next request — there is no fifteen-minute window
 * and no way to undo it. An operator who changes an email address has, in the
 * same action, signed that person out of every device they own. That has to be
 * said **before** the request, not reported after it.
 *
 * **The username is not here.** `PATCH` does not accept one, and neither does
 * this form. Neither does a password: that is the reset dialog's job, and mixing
 * a credential into a form that is otherwise a diff is how a credential ends up
 * in a payload nobody meant to send.
 *
 * **The save is disabled while nothing is dirty**, which is what keeps the
 * client from ever issuing the empty body the server answers `400` to. That
 * `400` exists on purpose — "changed nothing" and "signed someone out of
 * everywhere" must not share a response — so the UI's job is to never produce
 * one rather than to explain one.
 *
 * This dialog *may* call `toActionErrorMessage`, unlike the two that hold a
 * password: nothing it sends is a credential, so the server's own text is a
 * diagnostic rather than a leak.
 */
export function EditUserDialog({
  user,
  isSelf,
  onOpenChange,
}: {
  user: AdminUser | null
  isSelf: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { data: accounts } = useAccounts()

  const original = useMemo(() => (user ? editableFrom(user) : null), [user])
  const [edited, setEdited] = useState<EditableUser | null>(original)
  const [confirming, setConfirming] = useState(false)
  const [customRole, setCustomRole] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // Re-seed when the panel points this dialog at a different row. `original` is
  // memoised on `user`, so this runs once per row rather than per render.
  useEffect(() => {
    setEdited(original)
    setConfirming(false)
    setCustomRole('')
    setFailure(null)
  }, [original])

  // Memoised on the two values it derives from. A payload recomputed every
  // render is a fresh identity, and a fresh object in a dependency array is an
  // infinite-loop shape.
  const payload = useMemo(
    () => (original && edited ? updatePayloadFrom(original, edited) : {}),
    [original, edited],
  )
  const nothingChanged = isEmptyUpdate(payload)
  const emailProblem = edited ? emailError(edited.email) : null

  const save = useMutation({
    mutationFn: () => updateUser(user!.user_id, payload),
    onSuccess: (updated) => {
      toast.success(
        `${displayText(updated.username, MAX_DISPLAY)} updated — every session they held is now refused (epoch ${updated.token_epoch})`,
      )
      // `['users']` only. `devicesKey` is keyed on the SIGNED-IN principal's
      // effective account lens, not on the edited user's account, so changing
      // somebody else's account cannot alter what this session's device queries
      // return — and changing your own ends the session, which empties the whole
      // cache anyway.
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      onOpenChange(false)
    },
    onError: (error) => {
      const rejection = userRejection(error, 'update', {
        targetIsSelf: isSelf,
        mayCollide: payload.email !== undefined || payload.account_id !== undefined,
        mayRemoveAdmin: mayRemoveAdministration(payload),
      })
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        // Appended on ANY 409 whose payload could have collided, including one
        // read as last-administrator: the server joins the causes and this
        // client does not pick between them, so both readings are on screen.
        const detail =
          rejection === 'already-taken' || rejection === 'last-administrator'
            ? collisionDetail({ email: payload.email, accountId: payload.account_id })
            : rejection === 'not-found'
              ? notFoundDetail({
                  userId: user?.user_id,
                  accountId: payload.account_id,
                  roles: payload.roles,
                })
              : ''
        setFailure(`${notice.title}. ${notice.description}${detail ? ` ${detail}` : ''}`)
        return
      }
      setFailure(toActionErrorMessage(error))
    },
  })

  if (!user || !edited || !original) return null

  const roleLabel = edited.roles.length > 0 ? edited.roles.join(', ') : 'none'
  const changes: string[] = []
  // Sanitised even though the operator typed it into this very form a moment
  // ago: this is the sentence that authorises signing somebody out of every
  // device they hold, and a bidi override in it reorders the lines around it.
  if (payload.email !== undefined) {
    changes.push(`email → ${displayText(payload.email, MAX_DISPLAY) || '(cleared)'}`)
  }
  if (payload.account_id !== undefined) changes.push(`account → ${payload.account_id}`)
  if (payload.status !== undefined) changes.push(`status → ${payload.status}`)
  // The COMPLETE final set, never "added admin". `roles` replaces rather than
  // merges, so what is submitted is the whole set — and what is on screen has to
  // be that same whole set or the confirmation is describing a different request.
  if (payload.roles !== undefined) changes.push(`roles → ${roleLabel}`)

  const toggleRole = (role: string, checked: boolean) =>
    setEdited((current) =>
      current
        ? {
            ...current,
            roles: checked
              ? [...current.roles, role]
              : current.roles.filter((held) => held !== role),
          }
        : current,
    )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {confirming ? 'This signs them out everywhere' : 'Edit user'}
          </DialogTitle>
          <DialogDescription>
            {displayText(user.username, MAX_DISPLAY)}
          </DialogDescription>
          <IdText value={user.user_id} />
        </DialogHeader>

        {confirming ? (
          <div className="flex flex-col gap-4">
            <div className="border-destructive/50 flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p className="text-destructive flex items-center gap-2 font-medium">
                <TriangleAlert className="size-4" />
                {isSelf
                  ? 'This will sign you out of this session immediately.'
                  : `This will sign ${displayText(user.username, MAX_DISPLAY)} out of every device immediately.`}
              </p>
              <p className="text-muted-foreground text-xs">
                {isSelf
                  ? 'Saving this increments your own token epoch, which refuses the session you are reading this in. You will be returned to the sign-in screen and will have to sign in again to pick up the change. There is no grace period.'
                  : 'Every access and refresh token they hold is refused on its next request. There is no grace period and no way to undo it — they will have to sign in again on every device.'}
              </p>
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium">What will be written</p>
              <ul className="text-muted-foreground list-inside list-disc text-xs">
                {changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                Nothing else is sent. A field you did not change is absent from the request, not
                blank in it.
              </p>
            </div>

            {failure && (
              <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
                {failure}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                variant="destructive"
                disabled={save.isPending}
                onClick={() => {
                  setFailure(null)
                  save.mutate()
                }}
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                {isSelf ? 'Save and sign myself out' : 'Save and sign them out'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                value={edited.email}
                onChange={(event) =>
                  setEdited({ ...edited, email: event.target.value })
                }
                autoComplete="off"
                aria-invalid={emailProblem !== null}
              />
              {emailProblem && <p className="text-destructive text-xs">{emailProblem}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-account">Account</Label>
              <Select
                value={edited.accountId}
                onValueChange={(value) => setEdited({ ...edited, accountId: value })}
              >
                <SelectTrigger id="edit-account">
                  <SelectValue placeholder={user.account_id} />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map((account) => (
                    <SelectItem key={account.account_id} value={account.account_id}>
                      {accountName(accounts, account.account_id) ?? account.account_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                An account can be changed but never emptied — a user belonging to nothing can
                address no device.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={edited.status}
                onValueChange={(value) => setEdited({ ...edited, status: value as UserStatus })}
              >
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Roles</Label>
              <p className="text-muted-foreground text-xs">
                Saving submits the complete set shown here, not the difference — an unticked box
                is a role removed. There is no endpoint listing the available ids, so anything
                beyond these three goes in the field below.
              </p>
              {SEEDED_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={edited.roles.includes(role)}
                    onCheckedChange={(checked) => toggleRole(role, checked === true)}
                  />
                  <code className="font-mono text-xs">{role}</code>
                </label>
              ))}
              {edited.roles
                .filter((role) => !SEEDED_ROLES.includes(role))
                .map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox checked onCheckedChange={() => toggleRole(role, false)} />
                    <code className="font-mono text-xs">{displayText(role, MAX_DISPLAY)}</code>
                  </label>
                ))}
              <div className="flex gap-2">
                <Input
                  value={customRole}
                  onChange={(event) => setCustomRole(event.target.value)}
                  placeholder="Add another role id"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={customRole.trim() === ''}
                  onClick={() => {
                    toggleRole(customRole.trim(), true)
                    setCustomRole('')
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            <p className="text-muted-foreground text-xs">
              {nothingChanged
                ? 'Nothing has changed yet, so there is nothing to save. An empty request is refused rather than ignored, because every real change signs the user out of everything.'
                : 'Only the fields you changed will be sent.'}
            </p>

            <DialogFooter>
              <Button
                disabled={nothingChanged || emailProblem !== null}
                onClick={() => setConfirming(true)}
              >
                Review and save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
