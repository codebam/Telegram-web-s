<script lang="ts">
  import Avatar from './Avatar.svelte';
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

  let {
    chat,
    mode,
    onpeer
  }: {
    chat: AdminChat;
    mode: 'links' | 'requests';
    onpeer?: (peerId: number) => void;
  } = $props();

  let links = $state<InviteLink[]>([]);
  let revoked = $state<InviteLink[]>([]);
  let requests = $state<JoinRequest[]>([]);

  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);
  let status = $state('');
  let reload = $state(0);

  // The editor doubles as the "create" form: an empty `editing` link means new.
  let editorOpen = $state(false);
  let editing = $state<InviteLink | null>(null);
  let title = $state('');
  let expiryDays = $state(0);
  let usageLimit = $state(0);
  let requestNeeded = $state(false);

  $effect(() => {
    const peerId = chat.peerId;
    const which = mode;
    reload;
    loading = true;
    error = '';

    const load = which === 'links' ?
      Promise.all([loadInviteLinks(peerId), loadInviteLinks(peerId, true)]).then(([active, dead]) => {
        if (peerId !== chat.peerId) return;
        links = active;
        revoked = dead;
      }) :
      loadJoinRequests(peerId).then((loaded) => {
        if (peerId === chat.peerId) requests = loaded;
      });

    load
      .catch((err: any) => (error = err?.type || err?.message || 'Failed to load'))
      .finally(() => (loading = false));
  });

  function refresh() {
    reload += 1;
  }

  function fail(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
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

  function openCreate() {
    editing = null;
    title = '';
    expiryDays = 0;
    usageLimit = 0;
    requestNeeded = false;
    editorOpen = true;
  }

  function openEdit(link: InviteLink) {
    editing = link;
    title = link.title;
    // The server stores an absolute moment; the form offers durations, so an
    // existing expiry that is not one of them shows as "Never" and is only
    // rewritten if the user actually picks something.
    expiryDays = 0;
    usageLimit = link.usageLimit;
    requestNeeded = link.requestNeeded;
    editorOpen = true;
  }

  function optionsFromForm(): InviteLinkOptions {
    return {
      title: title.trim(),
      expireDate: expiryDays ? Math.floor(Date.now() / 1000) + expiryDays * 86400 : 0,
      usageLimit,
      requestNeeded
    };
  }

  async function saveLink() {
    if (busy) return;
    busy = true;
    error = '';

    try {
      const options = optionsFromForm();
      if (editing) await editInviteLink(chat.peerId, editing.link, options);
      else await createInviteLink(chat.peerId, options);
      editorOpen = false;
      refresh();
    } catch (err: any) {
      fail(err, 'Failed to save the invite link');
    } finally {
      busy = false;
    }
  }

  async function copy(link: InviteLink) {
    try {
      await navigator.clipboard.writeText(link.link);
      flash('Link copied');
    } catch (err: any) {
      fail(err, 'Failed to copy the link');
    }
  }

  function share(link: InviteLink) {
    // `navigator.share` is the phone path; on a desktop browser without it a
    // copy is the closest useful thing rather than a dead button.
    if (navigator.share) {
      navigator.share({url: link.link, title: chat.title}).catch(() => {});
      return;
    }
    copy(link);
  }

  function describe(link: InviteLink): string {
    const parts: string[] = [];
    if (link.usageLimit) parts.push(`${link.usage}/${link.usageLimit} used`);
    else if (link.usage) parts.push(`${link.usage} joined`);
    if (link.requested) parts.push(`${link.requested} pending`);
    if (link.requestNeeded) parts.push('needs approval');

    const expiry = formatExpiry(link.expireDate);
    if (expiry) parts.push(expiry);
    if (!parts.length) parts.push(formatDate(link.date));
    return parts.join(' · ');
  }
</script>

<div class="pane">
  {#if mode === 'links'}
    {#if editorOpen}
      <div class="editor">
        <header>
          <span>{editing ? 'Edit link' : 'New link'}</span>
          <button class="admin-btn" onclick={() => (editorOpen = false)} disabled={busy}>Back</button>
        </header>

        <label class="admin-field">
          <span>Name</span>
          <input bind:value={title} maxlength="32" placeholder="optional" />
        </label>

        <p class="admin-label">Expires</p>
        <div class="chips">
          {#each EXPIRY_OPTIONS as option (option.days)}
            <button class:on={expiryDays === option.days} onclick={() => (expiryDays = option.days)}>
              {option.label}
            </button>
          {/each}
        </div>

        <p class="admin-label">Uses</p>
        <div class="chips">
          {#each USAGE_OPTIONS as option (option.limit)}
            <button
              class:on={usageLimit === option.limit}
              onclick={() => (usageLimit = option.limit)}
              disabled={requestNeeded}
            >
              {option.label}
            </button>
          {/each}
        </div>

        <label class="admin-toggle">
          <input type="checkbox" bind:checked={requestNeeded} />
          <span>Approve new members</span>
        </label>
        <p class="admin-hint">A link that needs approval cannot also have a usage limit.</p>

        <div class="admin-actions">
          <button class="admin-btn primary" onclick={saveLink} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    {:else}
      <div class="admin-actions left">
        <button class="admin-btn primary" onclick={openCreate} disabled={busy}>New link</button>
      </div>

      {#if loading}
        <p class="admin-muted">Loading…</p>
      {:else}
        {#if !links.length}
          <p class="admin-muted">No invite links.</p>
        {/if}

        {#each links as link (link.link)}
          <div class="link-card">
            <span class="link-title">{link.title || link.link}</span>
            <span class="admin-sub">{describe(link)}</span>
            <div class="link-actions">
              <button class="admin-btn" onclick={() => copy(link)}>Copy</button>
              <button class="admin-btn" onclick={() => share(link)}>Share</button>
              {#if !link.permanent}
                <button class="admin-btn" onclick={() => openEdit(link)} disabled={busy}>Edit</button>
              {/if}
              <button
                class="admin-btn danger"
                onclick={() => run(() => revokeInviteLink(chat.peerId, link.link), 'Failed to revoke')}
                disabled={busy}
              >
                Revoke
              </button>
            </div>
          </div>
        {/each}

        {#if revoked.length}
          <section>
            <div class="revoked-head">
              <p class="admin-label">Revoked</p>
              <button
                class="admin-btn danger"
                onclick={() =>
                  run(() => deleteRevokedInviteLinks(chat.peerId), 'Failed to delete the revoked links')}
                disabled={busy}
              >
                Delete all
              </button>
            </div>

            {#each revoked as link (link.link)}
              <div class="link-card">
                <span class="link-title">{link.title || link.link}</span>
                <span class="admin-sub">{describe(link)}</span>
                <div class="link-actions">
                  <button
                    class="admin-btn danger"
                    onclick={() =>
                      run(() => deleteInviteLink(chat.peerId, link.link), 'Failed to delete')}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </div>
            {/each}
          </section>
        {/if}
      {/if}
    {/if}
  {:else if loading}
    <p class="admin-muted">Loading…</p>
  {:else if !requests.length}
    <p class="admin-muted">No pending requests.</p>
  {:else}
    {#each requests as request (request.peerId)}
      <div class="admin-row">
        <button class="admin-peer" onclick={() => onpeer?.(request.peerId)}>
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
            onclick={() =>
              run(() => resolveJoinRequest(chat.peerId, request.peerId, true), 'Failed to approve')}
            disabled={busy}
          >
            Approve
          </button>
          <button
            class="admin-btn danger"
            onclick={() =>
              run(() => resolveJoinRequest(chat.peerId, request.peerId, false), 'Failed to decline')}
            disabled={busy}
          >
            Decline
          </button>
        </div>
      </div>
    {/each}
  {/if}

  {#if error}<p class="admin-error">{error}</p>{/if}
  {#if status}<p class="admin-ok">{status}</p>{/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 8px;
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

  section {
    display: grid;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .revoked-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .link-card {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .link-title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
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
