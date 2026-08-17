<script lang="ts">
  /**
   * Composer control for voice notes and round video messages.
   *
   * Idle it is one (or two) icon buttons; recording it takes over the composer
   * row with an overlay — elapsed time, a live waveform, cancel and send.
   *
   * The button is hold-or-toggle, like the official clients: press and hold to
   * talk and it sends on release, tap it and the recording locks so you can
   * keep your hands free until you press send.
   */
  import {
    RoundVideoRecording,
    VoiceRecording,
    isRoundVideoSupported,
    isVoiceRecordingSupported,
    sendRoundVideo,
    sendVoiceNote,
    ROUND_VIDEO_MAX_MS,
    RECORD_MIN_MS
  } from '$lib/telegram/voice';

  let {
    peerId,
    threadId,
    replyToMsgId,
    onsent,
    onerror
  }: {
    peerId: number;
    threadId?: number;
    replyToMsgId?: number;
    onsent?: () => void;
    onerror?: (message: string) => void;
  } = $props();

  /** How long a press has to last before releasing it means "send". */
  const HOLD_MS = 500;

  const voiceSupported = isVoiceRecordingSupported();
  const videoSupported = isRoundVideoSupported();

  let mode = $state<'voice' | 'video' | null>(null);
  let elapsed = $state(0);
  let sending = $state(false);
  let previewStream = $state<MediaStream | null>(null);

  // Plain (non-reactive) recording state: the recorders are class instances
  // with live media graphs, and the peak buffer is redrawn on a canvas rather
  // than through the DOM — none of it belongs in a $state proxy.
  let voice: VoiceRecording | null = null;
  let video: RoundVideoRecording | null = null;
  let peaks: number[] = [];
  let maxPeak = 0.05;
  let pressedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let canvas: HTMLCanvasElement | undefined = $state();
  let previewVideo: HTMLVideoElement | undefined = $state();

  const recording = $derived(mode !== null);

  function fail(err: any) {
    const name = err?.name;
    const message =
      name === 'NotAllowedError' ? 'Microphone access denied' :
      name === 'NotFoundError' ? 'No recording device found' :
      err?.message || 'Recording failed';
    onerror?.(message);
  }

  function startTimer(recorder: {elapsedMs(): number}) {
    stopTimer();
    timer = setInterval(() => {
      elapsed = recorder.elapsedMs();
      if (mode === 'video' && elapsed >= ROUND_VIDEO_MAX_MS) finish();
    }, 100);
  }

  function stopTimer() {
    clearInterval(timer);
    timer = undefined;
  }

  function pushPeak(peak: number) {
    if (peak > maxPeak) maxPeak = peak;
    peaks.push(Math.min(1, peak / Math.max(maxPeak, 0.02)));
    draw();
  }

  function reset() {
    stopTimer();
    mode = null;
    elapsed = 0;
    peaks = [];
    maxPeak = 0.05;
    voice = null;
    video = null;
    previewStream = null;
  }

  async function startVoice() {
    if (recording || sending || !voiceSupported) return;
    const recorder = new VoiceRecording();
    recorder.onpeak = pushPeak;
    mode = 'voice';
    peaks = [];
    try {
      await recorder.start();
    } catch (err) {
      reset();
      fail(err);
      return;
    }
    voice = recorder;
    startTimer(recorder);
  }

  async function startVideo() {
    if (recording || sending || !videoSupported) return;
    const recorder = new RoundVideoRecording();
    recorder.onpeak = pushPeak;
    mode = 'video';
    peaks = [];
    try {
      await recorder.start();
    } catch (err) {
      reset();
      fail(err);
      return;
    }
    video = recorder;
    previewStream = recorder.stream ?? null;
    startTimer(recorder);
  }

  /** Stop and send whatever is being recorded. */
  async function finish() {
    if (!recording || sending) return;
    const voiceRecorder = mode === 'voice' ? voice : null;
    const videoRecorder = mode === 'video' ? video : null;
    const recorder = voiceRecorder ?? videoRecorder;
    if (!recorder) return;

    stopTimer();
    // Too short to be a message — treat the press as a mis-tap.
    const tooShort = recorder.elapsedMs() < RECORD_MIN_MS;
    sending = true;

    try {
      if (tooShort) {
        await recorder.cancel();
      } else if (voiceRecorder) {
        const result = await voiceRecorder.stop();
        if (result) {
          await sendVoiceNote(peerId, result, {threadId, replyToMsgId});
          onsent?.();
        }
      } else if (videoRecorder) {
        const result = await videoRecorder.stop();
        if (result) {
          await sendRoundVideo(peerId, result, {threadId, replyToMsgId});
          onsent?.();
        }
      }
    } catch (err) {
      fail(err);
    } finally {
      sending = false;
      reset();
    }
  }

  async function cancel() {
    if (!recording) return;
    const recorder = mode === 'voice' ? voice : video;
    stopTimer();
    reset();
    try {
      await recorder?.cancel();
    } catch (err) {
      // Cancelling is best-effort; the stream is torn down either way.
    }
  }

  function onPress(kind: 'voice' | 'video') {
    pressedAt = Date.now();
    if (kind === 'voice') startVoice();
    else startVideo();
  }

  function onRelease() {
    if (!pressedAt) return;
    const held = Date.now() - pressedAt;
    pressedAt = 0;
    // A quick tap locks the recording (toggle mode); a real hold sends on
    // release, so push-to-talk works without a second click.
    if (held >= HOLD_MS && recording) finish();
  }

  function timeLabel(ms: number) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const barWidth = 2;
    const gap = 2;
    const capacity = Math.max(1, Math.floor((width + gap) / (barWidth + gap)));
    if (peaks.length > capacity) peaks.splice(0, peaks.length - capacity);

    ctx.fillStyle = getComputedStyle(canvas).color;
    const visible = peaks.slice(-capacity);
    // Newest bar hugs the right edge, so the trace scrolls left as you speak.
    let x = width - visible.length * (barWidth + gap);
    for (const peak of visible) {
      const barHeight = Math.max(2, peak * height);
      ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
      x += barWidth + gap;
    }
  }

  $effect(() => {
    if (previewVideo && previewStream) {
      previewVideo.srcObject = previewStream;
      previewVideo.play().catch(() => {});
    }
  });

  $effect(() => () => {
    stopTimer();
    voice?.cancel().catch(() => {});
    video?.cancel().catch(() => {});
  });
