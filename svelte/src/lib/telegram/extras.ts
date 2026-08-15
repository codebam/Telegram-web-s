import getPeerId from '@appManagers/utils/peers/getPeerId';
import {bootTelegram} from './client';

/**
 * Premium, Stars, Stories and Calls.
 *
 * Same discipline as the other modules: everything returned here is plain and
 * cloneable, raw objects stay behind module-level caches.
 */

/* ------------------------------------------------------------------ */
/* Premium                                                             */
/* ------------------------------------------------------------------ */

export type PremiumInfo = {
  active: boolean;
  features: {title: string; description: string}[];
};

export async function loadPremium(): Promise<PremiumInfo> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();

  let features: PremiumInfo['features'] = [];
  try {
    const promo: any = await managers.appPaymentsManager.getPremiumPromo();
    const descriptions: string[] = promo?.video_sections ?? [];
    const texts: string[] = (promo?.status_text ?? '').split('\n').filter(Boolean);
    features = descriptions.map((section: string, index: number) => ({
      title: humanizeSection(section),
      description: texts[index] ?? ''
    }));
  } catch(err) {
    // The promo is optional; the status below is the part that matters.
  }

  if(!features.length) {
    features = [
      {title: 'Doubled limits', description: 'More channels, folders, pinned chats and saved GIFs.'},
      {title: 'Larger uploads', description: 'Send files up to 4 GB.'},
      {title: 'Faster downloads', description: 'No speed limits on media.'},
      {title: 'Voice-to-text', description: 'Transcribe voice messages.'},
      {title: 'Unique reactions and stickers', description: 'Premium-only packs and effects.'},
      {title: 'No ads', description: 'Sponsored messages are hidden.'}
    ];
  }

  return {active: !!self?.pFlags?.premium, features};
}

