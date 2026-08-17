<script lang="ts">
  import ReactionSticker from './ReactionSticker.svelte';
  import {
    activeReactions,
    chatReactionsSettings,
    setChatReactions,
    type ChatReactionsMode,
    type ReactionOption
  } from '$lib/telegram/reactions';

  let {peerId, onclose}: {peerId: number; onclose: () => void} = $props();

  let all = $state<ReactionOption[]>([]);
  let mode = $state<ChatReactionsMode>('none');
  let picked = $state<string[]>([]);
  let broadcast = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');

  $effect(() => {
    const currentPeerId = peerId;
    let cancelled = false;

    (async () => {
      const [reactions, settings] = await Promise.all([
        activeReactions(),
        chatReactionsSettings(currentPeerId)
      ]);
      if (cancelled) return;

      all = reactions;
      mode = settings?.mode ?? 'none';
      picked = settings?.emoticons ?? [];
      broadcast = !!settings?.broadcast;
      loading = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  function toggle(emoticon: string) {
    picked = picked.includes(emoticon)
      ? picked.filter((item) => item !== emoticon)
      : [...picked, emoticon];
    if (picked.length) mode = 'some';
  }

  async function save() {
    saving = true;
    error = '';
    try {
      await setChatReactions(peerId, mode, picked);
      onclose();
    } catch (err: any) {
      error = err?.message || 'Could not save the reactions';
    } finally {
      saving = false;
    }
  }
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div
    class="sheet"
    onclick={(event) => event.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="Reactions in this chat"
  >
    <header>
      <strong>Reactions in this chat</strong>
      <button onclick={onclose} aria-label="Close">✕</button>
    </header>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else}
      <div class="modes">
        {#if !broadcast}
          <label>
            <input type="radio" value="all" bind:group={mode} />
            All reactions
          </label>
        {/if}
        <label>
          <input type="radio" value="some" bind:group={mode} />
          Some reactions
        </label>
        <label>
          <input type="radio" value="none" bind:group={mode} />
          No reactions
        </label>
      </div>

      {#if mode === 'some'}
        <div class="grid">
          {#each all as option (option.key)}
            <button
              class="option"
              class:on={picked.includes(option.emoticon)}
              onclick={() => toggle(option.emoticon)}
              title={option.title}
            >
              {#if option.iconDocId}
                <ReactionSticker docId={option.iconDocId} size={26} fallback={option.emoticon} />
              {:else}
                <span class="plain">{option.emoticon}</span>
              {/if}
            </button>
          {/each}
        </div>
        <p class="muted">Members can react with the reactions you picked. Picking none turns reactions off.</p>
      {:else if mode === 'all'}
        <p class="muted">Members can react with any reaction, including custom emoji.</p>
      {:else}
        <p class="muted">Reactions are off for this chat.</p>
      {/if}

      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <button onclick={onclose}>Cancel</button>
        <button class="primary" disabled={saving} onclick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }

  .sheet {
    width: min(360px, 92vw);
    max-height: 80vh;
    overflow-y: auto;
    padding: 14px;
    border-radius: 14px;
    background: var(--bg-elevated);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }

  header button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }

  .modes {
    display: grid;
    gap: 6px;
    margin-bottom: 10px;
  }

  .modes label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    cursor: pointer;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    margin-bottom: 8px;
  }

  .option {
    background: none;
    border: none;
    border-radius: 8px;
    padding: 4px;
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0.45;
  }

  .option.on {
    opacity: 1;
    background: color-mix(in srgb, currentColor 14%, transparent);
  }

  .plain {
    font-size: 20px;
    line-height: 1;
  }

  .muted {
    font-size: 12px;
    opacity: 0.65;
    margin: 0 0 8px;
  }

  .error {
    font-size: 12px;
    color: var(--danger);
    margin: 0 0 8px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .actions button {
    background: none;
    border: none;
    border-radius: 8px;
    padding: 6px 12px;
    color: inherit;
    cursor: pointer;
  }

  .actions .primary {
    background: var(--accent);
    color: var(--action-ink);
  }
</style>
