/*
 * Ported from svelte/src/lib/components/AccountSwitcher.svelte.
 *
 * The `$effect` that loads the list reads nothing reactive — it is a mount-time
 * load, so it becomes a `useEffect` with an empty dependency list, kept
 * cancellable for the case where the dialog is closed before the load lands.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  addAccount,
  canAddAccount,
  listAccounts,
  logOutCurrentAccount,
  switchAccount,
  type AccountEntry
} from '$lib/telegram/accounts';

import './AccountSwitcher.css';

interface Props {
  onclose: () => void;
}

export function AccountSwitcher({onclose}: Props) {
  const accounts = useSignal<AccountEntry[]>([]);
  const loading = useSignal(true);
  const canAdd = useSignal(false);
  const busy = useSignal(false);
  const error = useSignal('');
  const confirmingLogOut = useSignal(false);

  useEffect(() => {
    let cancelled = false;

    (async() => {
      try {
        const [list, more] = await Promise.all([listAccounts(), canAddAccount()]);
        if(cancelled) return;
        accounts.value = list;
        canAdd.value = more;
      } catch(err: any) {
        if(!cancelled) error.value = err?.message || 'Could not load accounts';
      } finally {
        if(!cancelled) loading.value = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(account: AccountEntry) {
    if(account.isCurrent || busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      // Navigates away; nothing after this runs on success.
      await switchAccount(account.accountNumber);
    } catch(err: any) {
      error.value = err?.message || 'Could not switch account';
      busy.value = false;
    }
  }

  async function add() {
    if(busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await addAccount();
    } catch(err: any) {
      error.value = err?.message || 'Could not add an account';
      busy.value = false;
    }
  }

  async function doLogOut() {
    if(busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      // apiManagerProxy navigates once the worker has torn the account down.
      await logOutCurrentAccount();
    } catch(err: any) {
      error.value = err?.message || err?.type || 'Logout failed';
      busy.value = false;
      confirmingLogOut.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>Accounts</header>

        {loading.value ?
          <p class="hint">Loading…</p> :
          <>
            <div class="list">
              {accounts.value.map((account) => (
                <button
                  key={account.accountNumber}
                  class={['row', account.isCurrent && 'on'].filter(Boolean).join(' ')}
                  disabled={busy.value}
                  onClick={() => choose(account)}
                >
                  <Avatar peerId={account.userId} title={account.title} size={38} />
                  <span class="who">
                    <span class="name">{account.title}</span>
                    {account.username ? <span class="handle">@{account.username}</span> : null}
                  </span>
                  {account.isCurrent ? <span class="tick">✓</span> : null}
                </button>
              ))}
            </div>

            {canAdd.value ?
              <button class="add" onClick={add} disabled={busy.value}>+ Add another account</button> :
              <p class="hint">You are signed in to the maximum number of accounts.</p>}
          </>}

        {error.value ? <p class="error">{error.value}</p> : null}

        <footer>
          {confirmingLogOut.value ?
            <>
              <span class="confirm">Log out of this account?</span>
              <button onClick={() => (confirmingLogOut.value = false)} disabled={busy.value}>Cancel</button>
              <button class="danger" onClick={doLogOut} disabled={busy.value}>
                {busy.value ? 'Logging out…' : 'Log out'}
              </button>
            </> :
            <>
              <button class="danger" onClick={() => (confirmingLogOut.value = true)} disabled={busy.value}>Log out</button>
              <span class="spacer"></span>
              <button onClick={onclose} disabled={busy.value}>Close</button>
            </>}
        </footer>
      </div>
    </div>
  );
}
