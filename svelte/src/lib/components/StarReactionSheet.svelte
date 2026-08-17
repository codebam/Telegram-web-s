<script lang="ts">
  import {
    isPaidReactionAnonymous,
    maxPaidStars,
    myPaidStars,
    sendPaidReaction,
    setPaidReactionAnonymous,
    starsBalance
  } from '$lib/telegram/reactions';

  let {
    peerId,
    mid,
    onsent,
    onclose
  }: {
    peerId: number;
    mid: number;
    onsent: () => void;
    onclose: () => void;
  } = $props();

  let balance = $state(0);
  let max = $state(2500);
  let mine = $state(0);
  let anonymous = $state(false);
  let count = $state(50);
  let sending = $state(false);
  let loading = $state(true);
  let error = $state('');

  $effect(() => {
    const currentPeerId = peerId;
    const currentMid = mid;
    let cancelled = false;

    (async () => {
      const [stars, limit, already, hidden] = await Promise.all([
        starsBalance(),
        maxPaidStars(),
        myPaidStars(currentPeerId, currentMid),
        isPaidReactionAnonymous()
      ]);
      if (cancelled) return;

      balance = stars;
      max = limit;
      mine = already;
      anonymous = hidden;
      count = Math.max(1, Math.min(50, limit));
      loading = false;
    })();

    return () => {
      cancelled = true;
    };
  });

  const tooPoor = $derived(count > balance);

  async function send() {
    sending = true;
    error = '';
    try {
      // The anonymity choice is per message, so it is stored before the stars
      // are spent — afterwards the top-reactor entry already exists.
      if (mine) await setPaidReactionAnonymous(peerId, mid, anonymous);
      await sendPaidReaction(peerId, mid, count, anonymous);
      onsent();
      onclose();
    } catch (err: any) {
      error = err?.message || 'Could not send the star reaction';
    } finally {
      sending = false;
    }
  }
</script>

<div class="sheet-backdrop" onclick={onclose} role="presentation">
  <div
    class="sheet"
    onclick={(event) => event.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label="Send a star reaction"
  >
    <header>
      <strong>⭐ Star reaction</strong>
      <button onclick={onclose} aria-label="Close">✕</button>
    </header>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else}
      <p class="muted">
        Your balance is {balance} ⭐{mine ? ` · you already sent ${mine}` : ''}
      </p>

      <div class="amount">
        <input type="range" min="1" max={max} bind:value={count} aria-label="Stars to send" />
        <input type="number" min="1" max={max} bind:value={count} aria-label="Stars to send" />
      </div>

      <label class="toggle">
        <input type="checkbox" bind:checked={anonymous} />
        Hide me from the top senders
      </label>

      {#if tooPoor}
        <p class="error">You do not have {count} stars.</p>
      {:else if error}
        <p class="error">{error}</p>
      {/if}

      <div class="actions">
        <button onclick={onclose}>Cancel</button>
        <button class="primary" disabled={sending || tooPoor} onclick={send}>
          {sending ? 'Sending…' : `Send ${count} ⭐`}
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
    width: min(340px, 92vw);
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

  .amount {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 10px;
  }

  .amount input[type='range'] {
    flex: 1;
  }

  .amount input[type='number'] {
    width: 84px;
    background: color-mix(in srgb, currentColor 10%, transparent);
    border: none;
    border-radius: 8px;
    padding: 4px 6px;
    color: inherit;
  }

  .toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 13px;
    margin-bottom: 10px;
    cursor: pointer;
  }

  .muted {
    font-size: 12px;
    opacity: 0.65;
    margin: 0 0 10px;
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
