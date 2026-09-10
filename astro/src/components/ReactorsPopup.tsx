/*
 * Ported from svelte/src/lib/components/ReactorsPopup.svelte.
 *
 * The `$effect` that loads the reactors reads the `peerId`/`mid` *props*, so it
 * becomes a `useEffect` with both in its dependency list — `useSignalEffect` only
 * tracks signal reads and would never reload for another message. `tabs` and
 * `shown` are `$derived` over the `reactors` signal, so they stay `useComputed`.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {
  canSeeReactors,
  messageReactors,
  parseReactionKey,
  reactionOptions,
  type Reactor,
  type ReactionOption
} from '$lib/telegram/reactions';

import {ReactionSticker} from './ReactionSticker';

import './ReactorsPopup.css';

interface Props {
  peerId: number;
  mid: number;
  /** Reaction tab to open on, '' for "all". */
  initialKey?: string;
  onclose: () => void;
}

export function ReactorsPopup({peerId, mid, initialKey = '', onclose}: Props) {
  const reactors = useSignal<Reactor[]>([]);
  const icons = useSignal<ReactionOption[]>([]);
  const tab = useSignal(initialKey);
  const loading = useSignal(true);
  const visible = useSignal(true);

  useEffect(() => {
    const currentPeerId = peerId;
    const currentMid = mid;
    let cancelled = false;

    (async() => {
      const allowed = await canSeeReactors(currentPeerId, currentMid);
      if(cancelled) return;
      visible.value = allowed;
      if(!allowed) {
        loading.value = false;
        return;
      }

      const list = await messageReactors(currentPeerId, currentMid);
      if(cancelled) return;

      reactors.value = list;
      const refs = Array.from(new Set(list.map((reactor) => reactor.reactionKey)))
      .map(parseReactionKey)
      .filter(Boolean);
      icons.value = await reactionOptions(refs as any);
      loading.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [peerId, mid]);

  const tabs = useComputed(() =>
    Array.from(new Set(reactors.value.map((reactor) => reactor.reactionKey).filter(Boolean)))
  );
  const shown = useComputed(() =>
    tab.value ? reactors.value.filter((reactor) => reactor.reactionKey === tab.value) : reactors.value
  );

  function iconOf(key: string): ReactionOption | undefined {
    return icons.value.find((option) => option.key === key);
  }

  function countOf(key: string): number {
    return reactors.value.filter((reactor) => reactor.reactionKey === key).length;
  }

  return (
    <div class="reactors-backdrop" onClick={onclose} role="presentation">
      <div
        class="reactors-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="People who reacted"
      >
        <header>
          <strong>Reactions</strong>
          <button onClick={onclose} aria-label="Close">✕</button>
        </header>

        {loading.value ?
          <p class="muted">Loading…</p> :
          !visible.value ?
            <p class="muted">The reaction list is unavailable for this message.</p> :
            !reactors.value.length ?
              <p class="muted">Nobody has reacted yet.</p> :
              <>
                {tabs.value.length > 1 &&
                  <div class="tabs">
                    <button
                      class={tab.value === '' ? 'active' : ''}
                      onClick={() => (tab.value = '')}
                    >All {reactors.value.length}</button>
                    {tabs.value.map((key) => {
                      const option = iconOf(key);

                      return (
                        <button
                          key={key}
                          class={tab.value === key ? 'active' : ''}
                          onClick={() => (tab.value = key)}
                        >
                          {option?.iconDocId ?
                            <ReactionSticker docId={option.iconDocId} size={18} fallback={option.emoticon} /> :
                            <span class="plain">{option?.emoticon || '⭐'}</span>}
                          {countOf(key)}
                        </button>
                      );
                    })}
                  </div>}

                <ul>
                  {shown.value.map((reactor) => {
                    const option = iconOf(reactor.reactionKey);

                    return (
                      <li key={`${reactor.peerId}_${reactor.reactionKey}`}>
                        <span class="who">{reactor.title}</span>
                        {option?.iconDocId ?
                          <ReactionSticker docId={option.iconDocId} size={18} fallback={reactor.emoticon} /> :
                          <span class="plain">{reactor.emoticon}</span>}
                      </li>
                    );
                  })}
                </ul>
              </>}
      </div>
    </div>
  );
}
