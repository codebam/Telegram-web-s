<script lang="ts">
  /**
   * Renders a message that arrived as structured page blocks rather than text.
   * Keeping the blocks means a table stays a table — flattening them to a
   * string, which is the only thing the plain `message` field can hold, throws
   * that structure away.
   */
  import FormattedText from './FormattedText.svelte';
  import type {RichBlock} from '$lib/telegram/chats';

  let {
    blocks,
    onmention
  }: {
    blocks: RichBlock[];
    onmention?: (mention: string, kind: 'username' | 'userId') => void;
  } = $props();
</script>

<div class="rich">
  {#each blocks as block}
    {#if block.type === 'heading'}
      <div class="heading" class:small={block.level > 2}>
        <FormattedText parts={block.parts} {onmention} markdown />
      </div>
    {:else if block.type === 'code'}
      <pre><code>{block.text}</code></pre>
    {:else if block.type === 'divider'}
      <hr />
    {:else if block.type === 'quote'}
      <blockquote><FormattedText parts={block.parts} {onmention} markdown /></blockquote>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol>
          {#each block.items as item}<li><FormattedText parts={item} {onmention} markdown /></li>{/each}
        </ol>
      {:else}
        <ul>
          {#each block.items as item}<li><FormattedText parts={item} {onmention} markdown /></li>{/each}
        </ul>
      {/if}
    {:else if block.type === 'table'}
      {#if block.title.length}
        <div class="heading small"><FormattedText parts={block.title} {onmention} markdown /></div>
      {/if}
      <!-- Wide tables scroll inside the bubble, never the message list. -->
      <div class="table-wrap">
        <table>
          <tbody>
          {#each block.rows as row}
            <tr>
              {#each row.cells as cell}
                {#if row.header}
                  <th><FormattedText parts={cell} {onmention} markdown /></th>
                {:else}
                  <td><FormattedText parts={cell} {onmention} markdown /></td>
                {/if}
              {/each}
            </tr>
          {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <FormattedText parts={block.parts} {onmention} markdown />
    {/if}
  {/each}
</div>

<style>
  .rich {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .heading {
    font-weight: 700;
    font-size: 1.12em;
    line-height: 1.25;
  }

  .heading.small {
    font-size: 1.03em;
  }

  pre {
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, currentColor 12%, transparent);
    overflow-x: auto;
  }

  pre code {
    white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
  }

  hr {
    width: 100%;
    border: none;
    border-top: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    margin: 2px 0;
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
    vertical-align: top;
    text-align: left;
  }

  th {
    font-weight: 600;
    background: color-mix(in srgb, currentColor 8%, transparent);
  }
</style>
