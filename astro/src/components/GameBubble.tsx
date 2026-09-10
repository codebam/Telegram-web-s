/*
 * Ported from svelte/src/lib/components/GameBubble.svelte.
 *
 * The cover effect depends on props, so it is a `useEffect` keyed on the two ids
 * and `game.hasPhoto` — the exact reads the Svelte effect tracked. The
 * comparison inside the async callback needs the *current* key, which in Svelte a
 * `.then()` could read directly; in JSX the closure sees the render that started
 * the load, so the latest key lives in a ref.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadCoverUrl, playGame, type GameExtra} from '$lib/telegram/messageTypes';

import './GameBubble.css';

interface Props {
  peerId: number;
  mid: number;
  game: GameExtra;
  onerror?: (message: string) => void;
}

export function GameBubble({peerId, mid, game, onerror}: Props) {
  const url = useSignal<string | null>(null);
  const launching = useSignal(false);

  const currentKey = useRef(`${peerId}_${mid}`);
  currentKey.current = `${peerId}_${mid}`;

  useEffect(() => {
    if(!game.hasPhoto) return;
    const key = `${peerId}_${mid}`;
    url.value = null;
    loadCoverUrl(peerId, mid).then((resolved) => {
      if(key === currentKey.current) url.value = resolved;
    });
  }, [peerId, mid, game.hasPhoto]);

  async function play() {
    if(launching.value) return;
    launching.value = true;
    try {
      // The bot mints a one-time session URL. Open it in a tab: this client has
      // no in-app browser to host a game frame.
      const gameUrl = await playGame(peerId, mid);
      if(gameUrl) window.open(gameUrl, '_blank', 'noopener,noreferrer');
      else onerror?.('The bot did not return a game link');
    } catch(err) {
      onerror?.(err?.message || 'Could not start the game');
    } finally {
      launching.value = false;
    }
  }

  return (
    <div class="game">
      {url.value && (
        <img src={url.value} alt={game.title} />
      )}
      <span class="title">{game.title}</span>
      {game.description && (
        <span class="desc">{game.description}</span>
      )}
      <button onClick={play} disabled={launching.value}>
        {launching.value ? 'Starting…' : '▶ Play'}
      </button>
    </div>
  );
}
