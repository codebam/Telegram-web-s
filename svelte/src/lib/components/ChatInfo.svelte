<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {loadChatInfo, type ChatInfo} from '$lib/telegram/chats';

  let {peerId, onclose}: {peerId: number; onclose: () => void} = $props();

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
            <div class="member">
              <Avatar peerId={member.peerId} title={member.title} size={32} />
              <span>{member.title}</span>
            </div>
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
    border-left: 1px solid var(--border);
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
    padding: 6px 0;
    font-size: 14px;
  }

  .muted {
    color: var(--text-dim);
  }
</style>
