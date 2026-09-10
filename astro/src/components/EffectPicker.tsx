/*
 * Ported from svelte/src/lib/components/EffectPicker.svelte.
 *
 * The `<svelte:window onkeydown={onKey} />` directive became a `useEffect` that
 * adds and removes the same listener, and the mount-time `$effect` that loads the
 * effects reads nothing reactive — so it is a `useEffect` with an empty dependency
 * list, kept cancellable in case the popover is closed before the load lands.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadEffects, type EffectItem} from '$lib/telegram/sendOptions';

import './EffectPicker.css';

interface Props {
  /** Currently armed effect id, '' for none. */
  selected?: string;
  onpick: (effectId: string, emoticon: string) => void;
  onclose: () => void;
}

export function EffectPicker({selected = '', onpick, onclose}: Props) {
  const effects = useSignal<EffectItem[]>([]);
  const loading = useSignal(true);
  const failed = useSignal(false);

  useEffect(() => {
    let cancelled = false;

    loadEffects()
    .then((list) => {
      if(cancelled) return;
      effects.value = list;
      loading.value = false;
    })
    .catch(() => {
      if(cancelled) return;
      failed.value = true;
      loading.value = false;
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onclose]);

  return (
    <div class="effect-popover">
      <div class="head">
        <span>Message effect</span>
        {selected && (
          <button type="button" class="clear" onClick={() => onpick('', '')}>Remove</button>
        )}
      </div>

      {loading.value ?
        <p class="muted">Loading effects…</p> :
        failed.value || !effects.value.length ?
          <p class="muted">No effects available.</p> :
          (
            <div class="grid">
              {effects.value.map((effect) => (
                <button
                  key={effect.id}
                  type="button"
                  class={['effect', effect.id === selected && 'on'].filter(Boolean).join(' ')}
                  title={effect.premiumRequired ? `${effect.emoticon} — Premium` : effect.emoticon}
                  onClick={() => onpick(effect.id, effect.emoticon)}
                >
                  <span class="emoticon">{effect.emoticon}</span>
                  {effect.premiumRequired && <span class="premium" aria-hidden="true">★</span>}
                </button>
              ))}
            </div>
          )}
    </div>
  );
}
