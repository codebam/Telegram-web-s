/*
 * Ported from svelte/src/lib/components/SendOptionsSheet.svelte.
 *
 * Two notes on the port:
 *  - `when`, `silent` and `remember` were seeded inside `untrack(() => …)` so
 *    that reading `defaultSilent` created no dependency. A `useSignal` initial
 *    value is only ever read at mount, so the seeds are plain expressions now.
 *  - `<svelte:window onkeydown={onKey}/>` is the `useEffect` at the end, which
 *    adds and removes the same listener.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  MIN_SCHEDULE_LEAD_SECONDS,
  SEND_WHEN_ONLINE,
  setSilentByDefault
} from '$lib/telegram/sendOptions';

import './SendOptionsSheet.css';

interface Props {
  peerId: number;
  /** "Send when online" only exists for a private chat. */
  isUser?: boolean;
  defaultSilent?: boolean;
  onsend: (options: {scheduleDate?: number; silent: boolean}) => void;
  onclose: () => void;
}

export function SendOptionsSheet({
  peerId,
  isUser = false,
  defaultSilent = false,
  onsend,
  onclose
}: Props) {
  /** `datetime-local` wants a local-time string with no zone suffix. */
  function toLocalInput(date: Date) {
    const pad = (value: number) => `${value}`.padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  // Seeded once: an hour out is the default the official clients offer.
  const when = useSignal(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  const silent = useSignal(defaultSilent);
  const remember = useSignal(defaultSilent);
  const error = useSignal('');

  const minWhen = toLocalInput(new Date(Date.now() + MIN_SCHEDULE_LEAD_SECONDS * 1000));

  function persist() {
    // Only write when the user asked us to remember, so a one-off silent send
    // does not quietly mute the chat forever.
    if(remember.value) setSilentByDefault(peerId, silent.value);
  }

  function sendNow() {
    persist();
    onsend({silent: silent.value});
  }

  function sendWhenOnline() {
    persist();
    onsend({scheduleDate: SEND_WHEN_ONLINE, silent: silent.value});
  }

  function schedule() {
    const at = new Date(when.value);
    const seconds = Math.floor(at.getTime() / 1000);
    if(!seconds || Number.isNaN(seconds)) {
      error.value = 'Pick a date and time.';
      return;
    }
    if(seconds <= Math.floor(Date.now() / 1000) + MIN_SCHEDULE_LEAD_SECONDS) {
      error.value = 'Pick a time at least a few seconds from now.';
      return;
    }
    persist();
    onsend({scheduleDate: seconds, silent: silent.value});
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
  }

  // The original listened through <svelte:window>; the same listener is added
  // and removed here.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onclose]);

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>Send when…</header>

        <label class="field">
          <span>Date and time</span>
          <input
            type="datetime-local"
            value={when.value}
            min={minWhen}
            onInput={(e) => (when.value = (e.target as HTMLInputElement).value)}
          />
        </label>

        <div class="toggles">
          <button
            type="button"
            class={['pill', silent.value && 'on'].filter(Boolean).join(' ')}
            onClick={() => (silent.value = !silent.value)}
            title="The recipients get no notification sound"
          >Send without sound</button>
          <label class="remember">
            <input
              type="checkbox"
              checked={remember.value}
              onChange={(e) => (remember.value = (e.target as HTMLInputElement).checked)}
            />
            Remember for this chat
          </label>
        </div>

        {error.value && (
          <p class="error">{error.value}</p>
        )}

        <footer>
          <button type="button" onClick={onclose}>Cancel</button>
          <button type="button" onClick={sendNow}>Send now</button>
          {isUser && (
            <button type="button" onClick={sendWhenOnline}>Send when online</button>
          )}
          <button type="button" class="primary" onClick={schedule}>Schedule</button>
        </footer>
      </div>
    </div>
  );
}
