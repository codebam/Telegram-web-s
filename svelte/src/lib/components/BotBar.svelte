<script lang="ts">
  import type {BotChatState} from '$lib/telegram/botUi';

  let {
    bot,
    busy = false,
    onstart,
    onstop,
    onrestart,
    onclear
  }: {
    bot: BotChatState;
    busy?: boolean;
    onstart: () => void;
    onstop: () => void;
    onrestart: () => void;
    onclear: () => void;
  } = $props();

  let menuOpen = $state(false);
</script>

<!--
  A blocked bot cannot be written to, and a bot you have never spoken to opens
  on START instead of a text box — the same two states the mobile clients show.
  The rest of the bot actions live behind the ⋯ button so the composer keeps
  its room.
-->
<div class="bot-bar">
  {#if bot.blocked}
    <button type="button" class="bot-primary" disabled={busy} onclick={onrestart}>
      Restart bot
    </button>
  {:else if bot.fresh}
    <button type="button" class="bot-primary" disabled={busy} onclick={onstart}>START</button>
  {/if}

  <button
    type="button"
    class="bot-more"
    aria-label="Bot actions"
    aria-expanded={menuOpen}
    onclick={() => (menuOpen = !menuOpen)}
  >⋯</button>

  {#if menuOpen}
    <div class="bot-menu">
      {#if bot.blocked}
        <button type="button" onclick={() => { menuOpen = false; onrestart(); }}>Restart bot</button>
      {:else}
        <button type="button" onclick={() => { menuOpen = false; onstop(); }}>Stop bot</button>
      {/if}
      <button type="button" onclick={() => { menuOpen = false; onclear(); }}>Clear history</button>
    </div>
  {/if}
</div>

<style>
  .bot-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
  }

  .bot-primary {
    flex: 1;
    min-height: 36px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .bot-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .bot-more {
    margin-left: auto;
    border: none;
    background: none;
    color: inherit;
    font-size: 1.1rem;
    padding: 4px 8px;
    cursor: pointer;
  }

  .bot-menu {
    position: absolute;
    right: 8px;
    bottom: 100%;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    padding: 4px;
    border-radius: 10px;
    background: var(--bg-solid);
    box-shadow: 0 4px 18px rgb(0 0 0 / 0.25);
    z-index: 5;
  }

  .bot-menu button {
    padding: 8px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .bot-menu button:hover {
    background: var(--row-active);
  }
</style>
