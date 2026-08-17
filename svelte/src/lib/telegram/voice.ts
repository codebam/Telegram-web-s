/**
 * Voice notes and round video messages.
 *
 * Recording is not reimplemented here: tweb already ships framework-free
 * recorders that produce exactly what the server expects — an OGG/Opus stream
 * built with WebCodecs (`NativeVoiceRecorder`), a centre-cropped square clip
 * from a canvas (`NativeVideoRecorder`), and the iOS-compatible 5-bit waveform
 * payload (`VoiceWaveformAnalyser`). This module is the seam: it drives them,
 * hands the result to `appMessagesManager.sendFile` with the flags that make a
 * document a *voice note* / *video note*, and decodes the waveform bytes back
 * for playback.
 */

import NativeVoiceRecorder, {isNativeVoiceRecorderSupported} from '@helpers/voiceRecorder/nativeVoiceRecorder';
import NativeVideoRecorder, {isNativeVideoRecorderSupported} from '@helpers/videoRecorder/nativeVideoRecorder';
import VoiceWaveformAnalyser from '@helpers/voiceWaveformAnalyser';
import LiveWaveformAnalyser from '@helpers/voiceRecorder/liveWaveformAnalyser';
import {bootTelegram} from '$lib/telegram/client';

/** Square size of a round video note — what iOS and Desktop send. */
export const ROUND_VIDEO_SIZE = 400;

/** Round notes are capped at a minute, like the official clients. */
export const ROUND_VIDEO_MAX_MS = 60_000;

/** Anything shorter than this is a mis-tap, not a message. */
export const RECORD_MIN_MS = 500;

export function isVoiceRecordingSupported(): boolean {
  return isNativeVoiceRecorderSupported();
}

export function isRoundVideoSupported(): boolean {
  return isNativeVideoRecorderSupported();
}

export type VoiceRecordingResult = {
  blob: Blob;
  /** The 63-byte packed payload sent with the message. */
  waveform: Uint8Array;
  duration: number;
};

export type RoundVideoResult = {
  blob: Blob;
  duration: number;
};

type SendOptions = {
  threadId?: number;
  replyToMsgId?: number;
};

/**
 * A voice-note recording session.
 *
 * `start()` opens the mic (through the call stack's `getStream`, so the mic
 * picked in Settings is honoured and a stale device id self-heals), then feeds
 * two taps off the same audio graph: the analyser that builds the waveform the
 * message carries, and a live peak stream the UI draws while recording.
 */
export class VoiceRecording {
  private recorder: NativeVoiceRecorder;
  private analyser: VoiceWaveformAnalyser;
  private live: LiveWaveformAnalyser;
  private startedAt = 0;
  private canceled = false;
  private finish: (result: VoiceRecordingResult | null) => void;

  /** Live amplitude (0..1) for the recording UI, ~20 times a second. */
  public onpeak: (peak: number) => void = () => {};

  public async start(): Promise<void> {
    this.recorder = new NativeVoiceRecorder({
      encoderSampleRate: 48000,
      numberOfChannels: 1
    });

    this.recorder.ondataavailable = (data: Uint8Array) => {
      const waveform = this.analyser?.finish() ?? new Uint8Array(63);
      this.analyser = undefined;
      const duration = Math.max(1, Math.round(this.elapsedMs() / 1000));
      const done = this.finish;
      this.finish = undefined;
      if(!done) return;

      if(this.canceled || !data.length) {
        done(null);
        return;
      }

      done({
        blob: new Blob([data as BlobPart], {type: 'audio/ogg'}),
        waveform,
        duration
      });
    };

    await this.recorder.start();
    this.startedAt = Date.now();

    // Both taps hang off the recorder's source node, so they see the same PCM
    // the encoder does without opening a second microphone stream.
    const source = this.recorder.sourceNode;
    if(source) {
      this.analyser = new VoiceWaveformAnalyser(source);
      this.live = new LiveWaveformAnalyser(source);
      this.live.onpeak = (peak) => this.onpeak(peak);
    }
  }

  public elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  /** Stop and resolve with the encoded note, or `null` if it was cancelled. */
  public stop(): Promise<VoiceRecordingResult | null> {
    if(!this.recorder) return Promise.resolve(null);

    const promise = new Promise<VoiceRecordingResult | null>((resolve) => {
      this.finish = resolve;
    });

    this.teardownLive();
    this.recorder.stop();
    return promise;
  }

  public cancel(): Promise<null> {
    this.canceled = true;
    return this.stop() as Promise<null>;
  }

  private teardownLive() {
    if(this.live) {
      this.live.destroy();
      this.live = undefined;
    }
  }
}

