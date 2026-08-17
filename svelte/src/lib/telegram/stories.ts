import getPeerId from '@appManagers/utils/peers/getPeerId';
import {bootTelegram} from './client';
import {fromApiReaction, toApiReaction, type ReactionRef} from './reactions';

/**
 * Stories: the tray feed, the viewer, and everything that acts on a story —
 * posting, replying, reacting, sharing, and managing your own.
 *
 * Same discipline as the other modules here: everything crossing back into the
 * UI is plain and cloneable, raw MTProto objects stay behind module caches.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type StoryPeer = {
  peerId: number;
  title: string;
  unread: boolean;
  storyIds: number[];
};

/** Who a story is posted to. Mirrors tweb's `getStoryPrivacyType`. */
export type StoryAudience = 'everyone' | 'contacts' | 'close' | 'selected';

export type StoryItem = {
  id: number;
  peerId: number;
  date: number;
  /** Unix seconds at which the story drops out of the feed. */
  expireDate: number;
  caption: string;
  isVideo: boolean;
  /** Seconds of video; 0 for photos, which get a fixed display time. */
  duration: number;
  /** Kept on the author's profile after it expires. */
  pinned: boolean;
  /** Posted by the signed-in account — unlocks views, pin and delete. */
  mine: boolean;
  audience: StoryAudience;
  viewsCount: number;
  reactionsCount: number;
  forwardsCount: number;
  /** The reaction this account already left, if any. */
  sentReaction: ReactionRef | null;
};

/** One row of a story's viewer list. */
export type StoryViewer = {
  peerId: number;
  title: string;
  date: number;
  reaction: ReactionRef | null;
};

export type StoryViewersPage = {
  viewers: StoryViewer[];
  /** Opaque cursor for the next page; '' once the list is exhausted. */
  nextOffset: string;
  count: number;
};

/** A contact as the audience and close-friends pickers show it. */
export type StoryContact = {
  peerId: number;
  title: string;
  closeFriend: boolean;
};

/** How long a new story stays up, in seconds. */
export const STORY_PERIODS: Array<{value: number; label: string}> = [
  {value: 6 * 3600, label: '6 hours'},
  {value: 12 * 3600, label: '12 hours'},
  {value: 24 * 3600, label: '24 hours'},
  {value: 48 * 3600, label: '48 hours'}
];

export const DEFAULT_STORY_PERIOD = 24 * 3600;

/* ------------------------------------------------------------------ */
/* Caches and shared helpers                                           */
/* ------------------------------------------------------------------ */

const rawStories = new Map<string, any>();
const storyUrls = new Map<string, string | null>();

const storyKey = (peerId: number, id: number) => `${peerId}_${id}`;

let selfIdCache: number | null = null;

export async function selfPeerId(): Promise<number> {
  if(selfIdCache !== null) return selfIdCache;
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  return (selfIdCache = Number(self?.id ?? 0));
}

function peerTitle(peer: any): string {
  if(!peer) return '';
  if(peer._ === 'user') {
    return [peer.first_name, peer.last_name].filter(Boolean).join(' ') || peer.username || 'User';
  }
  return peer.title ?? 'Channel';
}

/** Mirrors `@appManagers/utils/stories/privacyType`, in this module's wording. */
function audienceOf(story: any): StoryAudience {
  const flags = story?.pFlags ?? {};
  if(flags.close_friends) return 'close';
  if(flags.public) return 'everyone';
  if(flags.selected_contacts) return 'selected';
  if(flags.contacts) return 'contacts';

  const rules: any[] = story?.privacy ?? [];
  if(rules.some((rule) => rule._ === 'privacyValueAllowAll')) return 'everyone';
  if(rules.some((rule) => rule._ === 'privacyValueAllowCloseFriends')) return 'close';
  if(rules.some((rule) => rule._ === 'privacyValueAllowContacts')) return 'contacts';
  if(rules.length) return 'selected';
  return 'everyone';
}

