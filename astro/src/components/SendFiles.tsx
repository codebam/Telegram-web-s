/*
 * The batch send dialog: one row per picked file with its own photo/file and
 * spoiler choice, an album-wide caption, and the media editor for a single item.
 *
 * Ported from svelte/src/lib/components/SendFiles.svelte. Three translations
 * carry the weight here:
 *
 *  - `rows` was a `$state` array, so `row.asPhoto = true`, `row.spoiler = …` and
 *    the two writes `applyEdit` makes to the edited row notified every reader of
 *    the field they touched. `signal()` is shallow, so each row edit is a
 *    reassignment of the list (`patchRow`) — writing the field in place would
 *    leave the thumbnail, the pills and the editor result rendering the old row.
 *  - the rows are seeded from the `files` prop, and the seed allocates one object
 *    URL per visual file. `useMemo` with an empty dependency list is what keeps
 *    that to the first render: a signal takes its initial value once, but the
 *    expression would be evaluated on every render and leak a URL per pass.
 *  - `<svelte:window onkeydown>` is an effect adding and removing the same
 *    listener. `onKey` reads signals, which are always current, plus `sending`,
 *    which is derived from the `progress` prop — so the props it reads are the
 *    effect's dependencies.
 */
import {useEffect, useMemo} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {Glyph} from './Glyph';
import {MediaEditor} from './MediaEditor';
import {isEditableFile} from '$lib/telegram/mediaEditor';
import type {SendFileItem, UploadProgress} from '$lib/telegram/upload';

import './SendFiles.css';

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

interface Props {
  files: File[];
  /** Per-item upload state while the batch is in flight, null before sending. */
  progress?: UploadProgress[] | null;
  onsend: (items: SendFileItem[], caption: string) => void;
  oncancelupload: () => void;
  onclose: () => void;
}

