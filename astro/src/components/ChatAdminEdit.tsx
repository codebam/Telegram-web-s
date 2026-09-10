/*
 * Ported from svelte/src/lib/components/ChatAdminEdit.svelte.
 *
 * Three porting notes:
 *  - `dirty`, `canSave` and `kind` were `$derived` over props, so they stay plain
 *    `const`s recomputed on each render — a `useComputed` only tracks signal reads
 *    and would never see `chat` change (CONVERSION.md §4). Reading `title.value`
 *    and friends while rendering them is what re-renders the pane;
 *  - `linkTimer` was a plain `let` in the Svelte body, which runs once per
 *    instance; a Preact body runs on every render, so the timer handle lives in a
 *    `useRef` and keeps its identity across passes;
 *  - the link field was `bind:value` *plus* `oninput`, and `onLinkInput` reads the
 *    new value — so the signal is written before the handler is called.
 */
import {useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  checkAdminUsername,
  deleteChat,
  leaveChat,
  makeChatPrivate,
  makeChatPublic,
  removeChatLocation,
  removeChatPhoto,
  saveChatAbout,
  saveChatPhoto,
  saveChatTitle,
  setAntiSpam,
  setChatLocation,
  setContentProtection,
  setForumEnabled,
  setHiddenMembers,
  setJoinToSend,
  setPreHistoryHidden,
  setSignaturesEnabled,
  type AdminChat
} from '$lib/telegram/admin';

import './ChatAdminEdit.css';

interface Props {
  chat: AdminChat;
  onchanged: () => void;
  onmigrated: (peerId: number) => void;
  /** The chat is gone — the panel should close. */
  onleft: () => void;
}

