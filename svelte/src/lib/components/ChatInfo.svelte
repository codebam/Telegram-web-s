<script lang="ts">
  import Avatar from './Avatar.svelte';
  import ChatAdmin from './ChatAdmin.svelte';
  import {loadAdminAccess} from '$lib/telegram/admin';
  import {
    checkChatUsername,
    loadChatInfo,
    setChatUsername,
    type ChatInfo
  } from '$lib/telegram/chats';

  let {
    peerId,
    onclose,
    onmessage,
    onpeer,
    onmigrated
  }: {
    peerId: number;
    onclose: () => void;
    /** Open a direct chat with this peer. */
    onmessage?: (peerId: number) => void;
    /** Drill into another profile, e.g. a member of this group. */
    onpeer?: (peerId: number) => void;
    /** This chat became a supergroup and lives under a new peer id. */
    onmigrated?: (peerId: number) => void;
  } = $props();

  let info = $state<ChatInfo | null>(null);
  let error = $state('');

  let editingLink = $state(false);
  let link = $state('');
  let linkBusy = $state(false);
  let linkError = $state('');
  let linkFree = $state<boolean | null>(null);
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  // Whether this account may administer the chat, and the admin panel it opens.
  let canManage = $state(false);
  let managing = $state(false);

  $effect(() => {
    const id = peerId;
    canManage = false;
    managing = false;
    // Non-fatal: without it the profile simply has no "Manage" entry.
    loadAdminAccess(id)
      .then((access) => {
        if(id === peerId) canManage = access.canManage;
      })
      .catch(() => {});
  });

  $effect(() => {
    const id = peerId;
    info = null;
    error = '';
    editingLink = false;
    linkError = '';
    linkFree = null;
    loadChatInfo(id)
      .then((loaded) => {
        if(id === peerId) info = loaded;
      })
      .catch((err) => (error = err?.type || err?.message || 'Failed to load info'));
  });

  function startEditingLink() {
    link = info?.username ?? '';
    linkError = '';
    linkFree = null;
    editingLink = true;
  }

  function onLinkInput() {
    clearTimeout(linkTimer);
    linkError = '';
    linkFree = null;
    const wanted = link.trim().replace(/^@/, '');
    if(wanted.length < 5 || wanted === info?.username) return;

    linkTimer = setTimeout(async () => {
      try {
        const free = await checkChatUsername(peerId, wanted);
        // The field may have moved on while the check was in flight.
        if(link.trim().replace(/^@/, '') === wanted) linkFree = free;
      } catch (err: any) {
        if(link.trim().replace(/^@/, '') === wanted) {
          linkFree = false;
          linkError = err?.type || err?.message || 'That link cannot be used';
        }
      }
    }, 400);
  }

  async function saveLink() {
    if(linkBusy) return;
    linkBusy = true;
    linkError = '';

    try {
      const newPeerId = await setChatUsername(peerId, link);
      editingLink = false;

      // Setting a link on a basic group migrates it to a supergroup, which is
      // a different peer — reopen on the new one rather than showing a stale
      // profile for a chat that no longer receives messages.
      const onMoved = onmigrated ?? onpeer;
      if(newPeerId !== peerId && onMoved) onMoved(newPeerId);
      else info = await loadChatInfo(peerId);
    } catch (err: any) {
      linkError = err?.type || err?.message || 'Failed to save the link';
    } finally {
      linkBusy = false;
    }
  }

  async function removeLink() {
    link = '';
    await saveLink();
  }
</script>