function toStoryItem(peerId: number, story: any, selfId: number): StoryItem {
  rawStories.set(storyKey(peerId, story.id), story);

  const document = story.media?.document;
  const video = (document?.attributes ?? []).find((a: any) => a._ === 'documentAttributeVideo');
  const views = story.views ?? {};

  return {
    id: story.id,
    peerId,
    date: story.date ?? 0,
    expireDate: story.expire_date ?? 0,
    caption: story.caption ?? '',
    isVideo: story.media?._ === 'messageMediaDocument',
    duration: video?.duration ?? 0,
    pinned: !!story.pFlags?.pinned,
    mine: peerId === selfId,
    audience: audienceOf(story),
    viewsCount: views.views_count ?? 0,
    reactionsCount: views.reactions_count ?? 0,
    forwardsCount: views.forwards_count ?? 0,
    sentReaction: fromApiReaction(story.sent_reaction)
  };
}

/* ------------------------------------------------------------------ */
/* Feed and viewer                                                     */
/* ------------------------------------------------------------------ */

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
          title: peerTitle(peer),
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
    const selfId = await selfPeerId();
    // Copy to a plain array: callers hold these in Svelte state, and a $state
    // proxy is not structured-cloneable — postMessage drops the request.
    const plainIds = Array.from(ids, Number);
    const stories: any[] = await managers.appStoriesManager.getStoriesById(peerId, plainIds);
    return (stories ?? []).map((story: any) => toStoryItem(peerId, story, selfId));
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
    // photoSizeEmpty and throws. A video story plays in a <video>, so it wants
    // the real file — handing it the poster frame puts a JPEG in a video
    // element, which renders blank.
    const isPhoto = media._ === 'messageMediaPhoto';
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: isPhoto ? choosePhotoSize(target, 720, 1280, true) : undefined
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

/**
 * Counts a view on someone else's story. Separate from `markStoriesRead`: the
 * read marker moves the tray ring, this is what shows up in their views list.
 */
export async function countStoryView(peerId: number, id: number): Promise<void> {
  const {managers} = await bootTelegram();
  try {
    await managers.appStoriesManager.incrementStoryViews(peerId, [Number(id)]);
  } catch(err) {
    // Best-effort, exactly like the read receipt above.
  }
}

/* ------------------------------------------------------------------ */
/* Posting                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reads a file's intrinsic size, which `stories.sendStory` needs for a video:
 * the server takes the dimensions from `documentAttributeVideo` and a wrong
 * pair makes the story render letterboxed on every client.
 */
