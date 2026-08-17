<script lang="ts">
  import {loadInlineResultThumbnail, type InlineResultItem} from '$lib/telegram/settings';
  import {enqueueLoad} from '$lib/telegram/loadQueue';

  let {result, size = 44}: {result: InlineResultItem; size?: number} = $props();

  let url = $state<string | null>(null);
  let el = $state<HTMLSpanElement | null>(null);
  let seen = $state(false);

  $effect(() => {
    if(!el || seen) return;

    const observer = new IntersectionObserver((entries) => {
      if(entries.some((entry) => entry.isIntersecting)) {
        seen = true;
        observer.disconnect();
      }
    }, {rootMargin: '100px'});

    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    const id = result.queryAndResultId;
    if(!seen) return;
    url = null;
    enqueueLoad(() => loadInlineResultThumbnail(id)).then((resolved) => {
      if(id === result.queryAndResultId) url = resolved;
    });
  });

  const fallback = $derived((result.title.trim() || result.type || '?')[0].toUpperCase());
</script>

<span class="inline-preview" bind:this={el} style="width: {size}px; height: {size}px">
  {#if url}
    <img src={url} alt={result.title} />
  {:else}
    <span class="fallback">{fallback}</span>
  {/if}
</span>

<style>
  .inline-preview {
    display: inline-grid;
    place-items: center;
    border-radius: 8px;
    background: var(--surface-2, color-mix(in srgb, var(--text) 8%, transparent));
    overflow: hidden;
    flex: none;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .fallback {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-dim);
  }
</style>