<aside class="info">
  <header>
    <span>Info</span>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>

  <div class="body">
    {#if error}
      <p class="muted">{error}</p>
    {:else if !info}
      <p class="muted">Loading…</p>
    {:else}
      <div class="head">
        <Avatar peerId={info.peerId} title={info.title} size={84} />
        <h2>{info.title}</h2>
        {#if info.username}<p class="username">@{info.username}</p>{/if}
        <p class="kind">
          {info.isChannel ? 'Channel' : info.isGroup ? 'Group' : 'User'}
          {#if info.membersCount}
            · {info.membersCount.toLocaleString()} {info.isChannel ? 'subscribers' : 'members'}
          {/if}
        </p>

        {#if onmessage}
          <button class="primary" onclick={() => onmessage(info.peerId)}>
            {info.isChannel || info.isGroup ? 'Open chat' : 'Send message'}
          </button>
        {/if}

        {#if canManage}
          <button class="link-btn" onclick={() => (managing = true)}>Manage</button>
        {/if}
      </div>

      {#if info.canSetUsername}
        <section>
          <p class="label">Public link</p>
          {#if editingLink}
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
            {#if linkFree === true}<p class="ok">@{link.trim().replace(/^@/, '')} is available</p>{/if}
            {#if linkError}<p class="err">{linkError}</p>{/if}
            {#if info.isGroup && !info.username}
              <p class="hint">A public group becomes a supergroup.</p>
            {/if}
            <div class="link-actions">
              {#if info.username}
                <button class="link-btn danger" onclick={removeLink} disabled={linkBusy}>Remove</button>
              {/if}
              <button class="link-btn" onclick={() => (editingLink = false)} disabled={linkBusy}>Cancel</button>
              <button
                class="link-btn primary"
                onclick={saveLink}
                disabled={linkBusy || linkFree === false || link.trim().replace(/^@/, '').length < 5}
              >
                {linkBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          {:else}
            <div class="link-row">
              <span class="link-value">{info.username ? `@${info.username}` : 'Private — invite only'}</span>
              <button class="link-btn" onclick={startEditingLink}>{info.username ? 'Edit' : 'Set link'}</button>
            </div>
          {/if}
        </section>
      {/if}

      {#if info.about}
        <section>
          <p class="label">About</p>
          <p class="about">{info.about}</p>
        </section>
      {/if}

      {#if info.members.length}
        <section>
          <p class="label">Members</p>
          {#each info.members as member (member.peerId)}
            <button class="member" onclick={() => onpeer?.(member.peerId)}>
              <Avatar peerId={member.peerId} title={member.title} size={32} />
              <span>{member.title}</span>
            </button>
          {/each}
        </section>
      {/if}
    {/if}
  </div>
</aside>

{#if managing}
  <ChatAdmin
    {peerId}
    onclose={() => {
      managing = false;
      // The chat may have been renamed, made public, or left entirely.
      loadChatInfo(peerId)
        .then((loaded) => (info = loaded))
        .catch(() => {});
    }}
    onmigrated={(newPeerId) => (onmigrated ?? onpeer)?.(newPeerId)}
    {onpeer}
  />
{/if}

<style>
  .info {
    width: 320px;
    flex: none;
    background: var(--pane);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    backdrop-filter: blur(var(--blur));
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  .close {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px;
  }

  .head {
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
  }

  h2 {
    margin: 8px 0 0;
    font-size: 18px;
  }

  .username,
  .kind {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  section {
    margin-top: 22px;
  }

  .label {
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .about {
    margin: 0;
    font-size: 14px;
    white-space: pre-wrap;
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .link-value {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .link-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .link-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .link-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .link-btn.danger {
    color: var(--danger);
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ok,
  .err,
  .hint {
    margin: 6px 0 0;
    font-size: 12px;
  }

  .ok {
    color: var(--accent);
  }

  .err {
    color: var(--danger);
  }

  .hint {
    color: var(--text-dim);
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 4px;
    border: none;
    border-radius: 8px;
    background: none;
    color: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .member:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .primary {
    margin-top: 10px;
    padding: 9px 18px;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .muted {
    color: var(--text-dim);
  }

  /* Phones have no room for a third column — show it as a full-screen sheet. */
  @media (max-width: 860px) {
    .info {
      position: fixed;
      inset: 0;
      width: 100%;
      background: var(--bg);
      z-index: 80;
    }
  }
</style>
