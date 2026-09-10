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
 * Nothing here reads a signal, so `blocks`, `onmention`, `ontag` and `ondate`
 * are plain props read on each render, like the Svelte body was.
 */
import {Fragment} from 'preact';

import type {RichBlock} from '$lib/telegram/chats';

import {CodeBlockHeader, FormattedText} from './FormattedText';

import './RichMessage.css';

interface Props {
  blocks: RichBlock[];
  onmention?: (mention: string, kind: 'username' | 'userId') => void;
  /** Called with the tag's own text when a hashtag, a cashtag or a bot command is clicked. */
  ontag?: (text: string, kind: 'hashtag' | 'cashtag' | 'botCommand') => void;
  /** Called with the unix time of a formatted date when it is clicked. */
  ondate?: (unix: number) => void;
}

export function RichMessage({blocks, onmention, ontag, ondate}: Props) {
  const renderBlock = (block: RichBlock, i: number) => {
    switch(block.type) {
      case 'heading':
        return (
          <div key={i} class={['heading', block.level > 2 && 'small'].filter(Boolean).join(' ')}>
            <FormattedText parts={block.parts} onmention={onmention} ontag={ontag} ondate={ondate} markdown />
          </div>
        );

      /* The block's body keeps its `<pre><code>` shape — RichMessage.css styles
         it — and gains the same header a `pre` run carries: the language the
         block was tagged with and the copy gesture. */
      case 'code':
        return (
          <div key={i} class="ft-code-block">
            <CodeBlockHeader code={block.text} language={block.lang ?? ''} />
            <pre><code>{block.text}</code></pre>
          </div>
        );

      case 'divider':
        return <hr key={i} />;

      case 'quote':
        return <blockquote key={i}><FormattedText parts={block.parts} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></blockquote>;

      case 'list':
        return block.ordered ?
          <ol key={i}>
            {block.items.map((item, j) => <li key={j}><FormattedText parts={item} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></li>)}
          </ol> :
          <ul key={i}>
            {block.items.map((item, j) => <li key={j}><FormattedText parts={item} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></li>)}
          </ul>;

      case 'table':
        return (
          <Fragment key={i}>
            {block.title.length > 0 && (
              <div class="heading small"><FormattedText parts={block.title} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></div>
            )}
            {/* Wide tables scroll inside the bubble, never the message list. */}
            <div class="table-wrap">
              <table>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={r}>
                      {row.cells.map((cell, c) => row.header ?
                        <th key={c}><FormattedText parts={cell} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></th> :
                        <td key={c}><FormattedText parts={cell} onmention={onmention} ontag={ontag} ondate={ondate} markdown /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fragment>
        );

      default:
        return <FormattedText key={i} parts={block.parts} onmention={onmention} ontag={ontag} ondate={ondate} markdown />;
    }
  };

  return <div class="rich">{blocks.map(renderBlock)}</div>;
}
