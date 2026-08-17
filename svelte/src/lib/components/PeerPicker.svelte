<script lang="ts">
  import type {Snippet} from 'svelte';

  import Avatar from './Avatar.svelte';
  import type {DialogItem} from '$lib/telegram/chats';

  let {
    title,
    dialogs,
    onpick,
    onclose,
    selectedIds = null,
    onconfirm,
    confirmLabel = 'Send',
    extras
  }: {
    title: string;
    dialogs: DialogItem[];
    /** In multi-select mode this toggles a target rather than committing it. */
    onpick: (peerId: number) => void;
    onclose: () => void;
    /**
     * Present — even empty — switches the picker to multi-select: rows carry a
     * checkmark and picking one keeps the dialog open.
     */
    selectedIds?: number[] | null;
    onconfirm?: () => void;
    confirmLabel?: string;
    /** Extra controls between the list and the buttons. */
    extras?: Snippet;
  } = $props();

  const multi = $derived(!!selectedIds);

  let query = $state('');

  const filtered = $derived(
    query.trim()
      ? dialogs.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase()))
      : dialogs
  );
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>{title}</header>
    <input placeholder="Search" bind:value={query} />
    <div class="list">
      {#each filtered as dialog (dialog.peerId)}
        <button
          class="row"
          class:picked={selectedIds?.includes(dialog.peerId)}
          onclick={() => onpick(dialog.peerId)}
        >
          <Avatar peerId={dialog.peerId} title={dialog.title} size={32} />
          <span class="name">{dialog.title}</span>
          {#if multi}
            <span class="check">{selectedIds?.includes(dialog.peerId) ? '✓' : ''}</span>
          {/if}
        </button>
      {/each}
      {#if !filtered.length}<p class="muted">No chats found.</p>{/if}
    </div>
    {#if extras}
      <div class="extras">{@render extras()}</div>
    {/if}
    <footer>
      <button onclick={onclose}>Cancel</button>
      {#if onconfirm}
        <button class="primary" disabled={!selectedIds?.length} onclick={onconfirm}>
          {confirmLabel}
        </button>
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
    z-index: 95;
  }

  .dialog {
    width: min(400px, calc(100vw - 32px));
    max-height: min(540px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    font-weight: 600;
    font-size: 17px;
  }

  input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  input:focus {
    border-color: var(--accent);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .row:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .picked {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .check {
    margin-left: auto;
    color: var(--accent);
    font-weight: 700;
  }

  .extras {
    display: grid;
    gap: 8px;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  footer button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  footer .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  footer .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--text-dim);
    padding: 14px;
    font-size: 13px;
  }
</style>
