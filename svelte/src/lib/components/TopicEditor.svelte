<script lang="ts">
  import {untrack} from 'svelte';

  import Sticker from './Sticker.svelte';
  import TopicIcon from './TopicIcon.svelte';
  import {
    createTopic,
    editTopic,
    loadTopicIconChoices,
    TOPIC_ICON_COLORS,
    topicIconColor,
    type TopicItem
  } from '$lib/telegram/topics';
  import type {StickerItem} from '$lib/telegram/chats';

  let {
    peerId,
    topic,
    onclose,
    onsaved
  }: {
    peerId: number;
    /** null when creating. */
    topic: TopicItem | null;
    onclose: () => void;
    onsaved: (threadId: number) => void;
  } = $props();

  // Mounted fresh on each open, so seeding from the props once is deliberate.
  let title = $state(untrack(() => topic?.title ?? ''));
  let iconColor = $state(untrack(() => topic?.iconColor ?? TOPIC_ICON_COLORS[0]));
  let iconEmojiId = $state(untrack(() => topic?.iconEmojiId ?? ''));
  let choices = $state<StickerItem[]>([]);
  let busy = $state(false);
  let error = $state('');

  $effect(() => {
    loadTopicIconChoices().then((items) => (choices = items));
  });

  async function save() {
    if (!title.trim() || busy) return;
    busy = true;
    error = '';

    try {
      if (topic) {
        await editTopic(peerId, topic.threadId, {title: title.trim(), iconEmojiId});
        onsaved(topic.threadId);
      } else {
        onsaved(await createTopic(peerId, title.trim(), {iconColor, iconEmojiId}));
      }
    } catch (err: any) {
      error = err?.type || err?.message || 'Failed to save the topic';
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <TopicIcon {iconEmojiId} {iconColor} title={title} size={26} />
      <span>{topic ? 'Edit topic' : 'New topic'}</span>
    </header>

    <label class="field">
      <span>Name</span>
      <input bind:value={title} placeholder="Topic name" maxlength="128" />
    </label>

    {#if !topic}
      <!-- The colour is fixed at creation: messages.editForumTopic cannot
           change it afterwards, only the custom emoji. -->
      <p class="label">Colour</p>
      <div class="colors">
        {#each TOPIC_ICON_COLORS as color (color)}
          <button
            class="swatch"
            class:on={color === iconColor}
            style="background: {topicIconColor(color)}"
            aria-label="Icon colour"
            onclick={() => (iconColor = color)}
          ></button>
        {/each}
      </div>
    {/if}

    <p class="label">Icon</p>
    <div class="icons">
      <button class="icon" class:on={!iconEmojiId} onclick={() => (iconEmojiId = '')} title="No icon">
        <TopicIcon iconColor={iconColor} title={title} size={26} />
      </button>
      {#each choices as choice (choice.docId)}
        <button
          class="icon"
          class:on={choice.docId === iconEmojiId}
          onclick={() => (iconEmojiId = choice.docId)}
        >
          <Sticker sticker={choice} size={26} />
        </button>
      {/each}
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <span class="spacer"></span>
      <button onclick={onclose} disabled={busy}>Cancel</button>
      <button class="primary" onclick={save} disabled={busy || !title.trim()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 90;
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
    max-height: min(560px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px;
    gap: 10px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 17px;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .label {
    margin: 6px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .colors {
    display: flex;
    gap: 8px;
  }

  .swatch {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .swatch.on {
    border-color: var(--text);
  }

  .icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    overflow-y: auto;
    max-height: 180px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .icon {
    display: grid;
    place-items: center;
    padding: 4px;
    border: 2px solid transparent;
    border-radius: 8px;
    background: none;
    cursor: pointer;
  }

  .icon.on {
    border-color: var(--accent);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .spacer {
    flex: 1;
  }

  footer button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  footer .primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  footer button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
</style>
