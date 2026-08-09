<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {createChannel, createGroup, type DialogItem} from '$lib/telegram/chats';

  let {
    dialogs,
    onclose,
    oncreated
  }: {
    dialogs: DialogItem[];
    onclose: () => void;
    oncreated: (peerId: number) => void;
  } = $props();

  let kind = $state<'group' | 'channel'>('group');
  let title = $state('');
  let about = $state('');
  let query = $state('');
  let selected = $state<Set<number>>(new Set());
  let busy = $state(false);
  let error = $state('');

  // You cannot seed a chat with yourself, and only users can be invited.
  const contacts = $derived(dialogs.filter((d) => d.isUser && !d.isSelf));

  const filtered = $derived(
    query.trim()
      ? contacts.filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase()))
      : contacts
  );

  // A basic group must be created with at least one other member; a channel can
  // start empty and be filled later.
  const canCreate = $derived(
    !!title.trim() && (kind === 'channel' || selected.size > 0)
  );

  function toggle(peerId: number) {
    const next = new Set(selected);
    if (next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected = next;
  }

  async function create() {
    if (!canCreate || busy) return;
    busy = true;
    error = '';

    try {
      const members = [...selected];
      const peerId =
        kind === 'channel'
          ? await createChannel(title.trim(), about.trim(), members)
          : await createGroup(title.trim(), members);
      oncreated(peerId);
    } catch (err: any) {
      error = err?.type || err?.message || 'Failed to create chat';
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>New {kind}</header>

    <div class="kinds">
      <button class:on={kind === 'group'} onclick={() => (kind = 'group')}>Group</button>
      <button class:on={kind === 'channel'} onclick={() => (kind = 'channel')}>Channel</button>
    </div>

    <label class="field">
      <span>Name</span>
      <input bind:value={title} placeholder={kind === 'channel' ? 'Channel name' : 'Group name'} maxlength="128" />
    </label>

    {#if kind === 'channel'}
      <label class="field">
        <span>Description</span>
        <textarea bind:value={about} placeholder="Optional" maxlength="255" rows="2"></textarea>
      </label>
    {/if}

    <p class="label">
      Members ({selected.size})
      {#if kind === 'channel'}<span class="muted">— optional</span>{/if}
    </p>
    <input class="search" placeholder="Search contacts" bind:value={query} />

    <div class="list">
      {#each filtered as dialog (dialog.peerId)}
        <button class="row" class:on={selected.has(dialog.peerId)} onclick={() => toggle(dialog.peerId)}>
          <span class="check">{selected.has(dialog.peerId) ? '☑' : '☐'}</span>
          <Avatar peerId={dialog.peerId} title={dialog.title} size={32} />
          <span class="name">{dialog.title}</span>
        </button>
      {/each}
      {#if !filtered.length}<p class="muted">No contacts found.</p>{/if}
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <span class="spacer"></span>
      <button onclick={onclose} disabled={busy}>Cancel</button>
      <button class="primary" onclick={create} disabled={busy || !canCreate}>
        {busy ? 'Creating…' : 'Create'}
      </button>
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
    width: min(420px, calc(100vw - 32px));
    max-height: min(600px, calc(100vh - 48px));
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
    text-transform: capitalize;
  }

  .kinds {
    display: flex;
    gap: 8px;
  }

  .kinds button {
    flex: 1;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .kinds button.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 13px;
    color: var(--text-dim);
  }

  input,
  textarea {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
    resize: none;
  }

  input:focus,
  textarea:focus {
    border-color: var(--accent);
  }

  .label {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
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

  .row.on .name {
    color: var(--accent);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    padding: 10px;
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  footer {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .spacer {
    flex: 1;
  }

  footer button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  footer button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  footer button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
