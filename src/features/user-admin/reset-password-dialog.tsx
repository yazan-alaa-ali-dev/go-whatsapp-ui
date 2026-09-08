import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { resetUserPassword, type AdminUser } from '@/api/users'
import { IdText } from '@/components/shared/id-text'
import { Button } from '@/components/ui/button'
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
import { ADMIN_REJECTIONS } from '@/lib/auth-messages'
import { displayText } from '@/lib/surfaces'
import {
  MAX_DISPLAY,
  PASSWORD_FAILED_REDACTED,
  PASSWORD_MAX_BYTES,
  passwordByteLength,
  passwordError,
  passwordFailure,
  userRejection,
} from '@/lib/user-admin'

/**
 * An administrative reset on somebody else's account.
 *
 * **There is no current-password field, and the dialog says why.** Asking an
 * administrator for the value they are replacing would be asking for one they
 * legitimately do not know — but an administrator who *expects* to be asked will
 * read its absence as a broken form, so the reason is on screen rather than only
 * in the reference.
 *
 * **The server's own text is never rendered for a failure here.** A `4xx`
 * rejecting this body may quote the field it rejected, and the only field is a
 * password. `passwordFailure` decides that before anything reaches the screen —
 * the same shape as `createFailure` for `meta_token_ref` and `webhookSaveFailure`
 * for the webhook secret — and a source rule fails the build if this file calls
 * `toActionErrorMessage` instead.
 *
 * **The target's username is text, never an `<input>`.** This form types a
 * credential belonging to a *different* principal into a page on the
 * administrator's own origin, which is precisely when a password manager offers
 * to update the administrator's own saved entry. A username field beside the
 * password is what makes that offer plausible; there is none, the form is
 * `autoComplete="off"`, and both fields announce themselves as new passwords.
 *
 * The raw `user_id` is shown beside the sanitised username, because that is this
 * repository's stated answer to a homoglyph: `admin` and `аdmin` (Cyrillic а)
 * cannot be told apart by reading, and this dialog hands somebody a credential.
 */
export function ResetPasswordDialog({
  user,
  onOpenChange,
}: {
  user: AdminUser | null
  onOpenChange: (open: boolean) => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  // Cleared whenever the dialog points at a different row — a credential left in
  // state is a credential the next open renders into a field.
  useEffect(() => {
    setPassword('')
    setConfirmation('')
    setFailure(null)
  }, [user])

  const problem = passwordError(password)
  const bytes = passwordByteLength(password)
  const mismatched = confirmation !== '' && confirmation !== password
  const invalid = password === '' || problem !== null || mismatched

  const reset = useMutation({
    mutationFn: () => resetUserPassword(user!.user_id, password),
    onSuccess: () => {
      // Names the user, never the password. There is nothing else to report: the
      // response carries the envelope alone, because a reset has nothing to say
      // back that the caller did not just send.
      toast.success(
        `Password reset for ${displayText(user!.username, MAX_DISPLAY)} — every session they held is now refused`,
      )
      onOpenChange(false)
    },
    onError: (error) => {
      const redacted = passwordFailure(error) === 'redacted'
      const rejection = userRejection(error, 'reset', {
        targetIsSelf: false,
        mayCollide: false,
        mayRemoveAdmin: false,
      })
      if (rejection) {
        const notice = ADMIN_REJECTIONS[rejection]
        setFailure(`${notice.title}. ${notice.description}`)
        return
      }
      setFailure(redacted ? PASSWORD_FAILED_REDACTED : 'The password was not changed.')
    },
  })

  if (!user) return null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (invalid) return
    setFailure(null)
    reset.mutate()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>{displayText(user.username, MAX_DISPLAY)}</DialogDescription>
          <IdText value={user.user_id} />
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} autoComplete="off">
          <div className="border-destructive/50 flex flex-col gap-2 rounded-lg border p-3 text-xs">
            <p className="text-destructive flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4" />
              This signs them out of everything, immediately.
            </p>
            <p className="text-muted-foreground">
              A reset increments their token epoch and revokes every refresh-token family they
              hold, so every device they are signed in on stops working at once. There is no
              grace period.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={problem !== null}
              required
            />
            <p className="text-muted-foreground text-xs">
              {bytes} / {PASSWORD_MAX_BYTES} bytes — the limit belongs to the hash, and characters
              outside the latin alphabet take two to four bytes each.
            </p>
            {problem && <p className="text-destructive text-xs">{problem}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="reset-confirmation">Repeat it</Label>
            <Input
              id="reset-confirmation"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={mismatched}
              required
            />
            {mismatched && <p className="text-destructive text-xs">The two do not match.</p>}
          </div>

          <p className="text-muted-foreground text-xs">
            There is no field for the current password, deliberately: this is an administrative
            reset on somebody else's account, and you are not expected to know the value you are
            replacing.
          </p>

          {failure && (
            <div className="border-destructive/50 text-destructive rounded-lg border p-3 text-xs">
              {failure}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={reset.isPending || invalid}>
              {reset.isPending && <Loader2 className="size-4 animate-spin" />}
              Reset and sign them out
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
