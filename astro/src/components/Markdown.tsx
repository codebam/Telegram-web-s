/*
 * Minimal Markdown renderer for message text.
 *
 * Bots routinely send Markdown as plain text — Telegram has no entity for a
 * heading or a table, so those arrive as literal "### Title" and pipe rows.
 * This parses the block structure and renders it as elements; nothing is
 * injected as HTML, so a message cannot smuggle markup in.
 *
 * Only what bots actually send is supported: headings, fenced code, pipe
 * tables, rules, lists, quotes, and inline code/bold/italic/strike/links.
 *
 * Ported from svelte/src/lib/components/Markdown.svelte. The `inline` snippet
 * became a plain function and `{@render inline(…)}` a call to it — a snippet with
 * one argument is exactly a function returning elements.
 */
import {parseBlocks, parseInline, type Block} from '$lib/telegram/markdown';

import './Markdown.css';

interface Props {
  text: string;
  onmention?: (mention: string, kind: 'username' | 'userId') => void;
}

export function Markdown({text, onmention}: Props) {
  // Computed on each render rather than memoised: `text` is a prop, so a
  // `useComputed` would never notice it change. See CONVERSION.md.
  const blocks = parseBlocks(text);

  const inline = (source: string) => parseInline(source).map((token, i) => {
    if(token.type === 'code') {
      return <code key={i}>{token.text}</code>;
    }

    if(token.type === 'link') {
      return <a key={i} href={token.href} target="_blank" rel="noopener noreferrer">{token.text}</a>;
    }

    if(token.type === 'mention') {
      return onmention ?
        <button key={i} class="mention" onClick={() => onmention(token.text.slice(1), 'username')}>{token.text}</button> :
        <span key={i} class="mention">{token.text}</span>;
    }

    // `class:bold={token.bold}` and friends, as one class string — an empty
    // string rather than a gap, so no stray space ends up in the attribute.
    const classes = [
      token.bold && 'bold',
      token.italic && 'italic',
      token.strike && 'strike'
    ].filter(Boolean).join(' ');

    return <span key={i} class={classes}>{token.text}</span>;
  });

  const renderBlock = (block: Block, i: number) => {
    switch(block.type) {
      case 'heading':
        return block.level <= 2 ?
          <p key={i} class="h1">{inline(block.text)}</p> :
          <p key={i} class="h2">{inline(block.text)}</p>;

      case 'code':
        return <pre key={i}><code>{block.text}</code></pre>;

      case 'rule':
        return <hr key={i} />;

      case 'quote':
        return <blockquote key={i}>{inline(block.text)}</blockquote>;

      case 'list':
        return block.ordered ?
          <ol key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ol> :
          <ul key={i}>{block.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</ul>;

      /* A wide table scrolls inside its own bubble, never the message list. */
      case 'table':
        return (
          <div key={i} class="table-wrap">
            <table>
              <thead>
                <tr>
                  {block.headers.map((header, h) => (
                    <th key={h} style={{textAlign: block.align[h] ?? 'left'}}>{inline(header)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} style={{textAlign: block.align[c] ?? 'left'}}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      default:
        return <p key={i}>{inline(block.text)}</p>;
    }
  };

  return <div class="md">{blocks.map(renderBlock)}</div>;
}
