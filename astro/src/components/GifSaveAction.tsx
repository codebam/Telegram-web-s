/*
 * Ported from svelte/src/lib/components/GifSaveAction.svelte.
 *
 * The `$effect` reads the `docId` *prop*, so it becomes a `useEffect` with
 * `docId` in its dependency list — `useSignalEffect` tracks signal reads only and
 * would never re-run when the menu is opened on another GIF.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {savedGifIds, toggleSavedGif} from '$lib/telegram/stickers';

interface Props {
  docId: string;
  ondone?: () => void;
}

export function GifSaveAction({docId, ondone}: Props) {
  const saved = useSignal(false);
  const busy = useSignal(false);

  useEffect(() => {
    const id = docId;
    let cancelled = false;
    savedGifIds()
      .then((ids) => {
        if(!cancelled) saved.value = ids.has(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId]);

  async function toggle() {
    if(busy.value) return;
    busy.value = true;
    try {
      await toggleSavedGif(docId, !saved.value);
      saved.value = !saved.value;
    } catch (err) {
      // The limit or a lost reference — nothing worth blocking the menu for.
    } finally {
      busy.value = false;
      ondone?.();
    }
  }

  return <button onClick={toggle} disabled={busy.value}>{saved.value ? 'Remove GIF' : 'Save GIF'}</button>;
}
