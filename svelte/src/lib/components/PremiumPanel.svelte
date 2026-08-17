<script lang="ts">
  import Checkout from './Checkout.svelte';
  import {searchDialogs, type DialogItem} from '$lib/telegram/chats';
  import {
    applyGiftCode,
    checkGiftCode,
    formatAmount,
    giftPremium,
    loadPremiumGiftOptions,
    loadPremiumPage,
    type Checkout as CheckoutData,
    type PremiumGiftOption,
    type PremiumPage
  } from '$lib/telegram/payments';

  let page = $state<PremiumPage | null>(null);
  let giftOptions = $state<PremiumGiftOption[]>([]);
  let view = $state<'about' | 'gift' | 'code'>('about');

  let recipientQuery = $state('');
  let recipients = $state<DialogItem[]>([]);
  let recipient = $state<DialogItem | null>(null);
  let giftMonths = $state(0);
  let giftWithStars = $state(false);
  let giftNote = $state('');

  let codeInput = $state('');
  let codeInfo = $state<{fromTitle: string; days: number; used: boolean} | null>(null);

  let checkout = $state<CheckoutData | null>(null);
  let error = $state('');
  let status = $state('');
  let busy = $state('');

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  function report(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  $effect(() => {
    loadPremiumPage()
    .then((value) => (page = value))
    .catch((err) => report(err, 'Could not load the Premium page'));
  });

  async function openGift() {
    view = 'gift';
    if(giftOptions.length) return;
    try {
      giftOptions = await loadPremiumGiftOptions();
      giftMonths = giftOptions[0]?.months ?? 0;
    } catch(err) {
      report(err, 'Could not load the gift options');
    }
  }

  async function findRecipients() {
    const query = recipientQuery.trim();
    if(!query) {
      recipients = [];
      return;
    }
    try {
      recipients = (await searchDialogs(query, 20)).filter((dialog) => dialog.isUser);
    } catch(err) {
      recipients = [];
    }
  }

  async function startGift() {
    if(!recipient || !giftMonths) return;
    error = '';
    busy = 'gift';
    try {
      checkout = await giftPremium(recipient.peerId, giftMonths, giftWithStars, giftNote.trim());
    } catch(err) {
      report(err, 'Could not open the gift checkout');
    } finally {
      busy = '';
    }
  }

  function slugOf(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/(?:t\.me\/giftcode\/)?([A-Za-z0-9_-]+)\/?$/);
    return match ? match[1] : trimmed;
  }

  async function lookupCode() {
    error = '';
    codeInfo = null;
    busy = 'code';
    try {
      const info = await checkGiftCode(slugOf(codeInput));
      codeInfo = {fromTitle: info.fromTitle, days: info.days, used: !!info.usedDate};
    } catch(err) {
      report(err, 'That gift code could not be checked');
    } finally {
      busy = '';
    }
  }

  async function redeemCode() {
    error = '';
    busy = 'redeem';
    try {
      await applyGiftCode(slugOf(codeInput));
      flash('Gift code applied');
      page = await loadPremiumPage();
    } catch(err) {
      report(err, 'That gift code could not be applied');
    } finally {
      busy = '';
    }
  }

  const selectedGift = $derived(giftOptions.find((option) => option.months === giftMonths) ?? null);
</script>