function humanizeSection(section: string): string {
  return section
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Stars                                                               */
/* ------------------------------------------------------------------ */

export type StarsInfo = {
  balance: number;
  transactions: {
    id: string;
    amount: number;
    date: number;
    title: string;
    incoming: boolean;
  }[];
};

export async function loadStars(): Promise<StarsInfo> {
  const {managers} = await bootTelegram();

  const status: any = await managers.appPaymentsManager.getStarsStatus();
  const balance = Number(status?.balance?.amount ?? status?.balance ?? 0);

  const transactions = (status?.history ?? []).slice(0, 40).map((entry: any) => {
    const amount = Number(entry?.stars?.amount ?? entry?.stars ?? 0);
    return {
      id: String(entry.id ?? `${entry.date}`),
      amount: Math.abs(amount),
      date: entry.date ?? 0,
      title: entry.title || entry.description || (amount >= 0 ? 'Top-up' : 'Purchase'),
      incoming: amount >= 0
    };
  });

  return {balance, transactions};
}

export async function loadStarsTopupOptions(): Promise<{stars: number; currency: string; amount: number}[]> {
  const {managers} = await bootTelegram();
  try {
    const options: any = await managers.appPaymentsManager.getStarsTopupOptions();
    return (options ?? []).map((option: any) => ({
      stars: Number(option.stars ?? 0),
      currency: option.currency ?? '',
      amount: Number(option.amount ?? 0)
    }));
  } catch(err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

export type StoryPeer = {
  peerId: number;
  title: string;
  unread: boolean;
  storyIds: number[];
};

export type StoryItem = {
  id: number;
  date: number;
  caption: string;
  isVideo: boolean;
  /** Seconds of video; 0 for photos, which get a fixed display time. */
  duration: number;
};

const rawStories = new Map<string, any>();
const storyUrls = new Map<string, string | null>();

const storyKey = (peerId: number, id: number) => `${peerId}_${id}`;

export async function loadStoriesFeed(): Promise<StoryPeer[]> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.appStoriesManager.getAllStories();
    const peerStories: any[] = result?.peer_stories ?? result?.peerStories ?? [];

    return Promise.all(
      peerStories.map(async(entry: any) => {
        // A channel's peerId is the negated channel_id, so the raw `peer`
        // constructor has to go through getPeerId — reading channel_id off it
        // addresses a peer nobody has stories for, and the viewer then opens
        // on an empty list.
        const peerId = Number(getPeerId(entry.peer));
        const peer: any = await managers.appPeersManager.getPeer(peerId);
        const stories: any[] = entry.stories ?? [];

        stories.forEach((story) => rawStories.set(storyKey(peerId, story.id), story));

        return {
          peerId,
          title: peer?._ === 'user' ?
            [peer.first_name, peer.last_name].filter(Boolean).join(' ') || peer.username || 'User' :
            peer?.title ?? 'Channel',
          unread: (entry.max_read_id ?? 0) < (stories[stories.length - 1]?.id ?? 0),
          storyIds: stories.map((story) => story.id)
        };
      })
    );
  } catch(err) {
    return [];
  }
}

export async function loadStories(peerId: number, ids: number[]): Promise<StoryItem[]> {
  const {managers} = await bootTelegram();

  try {
    // Copy to a plain array: callers hold these in Svelte state, and a $state
    // proxy is not structured-cloneable — postMessage drops the request.
    const plainIds = Array.from(ids, Number);
    const stories: any[] = await managers.appStoriesManager.getStoriesById(peerId, plainIds);
    return (stories ?? []).map((story: any) => {
      rawStories.set(storyKey(peerId, story.id), story);
      const document = story.media?.document;
      const video = (document?.attributes ?? []).find((a: any) => a._ === 'documentAttributeVideo');

      return {
        id: story.id,
        date: story.date ?? 0,
        caption: story.caption ?? '',
        isVideo: story.media?._ === 'messageMediaDocument',
        duration: video?.duration ?? 0
      };
    });
  } catch(err) {
    return [];
  }
}

/** Media URL for a story, downloaded like any other message media. */
export async function loadStoryUrl(peerId: number, id: number): Promise<string | null> {
  const key = storyKey(peerId, id);
  if(storyUrls.has(key)) return storyUrls.get(key)!;

  const story = rawStories.get(key);
  const media = story?.media;
  // The feed returns storyItemSkipped entries with no media; the full story
  // arrives later from getStoriesById. Return without caching so the retry
  // after it lands is not answered from a poisoned negative cache.
  if(!media) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  const target = media._ === 'messageMediaPhoto' ? media.photo : media.document;
  if(!target) return null;

  try {
    // Photos need an explicit size: without one the download resolves against
    // photoSizeEmpty and throws. Videos download their poster frame.
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: choosePhotoSize(target, 720, 1280, true)
    });
    storyUrls.set(key, url ?? null);
    return url ?? null;
  } catch(err) {
    storyUrls.set(key, null);
    return null;
  }
}

export async function markStoriesRead(peerId: number, maxId: number): Promise<void> {
  const {managers} = await bootTelegram();
  try {
    await managers.appStoriesManager.readStories(peerId, maxId);
  } catch(err) {
    // Read receipts for stories are best-effort.
  }
}

/* ------------------------------------------------------------------ */
/* Business bots                                                       */
/* ------------------------------------------------------------------ */

/**
 * A bot connected to a Telegram Business account answers chats on the owner's
 * behalf. It is per-chat state: the owner can pause it for one conversation
 * and take over, or disconnect it from that conversation for good.
 */
export type BusinessBot = {
  botId: number;
  title: string;
  username: string | null;
  /** Paused means still connected, but not replying in this chat. */
  paused: boolean;
  /** True when the bot is allowed to answer at all — a read-only bot cannot. */
  canReply: boolean;
  /** Deep link the bot offers for its own settings, when it has one. */
  manageUrl: string | null;
};

export async function getBusinessBot(peerId: number): Promise<BusinessBot | null> {
  const {managers} = await bootTelegram();

  try {
    const settings: any = await managers.appProfileManager.getPeerSettings(peerId);
    const botId = Number(settings?.business_bot_id ?? 0);
    if(!botId) return null;

    const bot: any = await managers.appUsersManager.getUser(botId);
    return {
      botId,
      title: [bot?.first_name, bot?.last_name].filter(Boolean).join(' ') || bot?.username || 'Bot',
      username: bot?.username ?? null,
      paused: !!settings.pFlags?.business_bot_paused,
      canReply: !!settings.pFlags?.business_bot_can_reply,
      manageUrl: settings.business_bot_manage_url ?? null
    };
  } catch(err) {
    return null;
  }
}

