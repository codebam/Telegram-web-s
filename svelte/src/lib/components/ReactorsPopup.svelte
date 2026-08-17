<script lang="ts">
  import ReactionSticker from './ReactionSticker.svelte';
  import {
    canSeeReactors,
    messageReactors,
    parseReactionKey,
    reactionOptions,
    type Reactor,
    type ReactionOption
  } from '$lib/telegram/reactions';

  let {
    peerId,
    mid,
    initialKey = '',
    onclose
  }: {
    peerId: number;
    mid: number;
    /** Reaction tab to open on, '' for "all". */
    initialKey?: string;
    onclose: () => void;
  } = $props();

  let reactors = $state<Reactor[]>([]);
  let icons = $state<ReactionOption[]>([]);
  let tab = $state(initialKey);
  let loading = $state(true);
  let visible = $state(true);

  $effect(() => {
    const currentPeerId = peerId;
    const currentMid = mid;
    let cancelled = false;

    (async () => {
      const allowed = await canSeeReactors(currentPeerId, currentMid);
      if (cancelled) return;
      visible = allowed;
      if (!allowed) {
        loading = false;
        return;
      }

      const list = await messageReactors(currentPeerId, currentMid);
      if (cancelled) return;

      reactors = list;
      const refs = Array.from(new Set(list.map((reactor) => reactor.reactionKey)))
        .map(parseReactionKey)
        .filter(Boolean);
      icons = await reactionOptions(refs as any);
      loading = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  const tabs = $derived(
    Array.from(new Set(reactors.map((reactor) => reactor.reactionKey).filter(Boolean)))
  );
  const shown = $derived(tab ? reactors.filter((reactor) => reactor.reactionKey === tab) : reactors);

  function iconOf(key: string): ReactionOption | undefined {
    return icons.find((option) => option.key === key);
  }

  function countOf(key: string): number {
    return reactors.filter((reactor) => reactor.reactionKey === key).length;
  }
</script>

<div class="reactors-backdrop" onclick={onclose} role="presentation">
  <div
    class="reactors-dialog"
    onclick={(event) => event.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="People who reacted"
  >
    <header>
      <strong>Reactions</strong>
      <button onclick={onclose} aria-label="Close">✕</button>
    </header>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if !visible}
      <p class="muted">The reaction list is unavailable for this message.</p>
    {:else if !reactors.length}
      <p class="muted">Nobody has reacted yet.</p>
    {:else}
      {#if tabs.length > 1}
        <div class="tabs">
          <button class:active={tab === ''} onclick={() => (tab = '')}>All {reactors.length}</button>
          {#each tabs as key (key)}
            {@const option = iconOf(key)}
            <button class:active={tab === key} onclick={() => (tab = key)}>
              {#if option?.iconDocId}
                <ReactionSticker docId={option.iconDocId} size={18} fallback={option.emoticon} />
              {:else}
                <span class="plain">{option?.emoticon || '⭐'}</span>
              {/if}
              {countOf(key)}
            </button>
          {/each}
        </div>
      {/if}

      <ul>
        {#each shown as reactor (`${reactor.peerId}_${reactor.reactionKey}`)}
          {@const option = iconOf(reactor.reactionKey)}
          <li>
            <span class="who">{reactor.title}</span>
            {#if option?.iconDocId}
              <ReactionSticker docId={option.iconDocId} size={18} fallback={reactor.emoticon} />
            {:else}
              <span class="plain">{reactor.emoticon}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .reactors-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }

  .reactors-dialog {
    width: min(340px, 92vw);
    max-height: 70vh;
    overflow-y: auto;
    padding: 14px;
    border-radius: 14px;
    background: var(--bg-elevated);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  header button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }

  .tabs button {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    border-radius: 999px;
    padding: 3px 10px;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
    opacity: 0.65;
  }

  .tabs button.active {
    background: color-mix(in srgb, currentColor 14%, transparent);
    opacity: 1;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plain {
    font-size: 15px;
    line-height: 1;
  }

  .muted {
    font-size: 12px;
    opacity: 0.65;
    margin: 0;
  }
</style>
