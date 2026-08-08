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
        const peerId = Number(entry.peerId ?? entry.peer?.user_id ?? entry.peer?.channel_id ?? 0);
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
    const stories: any[] = await managers.appStoriesManager.getStoriesById(peerId, ids);
    return (stories ?? []).map((story: any) => {
      rawStories.set(storyKey(peerId, story.id), story);
      return {
        id: story.id,
        date: story.date ?? 0,
        caption: story.caption ?? '',
        isVideo: story.media?._ === 'messageMediaDocument'
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
  if(!media) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  const target = media._ === 'messageMediaPhoto' ? media.photo : media.document;
  if(!target) return null;

  try {
    const isVideo = (target.attributes ?? []).some((a: any) => a._ === 'documentAttributeVideo');
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: isVideo ? choosePhotoSize(target, 720, 1280, true) : undefined
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
/* Calls                                                               */
/* ------------------------------------------------------------------ */

export type CallState = {
  active: boolean;
  status: string;
  peerId: number;
  isVideo: boolean;
  muted: boolean;
};

let callsControllerPromise: Promise<any> | null = null;

async function getCallsController() {
  return (callsControllerPromise ??= (async() => {
    const {managers} = await bootTelegram();
    const {default: callsController} = await import('@lib/calls/callsController');
    // The controller needs the manager proxy before it can place a call —
    // tweb does this inside appDialogsManager.start(), which we do not run.
    callsController.construct(managers as any);
    return callsController;
  })());
}

export async function startCall(userId: number, isVideo = false): Promise<boolean> {
  const controller = await getCallsController();
  try {
    await controller.startCallInternal(userId, isVideo);
    return true;
  } catch(err) {
    return false;
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

export async function toggleCallMute(): Promise<boolean> {
  const controller = await getCallsController();
  const call = controller.currentCall;
  if(!call) return false;
  call.toggleMuted?.();
  return !!call.muted;
}

/** Subscribe to call lifecycle changes; returns an unsubscribe callback. */
export async function onCallState(callback: (state: CallState | null) => void): Promise<() => void> {
  const controller = await getCallsController();
  const {default: rootScope} = await import('@lib/rootScope');

  const emit = () => {
    const call = controller.currentCall;
    if(!call) {
      callback(null);
      return;
    }

    callback({
      active: true,
      status: call.connectionState ?? (call.isOutgoing ? 'calling' : 'incoming'),
      peerId: Number(call.interlocutorUserId ?? 0),
      isVideo: !!call.isVideo,
      muted: !!call.muted
    });
  };

  const handler = () => emit();
  controller.addEventListener('instance', handler);
  rootScope.addEventListener('call_incompatible', handler);
  emit();

  return () => {
    controller.removeEventListener('instance', handler);
    rootScope.removeEventListener('call_incompatible', handler);
  };
}