</script>

{#if recording}
  {#if mode === 'video' && previewStream}
    <div class="round-preview">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video bind:this={previewVideo} muted playsinline autoplay></video>
    </div>
  {/if}

  <div class="panel">
    <button type="button" class="icon danger" onclick={cancel} aria-label="Cancel recording">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
        <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
      </svg>
    </button>
    <span class="dot" aria-hidden="true"></span>
    <span class="time">{timeLabel(elapsed)}</span>
    <canvas bind:this={canvas} class="wave"></canvas>
    <button type="button" class="icon send" onclick={finish} disabled={sending} aria-label="Send recording">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M10 16V4.6M10 4.6L5.6 9M10 4.6L14.4 9" />
      </svg>
    </button>
  </div>
{:else}
  {#if videoSupported}
    <button
      type="button"
      class="icon record"
      onpointerdown={() => onPress('video')}
      onpointerup={onRelease}
      onpointerleave={() => (pressedAt = 0)}
      disabled={sending}
      title="Hold to record a video message"
      aria-label="Record video message"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
        <rect x="2.8" y="5.4" width="9.6" height="9.2" rx="2" />
        <path d="M12.4 9l4.8-2.6v7.2L12.4 11z" />
      </svg>
    </button>
  {/if}
  {#if voiceSupported}
    <button
      type="button"
      class="icon record"
      onpointerdown={() => onPress('voice')}
      onpointerup={onRelease}
      onpointerleave={() => (pressedAt = 0)}
      disabled={sending}
      title="Hold to record a voice message"
      aria-label="Record voice message"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="7.4" y="2.8" width="5.2" height="9" rx="2.6" />
        <path d="M4.8 9.4a5.2 5.2 0 0010.4 0M10 14.6v2.6" />
      </svg>
    </button>
  {/if}
{/if}

<style>
  .icon {
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .record {
    opacity: 0.65;
    transition: opacity 0.12s;
  }

  .record:hover {
    opacity: 1;
  }

  .icon:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* Covers the whole composer row while recording — the text field, attach and
     emoji buttons are meaningless mid-recording. */
  .panel {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border-radius: inherit;
    background: var(--bg, inherit);
    background-color: color-mix(in srgb, var(--text) 6%, var(--bg, #000));
  }

  .dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: #e0483f;
    animation: blink 1.2s infinite;
  }

  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }

  .time {
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    flex: none;
  }

  .wave {
    flex: 1;
    min-width: 0;
    height: 28px;
    color: var(--action, currentColor);
  }

  .danger {
    color: #e0483f;
  }

  .send {
    background: var(--action);
    color: var(--action-ink);
  }

  .round-preview {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    width: 220px;
    height: 220px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    background: #000;
    z-index: 5;
  }

  .round-preview video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Mirror the preview, like every client's selfie view. */
    transform: scaleX(-1);
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
