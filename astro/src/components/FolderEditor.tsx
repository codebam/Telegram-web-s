/*
 * Ported from svelte/src/lib/components/FolderEditor.svelte.
 */
import {useSignal} from '@preact/signals';

import {
  createFolder,
  deleteFolder,
  updateFolder,
  type DialogItem,
  type FolderItem
} from '$lib/telegram/chats';

import './FolderEditor.css';

interface Props {
  folder: FolderItem | null;
  dialogs: DialogItem[];
  onclose: () => void;
  onsaved: () => void;
}

export function FolderEditor({folder, dialogs, onclose, onsaved}: Props) {
  // The editor is mounted fresh each time it opens, so seeding from the prop
  // once is intended — a signal reads its initial value on the first render
  // only, which keeps that explicit instead of looking like a missed reactive
  // dependency.
  const title = useSignal(folder?.title ?? '');
  const selected = useSignal<Set<number>>(new Set(folder?.includePeerIds ?? []));
  const busy = useSignal(false);
  const error = useSignal('');

  function toggle(peerId: number) {
    const next = new Set(selected.value);
    if(next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected.value = next;
  }

  async function save() {
    if(!title.value.trim() || busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      const peerIds = [...selected.value];
      if(folder) await updateFolder(folder.id, title.value.trim(), peerIds);
      else await createFolder(title.value.trim(), peerIds);
      onsaved();
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to save folder';
    } finally {
      busy.value = false;
    }
  }

  async function remove() {
    if(!folder || busy.value) return;
    busy.value = true;
    try {
      await deleteFolder(folder.id);
      onsaved();
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to delete folder';
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>{folder ? 'Edit folder' : 'New folder'}</header>

        <label class="field">
          <span>Name</span>
          <input
            value={title.value}
            onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
            placeholder="Folder name"
            maxlength={12}
          />
        </label>

        <p class="label">Chats ({selected.value.size})</p>
        <div class="list">
          {dialogs.map((dialog) => (
            <button
              key={dialog.peerId}
              class={['row', selected.value.has(dialog.peerId) && 'on'].filter(Boolean).join(' ')}
              onClick={() => toggle(dialog.peerId)}
            >
              <span class="check">{selected.value.has(dialog.peerId) ? '☑' : '☐'}</span>
              <span class="name">{dialog.title}</span>
            </button>
          ))}
        </div>

        {error.value ? <p class="error">{error.value}</p> : null}

        <footer>
          {folder ?
            <button class="danger" onClick={remove} disabled={busy.value}>Delete</button> :
            null}
          <span class="spacer"></span>
          <button onClick={onclose} disabled={busy.value}>Cancel</button>
          <button class="primary" onClick={save} disabled={busy.value || !title.value.trim()}>
            {busy.value ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
