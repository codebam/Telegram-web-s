/*
 * Composer control for voice notes and round video messages.
 *
 * Idle it is one (or two) icon buttons; recording it takes over the composer
 * row with an overlay — elapsed time, a live waveform, cancel and send.
 *
 * The button is hold-or-toggle, like the official clients: press and hold to
 * talk and it sends on release, tap it and the recording locks so you can
 * keep your hands free until you press send.
 *
 * Ported from svelte/src/lib/components/VoiceRecorder.svelte. Two details carry
 * the port:
 *  - the per-instance `let`s that were deliberately *not* reactive are refs, so
 *    they survive a re-render (a Preact body runs on every render; a plain local
 *    would drop the live recorder and the peak buffer mid-recording);
 *  - the props read from the recording timer and the recorder callbacks are kept
 *    in a ref — in Svelte those reads always saw the current value, while a JSX
 *    closure sees the render it was created in and the timer outlives it.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

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
import {sendTyping} from '$lib/telegram/chats';

import './VoiceRecorder.css';

interface Props {
  peerId: number;
  threadId?: number;
  replyToMsgId?: number;
  onsent?: () => void;
  onerror?: (message: string) => void;
}

export function VoiceRecorder({peerId, threadId, replyToMsgId, onsent, onerror}: Props) {
  /** How long a press has to last before releasing it means "send". */
  const HOLD_MS = 500;

  // Probed once per instance (the Svelte body ran once); a Preact body runs on
  // every render, so the probe is memoised rather than repeated.
  const voiceSupported = useMemo(() => isVoiceRecordingSupported(), []);
  const videoSupported = useMemo(() => isRoundVideoSupported(), []);

  const mode = useSignal<'voice' | 'video' | null>(null);
  const elapsed = useSignal(0);
  const sending = useSignal(false);
  const previewStream = useSignal<MediaStream | null>(null);

  // Plain (non-reactive) recording state: the recorders are class instances
  // with live media graphs, and the peak buffer is redrawn on a canvas rather
  // than through the DOM — none of it belongs in a signal proxy.
  const voice = useRef<VoiceRecording | null>(null);
  const video = useRef<RoundVideoRecording | null>(null);
  const peaks = useRef<number[]>([]);
  const maxPeak = useRef(0.05);
  const pressedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  // The latest render's props, for the callbacks that outlive it (the 100ms
  // recording timer, and the recorder's own async callbacks).
  const latest = useRef({peerId, threadId, replyToMsgId, onsent, onerror});
  latest.current = {peerId, threadId, replyToMsgId, onsent, onerror};

  const recording = useComputed(() => mode.value !== null);

  function fail(err: {name?: string; message?: string}) {
    const name = err?.name;
    const message =
      name === 'NotAllowedError' ? 'Microphone access denied' :
      name === 'NotFoundError' ? 'No recording device found' :
      err?.message || 'Recording failed';
    latest.current.onerror?.(message);
  }

  function startTimer(recorder: {elapsedMs(): number}) {
    stopTimer();
    timer.current = setInterval(() => {
      elapsed.value = recorder.elapsedMs();
      if(mode.value === 'video' && elapsed.value >= ROUND_VIDEO_MAX_MS) finish();
    }, 100);
  }

  function stopTimer() {
    clearInterval(timer.current);
    timer.current = undefined;
  }

  function pushPeak(peak: number) {
    if(peak > maxPeak.current) maxPeak.current = peak;
    peaks.current.push(Math.min(1, peak / Math.max(maxPeak.current, 0.02)));
    draw();
  }

  function reset() {
    stopTimer();
    mode.value = null;
    elapsed.value = 0;
    peaks.current = [];
    maxPeak.current = 0.05;
    voice.current = null;
    video.current = null;
    previewStream.value = null;
  }

  async function startVoice() {
    if(recording.value || sending.value || !voiceSupported) return;
    const recorder = new VoiceRecording();
    recorder.onpeak = pushPeak;
    mode.value = 'voice';
    peaks.current = [];
    try {
      await recorder.start();
    } catch(err) {
      reset();
      fail(err);
      return;
    }
    voice.current = recorder;
    // The peer reads "recording voice" rather than "typing" while this runs.
    sendTyping(peerId, threadId, 'voice').catch(() => {});
    startTimer(recorder);
  }

  async function startVideo() {
    if(recording.value || sending.value || !videoSupported) return;
    const recorder = new RoundVideoRecording();
    recorder.onpeak = pushPeak;
    mode.value = 'video';
    peaks.current = [];
    try {
      await recorder.start();
    } catch(err) {
      reset();
      fail(err);
      return;
    }
    video.current = recorder;
    previewStream.value = recorder.stream ?? null;
    sendTyping(peerId, threadId, 'round').catch(() => {});
    startTimer(recorder);
  }

  /** Stop and send whatever is being recorded. */
  async function finish() {
    if(!recording.value || sending.value) return;
    // Read through the ref: the 100ms timer can land here from a closure that
    // predates the current props, and the note must go to the peer it was
    // recorded for.
    const {peerId, threadId, replyToMsgId, onsent} = latest.current;
    const voiceRecorder = mode.value === 'voice' ? voice.current : null;
    const videoRecorder = mode.value === 'video' ? video.current : null;
    const recorder = voiceRecorder ?? videoRecorder;
    if(!recorder) return;

    stopTimer();
    // Too short to be a message — treat the press as a mis-tap.
    const tooShort = recorder.elapsedMs() < RECORD_MIN_MS;
    sending.value = true;

    try {
      if(tooShort) {
        await recorder.cancel();
      } else if(voiceRecorder) {
        const result = await voiceRecorder.stop();
        if(result) {
          await sendVoiceNote(peerId, result, {threadId, replyToMsgId});
          onsent?.();
        }
      } else if(videoRecorder) {
        const result = await videoRecorder.stop();
        if(result) {
          await sendRoundVideo(peerId, result, {threadId, replyToMsgId});
          onsent?.();
        }
      }
    } catch(err) {
      fail(err);
    } finally {
      sending.value = false;
      reset();
      // The recording status gives way to the send itself (whose upload the
      // manager reports as its own action).
      sendTyping(peerId, threadId, 'cancel').catch(() => {});
    }
  }

  async function cancel() {
    if(!recording.value) return;
    const recorder = mode.value === 'voice' ? voice.current : video.current;
    stopTimer();
    reset();
    sendTyping(peerId, threadId, 'cancel').catch(() => {});
    try {
      await recorder?.cancel();
    } catch(err) {
      // Cancelling is best-effort; the stream is torn down either way.
    }
  }

  function onPress(kind: 'voice' | 'video') {
    pressedAt.current = Date.now();
    if(kind === 'voice') startVoice();
    else startVideo();
  }

  function onRelease() {
    if(!pressedAt.current) return;
    const held = Date.now() - pressedAt.current;
    pressedAt.current = 0;
    // A quick tap locks the recording (toggle mode); a real hold sends on
    // release, so push-to-talk works without a second click.
    if(held >= HOLD_MS && recording.value) finish();
  }

  function timeLabel(ms: number) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function draw() {
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if(!width || !height) return;

    if(canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const barWidth = 2;
    const gap = 2;
    const capacity = Math.max(1, Math.floor((width + gap) / (barWidth + gap)));
    if(peaks.current.length > capacity) peaks.current.splice(0, peaks.current.length - capacity);

    ctx.fillStyle = getComputedStyle(canvas).color;
    const visible = peaks.current.slice(-capacity);
    // Newest bar hugs the right edge, so the trace scrolls left as you speak.
    let x = width - visible.length * (barWidth + gap);
    for(const peak of visible) {
      const barHeight = Math.max(2, peak * height);
      ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
      x += barWidth + gap;
    }
  }

  // `previewStream` is a signal but the video node is a ref, so this is a
  // `useEffect` over the committed values rather than a `useSignalEffect`: the
  // element mounts a commit after `mode` flips, and the binding has to be
  // applied to the node that actually exists.
  useEffect(() => {
    const previewVideo = previewVideoRef.current;
    const stream = previewStream.value;
    if(previewVideo && stream) {
      previewVideo.srcObject = stream;
      previewVideo.play().catch(() => {});
    }
  }, [mode.value, previewStream.value]);

  // The original's teardown effect: the interval must not outlive the component,
  // and both recorders hold the mic/camera until they are cancelled.
  useEffect(() => () => {
    stopTimer();
    voice.current?.cancel().catch(() => {});
    video.current?.cancel().catch(() => {});
  }, []);

  return (
    recording.value ?
      <>
        {mode.value === 'video' && previewStream.value ?
          <div class="round-preview">
            {/* The self-view of the recording in progress: muted (the mic is
                being recorded, not monitored) and inline, like every client's
                selfie preview. */}
            <video ref={previewVideoRef} muted playsInline autoPlay></video>
          </div> :
          null}

        <div class="panel">
          <button type="button" class="icon danger" onClick={cancel} aria-label="Cancel recording">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
              <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
            </svg>
          </button>
          <span class="dot" aria-hidden="true"></span>
          <span class="time">{timeLabel(elapsed.value)}</span>
          <canvas ref={canvasRef} class="wave"></canvas>
          <button type="button" class="icon send" onClick={finish} disabled={sending.value} aria-label="Send recording">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M10 16V4.6M10 4.6L5.6 9M10 4.6L14.4 9" />
            </svg>
          </button>
        </div>
      </> :
      <>
        {videoSupported &&
          <button
            type="button"
            class="icon record"
            onPointerDown={() => onPress('video')}
            onPointerUp={onRelease}
            onPointerLeave={() => (pressedAt.current = 0)}
            disabled={sending.value}
            title="Hold to record a video message"
            aria-label="Record video message"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
              <rect x="2.8" y="5.4" width="9.6" height="9.2" rx="2" />
              <path d="M12.4 9l4.8-2.6v7.2L12.4 11z" />
            </svg>
          </button>}

        {voiceSupported &&
          <button
            type="button"
            class="icon record"
            onPointerDown={() => onPress('voice')}
            onPointerUp={onRelease}
            onPointerLeave={() => (pressedAt.current = 0)}
            disabled={sending.value}
            title="Hold to record a voice message"
            aria-label="Record voice message"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="7.4" y="2.8" width="5.2" height="9" rx="2.6" />
              <path d="M4.8 9.4a5.2 5.2 0 0010.4 0M10 14.6v2.6" />
            </svg>
          </button>}
      </>
  );
}