export function ChatAdminEdit({chat, onchanged, onmigrated, onleft}: Props) {
  const title = useSignal(chat.title);
  const about = useSignal(chat.about);
  const busy = useSignal(false);
  const error = useSignal('');
  const status = useSignal('');

  // Toggles are optimistic and roll back on failure, the way Settings does it.
  const forum = useSignal(chat.isForum);
  const signatures = useSignal(chat.signaturesEnabled);

  // The privacy/access switches. Each mirrors a chat or full-chat flag.
  const contentProtection = useSignal(chat.contentProtection);
  const hiddenMembers = useSignal(chat.participantsHidden);
  const preHistory = useSignal(chat.preHistoryHidden);
  const antiSpam = useSignal(chat.antiSpam);
  const joinToSend = useSignal(chat.joinToSend);

  const hasLocation = useSignal(chat.hasLocation);
  const locationAddress = useSignal(chat.locationAddress);

  const photoInput = useRef<HTMLInputElement>(null);

  const isPublic = useSignal(!!chat.username);
  const link = useSignal(chat.username);
  const linkFree = useSignal<boolean | null>(null);
  const linkError = useSignal('');
  const linkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dirty = title.value.trim() !== chat.title || about.value.trim() !== chat.about;
  const canSave = dirty && title.value.trim().length > 0 && !busy.value;

  const kind = chat.isChannel ? 'channel' : 'group';

  // A basic group has none of the channel-only settings below; each toggle is
  // gated by the shape of chat that actually carries it.
  const isChannelLike = chat.isChannel || chat.isMegagroup;

  /**
   * Flip a boolean signal, call the server, and roll back on failure — the shape
   * every switch in this pane uses. A fresh closure per render is fine; it only
   * lives until the click.
   */
  function makeToggle(
    signal: {value: boolean},
    apply: (enabled: boolean) => Promise<void>,
    fallback: string
  ) {
    return async() => {
      const next = !signal.value;
      signal.value = next;
      try {
        await apply(next);
        onchanged();
      } catch (err: any) {
        signal.value = !next;
        fail(err, fallback);
      }
    };
  }

  const toggleContentProtection = makeToggle(
    contentProtection,
    (enabled) => setContentProtection(chat.peerId, enabled),
    'Failed to change content protection'
  );
  const toggleHiddenMembers = makeToggle(
    hiddenMembers,
    (enabled) => setHiddenMembers(chat.peerId, enabled),
    'Failed to change the member list'
  );
  const togglePreHistory = makeToggle(
    preHistory,
    (enabled) => setPreHistoryHidden(chat.peerId, enabled),
    'Failed to change the history setting'
  );
  const toggleAntiSpam = makeToggle(
    antiSpam,
    (enabled) => setAntiSpam(chat.peerId, enabled),
    'Failed to change anti-spam'
  );
  const toggleJoinToSend = makeToggle(
    joinToSend,
    (enabled) => setJoinToSend(chat.peerId, enabled),
    'Failed to change the join setting'
  );

  async function useMyLocation() {
    if(!navigator.geolocation) {
      fail(null, 'This browser does not support location');
      return;
    }

    busy.value = true;
    error.value = '';
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {timeout: 15000}));
      const {latitude, longitude} = position.coords;
      await setChatLocation(chat.peerId, latitude, longitude);
      locationAddress.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
      hasLocation.value = true;
      flash('Location updated');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to set the location');
    } finally {
      busy.value = false;
    }
  }

  async function dropLocation() {
    busy.value = true;
    error.value = '';
    try {
      await removeChatLocation(chat.peerId);
      locationAddress.value = '';
      hasLocation.value = false;
      flash('Location removed');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to remove the location');
    } finally {
      busy.value = false;
    }
  }

  function fail(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  async function save() {
    if (!canSave) return;
    busy.value = true;
    error.value = '';

    try {
      if (title.value.trim() !== chat.title) await saveChatTitle(chat.peerId, title.value);
      if (about.value.trim() !== chat.about) await saveChatAbout(chat.peerId, about.value);
      flash('Saved');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to save');
    } finally {
      busy.value = false;
    }
  }

  async function onPhotoPicked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear it straight away so picking the same file twice still fires.
    input.value = '';
    if (!file) return;

    busy.value = true;
    error.value = '';
    try {
      await saveChatPhoto(chat.peerId, file);
      flash('Photo updated');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to upload the photo');
    } finally {
      busy.value = false;
    }
  }

  async function dropPhoto() {
    busy.value = true;
    error.value = '';
    try {
      await removeChatPhoto(chat.peerId);
      flash('Photo removed');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to remove the photo');
    } finally {
      busy.value = false;
    }
  }

  function onLinkInput() {
    clearTimeout(linkTimer.current);
    linkError.value = '';
    linkFree.value = null;
    const wanted = link.value.trim().replace(/^@/, '');
    if (wanted.length < 5 || wanted === chat.username) return;

    linkTimer.current = setTimeout(async () => {
      try {
        const free = await checkAdminUsername(chat.peerId, wanted);
        // The field may have moved on while the check was in flight.
        if (link.value.trim().replace(/^@/, '') === wanted) linkFree.value = free;
      } catch (err: any) {
        if (link.value.trim().replace(/^@/, '') === wanted) {
          linkFree.value = false;
          linkError.value = err?.type || err?.message || 'That link cannot be used';
        }
      }
    }, 400);
  }

  async function applyType() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    linkError.value = '';

    try {
      if (isPublic.value) {
        const newPeerId = await makeChatPublic(chat.peerId, link.value);
        // A basic group is migrated to a supergroup to get a link at all, which
        // moves it to a different peer — the old one stops receiving messages.
        if (newPeerId !== chat.peerId) {
          onmigrated(newPeerId);
          return;
        }
      } else {
        await makeChatPrivate(chat.peerId);
      }

      flash('Saved');
      onchanged();
    } catch (err: any) {
      linkError.value = err?.type || err?.message || 'Failed to change the chat type';
    } finally {
      busy.value = false;
    }
  }

  async function toggleForum() {
    const next = !forum.value;
    forum.value = next;
    try {
      await setForumEnabled(chat.peerId, next);
      onchanged();
    } catch (err: any) {
      forum.value = !next;
      fail(err, 'Failed to change topics');
    }
  }

  async function toggleSignatures() {
    const next = !signatures.value;
    signatures.value = next;
    try {
      await setSignaturesEnabled(chat.peerId, next);
      onchanged();
    } catch (err: any) {
      signatures.value = !next;
      fail(err, 'Failed to change signatures');
    }
  }

  async function destroy() {
    if (!confirm(`Delete this ${kind} for everyone? This cannot be undone.`)) return;
    busy.value = true;
    error.value = '';
    try {
      await deleteChat(chat.peerId);
      onleft();
    } catch (err: any) {
      fail(err, 'Failed to delete');
      busy.value = false;
    }
  }

  async function leave() {
    if (!confirm(`Leave this ${kind}?`)) return;
    busy.value = true;
    error.value = '';
    try {
      await leaveChat(chat.peerId);
      onleft();
    } catch (err: any) {
      fail(err, 'Failed to leave');
      busy.value = false;
    }
  }

  return (
    <div class="pane">
      {chat.access.changeInfo && (
        <>
          <div class="photo-row">
            <Avatar peerId={chat.peerId} title={chat.title} size={64} />
            <div class="photo-actions">
              <button class="admin-btn" onClick={() => photoInput.current?.click()} disabled={busy.value}>
                Upload photo
              </button>
              <button class="admin-btn danger" onClick={dropPhoto} disabled={busy.value}>Remove</button>
            </div>
            <input
              class="picker"
              type="file"
              accept="image/*"
              ref={photoInput}
              onChange={onPhotoPicked}
            />
          </div>

          <label class="admin-field">
            <span>Name</span>
            <input
              value={title.value}
              onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
              maxlength={128}
            />
          </label>

          <label class="admin-field">
            <span>Description</span>
            <textarea
              value={about.value}
              onInput={(e) => (about.value = (e.target as HTMLTextAreaElement).value)}
              maxlength={255}
              rows={3}
            />
          </label>

          <div class="admin-actions">
            <button class="admin-btn primary" onClick={save} disabled={!canSave}>
              {busy.value ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}

      {chat.access.changeType && (
        <section>
          <p class="admin-label">{chat.isChannel ? 'Channel type' : 'Group type'}</p>
          <div class="kinds">
            <button class={isPublic.value ? 'on' : ''} onClick={() => (isPublic.value = true)}>Public</button>
            <button class={!isPublic.value ? 'on' : ''} onClick={() => (isPublic.value = false)}>Private</button>
          </div>

          {isPublic.value ?
            <>
              <div class="link-edit">
                <span class="at">@</span>
                <input
                  value={link.value}
                  onInput={(e) => {
                    link.value = (e.target as HTMLInputElement).value;
                    onLinkInput();
                  }}
                  placeholder="link"
                  maxlength={32}
                  spellcheck={false}
                  autocapitalize="none"
                />
              </div>
              {linkFree.value === true && (
                <p class="admin-ok">@{link.value.trim().replace(/^@/, '')} is available</p>
              )}
              {chat.isBasicGroup && (
                <p class="admin-hint">A public group becomes a supergroup.</p>
              )}
            </> :
            <p class="admin-hint">
              Only people with an invite link can join a private {kind}.
            </p>}
          {linkError.value && <p class="admin-error">{linkError.value}</p>}

          <div class="admin-actions">
            <button
              class="admin-btn primary"
              onClick={applyType}
              disabled={busy.value || (isPublic.value && link.value.trim().replace(/^@/, '').length < 5)}
            >
              {busy.value ? 'Saving…' : 'Apply'}
            </button>
          </div>
        </section>
      )}

      {chat.access.changeInfo && !chat.isChannel && (
        <section>
          <label class="admin-toggle">
            <input type="checkbox" checked={forum.value} onChange={toggleForum} disabled={busy.value} />
            <span>Topics</span>
          </label>
          <p class="admin-hint">Split the group's history into separate topics.</p>
        </section>
      )}

      {chat.access.changeInfo && chat.isChannel && (
        <section>
          <label class="admin-toggle">
            <input type="checkbox" checked={signatures.value} onChange={toggleSignatures} disabled={busy.value} />
            <span>Sign messages</span>
          </label>
          <p class="admin-hint">Show the author's name under each post.</p>
        </section>
      )}

      {chat.access.changeInfo && isChannelLike && (
        <section>
          <p class="admin-label">Access</p>

          <label class="admin-toggle">
            <input
              type="checkbox"
              checked={contentProtection.value}
              onChange={toggleContentProtection}
              disabled={busy.value}
            />
            <span>Restrict saving content</span>
          </label>
          <p class="admin-hint">Forbid forwarding and saving media from this {kind}.</p>

          <label class="admin-toggle">
            <input
              type="checkbox"
              checked={hiddenMembers.value}
              onChange={toggleHiddenMembers}
              disabled={busy.value}
            />
            <span>Hide members</span>
          </label>
          <p class="admin-hint">Only admins can see the member list.</p>

          <label class="admin-toggle">
            <input
              type="checkbox"
              checked={preHistory.value}
              onChange={togglePreHistory}
              disabled={busy.value}
            />
            <span>Hide history for new members</span>
          </label>
          <p class="admin-hint">New members see only what is sent after they join.</p>

          {chat.isMegagroup && (
            <>
              <label class="admin-toggle">
                <input
                  type="checkbox"
                  checked={joinToSend.value}
                  onChange={toggleJoinToSend}
                  disabled={busy.value}
                />
                <span>Approve new members</span>
              </label>
              <p class="admin-hint">Admins must approve people before they can write.</p>

              <label class="admin-toggle">
                <input
                  type="checkbox"
                  checked={antiSpam.value}
                  onChange={toggleAntiSpam}
                  disabled={busy.value}
                />
                <span>Anti-spam</span>
              </label>
              <p class="admin-hint">Restrict new members until they prove they are human.</p>
            </>
          )}
        </section>
      )}

      {chat.canSetLocation && (
        <section>
          <p class="admin-label">Location</p>
          {locationAddress.value ?
            <p class="admin-hint">{locationAddress.value}</p> :
            <p class="admin-hint">No location set.</p>}
          <div class="admin-actions left">
            <button class="admin-btn" onClick={useMyLocation} disabled={busy.value}>
              Use my location
            </button>
            {hasLocation.value && (
              <button class="admin-btn danger" onClick={dropLocation} disabled={busy.value}>Remove</button>
            )}
          </div>
        </section>
      )}

      <section>
        <p class="admin-label">Danger zone</p>
        <div class="admin-actions left">
          <button class="admin-btn danger" onClick={leave} disabled={busy.value}>Leave {kind}</button>
          {chat.access.deleteChat && (
            <button class="admin-btn danger" onClick={destroy} disabled={busy.value}>Delete {kind}</button>
          )}
        </div>
      </section>

      {error.value && <p class="admin-error">{error.value}</p>}
      {status.value && <p class="admin-ok">{status.value}</p>}
    </div>
  );
}
