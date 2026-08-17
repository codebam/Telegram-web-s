<script lang="ts">
  import {loadEffects, type EffectItem} from '$lib/telegram/sendOptions';

  let {
    selected = '',
    onpick,
    onclose
  }: {
    /** Currently armed effect id, '' for none. */
    selected?: string;
    onpick: (effectId: string, emoticon: string) => void;
    onclose: () => void;
  } = $props();

  let effects = $state<EffectItem[]>([]);
  let loading = $state(true);
  let failed = $state(false);

  $effect(() => {
    let cancelled = false;

    loadEffects()
    .then((list) => {
      if (cancelled) return;
      effects = list;
      loading = false;
    })
    .catch(() => {
      if (cancelled) return;
      failed = true;
      loading = false;
    });

    return () => {
      cancelled = true;
    };
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="effect-popover">
  <div class="head">
    <span>Message effect</span>
    {#if selected}
      <button type="button" class="clear" onclick={() => onpick('', '')}>Remove</button>
    {/if}
  </div>

  {#if loading}
    <p class="muted">Loading effects…</p>
  {:else if failed || !effects.length}
    <p class="muted">No effects available.</p>
  {:else}
    <div class="grid">
      {#each effects as effect (effect.id)}
        <button
          type="button"
          class="effect"
          class:on={effect.id === selected}
          title={effect.premiumRequired ? `${effect.emoticon} — Premium` : effect.emoticon}
          onclick={() => onpick(effect.id, effect.emoticon)}
        >
          <span class="emoticon">{effect.emoticon}</span>
          {#if effect.premiumRequired}<span class="premium" aria-hidden="true">★</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .effect-popover {
    position: absolute;
    right: 8px;
    bottom: calc(100% + 8px);
    width: min(300px, calc(100vw - 32px));
    max-height: 260px;
    overflow-y: auto;
    padding: 10px;
    background: var(--bg-solid, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 12px;
    z-index: 40;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .clear {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }

  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
    gap: 4px;
  }

  .effect {
    position: relative;
    display: grid;
    place-items: center;
    height: 40px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .effect:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .effect.on {
    border-color: var(--accent);
  }

  .emoticon {
    font-size: 22px;
    line-height: 1;
  }

  .premium {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 9px;
    color: var(--accent);
  }
</style>