<div class="premium">
  {#if error}<p class="error">{error}</p>{/if}
  {#if status}<p class="ok">{status}</p>{/if}

  <div class="chips">
    <button class:on={view === 'about'} onclick={() => (view = 'about')}>Premium</button>
    <button class:on={view === 'gift'} onclick={openGift}>Gift Premium</button>
    <button class:on={view === 'code'} onclick={() => (view = 'code')}>Gift code</button>
  </div>

  {#if !page}
    <p class="muted">Loading…</p>

  {:else if view === 'about'}
    <p class="status-line">
      {page.active ? '★ Premium is active on this account' : 'Premium is not active'}
    </p>
    {#if page.statusText}
      <p class="muted small">{page.statusText}</p>
    {/if}

    {#if !page.active}
      <p class="label">Subscribe</p>
      {#if page.purchaseBlocked}
        <p class="muted small">
          Premium purchases are switched off for this account by the server.
        </p>
      {:else if !page.options.length}
        <p class="muted small">
          The server offered no subscription options for this account.
        </p>
      {:else}
        {#each page.options as option (option.months)}
          {#if option.botUrl}
            <a class="option" href={option.botUrl} target="_blank" rel="noopener noreferrer">
              <span>{option.months} month{option.months === 1 ? '' : 's'}</span>
              <span>
                {formatAmount(option.amount, option.currency)}
                <span class="muted small">· {formatAmount(option.monthly, option.currency)}/mo</span>
              </span>
            </a>
          {:else}
            <div class="option disabled">
              <span>{option.months} month{option.months === 1 ? '' : 's'}</span>
              <span class="muted small">unavailable</span>
            </div>
          {/if}
        {/each}
        <p class="muted small">
          Telegram does not sell the subscription through the web API — the server
          hands out a bot link that runs the real payment, which is what opens
          here, exactly as the official web client does.
        </p>
      {/if}
    {/if}

    <p class="label">What Premium includes</p>
    {#each page.features as feature (feature.key)}
      <div class="feature">
        <span class="feature-title">{feature.title}</span>
        <span class="muted small">{feature.description}</span>
      </div>
    {/each}

  {:else if view === 'gift'}
    {#if !giftOptions.length}
      <p class="muted small">Loading the gift options…</p>
    {:else}
      {#if recipient}
        <button class="option" onclick={() => (recipient = null)}>
          <span>{recipient.title}</span><span class="muted small">change</span>
        </button>
      {:else}
        <label class="field">
          <span>Recipient</span>
          <input bind:value={recipientQuery} oninput={findRecipients} placeholder="Search people" />
        </label>
        {#each recipients as candidate (candidate.peerId)}
          <button class="option" onclick={() => (recipient = candidate)}>
            <span>{candidate.title}</span>
          </button>
        {/each}
      {/if}

      <p class="label">Duration</p>
      {#each giftOptions as option (option.months)}
        <button
          class="option"
          class:on={giftMonths === option.months}
          onclick={() => (giftMonths = option.months)}
        >
          <span>
            {option.months} months
            {#if option.discountPercent}<span class="save">−{option.discountPercent}%</span>{/if}
          </span>
          <span>
            {giftWithStars && option.starsAmount ?
              `★ ${option.starsAmount.toLocaleString()}` :
              formatAmount(option.amount, option.currency)}
          </span>
        </button>
      {/each}

      {#if selectedGift?.starsAmount}
        <label class="toggle">
          <input type="checkbox" bind:checked={giftWithStars} />
          <span>Pay with Stars instead of a card</span>
        </label>
      {/if}

      <label class="field">
        <span>Message (optional)</span>
        <input bind:value={giftNote} maxlength="255" />
      </label>

      <button class="primary" onclick={startGift} disabled={!recipient || !giftMonths || busy === 'gift'}>
        {busy === 'gift' ? 'Opening…' : 'Continue'}
      </button>
    {/if}

  {:else}
    <p class="label">Redeem a gift code</p>
    <label class="field">
      <span>Code or t.me/giftcode link</span>
      <input bind:value={codeInput} />
    </label>
    <button onclick={lookupCode} disabled={!codeInput.trim() || busy === 'code'}>
      {busy === 'code' ? 'Checking…' : 'Check the code'}
    </button>

    {#if codeInfo}
      <p class="muted small">
        {codeInfo.days} days of Premium{codeInfo.fromTitle ? ` from ${codeInfo.fromTitle}` : ''}.
        {codeInfo.used ? 'It has already been used.' : ''}
      </p>
      {#if !codeInfo.used}
        <button class="primary" onclick={redeemCode} disabled={busy === 'redeem'}>
          {busy === 'redeem' ? 'Applying…' : 'Apply to this account'}
        </button>
      {/if}
    {/if}
  {/if}
</div>

{#if checkout}
  <Checkout
    checkout={checkout}
    onclose={() => (checkout = null)}
    ondone={() => {
      checkout = null;
      flash('Gift sent');
      recipient = null;
      giftNote = '';
    }}
  />
{/if}

<style>
  .premium {
    display: grid;
    gap: 10px;
    align-content: start;
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

  .status-line {
    margin: 0;
    font-size: 14px;
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
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

  .option.disabled {
    opacity: 0.5;
    cursor: default;
  }

  .save {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: #3aa657;
    color: #fff;
    font-size: 11px;
  }

  .feature {
    display: grid;
    gap: 2px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .feature-title {
    font-size: 14px;
    font-weight: 500;
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

  button {
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
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
