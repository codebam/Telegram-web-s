<script lang="ts">
  import {enqueueLoad} from '$lib/telegram/loadQueue';
  import {loadReplyThumbUrl, type ReplyInfo} from '$lib/telegram/reply';

  let {reply, onjump}: {reply: ReplyInfo; onjump: () => void} = $props();

  let thumb = $state<string | null>(null);

  // A history full of replies is a history full of thumbnails, so they go
  // through the same bounded queue as the media grids.
  $effect(() => {
    const {peerId, mid, hasMedia} = reply;
    thumb = null;
    if (!hasMedia) return;

    let cancelled = false;
    enqueueLoad(() => loadReplyThumbUrl(peerId, mid)).then((url) => {
      if (!cancelled) thumb = url;
    });

    return () => {
      cancelled = true;
    };
  });
</script>

<button
  class="reply-header"
  style="--peer-color: {reply.color}"
  onclick={onjump}
  disabled={reply.deleted}
  title={reply.deleted ? 'The original message is gone' : 'Go to message'}
>
  {#if thumb}
    <img class="thumb" src={thumb} alt="" />
  {/if}
  <span class="body">
    <span class="who">
      <span class="name">{reply.title}</span>
      {#if reply.chatTitle}
        <!-- Cross-chat reply: the original lives somewhere else, and saying
             where is the only thing that makes the header make sense. -->
        <span class="in-chat">in {reply.chatTitle}</span>
      {/if}
    </span>
    {#if reply.quote}
      <span class="quote">
        <span class="quote-mark">❝</span>{reply.quote}
      </span>
    {:else}
      <span class="preview">{reply.deleted ? 'Deleted message' : reply.text}</span>
    {/if}
  </span>
</button>

<style>
  .reply-header {
    display: flex;
    align-items: stretch;
    gap: 8px;
    width: 100%;
    padding: 3px 8px;
    border: none;
    border-left: 2px solid var(--peer-color);
    border-radius: 4px;
    background: color-mix(in srgb, var(--peer-color) 12%, transparent);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .reply-header:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .body {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .who {
    display: flex;
    gap: 5px;
    align-items: baseline;
    font-size: 12px;
    font-weight: 600;
    color: var(--peer-color);
  }

  .in-chat {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-dim);
  }

  .name,
  .in-chat,
  .preview,
  .quote {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview,
  .quote {
    font-size: 13px;
    color: var(--text-dim);
  }

  .quote {
    font-style: italic;
  }

  .quote-mark {
    margin-right: 3px;
    color: var(--peer-color);
  }

  .thumb {
    flex: none;
    width: 32px;
    height: 32px;
    object-fit: cover;
    border-radius: 4px;
  }
</style>
