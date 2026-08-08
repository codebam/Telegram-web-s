<script lang="ts">
  import Markdown from './Markdown.svelte';
  import {looksLikeMarkdown} from '$lib/telegram/markdown';
  import type {TextPart} from '$lib/telegram/chats';

  let {
    parts,
    onmention,
    markdown = false
  }: {
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
  } = $props();

  // Spoilers stay hidden until clicked, keyed by run index.
  let revealed = $state<Set<number>>(new Set());

  /**
   * Bots send Markdown as plain text. Render it as structure, but only when the
   * message carries no formatting entities of its own — otherwise Telegram's
   * own formatting is authoritative and re-parsing it would fight with it.
   */
  const plain = $derived(
    parts.every((part) =>
      !part.bold && !part.italic && !part.underline && !part.strike &&
      !part.code && !part.pre && !part.spoiler && !part.blockquote &&
      !part.url && !part.mention
    )
  );

  const source = $derived(parts.map((part) => part.text).join(''));
  const asMarkdown = $derived(
    plain && (looksLikeMarkdown(source) || (markdown && /(\*\*|__|~~|`|\[[^\]]+\]\()/.test(source)))
  );

  function reveal(index: number) {
    revealed = new Set(revealed).add(index);
  }
</script>

{#if asMarkdown}
  <Markdown text={source} {onmention} />
{:else}
<p class="text">
  {#each parts as part, i}
    {#if part.pre}
      <code class="pre">{part.text}</code>
    {:else if part.spoiler && !revealed.has(i)}
      <button class="spoiler" onclick={() => reveal(i)} aria-label="Show spoiler">
        {part.text}
      </button>
    {:else if part.url}
      <a href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a>
    {:else if part.mention && part.mentionKind !== 'tag' && onmention}
      <button
        class="mention"
        onclick={() => onmention(part.mention!, part.mentionKind as 'username' | 'userId')}
      >{part.text}</button>
    {:else if part.mention}
      <span class="mention">{part.text}</span>
    {:else}
      <span
        class:bold={part.bold}
        class:italic={part.italic}
        class:underline={part.underline}
        class:strike={part.strike}
        class:code={part.code}
        class:quote={part.blockquote}
      >{part.text}</span>
    {/if}
  {/each}
</p>
{/if}

<style>
  .text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .bold {
    font-weight: 600;
  }

  .italic {
    font-style: italic;
  }

  .underline {
    text-decoration: underline;
  }

  .strike {
    text-decoration: line-through;
  }

  .code,
  .pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
    background: color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 4px;
    padding: 0 4px;
  }

  .pre {
    display: block;
    padding: 8px 10px;
    margin: 4px 0;
    white-space: pre;
    overflow-x: auto;
  }

  .quote {
    display: inline-block;
    border-left: 2px solid currentColor;
    padding-left: 8px;
    opacity: 0.9;
  }

  a {
    color: inherit;
    text-decoration: underline;
  }

  .mention {
    color: var(--accent);
  }

  button.mention {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }

  button.mention:hover {
    text-decoration: underline;
  }

  .spoiler {
    font: inherit;
    color: transparent;
    background: color-mix(in srgb, currentColor 35%, transparent);
    border: none;
    border-radius: 4px;
    padding: 0 2px;
    cursor: pointer;
  }
</style>
