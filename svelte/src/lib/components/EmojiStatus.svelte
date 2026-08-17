<script lang="ts">
  import CustomEmoji from './CustomEmoji.svelte';
  import {loadEmojiStatus} from '$lib/telegram/emoji';

  let {peerId, size = 16}: {peerId: number; size?: number} = $props();

  let docId = $state('');

  // The peer is already cached by the time a name is on screen, so this costs
  // no round-trip; peers without a status simply render nothing.
  $effect(() => {
    const id = peerId;
    let cancelled = false;
    docId = '';

    loadEmojiStatus(id).then((resolved) => {
      if (!cancelled) docId = resolved;
    });

    return () => {
      cancelled = true;
    };
  });
</script>

{#if docId}
  <CustomEmoji {docId} {size} animate={false} />
{/if}
