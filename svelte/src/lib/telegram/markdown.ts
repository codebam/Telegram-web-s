/**
 * A small Markdown parser for message text.
 *
 * Telegram has no entity for a heading or a table, so a bot that formats its
 * replies sends them as literal characters. This turns that back into
 * structure. It is deliberately narrow — only the constructs bots actually
 * emit — and it produces data, never HTML, so the renderer cannot inject
 * markup from a message.
 */

export type InlineToken = {
  type: 'text' | 'code' | 'link' | 'mention';
  text: string;
  href?: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
};

export type Block =
  | {type: 'paragraph'; text: string}
  | {type: 'heading'; level: number; text: string}
  | {type: 'code'; text: string; lang: string}
  | {type: 'quote'; text: string}
  | {type: 'rule'}
  | {type: 'list'; ordered: boolean; items: string[]}
  | {type: 'table'; headers: string[]; rows: string[][]; align: ('left' | 'center' | 'right')[]};

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([*\-_])\s*\1\s*\1[\s*\-_]*$/;
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/** True when the text is worth running through the block parser at all. */
export function looksLikeMarkdown(text: string): boolean {
  if(!text) return false;
  return (
    /^#{1,6}\s+\S/m.test(text) ||
    /^\s*\|.+\|\s*$/m.test(text) ||
    /```/.test(text) ||
    /^\s*([*\-_])\s*\1\s*\1[\s*\-_]*$/m.test(text) ||
    /^\s*([-*+]|\d+[.)])\s+\S/m.test(text)
  );
}

function splitRow(line: string): string[] {
  const inner = TABLE_ROW.exec(line)?.[1] ?? line;
  return inner.split('|').map((cell) => cell.trim());
}

/** Build a table block from lines whose first two are header and divider. */
function tableFrom(lines: string[]): Block {
  const headers = splitRow(lines[0]);
  const align = splitRow(lines[1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : 'left';
  }) as ('left' | 'center' | 'right')[];

  const rows = lines.slice(2).filter((line) => TABLE_ROW.test(line)).map(splitRow);
  return {type: 'table', headers, rows, align};
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if(paragraph.length) {
      blocks.push({type: 'paragraph', text: paragraph.join('\n')});
      paragraph = [];
    }
  };

  for(let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code runs to its closing fence, or to the end of the message.
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if(fence) {
      flushParagraph();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while(i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // Bots often fence their tables. Render the table rather than a wall of
      // monospace when the fenced body is one.
      const fencedTable = body.length > 1 && TABLE_ROW.test(body[0]) && TABLE_DIVIDER.test(body[1]);
      if(fencedTable) {
        blocks.push(tableFrom(body));
      } else {
        blocks.push({type: 'code', text: body.join('\n'), lang});
      }
      continue;
    }

    if(!line.trim()) {
      flushParagraph();
      continue;
    }

    if(RULE.test(line)) {
      flushParagraph();
      blocks.push({type: 'rule'});
      continue;
    }

    const heading = HEADING.exec(line);
    if(heading) {
      flushParagraph();
      blocks.push({type: 'heading', level: heading[1].length, text: heading[2]});
      continue;
    }

    // A table needs a header row followed by the |---|---| divider.
    if(TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushParagraph();
      const table: string[] = [line, lines[i + 1]];
      i += 2;
      while(i < lines.length && TABLE_ROW.test(lines[i])) {
        table.push(lines[i]);
        i++;
      }
      i--;

      blocks.push(tableFrom(table));
      continue;
    }

    const quote = QUOTE.exec(line);
    if(quote) {
      flushParagraph();
      const parts = [quote[1]];
      while(i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        parts.push(QUOTE.exec(lines[++i])![1]);
      }
      blocks.push({type: 'quote', text: parts.join('\n')});
      continue;
    }

    const ordered = OL_ITEM.test(line);
    if(ordered || UL_ITEM.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while(i < lines.length) {
        const match = ordered ? OL_ITEM.exec(lines[i]) : UL_ITEM.exec(lines[i]);
        if(!match) break;
        items.push(match[1]);
        i++;
      }
      i--;
      blocks.push({type: 'list', ordered, items});
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * Inline pass: code spans first (their contents are literal), then links,
 * mentions, and the emphasis markers.
 */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = new RegExp(
    [
      '`([^`]+)`', // code
      '\\[([^\\]]+)\\]\\(([^)\\s]+)\\)', // link
      '(\\*\\*|__)([\\s\\S]+?)\\1', // bold
      '(~~)([\\s\\S]+?)~~', // strike
      '(\\*|_)(?!\\s)([\\s\\S]+?)(?<!\\s)\\1', // italic
      '(@[A-Za-z0-9_]{3,32})' // mention
    ].join('|'),
    'g'
  );

  let last = 0;
  let match: RegExpExecArray | null;

  while((match = pattern.exec(text))) {
    if(match.index > last) {
      tokens.push({type: 'text', text: text.slice(last, match.index)});
    }

    if(match[1] !== undefined) tokens.push({type: 'code', text: match[1]});
    else if(match[2] !== undefined) tokens.push({type: 'link', text: match[2], href: match[3]});
    else if(match[5] !== undefined) tokens.push({type: 'text', text: match[5], bold: true});
    else if(match[7] !== undefined) tokens.push({type: 'text', text: match[7], strike: true});
    else if(match[9] !== undefined) tokens.push({type: 'text', text: match[9], italic: true});
    else if(match[10] !== undefined) tokens.push({type: 'mention', text: match[10]});

    last = match.index + match[0].length;
  }

  if(last < text.length) {
    tokens.push({type: 'text', text: text.slice(last)});
  }

  return tokens.length ? tokens : [{type: 'text', text}];
}
