import {bootTelegram} from './client';
import {loadAvatarUrl, readMediaContents} from './chats';

/**
 * The app's single audio playback controller.
 *
 * One `<audio>` element lives here, outside every component, so playback keeps
 * going while the user switches chats, opens settings or scrolls away from the
 * message that started it — the same contract as tweb's
 * appMediaPlaybackController. Components subscribe for state and call the
 * commands; nothing else owns an audio element.
 *
 * Everything exported is plain and cloneable: raw MTProto objects stay in the
 * module-level caches and never reach Svelte state.
 */

export type PlayerTrack = {
  peerId: number;
  mid: number;
  /** Song title, file name, or "Voice message". */
  title: string;
  /** Performer for music, the sender for a voice message. */
  subtitle: string;
  duration: number;
  isVoice: boolean;
};

export type RepeatMode = 'none' | 'one' | 'all';

export type PlayerState = {
  track: PlayerTrack | null;
  playing: boolean;
  loading: boolean;
  time: number;
  duration: number;
  speed: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  error: string;
};

const SPEEDS = [0.5, 1, 1.5, 2];

let audio: HTMLAudioElement | null = null;
let playlist: PlayerTrack[] = [];
let playlistKey = '';
let playlistLoading: Promise<void> | null = null;
/** Guards against a slow download resolving after the user moved on. */
let loadToken = 0;

const urlCache = new Map<string, string | null>();

const state: PlayerState = {
  track: null,
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  speed: 1,
  volume: 1,
  muted: false,
  repeat: 'none',
  shuffle: false,
  hasPrev: false,
  hasNext: false,
  error: ''
};

const listeners = new Set<(state: PlayerState) => void>();

function emit() {
  const snapshot = {...state};
  listeners.forEach((listener) => listener(snapshot));
}

/** Current state; callers get a copy, not the live object. */
export function playerState(): PlayerState {
  return {...state};
}

export function subscribePlayer(listener: (state: PlayerState) => void): () => void {
  listeners.add(listener);
  listener({...state});
  return () => listeners.delete(listener);
}

export function isPlayerTrack(peerId: number, mid: number): boolean {
  return state.track?.peerId === peerId && state.track?.mid === mid;
}

export const playerSpeeds = SPEEDS;

/* ------------------------------------------------------------------ */
/* The element                                                         */
/* ------------------------------------------------------------------ */

function element(): HTMLAudioElement {
  if(audio) return audio;

  audio = new Audio();
  audio.preload = 'auto';

  audio.addEventListener('timeupdate', () => {
    state.time = audio!.currentTime;
    emit();
    updatePositionState();
  });

  audio.addEventListener('durationchange', () => {
    if(Number.isFinite(audio!.duration)) {
      state.duration = audio!.duration;
      emit();
    }
  });

  audio.addEventListener('play', () => {
    state.playing = true;
    state.loading = false;
    emit();
    setSessionPlaybackState('playing');
  });

  audio.addEventListener('pause', () => {
    state.playing = false;
    emit();
    setSessionPlaybackState('paused');
  });

  audio.addEventListener('ended', () => {
    if(state.repeat === 'one') {
      audio!.currentTime = 0;
      audio!.play().catch(() => {});
      return;
    }

    playNext(true);
  });

  audio.addEventListener('error', () => {
    state.error = 'Playback failed';
    state.loading = false;
    state.playing = false;
    emit();
  });

  return audio;
}

/**
 * Nothing else in the page should be making noise once the bar takes over —
 * bubbles render their own inline controls and two sources playing at once is
 * the worst possible outcome.
 */
function silenceOtherMedia() {
  document.querySelectorAll('audio, video').forEach((node) => {
    const media = node as HTMLMediaElement;
    if(media !== audio && !media.paused && !media.muted) media.pause();
  });
}

/* ------------------------------------------------------------------ */
/* Track loading                                                       */
/* ------------------------------------------------------------------ */

function audioAttribute(document: any): any {
  return (document?.attributes ?? []).find((a: any) => a._ === 'documentAttributeAudio');
}

function fileNameOf(document: any): string {
  const attribute = (document?.attributes ?? []).find((a: any) => a._ === 'documentAttributeFilename');
  return attribute?.file_name ?? '';
}

async function trackOf(peerId: number, message: any, senderTitle: string): Promise<PlayerTrack | null> {
  const document = message?.media?.document;
  const attribute = audioAttribute(document);
  if(!attribute || message.media?.ttl_seconds) return null;

  const isVoice = !!attribute.pFlags?.voice;

  return {
    peerId,
    mid: message.mid,
    title: isVoice ?
      'Voice message' :
      (attribute.title || fileNameOf(document) || 'Audio'),
    subtitle: isVoice ? senderTitle : (attribute.performer || senderTitle),
    duration: attribute.duration ?? 0,
    isVoice
  };
}

