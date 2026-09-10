/*
 * Ported from svelte/src/lib/components/SendOptionsSheet.svelte.
 *
 * Two notes on the port:
 *  - `when`, `silent` and `remember` were seeded inside `untrack(() => …)` so
 *    that reading `defaultSilent` created no dependency. A `useSignal` initial
 *    value is only ever read at mount, so the seeds are plain expressions now.
 *  - `<svelte:window onkeydown={onKey}/>` is the `useEffect` at the end, which
 *    adds and removes the same listener.
 *
 * The Repeat row has no Svelte original — it is a post-port feature mirroring
 * upstream's picker (components/popups/scheduleSendingPopup.tsx). It reuses the
 * sheet's own `.pill` / `.pill.on` idiom, so no stylesheet change was needed.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  MIN_SCHEDULE_LEAD_SECONDS,
  REPEAT_PERIOD_OPTIONS,
  SEND_WHEN_ONLINE,
  setSilentByDefault
} from '$lib/telegram/sendOptions';
import {isPremium} from '$lib/telegram/reactions';

import './SendOptionsSheet.css';

/** Shown when a non-premium account tries to make a message repeat. */
const PREMIUM_HINT = 'Repeating messages need Telegram Premium.';

interface Props {
  peerId: number;
  /** "Send when online" only exists for a private chat. */
  isUser?: boolean;
  defaultSilent?: boolean;
  onsend: (options: {
    scheduleDate?: number;
    silent: boolean;
    /** Seconds between repeats; unset sends the message once. */
    scheduleRepeatPeriod?: number;
  }) => void;
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
  /** Seconds between repeats; 0 is "Never" and is never sent. */
  const repeat = useSignal(0);
  /**
   * Upstream gates the repeat period behind Premium in the picker itself and
   * the server enforces it, so the same gate lives here: it explains the locked
   * row instead of letting the API answer with PREMIUM_ACCOUNT_REQUIRED.
   * `null` is "not read yet" — the selection stays open then, so a premium
   * account is never blocked by a slow read, and a non-premium one is caught a
   * moment later by the same check the click runs.
   */
  const premium = useSignal<boolean | null>(null);
  const error = useSignal('');

  const minWhen = toLocalInput(new Date(Date.now() + MIN_SCHEDULE_LEAD_SECONDS * 1000));

  // Reads a manager cache through $lib/telegram/reactions, no request.
  useEffect(() => {
    let cancelled = false;
    isPremium().then((value) => {
      if(!cancelled) premium.value = value;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function pickRepeat(value: number) {
    if(value && premium.value === false) {
      error.value = PREMIUM_HINT;
      return;
    }
    if(error.value === PREMIUM_HINT) error.value = '';
    repeat.value = value;
  }

  function persist() {
    // Only write when the user asked us to remember, so a one-off silent send
    // does not quietly mute the chat forever.
    if(remember.value) setSilentByDefault(peerId, silent.value);
  }

  function sendNow() {
    persist();
    // Sending immediately ignores the repeat row: only a scheduled message can
    // repeat, so no period travels on this path.
    onsend({silent: silent.value});
  }

  function sendWhenOnline() {
    persist();
    // "When online" never repeats either — upstream passes no period here.
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
    onsend({
      scheduleDate: seconds,
      silent: silent.value,
      // 0 is "Never", which must reach the API as no period at all.
      scheduleRepeatPeriod: repeat.value || undefined
    });
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

        <div class="field">
          <span>Repeat{premium.value === false ? ' — needs Telegram Premium' : ''}</span>
          <div class="toggles">
            {REPEAT_PERIOD_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                class={['pill', repeat.value === option.value && 'on'].filter(Boolean).join(' ')}
                onClick={() => pickRepeat(option.value)}
                title={option.value ?
                  `Schedule this message again, ${option.label.toLowerCase()}` :
                  'Send this message once'}
              >{option.label}</button>
            ))}
          </div>
        </div>

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