export async function setBusinessBotPaused(peerId: number, paused: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appProfileManager.toggleConnectedBotPaused(peerId, paused);
}

export async function removeBusinessBot(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appProfileManager.disablePeerConnectedBot(peerId);
}

/** Fires whenever a chat's peer settings change, the bot's state among them. */
export async function onPeerSettings(
  callback: (peerId: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = ({peerId}: {peerId: number}) => callback(Number(peerId));
  rootScope.addEventListener('peer_settings', handler);
  return () => rootScope.removeEventListener('peer_settings', handler);
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

/**
 * Call state, flattened for the UI.
 *
 * `phase` collapses tweb's CALL_STATE enum into the four things a call screen
 * actually renders differently: ringing in, ringing out, negotiating, talking.
 */
export type CallPhase = 'incoming' | 'outgoing' | 'connecting' | 'connected' | 'ended';

export type CallState = {
  phase: CallPhase;
  peerId: number;
  title: string;
  muted: boolean;
  sharingVideo: boolean;
  sharingScreen: boolean;
  /** Seconds since the call connected. */
  duration: number;
  /** Four emoji both sides can compare to verify the call is not intercepted. */
  fingerprint: string[];
  /** Why the call ended, once it has: 'busy', 'declined', 'missed', 'ended'. */
  endReason: string;
};

/**
 * One controller for the whole tab.
 *
 * Kept on globalThis rather than in a module variable: the controller holds the
 * live call instances, and if this module is ever evaluated twice — separate
 * chunks, a stale HMR copy — each copy gets its own controller, and the call
 * screen ends up subscribed to a controller that never sees the call that the
 * button created.
 */
const CONTROLLER_KEY = '__websCallsController';

async function getCallsController() {
  const store = globalThis as any;
  return (store[CONTROLLER_KEY] ??= (async() => {
    const {managers} = await bootTelegram();
    const {default: callsController} = await import('@lib/calls/callsController');
    // The controller needs the manager proxy before it can place a call —
    // tweb does this inside appDialogsManager.start(), which we do not run.
    callsController.construct(managers as any);
    return callsController;
  })());
}

/** Human-readable reason a call ended, so the UI can say more than nothing. */
function endReasonOf(call: any): string {
  switch(call?.discardReason?._) {
    case 'phoneCallDiscardReasonBusy': return 'busy';
    case 'phoneCallDiscardReasonHangup': return 'ended';
    case 'phoneCallDiscardReasonDisconnect': return 'disconnected';
    case 'phoneCallDiscardReasonMissed': return 'missed';
    default: return '';
  }
}

async function phaseOf(call: any): Promise<CallPhase> {
  const {default: CALL_STATE} = await import('@lib/calls/callState');

  switch(call.connectionState) {
    case CALL_STATE.CONNECTED: return 'connected';
    case CALL_STATE.CONNECTING:
    case CALL_STATE.EXCHANGING_KEYS: return 'connecting';
    case CALL_STATE.CLOSING:
    case CALL_STATE.CLOSED: return 'ended';
    default: return call.isOutgoing ? 'outgoing' : 'incoming';
  }
}

export type CallStartResult =
  | {ok: true}
  | {ok: false; reason: 'mic-blocked' | 'no-mic' | 'failed'; detail?: string};

/**
 * Ask for the microphone before placing the call.
 *
 * The P2P engine acquires its own stream, but it does so deep inside the call
 * setup where a rejection surfaces as a silent failure — the UI would open and
 * the call would never ring. Probing first turns "nothing happens" into a
 * message that says which permission is missing.
 */
async function checkMicrophone(isVideo: boolean): Promise<CallStartResult> {
  if(!navigator.mediaDevices?.getUserMedia) {
    return {ok: false, reason: 'no-mic', detail: 'This browser cannot access the microphone.'};
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: isVideo});
    // Release it immediately; the engine opens its own.
    stream.getTracks().forEach((track) => track.stop());
    return {ok: true};
  } catch(err: any) {
    const name = err?.name ?? '';
    if(name === 'NotAllowedError' || name === 'SecurityError') {
      return {ok: false, reason: 'mic-blocked'};
    }
    if(name === 'NotFoundError' || name === 'OverconstrainedError') {
      return {ok: false, reason: 'no-mic'};
    }
    return {ok: false, reason: 'failed', detail: err?.message};
  }
}

