<script lang="ts">
  import Sticker from './Sticker.svelte';
  import {stickerTrigger, stickersForEmoji, stickersForQuery} from '$lib/telegram/stickers';
  import type {StickerItem} from '$lib/telegram/chats';

  let {
    draft,
    onpick
  }: {draft: string; onpick: (docId: string) => void} = $props();

  let suggestions = $state<StickerItem[]>([]);
  let active = $state(0);
  let dismissed = $state(false);

  // The strip is driven entirely by the draft: a bare emoji or a ":shortcode"
  // asks the server for stickers, anything else clears it.
  $effect(() => {
    const trigger = stickerTrigger(draft);
    let cancelled = false;

    if (!trigger) {
      suggestions = [];
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const found =
          trigger.kind === 'emoji'
            ? await stickersForEmoji(trigger.value)
            : await stickersForQuery(trigger.value);
        if (cancelled) return;
        suggestions = found;
        active = 0;
      } catch (err) {
        if (!cancelled) suggestions = [];
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Typing again brings a dismissed strip back.
  $effect(() => {
    void draft;
    dismissed = false;
  });

  let visible = $derived(!dismissed && suggestions.length > 0);

  /**
   * Capture phase, so Enter picks the highlighted sticker before the composer's
   * own keydown handler turns it into "send the text".
   */
  function onKey(e: KeyboardEvent) {
    if (!visible || e.isComposing) return;

    if (e.key === 'Escape') {
      dismissed = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = active + (e.key === 'ArrowRight' ? 1 : -1);
      if (next < 0 || next >= suggestions.length) return;
      active = next;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      const sticker = suggestions[active];
      if (!sticker) return;
      e.preventDefault();
      e.stopPropagation();
      pick(sticker.docId);
    }
  }

  function pick(docId: string) {
    suggestions = [];
    onpick(docId);
  }

  $effect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#if visible}
  <div class="suggest">
    {#each suggestions as sticker, i (sticker.docId)}
      <button
        class="tile"
        class:active={i === active}
        onclick={() => pick(sticker.docId)}
        onmouseenter={() => (active = i)}
      >
        <Sticker {sticker} size={56} />
      </button>
    {/each}
  </div>
{/if}

<style>
  .suggest {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
  }

  .tile {
    flex: none;
    background: none;
    border: none;
    padding: 2px;
    border-radius: 8px;
    cursor: pointer;
  }

  .tile.active {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }
</style>
