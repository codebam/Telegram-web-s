/*
 * Ported from svelte/src/lib/components/ChatReactionsSheet.svelte.
 *
 * The `$effect` that loads the chat's settings reads the `peerId` *prop*, not a
 * signal, so it is a `useEffect` with `peerId` in its dependency list:
 * `useSignalEffect` tracks signal reads only and would never reload for another
 * chat. The three radio groups the original bound with `bind:group` are a
 * `checked` plus an `onChange` here.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  activeReactions,
  chatReactionsSettings,
  setChatReactions,
  type ChatReactionsMode,
  type ReactionOption
} from '$lib/telegram/reactions';

import {ReactionSticker} from './ReactionSticker';

import './ChatReactionsSheet.css';

interface Props {
  peerId: number;
  onclose: () => void;
}

export function ChatReactionsSheet({peerId, onclose}: Props) {
  const all = useSignal<ReactionOption[]>([]);
  const mode = useSignal<ChatReactionsMode>('none');
  const picked = useSignal<string[]>([]);
  const broadcast = useSignal(false);
  const loading = useSignal(true);
  const saving = useSignal(false);
  const error = useSignal('');

  useEffect(() => {
    const currentPeerId = peerId;
    let cancelled = false;

    (async() => {
      const [reactions, settings] = await Promise.all([
        activeReactions(),
        chatReactionsSettings(currentPeerId)
      ]);
      if(cancelled) return;

      all.value = reactions;
      mode.value = settings?.mode ?? 'none';
      picked.value = settings?.emoticons ?? [];
      broadcast.value = !!settings?.broadcast;
      loading.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [peerId]);

  function toggle(emoticon: string) {
    picked.value = picked.value.includes(emoticon) ?
      picked.value.filter((item) => item !== emoticon) :
      [...picked.value, emoticon];
    if(picked.value.length) mode.value = 'some';
  }

  async function save() {
    saving.value = true;
    error.value = '';
    try {
      await setChatReactions(peerId, mode.value, picked.value);
      onclose();
    } catch(err: any) {
      error.value = err?.message || 'Could not save the reactions';
    } finally {
      saving.value = false;
    }
  }

  return (
    <div class="sheet-backdrop" onClick={onclose} role="presentation">
      <div
        class="sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Reactions in this chat"
      >
        <header>
          <strong>Reactions in this chat</strong>
          <button onClick={onclose} aria-label="Close">✕</button>
        </header>

        {loading.value ?
          <p class="muted">Loading…</p> :
          <>
            <div class="modes">
              {!broadcast.value &&
                <label>
                  <input
                    type="radio"
                    value="all"
                    checked={mode.value === 'all'}
                    onChange={() => (mode.value = 'all')}
                  />
                  All reactions
                </label>}
              <label>
                <input
                  type="radio"
                  value="some"
                  checked={mode.value === 'some'}
                  onChange={() => (mode.value = 'some')}
                />
                Some reactions
              </label>
              <label>
                <input
                  type="radio"
                  value="none"
                  checked={mode.value === 'none'}
                  onChange={() => (mode.value = 'none')}
                />
                No reactions
              </label>
            </div>

            {mode.value === 'some' ?
              <>
                <div class="grid">
                  {all.value.map((option) => (
                    <button
                      key={option.key}
                      class={['option', picked.value.includes(option.emoticon) && 'on'].filter(Boolean).join(' ')}
                      onClick={() => toggle(option.emoticon)}
                      title={option.title}
                    >
                      {option.iconDocId ?
                        <ReactionSticker docId={option.iconDocId} size={26} fallback={option.emoticon} /> :
                        <span class="plain">{option.emoticon}</span>}
                    </button>
                  ))}
                </div>
                <p class="muted">Members can react with the reactions you picked. Picking none turns reactions off.</p>
              </> :
              mode.value === 'all' ?
                <p class="muted">Members can react with any reaction, including custom emoji.</p> :
                <p class="muted">Reactions are off for this chat.</p>}

            {error.value && <p class="error">{error.value}</p>}

            <div class="actions">
              <button onClick={onclose}>Cancel</button>
              <button class="primary" disabled={saving.value} onClick={save}>
                {saving.value ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>}
      </div>
    </div>
  );
}
