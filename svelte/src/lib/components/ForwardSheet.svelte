<script lang="ts">
  import PeerPicker from './PeerPicker.svelte';
  import type {DialogItem} from '$lib/telegram/chats';
  import type {ForwardOptions} from '$lib/telegram/reply';

  let {
    dialogs,
    count,
    hasCaptions = false,
    onforward,
    onclose
  }: {
    dialogs: DialogItem[];
    /** How many messages are being forwarded, for the title. */
    count: number;
    /** Whether any of them carries a caption — the option is pointless without. */
    hasCaptions?: boolean;
    onforward: (targets: number[], options: ForwardOptions) => void;
    onclose: () => void;
  } = $props();

  let targets = $state<number[]>([]);
  let dropAuthor = $state(false);
  let dropCaptions = $state(false);
  let comment = $state('');

  function toggle(peerId: number) {
    targets = targets.includes(peerId) ? targets.filter((id) => id !== peerId) : [...targets, peerId];
  }

  function confirm() {
    if (!targets.length) return;
    // Plain values, not the $state proxies: these end up in a worker message.
    onforward([...targets], {
      dropAuthor,
      dropCaptions,
      comment: comment.trim()
    });
  }
</script>

<PeerPicker
  title={count > 1 ? `Forward ${count} messages` : 'Forward message'}
  {dialogs}
  selectedIds={targets}
  onpick={toggle}
  onconfirm={confirm}
  confirmLabel={targets.length > 1 ? `Send to ${targets.length}` : 'Send'}
  {onclose}
>
  {#snippet extras()}
    <label class="option">
      <input type="checkbox" bind:checked={dropAuthor} />
      <span>Hide sender name</span>
    </label>
    {#if hasCaptions}
      <label class="option">
        <input type="checkbox" bind:checked={dropCaptions} />
        <span>Hide captions</span>
      </label>
    {/if}
    <input class="comment" placeholder="Add a comment…" bind:value={comment} />
  {/snippet}
</PeerPicker>

<style>
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
    cursor: pointer;
  }

  .comment {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  .comment:focus {
    border-color: var(--accent);
  }
</style>
