/*
 * Ported from svelte/src/lib/components/BotBar.svelte.
 *
 * `menuOpen` was `$state(false)`, so it is a signal here; it is written and read
 * in the same click handlers the Svelte markup used, and only the markup reads
 * it back out.
 */
import {useSignal} from '@preact/signals';

import type {BotChatState} from '$lib/telegram/botUi';

import './BotBar.css';

interface Props {
  bot: BotChatState;
  busy?: boolean;
  onstart: () => void;
  onstop: () => void;
  onrestart: () => void;
  onclear: () => void;
}

export function BotBar({bot, busy = false, onstart, onstop, onrestart, onclear}: Props) {
  const menuOpen = useSignal(false);

  /*
   * A blocked bot cannot be written to, and a bot you have never spoken to opens
   * on START instead of a text box — the same two states the mobile clients show.
   * The rest of the bot actions live behind the ⋯ button so the composer keeps
   * its room.
   */
  return (
    <div class="bot-bar">
      {bot.blocked ?
        <button type="button" class="bot-primary" disabled={busy} onClick={onrestart}>
          Restart bot
        </button> :
        bot.fresh ?
          <button type="button" class="bot-primary" disabled={busy} onClick={onstart}>START</button> :
          null}

      <button
        type="button"
        class="bot-more"
        aria-label="Bot actions"
        aria-expanded={menuOpen.value}
        onClick={() => (menuOpen.value = !menuOpen.value)}
      >⋯</button>

      {menuOpen.value && (
        <div class="bot-menu">
          {bot.blocked ?
            <button type="button" onClick={() => { menuOpen.value = false; onrestart(); }}>Restart bot</button> :
            <button type="button" onClick={() => { menuOpen.value = false; onstop(); }}>Stop bot</button>}
          <button type="button" onClick={() => { menuOpen.value = false; onclear(); }}>Clear history</button>
        </div>
      )}
    </div>
  );
}
