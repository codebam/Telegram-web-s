/**
 * Multi-account support.
 *
 * tweb pins the active account to the `?account=N` query param and memoises it
 * for the lifetime of the tab (`@lib/accounts/getCurrentAccount`). Every
 * storage key, every IndexedDB database and the MTProto worker's own manager
 * set are keyed off that number at boot, so *switching accounts is a
 * navigation* — that is exactly what tweb's own `changeAccount` does. This
 * module follows the same model rather than pretending the swap can happen in
 * place.
 *
 * The account slots themselves are owned by tweb's `AccountController`, which
 * is a main-thread static class over `sessionStorage`; reading it here does not
 * involve the worker.
 */
import type {ActiveAccountNumber} from '@lib/accounts/types';

import {bootTelegram} from './client';

export type AccountEntry = {
  accountNumber: ActiveAccountNumber,
  userId: number,
  title: string,
  username: string,
  isCurrent: boolean
};

/** Slots Telegram allows. Re-exported so the UI does not import tweb directly. */
export async function maxAccounts(): Promise<number> {
  const {MAX_ACCOUNTS} = await import('@lib/accounts/constants');
  return MAX_ACCOUNTS;
}

export async function currentAccountNumber(): Promise<ActiveAccountNumber> {
  const {getCurrentAccount} = await import('@lib/accounts/getCurrentAccount');
  return getCurrentAccount();
}

function titleOf(user: any, fallback: string): string {
  if(!user) return fallback;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || user.username || fallback;
}

function usernameOf(user: any): string {
  return user?.username ?? user?.usernames?.[0]?.username ?? '';
}

/**
 * Every signed-in account, in slot order.
 *
 * The current account is read through the booted managers; the others get their
 * own proxy via `createProxiedManagersForAccount`, which is how tweb's own
 * account menu resolves the names of accounts it is not currently running as.
 */
export async function listAccounts(): Promise<AccountEntry[]> {
  const {managers} = await bootTelegram();

  const [
    {default: AccountController},
    {MAX_ACCOUNTS},
    {getCurrentAccount},
    {createProxiedManagersForAccount}
  ] = await Promise.all([
    import('@lib/accounts/accountController'),
    import('@lib/accounts/constants'),
    import('@lib/accounts/getCurrentAccount'),
    import('@lib/getProxiedManagers')
  ]);

  const current = getCurrentAccount();
  const entries: AccountEntry[] = [];

  for(let i = 1; i <= MAX_ACCOUNTS; ++i) {
    const accountNumber = i as ActiveAccountNumber;
    const data = await AccountController.get(accountNumber);
    if(!data.userId) continue;

    const isCurrent = accountNumber === current;
    const accountManagers = isCurrent ? managers : createProxiedManagersForAccount(accountNumber);

    let user: any = null;
    try {
      user = await accountManagers.appUsersManager.getSelf();
    } catch(err) {
      // A slot whose worker cannot be reached still deserves a row.
    }

    entries.push({
      accountNumber,
      userId: Number(data.userId),
      title: titleOf(user, `Account ${accountNumber}`),
      username: usernameOf(user),
      isCurrent
    });
  }

  return entries;
}

export async function totalAccounts(): Promise<number> {
  const {default: AccountController} = await import('@lib/accounts/accountController');
  return AccountController.getTotalAccounts();
}

export async function canAddAccount(): Promise<boolean> {
  const [{default: AccountController}, {MAX_ACCOUNTS}] = await Promise.all([
    import('@lib/accounts/accountController'),
    import('@lib/accounts/constants')
  ]);
  return (await AccountController.getTotalAccounts()) < MAX_ACCOUNTS;
}

/**
 * Make another account active.
 *
 * This navigates. `getCurrentAccount()` is memoised from the URL on first call
 * and the worker's managers are already bound to it, so re-pointing them in
 * place is not possible without re-booting the whole stack — tweb reloads for
 * the same reason.
 */
export async function switchAccount(accountNumber: ActiveAccountNumber, newTab = false): Promise<void> {
  const {createAppURLForAccount} = await import('@lib/accounts/createAppURLForAccount');
  const url = createAppURLForAccount(accountNumber);

  if(newTab) {
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    return;
  }

  // Let the worker mark us offline before the tab goes away, but never block
  // the switch on it.
  try {
    const {managers} = await bootTelegram();
    await Promise.race([
      managers.appUsersManager.updateMyOnlineStatus(true),
      new Promise((resolve) => setTimeout(resolve, 300))
    ]);
  } catch(err) {}

  location.assign(url.toString());
}

/**
 * Start signing in to a fresh slot. The new slot has no auth key, so the app
 * boots into the sign-in flow for it while the existing accounts stay put.
 */
export async function addAccount(newTab = false): Promise<void> {
  const [{default: AccountController}, {MAX_ACCOUNTS}] = await Promise.all([
    import('@lib/accounts/accountController'),
    import('@lib/accounts/constants')
  ]);

  const total = await AccountController.getTotalAccounts();
  if(total >= MAX_ACCOUNTS) {
    throw new Error(`You can only be signed in to ${MAX_ACCOUNTS} accounts`);
  }

  return switchAccount((total + 1) as ActiveAccountNumber, newTab);
}

/** True when this tab is signing in to an extra slot rather than the first one. */
export async function isAddingAccount(): Promise<boolean> {
  const [current, total] = await Promise.all([currentAccountNumber(), totalAccounts()]);
  return current > 1 && total > 0;
}

/**
 * Log out of the account this tab is running as.
 *
 * `apiManager.logOut()` does the whole removal: it calls `auth.logOut` on every
 * DC the account holds a key for, clears that account's storages, and shifts
 * the higher slots down so there is never a hole in the list. It then dispatches
 * `logging_out`, which `apiManagerProxy` already listens for — the proxy
 * terminates the worker and navigates to the correct `?account=` itself. Do NOT
 * add a `location.reload()` here: it races that redirect and can land the tab on
 * a slot number that no longer means the same account after the shift.
 */
export async function logOutCurrentAccount(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.apiManager.logOut();
}