export function SendFiles({
  files,
  progress = null,
  onsend,
  oncancelupload,
  onclose
}: Props) {
  // Object URLs must be released or the blobs leak for the tab's lifetime.
  // The dialog is mounted fresh per batch, so seeding the rows once is intended.
  const rows = useSignal<Row[]>(useMemo(() => files.map((file, index) => ({
    id: index,
    file,
    url: file.type.startsWith('image/') || file.type.startsWith('video/') ?
      URL.createObjectURL(file) :
      '',
    // Defaulting an image to "photo" is what people mean by pasting a
    // screenshot; a document keeps its bytes and goes as a file.
    asPhoto: isVisual(file),
    spoiler: false
  })), []));

  const caption = useSignal('');

  /** Index of the row open in the media editor, null when it is closed. */
  const editing = useSignal<number | null>(null);

  const sending = !!progress;

  // The same release as the original's `onDestroy`, run when the dialog unmounts.
  useEffect(() => () => rows.value.forEach((row) => row.url && URL.revokeObjectURL(row.url)), []);

  /**
   * Replaces one row's fields. Svelte's `$state` was a deep proxy and a nested
   * write notified every reader of that field; a signal is shallow, so the list
   * itself is what has to change.
   */
  function patchRow(index: number, patch: Partial<Row>) {
    rows.value = rows.value.map((row, i) => i === index ? {...row, ...patch} : row);
  }

  function remove(index: number) {
    if(sending) return;
    const row = rows.value[index];
    rows.value = rows.value.filter((_, i) => i !== index);
    if(row?.url) URL.revokeObjectURL(row.url);
    if(!rows.value.length) onclose();
  }

  /**
   * The editor hands back a freshly encoded File; it replaces that one item and
   * nothing else — the row keeps its own photo/file and spoiler choice, and the
   * batch caption is untouched.
   */
  function applyEdit(edited: File) {
    const index = editing.value;
    editing.value = null;
    if(index === null) return;
    const row = rows.value[index];
    if(!row) return;
    const previous = row.url;
    // Re-encoding a document into media would otherwise leave it going as a
    // file; the editor only ever emits inline-capable media.
    const asPhoto = isVisual(edited) ? true : row.asPhoto;
    patchRow(index, {
      file: edited,
      url: isVisual(edited) ? URL.createObjectURL(edited) : '',
      asPhoto
    });
    if(previous) URL.revokeObjectURL(previous);
  }

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
    if(sending || !rows.value.length) return;
    // The worker cannot structured-clone a signal, and these items carry the
    // File objects straight through to sendFile — hand over plain copies.
    onsend(
      rows.value.map((row) => ({file: row.file, asPhoto: row.asPhoto, spoiler: row.spoiler})),
      caption.value.trim()
    );
  }

  function onKey(e: KeyboardEvent) {
    // The editor is modal on top of this dialog and runs its own Escape.
    if(editing.value !== null) return;
    if(e.key === 'Escape') sending ? oncancelupload() : onclose();
  }

  // `<svelte:window onkeydown={onKey} />`: the same listener added and removed.
  // The handler reads signals — always current — and `sending`, derived from the
  // `progress` prop, so the props are the dependencies.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sending, oncancelupload, onclose]);

  /**
   * Albums are captioned as a whole, so the caption belongs to the batch and
   * not to any one tile — matching what the official clients send.
   */
  const albumHint = useComputed(() =>
    rows.value.filter((row) => isVisual(row.file) && row.asPhoto).length > 1 ?
      'Sent as one album' :
      ''
  );

  return (
    <>
      <div class="backdrop" onClick={() => !sending && onclose()} role="presentation">
        <div class="dialog-shell" onClick={(e) => e.stopPropagation()} role="presentation">
          <form class="dialog" onSubmit={submit}>
            <header>
              <span>{rows.value.length === 1 ? 'Send file' : `Send ${rows.value.length} files`}</span>
              {albumHint.value ?
                <span class="album-hint">{albumHint.value}</span> :
                null}
            </header>

            <div class="items">
              {rows.value.map((row, index) => {
                const up = progress?.[index];

                return (
                  <div
                    key={row.id}
                    class={['item', !!up?.error && 'failed'].filter(Boolean).join(' ')}
                  >
                    <div class={['thumb', row.spoiler && 'blurred'].filter(Boolean).join(' ')}>
                      {row.url && row.file.type.startsWith('video/') ?
                        /* A video thumbnail has no caption track to offer; the
                           original carried the equivalent svelte-ignore
                           a11y_media_has_caption. */
                        <video src={row.url} muted playsinline preload="metadata"></video> :
                        row.url ?
                          <img src={row.url} alt={row.file.name} /> :
                          <span class="doc-glyph"><Glyph name="file" size={18} /></span>}
                      {row.spoiler ?
                        <span class="spoiler-dots" aria-hidden="true"></span> :
                        null}
                    </div>

                    <div class="meta">
                      <span class="name">{row.file.name || 'Pasted image'}</span>
                      <span class="sub">
                        {up?.error || humanSize(row.file.size)}
                      </span>

                      {up ?
                        <div class="bar" role="progressbar" aria-valuenow={Math.round(up.progress * 100)}>
                          <div class="fill" style={{width: `${Math.round(up.progress * 100)}%`}}></div>
                        </div> :
                        isVisual(row.file) ?
                          <div class="controls">
                            <button
                              type="button"
                              class={['pill', row.asPhoto && 'on'].filter(Boolean).join(' ')}
                              onClick={() => patchRow(index, {asPhoto: true})}
                              title="Compressed, shows inline"
                            >Photo</button>
                            <button
                              type="button"
                              class={['pill', !row.asPhoto && 'on'].filter(Boolean).join(' ')}
                              onClick={() => {
                                // A document is never spoilered — the flag rides on the
                                // inline media, so keep the two from disagreeing.
                                patchRow(index, {asPhoto: false, spoiler: false});
                              }}
                              title="Original quality"
                            >File</button>
                            <button
                              type="button"
                              class={['pill', row.spoiler && 'on'].filter(Boolean).join(' ')}
                              disabled={!row.asPhoto}
                              onClick={() => patchRow(index, {spoiler: !row.spoiler})}
                              title="Hide behind a spoiler until tapped"
                            >Spoiler</button>
                            {isEditableFile(row.file) ?
                              <button
                                type="button"
                                class="pill edit"
                                onClick={() => (editing.value = index)}
                                title="Crop, filter, draw, add text or stickers"
                              >Edit</button> :
                              null}
                          </div> :
                          null}
                    </div>

                    {!sending ?
                      <button
                        type="button"
                        class="remove"
                        onClick={() => remove(index)}
                        aria-label={`Remove ${row.file.name || 'file'}`}
                      ><Glyph name="close" size={14} /></button> :
                      null}
                  </div>
                );
              })}
            </div>

            {/* `autofocus` is deliberate: the dialog only exists because the user
                already picked files to send. The original carried the equivalent
                svelte-ignore a11y_autofocus. */}
            <input
              class="caption"
              autofocus
              placeholder="Caption"
              disabled={sending}
              value={caption.value}
              onInput={(e) => (caption.value = (e.target as HTMLInputElement).value)}
            />

            <footer>
              {sending ?
                <button type="button" onClick={oncancelupload}>Cancel upload</button> :
                <>
                  <button type="button" onClick={onclose}>Cancel</button>
                  <button type="submit" class="primary">Send</button>
                </>}
            </footer>
          </form>
        </div>
      </div>

      {editing.value !== null && rows.value[editing.value] ?
        <MediaEditor
          file={rows.value[editing.value].file}
          onapply={applyEdit}
          oncancel={() => (editing.value = null)}
        /> :
        null}
    </>
  );
}
