import {bootTelegram} from './client';

/**
 * Mini apps, business info and Calls. Stories live in `./stories`; Premium,
 * Stars and everything else that costs money live in `./payments`.
 *
 * Same discipline as the other modules: everything returned here is plain and
 * cloneable, raw objects stay behind module-level caches.
 */

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