export async function startCall(userId: number, isVideo = false): Promise<CallStartResult> {
  const permission = await checkMicrophone(isVideo);
  if(!permission.ok) return permission;

  const controller = await getCallsController();
  try {
    await controller.startCallInternal(userId, isVideo);
    return {ok: true};
  } catch(err: any) {
    return {ok: false, reason: 'failed', detail: err?.message ?? String(err)};
  }
}

export async function hangUp(): Promise<void> {
  const controller = await getCallsController();
  controller.currentCall?.hangUp();
}

export async function acceptCall(): Promise<void> {
  const controller = await getCallsController();
  await controller.currentCall?.acceptCall();
}

export async function toggleCallMute(): Promise<void> {
  const controller = await getCallsController();
  await controller.currentCall?.toggleMuted();
}

export async function toggleCallVideo(): Promise<void> {
  const controller = await getCallsController();
  await controller.currentCall?.toggleVideoSharing();
}

export async function toggleCallScreen(): Promise<void> {
  const controller = await getCallsController();
  await controller.currentCall?.toggleScreenSharing();
}

/**
 * The <video> element the engine renders into. Returned rather than a stream so
 * the caller can mount whatever the P2P layer already set up.
 */
export async function getCallVideo(type: 'input' | 'output'): Promise<HTMLVideoElement | undefined> {
  const controller = await getCallsController();
  return controller.currentCall?.getVideoElement(type)?.video;
}

/**
 * Subscribe to call state. Emits on every lifecycle change and once a second
 * while connected so the duration ticks. Returns an unsubscribe callback.
 */
export async function onCallState(callback: (state: CallState | null) => void): Promise<() => void> {
  const controller = await getCallsController();
  const {managers} = await bootTelegram();

  let attached: any = null;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const emit = async() => {
    const call = controller.currentCall;
    if(!call) {
      callback(null);
      return;
    }

    const peerId = Number(call.interlocutorUserId ?? 0);
    const user: any = await managers.appUsersManager.getUser(call.interlocutorUserId).catch(() => null);

    let fingerprint: string[] = [];
    try {
      // Only meaningful once keys are exchanged.
      fingerprint = (await call.getEmojisFingerprint()) ?? [];
    } catch(err) {
      fingerprint = [];
    }

    callback({
      phase: await phaseOf(call),
      peerId,
      title: user ?
        [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Unknown' :
        'Unknown',
      muted: !!call.isMuted,
      sharingVideo: !!call.isSharingVideo,
      sharingScreen: !!call.isSharingScreen,
      duration: call.duration ?? 0,
      fingerprint,
      endReason: endReasonOf(call)
    });
  };

  /** Re-bind per-call listeners whenever the controller swaps instances. */
  const attach = () => {
    const call = controller.currentCall;
    if(attached === call) return;

    if(attached) {
      attached.removeEventListener('state', emit);
      attached.removeEventListener('muted', emit);
      attached.removeEventListener('mediaState', emit);
    }

    attached = call;

    if(call) {
      call.addEventListener('state', emit);
      call.addEventListener('muted', emit);
      call.addEventListener('mediaState', emit);
    }
  };

  const onInstance = () => {
    attach();
    emit();
  };

  controller.addEventListener('instance', onInstance);
  ticker = setInterval(emit, 1000);
  attach();
  emit();

  return () => {
    controller.removeEventListener('instance', onInstance);
    clearInterval(ticker);
    if(attached) {
      attached.removeEventListener('state', emit);
      attached.removeEventListener('muted', emit);
      attached.removeEventListener('mediaState', emit);
    }
  };
}
