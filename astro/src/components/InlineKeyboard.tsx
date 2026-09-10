/*
 * Ported from svelte/src/lib/components/InlineKeyboard.svelte.
 *
 * The `{#each}` keyed on `rowIndex` and on `button.column` becomes `key` on the
 * returned element, and `{@const key = …}` a `const` inside the map callback.
 */
import type {MessageButton} from '$lib/telegram/chats';

import './InlineKeyboard.css';

interface Props {
  buttons: MessageButton[][];
  /** `row:column` of the button waiting on the bot, '' when none is. */
  busyKey?: string;
  onpress: (button: MessageButton) => void;
}

export function InlineKeyboard({buttons, busyKey = '', onpress}: Props) {
  /**
   * A glyph telling the user what the button will do before they press it —
   * a link leaves the app, a web app opens in it, a buy button costs money.
   */
  function icon(kind: MessageButton['kind']): string {
    switch(kind) {
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
    switch(button.kind) {
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

  return (
    <div class="keyboard">
      {buttons.map((row, rowIndex) => (
        <div class="keyboard-row" key={rowIndex}>
          {row.map((button) => {
            const key = `${button.row}:${button.column}`;

            return (
              <button
                key={button.column}
                class={['keyboard-btn', busyKey === key && 'busy'].filter(Boolean).join(' ')}
                disabled={button.kind === 'unsupported' || busyKey === key}
                title={hint(button)}
                onClick={() => onpress(button)}
              >
                {busyKey === key ?
                  <span class="kb-spinner" aria-hidden="true"></span> :
                  icon(button.kind) && <span class="kb-icon">{icon(button.kind)}</span>}
                {button.text}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
