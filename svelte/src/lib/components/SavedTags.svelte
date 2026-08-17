<script lang="ts">
  import {loadSavedTags, renameSavedTag, type SavedTagItem} from '$lib/telegram/topics';

  let {
    savedPeerId,
    active = '',
    onselect
  }: {
    /** Scopes the tag list to one saved sub-chat; undefined means all of Saved. */
    savedPeerId?: number;
    active?: string;
    onselect: (emoticon: string) => void;
  } = $props();

  let tags = $state<SavedTagItem[]>([]);
  let renaming = $state<string | null>(null);
  let renameValue = $state('');
  let error = $state('');

  async function refresh() {
    tags = await loadSavedTags(savedPeerId);
  }

  $effect(() => {
    const scope = savedPeerId;
    loadSavedTags(scope).then((items) => {
      if (scope === savedPeerId) tags = items;
    });
  });

  function startRename(tag: SavedTagItem) {
    renaming = tag.emoticon;
    renameValue = tag.title;
  }

  async function commitRename() {
    const emoticon = renaming;
    if (!emoticon) return;
    renaming = null;
    error = '';
    try {
      await renameSavedTag(emoticon, renameValue.trim());
      await refresh();
    } catch (err: any) {
      error = err?.type || err?.message || 'Could not rename the tag';
    }
  }
</script>

{#if tags.length}
  <div class="tags">
    <button class="tag" class:on={!active} onclick={() => onselect('')}>All</button>
    {#each tags as tag (tag.emoticon)}
      <button
        class="tag"
        class:on={tag.emoticon === active}
        onclick={() => onselect(tag.emoticon === active ? '' : tag.emoticon)}
        ondblclick={() => startRename(tag)}
        title="Double-click to rename"
      >
        <span class="emoji">{tag.emoticon}</span>
        {#if tag.title}<span class="name">{tag.title}</span>{/if}
        {#if tag.count}<span class="count">{tag.count}</span>{/if}
      </button>
    {/each}
  </div>

  {#if renaming}
    <div class="rename">
      <input
        bind:value={renameValue}
        placeholder="Tag name"
        maxlength="12"
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') renaming = null;
        }}
      />
      <button onclick={commitRename}>Save</button>
      <button onclick={() => (renaming = null)}>Cancel</button>
    </div>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
{/if}

<style>
  .tags {
    display: flex;
    gap: 6px;
    align-items: center;
    overflow-x: auto;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }

  .tag {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .tag.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .count {
    opacity: 0.7;
    font-size: 12px;
  }

  .rename {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }

  .rename input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .rename button {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .error {
    margin: 0;
    padding: 4px 10px;
    color: var(--danger);
    font-size: 13px;
  }
</style>