async function senderTitleOf(message: any): Promise<string> {
  const {managers} = await bootTelegram();
  const fromId = Number(message?.fromId ?? message?.peerId ?? 0);
  if(!fromId) return '';

  try {
    const peer: any = await managers.appPeersManager.getPeer(fromId);
    if(peer?._ === 'user') {
      return [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim() ||
        peer.username || 'User';
    }
    return peer?.title ?? '';
  } catch(err) {
    return '';
  }
}

async function urlOf(peerId: number, mid: number): Promise<string | null> {
  const key = `${peerId}_${mid}`;
  if(urlCache.has(key)) return urlCache.get(key)!;

  const {managers} = await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  const document = message?.media?.document;
  if(!document) return null;

  try {
    const url = await appDownloadManager.downloadMediaURL({media: document});
    urlCache.set(key, url ?? null);
    return url ?? null;
  } catch(err) {
    urlCache.set(key, null);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The playlist                                                        */
/* ------------------------------------------------------------------ */

/**
 * Music and voice are separate queues, exactly as the official clients treat
 * them: skipping through an album should not land on somebody's voice note.
 */
async function loadPlaylist(peerId: number, isVoice: boolean, aroundMid: number): Promise<void> {
  const key = `${peerId}_${isVoice ? 'voice' : 'music'}`;
  if(playlistKey === key && playlist.length) return;

  const {managers} = await bootTelegram();
  const limit = 60;

  const result: any = await managers.appMessagesManager.getHistory({
    peerId,
    offsetId: aroundMid,
    addOffset: -Math.floor(limit / 2),
    limit,
    inputFilter: {_: isVoice ? 'inputMessagesFilterRoundVoice' : 'inputMessagesFilterMusic'},
    fetchIfWasNotFetched: true
  });

  const mids: number[] = result?.history ?? [];
  const messages = await Promise.all(
    mids.map((mid) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );

  const tracks: PlayerTrack[] = [];
  for(const message of messages) {
    if(!message) continue;
    const track = await trackOf(peerId, message, await senderTitleOf(message));
    if(track) tracks.push(track);
  }

  // getHistory returns newest-first; a playlist runs oldest-first so "next"
  // moves forward in time.
  playlist = tracks.reverse();
  playlistKey = key;
}

function currentIndex(): number {
  if(!state.track) return -1;
  return playlist.findIndex(
    (track) => track.peerId === state.track!.peerId && track.mid === state.track!.mid
  );
}

function refreshNeighbours() {
  const index = currentIndex();
  if(index < 0) {
    state.hasPrev = false;
    state.hasNext = false;
    return;
  }

  if(state.shuffle || state.repeat === 'all') {
    const many = playlist.length > 1;
    state.hasPrev = many;
    state.hasNext = many;
    return;
  }

  state.hasPrev = index > 0;
  state.hasNext = index < playlist.length - 1;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/** Starts (or restarts) playback of one audio/voice message. */
export async function playAudioMessage(peerId: number, mid: number): Promise<void> {
  if(isPlayerTrack(peerId, mid)) {
    togglePlay();
    return;
  }

  const {managers} = await bootTelegram();
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) return;

  const track = await trackOf(peerId, message, await senderTitleOf(message));
  if(!track) return;

  const token = ++loadToken;
  state.track = track;
  state.error = '';
  state.loading = true;
  state.time = 0;
  state.duration = track.duration;
  state.playing = false;
  playlist = playlistKey === `${peerId}_${track.isVoice ? 'voice' : 'music'}` ? playlist : [];
  refreshNeighbours();
  emit();

  // The sender is owed a receipt the moment an unheard voice message is played,
  // the same as in the bubble.
  if(message.pFlags?.media_unread && !message.pFlags?.out) {
    readMediaContents(peerId, [mid]).catch(() => {});
  }

  const url = await urlOf(peerId, mid);
  if(token !== loadToken) return;

  if(!url) {
    state.loading = false;
    state.error = 'Unavailable';
    emit();
    return;
  }

  silenceOtherMedia();

  const media = element();
  media.src = url;
  media.playbackRate = state.speed;
  media.volume = state.volume;
  media.muted = state.muted;

  try {
    await media.play();
  } catch(err) {
    if(token === loadToken) {
      state.loading = false;
      state.playing = false;
      emit();
    }
  }

  setSessionMetadata(track);

  playlistLoading = loadPlaylist(peerId, track.isVoice, mid)
    .then(() => {
      if(token !== loadToken) return;
      refreshNeighbours();
      emit();
    })
    .catch(() => {});
}

export function togglePlay(): void {
  if(!audio || !state.track) return;
  if(audio.paused) {
    silenceOtherMedia();
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

export function seekPlayer(seconds: number): void {
  if(!audio || !Number.isFinite(seconds)) return;
  audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds));
  state.time = audio.currentTime;
  emit();
}

export function setPlayerSpeed(speed: number): void {
  state.speed = speed;
  if(audio) audio.playbackRate = speed;
  emit();
}

/** Steps through the fixed speed ladder, for a single-button control. */
export function cyclePlayerSpeed(): void {
  const next = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length] ?? 1;
  setPlayerSpeed(next);
}

export function setPlayerVolume(volume: number): void {
  state.volume = Math.max(0, Math.min(1, volume));
  state.muted = state.volume === 0;
  if(audio) {
    audio.volume = state.volume;
    audio.muted = state.muted;
  }
  emit();
}

export function togglePlayerMute(): void {
  state.muted = !state.muted;
  if(audio) audio.muted = state.muted;
  emit();
}

export function cycleRepeat(): void {
  state.repeat = state.repeat === 'none' ? 'all' : state.repeat === 'all' ? 'one' : 'none';
  refreshNeighbours();
  emit();
}

export function toggleShuffle(): void {
  state.shuffle = !state.shuffle;
  refreshNeighbours();
  emit();
}

function pick(direction: 1 | -1): PlayerTrack | null {
  const index = currentIndex();
  if(index < 0 || !playlist.length) return null;

  if(state.shuffle && playlist.length > 1) {
    let next = index;
    while(next === index) next = Math.floor(Math.random() * playlist.length);
    return playlist[next];
  }

  const next = index + direction;
  if(next >= 0 && next < playlist.length) return playlist[next];

  // Wrapping is what "repeat all" means; otherwise the queue simply ends.
  if(state.repeat === 'all') return playlist[next < 0 ? playlist.length - 1 : 0];
  return null;
}

export async function playNext(auto = false): Promise<void> {
  if(playlistLoading) await playlistLoading.catch(() => {});
  const track = pick(1);
  if(track) await playAudioMessage(track.peerId, track.mid);
  else if(auto) {
    state.playing = false;
    emit();
  }
}

export async function playPrev(): Promise<void> {
  if(playlistLoading) await playlistLoading.catch(() => {});

  // Matching every other player: a skip back within the first seconds of a
  // track means "previous", later on it means "start this one again".
  if(audio && audio.currentTime > 3) {
    seekPlayer(0);
    return;
  }

  const track = pick(-1);
  if(track) await playAudioMessage(track.peerId, track.mid);
}

/** Stops playback and hides the bar. */
export function closePlayer(): void {
  loadToken++;
  if(audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  state.track = null;
  state.playing = false;
  state.loading = false;
  state.time = 0;
  state.duration = 0;
  state.error = '';
  state.hasPrev = false;
  state.hasNext = false;
  playlist = [];
  playlistKey = '';
  clearSession();
  emit();
}

/* ------------------------------------------------------------------ */
/* Media Session — OS media keys and the lock screen                   */
/* ------------------------------------------------------------------ */

function session(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ?
    navigator.mediaSession :
    null;
}

let sessionWired = false;

function wireSession() {
  const mediaSession = session();
  if(!mediaSession || sessionWired) return;
  sessionWired = true;

  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch(err) {
      // Not every browser implements every action; an unsupported one throws.
    }
  };

  set('play', () => togglePlay());
  set('pause', () => togglePlay());
  set('stop', () => closePlayer());
  set('previoustrack', () => {playPrev();});
  set('nexttrack', () => {playNext();});
  set('seekbackward', (details) => seekPlayer(state.time - (details?.seekOffset ?? 10)));
  set('seekforward', (details) => seekPlayer(state.time + (details?.seekOffset ?? 10)));
  set('seekto', (details) => {
    if(details?.seekTime !== undefined) seekPlayer(details.seekTime);
  });
}

async function setSessionMetadata(track: PlayerTrack) {
  const mediaSession = session();
  if(!mediaSession) return;

  wireSession();

  const artwork: MediaImage[] = [];
  try {
    const avatar = await loadAvatarUrl(track.peerId);
    if(avatar) artwork.push({src: avatar, sizes: '160x160'});
  } catch(err) {
    // Artwork is decoration; never let it block metadata.
  }

  if(state.track?.mid !== track.mid) return;

  mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.subtitle,
    artwork
  });
}

function setSessionPlaybackState(playbackState: MediaSessionPlaybackState) {
  const mediaSession = session();
  if(mediaSession) mediaSession.playbackState = playbackState;
}

function updatePositionState() {
  const mediaSession = session();
  if(!mediaSession || !mediaSession.setPositionState || !audio) return;
  if(!Number.isFinite(audio.duration) || !audio.duration) return;

  try {
    mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, audio.duration)
    });
  } catch(err) {
    // Safari throws on a position past the duration mid-seek.
  }
}

function clearSession() {
  const mediaSession = session();
  if(!mediaSession) return;
  mediaSession.metadata = null;
  mediaSession.playbackState = 'none';
}
