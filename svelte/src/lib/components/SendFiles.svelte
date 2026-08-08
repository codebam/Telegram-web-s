<script lang="ts">
  import {onDestroy, untrack} from 'svelte';

  let {
    files,
    onsend,
    onclose
  }: {
    files: File[];
    onsend: (files: File[], asPhoto: boolean, caption: string) => void;
    onclose: () => void;
  } = $props();

  let caption = $state('');
  // Default to photo when everything pasted is an image — that is what people
  // mean by pasting a screenshot. Mixed or non-image sets go as files.
  // The dialog is mounted fresh per batch, so seeding once is intended.
  let asPhoto = $state(untrack(() => files.every((file) => file.type.startsWith('image/'))));

  const anyImage = $derived(files.some((file) => file.type.startsWith('image/')));

  // Object URLs must be released or the blobs leak for the tab's lifetime.
  const previews = untrack(() =>
    files
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, 6)
      .map((file) => ({name: file.name, url: URL.createObjectURL(file)}))
  );

  onDestroy(() => previews.forEach((preview) => URL.revokeObjectURL(preview.url)));

  function humanSize(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while(value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  function submit(e: Event) {
    e.preventDefault();
    onsend(files, anyImage && asPhoto, caption.trim());
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog-shell" onclick={(e) => e.stopPropagation()} role="presentation">
  <form class="dialog" onsubmit={submit}>
    <header>
      {files.length === 1 ? 'Send file' : `Send ${files.length} files`}
    </header>

    {#if previews.length}
      <div class="previews" class:single={previews.length === 1}>
        {#each previews as preview (preview.url)}
          <img src={preview.url} alt={preview.name} />
        {/each}
      </div>
    {/if}

    <div class="files">
      {#each files.slice(0, 4) as file (file.name + file.size)}
        <div class="file">
          <span class="name">{file.name || 'Pasted image'}</span>
          <span class="size">{humanSize(file.size)}</span>
        </div>
      {/each}
      {#if files.length > 4}
        <p class="muted">and {files.length - 4} more</p>
      {/if}
    </div>

    {#if anyImage}
      <div class="choice">
        <button type="button" class:on={asPhoto} onclick={() => (asPhoto = true)}>
          Photo
          <span class="hint">compressed, shows inline</span>
        </button>
        <button type="button" class:on={!asPhoto} onclick={() => (asPhoto = false)}>
          File
          <span class="hint">original quality</span>
        </button>
      </div>
    {/if}

    <!-- svelte-ignore a11y_autofocus -->
    <input class="caption" autofocus placeholder="Caption" bind:value={caption} />

    <footer>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary">Send</button>
    </footer>
  </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 97;
  }

  .dialog-shell {
    display: contents;
  }

  .dialog {
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    background: var(--bg-solid, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    font-weight: 600;
    font-size: 17px;
  }

  .previews {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px;
  }

  .previews.single {
    grid-template-columns: 1fr;
  }

  .previews img {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    border-radius: 10px;
    display: block;
  }

  .files {
    display: grid;
    gap: 4px;
    font-size: 13px;
  }

  .file {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .size,
  .muted {
    color: var(--text-dim);
  }

  .muted {
    margin: 0;
    font-size: 12px;
  }

  .choice {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .choice button {
    display: grid;
    gap: 2px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-weight: 600;
  }

  .choice button.on {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .hint {
    font-size: 11px;
    font-weight: 400;
    opacity: 0.75;
  }

  .caption {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  .caption:focus {
    border-color: var(--accent);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  footer button {
    padding: 9px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  footer .primary {
    background: var(--action, var(--accent));
    border-color: transparent;
    color: var(--action-ink, #fff);
    font-weight: 600;
  }
</style>
