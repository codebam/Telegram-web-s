<script lang="ts">
  import ChatAdminEdit from './ChatAdminEdit.svelte';
  import ChatAdminPermissions from './ChatAdminPermissions.svelte';
  import ChatAdminMembers from './ChatAdminMembers.svelte';
  import ChatAdminInvites from './ChatAdminInvites.svelte';
  import ChatAdminLog from './ChatAdminLog.svelte';
  import ChatAdminDiscussion from './ChatAdminDiscussion.svelte';
  import {loadAdminChat, type AdminChat} from '$lib/telegram/admin';

  let {
    peerId,
    onclose,
    onmigrated,
    onpeer
  }: {
    peerId: number;
    onclose: () => void;
    /** The chat became a supergroup and lives under a new peer id. */
    onmigrated?: (peerId: number) => void;
    /** Open a member's profile. */
    onpeer?: (peerId: number) => void;
  } = $props();

  type Section =
    | 'edit'
    | 'permissions'
    | 'admins'
    | 'members'
    | 'removed'
    | 'invites'
    | 'requests'
    | 'log'
    | 'discussion';

  let chat = $state<AdminChat | null>(null);
  let error = $state('');
  let section = $state<Section>('edit');
  // Bumped after any change that alters the chat itself, so the shell reloads
  // and the sections below it see the new title, permissions or link.
  let revision = $state(0);

  $effect(() => {
    const id = peerId;
    revision;
    error = '';
    loadAdminChat(id)
      .then((loaded) => {
        if (id === peerId) chat = loaded;
      })
      .catch((err: any) => (error = err?.type || err?.message || 'Failed to load the chat'));
  });

  /**
   * Which sections this chat has at all. A basic group has no invite-link
   * management, no admin log and no discussion group until it is migrated, and
   * a broadcast channel has no member permissions to set.
   */
  let sections = $derived.by((): [Section, string][] => {
    if (!chat) return [];
    const {access, isChannel, isBasicGroup} = chat;
    const list: [Section, string][] = [];

    if (access.changeInfo || access.changeType || access.isCreator) list.push(['edit', 'Edit']);
    if (!isChannel && access.changePermissions) list.push(['permissions', 'Permissions']);
    list.push(['admins', 'Admins']);
    if (access.banUsers || access.addAdmins) list.push(['members', 'Members']);
    if (access.banUsers && !isBasicGroup) list.push(['removed', 'Removed']);
    if (access.inviteLinks) list.push(['invites', 'Invite links']);
    if (access.inviteLinks && !isBasicGroup) list.push(['requests', 'Requests']);
    if (access.viewAdminLog) list.push(['log', 'Recent actions']);
    if (isChannel && access.isCreator) list.push(['discussion', 'Discussion']);

    return list;
  });

  // A section can disappear when the chat's shape changes under us — falling
  // back to the first one beats rendering an empty pane.
  $effect(() => {
    const available = sections;
    if (available.length && !available.some(([key]) => key === section)) {
      section = available[0][0];
    }
  });

  function changed() {
    revision += 1;
  }

  function migrated(newPeerId: number) {
    onmigrated?.(newPeerId);
    onclose();
  }
</script>

<div class="admin-backdrop" onclick={onclose} role="presentation">
  <div class="admin-dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <span>{chat ? chat.title || 'Manage' : 'Manage'}</span>
      <button class="close" onclick={onclose} aria-label="Close">✕</button>
    </header>

    {#if error}
      <p class="admin-error">{error}</p>
    {:else if !chat}
      <p class="admin-muted">Loading…</p>
    {:else}
      <nav class="admin-nav">
        {#each sections as [key, label] (key)}
          <button class:active={section === key} onclick={() => (section = key)}>{label}</button>
        {/each}
      </nav>

      <div class="admin-body">
        {#if section === 'edit'}
          <ChatAdminEdit {chat} onchanged={changed} onmigrated={migrated} onleft={onclose} />
        {:else if section === 'permissions'}
          <ChatAdminPermissions {chat} onchanged={changed} />
        {:else if section === 'admins'}
          <ChatAdminMembers {chat} mode="admins" onchanged={changed} {onpeer} />
        {:else if section === 'members'}
          <ChatAdminMembers {chat} mode="members" onchanged={changed} {onpeer} />
        {:else if section === 'removed'}
          <ChatAdminMembers {chat} mode="removed" onchanged={changed} {onpeer} />
        {:else if section === 'invites'}
          <ChatAdminInvites {chat} mode="links" />
        {:else if section === 'requests'}
          <ChatAdminInvites {chat} mode="requests" {onpeer} />
        {:else if section === 'log'}
          <ChatAdminLog {chat} {onpeer} />
        {:else if section === 'discussion'}
          <ChatAdminDiscussion {chat} onchanged={changed} />
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .admin-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 95;
  }

  .admin-dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: min(680px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-weight: 600;
    flex: none;
  }

  header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
    flex: none;
  }

  .admin-nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    flex: none;
    padding-bottom: 2px;
  }

  .admin-nav button {
    flex: none;
    padding: 6px 10px;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .admin-nav button.active {
    background: var(--accent);
    color: #fff;
  }

  .admin-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /*
   * The admin sections share one vocabulary of rows, fields and buttons. Svelte
   * scopes styles per component, so the shared classes are declared once here,
   * globally, rather than copied into each of the six panes. Every one is a
   * single `admin-`prefixed class — cheap to match and unlikely to collide.
   */
  :global(.admin-error) {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  :global(.admin-muted) {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }

  :global(.admin-ok) {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }

  :global(.admin-hint) {
    margin: 0;
    color: var(--text-dim);
    font-size: 12px;
  }

  :global(.admin-label) {
    margin: 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  :global(.admin-field) {
    display: grid;
    gap: 4px;
    font-size: 13px;
    color: var(--text-dim);
  }

  :global(.admin-field input),
  :global(.admin-field textarea),
  :global(.admin-field select) {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
    resize: vertical;
  }

  :global(.admin-field input:focus),
  :global(.admin-field textarea:focus),
  :global(.admin-field select:focus) {
    border-color: var(--accent);
  }

  :global(.admin-toggle) {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  :global(.admin-btn) {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  :global(.admin-btn.primary) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  :global(.admin-btn.danger) {
    color: var(--danger);
  }

  :global(.admin-btn:disabled) {
    opacity: 0.5;
    cursor: default;
  }

  :global(.admin-actions) {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  :global(.admin-actions.left) {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  :global(.admin-row) {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-radius: 8px;
  }

  :global(.admin-row:hover) {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  :global(.admin-row .admin-name) {
    flex: 1;
    min-width: 0;
    display: grid;
  }

  :global(.admin-row .admin-name > span) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.admin-row .admin-name .admin-sub) {
    font-size: 12px;
    color: var(--text-dim);
  }

  :global(.admin-peer) {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
</style>
