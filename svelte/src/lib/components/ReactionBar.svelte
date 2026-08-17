<script lang="ts">
  import ReactionSticker from './ReactionSticker.svelte';
  import ReactorsPopup from './ReactorsPopup.svelte';
  import {
    messageReactions,
    onReactionsUpdate,
    reactionEffectsEnabled,
    sendReaction,
    type MessageReaction
  } from '$lib/telegram/reactions';

  let {
    peerId,
    mid,
    /** Reactions the bubble already knows about — 0 keeps the bar quiet. */
    count = 0,
    /** Bumped by the chat when a reaction is sent from here. */
    revision = 0,
    canReact = true,
    onopenpicker,
    onopenstars,
    onerror
  }: {
    peerId: number;
    mid: number;
    count?: number;
    revision?: number;
    canReact?: boolean;
    onopenpicker: (event: MouseEvent) => void;
    onopenstars: () => void;
    onerror?: (message: string) => void;
  } = $props();

  let items = $state<MessageReaction[]>([]);
  let reactorsFor = $state<string | null>(null);
  /** The burst playing over the bubble, if any. */
  let burst = $state<{docId: string; token: number} | null>(null);
  let effectsOn = false;
  let chosenKeys = new Set<string>();
  let firstLoad = true;
  let token = 0;

  reactionEffectsEnabled().then((enabled) => (effectsOn = enabled));

  async function refresh() {
    const currentMid = mid;
    const currentPeerId = peerId;
    const next = await messageReactions(currentPeerId, currentMid);
    if (currentMid !== mid || currentPeerId !== peerId) return;

    // A reaction that just became ours is the one worth celebrating — that way
    // the burst plays for the picker, a chip click and a double-tap alike.
    const added = next.find((item) => item.chosen && !chosenKeys.has(item.key));
    chosenKeys = new Set(next.filter((item) => item.chosen).map((item) => item.key));
    items = next;

    // around_animation is the burst; the select animation stands in for the
    // reactions that ship without one (custom emoji, mostly).
    const effect = added && (added.aroundDocId || added.selectDocId);
    if (!firstLoad && effect && effectsOn) {
      burst = {docId: effect, token: ++token};
    }
    firstLoad = false;
  }

  /** Revision this bubble mounted with, so a later bump reads as "we acted". */
  let mountRevision = 0;
  let lastKey = '';

  $effect(() => {
    // Reading these keeps the bar in step with the bubble it belongs to.
    const currentCount = count;
    const currentRevision = revision;
    void peerId;
    void mid;

    let cancelled = false;
    // Only a different message starts over — a revision bump is our own send,
    // and forgetting what was chosen there would swallow the effect.
    const key = `${peerId}_${mid}`;
    if (key !== lastKey) {
      lastKey = key;
      firstLoad = true;
      chosenKeys = new Set();
      mountRevision = currentRevision;
    }

    // A message with no reactions costs no round trip until something happens
    // to it — a history screen is a hundred bubbles deep.
    if (currentCount || currentRevision !== mountRevision) {
      refresh().catch(() => {});
    } else {
      items = [];
      firstLoad = false;
    }

    let stop: (() => void) | undefined;
    onReactionsUpdate((updatedPeerId, updatedMid) => {
      if (cancelled || updatedPeerId !== peerId || updatedMid !== mid) return;
      refresh().catch(() => {});
    }).then((off) => {
      if (cancelled) off();
      else stop = off;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  });

  async function toggle(item: MessageReaction) {
    if (item.kind === 'paid') {
      onopenstars();
      return;
    }
    if (!canReact) return;

    try {
      await sendReaction(peerId, mid, item);
      await refresh();
    } catch (err: any) {
      onerror?.(err?.message || 'Reaction failed');
    }
  }

  function showReactors(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    reactorsFor = key;
  }
</script>

<span class="reaction-bar">
  {#each items as item (item.key)}
    <button
      class="chip"
      class:chosen={item.chosen}
      class:paid={item.kind === 'paid'}
      onclick={() => toggle(item)}
      oncontextmenu={(event) => showReactors(event, item.key)}
      title="Right-click to see who reacted"
    >
      {#if item.kind === 'paid'}
        <span class="plain">⭐</span>
      {:else if item.iconDocId}
        <ReactionSticker docId={item.iconDocId} size={16} fallback={item.emoticon} />
      {:else}
        <span class="plain">{item.emoticon}</span>
      {/if}
      <span class="count">{item.count}</span>
    </button>
  {/each}

  {#if canReact}
    <button class="chip add" onclick={onopenpicker} aria-label="Add a reaction" title="Add a reaction">
      ＋
    </button>
  {/if}

  {#if burst}
    {#key burst.token}
      <span class="burst" aria-hidden="true">
        <ReactionSticker
          docId={burst.docId}
          size={100}
          loop={false}
          onfinish={() => (burst = null)}
        />
      </span>
    {/key}
  {/if}
</span>

{#if reactorsFor !== null}
  <ReactorsPopup {peerId} {mid} initialKey={reactorsFor} onclose={() => (reactorsFor = null)} />
{/if}

<style>
  .reaction-bar {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.28);
    border: none;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    color: inherit;
    cursor: pointer;
  }

  .chip.chosen {
    background: var(--accent);
    color: var(--action-ink);
  }

  .chip.paid {
    background: color-mix(in srgb, #f0b53c 45%, transparent);
  }

  .chip.add {
    opacity: 0.5;
    font-size: 13px;
    line-height: 1;
  }

  .chip.add:hover {
    opacity: 1;
  }

  .plain {
    font-size: 14px;
    line-height: 1;
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  /* The around-animation plays over the bubble and must never take clicks. */
  .burst {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 100px;
    height: 100px;
    transform: translate(-25%, 35%);
    pointer-events: none;
    z-index: 5;
  }
</style>
