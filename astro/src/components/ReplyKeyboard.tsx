/*
 * Ported from svelte/src/lib/components/ReplyKeyboard.svelte.
 *
 * `class:resized={keyboard.resize}` is the one class the markup builds at
 * runtime, so it became a single class string — the literal token `resized` is
 * still spelled out, which is what the parity guards check.
 */
import type {ReplyKeyboardButton, ReplyKeyboardState} from '$lib/telegram/botUi';

import './ReplyKeyboard.css';

interface Props {
  keyboard: ReplyKeyboardState;
  onpress: (button: ReplyKeyboardButton) => void;
  onclose: () => void;
}

export function ReplyKeyboard({keyboard, onpress, onclose}: Props) {
  function icon(kind: ReplyKeyboardButton['kind']): string {
    switch(kind) {
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

  /*
   * The bot's own keyboard takes the composer's place while it is open, exactly
   * like the mobile clients: `resize` keeps the rows at their natural height
   * instead of filling the pane.
   */
  return (
    <div class={['reply-keyboard', keyboard.resize && 'resized'].filter(Boolean).join(' ')}>
      <div class="rk-head">
        <span class="rk-title">{keyboard.placeholder || 'Bot keyboard'}</span>
        <button type="button" class="rk-close" onClick={onclose} aria-label="Hide keyboard">✕</button>
      </div>
      <div class="rk-rows">
        {keyboard.rows.map((row, rowIndex) => (
          <div key={rowIndex} class="rk-row">
            {row.map((button) => (
              <button
                key={button.column}
                type="button"
                class="rk-btn"
                disabled={button.kind === 'unsupported'}
                title={button.kind === 'unsupported' ? 'This button is not supported yet' : button.text}
                onClick={() => onpress(button)}
              >
                {icon(button.kind) && <span class="rk-icon">{icon(button.kind)}</span>}
                {button.text}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
