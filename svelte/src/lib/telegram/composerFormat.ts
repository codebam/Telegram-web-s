/**
 * Composer formatting: the outgoing half of message text.
 *
 * `markdown.ts` is the incoming half — it turns text a bot wrote into blocks
 * and tokens for the renderer. This module goes the other way: it turns what
 * someone typed into `MessageEntity[]` for the API, and turns entities on an
 * existing message back into typed markers so an edit round-trips.
 *
 * The syntax matches what tweb's own `parseMarkdown` accepts, so text that
 * survives untouched here is still understood downstream:
 *
 *   **bold**  __italic__  _-_underline_-_  ~~strike~~  ||spoiler||
 *   `code`  ```lang\ncode```  [text](url)
 *
 * The difference is that this parser nests, spans newlines and works
 * mid-word, none of which the single regex in tweb manages.
 *
 * Caveat: `appMessagesManager` runs its own `parseMarkdown` over whatever we
 * hand it. Text already covered by an entity is safe — a conflicting entity is
 * refused, so `` `a**b**c` `` keeps its asterisks — but a backslash-escaped
 * marker in ordinary text (`\*\*not bold\*\*`) is unescaped here and then
 * picked up by that second pass.
 */

import type {MessageEntity} from '@layer';
import type {TextPart} from './chats';

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'mono'
  | 'spoiler'
  | 'link';

type Wrapper = {
  marker: string;
  type: MessageEntity['_'];
};

/** Longest marker first: `_-_` must win over `__`. */
const WRAPPERS: Wrapper[] = [
  {marker: '_-_', type: 'messageEntityUnderline'},
  {marker: '**', type: 'messageEntityBold'},
  {marker: '__', type: 'messageEntityItalic'},
  {marker: '~~', type: 'messageEntityStrike'},
  {marker: '||', type: 'messageEntitySpoiler'}
];

const MARKER_OF: Record<Exclude<FormatKind, 'link' | 'mono'>, string> = {
  bold: '**',
  italic: '__',
  underline: '_-_',
  strike: '~~',
  spoiler: '||'
};

const ESCAPABLE = '\\`*_~|[]()';
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;
const LANGUAGE = /^[\w+#.-]{1,32}$/;

type Sink = {
  text: string;
  entities: MessageEntity[];
};

function parseInto(src: string, sink: Sink): void {
  let i = 0;

  while(i < src.length) {
    const char = src[i];

    // Escapes: `\*` is a literal asterisk, not the start of emphasis.
    if(char === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      sink.text += src[i + 1];
      i += 2;
      continue;
    }

    // Fenced code. Its body is literal — no nested parsing.
    if(src.startsWith('```', i)) {
      const close = src.indexOf('```', i + 3);
      if(close !== -1) {
        let body = src.slice(i + 3, close);
        let language = '';

        const newline = body.indexOf('\n');
        if(newline !== -1) {
          const head = body.slice(0, newline);
          if(LANGUAGE.test(head)) {
            language = head;
            body = body.slice(newline + 1);
          }
        }

        if(body.startsWith('\n')) body = body.slice(1);
        if(body.endsWith('\n')) body = body.slice(0, -1);

        if(body) {
          sink.entities.push({
            _: 'messageEntityPre',
            language,
            offset: sink.text.length,
            length: body.length
          });
          sink.text += body;
        }

        i = close + 3;
        continue;
      }
    }

    // Inline code, likewise literal.
    if(char === '`') {
      const close = src.indexOf('`', i + 1);
      if(close > i + 1) {
        const body = src.slice(i + 1, close);
        sink.entities.push({
          _: 'messageEntityCode',
          offset: sink.text.length,
          length: body.length
        });
        sink.text += body;
        i = close + 1;
        continue;
      }
    }

    if(char === '[') {
      const match = LINK.exec(src.slice(i));
      if(match) {
        const offset = sink.text.length;
        parseInto(match[1], sink);
        const length = sink.text.length - offset;
        if(length) {
          sink.entities.push({_: 'messageEntityTextUrl', url: match[2], offset, length});
        }

        i += match[0].length;
        continue;
      }
    }

    const wrapper = WRAPPERS.find((candidate) => src.startsWith(candidate.marker, i));
    if(wrapper) {
      const from = i + wrapper.marker.length;
      const close = src.indexOf(wrapper.marker, from);
      if(close > from) {
        const offset = sink.text.length;
        parseInto(src.slice(from, close), sink);
        const length = sink.text.length - offset;
        if(length) {
          sink.entities.push({_: wrapper.type, offset, length} as MessageEntity);
        }

        i = close + wrapper.marker.length;
        continue;
      }
    }

    sink.text += char;
    i++;
  }
}

/**
 * Strip the markers out of what was typed and describe them as entities.
 * Entities come back sorted the way the API wants them: by offset, outermost
 * span first.
 */
export function parseComposerText(input: string): {text: string; entities: MessageEntity[]} {
  const sink: Sink = {text: '', entities: []};
  parseInto(input, sink);

  sink.entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return sink;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_~|[\]])/g, '\\$1');
}

