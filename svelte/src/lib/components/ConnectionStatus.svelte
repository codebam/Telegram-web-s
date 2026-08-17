<script lang="ts">
  import {CONNECTION_LABELS, subscribeConnection, type ConnectionState} from '$lib/telegram/connection';

  let current = $state<ConnectionState>('connected');

  /* A healthy tab dips through 'connecting' on every reconnect, so showing the
     bar the instant the state changes makes it flicker on an otherwise fine
     connection. Only commit a non-connected state once it has held; going back
     to 'connected' is applied immediately. */
  let shown = $state<ConnectionState>('connected');

  $effect(() => subscribeConnection((next) => (current = next)));

  $effect(() => {
    const next = current;

    if (next === 'connected') {
      shown = 'connected';
      return;
    }

    const timer = setTimeout(() => (shown = next), 1000);
    return () => clearTimeout(timer);
  });
</script>

{#if shown !== 'connected'}
  <div class="connection" class:offline={shown === 'waitingForNetwork'} role="status">
    <span class="spinner"></span>
    <span>{CONNECTION_LABELS[shown]}</span>
  </div>
{/if}

<style>
  .connection {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 500;
  }

  .connection.offline {
    color: var(--danger);
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .offline .spinner {
    border-top-color: var(--danger);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
