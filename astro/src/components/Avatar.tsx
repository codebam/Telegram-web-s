/*
 * Ported from svelte/src/lib/components/Avatar.svelte.
 *
 * Two details worth knowing for the rest of the conversion:
 *  - `const retry = staleUrlRetry()` sat in the component body, which Svelte runs
 *    once per instance. A Preact body runs on every render, so it is memoised —
 *    otherwise the retry budget would reset on each pass.
 *  - the `$effect` here depends on a *prop*, not a signal, so it becomes a
 *    `useEffect` with `peerId` in the dependency list. `useSignalEffect` only
 *    tracks signal reads and would never re-run.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {invalidateAvatarUrl, loadAvatarUrl} from '$lib/telegram/chats';
import {staleUrlRetry} from '$lib/telegram/staleUrl';

import './Avatar.css';

interface Props {
  peerId: number;
  title: string;
  size?: number;
}

export function Avatar({peerId, title, size = 42}: Props) {
  const url = useSignal<string | null>(null);
  const retry = useMemo(() => staleUrlRetry(), []);

  // Svelte read `peerId` inside the async callback and always saw the current
  // peer; a closure in JSX would see the value from the render that started the
  // load, so the latest one is kept in a ref.
  const currentPeerId = useRef(peerId);
  currentPeerId.current = peerId;

  function resolve(id: number) {
    loadAvatarUrl(id).then((resolved) => {
      if(id === currentPeerId.current) url.value = resolved;
    });
  }

  // Re-resolve whenever the peer changes; a peer with no photo stays on the
  // initial-letter fallback.
  useEffect(() => {
    const id = peerId;
    url.value = null;
    retry.reset();
    resolve(id);
  }, [peerId]);

  /** The URL went stale — the worker revoked it. Ask for a fresh one. */
  function reload() {
    if(!retry.shouldRetry()) {
      url.value = null;
      return;
    }

    const id = peerId;
    invalidateAvatarUrl(id);
    url.value = null;
    resolve(id);
  }

  return (
    <span
      class="avatar"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size / 2.4)}px`,
        borderRadius: `${Math.max(6, Math.round(size / 2.8))}px`
      }}
    >
      {url.value ?
        <img src={url.value} alt="" onError={reload} /> :
        title.slice(0, 1).toUpperCase()}
    </span>
  );
}
