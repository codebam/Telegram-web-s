/*
 * Ported from svelte/src/lib/components/ScheduledMessages.svelte.
 *
 * Two notes on the port:
 *  - the `$effect` reads the `peerId` *prop* (and writes signals), so it becomes
 *    a `useEffect` with `peerId` in its dependency list — `useSignalEffect` only
 *    tracks signal reads and would never reload the queue for another chat;
 *  - `<svelte:window onkeydown={onKey}/>` is the `useEffect` at the end, which
 *    adds and removes the same listener.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Glyph} from './Glyph';
import {
  SEND_WHEN_ONLINE,
  deleteScheduled,
  editScheduled,
  loadScheduled,
  onScheduledUpdate,
  sendScheduledNow,
  type ScheduledItem
} from '$lib/telegram/sendOptions';

import './ScheduledMessages.css';

interface Props {
  peerId: number;
  title?: string;
  onclose: () => void;
}

export function ScheduledMessages({peerId, title = '', onclose}: Props) {
  const items = useSignal<ScheduledItem[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');
  /** mid of the row being rewritten, null when nothing is open for editing. */
  const editingMid = useSignal<number | null>(null);
  const editingText = useSignal('');
  const busy = useSignal(false);

  async function refresh() {
    try {
      items.value = await loadScheduled(peerId);
      error.value = '';
    } catch(err: any) {
      error.value = err?.message ?? 'Could not load scheduled messages';
    } finally {
      loading.value = false;
    }
  }

  useEffect(() => {
    const active = peerId;
    loading.value = true;
    refresh();

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onScheduledUpdate((updatedPeerId) => {
      if(!cancelled && updatedPeerId === active) refresh();
    }).then((off) => {
      if(cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [peerId]);

  function whenText(item: ScheduledItem) {
    if(item.whenOnline || item.date === SEND_WHEN_ONLINE) return 'When the recipient is online';
    return new Date(item.date * 1000).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function run(action: () => Promise<void>) {
    if(busy.value) return;
    busy.value = true;
    try {
      await action();
      await refresh();
    } catch(err: any) {
      error.value = err?.message ?? 'Action failed';
    } finally {
      busy.value = false;
    }
  }

  function startEdit(item: ScheduledItem) {
    editingMid.value = item.mid;
    editingText.value = item.text;
  }

  function saveEdit() {
    const mid = editingMid.value;
    const text = editingText.value.trim();
    if(mid === null || !text) return;
    editingMid.value = null;
    run(() => editScheduled(peerId, mid, text));
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') {
      if(editingMid.value !== null) editingMid.value = null;
      else onclose();
    }
  }

  // The original listened through <svelte:window>; the same listener is added
  // and removed here.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onclose]);

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="panel" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>
          <span>Scheduled messages{title ? ` · ${title}` : ''}</span>
          <button type="button" class="close" onClick={onclose} aria-label="Close">
            <Glyph name="close" size={14} />
          </button>
        </header>

        {error.value ?
          <p class="error">{error.value}</p> :
          null}

        {loading.value ?
          <p class="muted">Loading…</p> :
          !items.value.length ?
            <p class="muted">Nothing is scheduled in this chat.</p> :
            <>
              <div class="list">
                {items.value.map((item) => (
                  <div class="row" key={item.mid}>
                    <span class="when">{whenText(item)}{item.silent ? ' · silent' : ''}</span>

                    {editingMid.value === item.mid ?
                      <>
                        <textarea
                          class="edit"
                          rows={2}
                          value={editingText.value}
                          onInput={(e) => (editingText.value = (e.target as HTMLTextAreaElement).value)}
                        ></textarea>
                        <div class="actions">
                          <button type="button" onClick={() => (editingMid.value = null)}>Cancel</button>
                          <button type="button" class="primary" onClick={saveEdit} disabled={busy.value}>Save</button>
                        </div>
                      </> :
                      <>
                        <span class="text">
                          {item.text || item.mediaLabel || 'Message'}
                        </span>
                        <div class="actions">
                          <button type="button" onClick={() => startEdit(item)} disabled={!item.text || busy.value}>
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => run(() => sendScheduledNow(peerId, [item.mid]))}
                            disabled={busy.value}
                          >Send now</button>
                          <button
                            type="button"
                            class="danger"
                            onClick={() => run(() => deleteScheduled(peerId, [item.mid]))}
                            disabled={busy.value}
                          >Delete</button>
                        </div>
                      </>}
                  </div>
                ))}
              </div>

              <footer>
                <button
                  type="button"
                  onClick={() => run(() => sendScheduledNow(peerId, items.value.map((item) => item.mid)))}
                  disabled={busy.value}
                >Send all now</button>
                <button
                  type="button"
                  class="danger"
                  onClick={() => run(() => deleteScheduled(peerId, items.value.map((item) => item.mid)))}
                  disabled={busy.value}
                >Delete all</button>
              </footer>
            </>}
      </div>
    </div>
  );
}
