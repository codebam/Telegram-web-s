<script lang="ts">
  import type {ReplyKeyboardButton, ReplyKeyboardState} from '$lib/telegram/botUi';

  let {
    keyboard,
    onpress,
    onclose
  }: {
    keyboard: ReplyKeyboardState;
    onpress: (button: ReplyKeyboardButton) => void;
    onclose: () => void;
  } = $props();

  function icon(kind: ReplyKeyboardButton['kind']): string {
    switch (kind) {
      case 'requestPhone':
        return '📞';
      case 'requestGeo':
        return '📍';
      case 'requestPoll':
        return '📊';
      case 'webview':
      case 'simpleWebView':
        return '▸';
      default:
        return '';
    }
  }
</script>

<!--
  The bot's own keyboard takes the composer's place while it is open, exactly
  like the mobile clients: `resize` keeps the rows at their natural height
  instead of filling the pane.
-->
<div class="reply-keyboard" class:resized={keyboard.resize}>
  <div class="rk-head">
    <span class="rk-title">{keyboard.placeholder || 'Bot keyboard'}</span>
    <button type="button" class="rk-close" onclick={onclose} aria-label="Hide keyboard">✕</button>
  </div>
  <div class="rk-rows">
    {#each keyboard.rows as row, rowIndex (rowIndex)}
      <div class="rk-row">
        {#each row as button (button.column)}
          <button
            type="button"
            class="rk-btn"
            disabled={button.kind === 'unsupported'}
            title={button.kind === 'unsupported' ? 'This button is not supported yet' : button.text}
            onclick={() => onpress(button)}
          >
            {#if icon(button.kind)}<span class="rk-icon">{icon(button.kind)}</span>{/if}
            {button.text}
          </button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .reply-keyboard {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-solid);
    max-height: 45vh;
    overflow-y: auto;
  }

  .rk-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rk-title {
    flex: 1;
    font-size: 0.8rem;
    opacity: 0.65;
  }

  .rk-close {
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 2px 6px;
  }

  .rk-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rk-row {
    display: flex;
    gap: 6px;
  }

  .rk-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 42px;
    padding: 8px 10px;
    border: none;
    border-radius: 10px;
    background: var(--bg-elevated);
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .resized .rk-btn {
    min-height: 34px;
  }

  .rk-btn:hover:not(:disabled) {
    background: var(--row-active);
  }

  .rk-btn:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .rk-icon {
    opacity: 0.75;
    font-size: 0.9em;
  }
</style>
