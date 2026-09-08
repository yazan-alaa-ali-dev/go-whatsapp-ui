import { UsersRound } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { PageHeader } from '@/components/shared/page-header'

/**
 * `/users` — routed and guarded here, filled in by a later ticket.
 *
 * The users surface is the one that will finally need `roles[]` on screen, as a
 * value assigned and displayed and never as a source of authority. That
 * distinction, and the narrowed source-policy exemption it rests on, is already
 * settled in `src/api/users.ts`; the screen itself is its own change.
 *
 * What is real here: the route exists, behind the session guard and behind
 * `users.manage`, and a principal without it is told so.
 */
export default function UsersPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Users" description="The identities that may sign in to this server." />
      <EmptyState
        icon={UsersRound}
        title="The users list is not built yet"
        hint="This route and its permission guard are in place. The list, user creation, editing and the credential reset arrive with the users surface."
      />
    </div>
  )
}
