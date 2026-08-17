<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {pollVoters, type PollVoter} from '$lib/telegram/messageTypes';
  import type {PollPreview} from '$lib/telegram/chats';

  let {
    peerId,
    mid,
    poll,
    onclose,
    onpeer
  }: {
    peerId: number;
    mid: number;
    poll: PollPreview;
    onclose: () => void;
    onpeer?: (peerId: number) => void;
  } = $props();

  let voters = $state<Record<number, PollVoter[]>>({});
  let loading = $state(true);
  /** Anonymous polls answer with nothing — that is the feature, not an error. */
  let anonymous = $state(false);

  $effect(() => {
    let alive = true;
    loading = true;

    Promise.all(poll.answers.map((_, index) => pollVoters(peerId, mid, index)))
      .then((lists) => {
        if (!alive) return;
        voters = lists.reduce((acc, list, index) => ({...acc, [index]: list}), {});
        anonymous = lists.every((list) => !list.length) && poll.totalVoters > 0;
      })
      .finally(() => {
        if (alive) loading = false;
      });

    return () => (alive = false);
  });
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>{poll.question || 'Poll results'}</header>
    <span class="total">{poll.totalVoters} voters{poll.closed ? ' · closed' : ''}</span>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if anonymous}
      <p class="muted">This poll is anonymous — individual votes are not shown.</p>
    {/if}

    <div class="list">
      {#each poll.answers as answer, index (index)}
        <section>
          <div class="answer">
            <span class="text">{answer.text}</span>
            <span class="pct">{answer.percent}% · {answer.voters}</span>
          </div>
          <span class="bar" style="width: {answer.percent}%"></span>
          {#each voters[index] ?? [] as voter (voter.peerId)}
            <button class="voter" onclick={() => onpeer?.(voter.peerId)}>
              <Avatar peerId={voter.peerId} title={voter.title} size={24} />
              <span>{voter.title}</span>
            </button>
          {/each}
        </section>
      {/each}
    </div>

    <footer><button onclick={onclose}>Close</button></footer>
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
    gap: 8px;
    padding: 18px;
    background: var(--bg-solid);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    color: var(--text);
  }

  header {
    font-weight: 600;
  }

  .total,
  .muted {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0;
  }

  .list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .answer {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }

  .pct {
    color: var(--text-dim);
    white-space: nowrap;
  }

  .bar {
    height: 3px;
    border-radius: 999px;
    background: var(--accent);
    min-width: 2px;
  }

  .voter {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }

  footer {
    display: flex;
    justify-content: flex-end;
  }

  footer button {
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
</style>
