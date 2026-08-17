<script lang="ts">
  import Glyph from './Glyph.svelte';
  import {
    SEND_WHEN_ONLINE,
    deleteScheduled,
    editScheduled,
    loadScheduled,
    onScheduledUpdate,
    sendScheduledNow,
    type ScheduledItem
  } from '$lib/telegram/sendOptions';

  let {
    peerId,
    title = '',
    onclose
  }: {peerId: number; title?: string; onclose: () => void} = $props();

  let items = $state<ScheduledItem[]>([]);
  let loading = $state(true);
  let error = $state('');
  /** mid of the row being rewritten, null when nothing is open for editing. */
  let editingMid = $state<number | null>(null);
  let editingText = $state('');
  let busy = $state(false);

  async function refresh() {
    try {
      items = await loadScheduled(peerId);
      error = '';
    } catch (err: any) {
      error = err?.message ?? 'Could not load scheduled messages';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const active = peerId;
    loading = true;
    refresh();

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onScheduledUpdate((updatedPeerId) => {
      if (!cancelled && updatedPeerId === active) refresh();
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  function whenText(item: ScheduledItem) {
    if (item.whenOnline || item.date === SEND_WHEN_ONLINE) return 'When the recipient is online';
    return new Date(item.date * 1000).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try {
      await action();
      await refresh();
    } catch (err: any) {
      error = err?.message ?? 'Action failed';
    } finally {
      busy = false;
    }
  }

  function startEdit(item: ScheduledItem) {
    editingMid = item.mid;
    editingText = item.text;
  }

  function saveEdit() {
    const mid = editingMid;
    const text = editingText.trim();
    if (mid === null || !text) return;
    editingMid = null;
    run(() => editScheduled(peerId, mid, text));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editingMid !== null) editingMid = null;
      else onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="panel" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <span>Scheduled messages{title ? ` · ${title}` : ''}</span>
      <button type="button" class="close" onclick={onclose} aria-label="Close">
        <Glyph name="close" size={14} />
      </button>
    </header>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if !items.length}
      <p class="muted">Nothing is scheduled in this chat.</p>
    {:else}
      <div class="list">
        {#each items as item (item.mid)}
          <div class="row">
            <span class="when">{whenText(item)}{item.silent ? ' · silent' : ''}</span>

            {#if editingMid === item.mid}
              <textarea class="edit" rows="2" bind:value={editingText}></textarea>
              <div class="actions">
                <button type="button" onclick={() => (editingMid = null)}>Cancel</button>
                <button type="button" class="primary" onclick={saveEdit} disabled={busy}>Save</button>
              </div>
            {:else}
              <span class="text">
                {item.text || item.mediaLabel || 'Message'}
              </span>
              <div class="actions">
                <button type="button" onclick={() => startEdit(item)} disabled={!item.text || busy}>
                  Edit
                </button>
                <button
                  type="button"
                  onclick={() => run(() => sendScheduledNow(peerId, [item.mid]))}
                  disabled={busy}
                >Send now</button>
                <button
                  type="button"
                  class="danger"
                  onclick={() => run(() => deleteScheduled(peerId, [item.mid]))}
                  disabled={busy}
                >Delete</button>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <footer>
        <button
          type="button"
          onclick={() => run(() => sendScheduledNow(peerId, items.map((item) => item.mid)))}
          disabled={busy}
        >Send all now</button>
        <button
          type="button"
          class="danger"
          onclick={() => run(() => deleteScheduled(peerId, items.map((item) => item.mid)))}
          disabled={busy}
        >Delete all</button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 98;
  }

  .panel {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    background: var(--bg-solid, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-weight: 600;
    font-size: 16px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
  }

  .close:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .muted {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger, #e05c5c);
  }

  .list {
    display: grid;
    gap: 10px;
  }

  .row {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .when {
    font-size: 11px;
    color: var(--text-dim);
  }

  .text {
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .edit {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    resize: vertical;
    outline: none;
  }

  .edit:focus {
    border-color: var(--accent);
  }

  .actions,
  footer {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  footer {
    justify-content: flex-end;
  }

  .actions button,
  footer button {
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .actions button:disabled,
  footer button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .actions .primary {
    border-color: transparent;
    background: var(--action, var(--accent));
    color: var(--action-ink, #fff);
  }

  .danger {
    color: var(--danger, #e05c5c);
  }
</style>
