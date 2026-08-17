<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    addAccount,
    canAddAccount,
    listAccounts,
    logOutCurrentAccount,
    switchAccount,
    type AccountEntry
  } from '$lib/telegram/accounts';

  let {onclose}: {onclose: () => void} = $props();

  let accounts = $state<AccountEntry[]>([]);
  let loading = $state(true);
  let canAdd = $state(false);
  let busy = $state(false);
  let error = $state('');
  let confirmingLogOut = $state(false);

  $effect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [list, more] = await Promise.all([listAccounts(), canAddAccount()]);
        if (cancelled) return;
        accounts = list;
        canAdd = more;
      } catch (err: any) {
        if (!cancelled) error = err?.message || 'Could not load accounts';
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  async function choose(account: AccountEntry) {
    if (account.isCurrent || busy) return;
    busy = true;
    error = '';
    try {
      // Navigates away; nothing after this runs on success.
      await switchAccount(account.accountNumber);
    } catch (err: any) {
      error = err?.message || 'Could not switch account';
      busy = false;
    }
  }

  async function add() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await addAccount();
    } catch (err: any) {
      error = err?.message || 'Could not add an account';
      busy = false;
    }
  }

  async function doLogOut() {
    if (busy) return;
    busy = true;
    error = '';
    try {
      // apiManagerProxy navigates once the worker has torn the account down.
      await logOutCurrentAccount();
    } catch (err: any) {
      error = err?.message || err?.type || 'Logout failed';
      busy = false;
      confirmingLogOut = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>Accounts</header>

    {#if loading}
      <p class="hint">Loading…</p>
    {:else}
      <div class="list">
        {#each accounts as account (account.accountNumber)}
          <button
            class="row"
            class:on={account.isCurrent}
            disabled={busy}
            onclick={() => choose(account)}
          >
            <Avatar peerId={account.userId} title={account.title} size={38} />
            <span class="who">
              <span class="name">{account.title}</span>
              {#if account.username}<span class="handle">@{account.username}</span>{/if}
            </span>
            {#if account.isCurrent}<span class="tick">✓</span>{/if}
          </button>
        {/each}
      </div>

      {#if canAdd}
        <button class="add" onclick={add} disabled={busy}>+ Add another account</button>
      {:else}
        <p class="hint">You are signed in to the maximum number of accounts.</p>
      {/if}
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      {#if confirmingLogOut}
        <span class="confirm">Log out of this account?</span>
        <button onclick={() => (confirmingLogOut = false)} disabled={busy}>Cancel</button>
        <button class="danger" onclick={doLogOut} disabled={busy}>
          {busy ? 'Logging out…' : 'Log out'}
        </button>
      {:else}
        <button class="danger" onclick={() => (confirmingLogOut = true)} disabled={busy}>Log out</button>
        <span class="spacer"></span>
        <button onclick={onclose} disabled={busy}>Close</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 90;
  }

  .dialog {
    width: min(400px, calc(100vw - 32px));
    max-height: min(560px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px;
    gap: 10px;
  }

  header {
    font-weight: 600;
    font-size: 17px;
  }

  .list {
    overflow-y: auto;
    display: grid;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px;
    background: none;
    border: none;
    border-radius: 10px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }

  .row:hover:not(:disabled) {
    background: var(--bg-hover, rgba(127, 127, 127, 0.12));
  }

  .row.on {
    background: var(--bg-hover, rgba(127, 127, 127, 0.12));
    cursor: default;
  }

  .who {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .name {
    font-size: 14px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .handle {
    font-size: 12px;
    color: var(--text-dim);
  }

  .tick {
    color: var(--accent);
    font-weight: 700;
  }

  .add {
    padding: 10px;
    background: none;
    border: 1px dashed var(--border);
    border-radius: 10px;
    color: var(--accent);
    cursor: pointer;
    font-size: 14px;
  }

  .add:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .error {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .confirm {
    flex: 1;
    font-size: 13px;
    color: var(--text-dim);
  }

  .spacer {
    flex: 1;
  }

  footer button {
    padding: 8px 12px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    cursor: pointer;
    font-size: 14px;
  }

  footer button:hover:not(:disabled) {
    border-color: var(--accent);
  }

  footer .danger {
    color: var(--danger);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
