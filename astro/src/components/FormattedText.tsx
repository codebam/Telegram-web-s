/*
 * Ported from svelte/src/lib/components/FormattedText.svelte.
 *
 * `plain`, `source` and `asMarkdown` were `$derived` over the `parts` and
 * `markdown` *props*, not over signals, so they are plain values recomputed each
 * render — a `useComputed` would never notice a new message arrive. The
 * `{#if} {:else if} … {:else}` chain that picked one element per run is the
 * early-return chain in `renderPart` below.
 */
import {useSignal} from '@preact/signals';

import type {TextPart} from '$lib/telegram/chats';
import {looksLikeMarkdown} from '$lib/telegram/markdown';

import {CustomEmoji} from './CustomEmoji';
import {Markdown} from './Markdown';

import './FormattedText.css';

interface Props {
  parts: TextPart[];
  /**
   * Also treat inline markers (**bold**, `code`, links) as Markdown. Off by
   * default: people type asterisks in ordinary messages and mangling those
   * would be worse than showing them. Rich-message blocks opt in, because
   * their authors are bots writing Markdown.
   */
  markdown?: boolean;
  /** Called with a @username or a bare user id when a mention is clicked. */
  onmention?: (mention: string, kind: 'username' | 'userId') => void;
  /**
   * Given a first chance at a link. Returning true means it was handled in
   * the app — a t.me mini app link, say — and the browser should not follow it.
   */
  onlink?: (url: string) => boolean;
}

export function FormattedText({parts, onmention, onlink, markdown = false}: Props) {
  // Spoilers stay hidden until clicked, keyed by run index.
  const revealed = useSignal<Set<number>>(new Set());

  /**
   * Bots send Markdown as plain text. Render it as structure, but only when the
   * message carries no formatting entities of its own — otherwise Telegram's
   * own formatting is authoritative and re-parsing it would fight with it.
   */
  const plain = parts.every((part) =>
    !part.bold && !part.italic && !part.underline && !part.strike &&
    !part.code && !part.pre && !part.spoiler && !part.blockquote &&
    !part.url && !part.mention && !part.customEmojiDocId
  );

  const source = parts.map((part) => part.text).join('');
  const asMarkdown = plain && (looksLikeMarkdown(source) || (markdown && /(\*\*|__|~~|`|\[[^\]]+\]\()/.test(source)));

  function reveal(index: number) {
    revealed.value = new Set(revealed.value).add(index);
  }

  function renderPart(part: TextPart, i: number) {
    if(part.customEmojiDocId) {
      /* The alt text stays as the fallback, so a document that will not load
         still reads as the emoji the sender meant. */
      return <CustomEmoji key={i} docId={part.customEmojiDocId} size={20} fallback={part.text} />;
    }

    if(part.pre) {
      return <code key={i} class="pre">{part.text}</code>;
    }

    if(part.spoiler && !revealed.value.has(i)) {
      return (
        <button key={i} class="spoiler" onClick={() => reveal(i)} aria-label="Show spoiler">
          {part.text}
        </button>
      );
    }

    if(part.url) {
      return (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if(onlink?.(part.url!)) e.preventDefault();
          }}
        >{part.text}</a>
      );
    }

    if(part.mention && part.mentionKind !== 'tag' && onmention) {
      return (
        <button
          key={i}
          class="mention"
          onClick={() => onmention(part.mention!, part.mentionKind as 'username' | 'userId')}
        >{part.text}</button>
      );
    }

    if(part.mention) {
      return <span key={i} class="mention">{part.text}</span>;
    }

    // `class:bold={part.bold}` and friends, as one class string — an empty
    // string rather than a gap, so no stray space ends up in the attribute.
    const classes = [
      part.bold && 'bold',
      part.italic && 'italic',
      part.underline && 'underline',
      part.strike && 'strike',
      part.code && 'code',
      part.blockquote && 'quote'
    ].filter(Boolean).join(' ');

    return <span key={i} class={classes}>{part.text}</span>;
  }

  return asMarkdown ?
    <Markdown text={source} onmention={onmention} /> :
    <p class="text">{parts.map(renderPart)}</p>;
}