/**
 * The reverse, for editing: put the markers back so the composer shows the
 * formatting the message already carries instead of dropping it on save.
 */
export function partsToMarkdown(parts: TextPart[]): string {
  return parts.map((part) => {
    if(part.pre) return '```\n' + part.text + '\n```';
    if(part.code) return '`' + part.text + '`';
    if(part.mention) return part.text;

    let text = escapeMarkdown(part.text);
    if(part.strike) text = `~~${text}~~`;
    if(part.underline) text = `_-_${text}_-_`;
    if(part.italic) text = `__${text}__`;
    if(part.bold) text = `**${text}**`;
    if(part.spoiler) text = `||${text}||`;
    if(part.url && part.url !== part.text) text = `[${text}](${part.url})`;
    return text;
  }).join('');
}

/**
 * Wrap (or unwrap, when the markers are already there) the selection. Empty
 * selections get an empty pair with the caret between the markers, which is
 * how a shortcut pressed before typing should behave.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  kind: FormatKind,
  url?: string
): {value: string; start: number; end: number} {
  const selected = value.slice(start, end);

  if(kind === 'link') {
    if(!url) return {value, start, end};
    const replacement = `[${selected || 'link'}](${url})`;
    return {
      value: value.slice(0, start) + replacement + value.slice(end),
      start: start + 1,
      end: start + 1 + (selected || 'link').length
    };
  }

  if(kind === 'mono') {
    // Multi-line selections read as a block, a single line as an inline span.
    const [open, close] = selected.includes('\n') ? ['```\n', '\n```'] : ['`', '`'];
    if(value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
      return {
        value: value.slice(0, start - open.length) + selected + value.slice(end + close.length),
        start: start - open.length,
        end: end - open.length
      };
    }

    return {
      value: value.slice(0, start) + open + selected + close + value.slice(end),
      start: start + open.length,
      end: end + open.length
    };
  }

  const marker = MARKER_OF[kind];
  const length = marker.length;

  if(value.slice(start - length, start) === marker && value.slice(end, end + length) === marker) {
    return {
      value: value.slice(0, start - length) + selected + value.slice(end + length),
      start: start - length,
      end: end - length
    };
  }

  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + length,
    end: end + length
  };
}

/** The formatting shortcut a key event asks for, if any. */
export function formatShortcut(e: KeyboardEvent): FormatKind | null {
  if(!(e.ctrlKey || e.metaKey) || e.altKey) return null;

  const key = e.key.toLowerCase();
  if(e.shiftKey) {
    if(key === 'm') return 'mono';
    if(key === 'p') return 'spoiler';
    if(key === 'x') return 'strike';
    return null;
  }

  if(key === 'b') return 'bold';
  if(key === 'i') return 'italic';
  if(key === 'u') return 'underline';
  if(key === 'k') return 'link';
  return null;
}
