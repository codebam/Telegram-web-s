/*
 * Ported from svelte/src/lib/components/PeerPicker.svelte.
 *
 * `multi` and `filtered` were `$derived` over props as much as over state —
 * `dialogs`/`selectedIds` are props — so they stay plain `const`s recomputed on
 * each render: a `useComputed` only tracks signal reads and would never notice a
 * new dialog list (CONVERSION.md §4). Reading `query.value` while rendering them
 * is what re-renders the list on a keystroke.
 *
 * The `extras` snippet is a `ComponentChildren` prop here: a caller passes the
 * markup it used to wrap in `{#snippet extras()}`, and it renders where
 * `{@render extras()}` stood.
 */
import type {ComponentChildren} from 'preact';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import type {DialogItem} from '$lib/telegram/chats';

import './PeerPicker.css';

interface Props {
  title: string;
  dialogs: DialogItem[];
  /** In multi-select mode this toggles a target rather than committing it. */
  onpick: (peerId: number) => void;
  onclose: () => void;
  /**
   * Present — even empty — switches the picker to multi-select: rows carry a
   * checkmark and picking one keeps the dialog open.
   */
  selectedIds?: number[] | null;
  onconfirm?: () => void;
  confirmLabel?: string;
  /** Extra controls between the list and the buttons. */
  extras?: ComponentChildren;
}

export function PeerPicker({
  title,
  dialogs,
  onpick,
  onclose,
  selectedIds = null,
  onconfirm,
  confirmLabel = 'Send',
  extras
}: Props) {
  const multi = !!selectedIds;

  const query = useSignal('');

  const filtered = query.value.trim() ?
    dialogs.filter((d) => d.title.toLowerCase().includes(query.value.trim().toLowerCase())) :
    dialogs;

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>{title}</header>
        <input
          placeholder="Search"
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
        <div class="list">
          {filtered.map((dialog) => (
            <button
              class={['row', selectedIds?.includes(dialog.peerId) && 'picked'].filter(Boolean).join(' ')}
              key={dialog.peerId}
              onClick={() => onpick(dialog.peerId)}
            >
              <Avatar peerId={dialog.peerId} title={dialog.title} size={32} />
              <span class="name">{dialog.title}</span>
              {multi && (
                <span class="check">{selectedIds?.includes(dialog.peerId) ? '✓' : ''}</span>
              )}
            </button>
          ))}
          {!filtered.length && <p class="muted">No chats found.</p>}
        </div>
        {extras && <div class="extras">{extras}</div>}
        <footer>
          <button onClick={onclose}>Cancel</button>
          {onconfirm && (
            <button class="primary" disabled={!selectedIds?.length} onClick={onconfirm}>
              {confirmLabel}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
