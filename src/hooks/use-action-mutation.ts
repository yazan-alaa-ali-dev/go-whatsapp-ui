import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { toActionErrorMessage } from '@/lib/auth-messages'

/**
 * Wraps a mutation with the standard toast-on-success/error behaviour used by
 * every action form. Returns the mutation plus the last successful result for
 * inline display.
 */
export function useActionMutation<TData, TVars>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: {
    successMessage?: string | ((data: TData) => string)
    onSuccess?: (data: TData, vars: TVars) => void
  },
) {
  return useMutation<TData, unknown, TVars>({
    mutationFn,
    onSuccess: (data, vars) => {
      const message =
        typeof options?.successMessage === 'function'
          ? options.successMessage(data)
          : (options?.successMessage ?? 'Done')
      toast.success(message)
      options?.onSuccess?.(data, vars)
    },
    // Not `toApiError(error).message`: a 403 is a permission rejection rather
    // than a malfunction, and says so — while keeping whatever the server
    // wrote, because a 403 from a proxy is not one from gowa (z8pmx9md71).
    onError: (error) => toast.error(toActionErrorMessage(error)),
  })
}
