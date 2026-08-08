<script lang="ts">
  import {untrack} from 'svelte';

  import {
    createFolder,
    deleteFolder,
    updateFolder,
    type DialogItem,
    type FolderItem
  } from '$lib/telegram/chats';

  let {
    folder,
    dialogs,
    onclose,
    onsaved
  }: {
    folder: FolderItem | null;
    dialogs: DialogItem[];
    onclose: () => void;
    onsaved: () => void;
  } = $props();

  // The editor is mounted fresh each time it opens, so seeding from the prop
  // once is intended — untrack keeps that explicit instead of looking like a
  // missed reactive dependency.
  let title = $state(untrack(() => folder?.title ?? ''));
  let selected = $state<Set<number>>(new Set(untrack(() => folder?.includePeerIds ?? [])));
  let busy = $state(false);
  let error = $state('');

  function toggle(peerId: number) {
    const next = new Set(selected);
    if(next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected = next;
  }

  async function save() {
    if(!title.trim() || busy) return;
    busy = true;
    error = '';

    try {
      const peerIds = [...selected];
      if(folder) await updateFolder(folder.id, title.trim(), peerIds);
      else await createFolder(title.trim(), peerIds);
      onsaved();
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to save folder';
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if(!folder || busy) return;
    busy = true;
    try {
      await deleteFolder(folder.id);
      onsaved();
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to delete folder';
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>{folder ? 'Edit folder' : 'New folder'}</header>

    <label class="field">
      <span>Name</span>
      <input bind:value={title} placeholder="Folder name" maxlength="12" />
    </label>

    <p class="label">Chats ({selected.size})</p>
    <div class="list">
      {#each dialogs as dialog (dialog.peerId)}
        <button
          class="row"
          class:on={selected.has(dialog.peerId)}
          onclick={() => toggle(dialog.peerId)}
        >
          <span class="check">{selected.has(dialog.peerId) ? '☑' : '☐'}</span>
          <span class="name">{dialog.title}</span>
        </button>
      {/each}
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      {#if folder}
        <button class="danger" onclick={remove} disabled={busy}>Delete</button>
      {/if}
      <span class="spacer"></span>
      <button onclick={onclose} disabled={busy}>Cancel</button>
      <button class="primary" onclick={save} disabled={busy || !title.trim()}>
        {busy ? 'Saving…' : 'Save'}
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
    z-index: 90;
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
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

  .field {
    display: grid;
    gap: 4px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .label {
    margin: 6px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
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
    gap: 8px;
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

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spacer {
    flex: 1;
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
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  footer .danger {
    color: var(--danger);
    border-color: transparent;
  }

  footer button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
</style>