/**
 * A round-video-note recording session.
 *
 * The recorder exposes the raw camera stream so the UI can show the circular
 * preview; what it encodes is a square centre-crop, which is what makes the
 * sent file match `documentAttributeVideo`'s w/h.
 */
export class RoundVideoRecording {
  private recorder: NativeVideoRecorder;
  private audioContext: AudioContext;
  private live: LiveWaveformAnalyser;
  private startedAt = 0;
  private canceled = false;
  private finish: (result: RoundVideoResult | null) => void;

  public onpeak: (peak: number) => void = () => {};

  /** The camera feed, for the preview circle. Set once `start()` resolves. */
  public get stream(): MediaStream | undefined {
    return this.recorder?.stream;
  }

  public async start(): Promise<void> {
    this.recorder = new NativeVideoRecorder({
      width: ROUND_VIDEO_SIZE,
      height: ROUND_VIDEO_SIZE,
      frameRate: 30,
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 64_000
    });

    this.recorder.ondataavailable = (blob: Blob) => {
      const duration = Math.max(1, Math.round(this.elapsedMs() / 1000));
      const done = this.finish;
      this.finish = undefined;
      if(!done) return;
      done(this.canceled || !blob?.size ? null : {blob, duration});
    };

    await this.recorder.start();
    this.startedAt = Date.now();
    this.tapAudio();
  }

  /**
   * MediaRecorder does not hand back PCM, so the live waveform listens to a
   * *clone* of the microphone track — tapping the recorded track itself starves
   * both consumers and yields a silent clip.
   */
  private tapAudio() {
    const track = this.recorder.stream?.getAudioTracks()[0];
    if(!track) return;

    try {
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(new MediaStream([track.clone()]));
      this.live = new LiveWaveformAnalyser(source);
      this.live.onpeak = (peak) => this.onpeak(peak);
    } catch(err) {
      // A missing waveform is cosmetic; the recording carries on.
    }
  }

  public elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  public stop(): Promise<RoundVideoResult | null> {
    if(!this.recorder) return Promise.resolve(null);

    const promise = new Promise<RoundVideoResult | null>((resolve) => {
      this.finish = resolve;
    });

    this.teardown();
    this.recorder.stop();
    this.recorder.releaseStream();
    return promise;
  }

  public cancel(): Promise<null> {
    this.canceled = true;
    return this.stop() as Promise<null>;
  }

  private teardown() {
    if(this.live) {
      this.live.destroy();
      this.live = undefined;
    }
    if(this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = undefined;
    }
  }
}

/**
 * Send an OGG/Opus recording as a real voice note.
 *
 * `isVoiceMessage` is what turns the upload into
 * `documentAttributeAudio{voice: true, waveform}` inside
 * `appMessagesManager.sendFile` — sending the same blob without it lands a
 * plain music file in the chat.
 */
export async function sendVoiceNote(
  peerId: number,
  recording: VoiceRecordingResult,
  options: SendOptions = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendFile({
    peerId,
    file: recording.blob,
    isVoiceMessage: true,
    isMedia: true,
    duration: recording.duration,
    // Must stay a plain Uint8Array — the worker structured-clones it.
    waveform: recording.waveform,
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  });
}

/** Send a square clip as a round video note (`documentAttributeVideo.round_message`). */
export async function sendRoundVideo(
  peerId: number,
  recording: RoundVideoResult,
  options: SendOptions = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendFile({
    peerId,
    file: recording.blob,
    isRoundMessage: true,
    isMedia: true,
    duration: recording.duration,
    width: ROUND_VIDEO_SIZE,
    height: ROUND_VIDEO_SIZE,
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  });
}

/**
 * Unpack the waveform a voice note carries.
 *
 * The payload is 100 samples of 5 bits each, packed LSB-first across byte
 * boundaries — read a 16-bit window at the sample's bit offset and mask off the
 * low five bits. Returns values in 0..31.
 */
export function decodeWaveform(waveform: Uint8Array | number[] | undefined): number[] {
  if(!waveform || !waveform.length) return [];
  const bytes = waveform instanceof Uint8Array ? waveform : new Uint8Array(waveform);

  const count = Math.floor((bytes.length * 8) / 5);
  const result: number[] = new Array(count);

  for(let i = 0; i < count; ++i) {
    const bitOffset = i * 5;
    const byteIndex = bitOffset >> 3;
    const shift = bitOffset & 7;
    const low = bytes[byteIndex];
    const high = byteIndex + 1 < bytes.length ? bytes[byteIndex + 1] : 0;
    result[i] = ((low | (high << 8)) >> shift) & 31;
  }

  return result;
}
