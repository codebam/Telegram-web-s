/*
 * Ported from svelte/src/lib/components/ChatAdminMembers.svelte.
 *
 * Two conversion subtleties:
 *  - the `$effect` tracked the props `chat.peerId`/`mode` *and* the `reload`
 *    signal, so it is a `useEffect` keyed on all three — `useSignalEffect` tracks
 *    signal reads only and would never notice a different chat being opened;
 *  - the guarded assignment inside `.then()` compared against the props as they
 *    were when the fetch was *started*, which Svelte always read as current. A
 *    JSX closure sees the render that started the load, so the latest values are
 *    kept in refs, as in `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  ALL_ALLOWED,
  PERMISSION_LABELS,
  PERMISSION_ORDER,
  RESTRICTION_DURATIONS,
  adminRightKeysFor,
  adminRightLabel,
  banMember,
  deleteMessagesFromUser,
  demoteAdmin,
  formatExpiry,
  loadAdmins,
  loadMembers,
  loadRemovedUsers,
  loadRestrictedUsers,
  promoteMember,
  restrictMember,
  unbanMember,
  untilDateFrom,
  type AdminChat,
  type AdminRightKey,
  type AdminRights,
  type Participant,
  type PermissionKey,
  type Permissions
} from '$lib/telegram/admin';

import './ChatAdminMembers.css';

interface Props {
  chat: AdminChat;
  /** admins: the admin list. members: everyone. removed: banned + restricted. */
  mode: 'admins' | 'members' | 'removed';
  onchanged: () => void;
  onpeer?: (peerId: number) => void;
}

