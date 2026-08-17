<script lang="ts">
  import {joinChatByInvite, joinChatlistByInvite, type LinkAction} from '$lib/telegram/links';

  let {
    action,
    onclose,
    onopenpeer
  }: {
    action: Extract<LinkAction, {type: 'joinChat'} | {type: 'addList'}>;
    onclose: () => void;
    onopenpeer: (peerId: number) => void;
  } = $props();

  let busy = $state(false);
  let error = $state('');

  // Shared folders let you pick which of their chats to import; default to all.
  let selected = $state(new Set<number>(action.type === 'addList' ? action.peers.map((p) => p.peerId) : []));

  function toggle(peerId: number) {
    const next = new Set(selected);
    if (next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected = next;
  }

  async function confirm() {
    if (busy) return;
    busy = true;
    error = '';

    try {
      if (action.type === 'joinChat') {
        const peerId = await joinChatByInvite(action.invite);
        onclose();
        // A request-to-join chat is not joined yet; there is nothing to open.
        if (!action.requestNeeded && peerId) onopenpeer(peerId);
        return;
      }

      // A plain Set is not structured-cloneable across the worker boundary, and
      // `selected` is a rune besides — hand over a plain array.
      await joinChatlistByInvite(action.slug, [...selected]);
      onclose();
    } catch (err: any) {
      error = err?.type || err?.message || 'Could not complete that';
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    {#if action.type === 'joinChat'}
      <header>{action.title}</header>
      {#if action.about}<p class="about">{action.about}</p>{/if}
      <p class="hint">
        {#if action.participantsCount}
          {action.participantsCount.toLocaleString()} members
        {/if}
      </p>
      <p class="hint">
        {action.requestNeeded
          ? 'An admin has to approve your request before you can join.'
          : 'Do you want to join this chat?'}
      </p>
    {:else}
      <header>{action.title}</header>
      <p class="hint">
        {action.peers.length
          ? `Add ${action.peers.length} chat${action.peers.length === 1 ? '' : 's'} to this folder?`
          : 'You have already added every chat from this folder.'}
      </p>

      <div class="list">
        {#each action.peers as peer (peer.peerId)}
          <button class="row" class:on={selected.has(peer.peerId)} onclick={() => toggle(peer.peerId)}>
            <span class="check">{selected.has(peer.peerId) ? '☑' : '☐'}</span>
            <span class="name">{peer.title}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <span class="spacer"></span>
      <button onclick={onclose} disabled={busy}>Cancel</button>
      <button
        class="primary"
        onclick={confirm}
        disabled={busy || (action.type === 'addList' && !selected.size)}
      >
        {#if busy}
          Working…
        {:else if action.type === 'joinChat'}
          {action.requestNeeded ? 'Request to join' : 'Join'}
        {:else}
          Add folder
        {/if}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 95;
  }

  .dialog {
    width: min(400px, calc(100vw - 32px));
    max-height: min(560px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px;
    gap: 10px;
  }

  header {
    font-weight: 600;
    font-size: 17px;
  }

  .about {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
  }

  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .hint:empty {
    display: none;
  }

  .list {
    overflow-y: auto;
    display: grid;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px;
    background: none;
    border: none;
    border-radius: 10px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 14px;
  }

  .row:hover {
    background: var(--bg-hover, rgba(127, 127, 127, 0.12));
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }

  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .spacer {
    flex: 1;
  }

  footer button {
    padding: 8px 12px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    cursor: pointer;
    font-size: 14px;
  }

  footer button:hover:not(:disabled) {
    border-color: var(--accent);
  }

  footer .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
