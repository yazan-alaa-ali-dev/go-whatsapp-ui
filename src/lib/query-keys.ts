/**
 * The query keys phase 2 reads and writes, in one place.
 *
 * **The scope is part of the key, not something beside it.** Account A's device
 * list is not account B's, and one `['devices']` key for both means entering an
 * account renders the previous account's devices out of the cache for as long
 * as the new request takes.
 *
 * **The key carries the *effective* filter, not the requested scope.** They
 * differ for exactly one principal: one who has set a scope and does not hold
 * `accounts.manage`. Keying on the requested scope would give that principal
 * two cache entries holding byte-identical data, because the request was
 * unfiltered both times. The effective filter is what the request actually was,
 * so it is what the cache is keyed on — and the guarantee above still holds,
 * since the key changes whenever what the server was asked for changes.
 *
 * **Prefix invalidation keeps working.** TanStack Query matches partially, so
 * `invalidateQueries({ queryKey: ['devices'] })` hits `['devices', null]` and
 * `['devices', 'acc_a']` alike. Six places in this app rely on that today —
 * `App.tsx`'s WebSocket switch, both session login dialogs, the push-name form,
 * the create-device dialog and the device card — and none of them is changed.
 * The property they all depend on is asserted in this module's own test rather
 * than at any one of the six call sites.
 *
 * Three of the four builders have no caller yet. That is the point: the account,
 * account-device and user surfaces are three separate later tickets, and the
 * alternative to defining the shapes once is each of them inventing its own and
 * two of them getting the prefix wrong.
 */

/** `GET /devices`, scoped by the effective account filter (`null` = unfiltered). */
export const devicesKey = (accountId: string | null) => ['devices', accountId] as const

/** `GET /accounts`. */
export const accountsKey = () => ['accounts'] as const

/**
 * `GET /accounts/{id}/devices` — the authoritative membership list, which is a
 * different question from `devicesKey`'s live registry answer and therefore a
 * different key rather than a variant of the same one.
 */
export const accountDevicesKey = (accountId: string) => ['account-devices', accountId] as const

/**
 * `GET /auth/users`, by page. The response is a flat array with no total, so
 * paging is "next/previous" built on whether a page came back full — the object
 * here records which page was asked for, and invents no count.
 *
 * An object in a key is safe and is existing precedent here (`chat-list.tsx`
 * keys on `['chats', { search, hasMedia, offset }]`): TanStack hashes a key with
 * `JSON.stringify` and sorted object keys, so a fresh literal per render is a
 * stable hash.
 */
export const usersKey = (page: { limit: number; offset: number }) => ['users', page] as const
