/*
 * Payment form — the in-page dialog for invoices, receipts and Stars purchases,
 * plus the two out-of-page paths (a provider's own checkout page and a bank
 * verification page) that the same flow falls back to.
 *
 * Ported from svelte/src/lib/components/Checkout.svelte. Two mappings are worth
 * knowing when reading this:
 *  - every `$state` is a signal, so a whole-object write (`checkout = result`)
 *    is what notifies; the values handed to the worker are spread into plain
 *    objects at the call sites, exactly as before;
 *  - the `$effect` for `savedInfo` and the balance read signals, so they become
 *    `useSignalEffect`; the `message` listener effect tracks nothing and becomes
 *    a mount-only `useEffect`. Its handler still reads `checkout.value`, so it
 *    sees the current checkout rather than the one from the render that
 *    registered it.
 *
 * A `{#each}` that yields two siblings inside `.prices` is a `Fragment`, not an
 * element: the stylesheet lays those spans out as a two-column grid, so a
 * wrapper div would change the layout.
 */
import {Fragment} from 'preact';
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

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

import './Checkout.css';

interface Props {
  checkout: Checkout;
  onclose: () => void;
  /** Fired only after the server confirmed the payment. */
  ondone?: () => void;
  /** Offer to buy Stars when the balance cannot cover a Stars invoice. */
  ontopup?: () => void;
}

