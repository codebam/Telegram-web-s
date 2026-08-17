<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    ALL_ALLOWED,
    PERMISSION_LABELS,
    PERMISSION_ORDER,
    RESTRICTION_DURATIONS,
    adminRightKeysFor,
    adminRightLabel,
    banMember,
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

  let {
    chat,
    mode,
    onchanged,
    onpeer
  }: {
    chat: AdminChat;
    /** admins: the admin list. members: everyone. removed: banned + restricted. */
    mode: 'admins' | 'members' | 'removed';
    onchanged: () => void;
    onpeer?: (peerId: number) => void;
  } = $props();

  let list = $state<Participant[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);
  let query = $state('');

  // The two editors are mutually exclusive and replace the list while open.
  let promoting = $state<Participant | null>(null);
  let rights = $state<AdminRights>({});
  let rank = $state('');

  let restricting = $state<Participant | null>(null);
  let permissions = $state<Permissions>({...ALL_ALLOWED});
  let duration = $state(0);

  let reload = $state(0);

  $effect(() => {
    const peerId = chat.peerId;
    const which = mode;
    reload;
    loading = true;
    error = '';

    fetchList(peerId, which)
      .then((loaded) => {
        if (peerId === chat.peerId && which === mode) list = loaded;
      })
      .catch((err: any) => (error = err?.type || err?.message || 'Failed to load the list'))
      .finally(() => (loading = false));
  });

  async function fetchList(peerId: number, which: typeof mode): Promise<Participant[]> {
    if (which === 'admins') return loadAdmins(peerId);
    if (which === 'members') return loadMembers(peerId);

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

  let shown = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.username.toLowerCase().includes(needle)
    );
  });

  let rightKeys = $derived(adminRightKeysFor(chat));
  let permissionKeys = $derived(
    PERMISSION_ORDER.filter((key) => key !== 'topics' || chat.isForum)
  );

  function refresh() {
    reload += 1;
    onchanged();
  }

  function fail(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  function describeRights(participant: Participant): string {
    if (participant.kind === 'creator') return participant.rank || 'Owner';
    if (participant.rank) return participant.rank;

    const granted = rightKeys.filter((key) => participant.rights[key]);
    if (!granted.length) return 'Admin';
    if (granted.length === rightKeys.length) return 'Full rights';
    return `${granted.length} of ${rightKeys.length} rights`;
  }

  function describeRestriction(participant: Participant): string {
    if (participant.kind === 'banned') {
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
    if (participant.kind === 'admin' || participant.kind === 'creator') {
      for (const key of rightKeys) if (participant.rights[key]) start[key] = true;
    } else {
      for (const key of rightKeys) if (key !== 'add_admins') start[key] = true;
    }

    rights = start;
    rank = participant.rank;
    restricting = null;
    promoting = participant;
  }

  function openRestrict(participant: Participant) {
    permissions = {...participant.permissions};
    duration = 0;
    promoting = null;
    restricting = participant;
  }

  function closeEditors() {
    promoting = null;
    restricting = null;
  }

  function toggleRight(key: AdminRightKey) {
    rights = {...rights, [key]: !rights[key]};
  }

  function togglePermission(key: PermissionKey) {
    permissions = {...permissions, [key]: !permissions[key]};
  }

  async function savePromotion() {
    if (!promoting || busy) return;
    busy = true;
    error = '';

    try {
      await promoteMember(chat.peerId, promoting.peerId, {...rights}, rank);
      closeEditors();
      refresh();
    } catch (err: any) {
      fail(err, 'Failed to save the admin rights');
    } finally {
      busy = false;
    }
  }

  async function saveRestriction() {
    if (!restricting || busy) return;
    busy = true;
    error = '';

    try {
      await restrictMember(
        chat.peerId,
        restricting.peerId,
        {...permissions},
        untilDateFrom(duration)
      );
      closeEditors();
      refresh();
    } catch (err: any) {
      fail(err, 'Failed to save the restrictions');
    } finally {
      busy = false;
    }
  }

  async function run(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await action();
      refresh();
    } catch (err: any) {
      fail(err, fallback);
    } finally {
      busy = false;
    }
  }

  const dismiss = (participant: Participant) =>
    run(() => demoteAdmin(chat.peerId, participant.peerId), 'Failed to dismiss the admin');

  const ban = (participant: Participant) =>
    run(() => banMember(chat.peerId, participant.peerId), 'Failed to remove the member');

  const unban = (participant: Participant) =>
    run(() => unbanMember(chat.peerId, participant.peerId), 'Failed to let them back in');

  const emptyText = $derived(
    mode === 'admins' ? 'No admins yet.' : mode === 'removed' ? 'Nobody is removed.' : 'No members.'
  );
</script>

<div class="pane">
  {#if promoting}
    <div class="editor">
      <header>
        <span>{promoting.title}</span>
        <button class="admin-btn" onclick={closeEditors} disabled={busy}>Back</button>
      </header>

      {#each rightKeys as key (key)}
        <label class="admin-toggle">
          <input type="checkbox" checked={!!rights[key]} onchange={() => toggleRight(key)} disabled={busy} />
          <span>{adminRightLabel(key)}</span>
        </label>
      {/each}

      <label class="admin-field">
        <span>Custom title</span>
        <input bind:value={rank} maxlength="16" placeholder="admin" />
      </label>

      <div class="admin-actions">
        {#if promoting.kind === 'admin'}
          <button class="admin-btn danger" onclick={() => dismiss(promoting!)} disabled={busy}>
            Dismiss
          </button>
        {/if}
        <button class="admin-btn primary" onclick={savePromotion} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {:else if restricting}
    <div class="editor">
      <header>
        <span>{restricting.title}</span>
        <button class="admin-btn" onclick={closeEditors} disabled={busy}>Back</button>
      </header>

      <p class="admin-hint">Switch off what this member may no longer do.</p>

      {#each permissionKeys as key (key)}
        <label class="admin-toggle">
          <input
            type="checkbox"
            checked={permissions[key]}
            onchange={() => togglePermission(key)}
            disabled={busy}
          />
          <span>{PERMISSION_LABELS[key]}</span>
        </label>
      {/each}

      <p class="admin-label">Duration</p>
      <div class="chips">
        {#each RESTRICTION_DURATIONS as option (option.seconds)}
          <button
            class:on={duration === option.seconds}
            onclick={() => (duration = option.seconds)}
            disabled={busy}
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div class="admin-actions">
        <button class="admin-btn danger" onclick={() => ban(restricting!)} disabled={busy}>
          Remove from chat
        </button>
        <button class="admin-btn primary" onclick={saveRestriction} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  {:else}
    {#if mode !== 'admins'}
      <input class="search" bind:value={query} placeholder="Search" spellcheck="false" />
    {/if}

    {#if loading}
      <p class="admin-muted">Loading…</p>
    {:else if !shown.length}
      <p class="admin-muted">{emptyText}</p>
    {:else}
      {#each shown as participant (participant.peerId)}
        <div class="admin-row">
          <button class="admin-peer" onclick={() => onpeer?.(participant.peerId)}>
            <Avatar peerId={participant.peerId} title={participant.title} size={32} />
            <span class="admin-name">
              <span>{participant.title}</span>
              <span class="admin-sub">
                {#if mode === 'removed'}
                  {describeRestriction(participant)}
                {:else if participant.kind === 'creator' || participant.kind === 'admin'}
                  {describeRights(participant)}
                {:else if participant.username}
                  @{participant.username}
                {:else}
                  Member
                {/if}
              </span>
            </span>
          </button>

          <div class="row-actions">
            {#if mode === 'removed'}
              <button class="admin-btn" onclick={() => unban(participant)} disabled={busy}>
                Unban
              </button>
              {#if participant.kind === 'restricted'}
                <button class="admin-btn" onclick={() => openRestrict(participant)} disabled={busy}>
                  Edit
                </button>
              {/if}
            {:else if participant.kind === 'creator'}
              <span class="admin-sub">Owner</span>
            {:else if participant.kind === 'admin'}
              {#if chat.access.addAdmins}
                <button class="admin-btn" onclick={() => openPromote(participant)} disabled={busy}>
                  Edit
                </button>
              {/if}
            {:else}
              {#if chat.access.addAdmins}
                <button class="admin-btn" onclick={() => openPromote(participant)} disabled={busy}>
                  Promote
                </button>
              {/if}
              {#if chat.access.banUsers && !chat.isBasicGroup}
                <button class="admin-btn" onclick={() => openRestrict(participant)} disabled={busy}>
                  Restrict
                </button>
              {/if}
              {#if chat.access.banUsers}
                <button class="admin-btn danger" onclick={() => ban(participant)} disabled={busy}>
                  Remove
                </button>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    {/if}

    {#if mode === 'admins' && chat.access.isCreator}
      <p class="admin-hint">
        Transferring ownership is not available in this client yet.
      </p>
    {/if}
  {/if}

  {#if error}<p class="admin-error">{error}</p>{/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 6px;
    align-content: start;
  }

  .editor {
    display: grid;
    gap: 8px;
  }

  .editor header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-weight: 600;
  }

  .editor header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search {
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    outline: none;
  }

  .search:focus {
    border-color: var(--accent);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .admin-sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .chips button.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .chips button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
