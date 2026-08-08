<script lang="ts">
  import {openMiniApp} from '$lib/telegram/settings';

  let {botId, peerId, onclose}: {botId: number; peerId: number; onclose: () => void} = $props();

  let url = $state<string | null>(null);
  let error = $state('');

  $effect(() => {
    const id = botId;
    url = null;
    error = '';

    openMiniApp(id, peerId)
      .then((resolved) => {
        if(id !== botId) return;
        if(resolved) url = resolved;
        else error = 'This bot did not return a mini app URL';
      })
      .catch((err) => (error = err?.type || err?.message || 'Failed to open mini app'));
  });
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="frame" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <span>Mini app</span>
      <button onclick={onclose} aria-label="Close">✕</button>
    </header>
    {#if error}
      <p class="muted">{error}</p>
    {:else if !url}
      <p class="muted">Loading…</p>
    {:else}
      <!-- Bot mini apps are third-party pages; keep them sandboxed. -->
      <iframe
        src={url}
        title="Mini app"
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        allow="clipboard-write"
      ></iframe>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 96;
  }

  .frame {
    width: min(460px, calc(100vw - 24px));
    height: min(720px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  header button {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
  }

  iframe {
    flex: 1;
    border: none;
    width: 100%;
  }

  .muted {
    color: var(--text-dim);
    padding: 18px;
  }
</style>
