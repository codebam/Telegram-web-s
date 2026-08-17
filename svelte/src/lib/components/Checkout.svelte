<script lang="ts">
  import {
    EMPTY_INFO,
    acceptProviderCredentials,
    closeCheckout,
    formatAmount,
    loadStarsBalance,
    payAnyCheckout,
    reloadCheckout,
    selectSavedCard,
    selectShippingOption,
    setTip,
    tokenizeCard,
    validateCheckoutInfo,
    type CardInput,
    type Checkout,
    type RequestedInfo
  } from '$lib/telegram/payments';

  let {
    checkout: initial,
    onclose,
    ondone,
    ontopup
  }: {
    checkout: Checkout;
    onclose: () => void;
    /** Fired only after the server confirmed the payment. */
    ondone?: () => void;
    /** Offer to buy Stars when the balance cannot cover a Stars invoice. */
    ontopup?: () => void;
  } = $props();

  // Deliberately a snapshot of the prop: from here on the session is ours and
  // every step replaces it with what the server just told us.
  let checkout = $state(initial);
  let error = $state('');
  let busy = $state('');
  /** '' while collecting details, then the step the server asked for. */
  let stage = $state<'form' | 'verify' | 'password' | 'done'>('form');
  let verifyUrl = $state('');

  let balance = $state<number | null>(null);

  // These are `$state` so the fields re-render when a saved address arrives.
  // Every value in them is a primitive, so the `{...spread}` at the call sites
  // hands the worker a plain object — a proxy would throw DataCloneError.
  let info = $state<RequestedInfo>({...EMPTY_INFO});
  let infoLoaded = $state(false);
  let saveInfo = $state(true);
  let infoError = $state('');
  let infoField = $state('');

  let card = $state<CardInput>({
    number: '',
    expiryMonth: 0,
    expiryYear: 0,
    cvc: '',
    cardholder: '',
    country: '',
    zip: '',
    save: false
  });
  let expiry = $state('');
  let password = $state('');
  let tipInput = $state(0);

  const starsInvoice = $derived(checkout.pay === 'stars' || checkout.pay === 'ton');
  const readOnly = $derived(checkout.mode === 'receipt');
  const shortBalance = $derived(
    starsInvoice && balance !== null && balance < checkout.total
  );

  $effect(() => {
    if(checkout.savedInfo && !infoLoaded) {
      info = {...checkout.savedInfo};
      infoLoaded = true;
    }
  });

  $effect(() => {
    if(!starsInvoice) return;
    loadStarsBalance().then((value) => {
      balance = checkout.pay === 'ton' ? value.ton : value.stars;
    });
  });

  function money(amount: number) {
    return formatAmount(amount, checkout.currency);
  }

  function close() {
    closeCheckout(checkout.id);
    onclose();
  }

  function report(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  async function submitInfo() {
    busy = 'info';
    infoError = '';
    infoField = '';
    try {
      const result = await validateCheckoutInfo(checkout.id, {...info}, saveInfo);
      checkout = result.checkout;
      if(!result.ok) {
        infoField = result.field;
        infoError = result.error;
      }
    } catch(err) {
      report(err, 'Could not validate the address');
    } finally {
      busy = '';
    }
  }

  async function pickShipping(optionId: string) {
    try {
      checkout = await selectShippingOption(checkout.id, optionId);
    } catch(err) {
      report(err, 'Could not select that shipping option');
    }
  }

  async function applyTip() {
    try {
      checkout = await setTip(checkout.id, tipInput);
    } catch(err) {
      report(err, 'Could not apply the tip');
    }
  }

  async function pickCard(cardId: string) {
    try {
      checkout = await selectSavedCard(checkout.id, cardId);
    } catch(err) {
      report(err, 'Could not select that card');
    }
  }

  function parseExpiry() {
    const [month, year] = expiry.split('/').map((part) => parseInt(part.trim(), 10));
    card.expiryMonth = month || 0;
    card.expiryYear = year ? (year < 100 ? 2000 + year : year) : 0;
  }

  async function submitCard() {
    parseExpiry();
    if(!card.number.replace(/\D/g, '') || !card.expiryMonth || !card.expiryYear || !card.cvc) {
      error = 'Fill in the card number, expiry and CVC.';
      return;
    }

    busy = 'card';
    error = '';
    try {
      checkout = await tokenizeCard(checkout.id, {...card});
    } catch(err) {
      report(err, 'The card could not be accepted');
    } finally {
      busy = '';
    }
  }

  /**
   * A provider without an in-page form runs its own checkout page. It posts the
   * credentials back with a `payment_form_submit` web event; anything else that
   * page does is out of our hands.
   */
  function openProviderPage() {
    if(!checkout.providerUrl) return;
    const child = window.open(checkout.providerUrl, '_blank', 'noopener,noreferrer');
    if(!child) error = 'Allow pop-ups to open the payment page.';
  }

  function onProviderMessage(event: MessageEvent) {
    if(!checkout.providerUrl) return;
    if(event.origin !== new URL(checkout.providerUrl).origin) return;

    let data: any;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch(err) {
      return;
    }

    if(data?.eventType !== 'payment_form_submit') return;
    let payload: any;
    try {
      payload = JSON.parse(data.eventData.credentials ?? data.eventData);
    } catch(err) {
      payload = data.eventData?.credentials;
    }

    acceptProviderCredentials(checkout.id, payload, data.eventData?.title ?? 'Card')
    .then((next) => (checkout = next))
    .catch((err) => report(err, 'The payment page sent something unusable'));
  }

  $effect(() => {
    window.addEventListener('message', onProviderMessage);
    return () => window.removeEventListener('message', onProviderMessage);
  });

  const canPay = $derived(
    !readOnly &&
    (starsInvoice ?
      !shortBalance :
      (!!checkout.cardTitle &&
        (!checkout.needShippingAddress || checkout.infoValidated) &&
        (!checkout.shippingOptions.length || !!checkout.selectedShippingId)))
  );

  async function pay() {
    busy = 'pay';
    error = '';
    try {
      const result = await payAnyCheckout(checkout.id, password || undefined);
      if(result.status === 'needPassword') {
        stage = 'password';
      } else if(result.status === 'verify') {
        verifyUrl = result.url;
        stage = 'verify';
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        stage = 'done';
        ondone?.();
      }
    } catch(err: any) {
      const type = err?.type || '';
      if(type === 'FORM_EXPIRED' || type === 'INVOICE_ALREADY_PAID') {
        try {
          checkout = await reloadCheckout(checkout.id);
        } catch(reloadErr) {
          // Keep the original failure visible; the reload is a courtesy.
        }
      }
      report(err, 'The payment did not go through');
      if(stage === 'password') stage = 'form';
    } finally {
      busy = '';
      password = '';
    }
  }
</script>

<div class="backdrop" onclick={close} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Payment">
    <header>
      <strong>{readOnly ? 'Receipt' : 'Checkout'}</strong>
      <button class="close" onclick={close} aria-label="Close">✕</button>
    </header>

    <div class="body">
      {#if stage === 'done'}
        <p class="done">Payment confirmed.</p>
        <p class="muted small">{checkout.title}</p>
        <p class="total-line"><span>Paid</span><span>{money(checkout.total)}</span></p>
        <button class="primary" onclick={close}>Close</button>

      {:else if stage === 'verify'}
        <p class="label">Verification required</p>
        <p class="muted small">
          Your bank asked for confirmation. Finish it in the window that opened —
          the payment is not complete until the provider confirms it. This client
          cannot see inside that page, so check the chat for the receipt.
        </p>
        <a class="primary link" href={verifyUrl} target="_blank" rel="noopener noreferrer">
          Reopen the verification page
        </a>
        <button onclick={close}>Close</button>

      {:else if stage === 'password'}
        <p class="label">Confirm with your password</p>
        <p class="muted small">
          Paying with a saved card needs your two-step verification password.
        </p>
        <label class="field">
          <span>Password</span>
          <input type="password" bind:value={password} />
        </label>
        <button class="primary" onclick={pay} disabled={busy === 'pay' || !password}>
          {busy === 'pay' ? 'Checking…' : 'Confirm'}
        </button>
        <button onclick={() => (stage = 'form')}>Back</button>

      {:else}
        {#if checkout.photoUrl}
          <img class="photo" src={checkout.photoUrl} alt="" />
        {/if}

        <p class="title">{checkout.title}</p>
        {#if checkout.description}
          <p class="muted small">{checkout.description}</p>
        {/if}
        {#if checkout.botTitle}
          <p class="muted small">
            {checkout.botTitle}{checkout.providerTitle ? ` · via ${checkout.providerTitle}` : ''}
          </p>
        {/if}
        {#if checkout.test}
          <p class="badge-test">Test invoice — no real money moves.</p>
        {/if}
        {#if checkout.recurring}
          <p class="muted small">
            This is a recurring charge.{#if checkout.termsUrl}
              <a href={checkout.termsUrl} target="_blank" rel="noopener noreferrer">Terms</a>
            {/if}
          </p>
        {/if}

        <p class="label">Price</p>
        <div class="prices">
          {#each checkout.prices as price, index (index)}
            <span>{price.label}</span><span>{money(price.amount)}</span>
          {/each}
          {#if checkout.shippingAmount}
            <span>Shipping</span><span>{money(checkout.shippingAmount)}</span>
          {/if}
          {#if checkout.tipAmount}
            <span>Tip</span><span>{money(checkout.tipAmount)}</span>
          {/if}
          <span class="total">Total</span><span class="total">{money(checkout.total)}</span>
        </div>

        {#if readOnly}
          {#if checkout.cardTitle}
            <p class="muted small">Paid with {checkout.cardTitle}</p>
          {/if}
          {#if checkout.date}
            <p class="muted small">{new Date(checkout.date * 1000).toLocaleString()}</p>
          {/if}
          <button class="primary" onclick={close}>Close</button>

        {:else}
          {#if checkout.maxTipAmount}
            <p class="label">Tip</p>
            <div class="chips">
              {#each checkout.suggestedTips as suggestion (suggestion)}
                <button
                  class:on={checkout.tipAmount === suggestion}
                  onclick={() => { tipInput = suggestion; applyTip(); }}
                >{money(suggestion)}</button>
              {/each}
              <button class:on={!checkout.tipAmount} onclick={() => { tipInput = 0; applyTip(); }}>
                None
              </button>
            </div>
          {/if}

          {#if checkout.needName || checkout.needEmail || checkout.needPhone || checkout.needShippingAddress}
            <p class="label">
              {checkout.needShippingAddress ? 'Shipping address' : 'Your details'}
              {#if checkout.infoValidated}<span class="ok-tick"> ✓</span>{/if}
            </p>
            {#if checkout.needName}
              <label class="field" class:bad={infoField === 'name'}>
                <span>Name</span><input bind:value={info.name} />
              </label>
            {/if}
            {#if checkout.needEmail}
              <label class="field" class:bad={infoField === 'email'}>
                <span>Email</span><input type="email" bind:value={info.email} />
              </label>
            {/if}
            {#if checkout.needPhone}
              <label class="field" class:bad={infoField === 'phone'}>
                <span>Phone</span><input bind:value={info.phone} />
              </label>
            {/if}
            {#if checkout.needShippingAddress}
              <label class="field" class:bad={infoField === 'streetLine1'}>
                <span>Address</span><input bind:value={info.streetLine1} />
              </label>
              <label class="field" class:bad={infoField === 'streetLine2'}>
                <span>Address line 2</span><input bind:value={info.streetLine2} />
              </label>
              <label class="field" class:bad={infoField === 'city'}>
                <span>City</span><input bind:value={info.city} />
              </label>
              <label class="field" class:bad={infoField === 'state'}>
                <span>State / region</span><input bind:value={info.state} />
              </label>
              <label class="field" class:bad={infoField === 'countryIso2'}>
                <span>Country code (ISO 2)</span>
                <input maxlength="2" bind:value={info.countryIso2} />
              </label>
              <label class="field" class:bad={infoField === 'postCode'}>
                <span>Post code</span><input bind:value={info.postCode} />
              </label>
            {/if}
            <label class="toggle">
              <input type="checkbox" bind:checked={saveInfo} />
              <span>Save these details for next time</span>
            </label>
            {#if infoError}<p class="error">{infoError}</p>{/if}
            <button onclick={submitInfo} disabled={busy === 'info'}>
              {busy === 'info' ? 'Checking…' : checkout.infoValidated ? 'Update details' : 'Validate details'}
            </button>
          {/if}

          {#if checkout.shippingOptions.length}
            <p class="label">Shipping method</p>
            {#each checkout.shippingOptions as option (option.id)}
              <button
                class="option"
                class:on={checkout.selectedShippingId === option.id}
                onclick={() => pickShipping(option.id)}
              >
                <span>{option.title}</span>
                <span>{money(option.amount)}</span>
              </button>
            {/each}
          {:else if checkout.needShippingAddress && checkout.infoValidated}
            <p class="muted small">No shipping methods are offered for that address.</p>
          {/if}

          {#if starsInvoice}
            <p class="label">Balance</p>
            {#if balance === null}
              <p class="muted small">Checking your balance…</p>
            {:else}
              <p class="muted small">
                You have {formatAmount(balance, checkout.currency)}.
              </p>
              {#if shortBalance}
                <p class="error">
                  Not enough {checkout.pay === 'ton' ? 'TON' : 'Stars'} for this purchase.
                </p>
                {#if checkout.pay === 'stars' && ontopup}
                  <button onclick={ontopup}>Buy Stars</button>
                {:else}
                  <p class="muted small">Top up in an official Telegram app to continue.</p>
                {/if}
              {/if}
            {/if}

          {:else}
            <p class="label">Payment method</p>
            {#each checkout.savedCards as saved (saved.id)}
              <button
                class="option"
                class:on={checkout.cardTitle === saved.title}
                onclick={() => pickCard(saved.id)}
              >
                <span>{saved.title}</span>
                <span class="muted small">saved</span>
              </button>
            {/each}

            {#if checkout.nativeProvider}
              <p class="muted small">
                New card — sent straight to {checkout.nativeProvider === 'stripe' ? 'Stripe' : 'SmartGlocal'},
                never to this app.
              </p>
              <label class="field">
                <span>Card number</span>
                <input inputmode="numeric" autocomplete="cc-number" bind:value={card.number} />
              </label>
              <div class="two">
                <label class="field">
                  <span>MM/YY</span>
                  <input placeholder="12/29" bind:value={expiry} />
                </label>
                <label class="field">
                  <span>CVC</span>
                  <input inputmode="numeric" autocomplete="cc-csc" bind:value={card.cvc} />
                </label>
              </div>
              {#if checkout.needCardholderName}
                <label class="field">
                  <span>Cardholder name</span>
                  <input bind:value={card.cardholder} />
                </label>
              {/if}
              {#if checkout.needCountry || checkout.needZip}
                <div class="two">
                  {#if checkout.needCountry}
                    <label class="field">
                      <span>Country (ISO 2)</span>
                      <input maxlength="2" bind:value={card.country} />
                    </label>
                  {/if}
                  {#if checkout.needZip}
                    <label class="field">
                      <span>Post code</span>
                      <input bind:value={card.zip} />
                    </label>
                  {/if}
                </div>
              {/if}
              {#if checkout.canSaveCard}
                <label class="toggle">
                  <input type="checkbox" bind:checked={card.save} />
                  <span>Save this card for future payments</span>
                </label>
              {/if}
              <button onclick={submitCard} disabled={busy === 'card'}>
                {busy === 'card' ? 'Checking the card…' : 'Use this card'}
              </button>

            {:else if checkout.providerUrl}
              <p class="muted small">
                This bot's provider has no in-page card form. Its own checkout page
                has to collect the card and hand the credentials back.
              </p>
              <button onclick={openProviderPage}>Open the payment page</button>

            {:else}
              <p class="error">
                No payment method is available for this invoice in this client — the
                provider offers neither an in-page form nor a checkout page.
              </p>
            {/if}

            {#each checkout.extraMethods as method (method.url)}
              <a class="option link" href={method.url} target="_blank" rel="noopener noreferrer">
                <span>{method.title}</span><span class="muted small">opens externally</span>
              </a>
            {/each}

            {#if checkout.cardTitle}
              <p class="muted small">Paying with {checkout.cardTitle}</p>
            {/if}
          {/if}

          {#if error}<p class="error">{error}</p>{/if}

          <button class="primary" onclick={pay} disabled={!canPay || busy === 'pay'}>
            {busy === 'pay' ? 'Paying…' : `Pay ${money(checkout.total)}`}
          </button>
        {/if}
      {/if}
    </div>
  </div>
</div>

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

  .photo {
    width: 100%;
    max-height: 160px;
    object-fit: cover;
    border-radius: 10px;
  }

  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .prices {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    font-size: 13px;
  }

  .prices .total {
    font-weight: 700;
    font-size: 15px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }

  .total-line {
    display: flex;
    justify-content: space-between;
    margin: 0;
    font-weight: 600;
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

  .field.bad input {
    border-color: var(--danger);
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
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

  .link {
    display: block;
    text-align: center;
    text-decoration: none;
  }

  .badge-test {
    margin: 0;
    padding: 6px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    font-size: 12px;
  }

  .ok-tick {
    color: #3aa657;
  }

  .done {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #3aa657;
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
</style>
