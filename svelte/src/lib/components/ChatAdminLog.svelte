<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {formatDate, loadRecentActions, type AdminChat, type RecentAction} from '$lib/telegram/admin';

  let {chat, onpeer}: {chat: AdminChat; onpeer?: (peerId: number) => void} = $props();

  let actions = $state<RecentAction[]>([]);
  let loading = $state(true);
  let error = $state('');

  $effect(() => {
    const peerId = chat.peerId;
    loading = true;
    error = '';

    loadRecentActions(peerId)
      .then((loaded) => {
        if (peerId === chat.peerId) actions = loaded;
      })
      .catch((err: any) => (error = err?.type || err?.message || 'Failed to load recent actions'))
      .finally(() => (loading = false));
  });
</script>

<div class="pane">
  {#if loading}
    <p class="admin-muted">Loading…</p>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if !actions.length}
    <p class="admin-muted">Nothing has happened here yet.</p>
  {:else}
    <p class="admin-hint">Admin actions from the last 48 hours.</p>

    {#each actions as action (action.id)}
      <div class="event">
        <button class="admin-peer" onclick={() => onpeer?.(action.peerId)}>
          <Avatar peerId={action.peerId} title={action.title} size={28} />
          <span class="admin-name">
            <span><strong>{action.title}</strong> {action.text}</span>
            <span class="admin-sub">{formatDate(action.date)}</span>
          </span>
        </button>
        {#if action.detail}
          <p class="detail">{action.detail}</p>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 8px;
    align-content: start;
  }

  .event {
    display: grid;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .detail {
    margin: 0 0 0 38px;
    font-size: 13px;
    color: var(--text-dim);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .admin-sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  strong {
    font-weight: 600;
  }
</style>
