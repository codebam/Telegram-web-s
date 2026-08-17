<script lang="ts">
  import ReactionSticker from './ReactionSticker.svelte';
  import ChatReactionsSheet from './ChatReactionsSheet.svelte';
  import {
    canEditChatReactions,
    customEmojiChoices,
    isPremium,
    quickReaction,
    reactionsForMessage,
    recentReactions,
    setQuickReaction,
    type ReactionOption
  } from '$lib/telegram/reactions';

  let {
    peerId,
    mid,
    x,
    y,
    onpick,
    onpaid,
    onclose
  }: {
    peerId: number;
    mid: number;
    x: number;
    y: number;
    onpick: (option: ReactionOption) => void;
    onpaid: () => void;
    onclose: () => void;
  } = $props();

  let options = $state<ReactionOption[]>([]);
  let recent = $state<ReactionOption[]>([]);
  let custom = $state<ReactionOption[]>([]);
  let quickKey = $state('');
  let premium = $state(false);
  let allowsCustom = $state(false);
  let paidAvailable = $state(false);
  let atUniqCap = $state(false);
  let canEdit = $state(false);
  let loading = $state(true);
  let tab = $state<'reactions' | 'custom'>('reactions');
  let note = $state('');
  let adminOpen = $state(false);

  $effect(() => {
    const currentPeerId = peerId;
    const currentMid = mid;
    let cancelled = false;

    (async () => {
      const [available, recentList, quick, isPro, editable] = await Promise.all([
        reactionsForMessage(currentPeerId, currentMid),
        recentReactions(),
        quickReaction(),
        isPremium(),
        canEditChatReactions(currentPeerId)
      ]);
      if (cancelled) return;

      options = available.options;
      allowsCustom = available.allowsCustom;
      paidAvailable = available.paidAvailable;
      atUniqCap = available.atUniqCap;
      // Anything the chat does not allow must not be offered as "recent".
      recent =
        available.mode === 'chatReactionsAll'
          ? recentList
          : recentList.filter((option) => options.some((allowed) => allowed.key === option.key));
      quickKey = quick?.key ?? '';
      premium = isPro;
      canEdit = editable;
      loading = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  // The custom tab is premium-only and pulls a lot of documents, so it loads
  // the first time it is actually opened.
  $effect(() => {
    if (tab !== 'custom' || custom.length) return;
    customEmojiChoices().then((list) => (custom = list));
  });

  async function makeDefault(option: ReactionOption) {
    try {
      await setQuickReaction(option);
      quickKey = option.key;
      note = `${option.emoticon || 'That reaction'} is now your quick reaction`;
    } catch (err) {
      note = 'Could not change the quick reaction';
    }
  }

  function contextMenu(event: MouseEvent, option: ReactionOption) {
    event.preventDefault();
    makeDefault(option);
  }

  const shown = $derived(tab === 'custom' ? custom : [...recent, ...options]);
</script>

<div class="picker-backdrop" onclick={onclose} role="presentation"></div>

<div
  class="reaction-picker"
  style="left: {Math.min(x, 640)}px; top: {y}px"
  role="dialog"
  aria-label="Pick a reaction"
>
  {#if premium && allowsCustom}
    <div class="tabs">
      <button class:active={tab === 'reactions'} onclick={() => (tab = 'reactions')}>Reactions</button>
      <button class:active={tab === 'custom'} onclick={() => (tab = 'custom')}>Custom</button>
    </div>
  {/if}

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if !shown.length}
    <p class="hint">
      {atUniqCap ? 'This message cannot take another kind of reaction.' : 'No reactions here.'}
    </p>
  {:else}
    <div class="grid">
      {#each shown as option (option.key)}
        <button
          class="option"
          class:quick={option.key === quickKey}
          title={option.key === quickKey ? 'Your quick reaction' : 'Right-click to set as default'}
          onclick={() => onpick(option)}
          oncontextmenu={(event) => contextMenu(event, option)}
        >
          {#if option.iconDocId}
            <ReactionSticker docId={option.iconDocId} size={26} fallback={option.emoticon} />
          {:else}
            <span class="plain">{option.emoticon}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <footer>
    {#if paidAvailable}
      <button class="row" onclick={onpaid}>⭐ Send a star reaction</button>
    {/if}
    {#if canEdit}
      <button class="row" onclick={() => (adminOpen = true)}>Reactions in this chat…</button>
    {/if}
    <span class="hint">Right-click a reaction to make it your quick one.</span>
    {#if note}
      <span class="note">{note}</span>
    {/if}
  </footer>
</div>

{#if adminOpen}
  <ChatReactionsSheet {peerId} onclose={() => (adminOpen = false)} />
{/if}

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
  }

  .reaction-picker {
    position: fixed;
    z-index: 41;
    max-width: min(320px, 92vw);
    padding: 8px;
    border-radius: 14px;
    background: var(--bg-elevated);
    color: inherit;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  }

  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
  }

  .tabs button {
    flex: 1;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 4px 8px;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
    opacity: 0.7;
  }

  .tabs button.active {
    background: color-mix(in srgb, currentColor 14%, transparent);
    opacity: 1;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    max-height: 220px;
    overflow-y: auto;
  }

  .option {
    background: none;
    border: none;
    border-radius: 8px;
    padding: 4px;
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .option:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .option.quick {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .plain {
    font-size: 22px;
    line-height: 1;
  }

  footer {
    display: grid;
    gap: 4px;
    margin-top: 6px;
  }

  .row {
    background: none;
    border: none;
    border-radius: 8px;
    padding: 6px 8px;
    text-align: left;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .row:hover {
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .hint {
    font-size: 11px;
    opacity: 0.6;
    margin: 0;
    padding: 0 4px;
  }

  .note {
    font-size: 11px;
    color: var(--accent);
    padding: 0 4px;
  }
</style>
