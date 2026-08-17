<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {loadSendAsOptions, saveSendAs, type SendAsOption} from '$lib/telegram/sendOptions';

  let {
    peerId,
    current = null,
    onpick,
    onclose
  }: {
    peerId: number;
    /** Peer we currently post as, null when posting as ourselves. */
    current?: number | null;
    onpick: (sendAsPeerId: number) => void;
    onclose: () => void;
  } = $props();

  let options = $state<SendAsOption[]>([]);
  let loading = $state(true);

  // The list is only fetched when the picker opens: channels.getSendAs is a
  // real round trip and must never sit on the chat-open path.
  $effect(() => {
    const active = peerId;
    let cancelled = false;

    loadSendAsOptions(active)
    .then((list) => {
      if (cancelled) return;
      options = list;
      loading = false;
    })
    .catch(() => {
      if (cancelled) return;
      loading = false;
    });

    return () => {
      cancelled = true;
    };
  });

  function pick(option: SendAsOption) {
    onpick(option.peerId);
    saveSendAs(peerId, option.peerId).catch(() => {});
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="send-as-popover">
  <span class="head">Send message as…</span>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !options.length}
    <p class="muted">No other identity available.</p>
  {:else}
    {#each options as option (option.peerId)}
      <button
        type="button"
        class="option"
        class:on={option.peerId === current}
        onclick={() => pick(option)}
        disabled={option.premiumRequired}
        title={option.premiumRequired ? 'Requires Telegram Premium' : option.title}
      >
        <Avatar peerId={option.peerId} title={option.title} size={28} />
        <span class="title">{option.title}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .send-as-popover {
    position: absolute;
    left: 8px;
    bottom: calc(100% + 8px);
    width: min(260px, calc(100vw - 32px));
    max-height: 260px;
    overflow-y: auto;
    display: grid;
    gap: 2px;
    padding: 8px;
    background: var(--bg-solid, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 12px;
    z-index: 40;
  }

  .head {
    font-size: 11px;
    color: var(--text-dim);
    padding: 2px 4px 6px;
  }

  .muted {
    margin: 0;
    padding: 0 4px 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .option:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .option.on {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .option:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
