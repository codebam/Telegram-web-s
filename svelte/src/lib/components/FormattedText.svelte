<script lang="ts">
  import type {TextPart} from '$lib/telegram/chats';

  let {parts}: {parts: TextPart[]} = $props();

  // Spoilers stay hidden until clicked, keyed by run index.
  let revealed = $state<Set<number>>(new Set());

  function reveal(index: number) {
    revealed = new Set(revealed).add(index);
  }
</script>

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
