/*
 * Ported from svelte/src/lib/components/ReactionPicker.svelte.
 *
 * The two effects here differ in what they read, and that decides which hook
 * each one becomes: the loader depends on the `peerId` and `mid` *props*, so it
 * is a `useEffect` with both in its dependency list — `useSignalEffect` tracks
 * signal reads only and would never reload it for another message. The lazy
 * custom-emoji loader reads the `tab` and `custom` signals and nothing else, so
 * it is a `useSignalEffect`.
 *
 * `shown` derives from three signals, so it is a `useComputed` rather than a
 * value recomputed on every render.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {
  canEditChatReactions,
  customEmojiChoices,
  isPremium,
  quickReaction,
  reactionsForMessage,
  recentReactions,
  setQuickReaction,
  type ReactionOption
} from '$lib/telegram/reactions';

import {ChatReactionsSheet} from './ChatReactionsSheet';
import {ReactionSticker} from './ReactionSticker';

import './ReactionPicker.css';

interface Props {
  peerId: number;
  mid: number;
  x: number;
  y: number;
  onpick: (option: ReactionOption) => void;
  onpaid: () => void;
  onclose: () => void;
}

export function ReactionPicker({peerId, mid, x, y, onpick, onpaid, onclose}: Props) {
  const options = useSignal<ReactionOption[]>([]);
  const recent = useSignal<ReactionOption[]>([]);
  const custom = useSignal<ReactionOption[]>([]);
  const quickKey = useSignal('');
  const premium = useSignal(false);
  const allowsCustom = useSignal(false);
  const paidAvailable = useSignal(false);
  const atUniqCap = useSignal(false);
  const canEdit = useSignal(false);
  const loading = useSignal(true);
  const tab = useSignal<'reactions' | 'custom'>('reactions');
  const note = useSignal('');
  const adminOpen = useSignal(false);

  useEffect(() => {
    const currentPeerId = peerId;
    const currentMid = mid;
    let cancelled = false;

    (async() => {
      const [available, recentList, quick, isPro, editable] = await Promise.all([
        reactionsForMessage(currentPeerId, currentMid),
        recentReactions(),
        quickReaction(),
        isPremium(),
        canEditChatReactions(currentPeerId)
      ]);
      if(cancelled) return;

      options.value = available.options;
      allowsCustom.value = available.allowsCustom;
      paidAvailable.value = available.paidAvailable;
      atUniqCap.value = available.atUniqCap;
      // Anything the chat does not allow must not be offered as "recent".
      recent.value =
        available.mode === 'chatReactionsAll'
          ? recentList
          : recentList.filter((option) => options.value.some((allowed) => allowed.key === option.key));
      quickKey.value = quick?.key ?? '';
      premium.value = isPro;
      canEdit.value = editable;
      loading.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [peerId, mid]);

  // The custom tab is premium-only and pulls a lot of documents, so it loads
  // the first time it is actually opened.
  useSignalEffect(() => {
    if(tab.value !== 'custom' || custom.value.length) return;
    customEmojiChoices().then((list) => (custom.value = list));
  });

  async function makeDefault(option: ReactionOption) {
    try {
      await setQuickReaction(option);
      quickKey.value = option.key;
      note.value = `${option.emoticon || 'That reaction'} is now your quick reaction`;
    } catch(err) {
      note.value = 'Could not change the quick reaction';
    }
  }

  function contextMenu(event: MouseEvent, option: ReactionOption) {
    event.preventDefault();
    makeDefault(option);
  }

  const shown = useComputed(() =>
    tab.value === 'custom' ? custom.value : [...recent.value, ...options.value]
  );

  return (
    <>
      <div class="picker-backdrop" onClick={onclose} role="presentation"></div>

      <div
        class="reaction-picker"
        style={{left: `${Math.min(x, 640)}px`, top: `${y}px`}}
        role="dialog"
        aria-label="Pick a reaction"
      >
        {premium.value && allowsCustom.value && (
          <div class="tabs">
            <button
              class={[tab.value === 'reactions' && 'active'].filter(Boolean).join(' ')}
              onClick={() => (tab.value = 'reactions')}
            >Reactions</button>
            <button
              class={[tab.value === 'custom' && 'active'].filter(Boolean).join(' ')}
              onClick={() => (tab.value = 'custom')}
            >Custom</button>
          </div>
        )}

        {loading.value ?
          <p class="hint">Loading…</p> :
          !shown.value.length ?
            <p class="hint">
              {atUniqCap.value ? 'This message cannot take another kind of reaction.' : 'No reactions here.'}
            </p> :
            <div class="grid">
              {shown.value.map((option) => (
                <button
                  key={option.key}
                  class={['option', option.key === quickKey.value && 'quick'].filter(Boolean).join(' ')}
                  title={option.key === quickKey.value ? 'Your quick reaction' : 'Right-click to set as default'}
                  onClick={() => onpick(option)}
                  onContextMenu={(event) => contextMenu(event, option)}
                >
                  {option.iconDocId ?
                    <ReactionSticker docId={option.iconDocId} size={26} fallback={option.emoticon} /> :
                    <span class="plain">{option.emoticon}</span>}
                </button>
              ))}
            </div>}

        <footer>
          {paidAvailable.value && (
            <button class="row" onClick={onpaid}>⭐ Send a star reaction</button>
          )}
          {canEdit.value && (
            <button class="row" onClick={() => (adminOpen.value = true)}>Reactions in this chat…</button>
          )}
          <span class="hint">Right-click a reaction to make it your quick one.</span>
          {note.value && (
            <span class="note">{note.value}</span>
          )}
        </footer>
      </div>

      {adminOpen.value && (
        <ChatReactionsSheet peerId={peerId} onclose={() => (adminOpen.value = false)} />
      )}
    </>
  );
}
