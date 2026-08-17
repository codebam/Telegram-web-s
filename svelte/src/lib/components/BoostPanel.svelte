<script lang="ts">
  import Checkout from './Checkout.svelte';
  import {
    boostChannel,
    createGiveaway,
    loadBoostStatus,
    loadGiveawaySetup,
    loadMyBoostSlots,
    type BoostSlot,
    type BoostStatus,
    type Checkout as CheckoutData,
    type GiveawaySetup
  } from '$lib/telegram/payments';

  let {
    peerId,
    title,
    canCreateGiveaway = false,
    onclose
  }: {
    peerId: number;
    title: string;
    /** Only channel admins may launch a giveaway. */
    canCreateGiveaway?: boolean;
    onclose: () => void;
  } = $props();

  let view = $state<'boost' | 'giveaway'>('boost');
  let status = $state<BoostStatus | null>(null);
  let slots = $state<BoostSlot[]>([]);
  let chosenSlots = $state<number[]>([]);

  let setup = $state<GiveawaySetup | null>(null);
  let winners = $state(0);
  let months = $state(0);
  let days = $state(7);
  let onlyNew = $state(false);
  let showWinners = $state(true);
  let prize = $state('');
  let countries = $state('');

  let checkout = $state<CheckoutData | null>(null);
  let error = $state('');
  let note = $state('');
  let busy = $state('');

  function report(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  $effect(() => {
    loadBoostStatus(peerId)
    .then((value) => {
      status = value;
      chosenSlots = value.myBoostSlots.slice();
    })
    .catch((err) => report(err, 'Could not load the boost status'));

    loadMyBoostSlots()
    .then((value) => (slots = value))
    .catch(() => (slots = []));
  });

  $effect(() => {
    if(view !== 'giveaway' || setup) return;
    loadGiveawaySetup(peerId)
    .then((value) => {
      setup = value;
      winners = value.premiumWinnerCounts[0] ?? 0;
      months = value.premiumMonths[0] ?? 0;
    })
    .catch((err) => report(err, 'Could not load the giveaway options'));
  });

  const freeSlots = $derived(slots.filter((slot) => slot.peerId !== peerId));

  function toggleSlot(slot: number) {
    chosenSlots = chosenSlots.includes(slot) ?
      chosenSlots.filter((value) => value !== slot) :
      [...chosenSlots, slot];
  }

  async function boost() {
    error = '';
    note = '';
    busy = 'boost';
    try {
      status = await boostChannel(peerId, chosenSlots);
      slots = await loadMyBoostSlots();
      note = 'Boost applied';
    } catch(err: any) {
      const type = err?.type || '';
      if(type === 'PREMIUM_ACCOUNT_REQUIRED') {
        error = 'Boosting a channel needs Telegram Premium.';
      } else if(type === 'BOOST_NOT_MODIFIED') {
        error = 'You are already boosting this channel with those slots.';
      } else {
        report(err, 'Could not boost this channel');
      }
    } finally {
      busy = '';
    }
  }

  async function launchGiveaway() {
    error = '';
    busy = 'giveaway';
    try {
      checkout = await createGiveaway({
        peerId,
        winners,
        months,
        untilDate: Math.floor(Date.now() / 1000) + days * 86400,
        onlyNewSubscribers: onlyNew,
        showWinners,
        prizeDescription: prize.trim(),
        countriesIso2: countries
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
        additionalPeerIds: []
      });
    } catch(err) {
      report(err, 'Could not start the giveaway checkout');
    } finally {
      busy = '';
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleDateString() : '';
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Boosts">
    <header>
      <strong>Boosts · {title}</strong>
      <button class="close" onclick={onclose} aria-label="Close">✕</button>
    </header>

    <div class="body">
      {#if error}<p class="error">{error}</p>{/if}
      {#if note}<p class="ok">{note}</p>{/if}

      {#if canCreateGiveaway}
        <div class="chips">
          <button class:on={view === 'boost'} onclick={() => (view = 'boost')}>Status</button>
          <button class:on={view === 'giveaway'} onclick={() => (view = 'giveaway')}>New giveaway</button>
        </div>
      {/if}

      {#if view === 'boost'}
        {#if !status}
          <p class="muted">Loading…</p>
        {:else}
          <p class="level">Level {status.level}</p>
          <div class="bar"><span style="width: {Math.round(status.progress * 100)}%"></span></div>
          <p class="muted small">
            {status.boosts.toLocaleString()} boosts
            {#if !status.maxLevel}
              · {(status.nextLevelBoosts - status.boosts).toLocaleString()} more for level {status.level + 1}
            {:else}
              · top level reached
            {/if}
          </p>
          {#if status.giftBoosts}
            <p class="muted small">{status.giftBoosts.toLocaleString()} of those came from gifts and giveaways.</p>
          {/if}
          {#if status.premiumAudiencePercent}
            <p class="muted small">{status.premiumAudiencePercent}% of subscribers have Premium.</p>
          {/if}

          <p class="label">Your boost slots</p>
          {#if !slots.length}
            <p class="muted small">
              You have no boost slots — they come with Telegram Premium.
            </p>
          {:else}
            {#each slots as slot (slot.slot)}
              <button
                class="option"
                class:on={chosenSlots.includes(slot.slot)}
                onclick={() => toggleSlot(slot.slot)}
              >
                <span>Slot {slot.slot}</span>
                <span class="muted small">
                  {#if slot.peerId === peerId}
                    boosting this channel until {dateOf(slot.expires)}
                  {:else if slot.peerId}
                    boosting {slot.peerTitle} until {dateOf(slot.expires)}
                  {:else}
                    free
                  {/if}
                </span>
              </button>
            {/each}
            <p class="muted small">
              Reassigning a slot that is boosting another channel takes it away
              from that channel.
            </p>
            <button class="primary" onclick={boost} disabled={!chosenSlots.length || busy === 'boost'}>
              {busy === 'boost' ? 'Boosting…' : 'Boost this channel'}
            </button>
          {/if}

          {#if status.boostUrl}
            <a class="option link" href={status.boostUrl} target="_blank" rel="noopener noreferrer">
              <span>Share the boost link</span>
            </a>
          {/if}
          {#if freeSlots.length === 0 && slots.length}
            <p class="muted small">Every slot you have is already in use.</p>
          {/if}
        {/if}

      {:else if !setup}
        <p class="muted">Loading…</p>

      {:else}
        <p class="muted small">
          A giveaway hands Premium subscriptions to random subscribers and boosts
          the channel by {setup.limits.boostsPerPremium} per subscription. It only
          starts once the invoice is paid.
        </p>

        <p class="label">Winners</p>
        <div class="chips">
          {#each setup.premiumWinnerCounts as count (count)}
            <button class:on={winners === count} onclick={() => (winners = count)}>{count}</button>
          {/each}
        </div>

        <p class="label">Subscription length</p>
        <div class="chips">
          {#each setup.premiumMonths as value (value)}
            <button class:on={months === value} onclick={() => (months = value)}>{value} mo</button>
          {/each}
        </div>

        <label class="field">
          <span>Ends in (days, max {Math.floor(setup.limits.maxPeriod / 86400)})</span>
          <input type="number" min="1" max={Math.floor(setup.limits.maxPeriod / 86400)} bind:value={days} />
        </label>

        <label class="toggle">
          <input type="checkbox" bind:checked={onlyNew} />
          <span>Only new subscribers may take part</span>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={showWinners} />
          <span>Show the winners publicly</span>
        </label>

        <label class="field">
          <span>Prize description (optional)</span>
          <input bind:value={prize} />
        </label>
        <label class="field">
          <span>Countries, ISO-2 comma separated (optional, max {setup.limits.maxCountries})</span>
          <input bind:value={countries} placeholder="GB, DE, FR" />
        </label>

        <button class="primary" onclick={launchGiveaway} disabled={!winners || !months || busy === 'giveaway'}>
          {busy === 'giveaway' ? 'Opening…' : 'Continue to payment'}
        </button>
      {/if}
    </div>
  </div>
</div>

{#if checkout}
  <Checkout
    checkout={checkout}
    onclose={() => (checkout = null)}
    ondone={() => {
      checkout = null;
      note = 'Giveaway started';
      loadBoostStatus(peerId).then((value) => (status = value)).catch(() => {});
      view = 'boost';
    }}
  />
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 96;
  }

  .dialog {
    width: min(420px, calc(100vw - 32px));
    max-height: min(640px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
  }

  .close {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px;
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .level {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--accent);
  }

  .bar {
    height: 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .chips button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    text-decoration: none;
    font-size: 13px;
  }

  .option.on {
    border-color: var(--accent);
  }

  .link {
    justify-content: center;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .primary {
    padding: 10px 14px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }
</style>
