/*
 * Ported from svelte/src/lib/components/StarReactionSheet.svelte.
 *
 * The original `$effect` read the `peerId`/`mid` *props*, so it becomes a
 * `useEffect` with both in its dependency list — `useSignalEffect` only tracks
 * signal reads and would never reload the sheet for another message.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {
  isPaidReactionAnonymous,
  maxPaidStars,
  myPaidStars,
  sendPaidReaction,
  setPaidReactionAnonymous,
  starsBalance
} from '$lib/telegram/reactions';

import './StarReactionSheet.css';

interface Props {
  peerId: number;
  mid: number;
  onsent: () => void;
  onclose: () => void;
}

export function StarReactionSheet({peerId, mid, onsent, onclose}: Props) {
  const balance = useSignal(0);
  const max = useSignal(2500);
  const mine = useSignal(0);
  const anonymous = useSignal(false);
  const count = useSignal(50);
  const sending = useSignal(false);
  const loading = useSignal(true);
  const error = useSignal('');

  useEffect(() => {
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
      if(cancelled) return;

      balance.value = stars;
      max.value = limit;
      mine.value = already;
      anonymous.value = hidden;
      count.value = Math.max(1, Math.min(50, limit));
      loading.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [peerId, mid]);

  const tooPoor = useComputed(() => count.value > balance.value);

  async function send() {
    sending.value = true;
    error.value = '';
    try {
      // The anonymity choice is per message, so it is stored before the stars
      // are spent — afterwards the top-reactor entry already exists.
      if(mine.value) await setPaidReactionAnonymous(peerId, mid, anonymous.value);
      await sendPaidReaction(peerId, mid, count.value, anonymous.value);
      onsent();
      onclose();
    } catch(err: any) {
      error.value = err?.message || 'Could not send the star reaction';
    } finally {
      sending.value = false;
    }
  }

  return (
    <div class="sheet-backdrop" onClick={onclose} role="presentation">
      <div
        class="sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Send a star reaction"
      >
        <header>
          <strong>⭐ Star reaction</strong>
          <button onClick={onclose} aria-label="Close">✕</button>
        </header>

        {loading.value ?
          <p class="muted">Loading…</p> :
          <>
            <p class="muted">
              Your balance is {balance.value} ⭐{mine.value ? ` · you already sent ${mine.value}` : ''}
            </p>

            <div class="amount">
              <input
                type="range"
                min="1"
                max={max.value}
                value={count.value}
                onInput={(e) => (count.value = Number((e.target as HTMLInputElement).value))}
                aria-label="Stars to send"
              />
              <input
                type="number"
                min="1"
                max={max.value}
                value={count.value}
                onInput={(e) => (count.value = Number((e.target as HTMLInputElement).value))}
                aria-label="Stars to send"
              />
            </div>

            <label class="toggle">
              <input
                type="checkbox"
                checked={anonymous.value}
                onChange={(e) => (anonymous.value = (e.target as HTMLInputElement).checked)}
              />
              Hide me from the top senders
            </label>

            {tooPoor.value ?
              <p class="error">You do not have {count.value} stars.</p> :
              error.value ?
                <p class="error">{error.value}</p> :
                null}

            <div class="actions">
              <button onClick={onclose}>Cancel</button>
              <button class="primary" disabled={sending.value || tooPoor.value} onClick={send}>
                {sending.value ? 'Sending…' : `Send ${count.value} ⭐`}
              </button>
            </div>
          </>}
      </div>
    </div>
  );
}
