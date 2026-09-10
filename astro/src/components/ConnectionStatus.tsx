/*
 * Ported from svelte/src/lib/components/ConnectionStatus.svelte.
 *
 * The subscription `$effect` returned its unsubscribe function, which Svelte
 * called when the component was destroyed — the same shape as a `useEffect`
 * cleanup, so the subscribe/unsubscribe semantics are unchanged. The second
 * effect reads a signal, so it is a `useSignalEffect`; the timer cleanup it
 * returns runs before each re-run and on unmount.
 */
import {useEffect} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {CONNECTION_LABELS, subscribeConnection, type ConnectionState} from '$lib/telegram/connection';

import './ConnectionStatus.css';

export function ConnectionStatus() {
  const current = useSignal<ConnectionState>('connected');

  /* A healthy tab dips through 'connecting' on every reconnect, so showing the
     bar the instant the state changes makes it flicker on an otherwise fine
     connection. Only commit a non-connected state once it has held; going back
     to 'connected' is applied immediately. */
  const shown = useSignal<ConnectionState>('connected');

  useEffect(() => subscribeConnection((next) => (current.value = next)), []);

  useSignalEffect(() => {
    const next = current.value;

    if(next === 'connected') {
      shown.value = 'connected';
      return;
    }

    const timer = setTimeout(() => (shown.value = next), 1000);
    return () => clearTimeout(timer);
  });

  return shown.value === 'connected' ? null : (
    <div
      class={['connection', shown.value === 'waitingForNetwork' && 'offline'].filter(Boolean).join(' ')}
      role="status"
    >
      <span class="spinner"></span>
      <span>{CONNECTION_LABELS[shown.value]}</span>
    </div>
  );
}
