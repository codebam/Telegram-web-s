<script lang="ts">
  import type {MessageButton} from '$lib/telegram/chats';

  let {
    buttons,
    busyKey = '',
    onpress
  }: {
    buttons: MessageButton[][];
    /** `row:column` of the button waiting on the bot, '' when none is. */
    busyKey?: string;
    onpress: (button: MessageButton) => void;
  } = $props();

  /**
   * A glyph telling the user what the button will do before they press it —
   * a link leaves the app, a web app opens in it, a buy button costs money.
   */
  function icon(kind: MessageButton['kind']): string {
    switch (kind) {
      case 'url':
        return '↗';
      case 'loginUrl':
        return '🔑';
      case 'webview':
      case 'simpleWebView':
      case 'game':
        return '▸';
      case 'switchInline':
        return '↩';
      case 'copy':
        return '⧉';
      case 'buy':
        return '💳';
      case 'userProfile':
        return '👤';
      case 'requestPhone':
        return '📞';
      case 'requestGeo':
        return '📍';
      case 'requestPoll':
        return '📊';
      default:
        return '';
    }
  }

  function hint(button: MessageButton): string {
    switch (button.kind) {
      case 'url':
      case 'loginUrl':
        return button.url;
      case 'switchInline':
        return button.samePeer ? 'Use here' : 'Send to another chat';
      case 'copy':
        return 'Copy to clipboard';
      case 'unsupported':
        return 'This button is not supported yet';
      default:
        return button.text;
    }
  }
</script>

<div class="keyboard">
  {#each buttons as row, rowIndex (rowIndex)}
    <div class="keyboard-row">
      {#each row as button (button.column)}
        {@const key = `${button.row}:${button.column}`}
        <button
          class="keyboard-btn"
          class:busy={busyKey === key}
          disabled={button.kind === 'unsupported' || busyKey === key}
          title={hint(button)}
          onclick={() => onpress(button)}
        >
          {#if busyKey === key}
            <span class="kb-spinner" aria-hidden="true"></span>
          {:else if icon(button.kind)}
            <span class="kb-icon">{icon(button.kind)}</span>
          {/if}
          {button.text}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .keyboard {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 6px;
  }

  .keyboard-row {
    display: flex;
    gap: 3px;
  }

  .keyboard-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 30px;
    padding: 5px 8px;
    border: none;
    border-radius: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .keyboard-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .keyboard-btn:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .kb-icon {
    font-size: 0.8em;
    opacity: 0.8;
  }

  .kb-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: kb-spin 0.7s linear infinite;
  }

  @keyframes kb-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
