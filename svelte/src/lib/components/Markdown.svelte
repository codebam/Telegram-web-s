<script lang="ts">
  /**
   * Minimal Markdown renderer for message text.
   *
   * Bots routinely send Markdown as plain text — Telegram has no entity for a
   * heading or a table, so those arrive as literal "### Title" and pipe rows.
   * This parses the block structure and renders it as elements; nothing is
   * injected as HTML, so a message cannot smuggle markup in.
   *
   * Only what bots actually send is supported: headings, fenced code, pipe
   * tables, rules, lists, quotes, and inline code/bold/italic/strike/links.
   */
  import {parseBlocks, parseInline, type Block} from '$lib/telegram/markdown';

  let {
    text,
    onmention
  }: {
    text: string;
    onmention?: (mention: string, kind: 'username' | 'userId') => void;
  } = $props();

  const blocks = $derived<Block[]>(parseBlocks(text));
</script>

{#snippet inline(source: string)}
  {#each parseInline(source) as token}
    {#if token.type === 'code'}
      <code>{token.text}</code>
    {:else if token.type === 'link'}
      <a href={token.href} target="_blank" rel="noopener noreferrer">{token.text}</a>
    {:else if token.type === 'mention'}
      {#if onmention}
        <button class="mention" onclick={() => onmention(token.text.slice(1), 'username')}>{token.text}</button>
      {:else}
        <span class="mention">{token.text}</span>
      {/if}
    {:else}
      <span
        class:bold={token.bold}
        class:italic={token.italic}
        class:strike={token.strike}
      >{token.text}</span>
    {/if}
  {/each}
{/snippet}

<div class="md">
  {#each blocks as block}
    {#if block.type === 'heading'}
      {#if block.level <= 2}
        <p class="h1">{@render inline(block.text)}</p>
      {:else}
        <p class="h2">{@render inline(block.text)}</p>
      {/if}
    {:else if block.type === 'code'}
      <pre><code>{block.text}</code></pre>
    {:else if block.type === 'rule'}
      <hr />
    {:else if block.type === 'quote'}
      <blockquote>{@render inline(block.text)}</blockquote>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol>
          {#each block.items as item}<li>{@render inline(item)}</li>{/each}
        </ol>
      {:else}
        <ul>
          {#each block.items as item}<li>{@render inline(item)}</li>{/each}
        </ul>
      {/if}
    {:else if block.type === 'table'}
      <!-- A wide table scrolls inside its own bubble, never the message list. -->
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              {#each block.headers as header, i}
                <th style="text-align: {block.align[i] ?? 'left'}">{@render inline(header)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row}
              <tr>
                {#each row as cell, i}
                  <td style="text-align: {block.align[i] ?? 'left'}">{@render inline(cell)}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p>{@render inline(block.text)}</p>
    {/if}
  {/each}
</div>

<style>
  .md {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .h1,
  .h2 {
    font-weight: 700;
    line-height: 1.25;
  }

  .h1 {
    font-size: 1.15em;
  }

  .h2 {
    font-size: 1.05em;
  }

  .bold {
    font-weight: 700;
  }

  .italic {
    font-style: italic;
  }

  .strike {
    text-decoration: line-through;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
    background: color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 4px;
    padding: 0 4px;
  }

  pre {
    margin: 2px 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    overflow-x: auto;
  }

  pre code {
    background: none;
    padding: 0;
    white-space: pre;
  }

  hr {
    border: none;
    border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    margin: 2px 0;
    width: 100%;
  }

  blockquote {
    margin: 0;
    padding-left: 8px;
    border-left: 2px solid currentColor;
    opacity: 0.9;
  }

  ul,
  ol {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 2px;
  }

  .table-wrap {
    overflow-x: auto;
    max-width: 100%;
  }

  table {
    border-collapse: collapse;
    font-size: 0.93em;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    padding: 3px 8px;
    white-space: nowrap;
  }

  th {
    font-weight: 600;
    background: color-mix(in srgb, currentColor 8%, transparent);
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
</style>