async function measure(file: File): Promise<{width: number; height: number; duration: number}> {
  const url = URL.createObjectURL(file);

  try {
    if(file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Cannot read video'));
      });

      return {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: Math.round(video.duration) || 0
      };
    }

    const image = new Image();
    image.src = url;
    await image.decode();
    return {width: image.naturalWidth, height: image.naturalHeight, duration: 0};
  } catch(err) {
    return {width: 0, height: 0, duration: 0};
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Turns the picked audience into the `inputPrivacyRule`s sendStory wants. */
async function audienceRules(audience: StoryAudience, allowUserIds: number[]): Promise<any[]> {
  if(audience === 'everyone') return [{_: 'inputPrivacyValueAllowAll'}];
  if(audience === 'contacts') return [{_: 'inputPrivacyValueAllowContacts'}];
  if(audience === 'close') return [{_: 'inputPrivacyValueAllowCloseFriends'}];

  const {managers} = await bootTelegram();
  const ids = Array.from(allowUserIds, Number).filter((id) => id > 0);
  if(!ids.length) return [{_: 'inputPrivacyValueAllowContacts'}];

  return [{
    _: 'inputPrivacyValueAllowUsers',
    users: await Promise.all(ids.map((userId) => managers.appUsersManager.getUserInput(userId)))
  }];
}

export type PostStoryOptions = {
  file: File;
  caption?: string;
  audience: StoryAudience;
  /** Only read for the 'selected' audience. */
  allowUserIds?: number[];
  period?: number;
  /** Keep it on the profile after it expires. */
  pinned?: boolean;
  /** Post as a channel rather than as yourself. */
  peerId?: number;
};

export async function postStory(options: PostStoryOptions): Promise<void> {
  const {managers} = await bootTelegram();
  const peerId = options.peerId ?? (await selfPeerId());
  const isVideo = options.file.type.startsWith('video/');
  const size = await measure(options.file);

  await managers.appStoriesManager.sendStory({
    peerId,
    file: options.file,
    isVideo,
    duration: size.duration,
    width: size.width,
    height: size.height,
    caption: (options.caption ?? '').trim() || undefined,
    privacyRules: await audienceRules(options.audience, options.allowUserIds ?? []),
    period: options.period || DEFAULT_STORY_PERIOD,
    pinned: !!options.pinned
  } as any);
}

/* ------------------------------------------------------------------ */
/* Acting on a story                                                   */
/* ------------------------------------------------------------------ */

/**
 * Sends a message that hangs off a story. `inputReplyToStory` is built from
 * the destination peer, so the reply has to go to the story's author — which
 * is where the official clients put it too.
 */
export async function replyToStory(peerId: number, storyId: number, text: string): Promise<void> {
  const trimmed = text.trim();
  if(!trimmed) return;

  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendText({
    peerId,
    text: trimmed,
    replyToStoryId: Number(storyId)
  } as any);
}

/** Leaves (or, with `null`, clears) a reaction on a story. */
export async function reactToStory(
  peerId: number,
  storyId: number,
  ref: ReactionRef | null
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStoriesManager.sendReaction(
    peerId,
    Number(storyId),
    ref ? toApiReaction(ref) : {_: 'reactionEmpty'}
  );

  const story = rawStories.get(storyKey(peerId, storyId));
  if(story) story.sent_reaction = ref ? toApiReaction(ref) : undefined;
}

/**
 * Shares a story into chats as a story message rather than as a link, which is
 * what `inputMediaStory` is for — the recipient gets a tappable card.
 */
export async function shareStoryTo(
  peerId: number,
  storyId: number,
  targetPeerIds: number[]
): Promise<void> {
  if(!targetPeerIds.length) return;

  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getInputPeerById(peerId);

  for(const target of Array.from(targetPeerIds, Number)) {
    await managers.appMessagesManager.sendOther({
      peerId: target,
      inputMedia: {_: 'inputMediaStory', id: Number(storyId), peer}
    } as any);
  }
}

/** Public t.me link, '' when the story is not publicly addressable. */
export async function storyLink(peerId: number, storyId: number): Promise<string> {
  const {managers} = await bootTelegram();
  try {
    return (await managers.appStoriesManager.exportStoryLink(peerId, Number(storyId))) ?? '';
  } catch(err) {
    return '';
  }
}

/* ------------------------------------------------------------------ */
/* My stories                                                          */
/* ------------------------------------------------------------------ */

/** Your own stories that are still live, for the "add / my story" tray entry. */
export async function loadMyActiveStories(): Promise<StoryItem[]> {
  const {managers} = await bootTelegram();

  try {
    const selfId = await selfPeerId();
    const peerStories: any = await managers.appStoriesManager.getPeerStories(selfId);
    return (peerStories?.stories ?? [])
    .filter((story: any) => story._ === 'storyItem')
    .map((story: any) => toStoryItem(selfId, story, selfId));
  } catch(err) {
    return [];
  }
}

export type MyStoriesKind = 'profile' | 'archive';

export type MyStoriesPage = {
  stories: StoryItem[];
  count: number;
};

/**
 * A page of your own stories: the ones pinned to your profile, or the archive
 * of everything that has expired.
 */
export async function loadMyStories(
  kind: MyStoriesKind,
  offsetId = 0,
  limit = 30
): Promise<MyStoriesPage> {
  const {managers} = await bootTelegram();

  try {
    const selfId = await selfPeerId();
    const result: any = kind === 'profile' ?
      await managers.appStoriesManager.getPinnedStories(selfId, limit, offsetId) :
      await managers.appStoriesManager.getStoriesArchive(selfId, limit, offsetId);

    return {
      count: result?.count ?? 0,
      stories: (result?.stories ?? []).map((story: any) => toStoryItem(selfId, story, selfId))
    };
  } catch(err) {
    return {count: 0, stories: []};
  }
}

/** Pins a story to (or unpins it from) the author's profile. */
export async function setStoryPinned(
  peerId: number,
  storyId: number,
  pinned: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStoriesManager.togglePinned(peerId, Number(storyId), pinned);

  const story = rawStories.get(storyKey(peerId, storyId));
  if(story) story.pFlags = {...story.pFlags, pinned: pinned || undefined};
}

export async function deleteStory(peerId: number, storyId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStoriesManager.deleteStories(peerId, [Number(storyId)]);
  rawStories.delete(storyKey(peerId, storyId));
  storyUrls.delete(storyKey(peerId, storyId));
}

/**
 * Changes who can see an already-posted story. `stories.editStory` leaves
 * every field it is not given alone, so only the rules travel.
 */
export async function setStoryAudience(
  peerId: number,
  storyId: number,
  audience: StoryAudience,
  allowUserIds: number[] = []
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStoriesManager.editStory({
    peerId,
    id: Number(storyId),
    privacyRules: await audienceRules(audience, allowUserIds)
  } as any);
}

/** Who watched a story, newest first, with the reaction each of them left. */
export async function loadStoryViewers(
  peerId: number,
  storyId: number,
  offset = '',
  limit = 40
): Promise<StoryViewersPage> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.appStoriesManager.getStoryViewsList(
      peerId,
      Number(storyId),
      limit,
      offset
    );

    const viewers = await Promise.all(
      (result?.views ?? []).map(async(view: any) => {
        const viewerId = Number(view.user_id);
        const peer: any = await managers.appPeersManager.getPeer(viewerId);
        return {
          peerId: viewerId,
          title: peerTitle(peer) || 'User',
          date: view.date ?? 0,
          reaction: fromApiReaction(view.reaction)
        };
      })
    );

    return {viewers, nextOffset: result?.nextOffset ?? '', count: result?.count ?? viewers.length};
  } catch(err) {
    return {viewers: [], nextOffset: '', count: 0};
  }
}

