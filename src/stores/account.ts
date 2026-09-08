import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useDeviceStore } from '@/stores/device'

/**
 * The account lens.
 *
 * **An account is not a scope on the wire.** There is no `X-Account-Id` header,
 * no impersonation request and no account-switch endpoint. Exactly one thing
 * carries scope to the server — the device id — and the backend derives the
 * account from the ownership of that device (reference §06). So everything this
 * app calls "the current account" is a client-side lens: it narrows the list of
 * devices the operator may pick from, and the device selection does the rest.
 *
 * This store therefore adds no header and touches no request. `src/lib/http.ts`
 * does not import it, cannot import it, and `src/lib/source-policy.test.ts`
 * fails the build if that ever changes.
 */
interface AccountScopeState {
  /**
   * `null` is the **implicit scope** — whatever account the principal belongs
   * to, which the server narrows to by itself. It is a distinct value from any
   * explicit account id, and it is never spelled `''`: a blank `account_id` on
   * this wire means *no filter*, and specifically not "the devices that have no
   * account" (reference, `GET /devices`).
   */
  accountId: string | null
  enterAccount: (id: string | null) => void
}

export const useAccountStore = create<AccountScopeState>()(
  persist(
    (set) => ({
      accountId: null,

      /**
       * Move the lens, and clear the device selection in the same synchronous
       * action.
       *
       * **The order inside this function is load-bearing.** zustand notifies
       * subscribers synchronously inside `set`, so the intermediate state is
       * observable. Clearing the device first means the only state anyone can
       * see between the two writes is `(old account, no device)` — which sends
       * no `X-Device-Id` at all. Reversed, every subscriber woken by the lens
       * write would observe `(new account, old device)`: a request carrying a
       * device owned by the previous account, which the backend answers with
       * `404 DEVICE_NOT_FOUND` — the same bytes it returns for a device that
       * never existed, deliberately, so a `403` cannot confirm the device is
       * real. The operator would get a blank dashboard and no diagnosis exists
       * anywhere.
       *
       * **The clear is not guarded on `id !== accountId`.** A guard on the id
       * would make the guarantee depend on a comparison, and the comparison is
       * the part that breaks first — a normalisation difference, a `''` that
       * should have been `null`. The cost is stated rather than avoided:
       * re-entering the account you are already in drops your device selection.
       * That is one click; the alternative is a silent 404.
       *
       * **It *is* guarded on the device already being `null`,** which is a
       * different guard and cannot produce the state above — when there is no
       * device there is nothing to clear. It is worth writing because
       * `selectDevice(null)` on an already-null store still notifies, and
       * `App.tsx` subscribes the device store to drive `wsClient.sync()`.
       */
      enterAccount: (id) => {
        if (useDeviceStore.getState().selectedDeviceId !== null) {
          useDeviceStore.getState().selectDevice(null)
        }
        set({ accountId: id })
      },
    }),
    {
      // Versioned, like every persisted store here: changing the shape means
      // changing the version, or state already saved in a browser breaks.
      name: 'gowa-ui.account.v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
