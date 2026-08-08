<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    acceptCall,
    getCallVideo,
    hangUp,
    onCallState,
    toggleCallMute,
    toggleCallScreen,
    toggleCallVideo,
    type CallState
  } from '$lib/telegram/extras';

  let call = $state<CallState | null>(null);
  let minimised = $state(false);
  /** Shown briefly after a call ends, so it does not just vanish. */
  let farewell = $state('');
  let farewellTimer: ReturnType<typeof setTimeout> | undefined;
  let remoteSlot: HTMLDivElement | undefined = $state();
  let localSlot: HTMLDivElement | undefined = $state();

  $effect(() => {
    let off: (() => void) | undefined;
    let disposed = false;

    onCallState((state) => {
      const previous = call;

      if(state?.phase === 'ended' || (!state && previous)) {
        const reason = state?.endReason || previous?.endReason || '';
        farewell =
          reason === 'busy' ? `${previous?.title ?? 'They'} is on another call` :
          reason === 'missed' ? 'No answer' :
          reason === 'disconnected' ? 'Call disconnected' :
          previous && previous.phase !== 'connected' ? 'Call ended' : '';

        if(farewell) {
          clearTimeout(farewellTimer);
          farewellTimer = setTimeout(() => (farewell = ''), 4000);
        }
      }

      call = state;
      if(!state) minimised = false;
    }).then((unsubscribe) => {
      if(disposed) unsubscribe();
      else off = unsubscribe;
    });

    return () => {
      disposed = true;
      off?.();
    };
  });

  /**
   * The P2P engine owns the <video> elements, so mount whatever it hands back
   * rather than trying to re-derive a MediaStream.
   */
  $effect(() => {
    if(!call || call.phase !== 'connected' || minimised) return;

    let cancelled = false;

    (async () => {
      const [remote, local] = await Promise.all([getCallVideo('output'), getCallVideo('input')]);
      if(cancelled) return;

      if(remote && remoteSlot && remote.parentElement !== remoteSlot) {
        remoteSlot.replaceChildren(remote);
      }
      if(local && localSlot && local.parentElement !== localSlot) {
        local.muted = true;
        localSlot.replaceChildren(local);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function clock(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const statusText = $derived(
    !call ? '' :
    call.phase === 'incoming' ? 'Incoming call' :
    call.phase === 'outgoing' ? 'Ringing…' :
    call.phase === 'connecting' ? 'Connecting…' :
    call.phase === 'connected' ? clock(call.duration) :
    'Call ended'
  );

  const hasVideo = $derived(!!call?.sharingVideo || !!call?.sharingScreen);
</script>

{#if farewell && !call}
  <button class="farewell" onclick={() => (farewell = '')}>{farewell}</button>
{/if}

{#if call}
  {#if minimised}
    <button class="mini" onclick={() => (minimised = false)}>
      <span class="pip"></span>
      <span>{call.title}</span>
      <span class="mini-time">{statusText}</span>
    </button>
  {:else}
    <div class="screen" class:ringing={call.phase === 'incoming'}>
      <div class="stage">
        <div class="remote" bind:this={remoteSlot} class:has-video={hasVideo}></div>

        {#if !hasVideo}
          <div class="portrait">
            <Avatar peerId={call.peerId} title={call.title} size={132} />
          </div>
        {/if}

        <div class="local" bind:this={localSlot} class:on={call.sharingVideo || call.sharingScreen}></div>

        <div class="info">
          <h2>{call.title}</h2>
          <p class="status">{statusText}</p>

          {#if call.fingerprint.length}
            <p class="fingerprint" title="Compare these with the other person to verify the call">
              {call.fingerprint.join(' ')}
            </p>
          {/if}
        </div>

        <button class="minimise" onclick={() => (minimised = true)} aria-label="Minimise call">▾</button>
      </div>

      <div class="controls">
        {#if call.phase === 'incoming'}
          <button class="round decline" onclick={hangUp} aria-label="Decline">✕</button>
          <button class="round accept" onclick={acceptCall} aria-label="Accept">✆</button>
        {:else}
          <button class="round" class:active={call.muted} onclick={toggleCallMute} aria-label="Mute">
            {call.muted ? '🔇' : '🎙'}
          </button>
          <button class="round" class:active={call.sharingVideo} onclick={toggleCallVideo} aria-label="Camera">
            🎥
          </button>
          <button class="round" class:active={call.sharingScreen} onclick={toggleCallScreen} aria-label="Share screen">
            🖥
          </button>
          <button class="round decline" onclick={hangUp} aria-label="End call">✕</button>
        {/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  .screen {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    grid-template-rows: 1fr auto;
    background:
      radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--accent) 55%, transparent), transparent 70%),
      #0a0b12;
    color: #fff;
  }

  .screen.ringing {
    animation: breathe 2.4s ease-in-out infinite;
  }

  @keyframes breathe {
    50% { background-color: #10101d; }
  }

  .stage {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
  }

  .remote {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .remote.has-video :global(video) {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }

  .portrait {
    position: relative;
    z-index: 1;
    margin-bottom: 120px;
  }

  .local {
    position: absolute;
    right: 20px;
    bottom: 20px;
    width: 150px;
    border-radius: 12px;
    overflow: hidden;
    display: none;
    z-index: 2;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }

  .local.on {
    display: block;
  }

  .local :global(video) {
    width: 100%;
    display: block;
  }

  .info {
    position: absolute;
    bottom: 28px;
    left: 0;
    right: 0;
    text-align: center;
    z-index: 3;
    display: grid;
    gap: 4px;
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
  }

  .status {
    margin: 0;
    color: rgba(255, 255, 255, 0.72);
    font-variant-numeric: tabular-nums;
  }

  .fingerprint {
    margin: 6px 0 0;
    font-size: 20px;
    letter-spacing: 6px;
  }

  .minimise {
    position: absolute;
    top: 18px;
    left: 18px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    cursor: pointer;
    font-size: 16px;
    z-index: 3;
  }

  .controls {
    display: flex;
    justify-content: center;
    gap: 18px;
    padding: 26px 20px calc(30px + env(safe-area-inset-bottom));
  }

  .round {
    width: 58px;
    height: 58px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    font-size: 21px;
    cursor: pointer;
    transition: background 0.15s, transform 0.15s;
  }

  .round:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  .round:active {
    transform: scale(0.94);
  }

  .round.active {
    background: #fff;
    color: #14161f;
  }

  .accept {
    background: #3aa657;
  }

  .accept:hover {
    background: #45bd66;
  }

  .decline {
    background: var(--danger);
  }

  .decline:hover {
    background: #ef5b60;
  }

  .farewell {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 121;
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-solid);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
  }

  .mini {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
  }

  .pip {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
    animation: blink 1.6s ease-in-out infinite;
  }

  @keyframes blink {
    50% { opacity: 0.35; }
  }

  .mini-time {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  @media (prefers-reduced-motion: reduce) {
    .screen.ringing,
    .pip {
      animation: none;
    }
  }
</style>