export function Checkout({checkout: initial, onclose, ondone, ontopup}: Props) {
  // Deliberately a snapshot of the prop: from here on the session is ours and
  // every step replaces it with what the server just told us.
  const checkout = useSignal(initial);
  const error = useSignal('');
  const busy = useSignal('');
  /** '' while collecting details, then the step the server asked for. */
  const stage = useSignal<'form' | 'verify' | 'password' | 'done'>('form');
  const verifyUrl = useSignal('');

  const balance = useSignal<number | null>(null);

  // These are signals so the fields re-render when a saved address arrives.
  // Every value in them is a primitive, so the `{...spread}` at the call sites
  // hands the worker a plain object — a proxy would throw DataCloneError.
  const info = useSignal<RequestedInfo>({...EMPTY_INFO});
  const infoLoaded = useSignal(false);
  const saveInfo = useSignal(true);
  const infoError = useSignal('');
  const infoField = useSignal('');

  const card = useSignal<CardInput>({
    number: '',
    expiryMonth: 0,
    expiryYear: 0,
    cvc: '',
    cardholder: '',
    country: '',
    zip: '',
    save: false
  });
  const expiry = useSignal('');
  const password = useSignal('');
  const tipInput = useSignal(0);

  const starsInvoice = useComputed(() => checkout.value.pay === 'stars' || checkout.value.pay === 'ton');
  const readOnly = useComputed(() => checkout.value.mode === 'receipt');
  const shortBalance = useComputed(
    () => starsInvoice.value && balance.value !== null && balance.value < checkout.value.total
  );

  useSignalEffect(() => {
    if(checkout.value.savedInfo && !infoLoaded.value) {
      info.value = {...checkout.value.savedInfo};
      infoLoaded.value = true;
    }
  });

  useSignalEffect(() => {
    if(!starsInvoice.value) return;
    loadStarsBalance().then((value) => {
      balance.value = checkout.value.pay === 'ton' ? value.ton : value.stars;
    });
  });

  function money(amount: number) {
    return formatAmount(amount, checkout.value.currency);
  }

  function close() {
    closeCheckout(checkout.value.id);
    onclose();
  }

  function report(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  async function submitInfo() {
    busy.value = 'info';
    infoError.value = '';
    infoField.value = '';
    try {
      const result = await validateCheckoutInfo(checkout.value.id, {...info.value}, saveInfo.value);
      checkout.value = result.checkout;
      if(!result.ok) {
        infoField.value = result.field;
        infoError.value = result.error;
      }
    } catch(err) {
      report(err, 'Could not validate the address');
    } finally {
      busy.value = '';
    }
  }

  async function pickShipping(optionId: string) {
    try {
      checkout.value = await selectShippingOption(checkout.value.id, optionId);
    } catch(err) {
      report(err, 'Could not select that shipping option');
    }
  }

  async function applyTip() {
    try {
      checkout.value = await setTip(checkout.value.id, tipInput.value);
    } catch(err) {
      report(err, 'Could not apply the tip');
    }
  }

  async function pickCard(cardId: string) {
    try {
      checkout.value = await selectSavedCard(checkout.value.id, cardId);
    } catch(err) {
      report(err, 'Could not select that card');
    }
  }

  function parseExpiry() {
    const [month, year] = expiry.value.split('/').map((part) => parseInt(part.trim(), 10));
    card.value.expiryMonth = month || 0;
    card.value.expiryYear = year ? (year < 100 ? 2000 + year : year) : 0;
  }

  async function submitCard() {
    parseExpiry();
    if(!card.value.number.replace(/\D/g, '') || !card.value.expiryMonth || !card.value.expiryYear || !card.value.cvc) {
      error.value = 'Fill in the card number, expiry and CVC.';
      return;
    }

    busy.value = 'card';
    error.value = '';
    try {
      checkout.value = await tokenizeCard(checkout.value.id, {...card.value});
    } catch(err) {
      report(err, 'The card could not be accepted');
    } finally {
      busy.value = '';
    }
  }

  /**
   * A provider without an in-page form runs its own checkout page. It posts the
   * credentials back with a `payment_form_submit` web event; anything else that
   * page does is out of our hands.
   */
  function openProviderPage() {
    if(!checkout.value.providerUrl) return;
    const child = window.open(checkout.value.providerUrl, '_blank', 'noopener,noreferrer');
    if(!child) error.value = 'Allow pop-ups to open the payment page.';
  }

  function onProviderMessage(event: MessageEvent) {
    if(!checkout.value.providerUrl) return;
    if(event.origin !== new URL(checkout.value.providerUrl).origin) return;

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

    acceptProviderCredentials(checkout.value.id, payload, data.eventData?.title ?? 'Card')
    .then((next) => (checkout.value = next))
    .catch((err) => report(err, 'The payment page sent something unusable'));
  }

  // Registered once: the handler reads the checkout signal, so it is never
  // stale, and re-registering the listener on every step would only churn.
  useEffect(() => {
    window.addEventListener('message', onProviderMessage);
    return () => window.removeEventListener('message', onProviderMessage);
  }, []);

  const canPay = useComputed(() =>
    !readOnly.value &&
    (starsInvoice.value ?
      !shortBalance.value :
      (!!checkout.value.cardTitle &&
        (!checkout.value.needShippingAddress || checkout.value.infoValidated) &&
        (!checkout.value.shippingOptions.length || !!checkout.value.selectedShippingId)))
  );

  async function pay() {
    busy.value = 'pay';
    error.value = '';
    try {
      const result = await payAnyCheckout(checkout.value.id, password.value || undefined);
      if(result.status === 'needPassword') {
        stage.value = 'password';
      } else if(result.status === 'verify') {
        verifyUrl.value = result.url;
        stage.value = 'verify';
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        stage.value = 'done';
        ondone?.();
      }
    } catch(err: any) {
      const type = err?.type || '';
      if(type === 'FORM_EXPIRED' || type === 'INVOICE_ALREADY_PAID') {
        try {
          checkout.value = await reloadCheckout(checkout.value.id);
        } catch(reloadErr) {
          // Keep the original failure visible; the reload is a courtesy.
        }
      }
      report(err, 'The payment did not go through');
      if(stage.value === 'password') stage.value = 'form';
    } finally {
      busy.value = '';
      password.value = '';
    }
  }

  return (
    <div class="backdrop" onClick={close} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Payment">
        <header>
          <strong>{readOnly.value ? 'Receipt' : 'Checkout'}</strong>
          <button class="close" onClick={close} aria-label="Close">✕</button>
        </header>

        <div class="body">
          {stage.value === 'done' ? (
            <>
              <p class="done">Payment confirmed.</p>
              <p class="muted small">{checkout.value.title}</p>
              <p class="total-line"><span>Paid</span><span>{money(checkout.value.total)}</span></p>
              <button class="primary" onClick={close}>Close</button>
            </>
          ) : stage.value === 'verify' ? (
            <>
              <p class="label">Verification required</p>
              <p class="muted small">
                Your bank asked for confirmation. Finish it in the window that opened —
                the payment is not complete until the provider confirms it. This client
                cannot see inside that page, so check the chat for the receipt.
              </p>
              <a class="primary link" href={verifyUrl.value} target="_blank" rel="noopener noreferrer">
                Reopen the verification page
              </a>
              <button onClick={close}>Close</button>
            </>
          ) : stage.value === 'password' ? (
            <>
              <p class="label">Confirm with your password</p>
              <p class="muted small">
                Paying with a saved card needs your two-step verification password.
              </p>
              <label class="field">
                <span>Password</span>
                <input
                  type="password"
                  value={password.value}
                  onInput={(e) => (password.value = (e.target as HTMLInputElement).value)}
                />
              </label>
              <button class="primary" onClick={pay} disabled={busy.value === 'pay' || !password.value}>
                {busy.value === 'pay' ? 'Checking…' : 'Confirm'}
              </button>
              <button onClick={() => (stage.value = 'form')}>Back</button>
            </>
          ) : (
            <>
              {checkout.value.photoUrl && (
                <img class="photo" src={checkout.value.photoUrl} alt="" />
              )}

              <p class="title">{checkout.value.title}</p>
              {checkout.value.description && (
                <p class="muted small">{checkout.value.description}</p>
              )}
              {checkout.value.botTitle && (
                <p class="muted small">
                  {checkout.value.botTitle}{checkout.value.providerTitle ? ` · via ${checkout.value.providerTitle}` : ''}
                </p>
              )}
              {checkout.value.test && (
                <p class="badge-test">Test invoice — no real money moves.</p>
              )}
              {checkout.value.recurring && (
                <p class="muted small">
                  This is a recurring charge.{checkout.value.termsUrl && (
                    <a href={checkout.value.termsUrl} target="_blank" rel="noopener noreferrer">Terms</a>
                  )}
                </p>
              )}

              <p class="label">Price</p>
              <div class="prices">
                {checkout.value.prices.map((price, index) => (
                  <Fragment key={index}>
                    <span>{price.label}</span><span>{money(price.amount)}</span>
                  </Fragment>
                ))}
                {checkout.value.shippingAmount ? (
                  <Fragment>
                    <span>Shipping</span><span>{money(checkout.value.shippingAmount)}</span>
                  </Fragment>
                ) : null}
                {checkout.value.tipAmount ? (
                  <Fragment>
                    <span>Tip</span><span>{money(checkout.value.tipAmount)}</span>
                  </Fragment>
                ) : null}
                <span class="total">Total</span><span class="total">{money(checkout.value.total)}</span>
              </div>

              {readOnly.value ? (
                <>
                  {checkout.value.cardTitle && (
                    <p class="muted small">Paid with {checkout.value.cardTitle}</p>
                  )}
                  {checkout.value.date && (
                    <p class="muted small">{new Date(checkout.value.date * 1000).toLocaleString()}</p>
                  )}
                  <button class="primary" onClick={close}>Close</button>
                </>
              ) : (
                <>
                  {checkout.value.maxTipAmount ? (
                    <>
                      <p class="label">Tip</p>
                      <div class="chips">
                        {checkout.value.suggestedTips.map((suggestion) => (
                          <button
                            key={suggestion}
                            class={checkout.value.tipAmount === suggestion ? 'on' : ''}
                            onClick={() => { tipInput.value = suggestion; applyTip(); }}
                          >{money(suggestion)}</button>
                        ))}
                        <button
                          class={!checkout.value.tipAmount ? 'on' : ''}
                          onClick={() => { tipInput.value = 0; applyTip(); }}
                        >
                          None
                        </button>
                      </div>
                    </>
                  ) : null}

                  {(checkout.value.needName || checkout.value.needEmail || checkout.value.needPhone || checkout.value.needShippingAddress) && (
                    <>
                      <p class="label">
                        {checkout.value.needShippingAddress ? 'Shipping address' : 'Your details'}
                        {checkout.value.infoValidated && <span class="ok-tick"> ✓</span>}
                      </p>
                      {checkout.value.needName && (
                        <label class={['field', infoField.value === 'name' && 'bad'].filter(Boolean).join(' ')}>
                          <span>Name</span>
                          <input
                            value={info.value.name}
                            onInput={(e) => (info.value.name = (e.target as HTMLInputElement).value)}
                          />
                        </label>
                      )}
                      {checkout.value.needEmail && (
                        <label class={['field', infoField.value === 'email' && 'bad'].filter(Boolean).join(' ')}>
                          <span>Email</span>
                          <input
                            type="email"
                            value={info.value.email}
                            onInput={(e) => (info.value.email = (e.target as HTMLInputElement).value)}
                          />
                        </label>
                      )}
                      {checkout.value.needPhone && (
                        <label class={['field', infoField.value === 'phone' && 'bad'].filter(Boolean).join(' ')}>
                          <span>Phone</span>
                          <input
                            value={info.value.phone}
                            onInput={(e) => (info.value.phone = (e.target as HTMLInputElement).value)}
                          />
                        </label>
                      )}
                      {checkout.value.needShippingAddress && (
                        <>
                          <label class={['field', infoField.value === 'streetLine1' && 'bad'].filter(Boolean).join(' ')}>
                            <span>Address</span>
                            <input
                              value={info.value.streetLine1}
                              onInput={(e) => (info.value.streetLine1 = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <label class={['field', infoField.value === 'streetLine2' && 'bad'].filter(Boolean).join(' ')}>
                            <span>Address line 2</span>
                            <input
                              value={info.value.streetLine2}
                              onInput={(e) => (info.value.streetLine2 = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <label class={['field', infoField.value === 'city' && 'bad'].filter(Boolean).join(' ')}>
                            <span>City</span>
                            <input
                              value={info.value.city}
                              onInput={(e) => (info.value.city = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <label class={['field', infoField.value === 'state' && 'bad'].filter(Boolean).join(' ')}>
                            <span>State / region</span>
                            <input
                              value={info.value.state}
                              onInput={(e) => (info.value.state = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <label class={['field', infoField.value === 'countryIso2' && 'bad'].filter(Boolean).join(' ')}>
                            <span>Country code (ISO 2)</span>
                            <input
                              maxLength={2}
                              value={info.value.countryIso2}
                              onInput={(e) => (info.value.countryIso2 = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <label class={['field', infoField.value === 'postCode' && 'bad'].filter(Boolean).join(' ')}>
                            <span>Post code</span>
                            <input
                              value={info.value.postCode}
                              onInput={(e) => (info.value.postCode = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                        </>
                      )}
                      <label class="toggle">
                        <input
                          type="checkbox"
                          checked={saveInfo.value}
                          onChange={(e) => (saveInfo.value = (e.target as HTMLInputElement).checked)}
                        />
                        <span>Save these details for next time</span>
                      </label>
                      {infoError.value && <p class="error">{infoError.value}</p>}
                      <button onClick={submitInfo} disabled={busy.value === 'info'}>
                        {busy.value === 'info' ? 'Checking…' : checkout.value.infoValidated ? 'Update details' : 'Validate details'}
                      </button>
                    </>
                  )}

                  {checkout.value.shippingOptions.length ? (
                    <>
                      <p class="label">Shipping method</p>
                      {checkout.value.shippingOptions.map((option) => (
                        <button
                          key={option.id}
                          class={['option', checkout.value.selectedShippingId === option.id && 'on'].filter(Boolean).join(' ')}
                          onClick={() => pickShipping(option.id)}
                        >
                          <span>{option.title}</span>
                          <span>{money(option.amount)}</span>
                        </button>
                      ))}
                    </>
                  ) : checkout.value.needShippingAddress && checkout.value.infoValidated ? (
                    <p class="muted small">No shipping methods are offered for that address.</p>
                  ) : null}

                  {starsInvoice.value ? (
                    <>
                      <p class="label">Balance</p>
                      {balance.value === null ? (
                        <p class="muted small">Checking your balance…</p>
                      ) : (
                        <>
                          <p class="muted small">
                            You have {formatAmount(balance.value, checkout.value.currency)}.
                          </p>
                          {shortBalance.value && (
                            <>
                              <p class="error">
                                Not enough {checkout.value.pay === 'ton' ? 'TON' : 'Stars'} for this purchase.
                              </p>
                              {checkout.value.pay === 'stars' && ontopup ? (
                                <button onClick={ontopup}>Buy Stars</button>
                              ) : (
                                <p class="muted small">Top up in an official Telegram app to continue.</p>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <p class="label">Payment method</p>
                      {checkout.value.savedCards.map((saved) => (
                        <button
                          key={saved.id}
                          class={['option', checkout.value.cardTitle === saved.title && 'on'].filter(Boolean).join(' ')}
                          onClick={() => pickCard(saved.id)}
                        >
                          <span>{saved.title}</span>
                          <span class="muted small">saved</span>
                        </button>
                      ))}

                      {checkout.value.nativeProvider ? (
                        <>
                          <p class="muted small">
                            New card — sent straight to {checkout.value.nativeProvider === 'stripe' ? 'Stripe' : 'SmartGlocal'},
                            never to this app.
                          </p>
                          <label class="field">
                            <span>Card number</span>
                            <input
                              inputmode="numeric"
                              autocomplete="cc-number"
                              value={card.value.number}
                              onInput={(e) => (card.value.number = (e.target as HTMLInputElement).value)}
                            />
                          </label>
                          <div class="two">
                            <label class="field">
                              <span>MM/YY</span>
                              <input
                                placeholder="12/29"
                                value={expiry.value}
                                onInput={(e) => (expiry.value = (e.target as HTMLInputElement).value)}
                              />
                            </label>
                            <label class="field">
                              <span>CVC</span>
                              <input
                                inputmode="numeric"
                                autocomplete="cc-csc"
                                value={card.value.cvc}
                                onInput={(e) => (card.value.cvc = (e.target as HTMLInputElement).value)}
                              />
                            </label>
                          </div>
                          {checkout.value.needCardholderName && (
                            <label class="field">
                              <span>Cardholder name</span>
                              <input
                                value={card.value.cardholder}
                                onInput={(e) => (card.value.cardholder = (e.target as HTMLInputElement).value)}
                              />
                            </label>
                          )}
                          {(checkout.value.needCountry || checkout.value.needZip) && (
                            <div class="two">
                              {checkout.value.needCountry && (
                                <label class="field">
                                  <span>Country (ISO 2)</span>
                                  <input
                                    maxLength={2}
                                    value={card.value.country}
                                    onInput={(e) => (card.value.country = (e.target as HTMLInputElement).value)}
                                  />
                                </label>
                              )}
                              {checkout.value.needZip && (
                                <label class="field">
                                  <span>Post code</span>
                                  <input
                                    value={card.value.zip}
                                    onInput={(e) => (card.value.zip = (e.target as HTMLInputElement).value)}
                                  />
                                </label>
                              )}
                            </div>
                          )}
                          {checkout.value.canSaveCard && (
                            <label class="toggle">
                              <input
                                type="checkbox"
                                checked={card.value.save}
                                onChange={(e) => (card.value.save = (e.target as HTMLInputElement).checked)}
                              />
                              <span>Save this card for future payments</span>
                            </label>
                          )}
                          <button onClick={submitCard} disabled={busy.value === 'card'}>
                            {busy.value === 'card' ? 'Checking the card…' : 'Use this card'}
                          </button>
                        </>
                      ) : checkout.value.providerUrl ? (
                        <>
                          <p class="muted small">
                            This bot's provider has no in-page card form. Its own checkout page
                            has to collect the card and hand the credentials back.
                          </p>
                          <button onClick={openProviderPage}>Open the payment page</button>
                        </>
                      ) : (
                        <p class="error">
                          No payment method is available for this invoice in this client — the
                          provider offers neither an in-page form nor a checkout page.
                        </p>
                      )}

                      {checkout.value.extraMethods.map((method) => (
                        <a key={method.url} class="option link" href={method.url} target="_blank" rel="noopener noreferrer">
                          <span>{method.title}</span><span class="muted small">opens externally</span>
                        </a>
                      ))}

                      {checkout.value.cardTitle && (
                        <p class="muted small">Paying with {checkout.value.cardTitle}</p>
                      )}
                    </>
                  )}

                  {error.value && <p class="error">{error.value}</p>}

                  <button class="primary" onClick={pay} disabled={!canPay.value || busy.value === 'pay'}>
                    {busy.value === 'pay' ? 'Paying…' : `Pay ${money(checkout.value.total)}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
