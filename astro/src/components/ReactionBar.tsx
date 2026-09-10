/*
 * Ported from svelte/src/lib/components/ReactionBar.svelte.
 *
 * The `$effect` here reads *props* (`count`, `revision`, `peerId`, `mid`) as well
 * as signals, so it is a `useEffect` keyed on those props — `useSignalEffect`
 * tracks signal reads only and would never re-run when the bubble it belongs to
 * changes (CONVERSION.md §4).
 *
 * Everything Svelte kept in a plain `let` — `effectsOn`, `chosenKeys`,
 * `firstLoad`, `token`, `mountRevision`, `lastKey`, `burstTimer` — is a ref here:
 * a Preact body runs on every render, so a plain local would be reset each pass,
 * and these carry state across renders.
 *
 * The two guards in `refresh()` — before the fetch and after it — compared
 * against the props as they were at *that* moment, which Svelte always read as
 * current; a JSX closure sees the render that started the work, so the latest
 * `peerId`/`mid` are kept in refs, as in `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {ReactionSticker} from './ReactionSticker';
import {ReactorsPopup} from './ReactorsPopup';
import {
  messageReactions,
  onReactionsUpdate,
  reactionEffectsEnabled,
  sendReaction,
  type MessageReaction
} from '$lib/telegram/reactions';

import './ReactionBar.css';

interface Props {
  peerId: number;
  mid: number;
  /** Reactions the bubble already knows about — 0 keeps the bar quiet. */
  count?: number;
  /** Bumped by the chat when a reaction is sent from here. */
  revision?: number;
  canReact?: boolean;
  onopenstars: () => void;
  onerror?: (message: string) => void;
}

export function ReactionBar({
  peerId,
  mid,
  count = 0,
  revision = 0,
  canReact = true,
  onopenstars,
  onerror
}: Props) {
  const items = useSignal<MessageReaction[]>([]);
  const reactorsFor = useSignal<string | null>(null);
  /** The burst playing over the chip it belongs to, if any. */
  const burst = useSignal<{docId: string; key: string; token: number} | null>(null);
  /** Safety net: a burst whose animation never reports its last frame. */
  const burstTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const effectsOn = useRef(false);
  const chosenKeys = useRef(new Set<string>());
  const firstLoad = useRef(true);
  const token = useRef(0);

  // The running fetches compare their own props against the latest ones — see the
  // note at the top of the file.
  const latestPeerId = useRef(peerId);
  latestPeerId.current = peerId;
  const latestMid = useRef(mid);
  latestMid.current = mid;

  useEffect(() => {
    reactionEffectsEnabled().then((enabled) => (effectsOn.current = enabled));
  }, []);

  async function refresh() {
    const currentMid = mid;
    const currentPeerId = peerId;
    const next = await messageReactions(currentPeerId, currentMid);
    if(currentMid !== latestMid.current || currentPeerId !== latestPeerId.current) return;

    // A reaction that just became ours is the one worth celebrating — that way
    // the burst plays for the picker, a chip click and a double-tap alike.
    const added = next.find((item) => item.chosen && !chosenKeys.current.has(item.key));
    chosenKeys.current = new Set(next.filter((item) => item.chosen).map((item) => item.key));
    items.value = next;

    // around_animation is the burst; the select animation stands in for the
    // reactions that ship without one (custom emoji, mostly).
    const effect = added && (added.aroundDocId || added.selectDocId);
    if(!firstLoad.current && effect && effectsOn.current) {
      burst.value = {docId: effect, key: added.key, token: ++token.current};
      clearTimeout(burstTimer.current);
      burstTimer.current = setTimeout(() => (burst.value = null), 4000);
    }
    firstLoad.current = false;
  }

  /** Revision this bubble mounted with, so a later bump reads as "we acted". */
  const mountRevision = useRef(0);
  const lastKey = useRef('');

  useEffect(() => {
    // Reading these keeps the bar in step with the bubble it belongs to.
    const currentCount = count;
    const currentRevision = revision;

    let cancelled = false;
    // Only a different message starts over — a revision bump is our own send,
    // and forgetting what was chosen there would swallow the effect.
    const key = `${peerId}_${mid}`;
    if(key !== lastKey.current) {
      lastKey.current = key;
      firstLoad.current = true;
      chosenKeys.current = new Set();
      mountRevision.current = currentRevision;
    }

    // A message with no reactions costs no round trip until something happens
    // to it — a history screen is a hundred bubbles deep.
    if(currentCount || currentRevision !== mountRevision.current) {
      refresh().catch(() => {});
    } else {
      items.value = [];
      firstLoad.current = false;
    }

    let stop: (() => void) | undefined;
    onReactionsUpdate((updatedPeerId, updatedMid) => {
      if(cancelled || updatedPeerId !== latestPeerId.current || updatedMid !== latestMid.current) return;
      refresh().catch(() => {});
    }).then((off) => {
      if(cancelled) off();
      else stop = off;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [peerId, mid, count, revision]);

  async function toggle(item: MessageReaction) {
    if(item.kind === 'paid') {
      onopenstars();
      return;
    }
    if(!canReact) return;

    try {
      await sendReaction(peerId, mid, item);
      await refresh();
    } catch(err: any) {
      onerror?.(err?.message || 'Reaction failed');
    }
  }

  useEffect(() => () => clearTimeout(burstTimer.current), []);

  function showReactors(event: MouseEvent, key: string) {
    event.preventDefault();
    event.stopPropagation();
    reactorsFor.value = key;
  }

  return (
    <>
      <span class="reaction-bar">
        {items.value.map((item) => (
          <span key={item.key} class="slot">
            <button
              class={['chip', item.chosen && 'chosen', item.kind === 'paid' && 'paid'].filter(Boolean).join(' ')}
              onClick={() => toggle(item)}
              onContextMenu={(event) => showReactors(event, item.key)}
              title="Right-click to see who reacted"
            >
              {item.kind === 'paid' ?
                <span class="plain">⭐</span> :
                item.iconDocId ?
                  <ReactionSticker docId={item.iconDocId} size={16} fallback={item.emoticon} /> :
                  <span class="plain">{item.emoticon}</span>}
              <span class="count">{item.count}</span>
            </button>

            {burst.value && burst.value.key === item.key && (
              <span key={burst.value.token} class="burst" aria-hidden="true">
                <ReactionSticker
                  docId={burst.value.docId}
                  size={72}
                  loop={false}
                  onfinish={() => (burst.value = null)}
                />
              </span>
            )}
          </span>
        ))}

        {/* No "add a reaction" affordance here: like the official clients, reacting
            is reached by right-clicking (or long-pressing) the message. Only the
            chips for reactions that already exist live on the bubble. */}
      </span>

      {reactorsFor.value !== null && (
        <ReactorsPopup
          peerId={peerId}
          mid={mid}
          initialKey={reactorsFor.value}
          onclose={() => (reactorsFor.value = null)}
        />
      )}
    </>
  );
}
