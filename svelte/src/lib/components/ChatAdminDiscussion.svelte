<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    loadDiscussionCandidates,
    loadLinkedChat,
    setDiscussionGroup,
    unlinkDiscussionGroup,
    type AdminChat,
    type DiscussionCandidate
  } from '$lib/telegram/admin';

  let {chat, onchanged}: {chat: AdminChat; onchanged: () => void} = $props();

  let candidates = $state<DiscussionCandidate[]>([]);
  let linked = $state<DiscussionCandidate | null>(null);
  let loading = $state(true);
  let error = $state('');
  let busy = $state(false);

  // The linked chat lives on the channel's full info as a chat id.
  let linkedPeerId = $derived(chat.linkedChatId ? -chat.linkedChatId : 0);

  $effect(() => {
    const peerId = chat.peerId;
    const wanted = linkedPeerId;
    loading = true;
    error = '';

    // `getGroupsForDiscussion` only offers free groups, so the one already
    // linked has to be read separately or its name never shows.
    Promise.all([
      wanted ? Promise.resolve([]) : loadDiscussionCandidates(),
      loadLinkedChat(wanted)
    ])
      .then(([available, current]) => {
        if (peerId !== chat.peerId) return;
        candidates = available;
        linked = current;
      })
      .catch((err: any) => (error = err?.type || err?.message || 'Failed to load the groups'))
      .finally(() => (loading = false));
  });

  async function run(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await action();
      onchanged();
    } catch (err: any) {
      error = err?.type || err?.message || fallback;
    } finally {
      busy = false;
    }
  }

  function link(candidate: DiscussionCandidate) {
    // Linking unhides the group's history: everyone who can read the channel
    // must be able to read the comments, and the API enforces it.
    if (!confirm(`Link “${candidate.title}” as the discussion group? Its past messages become visible to everyone.`)) {
      return;
    }
    run(() => setDiscussionGroup(chat.peerId, candidate.peerId), 'Failed to link the group');
  }

  const unlink = () =>
    run(() => unlinkDiscussionGroup(chat.peerId), 'Failed to unlink the group');
</script>

<div class="pane">
  {#if linkedPeerId}
    <p class="admin-label">Discussion group</p>
    <div class="admin-row">
      <span class="admin-peer">
        <Avatar peerId={linkedPeerId} title={linked?.title ?? 'Group'} size={32} />
        <span class="admin-name">
          <span>{linked?.title ?? 'Linked group'}</span>
          {#if linked?.username}<span class="admin-sub">@{linked.username}</span>{/if}
        </span>
      </span>
      <button class="admin-btn danger" onclick={unlink} disabled={busy}>Unlink</button>
    </div>
    <p class="admin-hint">Comments on posts in this channel go to that group.</p>
  {:else}
    <p class="admin-hint">
      Pick a group where readers can comment on the posts in this channel.
    </p>

    {#if loading}
      <p class="admin-muted">Loading…</p>
    {:else if !candidates.length}
      <p class="admin-muted">No group you own can be linked.</p>
    {:else}
      {#each candidates as candidate (candidate.peerId)}
        <div class="admin-row">
          <span class="admin-peer">
            <Avatar peerId={candidate.peerId} title={candidate.title} size={32} />
            <span class="admin-name">
              <span>{candidate.title}</span>
              {#if candidate.username}<span class="admin-sub">@{candidate.username}</span>{/if}
            </span>
          </span>
          <button class="admin-btn" onclick={() => link(candidate)} disabled={busy}>Link</button>
        </div>
      {/each}
    {/if}
  {/if}

  {#if error}<p class="admin-error">{error}</p>{/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 8px;
    align-content: start;
  }

  .admin-sub {
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
