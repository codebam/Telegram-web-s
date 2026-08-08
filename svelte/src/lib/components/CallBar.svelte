<script lang="ts">
  import {acceptCall, hangUp, onCallState, toggleCallMute, type CallState} from '$lib/telegram/extras';

  let call = $state<CallState | null>(null);
  let muted = $state(false);

  $effect(() => {
    let off: (() => void) | undefined;
    let disposed = false;

    onCallState((state) => {
      call = state;
      if(state) muted = state.muted;
    }).then((unsubscribe) => {
      if(disposed) unsubscribe();
      else off = unsubscribe;
    });

    return () => {
      disposed = true;
      off?.();
    };
  });

  async function mute() {
    muted = await toggleCallMute();
  }

  const incoming = $derived(call?.status === 'incoming');
</script>

{#if call}
  <div class="call-bar" class:ringing={incoming}>
    <span class="dot"></span>
    <span class="label">
      {incoming ? 'Incoming call' : call.isVideo ? 'Video call' : 'Call'} · {call.status}
    </span>

    {#if incoming}
      <button class="accept" onclick={acceptCall}>Accept</button>
    {:else}
      <button onclick={mute}>{muted ? 'Unmute' : 'Mute'}</button>
    {/if}
    <button class="end" onclick={hangUp}>End</button>
  </div>
{/if}

<style>
  /* Sits above the shell, which is sized to the full viewport. */
  .call-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 18px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    flex: none;
  }

  .call-bar.ringing {
    animation: pulse 1.6s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      filter: brightness(1.2);
    }
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
  }

  .label {
    flex: 1;
    text-transform: capitalize;
  }

  button {
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.5);
    background: transparent;
    color: #fff;
    cursor: pointer;
    font-size: 12px;
  }

  .accept {
    background: #fff;
    color: var(--accent);
    border-color: transparent;
    font-weight: 600;
  }

  .end {
    background: var(--danger);
    border-color: transparent;
  }
</style>
