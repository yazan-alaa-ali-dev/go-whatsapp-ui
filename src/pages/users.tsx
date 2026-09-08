import { PageHeader } from '@/components/shared/page-header'
import { UsersPanel } from '@/features/user-admin/users-panel'

/**
 * `/users` — every identity that may sign in to this server.
 *
 * The screen itself is `UsersPanel`, which the account detail screen also
 * renders with an account fixed. This route renders it unfiltered.
 *
 * The route and its `users.manage` guard were put in place by z8pmx9mf17; a
 * principal without the permission never reaches this file.
 */
export default function UsersPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        description="The identities that may sign in to this server. Every change to one signs it out of every device it holds."
      />
      <UsersPanel />
    </div>
  )
}
