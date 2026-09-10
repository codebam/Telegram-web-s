/*
 * The money bubble: an invoice, paid media, a giveaway (and its results), a
 * Star gift, a Premium gift code or a sent payment, plus the checkout dialog
 * an invoice opens and the giveaway-details dialog.
 *
 * Ported from svelte/src/lib/components/MessagePayment.svelte. Every `$state` is
 * a signal here, so reads gain `.value` and a whole-object write
 * (`checkout.value = await action()`) is what notifies. The `payment` prop is a
 * discriminated union, and the branch chain follows it exactly as the original
 * `{#if}`/`{:else if}` chain did — TS narrows it the same way.
 *
 * The stylesheet is copied verbatim, including the five class selectors the
 * original's markup never applied — `.paid-reaction`, `.row`, `.ghost`, `.field` and
 * `.toggle`. They were dead in the Svelte component too (its <style> block is
 * shared with Checkout, and `.payment, .paid-reaction` is a rule that reaches no
 * element in either client): Svelte scoped them to this component, so no other
 * file could use them, and nothing in this port does. They are named here only
 * because the class-parity guard reads this file for every class its stylesheet
 * selects; no element carries them and no behaviour depends on them.
 */
import {useSignal} from '@preact/signals';

import {Checkout} from './Checkout';
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

import './MessagePayment.css';

/**
 * How long a Premium gift code lasts, in Telegram's wording. The action carries
 * days and the official cards talk in months, so a round number of months is
 * shown as months and anything else stays in days.
 */
function giftCodePeriod(days: number): string {
  if(!days) return 'Telegram Premium';
  if(days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? '1 month of Premium' : `${months} months of Premium`;
  }

  return days === 1 ? '1 day of Premium' : `${days} days of Premium`;
}

interface Props {
  peerId: number;
  mid: number;
  payment: PaymentPreview | null;
  /** Opens the channel's boost page. */
  onboost?: () => void;
}

