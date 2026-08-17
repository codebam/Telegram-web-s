<script lang="ts">
  import type {SuggestionItem} from '$lib/telegram/botUi';

  let {
    items,
    active = 0,
    label,
    onpick
  }: {
    items: SuggestionItem[];
    /** Index the arrow keys have landed on; Enter and Tab take this one. */
    active?: number;
    label: string;
    onpick: (index: number) => void;
  } = $props();

  let list: HTMLDivElement | undefined = $state();

  // Keep the keyboard selection visible while arrowing through a long list.
  $effect(() => {
    void active;
    list?.querySelector('.suggestion.active')?.scrollIntoView({block: 'nearest'});
  });
</script>

<div class="suggestions" bind:this={list} role="listbox" aria-label={label}>
  {#each items as item, index (item.key)}
    <button
      type="button"
      class="suggestion"
      class:active={index === active}
      role="option"
      aria-selected={index === active}
      onmousedown={(event) => event.preventDefault()}
      onclick={() => onpick(index)}
    >
      <span class="suggestion-title">{item.title}</span>
      {#if item.subtitle}
        <span class="suggestion-sub">{item.subtitle}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .suggestions {
    display: flex;
    flex-direction: column;
    max-height: 220px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    background: var(--bg-solid);
  }

  .suggestion {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 7px 12px;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .suggestion:hover,
  .suggestion.active {
    background: var(--bg-elevated);
  }

  .suggestion-title {
    font-weight: 500;
    white-space: nowrap;
  }

  .suggestion-sub {
    flex: 1;
    min-width: 0;
    opacity: 0.6;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
