<script lang="ts">
  import {savedGifIds, toggleSavedGif} from '$lib/telegram/stickers';

  let {
    docId,
    ondone
  }: {docId: string; ondone?: () => void} = $props();

  let saved = $state(false);
  let busy = $state(false);

  $effect(() => {
    const id = docId;
    let cancelled = false;
    savedGifIds()
      .then((ids) => {
        if (!cancelled) saved = ids.has(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  });

  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      await toggleSavedGif(docId, !saved);
      saved = !saved;
    } catch (err) {
      // The limit or a lost reference — nothing worth blocking the menu for.
    } finally {
      busy = false;
      ondone?.();
    }
  }
</script>

<button onclick={toggle} disabled={busy}>{saved ? 'Remove GIF' : 'Save GIF'}</button>
