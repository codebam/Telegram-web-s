/*
 * Ported from svelte/src/lib/components/ChatAdminPermissions.svelte.
 *
 * `keys` and `dirty` were `$derived` over props, so they stay plain `const`s
 * recomputed on each render — a `useComputed` only tracks signal reads and would
 * never see `chat` change (CONVERSION.md §4). Reading `permissions.value` while
 * rendering them is what re-renders the pane after a toggle.
 */
import {useSignal} from '@preact/signals';

import {
  PERMISSION_LABELS,
  PERMISSION_ORDER,
  SLOW_MODE_OPTIONS,
  saveDefaultPermissions,
  setSlowMode,
  type AdminChat,
  type PermissionKey,
  type Permissions
} from '$lib/telegram/admin';

import './ChatAdminPermissions.css';

interface Props {
  chat: AdminChat;
  onchanged: () => void;
}

export function ChatAdminPermissions({chat, onchanged}: Props) {
  // A plain object rather than reactive state field-by-field: the whole thing is
  // handed back to the worker on save, and nothing reactive would survive
  // structured cloning.
  const permissions = useSignal<Permissions>({...chat.permissions});
  const slowMode = useSignal(chat.slowModeSeconds);

  const busy = useSignal(false);
  const error = useSignal('');
  const status = useSignal('');

  // Topics only exist in a forum, so hide the switch that would do nothing.
  const keys = PERMISSION_ORDER.filter((key) => key !== 'topics' || chat.isForum);

  const dirty = keys.some((key) => permissions.value[key] !== chat.permissions[key]);

  function toggle(key: PermissionKey) {
    permissions.value = {...permissions.value, [key]: !permissions.value[key]};
  }

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  async function save() {
    if(busy.value || !dirty) return;
    busy.value = true;
    error.value = '';

    try {
      // Copy before it crosses into the worker: only plain, structured-cloneable
      // values survive the trip.
      await saveDefaultPermissions(chat.peerId, {...permissions.value});
      flash('Permissions saved');
      onchanged();
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to save permissions';
    } finally {
      busy.value = false;
    }
  }

  async function pickSlowMode(seconds: number) {
    if(busy.value || seconds === slowMode.value) return;
    const previous = slowMode.value;
    slowMode.value = seconds;
    busy.value = true;
    error.value = '';

    try {
      await setSlowMode(chat.peerId, seconds);
      onchanged();
    } catch(err: any) {
      slowMode.value = previous;
      error.value = err?.type || err?.message || 'Failed to set slow mode';
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="pane">
      <p class="admin-label">What members can do</p>

      {keys.map((key) => (
        <label key={key} class="admin-toggle">
          <input type="checkbox" checked={permissions.value[key]} onChange={() => toggle(key)} disabled={busy.value} />
          <span>{PERMISSION_LABELS[key]}</span>
        </label>
      ))}

      <div class="admin-actions">
        <button class="admin-btn primary" onClick={save} disabled={busy.value || !dirty}>
          {busy.value ? 'Saving…' : 'Save'}
        </button>
      </div>

      {!chat.isBasicGroup && (
        <section>
          <p class="admin-label">Slow mode</p>
          <p class="admin-hint">How long a member must wait between messages.</p>
          <div class="chips">
            {/* `class:on={…}` became one class string — an empty string rather
                than a gap, so no stray space ends up in the attribute. */}
            {SLOW_MODE_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                class={[slowMode.value === option.seconds && 'on'].filter(Boolean).join(' ')}
                onClick={() => pickSlowMode(option.seconds)}
                disabled={busy.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {error.value && <p class="admin-error">{error.value}</p>}
      {status.value && <p class="admin-ok">{status.value}</p>}
    </div>
  );
}
