import { memo } from 'react'
import { KeyRound, Pencil, Trash2 } from 'lucide-react'
import { IdText } from '@/components/shared/id-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDay } from '@/lib/format'
import type { AdminUser } from '@/api/users'

/**
 * One identity, as a row.
 *
 * **It calls no hook and renders no dialog**, both asserted by
 * `src/lib/source-policy.test.ts`. A permission hook here is one store
 * subscription per row for an answer identical on every row — the study's §13
 * rule 3 — and a dialog here would mount a mutation per row. The panel owns one
 * instance of each and passes down which row it is about.
 *
 * `memo()` because the panel's own state changes constantly — an open dialog, a
 * filter, a pending mutation — and none of it changes a row.
 *
 * **Every operator-controlled string arrives already sanitised.** `username`,
 * `email` and each role id are `displayText`-stripped by the panel before they
 * reach this file, and the raw `user_id` is rendered beside them by `IdText`.
 * React escapes HTML but does not neutralise a bidi override, and a username
 * carrying one is creatable through this very surface's own create form. A
 * source rule fails the build if this file interpolates a raw `.username` or
 * `.email` into a template.
 */

export interface UserRowProps {
  user: AdminUser
  /** Sanitised for rendering — never `user.username` directly. */
  username: string
  /** Sanitised, or the empty string when the user has none. */
  email: string
  /** The account's name when it is known, otherwise `null` and the id is shown alone. */
  accountLabel: string | null
  /** Sanitised role ids, in the order the server sorted them. */
  roleLabels: readonly string[]
  isSelf: boolean
  busy: boolean
  onEdit: (user: AdminUser) => void
  onReset: (user: AdminUser) => void
  onDelete: (user: AdminUser) => void
}

export const UserRow = memo(function UserRow({
  user,
  username,
  email,
  accountLabel,
  roleLabels,
  isSelf,
  busy,
  onEdit,
  onReset,
  onDelete,
}: UserRowProps) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium">{username || 'Unnamed user'}</p>
          {isSelf && <Badge variant="outline">You</Badge>}
          <Badge variant={user.status === 'active' ? 'secondary' : 'outline'}>
            {user.status === 'active' ? 'Active' : 'Disabled'}
          </Badge>
        </div>
        <IdText value={user.user_id} />
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>{email || 'No email'}</span>
          <span>{accountLabel ?? user.account_id}</span>
          {/* Role ids, displayed as values. Nothing anywhere decides a
              capability from one of these strings — that is `permissions[]`,
              and `GET /auth/me` is its only source. There is deliberately no
              permissions column: this endpoint carries no such field. */}
          <span>{roleLabels.length > 0 ? roleLabels.join(', ') : 'No roles'}</span>
          {/* Shown because it exists precisely so an operator can SEE that a
              change cut the outstanding sessions rather than trust that it did.
              Every mutating call increments it and every token the user holds is
              refused on its next request, with no grace window. */}
          <span title="Every change to this user increments this and signs them out everywhere">
            epoch {user.token_epoch}
          </span>
          <span>Created {formatDay(user.created_at)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onEdit(user)}
          aria-label={`Edit ${user.user_id}`}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onReset(user)}
          aria-label={`Reset the password of ${user.user_id}`}
        >
          <KeyRound className="size-4" />
        </Button>
        {/* Absent on your own row, not disabled. The server refuses deleting or
            disabling yourself so a deployment cannot be locked out by one click;
            offering an action that is always refused teaches an operator to
            ignore the refusal. Hiding it is an affordance — the server remains
            the authority. */}
        {!isSelf && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => onDelete(user)}
            aria-label={`Delete ${user.user_id}`}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
})
