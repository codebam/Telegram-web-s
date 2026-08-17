<script lang="ts">
  import Sticker from './Sticker.svelte';
  import {
    loadSetPreview,
    stickerSetOfDoc,
    toggleSetInstalled,
    type StickerSetPreview
  } from '$lib/telegram/stickers';

  let {
    setKey = '',
    docId = '',
    onsend,
    onclose
  }: {
    /** Set id, short name or the short name out of a t.me/addstickers link. */
    setKey?: string;
    /** A sticker's document id — opens the pack that sticker belongs to. */
    docId?: string;
    onsend?: (docId: string) => void;
    onclose: () => void;
  } = $props();

  let preview = $state<StickerSetPreview | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    const key = setKey;
    const doc = docId;
    let cancelled = false;

    loading = true;
    error = '';
    (doc ? stickerSetOfDoc(doc) : loadSetPreview(key))
      .then((result) => {
        if (cancelled) return;
        preview = result;
        if (!result) error = 'Sticker set not found';
      })
      .catch((err: any) => {
        if (!cancelled) error = err?.type || err?.message || 'Failed to open the set';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });

    return () => {
      cancelled = true;
    };
  });

  async function toggle() {
    if (!preview || busy) return;
    busy = true;
    try {
      const installed = await toggleSetInstalled(preview.info.id);
      preview = {...preview, info: {...preview.info, installed, archived: false}};
    } catch (err: any) {
      error = err?.type || err?.message || 'Failed to update the set';
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation"></div>
<div class="sheet">
  <header>
    <strong>{preview?.info.title || 'Sticker set'}</strong>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>

  <div class="body">
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if error}
      <p class="muted">{error}</p>
    {:else if preview}
      <div class="grid">
        {#each preview.stickers as sticker (sticker.docId)}
          <button
            class="tile"
            onclick={() => {
              onsend?.(sticker.docId);
              onclose();
            }}
          >
            <Sticker {sticker} size={72} />
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if preview}
    <footer>
      <button class="primary" onclick={toggle} disabled={busy}>
        {preview.info.installed ? 'Remove stickers' : `Add ${preview.info.count || ''} stickers`.trim()}
      </button>
    </footer>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 40;
  }

  .sheet {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    max-height: min(70vh, 560px);
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
    z-index: 41;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .close {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 14px;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 4px;
  }

  .tile {
    background: none;
    border: none;
    padding: 2px;
    border-radius: 8px;
    cursor: pointer;
  }

  .tile:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  footer {
    padding: 10px 12px;
    border-top: 1px solid var(--border);
  }

  .primary {
    width: 100%;
    padding: 9px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    cursor: pointer;
  }

  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .muted {
    color: var(--text-dim);
    padding: 12px;
    font-size: 13px;
  }
</style>
