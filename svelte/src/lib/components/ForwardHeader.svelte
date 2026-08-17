<script lang="ts">
  import type {ForwardInfo} from '$lib/telegram/reply';

  let {
    forward,
    onopenpeer
  }: {
    forward: ForwardInfo;
    /** Opening the original author's profile; never called for a hidden sender. */
    onopenpeer?: (peerId: number) => void;
  } = $props();
</script>

<span class="forwarded" style="--peer-color: {forward.color}">
  <span class="label">Forwarded from</span>
  {#if forward.hidden || !forward.peerId}
    <!-- The sender forbids being linked back to: their chosen name is all
         Telegram gives out, and it must not turn into a profile link. -->
    <span class="who hidden-sender">{forward.title}</span>
  {:else}
    <button class="who" onclick={() => onopenpeer?.(forward.peerId)}>{forward.title}</button>
  {/if}
  {#if forward.postAuthor}
    <span class="author">({forward.postAuthor})</span>
  {/if}
  {#if forward.link}
    <a class="source" href={forward.link} target="_blank" rel="noopener noreferrer">original</a>
  {/if}
</span>

<style>
  .forwarded {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .who {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-weight: 600;
    color: var(--peer-color);
    cursor: pointer;
    /* A display name with no spaces in it has nothing to wrap on, and would
       otherwise push the header past the bubble. */
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who:hover {
    text-decoration: underline;
  }

  .hidden-sender {
    cursor: default;
  }

  .hidden-sender:hover {
    text-decoration: none;
  }

  .author {
    font-style: italic;
  }

  .source {
    color: var(--accent);
    text-decoration: none;
  }

  .source:hover {
    text-decoration: underline;
  }
</style>
