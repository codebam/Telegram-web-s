/*
 * Ported from svelte/src/lib/components/SendAsPicker.svelte.
 *
 * Both effects read props only — the peer the picker was opened for, and the
 * `onclose` handler — so they are `useEffect`s with those in their dependency
 * lists (`useSignalEffect` tracks signal reads only). The second one is the
 * port of the `<svelte:window onkeydown>` binding: it adds and removes the same
 * listener, so Escape still closes the popover and nothing is left behind.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {loadSendAsOptions, saveSendAs, type SendAsOption} from '$lib/telegram/sendOptions';

import './SendAsPicker.css';

interface Props {
  peerId: number;
  /** Peer we currently post as, null when posting as ourselves. */
  current?: number | null;
  onpick: (sendAsPeerId: number) => void;
  onclose: () => void;
}

export function SendAsPicker({peerId, current = null, onpick, onclose}: Props) {
  const options = useSignal<SendAsOption[]>([]);
  const loading = useSignal(true);

  // The list is only fetched when the picker opens: channels.getSendAs is a
  // real round trip and must never sit on the chat-open path.
  useEffect(() => {
    const active = peerId;
    let cancelled = false;

    loadSendAsOptions(active)
    .then((list) => {
      if(cancelled) return;
      options.value = list;
      loading.value = false;
    })
    .catch(() => {
      if(cancelled) return;
      loading.value = false;
    });

    return () => {
      cancelled = true;
    };
  }, [peerId]);

  function pick(option: SendAsOption) {
    onpick(option.peerId);
    saveSendAs(peerId, option.peerId).catch(() => {});
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onclose]);

  return (
    <div class="send-as-popover">
      <span class="head">Send message as…</span>

      {loading.value ?
        <p class="muted">Loading…</p> :
        !options.value.length ?
          <p class="muted">No other identity available.</p> :
          options.value.map((option) => (
            <button
              type="button"
              class={['option', option.peerId === current && 'on'].filter(Boolean).join(' ')}
              key={option.peerId}
              onClick={() => pick(option)}
              disabled={option.premiumRequired}
              title={option.premiumRequired ? 'Requires Telegram Premium' : option.title}
            >
              <Avatar peerId={option.peerId} title={option.title} size={28} />
              <span class="title">{option.title}</span>
            </button>
          ))}
    </div>
  );
}
