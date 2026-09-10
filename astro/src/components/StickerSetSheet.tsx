/*
 * Ported from svelte/src/lib/components/StickerSetSheet.svelte.
 *
 * The loader depends on the `setKey` and `docId` *props*, so it is a
 * `useEffect` with both in its dependency list: `useSignalEffect` tracks signal
 * reads only and would never reopen the sheet for another set. The `cancelled`
 * flag is what stops a slow response for the previous set from overwriting the
 * current one.
 *
 * `preview` holds a whole `StickerSetPreview`; its nested fields are never
 * written in place — `toggle` rebuilds the value — because a signal notifies
 * only when the signal itself is assigned.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  loadSetPreview,
  stickerSetOfDoc,
  toggleSetInstalled,
  type StickerSetPreview
} from '$lib/telegram/stickers';

import {Sticker} from './Sticker';

import './StickerSetSheet.css';

interface Props {
  /** Set id, short name or the short name out of a t.me/addstickers link. */
  setKey?: string;
  /** A sticker's document id — opens the pack that sticker belongs to. */
  docId?: string;
  onsend?: (docId: string) => void;
  onclose: () => void;
}

export function StickerSetSheet({setKey = '', docId = '', onsend, onclose}: Props) {
  const preview = useSignal<StickerSetPreview | null>(null);
  const loading = useSignal(true);
  const busy = useSignal(false);
  const error = useSignal('');

  useEffect(() => {
    const key = setKey;
    const doc = docId;
    let cancelled = false;

    loading.value = true;
    error.value = '';
    (doc ? stickerSetOfDoc(doc) : loadSetPreview(key))
      .then((result) => {
        if(cancelled) return;
        preview.value = result;
        if(!result) error.value = 'Sticker set not found';
      })
      .catch((err: any) => {
        if(!cancelled) error.value = err?.type || err?.message || 'Failed to open the set';
      })
      .finally(() => {
        if(!cancelled) loading.value = false;
      });

    return () => {
      cancelled = true;
    };
  }, [setKey, docId]);

  async function toggle() {
    if(!preview.value || busy.value) return;
    busy.value = true;
    try {
      const installed = await toggleSetInstalled(preview.value.info.id);
      preview.value = {...preview.value, info: {...preview.value.info, installed, archived: false}};
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to update the set';
    } finally {
      busy.value = false;
    }
  }

  return (
    <>
      <div class="backdrop" onClick={onclose} role="presentation"></div>
      <div class="sheet">
        <header>
          <strong>{preview.value?.info.title || 'Sticker set'}</strong>
          <button class="close" onClick={onclose} aria-label="Close">✕</button>
        </header>

        <div class="body">
          {loading.value ?
            <p class="muted">Loading…</p> :
            error.value ?
              <p class="muted">{error.value}</p> :
              preview.value ?
                <div class="grid">
                  {preview.value.stickers.map((sticker) => (
                    <button
                      key={sticker.docId}
                      class="tile"
                      onClick={() => {
                        onsend?.(sticker.docId);
                        onclose();
                      }}
                    >
                      <Sticker sticker={sticker} size={72} />
                    </button>
                  ))}
                </div> :
                null}
        </div>

        {preview.value && (
          <footer>
            <button class="primary" onClick={toggle} disabled={busy.value}>
              {preview.value.info.installed ? 'Remove stickers' : `Add ${preview.value.info.count || ''} stickers`.trim()}
            </button>
          </footer>
        )}
      </div>
    </>
  );
}