export function ChatAdminMembers({chat, mode, onchanged, onpeer}: Props) {
  const list = useSignal<Participant[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');
  const busy = useSignal(false);
  const query = useSignal('');

  // The two editors are mutually exclusive and replace the list while open.
  const promoting = useSignal<Participant | null>(null);
  const rights = useSignal<AdminRights>({});
  const rank = useSignal('');

  const restricting = useSignal<Participant | null>(null);
  const permissions = useSignal<Permissions>({...ALL_ALLOWED});
  const duration = useSignal(0);

  const reload = useSignal(0);

  // The running fetch compares its own props against the latest ones — see the
  // note at the top of the file.
  const currentPeerId = useRef(chat.peerId);
  currentPeerId.current = chat.peerId;
  const currentMode = useRef(mode);
  currentMode.current = mode;

  useEffect(() => {
    const peerId = chat.peerId;
    const which = mode;
    loading.value = true;
    error.value = '';

    fetchList(peerId, which)
      .then((loaded) => {
        if(peerId === currentPeerId.current && which === currentMode.current) list.value = loaded;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load the list'))
      .finally(() => (loading.value = false));
  }, [chat.peerId, mode, reload.value]);

  async function fetchList(peerId: number, which: typeof mode): Promise<Participant[]> {
    if(which === 'admins') return loadAdmins(peerId);
    if(which === 'members') return loadMembers(peerId);

    // "Removed" covers both the users thrown out and the ones merely muted:
    // the API keeps them under two different filters but they are one list to
    // an admin, and the second is a superset that also carries the first.
    const [banned, restricted] = await Promise.all([
      loadRemovedUsers(peerId),
      loadRestrictedUsers(peerId).catch((): Participant[] => [])
    ]);

    const seen = new Set(banned.map((item) => item.peerId));
    return [...banned, ...restricted.filter((item) => !seen.has(item.peerId))];
  }

  // Over the `query` and `list` signals only, so `useComputed` tracks them as
  // Svelte's `$derived.by` did.
  const shown = useComputed(() => {
    const needle = query.value.trim().toLowerCase();
    if(!needle) return list.value;
    return list.value.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.username.toLowerCase().includes(needle)
    );
  });

  // Both are derived from the `chat` prop, not from a signal, so they stay plain
  // constants recomputed on each render.
  const rightKeys = adminRightKeysFor(chat);
  const permissionKeys = PERMISSION_ORDER.filter((key) => key !== 'topics' || chat.isForum);

  function refresh() {
    reload.value += 1;
    onchanged();
  }

  function fail(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  function describeRights(participant: Participant): string {
    if(participant.kind === 'creator') return participant.rank || 'Owner';
    if(participant.rank) return participant.rank;

    const granted = rightKeys.filter((key) => participant.rights[key]);
    if(!granted.length) return 'Admin';
    if(granted.length === rightKeys.length) return 'Full rights';
    return `${granted.length} of ${rightKeys.length} rights`;
  }

  function describeRestriction(participant: Participant): string {
    if(participant.kind === 'banned') {
      const expiry = formatExpiry(participant.bannedUntil);
      return expiry ? `Removed · ${expiry}` : 'Removed';
    }

    const taken = permissionKeys.filter((key) => !participant.permissions[key]).length;
    const expiry = formatExpiry(participant.bannedUntil);
    const summary = taken ? `${taken} restriction${taken === 1 ? '' : 's'}` : 'Restricted';
    return expiry ? `${summary} · ${expiry}` : summary;
  }

  function openPromote(participant: Participant) {
    // Editing an existing admin starts from their rights; promoting a plain
    // member starts from everything except the right to add more admins, which
    // is what the official clients default to.
    const start: AdminRights = {};
    if(participant.kind === 'admin' || participant.kind === 'creator') {
      for(const key of rightKeys) if(participant.rights[key]) start[key] = true;
    } else {
      for(const key of rightKeys) if(key !== 'add_admins') start[key] = true;
    }

    rights.value = start;
    rank.value = participant.rank;
    restricting.value = null;
    promoting.value = participant;
  }

  function openRestrict(participant: Participant) {
    permissions.value = {...participant.permissions};
    duration.value = 0;
    promoting.value = null;
    restricting.value = participant;
  }

  function closeEditors() {
    promoting.value = null;
    restricting.value = null;
  }

  function toggleRight(key: AdminRightKey) {
    rights.value = {...rights.value, [key]: !rights.value[key]};
  }

  function togglePermission(key: PermissionKey) {
    permissions.value = {...permissions.value, [key]: !permissions.value[key]};
  }

  async function savePromotion() {
    if(!promoting.value || busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      await promoteMember(chat.peerId, promoting.value.peerId, {...rights.value}, rank.value);
      closeEditors();
      refresh();
    } catch(err: any) {
      fail(err, 'Failed to save the admin rights');
    } finally {
      busy.value = false;
    }
  }

  async function saveRestriction() {
    if(!restricting.value || busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      await restrictMember(
        chat.peerId,
        restricting.value.peerId,
        {...permissions.value},
        untilDateFrom(duration.value)
      );
      closeEditors();
      refresh();
    } catch(err: any) {
      fail(err, 'Failed to save the restrictions');
    } finally {
      busy.value = false;
    }
  }

  async function run(action: () => Promise<void>, fallback: string) {
    if(busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await action();
      refresh();
    } catch(err: any) {
      fail(err, fallback);
    } finally {
      busy.value = false;
    }
  }

  const dismiss = (participant: Participant) =>
    run(() => demoteAdmin(chat.peerId, participant.peerId), 'Failed to dismiss the admin');

  const ban = (participant: Participant) =>
    run(() => banMember(chat.peerId, participant.peerId), 'Failed to remove the member');

  const unban = (participant: Participant) =>
    run(() => unbanMember(chat.peerId, participant.peerId), 'Failed to let them back in');

  async function deleteAllMessages(participant: Participant) {
    if(!confirm(`Delete every message ${participant.title} sent? This cannot be undone.`)) return;
    await run(
      () => deleteMessagesFromUser(chat.peerId, participant.peerId),
      'Failed to delete the messages'
    );
  }

  const emptyText =
    mode === 'admins' ? 'No admins yet.' : mode === 'removed' ? 'Nobody is removed.' : 'No members.';

  return (
    <div class="pane">
      {promoting.value ?
        <div class="editor">
          <header>
            <span>{promoting.value.title}</span>
            <button class="admin-btn" onClick={closeEditors} disabled={busy.value}>Back</button>
          </header>

          {rightKeys.map((key) => (
            <label key={key} class="admin-toggle">
              <input
                type="checkbox"
                checked={!!rights.value[key]}
                onChange={() => toggleRight(key)}
                disabled={busy.value}
              />
              <span>{adminRightLabel(key)}</span>
            </label>
          ))}

          <label class="admin-field">
            <span>Custom title</span>
            <input
              value={rank.value}
              onInput={(e) => (rank.value = (e.target as HTMLInputElement).value)}
              maxlength={16}
              placeholder="admin"
            />
          </label>

          <div class="admin-actions">
            {promoting.value.kind === 'admin' && (
              <button class="admin-btn danger" onClick={() => dismiss(promoting.value)} disabled={busy.value}>
                Dismiss
              </button>
            )}
            <button class="admin-btn primary" onClick={savePromotion} disabled={busy.value}>
              {busy.value ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div> :
        restricting.value ?
          <div class="editor">
            <header>
              <span>{restricting.value.title}</span>
              <button class="admin-btn" onClick={closeEditors} disabled={busy.value}>Back</button>
            </header>

            <p class="admin-hint">Switch off what this member may no longer do.</p>

            {permissionKeys.map((key) => (
              <label key={key} class="admin-toggle">
                <input
                  type="checkbox"
                  checked={permissions.value[key]}
                  onChange={() => togglePermission(key)}
                  disabled={busy.value}
                />
                <span>{PERMISSION_LABELS[key]}</span>
              </label>
            ))}

            <p class="admin-label">Duration</p>
            <div class="chips">
              {RESTRICTION_DURATIONS.map((option) => (
                <button
                  key={option.seconds}
                  class={[duration.value === option.seconds && 'on'].filter(Boolean).join(' ')}
                  onClick={() => (duration.value = option.seconds)}
                  disabled={busy.value}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div class="admin-actions">
              <button class="admin-btn danger" onClick={() => ban(restricting.value)} disabled={busy.value}>
                Remove from chat
              </button>
              <button class="admin-btn primary" onClick={saveRestriction} disabled={busy.value}>
                {busy.value ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div> :
          <>
            {mode !== 'admins' && (
              <input
                class="search"
                value={query.value}
                onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
                placeholder="Search"
                spellcheck={false}
              />
            )}

            {loading.value ?
              <p class="admin-muted">Loading…</p> :
              !shown.value.length ?
                <p class="admin-muted">{emptyText}</p> :
                shown.value.map((participant) => (
                  <div key={participant.peerId} class="admin-row">
                    <button class="admin-peer" onClick={() => onpeer?.(participant.peerId)}>
                      <Avatar peerId={participant.peerId} title={participant.title} size={32} />
                      <span class="admin-name">
                        <span>{participant.title}</span>
                        <span class="admin-sub">
                          {mode === 'removed' ?
                            describeRestriction(participant) :
                            participant.kind === 'creator' || participant.kind === 'admin' ?
                              describeRights(participant) :
                              participant.username ?
                                `@{participant.username}` :
                                'Member'}
                        </span>
                      </span>
                    </button>

                    <div class="row-actions">
                      {mode === 'removed' ?
                        <>
                          <button class="admin-btn" onClick={() => unban(participant)} disabled={busy.value}>
                            Unban
                          </button>
                          {participant.kind === 'restricted' && (
                            <button class="admin-btn" onClick={() => openRestrict(participant)} disabled={busy.value}>
                              Edit
                            </button>
                          )}
                        </> :
                        participant.kind === 'creator' ?
                          <span class="admin-sub">Owner</span> :
                          participant.kind === 'admin' ?
                            <>
                              {chat.access.addAdmins && (
                                <button class="admin-btn" onClick={() => openPromote(participant)} disabled={busy.value}>
                                  Edit
                                </button>
                              )}
                            </> :
                            <>
                              {chat.access.addAdmins && (
                                <button class="admin-btn" onClick={() => openPromote(participant)} disabled={busy.value}>
                                  Promote
                                </button>
                              )}
                              {chat.access.banUsers && !chat.isBasicGroup && (
                                <button class="admin-btn" onClick={() => openRestrict(participant)} disabled={busy.value}>
                                  Restrict
                                </button>
                              )}
                              {chat.access.deleteMessages && !chat.isBasicGroup && (
                                <button class="admin-btn danger" onClick={() => deleteAllMessages(participant)} disabled={busy.value}>
                                  Delete messages
                                </button>
                              )}
                              {chat.access.banUsers && (
                                <button class="admin-btn danger" onClick={() => ban(participant)} disabled={busy.value}>
                                  Remove
                                </button>
                              )}
                            </>}
                    </div>
                  </div>
                ))}

            {mode === 'admins' && chat.access.isCreator && (
              <p class="admin-hint">
                Transferring ownership is not available in this client yet.
              </p>
            )}
          </>}

      {error.value && <p class="admin-error">{error.value}</p>}
    </div>
  );
}
