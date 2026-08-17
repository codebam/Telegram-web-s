<script lang="ts">
  import Checkout from './Checkout.svelte';
  import {
    formatAmount,
    loadGiveawayInfo,
    openInvoice,
    openReceipt,
    unlockPaidMedia,
    type Checkout as CheckoutData,
    type GiveawayInfo,
    type PaymentPreview
  } from '$lib/telegram/payments';

  let {
    peerId,
    mid,
    payment,
    onboost
  }: {
    peerId: number;
    mid: number;
    payment: PaymentPreview | null;
    /** Opens the channel's boost page. */
    onboost?: () => void;
  } = $props();

  let checkout = $state<CheckoutData | null>(null);
  let giveaway = $state<GiveawayInfo | null>(null);
  let error = $state('');
  let note = $state('');
  let busy = $state('');

  function report(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  async function open(action: () => Promise<CheckoutData>, label: string) {
    error = '';
    busy = label;
    try {
      checkout = await action();
    } catch(err) {
      report(err, 'Could not open the checkout');
    } finally {
      busy = '';
    }
  }

  async function showGiveaway() {
    error = '';
    busy = 'giveaway';
    try {
      giveaway = await loadGiveawayInfo(peerId, mid);
    } catch(err) {
      report(err, 'Could not load the giveaway details');
    } finally {
      busy = '';
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }
</script>

{#if payment}
  <div class="payment">
    {#if payment.kind === 'invoice'}
      <span class="head">{payment.title || 'Invoice'}</span>
      {#if payment.description}<span class="muted">{payment.description}</span>{/if}
      <span class="price">{formatAmount(payment.amount, payment.currency)}</span>
      {#if payment.test}<span class="muted">Test invoice — no real money moves.</span>{/if}
      {#if payment.paid && payment.receiptMid}
        <button onclick={() => open(() => openReceipt(peerId, payment.receiptMid), 'receipt')} disabled={!!busy}>
          {busy === 'receipt' ? 'Opening…' : 'View receipt'}
        </button>
      {:else if payment.paid}
        <span class="muted">Paid.</span>
      {:else}
        <button class="primary" onclick={() => open(() => openInvoice(peerId, mid), 'invoice')} disabled={!!busy}>
          {busy === 'invoice' ? 'Opening…' : `Pay ${formatAmount(payment.amount, payment.currency)}`}
        </button>
      {/if}

    {:else if payment.kind === 'paidMedia'}
      <span class="head">
        {payment.count > 1 ? `${payment.count} paid items` : 'Paid media'}
      </span>
      {#if payment.locked}
        <span class="muted">Unlock for ★ {payment.stars.toLocaleString()}.</span>
        <button class="primary" onclick={() => open(() => unlockPaidMedia(peerId, mid), 'unlock')} disabled={!!busy}>
          {busy === 'unlock' ? 'Opening…' : `Unlock for ★ ${payment.stars.toLocaleString()}`}
        </button>
      {:else}
        <span class="muted">Unlocked — you paid ★ {payment.stars.toLocaleString()} for this.</span>
      {/if}

    {:else if payment.kind === 'giveaway'}
      <span class="head">Giveaway</span>
      <span class="muted">
        {#if payment.stars}
          ★ {payment.stars.toLocaleString()} split between {payment.quantity} winners
        {:else}
          {payment.quantity} × {payment.months} months of Premium
        {/if}
      </span>
      {#if payment.prizeDescription}<span class="muted">{payment.prizeDescription}</span>{/if}
      <span class="muted">
        Ends {dateOf(payment.untilDate)} ·
        {payment.onlyNewSubscribers ? 'new subscribers only' : 'all subscribers'}
        {#if payment.channelCount > 1} · {payment.channelCount} channels{/if}
      </span>
      <button onclick={showGiveaway} disabled={!!busy}>
        {busy === 'giveaway' ? 'Loading…' : 'Giveaway details'}
      </button>

    {:else if payment.kind === 'giveawayResults'}
      <span class="head">Giveaway results</span>
      {#if payment.refunded}
        <span class="muted">The giveaway was cancelled and refunded.</span>
      {:else}
        <span class="muted">
          {payment.winnersCount} winners
          {#if payment.stars}· ★ {payment.stars.toLocaleString()}{:else}· {payment.months} months of Premium{/if}
          {#if payment.unclaimedCount}· {payment.unclaimedCount} unclaimed{/if}
        </span>
      {/if}
      <button onclick={showGiveaway} disabled={!!busy}>
        {busy === 'giveaway' ? 'Loading…' : 'Giveaway details'}
      </button>

    {:else if payment.kind === 'starGift'}
      <span class="head">{payment.unique ? 'Collectible gift' : 'Gift'}</span>
      {#if payment.stars}<span class="price">★ {payment.stars.toLocaleString()}</span>{/if}
      {#if payment.message}<span class="muted">“{payment.message}”</span>{/if}
      {#if payment.converted}
        <span class="muted">Already converted to Stars.</span>
      {:else if payment.incoming && payment.convertStars}
        <span class="muted">
          Worth ★ {payment.convertStars.toLocaleString()} if converted. Manage it in
          Settings → Stars → Gifts.
        </span>
      {/if}

    {:else if payment.kind === 'giftCode'}
      <span class="head">Premium gift code</span>
      <span class="muted">{payment.months} months — redeem it in Settings → Premium → Gift code.</span>

    {:else if payment.kind === 'paymentSent'}
      <span class="head">Payment sent</span>
      <span class="price">{formatAmount(payment.amount, payment.currency)}</span>
      {#if payment.recurring}<span class="muted">Recurring charge.</span>{/if}
      <button onclick={() => open(() => openReceipt(peerId, mid), 'receipt')} disabled={!!busy}>
        {busy === 'receipt' ? 'Opening…' : 'View receipt'}
      </button>
    {/if}

    {#if onboost && (payment.kind === 'giveaway' || payment.kind === 'giveawayResults')}
      <button onclick={onboost}>Boost this channel</button>
    {/if}

    {#if error}<span class="error">{error}</span>{/if}
    {#if note}<span class="ok">{note}</span>{/if}
  </div>
{/if}

{#if checkout}
  <Checkout
    checkout={checkout}
    onclose={() => (checkout = null)}
    ondone={() => {
      checkout = null;
      note = 'Payment confirmed';
    }}
  />
{/if}

{#if giveaway}
  <div class="backdrop" onclick={() => (giveaway = null)} role="presentation">
    <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Giveaway">
      <header>
        <strong>Giveaway</strong>
        <button class="close" onclick={() => (giveaway = null)} aria-label="Close">✕</button>
      </header>
      <div class="dialog-body">
        {#if giveaway.status}<p class="status">{giveaway.status}</p>{/if}
        <p class="muted small">Started {dateOf(giveaway.startDate)}</p>
        <p class="muted small">
          {giveaway.finished ? 'Finished' : 'Ends'} {dateOf(giveaway.finishDate)}
        </p>
        <p class="muted small">{giveaway.winnersCount} winners</p>
        {#if giveaway.finished}
          <p class="muted small">{giveaway.activatedCount} prizes claimed</p>
        {/if}
        {#if giveaway.starsPrize}
          <p class="muted small">★ {giveaway.starsPrize.toLocaleString()} prize pool</p>
        {/if}
        {#if giveaway.giftCodeSlug}
          <p class="small">
            Your gift code: <code>{giveaway.giftCodeSlug}</code> — redeem it in
            Settings → Premium → Gift code.
          </p>
        {/if}
        {#if giveaway.preparingResults}
          <p class="muted small">The winners are still being picked.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .payment,
  .paid-reaction {
    display: grid;
    gap: 4px;
    margin-top: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    font-size: 13px;
  }

  .head {
    font-weight: 600;
  }

  .price {
    font-weight: 700;
    color: var(--accent);
  }

  .row {
    display: flex;
    gap: 6px;
  }

  button {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    justify-self: start;
  }

  .primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ghost {
    padding: 6px 10px;
    font-size: 12px;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .field input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 96;
  }

  .dialog {
    width: min(380px, calc(100vw - 32px));
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
  }

  .close {
    border: none;
    background: none;
    color: var(--accent);
    padding: 0;
  }

  .dialog-body {
    padding: 16px 18px;
    display: grid;
    gap: 6px;
  }

  .status {
    margin: 0;
    font-weight: 600;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .error {
    color: var(--danger);
  }

  .ok {
    color: var(--accent);
  }
</style>
