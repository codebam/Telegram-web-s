<script lang="ts">
  import Avatar from './Avatar.svelte';

  let {
    count = 0,
    commenters = [],
    onopen
  }: {count?: number; commenters?: number[]; onopen: () => void} = $props();

  // Telegram shows at most three faces before the label; more than that and the
  // stack stops being readable at bubble scale.
  let faces = $derived(commenters.slice(0, 3));
  let label = $derived(count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Leave a comment');
</script>

<button class="comments" onclick={onopen}>
  {#if faces.length}
    <span class="faces">
      {#each faces as peerId (peerId)}
        <span class="face"><Avatar {peerId} title="" size={18} /></span>
      {/each}
    </span>
  {/if}
  <span class="label">{label}</span>
</button>

<style>
  .comments {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    margin-top: 4px;
    padding: 6px 8px;
    border: none;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .faces {
    display: flex;
  }

  .face {
    display: block;
    margin-right: -6px;
    border-radius: 8px;
    box-shadow: 0 0 0 2px var(--bg-elevated);
  }

  .face:last-child {
    margin-right: 0;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
