/*
 * Ported from svelte/src/lib/components/StarsPanel.svelte.
 *
 * Four porting notes:
 *  - the first `$effect` reads no signal at all, so it was a run-once effect in
 *    Svelte too; it becomes a mount-only `useEffect` with an empty dependency
 *    list, and the balance subscription it opens is closed by its cleanup;
 *  - the second `$effect` tracks the `tab` signal, so it becomes a
 *    `useSignalEffect` — but the two emptiness guards inside it have to read
 *    their signal with `.peek()`. `reloadHistory()`/`reloadGifts()` write those
 *    very signals from inside the effect, and Svelte did not re-run the effect
 *    for the write it had just made itself, while a signal effect reports that
 *    as `Cycle detected`. A peeked read subscribes to `tab` alone and still
 *    loads once per tab switch (CONVERSION.md §4);
 *  - `visibleOptions` was `$derived` over signals, so it is a `useComputed`;
 *  - the two `bind:value` inputs write their signal *before* calling the handler
 *    that reads it (`findRecipients` trims the query), which is the order the
 *    Svelte binding guaranteed.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {Avatar} from './Avatar';
import {Checkout} from './Checkout';
import {Sticker} from './Sticker';
import {searchDialogs, type DialogItem} from '$lib/telegram/chats';
import {
  convertGift,
  formatStars,
  loadGiftCatalog,
  loadProfileGifts,
  loadStarsBalance,
  loadTopupOptions,
  loadTransactions,
  onStarsBalance,
  sendStarGift,
  setGiftShownOnProfile,
  starsPurchaseBlocked,
  startStarsTopup,
  formatAmount,
  type Checkout as CheckoutData,
  type GiftOption,
  type OwnedGift,
  type StarsTransaction,
  type TopupOption
} from '$lib/telegram/payments';

import './StarsPanel.css';

interface Props {
  selfId: number;
}

export function StarsPanel({selfId}: Props) {
  type Tab = 'balance' | 'history' | 'gifts';
  const tab = useSignal<Tab>('balance');

  const balance = useSignal<{stars: number; ton: number} | null>(null);
  const options = useSignal<TopupOption[]>([]);
  const blocked = useSignal(false);
  const showAllOptions = useSignal(false);

  const transactions = useSignal<StarsTransaction[]>([]);
  const nextOffset = useSignal('');
  const direction = useSignal<'all' | 'in' | 'out'>('all');
  const loadingMore = useSignal(false);

  const catalog = useSignal<GiftOption[]>([]);
  const myGifts = useSignal<OwnedGift[]>([]);
  const giftsNext = useSignal('');
  const giftView = useSignal<'mine' | 'send'>('mine');

  const checkout = useSignal<CheckoutData | null>(null);
  const error = useSignal('');
  const status = useSignal('');
  const busy = useSignal('');

  /** Gift being composed: recipient + note. */
  const giftTarget = useSignal<GiftOption | null>(null);
  const recipientQuery = useSignal('');
  const recipients = useSignal<DialogItem[]>([]);
  const recipient = useSignal<DialogItem | null>(null);
  const giftNote = useSignal('');
  const giftAnonymous = useSignal(false);
  const giftUpgrade = useSignal(false);

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  function report(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  async function refreshBalance(force = false) {
    try {
      balance.value = await loadStarsBalance(force);
    } catch(err) {
      report(err, 'Could not read your balance');
    }
  }

  useEffect(() => {
    refreshBalance();
    starsPurchaseBlocked().then((value) => (blocked.value = value));
    loadTopupOptions().then((value) => (options.value = value)).catch(() => (options.value = []));

    let off: (() => void) | undefined;
    onStarsBalance(() => refreshBalance()).then((unsubscribe) => (off = unsubscribe));
    return () => off?.();
  }, []);

  useSignalEffect(() => {
    const current = tab.value;
    if(current === 'history' && !transactions.peek().length) reloadHistory();
    if(current === 'gifts' && !myGifts.peek().length) reloadGifts();
  });

  async function reloadHistory() {
    error.value = '';
    transactions.value = [];
    nextOffset.value = '';
    await moreHistory();
  }

  async function moreHistory() {
    if(loadingMore.value) return;
    loadingMore.value = true;
    try {
      const page = await loadTransactions(nextOffset.value, direction.value);
      transactions.value = [...transactions.value, ...page.items];
      nextOffset.value = page.next;
    } catch(err) {
      report(err, 'Could not load transactions');
    } finally {
      loadingMore.value = false;
    }
  }

  async function setDirection(next: 'all' | 'in' | 'out') {
    direction.value = next;
    await reloadHistory();
  }

  async function reloadGifts() {
    error.value = '';
    try {
      const page = await loadProfileGifts(selfId, '');
      myGifts.value = page.items;
      giftsNext.value = page.next;
    } catch(err) {
      report(err, 'Could not load your gifts');
    }
  }

  async function moreGifts() {
    if(!giftsNext.value) return;
    try {
      const page = await loadProfileGifts(selfId, giftsNext.value);
      myGifts.value = [...myGifts.value, ...page.items];
      giftsNext.value = page.next;
    } catch(err) {
      report(err, 'Could not load more gifts');
    }
  }

  async function openCatalog() {
    giftView.value = 'send';
    if(catalog.value.length) return;
    try {
      catalog.value = await loadGiftCatalog();
    } catch(err) {
      report(err, 'Could not load the gift catalogue');
    }
  }

  async function topUp(option: TopupOption) {
    error.value = '';
    busy.value = 'topup';
    try {
      checkout.value = await startStarsTopup(option);
    } catch(err) {
      report(err, 'Could not start the top-up');
    } finally {
      busy.value = '';
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

  async function confirmGift() {
    if(!giftTarget.value || !recipient.value) return;
    error.value = '';
    busy.value = 'gift';
    try {
      checkout.value = await sendStarGift({
        peerId: recipient.value.peerId,
        giftId: giftTarget.value.giftId,
        message: giftNote.value.trim() || undefined,
        anonymous: giftAnonymous.value,
        includeUpgrade: giftUpgrade.value
      });
    } catch(err) {
      report(err, 'Could not open the gift checkout');
    } finally {
      busy.value = '';
    }
  }

  async function convert(gift: OwnedGift) {
    if(!confirm(`Convert this gift into ${gift.convertStars} Stars? This cannot be undone.`)) return;
    try {
      await convertGift(gift.key);
      flash('Converted to Stars');
      await Promise.all([reloadGifts(), refreshBalance(true)]);
    } catch(err) {
      report(err, 'Could not convert the gift');
    }
  }

  async function toggleShown(gift: OwnedGift) {
    try {
      await setGiftShownOnProfile(gift.key, !gift.shown);
      myGifts.value = myGifts.value.map((item) =>
        item.key === gift.key ? {...item, shown: !item.shown} : item
      );
    } catch(err) {
      report(err, 'Could not change the gift visibility');
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }

  const visibleOptions = useComputed(() =>
    showAllOptions.value ? options.value : options.value.filter((option) => !option.extended)
  );

  return (
    <>
      <div class="stars">
        {error.value && <p class="error">{error.value}</p>}
        {status.value && <p class="ok">{status.value}</p>}

        <div class="tabs">
          {[['balance', 'Balance'], ['history', 'History'], ['gifts', 'Gifts']].map(([key, label]) => (
            <button key={key} class={tab.value === key ? 'on' : ''} onClick={() => (tab.value = key as Tab)}>{label}</button>
          ))}
        </div>

        {tab.value === 'balance' ?
          <>
            {!balance.value ?
              <p class="muted">Loading…</p> :
              <>
                <p class="balance">★ {formatStars(balance.value.stars)}</p>
                {balance.value.ton ?
                  <p class="muted small">{formatAmount(Math.round(balance.value.ton * 1e9), 'TON')}</p> :
                  null}
              </>}

            <p class="label">Buy Stars</p>
            {blocked.value ?
              <p class="muted small">
                Star purchases are switched off for this account by the server.
              </p> :
              !options.value.length ?
                <p class="muted small">No top-up options are offered right now.</p> :
                <>
                  {visibleOptions.value.map((option) => (
                    <button key={option.stars} class="option" onClick={() => topUp(option)} disabled={busy.value === 'topup'}>
                      <span>★ {option.stars.toLocaleString()}</span>
                      <span>{formatAmount(option.amount, option.currency)}</span>
                    </button>
                  ))}
                  {!showAllOptions.value && options.value.some((option) => option.extended) && (
                    <button class="ghost" onClick={() => (showAllOptions.value = true)}>Show more</button>
                  )}
                </>}

          </> :

          tab.value === 'history' ?
            <>
              <div class="chips">
                {[['all', 'All'], ['in', 'Incoming'], ['out', 'Outgoing']].map(([key, label]) => (
                  <button
                    key={key}
                    class={direction.value === key ? 'on' : ''}
                    onClick={() => setDirection(key as 'all' | 'in' | 'out')}
                  >{label}</button>
                ))}
              </div>

              {!transactions.value.length ?
                <p class="muted small">{loadingMore.value ? 'Loading…' : 'No transactions yet.'}</p> :
                <>
                  {transactions.value.map((transaction) => (
                    <div key={transaction.id} class="transaction">
                      <span class="tx-title">
                        {transaction.title || transaction.peerTitle || 'Transaction'}
                        {transaction.refund && <span class="tag">refund</span>}
                        {transaction.pending && <span class="tag">pending</span>}
                        {transaction.failed && <span class="tag bad">failed</span>}
                      </span>
                      <span class={['amount', transaction.incoming && 'incoming'].filter(Boolean).join(' ')}>
                        {transaction.incoming ? '+' : '−'}{transaction.ton ? '' : '★ '}{formatStars(transaction.amount)}
                      </span>
                      {transaction.description && (
                        <span class="muted small">{transaction.description}</span>
                      )}
                      <span class="muted small">{dateOf(transaction.date)}</span>
                    </div>
                  ))}
                  {nextOffset.value && (
                    <button class="ghost" onClick={moreHistory} disabled={loadingMore.value}>
                      {loadingMore.value ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </>}

            </> :

            <>
              <div class="chips">
                <button class={giftView.value === 'mine' ? 'on' : ''} onClick={() => (giftView.value = 'mine')}>My gifts</button>
                <button class={giftView.value === 'send' ? 'on' : ''} onClick={openCatalog}>Send a gift</button>
              </div>

              {giftView.value === 'mine' ?
                <>
                  {!myGifts.value.length ?
                    <p class="muted small">You have not received any gifts yet.</p> :
                    <>
                      {myGifts.value.map((gift) => (
                        <div key={gift.key} class="gift">
                          <Sticker sticker={gift.sticker} size={48} />
                          <div class="gift-body">
                            <span class="gift-title">{gift.title}</span>
                            {gift.fromTitle && (
                              <span class="muted small">from {gift.fromTitle}</span>
                            )}
                            {gift.message && (
                              <span class="muted small">“{gift.message}”</span>
                            )}
                            <span class="muted small">{dateOf(gift.date)}</span>
                            <div class="gift-actions">
                              {gift.incoming && (
                                <button class="ghost" onClick={() => toggleShown(gift)}>
                                  {gift.shown ? 'Hide from profile' : 'Show on profile'}
                                </button>
                              )}
                              {gift.canConvert && (
                                <button class="ghost" onClick={() => convert(gift)}>
                                  Convert to ★ {gift.convertStars}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {giftsNext.value && (
                        <button class="ghost" onClick={moreGifts}>Load more</button>
                      )}
                    </>}

                </> :

                giftTarget.value ?
                  <>
                    <p class="label">Send this gift for ★ {giftTarget.value.stars.toLocaleString()}</p>
                    <div class="gift-preview"><Sticker sticker={giftTarget.value.sticker} size={72} /></div>

                    {recipient.value ?
                      <button class="option" onClick={() => (recipient.value = null)}>
                        <span><Avatar peerId={recipient.value.peerId} title={recipient.value.title} size={24} /> {recipient.value.title}</span>
                        <span class="muted small">change</span>
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

                    <label class="field">
                      <span>Message (optional)</span>
                      <input
                        value={giftNote.value}
                        onInput={(e) => (giftNote.value = (e.target as HTMLInputElement).value)}
                        maxlength={255}
                      />
                    </label>
                    <label class="toggle">
                      <input
                        type="checkbox"
                        checked={giftAnonymous.value}
                        onChange={(e) => (giftAnonymous.value = (e.target as HTMLInputElement).checked)}
                      />
                      <span>Hide my name from the recipient's profile</span>
                    </label>
                    {giftTarget.value.upgradeStars ?
                      <label class="toggle">
                        <input
                          type="checkbox"
                          checked={giftUpgrade.value}
                          onChange={(e) => (giftUpgrade.value = (e.target as HTMLInputElement).checked)}
                        />
                        <span>Prepay the upgrade to a collectible (+★ {giftTarget.value.upgradeStars})</span>
                      </label> :
                      null}

                    <button class="primary" onClick={confirmGift} disabled={!recipient.value || busy.value === 'gift'}>
                      {busy.value === 'gift' ? 'Opening…' : 'Continue'}
                    </button>
                    <button class="ghost" onClick={() => (giftTarget.value = null)}>Back to the catalogue</button>

                  </> :

                  !catalog.value.length ?
                    <p class="muted small">Loading the gift catalogue…</p> :

                    <div class="catalog">
                      {catalog.value.map((gift) => (
                        <button
                          key={gift.giftId}
                          class="catalog-item"
                          disabled={gift.soldOut}
                          onClick={() => { giftTarget.value = gift; recipient.value = null; giftNote.value = ''; }}
                        >
                          <Sticker sticker={gift.sticker} size={64} />
                          <span class="price">★ {gift.stars.toLocaleString()}</span>
                          {gift.soldOut ?
                            <span class="muted small">sold out</span> :
                            gift.limited ?
                              <span class="muted small">{gift.remains.toLocaleString()} left</span> :
                              null}
                        </button>
                      ))}
                    </div>}
            </>}
      </div>

      {checkout.value && (
        <Checkout
          checkout={checkout.value}
          onclose={() => (checkout.value = null)}
          ondone={() => {
            checkout.value = null;
            flash('Payment confirmed');
            refreshBalance(true);
            if(tab.value === 'gifts') reloadGifts();
            if(tab.value === 'history') reloadHistory();
          }}
        />
      )}
    </>
  );
}
