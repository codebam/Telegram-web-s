<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {loadChatInfo, type ChatInfo} from '$lib/telegram/chats';

  let {
    peerId,
    onclose,
    onmessage,
    onpeer
  }: {
    peerId: number;
    onclose: () => void;
    /** Open a direct chat with this peer. */
    onmessage?: (peerId: number) => void;
    /** Drill into another profile, e.g. a member of this group. */
    onpeer?: (peerId: number) => void;
  } = $props();

  let info = $state<ChatInfo | null>(null);
  let error = $state('');

  $effect(() => {
    const id = peerId;
    info = null;
    error = '';
    loadChatInfo(id)
      .then((loaded) => {
        if(id === peerId) info = loaded;
      })
      .catch((err) => (error = err?.type || err?.message || 'Failed to load info'));
  });
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
      </div>

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

<style>
  .info {
    width: 320px;
    flex: none;
    background: var(--bg-elevated);
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
  @media (max-width: 720px) {
    .info {
      position: fixed;
      inset: 0;
      width: 100%;
      background: var(--bg);
      z-index: 80;
    }
  }
</style>
