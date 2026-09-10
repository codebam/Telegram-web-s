/*
 * Ported from svelte/src/lib/components/EmojiStatus.svelte.
 *
 * The effect reads the `peerId` prop rather than a signal, so it is a `useEffect`
 * with `peerId` in its dependency list — a `useSignalEffect` would never re-run
 * for the next peer.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {CustomEmoji} from './CustomEmoji';
import {loadEmojiStatus} from '$lib/telegram/emoji';

interface Props {
  peerId: number;
  size?: number;
}

export function EmojiStatus({peerId, size = 16}: Props) {
  const docId = useSignal('');

  // The peer is already cached by the time a name is on screen, so this costs
  // no round-trip; peers without a status simply render nothing.
  useEffect(() => {
    const id = peerId;
    let cancelled = false;
    docId.value = '';

    loadEmojiStatus(id).then((resolved) => {
      if(!cancelled) docId.value = resolved;
    });

    return () => {
      cancelled = true;
    };
  }, [peerId]);

  return docId.value ? <CustomEmoji docId={docId.value} size={size} animate={false} /> : null;
}
