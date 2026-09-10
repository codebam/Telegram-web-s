/*
 * Ported from svelte/src/lib/components/ChecklistBubble.svelte.
 *
 * `optimistic` is a signal, and the derived list below is recomputed on each
 * render rather than through `useComputed`: it reads `checklist`, a prop, and a
 * computed over signals only would never notice the prop change (see
 * CONVERSION.md).
 */
import {useSignal} from '@preact/signals';

import {
  appendChecklistItems,
  completeChecklist,
  toggleChecklistItem,
  type ChecklistExtra
} from '$lib/telegram/messageTypes';

import './ChecklistBubble.css';

interface Props {
  peerId: number;
  mid: number;
  checklist: ChecklistExtra;
  onerror?: (message: string) => void;
}

export function ChecklistBubble({peerId, mid, checklist, onerror}: Props) {
  // Ticks apply immediately and the manager reconciles from the server, so the
  // checkbox must not wait for a round trip to move.
  const optimistic = useSignal<Record<number, boolean>>({});
  const appending = useSignal(false);
  const newItem = useSignal('');
  const busy = useSignal(false);

  const items = checklist.items.map((item) => ({...item, done: optimistic.value[item.id] ?? item.done}));
  const doneCount = items.filter((item) => item.done).length;
  const allDone = !!items.length && doneCount === items.length;

  async function toggle(id: number, done: boolean) {
    if(!checklist.canComplete) return;
    optimistic.value = {...optimistic.value, [id]: done};
    try {
      await toggleChecklistItem(peerId, mid, id, done);
    } catch(err: any) {
      optimistic.value = {...optimistic.value, [id]: !done};
      onerror?.(err?.message || 'Could not update the item');
    }
  }

  async function markAllDone() {
    if(busy.value) return;
    busy.value = true;
    const pending = items.filter((item) => !item.done);
    optimistic.value = pending.reduce((acc, item) => ({...acc, [item.id]: true}), optimistic.value);
    try {
      await completeChecklist(peerId, mid, checklist.items);
    } catch(err: any) {
      onerror?.(err?.message || 'Could not mark the list done');
    } finally {
      busy.value = false;
    }
  }

  async function append(e: SubmitEvent) {
    e.preventDefault();
    const text = newItem.value.trim();
    if(!text || busy.value) return;
    busy.value = true;
    try {
      await appendChecklistItems(peerId, mid, [text]);
      newItem.value = '';
      appending.value = false;
    } catch(err: any) {
      onerror?.(err?.message || err?.type || 'Could not add the item');
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="checklist">
      <span class="title">{checklist.title || 'Checklist'}</span>
      <span class="count">{doneCount} of {items.length} done</span>

      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <label class={item.done ? 'done' : ''}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={!checklist.canComplete}
                onChange={(e) => toggle(item.id, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span>{item.text}</span>
            </label>
          </li>
        ))}
      </ul>

      <div class="actions">
        {checklist.canComplete && !allDone ?
          <button onClick={markAllDone} disabled={busy.value}>Mark all done</button> : null}
        {checklist.canAppend && !appending.value ?
          <button onClick={() => (appending.value = true)}>Add item</button> : null}
      </div>

      {appending.value ?
        <form onSubmit={append}>
          {/* `autofocus` is deliberate: this field is only rendered after the
              user asked for it, by clicking "Add item". */}
          <input
            placeholder="New item"
            value={newItem.value}
            onInput={(e) => (newItem.value = (e.target as HTMLInputElement).value)}
            autofocus
          />
          <button type="submit" disabled={busy.value || !newItem.value.trim()}>Add</button>
          <button type="button" onClick={() => { appending.value = false; newItem.value = ''; }}>Cancel</button>
        </form> : null}
    </div>
  );
}
