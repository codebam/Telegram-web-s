/*
 * A new Astro-only pane (no Svelte original): delete a basic group's messages
 * by date range. Telegram's `channels.deleteHistory` carries no date bounds, so
 * a channel or supergroup gets the per-member delete in `ChatAdminMembers`
 * instead and this section is not offered for it.
 */
import {useSignal} from '@preact/signals';

import {dayBounds, deleteMessagesByDate, type AdminChat} from '$lib/telegram/admin';

interface Props {
  chat: AdminChat;
  onchanged: () => void;
}

export function ChatAdminDelete({chat, onchanged}: Props) {
  const from = useSignal('');
  const to = useSignal('');
  const busy = useSignal(false);
  const error = useSignal('');
  const status = useSignal('');

  const canDelete = !!from.value && !!to.value && from.value <= to.value;

  async function remove() {
    const start = dayBounds(from.value);
    const end = dayBounds(to.value);
    if(!start || !end || busy.value) return;

    if(!confirm(`Delete every message sent between ${from.value} and ${to.value}? This cannot be undone.`)) {
      return;
    }

    busy.value = true;
    error.value = '';
    try {
      await deleteMessagesByDate(chat.peerId, start.minDate, end.maxDate);
      status.value = 'Messages deleted';
      onchanged();
    } catch (err: any) {
      error.value = err?.type || err?.message || 'Failed to delete the messages';
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="pane">
      <p class="admin-hint">
        Delete this group's messages in a date range, for everyone. The range is inclusive.
      </p>

      <label class="admin-field">
        <span>From</span>
        <input
          type="date"
          value={from.value}
          max={to.value || undefined}
          onInput={(e) => (from.value = (e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="admin-field">
        <span>To</span>
        <input
          type="date"
          value={to.value}
          min={from.value || undefined}
          onInput={(e) => (to.value = (e.target as HTMLInputElement).value)}
        />
      </label>

      <div class="admin-actions left">
        <button class="admin-btn danger" onClick={remove} disabled={!canDelete || busy.value}>
          {busy.value ? 'Deleting…' : 'Delete messages'}
        </button>
      </div>

      {error.value && <p class="admin-error">{error.value}</p>}
      {status.value && <p class="admin-ok">{status.value}</p>}
    </div>
  );
}
