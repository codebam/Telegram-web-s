<script lang="ts">
  import Sticker from './Sticker.svelte';
  import {loadTopicIcon, topicIconColor} from '$lib/telegram/topics';
  import type {StickerItem} from '$lib/telegram/chats';

  let {
    iconEmojiId = '',
    iconColor = 0,
    title = '',
    isGeneral = false,
    size = 22
  }: {
    iconEmojiId?: string;
    iconColor?: number;
    title?: string;
    isGeneral?: boolean;
    size?: number;
  } = $props();

  let icon = $state<StickerItem | null>(null);

  $effect(() => {
    const docId = iconEmojiId;
    icon = null;
    if (!docId) return;
    loadTopicIcon(docId).then((resolved) => {
      if (docId === iconEmojiId) icon = resolved;
    });
  });

  // Without a custom emoji Telegram draws a coloured hash carrying the topic's
  // first letter, which is what makes a topic list scannable at a glance.
  let letter = $derived(title.trim().charAt(0).toUpperCase());
</script>

<span class="topic-icon" style="width: {size}px; height: {size}px">
  {#if icon}
    <Sticker sticker={icon} {size} />
  {:else if isGeneral}
    <span class="general" style="font-size: {Math.round(size * 0.8)}px">≡</span>
  {:else}
    <span
      class="fallback"
      style="background: {topicIconColor(iconColor)}; font-size: {Math.round(size * 0.5)}px"
    >
      {letter || '#'}
    </span>
  {/if}
</span>

<style>
  .topic-icon {
    display: inline-grid;
    place-items: center;
    flex: none;
  }

  .fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
    font-weight: 600;
    line-height: 1;
  }

  .general {
    color: var(--muted, #8b97a3);
    line-height: 1;
  }
</style>
