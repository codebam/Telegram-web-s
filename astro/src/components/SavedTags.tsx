/*
 * Ported from svelte/src/lib/components/SavedTags.svelte.
 *
 * The `$effect` here depends on the `savedPeerId` prop, not on a signal, so it
 * becomes a `useEffect` with that prop in its dependency list —
 * `useSignalEffect` tracks signal reads only and would never re-run.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadSavedTags, renameSavedTag, type SavedTagItem} from '$lib/telegram/topics';

import './SavedTags.css';

interface Props {
  /** Scopes the tag list to one saved sub-chat; undefined means all of Saved. */
  savedPeerId?: number;
  active?: string;
  onselect: (emoticon: string) => void;
}

export function SavedTags({savedPeerId, active = '', onselect}: Props) {
  const tags = useSignal<SavedTagItem[]>([]);
  const renaming = useSignal<string | null>(null);
  const renameValue = useSignal('');
  const error = useSignal('');

  // Svelte compared the scope against the current prop inside the async
  // callback; a closure in JSX would see the value from the render that started
  // the load, so the latest one is kept in a ref.
  const currentSavedPeerId = useRef(savedPeerId);
  currentSavedPeerId.current = savedPeerId;

  async function refresh() {
    tags.value = await loadSavedTags(savedPeerId);
  }

  useEffect(() => {
    const scope = savedPeerId;
    loadSavedTags(scope).then((items) => {
      if(scope === currentSavedPeerId.current) tags.value = items;
    });
  }, [savedPeerId]);

  function startRename(tag: SavedTagItem) {
    renaming.value = tag.emoticon;
    renameValue.value = tag.title;
  }

  async function commitRename() {
    const emoticon = renaming.value;
    if(!emoticon) return;
    renaming.value = null;
    error.value = '';
    try {
      await renameSavedTag(emoticon, renameValue.value.trim());
      await refresh();
    } catch (err: any) {
      error.value = err?.type || err?.message || 'Could not rename the tag';
    }
  }

  // The whole strip — tags, the rename row and the error — is behind the
  // original's `{#if tags.length}`.
  if(!tags.value.length) return null;

  return (
    <>
      <div class="tags">
        <button
          class={['tag', !active && 'on'].filter(Boolean).join(' ')}
          onClick={() => onselect('')}
        >
          All
        </button>
        {tags.value.map((tag) => (
          <button
            key={tag.emoticon}
            class={['tag', tag.emoticon === active && 'on'].filter(Boolean).join(' ')}
            onClick={() => onselect(tag.emoticon === active ? '' : tag.emoticon)}
            onDblClick={() => startRename(tag)}
            title="Double-click to rename"
          >
            <span class="emoji">{tag.emoticon}</span>
            {tag.title && <span class="name">{tag.title}</span>}
            {tag.count > 0 && <span class="count">{tag.count}</span>}
          </button>
        ))}
      </div>

      {renaming.value && (
        <div class="rename">
          <input
            value={renameValue.value}
            placeholder="Tag name"
            maxlength={12}
            onInput={(e) => (renameValue.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e: KeyboardEvent) => {
              if(e.key === 'Enter') commitRename();
              else if(e.key === 'Escape') renaming.value = null;
            }}
          />
          <button onClick={commitRename}>Save</button>
          <button onClick={() => (renaming.value = null)}>Cancel</button>
        </div>
      )}

      {error.value && <p class="error">{error.value}</p>}
    </>
  );
}
