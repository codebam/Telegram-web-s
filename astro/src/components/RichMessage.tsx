/*
 * Renders a message that arrived as structured page blocks rather than text.
 * Keeping the blocks means a table stays a table — flattening them to a
 * string, which is the only thing the plain `message` field can hold, throws
 * that structure away.
 *
 * Ported from svelte/src/lib/components/RichMessage.svelte. The
 * `{#if} {:else if} … {:else}` chain that picked one element per block is the
 * `switch` in `renderBlock`: the paragraph arm is the `default`, which is where
 * the original's `{:else}` landed. The table arm returns two siblings, so it is
 * a `Fragment` — a wrapper element would sit between `.rich`'s grid and its
 * heading.
 *
 * Nothing here reads a signal, so `blocks` and `onmention` are plain props read
 * on each render, like the Svelte body was.
 */
import {Fragment} from 'preact';

import type {RichBlock} from '$lib/telegram/chats';

import {FormattedText} from './FormattedText';

import './RichMessage.css';

interface Props {
  blocks: RichBlock[];
  onmention?: (mention: string, kind: 'username' | 'userId') => void;
}

export function RichMessage({blocks, onmention}: Props) {
  const renderBlock = (block: RichBlock, i: number) => {
    switch(block.type) {
      case 'heading':
        return (
          <div key={i} class={['heading', block.level > 2 && 'small'].filter(Boolean).join(' ')}>
            <FormattedText parts={block.parts} onmention={onmention} markdown />
          </div>
        );

      case 'code':
        return <pre key={i}><code>{block.text}</code></pre>;

      case 'divider':
        return <hr key={i} />;

      case 'quote':
        return <blockquote key={i}><FormattedText parts={block.parts} onmention={onmention} markdown /></blockquote>;

      case 'list':
        return block.ordered ?
          <ol key={i}>
            {block.items.map((item, j) => <li key={j}><FormattedText parts={item} onmention={onmention} markdown /></li>)}
          </ol> :
          <ul key={i}>
            {block.items.map((item, j) => <li key={j}><FormattedText parts={item} onmention={onmention} markdown /></li>)}
          </ul>;

      case 'table':
        return (
          <Fragment key={i}>
            {block.title.length > 0 && (
              <div class="heading small"><FormattedText parts={block.title} onmention={onmention} markdown /></div>
            )}
            {/* Wide tables scroll inside the bubble, never the message list. */}
            <div class="table-wrap">
              <table>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.cells.map((cell, c) => row.header ?
                        <th key={c}><FormattedText parts={cell} onmention={onmention} markdown /></th> :
                        <td key={c}><FormattedText parts={cell} onmention={onmention} markdown /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fragment>
        );

      default:
        return <FormattedText key={i} parts={block.parts} onmention={onmention} markdown />;
    }
  };

  return <div class="rich">{blocks.map(renderBlock)}</div>;
}
