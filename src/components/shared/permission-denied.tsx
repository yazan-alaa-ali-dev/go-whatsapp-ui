import { ShieldAlert } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { PERMISSION_DENIED } from '@/lib/auth-messages'

/**
 * What a principal sees where a surface they may not use would have been.
 *
 * **A 403 is a permission rejection, not an identity rejection.** So this
 * renders, and does nothing else: no redirect, no refresh attempt, no sign-out.
 * There is nothing wrong with the session, and treating a refused *capability*
 * as a refused *identity* would throw away a working session over a screen the
 * user simply may not open. `src/lib/source-policy.test.ts` fails the build if
 * this file or its caller ever names one of those three teardowns.
 *
 * The copy is `PERMISSION_DENIED` from `@/lib/auth-messages`, which is the
 * sentence the server's own 403 already gets through `toActionErrorMessage`. One
 * vocabulary for both halves: the client-side guard that spared the user a
 * request, and the server's answer when the guard was wrong.
 *
 * A blank screen would have been the alternative and is the thing this exists to
 * prevent — a route that renders nothing is indistinguishable from one that
 * failed.
 */
export function PermissionDenied() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title={PERMISSION_DENIED.title}
      hint={PERMISSION_DENIED.description}
    />
  )
}
