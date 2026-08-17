<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    checkAdminUsername,
    deleteChat,
    leaveChat,
    makeChatPrivate,
    makeChatPublic,
    removeChatPhoto,
    saveChatAbout,
    saveChatPhoto,
    saveChatTitle,
    setForumEnabled,
    setSignaturesEnabled,
    type AdminChat
  } from '$lib/telegram/admin';

  let {
    chat,
    onchanged,
    onmigrated,
    onleft
  }: {
    chat: AdminChat;
    onchanged: () => void;
    onmigrated: (peerId: number) => void;
    /** The chat is gone — the panel should close. */
    onleft: () => void;
  } = $props();

  let title = $state(chat.title);
  let about = $state(chat.about);
  let busy = $state(false);
  let error = $state('');
  let status = $state('');

  // Toggles are optimistic and roll back on failure, the way Settings does it.
  let forum = $state(chat.isForum);
  let signatures = $state(chat.signaturesEnabled);

  let photoInput = $state<HTMLInputElement | null>(null);

  let isPublic = $state(!!chat.username);
  let link = $state(chat.username);
  let linkFree = $state<boolean | null>(null);
  let linkError = $state('');
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  let dirty = $derived(title.trim() !== chat.title || about.trim() !== chat.about);
  let canSave = $derived(dirty && title.trim().length > 0 && !busy);

  const kind = $derived(chat.isChannel ? 'channel' : 'group');

  function fail(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  async function save() {
    if (!canSave) return;
    busy = true;
    error = '';

    try {
      if (title.trim() !== chat.title) await saveChatTitle(chat.peerId, title);
      if (about.trim() !== chat.about) await saveChatAbout(chat.peerId, about);
      flash('Saved');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to save');
    } finally {
      busy = false;
    }
  }

  async function onPhotoPicked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear it straight away so picking the same file twice still fires.
    input.value = '';
    if (!file) return;

    busy = true;
    error = '';
    try {
      await saveChatPhoto(chat.peerId, file);
      flash('Photo updated');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to upload the photo');
    } finally {
      busy = false;
    }
  }

  async function dropPhoto() {
    busy = true;
    error = '';
    try {
      await removeChatPhoto(chat.peerId);
      flash('Photo removed');
      onchanged();
    } catch (err: any) {
      fail(err, 'Failed to remove the photo');
    } finally {
      busy = false;
    }
  }

  function onLinkInput() {
    clearTimeout(linkTimer);
    linkError = '';
    linkFree = null;
    const wanted = link.trim().replace(/^@/, '');
    if (wanted.length < 5 || wanted === chat.username) return;

    linkTimer = setTimeout(async () => {
      try {
        const free = await checkAdminUsername(chat.peerId, wanted);
        // The field may have moved on while the check was in flight.
        if (link.trim().replace(/^@/, '') === wanted) linkFree = free;
      } catch (err: any) {
        if (link.trim().replace(/^@/, '') === wanted) {
          linkFree = false;
          linkError = err?.type || err?.message || 'That link cannot be used';
        }
      }
    }, 400);
  }

  async function applyType() {
    if (busy) return;
    busy = true;
    error = '';
    linkError = '';

    try {
      if (isPublic) {
        const newPeerId = await makeChatPublic(chat.peerId, link);
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
      linkError = err?.type || err?.message || 'Failed to change the chat type';
    } finally {
      busy = false;
    }
  }

  async function toggleForum() {
    const next = !forum;
    forum = next;
    try {
      await setForumEnabled(chat.peerId, next);
      onchanged();
    } catch (err: any) {
      forum = !next;
      fail(err, 'Failed to change topics');
    }
  }

  async function toggleSignatures() {
    const next = !signatures;
    signatures = next;
    try {
      await setSignaturesEnabled(chat.peerId, next);
      onchanged();
    } catch (err: any) {
      signatures = !next;
      fail(err, 'Failed to change signatures');
    }
  }

  async function destroy() {
    if (!confirm(`Delete this ${kind} for everyone? This cannot be undone.`)) return;
    busy = true;
    error = '';
    try {
      await deleteChat(chat.peerId);
      onleft();
    } catch (err: any) {
      fail(err, 'Failed to delete');
      busy = false;
    }
  }

  async function leave() {
    if (!confirm(`Leave this ${kind}?`)) return;
    busy = true;
    error = '';
    try {
      await leaveChat(chat.peerId);
      onleft();
    } catch (err: any) {
      fail(err, 'Failed to leave');
      busy = false;
    }
  }
</script>

<div class="pane">
  {#if chat.access.changeInfo}
    <div class="photo-row">
      <Avatar peerId={chat.peerId} title={chat.title} size={64} />
      <div class="photo-actions">
        <button class="admin-btn" onclick={() => photoInput?.click()} disabled={busy}>
          Upload photo
        </button>
        <button class="admin-btn danger" onclick={dropPhoto} disabled={busy}>Remove</button>
      </div>
      <input
        class="picker"
        type="file"
        accept="image/*"
        bind:this={photoInput}
        onchange={onPhotoPicked}
      />
    </div>

    <label class="admin-field">
      <span>Name</span>
      <input bind:value={title} maxlength="128" />
    </label>

    <label class="admin-field">
      <span>Description</span>
      <textarea bind:value={about} maxlength="255" rows="3"></textarea>
    </label>

    <div class="admin-actions">
      <button class="admin-btn primary" onclick={save} disabled={!canSave}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </div>
  {/if}

  {#if chat.access.changeType}
    <section>
      <p class="admin-label">{chat.isChannel ? 'Channel type' : 'Group type'}</p>
      <div class="kinds">
        <button class:on={isPublic} onclick={() => (isPublic = true)}>Public</button>
        <button class:on={!isPublic} onclick={() => (isPublic = false)}>Private</button>
      </div>

      {#if isPublic}
        <div class="link-edit">
          <span class="at">@</span>
          <input
            bind:value={link}
            oninput={onLinkInput}
            placeholder="link"
            maxlength="32"
            spellcheck="false"
            autocapitalize="none"
          />
        </div>
        {#if linkFree === true}
          <p class="admin-ok">@{link.trim().replace(/^@/, '')} is available</p>
        {/if}
        {#if chat.isBasicGroup}
          <p class="admin-hint">A public group becomes a supergroup.</p>
        {/if}
      {:else}
        <p class="admin-hint">
          Only people with an invite link can join a private {kind}.
        </p>
      {/if}
      {#if linkError}<p class="admin-error">{linkError}</p>{/if}

      <div class="admin-actions">
        <button
          class="admin-btn primary"
          onclick={applyType}
          disabled={busy || (isPublic && link.trim().replace(/^@/, '').length < 5)}
        >
          {busy ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </section>
  {/if}

  {#if chat.access.changeInfo && !chat.isChannel}
    <section>
      <label class="admin-toggle">
        <input type="checkbox" checked={forum} onchange={toggleForum} disabled={busy} />
        <span>Topics</span>
      </label>
      <p class="admin-hint">Split the group's history into separate topics.</p>
    </section>
  {/if}

  {#if chat.access.changeInfo && chat.isChannel}
    <section>
      <label class="admin-toggle">
        <input type="checkbox" checked={signatures} onchange={toggleSignatures} disabled={busy} />
        <span>Sign messages</span>
      </label>
      <p class="admin-hint">Show the author's name under each post.</p>
    </section>
  {/if}

  <section>
    <p class="admin-label">Danger zone</p>
    <div class="admin-actions left">
      <button class="admin-btn danger" onclick={leave} disabled={busy}>Leave {kind}</button>
      {#if chat.access.deleteChat}
        <button class="admin-btn danger" onclick={destroy} disabled={busy}>Delete {kind}</button>
      {/if}
    </div>
  </section>

  {#if error}<p class="admin-error">{error}</p>{/if}
  {#if status}<p class="admin-ok">{status}</p>{/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 12px;
  }

  section {
    display: grid;
    gap: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .photo-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .photo-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .picker {
    display: none;
  }

  .kinds {
    display: flex;
    gap: 8px;
  }

  .kinds button {
    flex: 1;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .kinds button.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .link-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .link-edit:focus-within {
    border-color: var(--accent);
  }

  .at {
    color: var(--text-dim);
  }

  .link-edit input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    outline: none;
  }
</style>
