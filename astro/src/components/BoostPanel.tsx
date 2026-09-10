/*
 * Channel boosts and the giveaway setup that spends them.
 *
 * Ported from svelte/src/lib/components/BoostPanel.svelte. Two conversions are
 * worth knowing when reading this:
 *  - the first `$effect` depends on the `peerId` prop, so it is a `useEffect`
 *    with that prop in its dependency list; the second reads the `view` and
 *    `setup` signals and so becomes a `useSignalEffect` (CONVERSION.md §4);
 *  - `freeSlots` was `$derived` over a signal *and* the `peerId` prop, so it
 *    stays a plain constant recomputed on each render — a `useComputed` tracks
 *    signal reads only and would never notice a different peer.
 */
import {useEffect} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {Checkout} from './Checkout';
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

import './BoostPanel.css';

interface Props {
  peerId: number;
  title: string;
  /** Only channel admins may launch a giveaway. */
  canCreateGiveaway?: boolean;
  onclose: () => void;
}

export function BoostPanel({peerId, title, canCreateGiveaway = false, onclose}: Props) {
  const view = useSignal<'boost' | 'giveaway'>('boost');
  const status = useSignal<BoostStatus | null>(null);
  const slots = useSignal<BoostSlot[]>([]);
  const chosenSlots = useSignal<number[]>([]);

  const setup = useSignal<GiveawaySetup | null>(null);
  const winners = useSignal(0);
  const months = useSignal(0);
  const days = useSignal(7);
  const onlyNew = useSignal(false);
  const showWinners = useSignal(true);
  const prize = useSignal('');
  const countries = useSignal('');

  const checkout = useSignal<CheckoutData | null>(null);
  const error = useSignal('');
  const note = useSignal('');
  const busy = useSignal('');

  function report(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  useEffect(() => {
    loadBoostStatus(peerId)
    .then((value) => {
      status.value = value;
      chosenSlots.value = value.myBoostSlots.slice();
    })
    .catch((err) => report(err, 'Could not load the boost status'));

    loadMyBoostSlots()
    .then((value) => (slots.value = value))
    .catch(() => (slots.value = []));
  }, [peerId]);

  useSignalEffect(() => {
    if(view.value !== 'giveaway' || setup.value) return;
    loadGiveawaySetup(peerId)
    .then((value) => {
      setup.value = value;
      winners.value = value.premiumWinnerCounts[0] ?? 0;
      months.value = value.premiumMonths[0] ?? 0;
    })
    .catch((err) => report(err, 'Could not load the giveaway options'));
  });

  const freeSlots = slots.value.filter((slot) => slot.peerId !== peerId);

  function toggleSlot(slot: number) {
    chosenSlots.value = chosenSlots.value.includes(slot) ?
      chosenSlots.value.filter((value) => value !== slot) :
      [...chosenSlots.value, slot];
  }

  async function boost() {
    error.value = '';
    note.value = '';
    busy.value = 'boost';
    try {
      status.value = await boostChannel(peerId, chosenSlots.value);
      slots.value = await loadMyBoostSlots();
      note.value = 'Boost applied';
    } catch(err: any) {
      const type = err?.type || '';
      if(type === 'PREMIUM_ACCOUNT_REQUIRED') {
        error.value = 'Boosting a channel needs Telegram Premium.';
      } else if(type === 'BOOST_NOT_MODIFIED') {
        error.value = 'You are already boosting this channel with those slots.';
      } else {
        report(err, 'Could not boost this channel');
      }
    } finally {
      busy.value = '';
    }
  }

  async function launchGiveaway() {
    error.value = '';
    busy.value = 'giveaway';
    try {
      checkout.value = await createGiveaway({
        peerId,
        winners: winners.value,
        months: months.value,
        untilDate: Math.floor(Date.now() / 1000) + days.value * 86400,
        onlyNewSubscribers: onlyNew.value,
        showWinners: showWinners.value,
        prizeDescription: prize.value.trim(),
        countriesIso2: countries.value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
        additionalPeerIds: []
      });
    } catch(err) {
      report(err, 'Could not start the giveaway checkout');
    } finally {
      busy.value = '';
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleDateString() : '';
  }

  return (
    <>
      <div class="backdrop" onClick={onclose} role="presentation">
        <div class="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Boosts">
          <header>
            <strong>Boosts · {title}</strong>
            <button class="close" onClick={onclose} aria-label="Close">✕</button>
          </header>

          <div class="body">
            {error.value && <p class="error">{error.value}</p>}
            {note.value && <p class="ok">{note.value}</p>}

            {canCreateGiveaway && (
              <div class="chips">
                <button class={view.value === 'boost' ? 'on' : ''} onClick={() => (view.value = 'boost')}>Status</button>
                <button class={view.value === 'giveaway' ? 'on' : ''} onClick={() => (view.value = 'giveaway')}>New giveaway</button>
              </div>
            )}

            {view.value === 'boost' ? (
              !status.value ? (
                <p class="muted">Loading…</p>
              ) : (
                <>
                  <p class="level">Level {status.value.level}</p>
                  <div class="bar"><span style={{width: `${Math.round(status.value.progress * 100)}%`}}></span></div>
                  <p class="muted small">
                    {status.value.boosts.toLocaleString()} boosts
                    {' '}
                    {!status.value.maxLevel ?
                      ` · ${(status.value.nextLevelBoosts - status.value.boosts).toLocaleString()} more for level ${status.value.level + 1}` :
                      ' · top level reached'}
                  </p>
                  {status.value.giftBoosts ?
                    <p class="muted small">{status.value.giftBoosts.toLocaleString()} of those came from gifts and giveaways.</p> :
                    null}
                  {status.value.premiumAudiencePercent ?
                    <p class="muted small">{status.value.premiumAudiencePercent}% of subscribers have Premium.</p> :
                    null}

                  <p class="label">Your boost slots</p>
                  {!slots.value.length ?
                    <p class="muted small">
                      You have no boost slots — they come with Telegram Premium.
                    </p> :
                    <>
                      {slots.value.map((slot) => (
                        <button
                          key={slot.slot}
                          class={['option', chosenSlots.value.includes(slot.slot) && 'on'].filter(Boolean).join(' ')}
                          onClick={() => toggleSlot(slot.slot)}
                        >
                          <span>Slot {slot.slot}</span>
                          <span class="muted small">
                            {slot.peerId === peerId ?
                              `boosting this channel until ${dateOf(slot.expires)}` :
                              slot.peerId ?
                                `boosting ${slot.peerTitle} until ${dateOf(slot.expires)}` :
                                'free'}
                          </span>
                        </button>
                      ))}
                      <p class="muted small">
                        Reassigning a slot that is boosting another channel takes it away
                        from that channel.
                      </p>
                      <button class="primary" onClick={boost} disabled={!chosenSlots.value.length || busy.value === 'boost'}>
                        {busy.value === 'boost' ? 'Boosting…' : 'Boost this channel'}
                      </button>
                    </>}

                  {status.value.boostUrl &&
                    <a class="option link" href={status.value.boostUrl} target="_blank" rel="noopener noreferrer">
                      <span>Share the boost link</span>
                    </a>}
                  {freeSlots.length === 0 && slots.value.length ?
                    <p class="muted small">Every slot you have is already in use.</p> :
                    null}
                </>
              )
            ) : !setup.value ? (
              <p class="muted">Loading…</p>
            ) : (
              <>
                <p class="muted small">
                  A giveaway hands Premium subscriptions to random subscribers and boosts
                  the channel by {setup.value.limits.boostsPerPremium} per subscription. It only
                  starts once the invoice is paid.
                </p>

                <p class="label">Winners</p>
                <div class="chips">
                  {setup.value.premiumWinnerCounts.map((count) => (
                    <button key={count} class={winners.value === count ? 'on' : ''} onClick={() => (winners.value = count)}>{count}</button>
                  ))}
                </div>

                <p class="label">Subscription length</p>
                <div class="chips">
                  {setup.value.premiumMonths.map((value) => (
                    <button key={value} class={months.value === value ? 'on' : ''} onClick={() => (months.value = value)}>{value} mo</button>
                  ))}
                </div>

                <label class="field">
                  <span>Ends in (days, max {Math.floor(setup.value.limits.maxPeriod / 86400)})</span>
                  <input
                    type="number"
                    min="1"
                    max={Math.floor(setup.value.limits.maxPeriod / 86400)}
                    value={days.value}
                    onInput={(e) => (days.value = +(e.target as HTMLInputElement).value)}
                  />
                </label>

                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={onlyNew.value}
                    onChange={(e) => (onlyNew.value = (e.target as HTMLInputElement).checked)}
                  />
                  <span>Only new subscribers may take part</span>
                </label>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={showWinners.value}
                    onChange={(e) => (showWinners.value = (e.target as HTMLInputElement).checked)}
                  />
                  <span>Show the winners publicly</span>
                </label>

                <label class="field">
                  <span>Prize description (optional)</span>
                  <input value={prize.value} onInput={(e) => (prize.value = (e.target as HTMLInputElement).value)} />
                </label>
                <label class="field">
                  <span>Countries, ISO-2 comma separated (optional, max {setup.value.limits.maxCountries})</span>
                  <input
                    value={countries.value}
                    onInput={(e) => (countries.value = (e.target as HTMLInputElement).value)}
                    placeholder="GB, DE, FR"
                  />
                </label>

                <button class="primary" onClick={launchGiveaway} disabled={!winners.value || !months.value || busy.value === 'giveaway'}>
                  {busy.value === 'giveaway' ? 'Opening…' : 'Continue to payment'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {checkout.value && (
        <Checkout
          checkout={checkout.value}
          onclose={() => (checkout.value = null)}
          ondone={() => {
            checkout.value = null;
            note.value = 'Giveaway started';
            loadBoostStatus(peerId).then((value) => (status.value = value)).catch(() => {});
            view.value = 'boost';
          }}
        />
      )}
    </>
  );
}
