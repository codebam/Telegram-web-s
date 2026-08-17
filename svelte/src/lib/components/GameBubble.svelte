<script lang="ts">
  import {loadCoverUrl, playGame, type GameExtra} from '$lib/telegram/messageTypes';

  let {
    peerId,
    mid,
    game,
    onerror
  }: {
    peerId: number;
    mid: number;
    game: GameExtra;
    onerror?: (message: string) => void;
  } = $props();

  let url = $state<string | null>(null);
  let launching = $state(false);

  $effect(() => {
    if (!game.hasPhoto) return;
    const key = `${peerId}_${mid}`;
    url = null;
    loadCoverUrl(peerId, mid).then((resolved) => {
      if (key === `${peerId}_${mid}`) url = resolved;
    });
  });

  async function play() {
    if (launching) return;
    launching = true;
    try {
      // The bot mints a one-time session URL. Open it in a tab: this client has
      // no in-app browser to host a game frame.
      const gameUrl = await playGame(peerId, mid);
      if (gameUrl) window.open(gameUrl, '_blank', 'noopener,noreferrer');
      else onerror?.('The bot did not return a game link');
    } catch (err: any) {
      onerror?.(err?.message || 'Could not start the game');
    } finally {
      launching = false;
    }
  }
</script>

<div class="game">
  {#if url}
    <img src={url} alt={game.title} />
  {/if}
  <span class="title">{game.title}</span>
  {#if game.description}
    <span class="desc">{game.description}</span>
  {/if}
  <button onclick={play} disabled={launching}>
    {launching ? 'Starting…' : '▶ Play'}
  </button>
</div>

<style>
  .game {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 320px;
  }

  img {
    width: 100%;
    border-radius: 10px;
    display: block;
  }

  .title {
    font-weight: 600;
    font-size: 14px;
  }

  .desc {
    font-size: 13px;
    color: var(--text-dim);
  }

  button {
    margin-top: 4px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--accent);
    font-size: 13px;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
