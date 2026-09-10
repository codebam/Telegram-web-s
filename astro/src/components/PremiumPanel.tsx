/*
 * Ported from svelte/src/lib/components/PremiumPanel.svelte.
 *
 * Three porting notes:
 *  - the `$effect` that loads the page reads no signal, so it was a run-once
 *    effect in Svelte too; it becomes a mount-only `useEffect` with an empty
 *    dependency list;
 *  - `selectedGift` was `$derived` over the `giftOptions` signal, so it is a
 *    `useComputed`;
 *  - the two `bind:value` inputs write their signal *before* calling the handler
 *    that reads it (`findRecipients` trims the query), which is the order the
 *    Svelte binding guaranteed.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {Checkout} from './Checkout';
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

import './PremiumPanel.css';

export function PremiumPanel() {
  const page = useSignal<PremiumPage | null>(null);
  const giftOptions = useSignal<PremiumGiftOption[]>([]);
  const view = useSignal<'about' | 'gift' | 'code'>('about');

  const recipientQuery = useSignal('');
  const recipients = useSignal<DialogItem[]>([]);
  const recipient = useSignal<DialogItem | null>(null);
  const giftMonths = useSignal(0);
  const giftWithStars = useSignal(false);
  const giftNote = useSignal('');

  const codeInput = useSignal('');
  const codeInfo = useSignal<{fromTitle: string; days: number; used: boolean} | null>(null);

  const checkout = useSignal<CheckoutData | null>(null);
  const error = useSignal('');
  const status = useSignal('');
  const busy = useSignal('');

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  function report(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  useEffect(() => {
    loadPremiumPage()
    .then((value) => (page.value = value))
    .catch((err) => report(err, 'Could not load the Premium page'));
  }, []);

  async function openGift() {
    view.value = 'gift';
    if(giftOptions.value.length) return;
    try {
      giftOptions.value = await loadPremiumGiftOptions();
      giftMonths.value = giftOptions.value[0]?.months ?? 0;
    } catch(err) {
      report(err, 'Could not load the gift options');
    }
  }

  async function findRecipients() {
    const query = recipientQuery.value.trim();
    if(!query) {
      recipients.value = [];
      return;
    }
    try {
      recipients.value = (await searchDialogs(query, 20)).filter((dialog) => dialog.isUser);
    } catch(err) {
      recipients.value = [];
    }
  }

  async function startGift() {
    if(!recipient.value || !giftMonths.value) return;
    error.value = '';
    busy.value = 'gift';
    try {
      checkout.value = await giftPremium(recipient.value.peerId, giftMonths.value, giftWithStars.value, giftNote.value.trim());
    } catch(err) {
      report(err, 'Could not open the gift checkout');
    } finally {
      busy.value = '';
    }
  }

  function slugOf(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/(?:t\.me\/giftcode\/)?([A-Za-z0-9_-]+)\/?$/);
    return match ? match[1] : trimmed;
  }

  async function lookupCode() {
    error.value = '';
    codeInfo.value = null;
    busy.value = 'code';
    try {
      const info = await checkGiftCode(slugOf(codeInput.value));
      codeInfo.value = {fromTitle: info.fromTitle, days: info.days, used: !!info.usedDate};
    } catch(err) {
      report(err, 'That gift code could not be checked');
    } finally {
      busy.value = '';
    }
  }

  async function redeemCode() {
    error.value = '';
    busy.value = 'redeem';
    try {
      await applyGiftCode(slugOf(codeInput.value));
      flash('Gift code applied');
      page.value = await loadPremiumPage();
    } catch(err) {
      report(err, 'That gift code could not be applied');
    } finally {
      busy.value = '';
    }
  }

  const selectedGift = useComputed(() => giftOptions.value.find((option) => option.months === giftMonths.value) ?? null);

  return (
    <>
      <div class="premium">
        {error.value && <p class="error">{error.value}</p>}
        {status.value && <p class="ok">{status.value}</p>}

        <div class="chips">
          <button class={view.value === 'about' ? 'on' : ''} onClick={() => (view.value = 'about')}>Premium</button>
          <button class={view.value === 'gift' ? 'on' : ''} onClick={openGift}>Gift Premium</button>
          <button class={view.value === 'code' ? 'on' : ''} onClick={() => (view.value = 'code')}>Gift code</button>
        </div>

        {!page.value ?
          <p class="muted">Loading…</p> :

          view.value === 'about' ?
            <>
              <p class="status-line">
                {page.value.active ? '★ Premium is active on this account' : 'Premium is not active'}
              </p>
              {page.value.statusText && (
                <p class="muted small">{page.value.statusText}</p>
              )}

              {!page.value.active && (
                <>
                  <p class="label">Subscribe</p>
                  {page.value.purchaseBlocked ?
                    <p class="muted small">
                      Premium purchases are switched off for this account by the server.
                    </p> :
                    !page.value.options.length ?
                      <p class="muted small">
                        The server offered no subscription options for this account.
                      </p> :
                      <>
                        {page.value.options.map((option) => (
                          option.botUrl ?
                            <a key={option.months} class="option" href={option.botUrl} target="_blank" rel="noopener noreferrer">
                              <span>{option.months} month{option.months === 1 ? '' : 's'}</span>
                              <span>
                                {formatAmount(option.amount, option.currency)}
                                <span class="muted small">· {formatAmount(option.monthly, option.currency)}/mo</span>
                              </span>
                            </a> :
                            <div key={option.months} class="option disabled">
                              <span>{option.months} month{option.months === 1 ? '' : 's'}</span>
                              <span class="muted small">unavailable</span>
                            </div>
                        ))}
                        <p class="muted small">
                          Telegram does not sell the subscription through the web API — the server
                          hands out a bot link that runs the real payment, which is what opens
                          here, exactly as the official web client does.
                        </p>
                      </>}
                </>
              )}

              <p class="label">What Premium includes</p>
              {page.value.features.map((feature) => (
                <div key={feature.key} class="feature">
                  <span class="feature-title">{feature.title}</span>
                  <span class="muted small">{feature.description}</span>
                </div>
              ))}
            </> :

            view.value === 'gift' ?
              <>
                {!giftOptions.value.length ?
                  <p class="muted small">Loading the gift options…</p> :
                  <>
                    {recipient.value ?
                      <button class="option" onClick={() => (recipient.value = null)}>
                        <span>{recipient.value.title}</span><span class="muted small">change</span>
                      </button> :
                      <>
                        <label class="field">
                          <span>Recipient</span>
                          <input
                            value={recipientQuery.value}
                            onInput={(e) => {
                              recipientQuery.value = (e.target as HTMLInputElement).value;
                              findRecipients();
                            }}
                            placeholder="Search people"
                          />
                        </label>
                        {recipients.value.map((candidate) => (
                          <button key={candidate.peerId} class="option" onClick={() => (recipient.value = candidate)}>
                            <span>{candidate.title}</span>
                          </button>
                        ))}
                      </>}

                    <p class="label">Duration</p>
                    {giftOptions.value.map((option) => (
                      <button
                        key={option.months}
                        class={['option', giftMonths.value === option.months && 'on'].filter(Boolean).join(' ')}
                        onClick={() => (giftMonths.value = option.months)}
                      >
                        <span>
                          {option.months} months
                          {/* A numeric `{#if}` needs the ternary form: `0 && …` would render a `0`. */}
                          {option.discountPercent ? <span class="save">−{option.discountPercent}%</span> : null}
                        </span>
                        <span>
                          {giftWithStars.value && option.starsAmount ?
                            `★ ${option.starsAmount.toLocaleString()}` :
                            formatAmount(option.amount, option.currency)}
                        </span>
                      </button>
                    ))}

                    {selectedGift.value?.starsAmount ? (
                      <label class="toggle">
                        <input
                          type="checkbox"
                          checked={giftWithStars.value}
                          onChange={(e) => (giftWithStars.value = (e.target as HTMLInputElement).checked)}
                        />
                        <span>Pay with Stars instead of a card</span>
                      </label>
                    ) : null}

                    <label class="field">
                      <span>Message (optional)</span>
                      <input
                        value={giftNote.value}
                        onInput={(e) => (giftNote.value = (e.target as HTMLInputElement).value)}
                        maxlength={255}
                      />
                    </label>

                    <button class="primary" onClick={startGift} disabled={!recipient.value || !giftMonths.value || busy.value === 'gift'}>
                      {busy.value === 'gift' ? 'Opening…' : 'Continue'}
                    </button>
                  </>}

              </> :

              <>
                <p class="label">Redeem a gift code</p>
                <label class="field">
                  <span>Code or t.me/giftcode link</span>
                  <input
                    value={codeInput.value}
                    onInput={(e) => (codeInput.value = (e.target as HTMLInputElement).value)}
                  />
                </label>
                <button onClick={lookupCode} disabled={!codeInput.value.trim() || busy.value === 'code'}>
                  {busy.value === 'code' ? 'Checking…' : 'Check the code'}
                </button>

                {codeInfo.value && (
                  <>
                    <p class="muted small">
                      {codeInfo.value.days} days of Premium{codeInfo.value.fromTitle ? ` from ${codeInfo.value.fromTitle}` : ''}.
                      {codeInfo.value.used ? 'It has already been used.' : ''}
                    </p>
                    {!codeInfo.value.used && (
                      <button class="primary" onClick={redeemCode} disabled={busy.value === 'redeem'}>
                        {busy.value === 'redeem' ? 'Applying…' : 'Apply to this account'}
                      </button>
                    )}
                  </>
                )}
              </>}
      </div>

      {checkout.value && (
        <Checkout
          checkout={checkout.value}
          onclose={() => (checkout.value = null)}
          ondone={() => {
            checkout.value = null;
            flash('Gift sent');
            recipient.value = null;
            giftNote.value = '';
          }}
        />
      )}
    </>
  );
}
