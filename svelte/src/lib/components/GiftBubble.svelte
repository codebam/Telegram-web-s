<script lang="ts">
  import Sticker from './Sticker.svelte';
  import type {GiftExtra} from '$lib/telegram/messageTypes';

  let {gift, fromTitle}: {gift: GiftExtra; fromTitle: string} = $props();
</script>

<div class="gift" class:unique={gift.unique}>
  {#if gift.sticker}
    <Sticker sticker={gift.sticker} size={96} autoplay />
  {:else}
    <span class="fallback">🎁</span>
  {/if}

  <span class="title">
    {gift.title}{#if gift.unique && gift.num}<span class="num"> #{gift.num}</span>{/if}
  </span>
  <span class="who">
    {gift.incoming ? `from ${fromTitle || 'someone'}` : 'you sent this gift'}
  </span>

  {#if gift.valueText}
    <span class="value">{gift.valueText}</span>
  {/if}

  {#if gift.message}
    <span class="note">{gift.message}</span>
  {/if}

  <span class="sub">{gift.converted ? 'Converted to Stars' : gift.subtitle}</span>
</div>

<style>
  .gift {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--bubble-in);
    text-align: center;
    max-width: 260px;
  }

  .gift.unique {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  .fallback {
    font-size: 48px;
  }

  .title {
    font-weight: 600;
    font-size: 15px;
  }

  .num {
    color: var(--text-dim);
    font-weight: 500;
  }

  .who,
  .sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  .value {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent);
  }

  .note {
    font-size: 13px;
    margin-top: 4px;
  }
</style>
