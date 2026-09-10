<script lang="ts">
  import {onDestroy, untrack} from 'svelte';
  import Glyph from './Glyph.svelte';
  import MediaEditor from './MediaEditor.svelte';
  import {isEditableFile} from '$lib/telegram/mediaEditor';
  import type {SendFileItem, UploadProgress} from '$lib/telegram/upload';

  let {
    files,
    progress = null,
    onsend,
    oncancelupload,
    onclose
  }: {
    files: File[];
    /** Per-item upload state while the batch is in flight, null before sending. */
    progress?: UploadProgress[] | null;
    onsend: (items: SendFileItem[], caption: string) => void;
    oncancelupload: () => void;
    onclose: () => void;
  } = $props();

  const isVisual = (file: File) => file.type.startsWith('image/') || file.type.startsWith('video/');

  type Row = {
    /** Stable across edits — the File is swapped when the editor applies. */
    id: number;
    file: File;
    /** Object URL for the thumbnail, or '' for anything with no preview. */
    url: string;
    asPhoto: boolean;
    spoiler: boolean;
  };

  // Object URLs must be released or the blobs leak for the tab's lifetime.
  // The dialog is mounted fresh per batch, so seeding the rows once is intended.
  let rows = $state<Row[]>(
    untrack(() =>
      files.map((file, index) => ({
        id: index,
        file,
        url: file.type.startsWith('image/') || file.type.startsWith('video/') ?
          URL.createObjectURL(file) :
          '',
        // Defaulting an image to "photo" is what people mean by pasting a
        // screenshot; a document keeps its bytes and goes as a file.
        asPhoto: isVisual(file),
        spoiler: false
      }))
    )
  );

  let caption = $state('');

  /** Index of the row open in the media editor, null when it is closed. */
  let editing = $state<number | null>(null);

  const sending = $derived(!!progress);

  onDestroy(() => rows.forEach((row) => row.url && URL.revokeObjectURL(row.url)));

  function remove(index: number) {
    if (sending) return;
    const row = rows[index];
    rows = rows.filter((_, i) => i !== index);
    if (row?.url) URL.revokeObjectURL(row.url);
    if (!rows.length) onclose();
  }

  /**
   * The editor hands back a freshly encoded File; it replaces that one item and
   * nothing else — the row keeps its own photo/file and spoiler choice, and the
   * batch caption is untouched.
   */
  function applyEdit(edited: File) {
    const index = editing;
    editing = null;
    if (index === null) return;
    const row = rows[index];
    if (!row) return;
    const previous = row.url;
    row.file = edited;
    row.url = isVisual(edited) ? URL.createObjectURL(edited) : '';
    // Re-encoding a document into media would otherwise leave it going as a
    // file; the editor only ever emits inline-capable media.
    if (isVisual(edited) && !row.asPhoto) row.asPhoto = true;
    if (previous) URL.revokeObjectURL(previous);
  }

  function humanSize(bytes: number) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  function submit(e: Event) {
    e.preventDefault();
    if (sending || !rows.length) return;
    // The worker cannot structured-clone a $state proxy, and these items carry
    // the File objects straight through to sendFile — hand over plain copies.
    onsend(
      rows.map((row) => ({file: row.file, asPhoto: row.asPhoto, spoiler: row.spoiler})),
      caption.trim()
    );
  }

  function onKey(e: KeyboardEvent) {
    // The editor is modal on top of this dialog and runs its own Escape.
    if (editing !== null) return;
    if (e.key === 'Escape') sending ? oncancelupload() : onclose();
  }

  /**
   * Albums are captioned as a whole, so the caption belongs to the batch and
   * not to any one tile — matching what the official clients send.
   */
  const albumHint = $derived(
    rows.filter((row) => isVisual(row.file) && row.asPhoto).length > 1 ?
      'Sent as one album' :
      ''
  );
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={() => !sending && onclose()} role="presentation">
  <div class="dialog-shell" onclick={(e) => e.stopPropagation()} role="presentation">
  <form class="dialog" onsubmit={submit}>
    <header>
      <span>{rows.length === 1 ? 'Send file' : `Send ${rows.length} files`}</span>
      {#if albumHint}
        <span class="album-hint">{albumHint}</span>
      {/if}
    </header>

    <div class="items">
      {#each rows as row, index (row.id)}
        {@const up = progress?.[index]}
        <div class="item" class:failed={!!up?.error}>
          <div class="thumb" class:blurred={row.spoiler}>
            {#if row.url && row.file.type.startsWith('video/')}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={row.url} muted playsinline preload="metadata"></video>
            {:else if row.url}
              <img src={row.url} alt={row.file.name} />
            {:else}
              <span class="doc-glyph"><Glyph name="file" size={18} /></span>
            {/if}
            {#if row.spoiler}
              <span class="spoiler-dots" aria-hidden="true"></span>
            {/if}
          </div>

          <div class="meta">
            <span class="name">{row.file.name || 'Pasted image'}</span>
            <span class="sub">
              {up?.error || humanSize(row.file.size)}
            </span>

            {#if up}
              <div class="bar" role="progressbar" aria-valuenow={Math.round(up.progress * 100)}>
                <div class="fill" style="width: {Math.round(up.progress * 100)}%"></div>
              </div>
            {:else if isVisual(row.file)}
              <div class="controls">
                <button
                  type="button"
                  class="pill"
                  class:on={row.asPhoto}
                  onclick={() => (row.asPhoto = true)}
                  title="Compressed, shows inline"
                >Photo</button>
                <button
                  type="button"
                  class="pill"
                  class:on={!row.asPhoto}
                  onclick={() => {
                    row.asPhoto = false;
                    // A document is never spoilered — the flag rides on the
                    // inline media, so keep the two from disagreeing.
                    row.spoiler = false;
                  }}
                  title="Original quality"
                >File</button>
                <button
                  type="button"
                  class="pill"
                  class:on={row.spoiler}
                  disabled={!row.asPhoto}
                  onclick={() => (row.spoiler = !row.spoiler)}
                  title="Hide behind a spoiler until tapped"
                >Spoiler</button>
                {#if isEditableFile(row.file)}
                  <button
                    type="button"
                    class="pill edit"
                    onclick={() => (editing = index)}
                    title="Crop, filter, draw, add text or stickers"
                  >Edit</button>
                {/if}
              </div>
            {/if}
          </div>

          {#if !sending}
            <button
              type="button"
              class="remove"
              onclick={() => remove(index)}
              aria-label="Remove {row.file.name || 'file'}"
            ><Glyph name="close" size={14} /></button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="caption"
      autofocus
      placeholder="Caption"
      disabled={sending}
      bind:value={caption}
    />

    <footer>
      {#if sending}
        <button type="button" onclick={oncancelupload}>Cancel upload</button>
      {:else}
        <button type="button" onclick={onclose}>Cancel</button>
        <button type="submit" class="primary">Send</button>
      {/if}
    </footer>
  </form>
  </div>
</div>

{#if editing !== null && rows[editing]}
  <MediaEditor
    file={rows[editing].file}
    onapply={applyEdit}
    oncancel={() => (editing = null)}
  />
{/if}

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
    width: min(460px, calc(100vw - 32px));
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
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-weight: 600;
    font-size: 17px;
  }

  .album-hint {
    font-size: 12px;
    font-weight: 400;
    color: var(--text-dim);
  }

  .items {
    display: grid;
    gap: 10px;
    max-height: 46vh;
    overflow-y: auto;
  }

  .item {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    gap: 10px;
    align-items: center;
  }

  .thumb {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 8px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    display: grid;
    place-items: center;
  }

  .thumb img,
  .thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb.blurred img,
  .thumb.blurred video {
    filter: blur(8px);
    transform: scale(1.2);
  }

  .spoiler-dots {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(rgba(255, 255, 255, 0.75) 1px, transparent 1px);
    background-size: 6px 6px;
  }

  .doc-glyph {
    opacity: 0.7;
  }

  .meta {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .name {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  .item.failed .sub {
    color: var(--danger, #e05c5c);
  }

  .controls {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .pill {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .pill.on {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .pill.edit {
    color: var(--accent);
    font-weight: 600;
  }

  .pill:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .bar {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s linear;
  }

  .remove {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
  }

  .remove:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--text) 10%, transparent);
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