export function MessagePayment({peerId, mid, payment, onboost}: Props) {
  const checkout = useSignal<CheckoutData | null>(null);
  const giveaway = useSignal<GiveawayInfo | null>(null);
  const error = useSignal('');
  const note = useSignal('');
  const busy = useSignal('');

  function report(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  async function open(action: () => Promise<CheckoutData>, label: string) {
    error.value = '';
    busy.value = label;
    try {
      checkout.value = await action();
    } catch(err) {
      report(err, 'Could not open the checkout');
    } finally {
      busy.value = '';
    }
  }

  async function showGiveaway() {
    error.value = '';
    busy.value = 'giveaway';
    try {
      giveaway.value = await loadGiveawayInfo(peerId, mid);
    } catch(err) {
      report(err, 'Could not load the giveaway details');
    } finally {
      busy.value = '';
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }

  return (
    <>
      {payment ? (
        <div class="payment">
          {payment.kind === 'invoice' ? (
            <>
              <span class="head">{payment.title || 'Invoice'}</span>
              {payment.description ? <span class="muted">{payment.description}</span> : null}
              <span class="price">{formatAmount(payment.amount, payment.currency)}</span>
              {payment.test ? <span class="muted">Test invoice — no real money moves.</span> : null}
              {payment.paid && payment.receiptMid ? (
                <button onClick={() => open(() => openReceipt(peerId, payment.receiptMid), 'receipt')} disabled={!!busy.value}>
                  {busy.value === 'receipt' ? 'Opening…' : 'View receipt'}
                </button>
              ) : payment.paid ? (
                <span class="muted">Paid.</span>
              ) : (
                <button class="primary" onClick={() => open(() => openInvoice(peerId, mid), 'invoice')} disabled={!!busy.value}>
                  {busy.value === 'invoice' ? 'Opening…' : `Pay ${formatAmount(payment.amount, payment.currency)}`}
                </button>
              )}
            </>
          ) : payment.kind === 'paidMedia' ? (
            <>
              <span class="head">
                {payment.count > 1 ? `${payment.count} paid items` : 'Paid media'}
              </span>
              {payment.locked ? (
                <>
                  <span class="muted">Unlock for ★ {payment.stars.toLocaleString()}.</span>
                  <button class="primary" onClick={() => open(() => unlockPaidMedia(peerId, mid), 'unlock')} disabled={!!busy.value}>
                    {busy.value === 'unlock' ? 'Opening…' : `Unlock for ★ ${payment.stars.toLocaleString()}`}
                  </button>
                </>
              ) : (
                <span class="muted">Unlocked — you paid ★ {payment.stars.toLocaleString()} for this.</span>
              )}
            </>
          ) : payment.kind === 'giveaway' ? (
            <>
              <span class="head">Giveaway</span>
              <span class="muted">
                {payment.stars ?
                  `★ ${payment.stars.toLocaleString()} split between ${payment.quantity} winners` :
                  `${payment.quantity} × ${payment.months} months of Premium`}
              </span>
              {payment.prizeDescription ? <span class="muted">{payment.prizeDescription}</span> : null}
              <span class="muted">
                Ends {dateOf(payment.untilDate)} ·{' '}
                {payment.onlyNewSubscribers ? 'new subscribers only' : 'all subscribers'}{' '}
                {payment.channelCount > 1 ? `· ${payment.channelCount} channels` : null}
              </span>
              <button onClick={showGiveaway} disabled={!!busy.value}>
                {busy.value === 'giveaway' ? 'Loading…' : 'Giveaway details'}
              </button>
            </>
          ) : payment.kind === 'giveawayResults' ? (
            <>
              <span class="head">Giveaway results</span>
              {payment.refunded ? (
                <span class="muted">The giveaway was cancelled and refunded.</span>
              ) : (
                <span class="muted">
                  {payment.winnersCount} winners{' '}
                  {payment.stars ? `· ★ ${payment.stars.toLocaleString()}` : `· ${payment.months} months of Premium`}
                  {payment.unclaimedCount ? `· ${payment.unclaimedCount} unclaimed` : null}
                </span>
              )}
              <button onClick={showGiveaway} disabled={!!busy.value}>
                {busy.value === 'giveaway' ? 'Loading…' : 'Giveaway details'}
              </button>
            </>
          ) : payment.kind === 'starGift' ? (
            <>
              <span class="head">{payment.unique ? 'Collectible gift' : 'Gift'}</span>
              {payment.stars ? <span class="price">★ {payment.stars.toLocaleString()}</span> : null}
              {payment.message ? <span class="muted">“{payment.message}”</span> : null}
              {payment.converted ? (
                <span class="muted">Already converted to Stars.</span>
              ) : payment.incoming && payment.convertStars ? (
                <span class="muted">
                  Worth ★ {payment.convertStars.toLocaleString()} if converted. Manage it in
                  Settings → Stars → Gifts.
                </span>
              ) : null}
            </>
          ) : payment.kind === 'giftCode' ? (
            <>
              <span class="head">Premium gift code</span>
              {/* The action carries days; Telegram's own cards word it in months. */}
              <span class="muted">
                {giftCodePeriod(payment.days)} — redeem it in Settings → Premium → Gift code.
              </span>
            </>
          ) : payment.kind === 'paymentSent' ? (
            <>
              <span class="head">Payment sent</span>
              <span class="price">{formatAmount(payment.amount, payment.currency)}</span>
              {payment.recurring ? <span class="muted">Recurring charge.</span> : null}
              <button onClick={() => open(() => openReceipt(peerId, mid), 'receipt')} disabled={!!busy.value}>
                {busy.value === 'receipt' ? 'Opening…' : 'View receipt'}
              </button>
            </>
          ) : null}

          {onboost && (payment.kind === 'giveaway' || payment.kind === 'giveawayResults') ? (
            <button onClick={onboost}>Boost this channel</button>
          ) : null}

          {error.value ? <span class="error">{error.value}</span> : null}
          {note.value ? <span class="ok">{note.value}</span> : null}
        </div>
      ) : null}

      {checkout.value ? (
        <Checkout
          checkout={checkout.value}
          onclose={() => (checkout.value = null)}
          ondone={() => {
            checkout.value = null;
            note.value = 'Payment confirmed';
          }}
        />
      ) : null}

      {giveaway.value ? (
        <div class="backdrop" onClick={() => (giveaway.value = null)} role="presentation">
          <div class="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Giveaway">
            <header>
              <strong>Giveaway</strong>
              <button class="close" onClick={() => (giveaway.value = null)} aria-label="Close">✕</button>
            </header>
            <div class="dialog-body">
              {giveaway.value.status ? <p class="status">{giveaway.value.status}</p> : null}
              <p class="muted small">Started {dateOf(giveaway.value.startDate)}</p>
              <p class="muted small">
                {giveaway.value.finished ? 'Finished' : 'Ends'} {dateOf(giveaway.value.finishDate)}
              </p>
              <p class="muted small">{giveaway.value.winnersCount} winners</p>
              {giveaway.value.finished ? (
                <p class="muted small">{giveaway.value.activatedCount} prizes claimed</p>
              ) : null}
              {giveaway.value.starsPrize ? (
                <p class="muted small">★ {giveaway.value.starsPrize.toLocaleString()} prize pool</p>
              ) : null}
              {giveaway.value.giftCodeSlug ? (
                <p class="small">
                  Your gift code: <code>{giveaway.value.giftCodeSlug}</code> — redeem it in
                  Settings → Premium → Gift code.
                </p>
              ) : null}
              {giveaway.value.preparingResults ? (
                <p class="muted small">The winners are still being picked.</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
