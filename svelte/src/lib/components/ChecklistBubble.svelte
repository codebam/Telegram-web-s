<script lang="ts">
  import {
    appendChecklistItems,
    completeChecklist,
    toggleChecklistItem,
    type ChecklistExtra
  } from '$lib/telegram/messageTypes';

  let {
    peerId,
    mid,
    checklist,
    onerror
  }: {
    peerId: number;
    mid: number;
    checklist: ChecklistExtra;
    onerror?: (message: string) => void;
  } = $props();

  // Ticks apply immediately and the manager reconciles from the server, so the
  // checkbox must not wait for a round trip to move.
  let optimistic = $state<Record<number, boolean>>({});
  let appending = $state(false);
  let newItem = $state('');
  let busy = $state(false);

  const items = $derived(
    checklist.items.map((item) => ({...item, done: optimistic[item.id] ?? item.done}))
  );
  const doneCount = $derived(items.filter((item) => item.done).length);
  const allDone = $derived(!!items.length && doneCount === items.length);

  async function toggle(id: number, done: boolean) {
    if (!checklist.canComplete) return;
    optimistic = {...optimistic, [id]: done};
    try {
      await toggleChecklistItem(peerId, mid, id, done);
    } catch (err: any) {
      optimistic = {...optimistic, [id]: !done};
      onerror?.(err?.message || 'Could not update the item');
    }
  }

  async function markAllDone() {
    if (busy) return;
    busy = true;
    const pending = items.filter((item) => !item.done);
    optimistic = pending.reduce((acc, item) => ({...acc, [item.id]: true}), optimistic);
    try {
      await completeChecklist(peerId, mid, checklist.items);
    } catch (err: any) {
      onerror?.(err?.message || 'Could not mark the list done');
    } finally {
      busy = false;
    }
  }

  async function append(e: SubmitEvent) {
    e.preventDefault();
    const text = newItem.trim();
    if (!text || busy) return;
    busy = true;
    try {
      await appendChecklistItems(peerId, mid, [text]);
      newItem = '';
      appending = false;
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not add the item');
    } finally {
      busy = false;
    }
  }
</script>

<div class="checklist">
  <span class="title">{checklist.title || 'Checklist'}</span>
  <span class="count">{doneCount} of {items.length} done</span>

  <ul>
    {#each items as item (item.id)}
      <li>
        <label class:done={item.done}>
          <input
            type="checkbox"
            checked={item.done}
            disabled={!checklist.canComplete}
            onchange={(e) => toggle(item.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{item.text}</span>
        </label>
      </li>
    {/each}
  </ul>

  <div class="actions">
    {#if checklist.canComplete && !allDone}
      <button onclick={markAllDone} disabled={busy}>Mark all done</button>
    {/if}
    {#if checklist.canAppend && !appending}
      <button onclick={() => (appending = true)}>Add item</button>
    {/if}
  </div>

  {#if appending}
    <form onsubmit={append}>
      <!-- svelte-ignore a11y_autofocus -->
      <input placeholder="New item" bind:value={newItem} autofocus />
      <button type="submit" disabled={busy || !newItem.trim()}>Add</button>
      <button type="button" onclick={() => { appending = false; newItem = ''; }}>Cancel</button>
    </form>
  {/if}
</div>

<style>
  .checklist {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 220px;
    max-width: 340px;
  }

  .title {
    font-weight: 600;
    font-size: 14px;
  }

  .count {
    font-size: 12px;
    color: var(--text-dim);
  }

  ul {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  label.done span {
    text-decoration: line-through;
    color: var(--text-dim);
  }

  input[type='checkbox'] {
    margin-top: 2px;
    accent-color: var(--accent);
  }

  .actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .actions button,
  form button {
    padding: 5px 9px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }

  .actions button:disabled,
  form button:disabled {
    color: var(--text-dim);
    cursor: default;
  }

  form {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  form input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
  }
</style>