/* ------------------------------------------------------------------ */
/* Stealth mode and close friends                                      */
/* ------------------------------------------------------------------ */

export type StealthMode = {
  /** Unix seconds until which viewing leaves no trace; 0 when off. */
  activeUntil: number;
  /** Unix seconds until which it cannot be switched on again. */
  cooldownUntil: number;
};

export async function loadStealthMode(): Promise<StealthMode> {
  const {managers} = await bootTelegram();

  try {
    const mode: any = await managers.appStoriesManager.getStealthMode();
    return {
      activeUntil: mode?.active_until_date ?? 0,
      cooldownUntil: mode?.cooldown_until_date ?? 0
    };
  } catch(err) {
    return {activeUntil: 0, cooldownUntil: 0};
  }
}

export async function activateStealthMode(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStoriesManager.activateStealthMode();
}

/** Contacts, flagged with whether each is currently a close friend. */
export async function loadContacts(): Promise<StoryContact[]> {
  const {managers} = await bootTelegram();

  try {
    const peerIds: any[] = await managers.appUsersManager.getContactsPeerIds();
    const contacts = await Promise.all(
      (peerIds ?? []).map(async(id) => {
        const peerId = Number(id);
        const peer: any = await managers.appPeersManager.getPeer(peerId);
        return {
          peerId,
          title: peerTitle(peer) || 'User',
          closeFriend: !!peer?.pFlags?.close_friend
        };
      })
    );

    return contacts.filter((contact) => contact.peerId > 0);
  } catch(err) {
    return [];
  }
}

/**
 * Replaces the close-friends list. `contacts.editCloseFriends` has no
 * add/remove form, so the caller always sends the whole list.
 */
export async function saveCloseFriends(userIds: number[]): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.editCloseFriends(Array.from(userIds, Number) as any);
}
