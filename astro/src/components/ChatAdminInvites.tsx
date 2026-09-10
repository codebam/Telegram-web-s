/*
 * Ported from svelte/src/lib/components/ChatAdminInvites.svelte. Two conversion
 * subtleties:
 *  - the `$effect` tracked the props `chat.peerId`/`mode` *and* the `reload`
 *    signal (the bare `reload;` read), so it is a `useEffect` keyed on all three
 *    — `useSignalEffect` tracks signal reads only and would never notice a
 *    different chat being opened;
 *  - the guarded assignments inside `.then()` compared against the props as they
 *    were when the fetch was *started*, which Svelte always read as current. A
 *    JSX closure sees the render that started the load, so the latest peer is
 *    kept in a ref, as in `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  createInviteLink,
  deleteInviteLink,
  deleteRevokedInviteLinks,
  editInviteLink,
  formatDate,
  formatExpiry,
  loadInviteLinks,
  loadJoinRequests,
  resolveJoinRequest,
  revokeInviteLink,
  type AdminChat,
  type InviteLink,
  type InviteLinkOptions,
  type JoinRequest
} from '$lib/telegram/admin';

import './ChatAdminInvites.css';

const EXPIRY_OPTIONS: {days: number; label: string}[] = [
  {days: 0, label: 'Never'},
  {days: 1, label: '1 day'},
  {days: 7, label: '1 week'},
  {days: 30, label: '1 month'}
];

const USAGE_OPTIONS: {limit: number; label: string}[] = [
  {limit: 0, label: 'Unlimited'},
  {limit: 1, label: '1'},
  {limit: 10, label: '10'},
  {limit: 100, label: '100'}
];

interface Props {
  chat: AdminChat;
  mode: 'links' | 'requests';
  onpeer?: (peerId: number) => void;
}

export function ChatAdminInvites({chat, mode, onpeer}: Props) {
  const links = useSignal<InviteLink[]>([]);
  const revoked = useSignal<InviteLink[]>([]);
  const requests = useSignal<JoinRequest[]>([]);

  const loading = useSignal(true);
  const error = useSignal('');
  const busy = useSignal(false);
  const status = useSignal('');
  const reload = useSignal(0);

  // The editor doubles as the "create" form: an empty `editing` link means new.
  const editorOpen = useSignal(false);
  const editing = useSignal<InviteLink | null>(null);
  const title = useSignal('');
  const expiryDays = useSignal(0);
  const usageLimit = useSignal(0);
  const requestNeeded = useSignal(false);

  // The running fetch compares its own peer against the latest one — see the
  // note at the top of the file.
  const currentPeerId = useRef(chat.peerId);
  currentPeerId.current = chat.peerId;

  useEffect(() => {
    const peerId = chat.peerId;
    const which = mode;
    loading.value = true;
    error.value = '';

    const load = which === 'links' ?
      Promise.all([loadInviteLinks(peerId), loadInviteLinks(peerId, true)]).then(([active, dead]) => {
        if(peerId !== currentPeerId.current) return;
        links.value = active;
        revoked.value = dead;
      }) :
      loadJoinRequests(peerId).then((loaded) => {
        if(peerId === currentPeerId.current) requests.value = loaded;
      });

    load
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load'))
      .finally(() => (loading.value = false));
  }, [chat.peerId, mode, reload.value]);

  function refresh() {
    reload.value += 1;
  }

  function fail(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
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

  function openCreate() {
    editing.value = null;
    title.value = '';
    expiryDays.value = 0;
    usageLimit.value = 0;
    requestNeeded.value = false;
    editorOpen.value = true;
  }

  function openEdit(link: InviteLink) {
    editing.value = link;
    title.value = link.title;
    // The server stores an absolute moment; the form offers durations, so an
    // existing expiry that is not one of them shows as "Never" and is only
    // rewritten if the user actually picks something.
    expiryDays.value = 0;
    usageLimit.value = link.usageLimit;
    requestNeeded.value = link.requestNeeded;
    editorOpen.value = true;
  }

  function optionsFromForm(): InviteLinkOptions {
    return {
      title: title.value.trim(),
      expireDate: expiryDays.value ? Math.floor(Date.now() / 1000) + expiryDays.value * 86400 : 0,
      usageLimit: usageLimit.value,
      requestNeeded: requestNeeded.value
    };
  }

  async function saveLink() {
    if(busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      const options = optionsFromForm();
      if(editing.value) await editInviteLink(chat.peerId, editing.value.link, options);
      else await createInviteLink(chat.peerId, options);
      editorOpen.value = false;
      refresh();
    } catch(err: any) {
      fail(err, 'Failed to save the invite link');
    } finally {
      busy.value = false;
    }
  }

  async function copy(link: InviteLink) {
    try {
      await navigator.clipboard.writeText(link.link);
      flash('Link copied');
    } catch(err: any) {
      fail(err, 'Failed to copy the link');
    }
  }

  function share(link: InviteLink) {
    // `navigator.share` is the phone path; on a desktop browser without it a
    // copy is the closest useful thing rather than a dead button.
    if(navigator.share) {
      navigator.share({url: link.link, title: chat.title}).catch(() => {});
      return;
    }
    copy(link);
  }

  function describe(link: InviteLink): string {
    const parts: string[] = [];
    if(link.usageLimit) parts.push(`${link.usage}/${link.usageLimit} used`);
    else if(link.usage) parts.push(`${link.usage} joined`);
    if(link.requested) parts.push(`${link.requested} pending`);
    if(link.requestNeeded) parts.push('needs approval');

    const expiry = formatExpiry(link.expireDate);
    if(expiry) parts.push(expiry);
    if(!parts.length) parts.push(formatDate(link.date));
    return parts.join(' · ');
  }

  return (
    <div class="pane">
      {mode === 'links' ? (
        editorOpen.value ? (
          <div class="editor">
            <header>
              <span>{editing.value ? 'Edit link' : 'New link'}</span>
              <button class="admin-btn" onClick={() => (editorOpen.value = false)} disabled={busy.value}>Back</button>
            </header>

            <label class="admin-field">
              <span>Name</span>
              <input
                maxlength={32}
                placeholder="optional"
                value={title.value}
                onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
              />
            </label>

            <p class="admin-label">Expires</p>
            <div class="chips">
              {EXPIRY_OPTIONS.map((option) => (
                <button
                  key={option.days}
                  class={expiryDays.value === option.days ? 'on' : ''}
                  onClick={() => (expiryDays.value = option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p class="admin-label">Uses</p>
            <div class="chips">
              {USAGE_OPTIONS.map((option) => (
                <button
                  key={option.limit}
                  class={usageLimit.value === option.limit ? 'on' : ''}
                  onClick={() => (usageLimit.value = option.limit)}
                  disabled={requestNeeded.value}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label class="admin-toggle">
              <input
                type="checkbox"
                checked={requestNeeded.value}
                onChange={(e) => (requestNeeded.value = (e.target as HTMLInputElement).checked)}
              />
              <span>Approve new members</span>
            </label>
            <p class="admin-hint">A link that needs approval cannot also have a usage limit.</p>

            <div class="admin-actions">
              <button class="admin-btn primary" onClick={saveLink} disabled={busy.value}>
                {busy.value ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div class="admin-actions left">
              <button class="admin-btn primary" onClick={openCreate} disabled={busy.value}>New link</button>
            </div>

            {loading.value ?
              <p class="admin-muted">Loading…</p> :
              <>
                {!links.value.length &&
                  <p class="admin-muted">No invite links.</p>}

                {links.value.map((link) => (
                  <div key={link.link} class="link-card">
                    <span class="link-title">{link.title || link.link}</span>
                    <span class="admin-sub">{describe(link)}</span>
                    <div class="link-actions">
                      <button class="admin-btn" onClick={() => copy(link)}>Copy</button>
                      <button class="admin-btn" onClick={() => share(link)}>Share</button>
                      {!link.permanent &&
                        <button class="admin-btn" onClick={() => openEdit(link)} disabled={busy.value}>Edit</button>}
                      <button
                        class="admin-btn danger"
                        onClick={() => run(() => revokeInviteLink(chat.peerId, link.link), 'Failed to revoke')}
                        disabled={busy.value}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}

                {revoked.value.length ?
                  <section>
                    <div class="revoked-head">
                      <p class="admin-label">Revoked</p>
                      <button
                        class="admin-btn danger"
                        onClick={() => run(() => deleteRevokedInviteLinks(chat.peerId), 'Failed to delete the revoked links')}
                        disabled={busy.value}
                      >
                        Delete all
                      </button>
                    </div>

                    {revoked.value.map((link) => (
                      <div key={link.link} class="link-card">
                        <span class="link-title">{link.title || link.link}</span>
                        <span class="admin-sub">{describe(link)}</span>
                        <div class="link-actions">
                          <button
                            class="admin-btn danger"
                            onClick={() => run(() => deleteInviteLink(chat.peerId, link.link), 'Failed to delete')}
                            disabled={busy.value}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </section> :
                  null}
              </>}
          </>
        )
      ) : loading.value ? (
        <p class="admin-muted">Loading…</p>
      ) : !requests.value.length ? (
        <p class="admin-muted">No pending requests.</p>
      ) : (
        requests.value.map((request) => (
          <div key={request.peerId} class="admin-row">
            <button class="admin-peer" onClick={() => onpeer?.(request.peerId)}>
              <Avatar peerId={request.peerId} title={request.title} size={32} />
              <span class="admin-name">
                <span>{request.title}</span>
                <span class="admin-sub">
                  {request.about || (request.username ? `@${request.username}` : formatDate(request.date))}
                </span>
              </span>
            </button>

            <div class="link-actions">
              <button
                class="admin-btn primary"
                onClick={() => run(() => resolveJoinRequest(chat.peerId, request.peerId, true), 'Failed to approve')}
                disabled={busy.value}
              >
                Approve
              </button>
              <button
                class="admin-btn danger"
                onClick={() => run(() => resolveJoinRequest(chat.peerId, request.peerId, false), 'Failed to decline')}
                disabled={busy.value}
              >
                Decline
              </button>
            </div>
          </div>
        ))
      )}

      {error.value && <p class="admin-error">{error.value}</p>}
      {status.value && <p class="admin-ok">{status.value}</p>}
    </div>
  );
}
