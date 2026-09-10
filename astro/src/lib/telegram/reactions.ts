import {bootTelegram} from './client';

/**
 * Reactions: the available set for a chat, the picker's data, reaction
 * effects, the quick (default) reaction, paid star reactions and the per-chat
 * admin settings.
 *
 * Same discipline as the other modules here: everything crossing back into a
 * component is plain and structured-cloneable, and the raw MTProto objects
 * (documents, messages) stay behind module-level caches.
 */

/* ------------------------------------------------------------------ */
/* Reaction identity                                                   */
/* ------------------------------------------------------------------ */

export type ReactionKind = 'emoji' | 'custom' | 'paid';

/**
 * A reaction as the UI passes it around. `key` is stable and safe to use as an
 * `{#each}` key: `e:👍`, `c:5062785872017245386`, `paid`.
 */
export type ReactionRef = {
  kind: ReactionKind;
  /** Unicode emoticon for 'emoji', the custom emoji's alt for 'custom', '⭐️' for paid. */
  emoticon: string;
  /** Custom emoji document id, '' for the other kinds. */
  docId: string;
  key: string;
};

export function emojiReaction(emoticon: string): ReactionRef {
  return {kind: 'emoji', emoticon, docId: '', key: `e:${emoticon}`};
}

export function customReaction(docId: string, emoticon = ''): ReactionRef {
  return {kind: 'custom', emoticon, docId: '' + docId, key: `c:${docId}`};
}

export function paidReaction(): ReactionRef {
  return {kind: 'paid', emoticon: '⭐️', docId: '', key: 'paid'};
}

/** Inverse of the `key` above, for state that only carries the key. */
export function parseReactionKey(key: string): ReactionRef | null {
  if(key === 'paid') return paidReaction();
  if(key.startsWith('e:')) return emojiReaction(key.slice(2));
  if(key.startsWith('c:')) return customReaction(key.slice(2));
  return null;
}

/** MTProto `Reaction` from a ref — what every manager call wants. */
export function toApiReaction(ref: ReactionRef): any {
  if(ref.kind === 'paid') return {_: 'reactionPaid'};
  if(ref.kind === 'custom') return {_: 'reactionCustomEmoji', document_id: ref.docId};
  return {_: 'reactionEmoji', emoticon: ref.emoticon};
}

/** Ref from an MTProto `Reaction`, `null` for `reactionEmpty` and unknowns. */
export function fromApiReaction(reaction: any): ReactionRef | null {
  if(!reaction) return null;
  if(reaction._ === 'reactionPaid') return paidReaction();
  if(reaction._ === 'reactionCustomEmoji') return customReaction('' + reaction.document_id);
  if(reaction._ === 'reactionEmoji') return emojiReaction(reaction.emoticon);
  // An availableReaction can stand in for a reaction in the manager's API.
  if(reaction._ === 'availableReaction') return emojiReaction(reaction.reaction);
  return null;
}

/* ------------------------------------------------------------------ */
/* Documents (icons, animations, custom emoji)                         */
/* ------------------------------------------------------------------ */

export type ReactionDocKind = 'static' | 'video' | 'animated';

const reactionDocs = new Map<string, any>();
const reactionDocUrls = new Map<string, string | null>();

function docKind(doc: any): ReactionDocKind {
  // appDocsManager tags sticker docs with StickerType: 1 static WebP, 2 Lottie
  // (.tgs), 3 WebM. WebM is checked first — `animated` is set for video
  // stickers too and would otherwise be fed to the Lottie decoder.
  if(doc?.sticker === 3 || doc?.mime_type === 'video/webm') return 'video';
  if(doc?.sticker === 2 || doc?.mime_type === 'application/x-tgsticker') return 'animated';
  return 'static';
}

function rememberDoc(doc: any): string {
  if(!doc?.id) return '';
  const docId = '' + doc.id;
  reactionDocs.set(docId, doc);
  return docId;
}

export function reactionDocKind(docId: string): ReactionDocKind {
  return docKind(reactionDocs.get(docId));
}

/**
 * Renderable URL for one of the reaction documents. Lottie documents have no
 * still frame of their own, so they resolve to the server thumbnail —
 * `reactionDocBlob` is what actually plays them.
 */
export async function reactionDocUrl(docId: string): Promise<string | null> {
  if(!docId) return null;
  if(reactionDocUrls.has(docId)) return reactionDocUrls.get(docId)!;

  const doc = reactionDocs.get(docId);
  if(!doc) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  try {
    const useThumb = docKind(doc) === 'animated';
    const url = await appDownloadManager.downloadMediaURL({
      media: doc,
      thumb: useThumb ? choosePhotoSize(doc, 160, 160, true) : undefined
    });
    reactionDocUrls.set(docId, url ?? null);
    return url ?? null;
  } catch(err) {
    reactionDocUrls.set(docId, null);
    return null;
  }
}

/** Raw .tgs blob, handed to tweb's lottieLoader as-is. */
export async function reactionDocBlob(docId: string): Promise<Blob | null> {
  const doc = reactionDocs.get(docId);
  if(!doc) return null;

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    return await appDownloadManager.downloadMedia({media: doc});
  } catch(err) {
    return null;
  }
}

/**
 * Resolve custom emoji documents so `<ReactionSticker/>` can render them.
 * Returns the ids that actually resolved, in the requested order.
 */
export async function loadCustomEmojiDocs(docIds: string[]): Promise<string[]> {
  const missing = docIds.filter((docId) => docId && !reactionDocs.has(docId));
  if(missing.length) {
    const {managers} = await bootTelegram();
    try {
      const docs: any[] = await managers.appEmojiManager.getCustomEmojiDocuments(missing);
      (docs ?? []).forEach((doc) => rememberDoc(doc));
    } catch(err) {
      // A single unresolvable id must not take the whole picker down.
    }
  }

  return docIds.filter((docId) => reactionDocs.has(docId));
}

/* ------------------------------------------------------------------ */
/* Available reactions                                                 */
/* ------------------------------------------------------------------ */

/** One entry of the picker: a reaction plus the documents that draw it. */
export type ReactionOption = ReactionRef & {
  title: string;
  /** Still icon shown in the picker and on a chip. */
  iconDocId: string;
  /** Played once when the reaction is picked. */
  selectDocId: string;
  /** The burst played over the message. */
  aroundDocId: string;
  premium: boolean;
};

const availableByEmoticon = new Map<string, any>();

function optionFromAvailable(available: any): ReactionOption {
  return {
    ...emojiReaction(available.reaction),
    title: available.title ?? available.reaction,
    iconDocId: rememberDoc(available.center_icon) || rememberDoc(available.static_icon),
    selectDocId: rememberDoc(available.select_animation),
    aroundDocId: rememberDoc(available.around_animation),
    premium: !!available.pFlags?.premium
  };
}

async function loadAvailable(): Promise<any[]> {
  const {managers} = await bootTelegram();
  const list: any[] = await managers.appReactionsManager.getAvailableReactions();
  (list ?? []).forEach((available) => availableByEmoticon.set(available.reaction, available));
  return list ?? [];
}

/** Every non-inactive reaction Telegram ships, in server order. */
export async function activeReactions(): Promise<ReactionOption[]> {
  const list = await loadAvailable();
  return list.filter((available) => !available.pFlags?.inactive).map(optionFromAvailable);
}

async function toOption(ref: ReactionRef): Promise<ReactionOption> {
  if(ref.kind === 'emoji') {
    if(!availableByEmoticon.size) await loadAvailable();
    const available = availableByEmoticon.get(ref.emoticon);
    if(available) return optionFromAvailable(available);
    return {...ref, title: ref.emoticon, iconDocId: '', selectDocId: '', aroundDocId: '', premium: false};
  }

  if(ref.kind === 'custom') {
    await loadCustomEmojiDocs([ref.docId]);
    return {...ref, title: '', iconDocId: ref.docId, selectDocId: ref.docId, aroundDocId: '', premium: false};
  }

  return {...ref, title: 'Star reaction', iconDocId: '', selectDocId: '', aroundDocId: '', premium: false};
}

export async function reactionOptions(refs: ReactionRef[]): Promise<ReactionOption[]> {
  const custom = refs.filter((ref) => ref.kind === 'custom').map((ref) => ref.docId);
  if(custom.length) await loadCustomEmojiDocs(custom);
  return Promise.all(refs.map(toOption));
}

export type PeerReactions = {
  /** 'chatReactionsNone' means the chat does not take reactions at all. */
  mode: 'chatReactionsNone' | 'chatReactionsAll' | 'chatReactionsSome';
  options: ReactionOption[];
  /** Custom emoji are allowed only when the chat is on "all". */
  allowsCustom: boolean;
  paidAvailable: boolean;
  /** The message already carries the maximum number of distinct reactions. */
  atUniqCap: boolean;
};

/**
 * What this message may be reacted with. `getAvailableReactionsByMessage`
 * already folds in the chat's setting, the top reactions, the paid reaction
 * and the `reactions_uniq_max` cap, so the manager stays the source of truth.
 */
export async function reactionsForMessage(peerId: number, mid: number): Promise<PeerReactions> {
  const {managers} = await bootTelegram();
  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);

  const peerAvailable: any = await managers.appReactionsManager.getAvailableReactionsByMessage(
    message as any,
    true
  );

  const refs = ((peerAvailable?.reactions ?? []) as any[])
    .map(fromApiReaction)
    .filter(Boolean) as ReactionRef[];

  const paidAvailable = refs.some((ref) => ref.kind === 'paid');
  const options = await reactionOptions(refs.filter((ref) => ref.kind !== 'paid'));

  return {
    mode: peerAvailable?.type ?? 'chatReactionsNone',
    options,
    allowsCustom: peerAvailable?.type === 'chatReactionsAll' && !peerAvailable?.atUniqCap,
    paidAvailable,
    atUniqCap: !!peerAvailable?.atUniqCap
  };
}

/** Recently used reactions, newest first. */
export async function recentReactions(limit = 16): Promise<ReactionOption[]> {
  const {managers} = await bootTelegram();
  try {
    const refs = ((await managers.appReactionsManager.getRecentReactions()) as any[] ?? [])
      .map(fromApiReaction)
      .filter(Boolean) as ReactionRef[];
    return reactionOptions(refs.slice(0, limit));
  } catch(err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Message reactions                                                   */
/* ------------------------------------------------------------------ */

export type MessageReaction = ReactionOption & {
  count: number;
  chosen: boolean;
};

export async function messageReactions(peerId: number, mid: number): Promise<MessageReaction[]> {
  const {managers} = await bootTelegram();
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  const results: any[] = message?.reactions?.results ?? [];

  const refs = results.map((result) => fromApiReaction(result.reaction));
  const options = await reactionOptions(refs.filter(Boolean) as ReactionRef[]);

  const byKey = new Map(options.map((option) => [option.key, option]));
  return results.reduce<MessageReaction[]>((acc, result, index) => {
    const ref = refs[index];
    const option = ref && byKey.get(ref.key);
    if(option) {
      acc.push({
        ...option,
        count: result.count ?? 0,
        chosen: result.chosen_order !== undefined || !!result.pFlags?.chosen
      });
    }
    return acc;
  }, []);
}

/**
 * Toggle a reaction on a message. Sending a reaction that is already chosen
 * removes it — that toggle lives in `appReactionsManager.sendReaction`.
 */
export async function sendReaction(peerId: number, mid: number, ref: ReactionRef): Promise<void> {
  const {managers} = await bootTelegram();
  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');

  await managers.appReactionsManager.sendReaction({
    message: message as any,
    reaction: toApiReaction(ref)
  } as any);
}

/** Live counter updates for messages of the open chat. */
export async function onReactionsUpdate(
  callback: (peerId: number, mid: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const handler = (updates: any) => {
    (Array.isArray(updates) ? updates : [updates]).forEach((update: any) => {
      const message = update?.message;
      if(message) callback(Number(message.peerId), message.mid);
    });
  };

  rootScope.addEventListener('messages_reactions', handler);
  return () => rootScope.removeEventListener('messages_reactions', handler);
}

/* ------------------------------------------------------------------ */
/* Who reacted                                                         */
/* ------------------------------------------------------------------ */

export type Reactor = {
  peerId: number;
  title: string;
  /** '' when the server did not attach a reaction (old clients, paid). */
  reactionKey: string;
  emoticon: string;
  docId: string;
  date: number;
};

function peerFromResult(result: any, peer: any): any {
  if(!peer) return undefined;
  if(peer._ === 'peerUser') {
    return result.users?.find((user: any) => '' + user.id === '' + peer.user_id);
  }
  if(peer._ === 'peerChannel') {
    return result.chats?.find((chat: any) => '' + chat.id === '' + peer.channel_id);
  }
  if(peer._ === 'peerChat') {
    return result.chats?.find((chat: any) => '' + chat.id === '' + peer.chat_id);
  }
  return undefined;
}

function titleOf(peer: any): string {
  if(!peer) return 'Someone';
  if(peer.title) return peer.title;
  const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim();
  return name || peer.username || 'Someone';
}

/**
 * Everyone who reacted, each with the reaction they used, so the popup can tab
 * by reaction. `ref` narrows the request to one reaction when given.
 */
export async function messageReactors(
  peerId: number,
  mid: number,
  ref?: ReactionRef,
  limit = 100
): Promise<Reactor[]> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.appReactionsManager.getMessageReactionsList(
      peerId,
      mid,
      limit,
      ref ? toApiReaction(ref) : undefined
    );

    const docIds = (result?.reactions ?? [])
      .map((reaction: any) => fromApiReaction(reaction.reaction))
      .filter((r: ReactionRef | null) => r?.kind === 'custom')
      .map((r: ReactionRef) => r.docId);
    if(docIds.length) await loadCustomEmojiDocs(docIds);

    return Promise.all((result?.reactions ?? []).map(async(reaction: any) => {
      const reactionRef = fromApiReaction(reaction.reaction);
      const peer = peerFromResult(result, reaction.peer_id);
      return {
        peerId: Number(await managers.appPeersManager.getPeerId(reaction.peer_id)),
        title: titleOf(peer),
        reactionKey: reactionRef?.key ?? '',
        emoticon: reactionRef?.emoticon ?? '',
        docId: reactionRef?.docId ?? '',
        date: reaction.date ?? 0
      };
    }));
  } catch(err) {
    return [];
  }
}

/** Broadcast channels hide the list unless the post says otherwise. */
export async function canSeeReactors(peerId: number, mid: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(message?.reactions?.pFlags?.can_see_list) return true;
  return !(await managers.appPeersManager.isBroadcast(peerId));
}

/* ------------------------------------------------------------------ */
/* Quick (default) reaction                                            */
/* ------------------------------------------------------------------ */

export async function quickReaction(): Promise<ReactionOption | null> {
  const {managers} = await bootTelegram();
  try {
    const reaction: any = await managers.appReactionsManager.getQuickReaction();
    const ref = fromApiReaction(reaction);
    return ref ? await toOption(ref) : null;
  } catch(err) {
    return null;
  }
}

/**
 * Double-tap on a bubble. Nothing happens when the chat does not take the
 * quick reaction — a double-click must not send something the chat refuses.
 */
export async function sendQuickReaction(peerId: number, mid: number): Promise<void> {
  const [quick, allowed] = await Promise.all([
    quickReaction(),
    reactionsForMessage(peerId, mid)
  ]);
  if(!quick || allowed.mode === 'chatReactionsNone') return;

  const permitted = allowed.mode === 'chatReactionsAll' ||
    allowed.options.some((option) => option.key === quick.key);
  if(!permitted) return;

  await sendReaction(peerId, mid, quick);
}

export async function setQuickReaction(ref: ReactionRef): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appReactionsManager.setDefaultReaction(toApiReaction(ref));
}

/** Fires when the default reaction changes anywhere (this tab or another). */
export async function onQuickReactionChange(callback: () => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  rootScope.addEventListener('quick_reaction', callback);
  return () => rootScope.removeEventListener('quick_reaction', callback);
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether the select/around animations may play. Power saving turns
 * `effects_reactions` off, and Web K checks the same key before it fires the
 * burst — a reaction still sends, it just lands silently.
 */
export async function reactionEffectsEnabled(): Promise<boolean> {
  try {
    const {default: liteMode} = await import('@helpers/liteMode');
    return liteMode.isAvailable('effects_reactions');
  } catch(err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Paid (star) reactions                                               */
/* ------------------------------------------------------------------ */

export async function isPaidReactionAvailable(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  try {
    return !!(await managers.appReactionsManager.isPaidReactionAvailable(peerId));
  } catch(err) {
    return false;
  }
}

/** Upper bound of the amount selector, from the app config Telegram ships. */
export async function maxPaidStars(): Promise<number> {
  await bootTelegram();
  try {
    const {default: apiManagerProxy} = await import('@lib/apiManagerProxy');
    const appConfig: any = await apiManagerProxy.getAppConfig();
    return Number(appConfig?.stars_paid_reaction_amount_max ?? 0) || 2500;
  } catch(err) {
    return 2500;
  }
}

export async function starsBalance(): Promise<number> {
  const {managers} = await bootTelegram();
  try {
    const status: any = await managers.appPaymentsManager.getStarsStatus();
    return Number(status?.balance?.amount ?? status?.balance ?? 0);
  } catch(err) {
    return 0;
  }
}

/** How many stars this account has already put on the message. */
export async function myPaidStars(peerId: number, mid: number): Promise<number> {
  const {managers} = await bootTelegram();
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  const paid = (message?.reactions?.results ?? [])
    .find((result: any) => result.reaction?._ === 'reactionPaid');
  return paid?.chosen_order !== undefined ? (paid?.count ?? 0) : 0;
}

/**
 * `paidReactionPrivacyAnonymous` hides the sender from the channel's top
 * reactor list. The manager caches the account-wide default; the toggle on a
 * message re-sends it for that message only, which is what Web K's popup does.
 */
export async function isPaidReactionAnonymous(): Promise<boolean> {
  const {managers} = await bootTelegram();
  try {
    const privacy: any = await managers.appReactionsManager.getPaidReactionPrivacy();
    return privacy?._ === 'paidReactionPrivacyAnonymous';
  } catch(err) {
    return false;
  }
}

/**
 * Peer id the manager reads as "post anonymously"
 * (`SEND_PAID_REACTION_ANONYMOUS_PEER_ID` in `@appManagers/constants`).
 */
const ANONYMOUS_PEER_ID = -1;

export async function setPaidReactionAnonymous(
  peerId: number,
  mid: number,
  anonymous: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appReactionsManager.togglePaidReactionPrivacy(
    peerId,
    mid,
    (anonymous ? ANONYMOUS_PEER_ID : await selfPeerId()) as any
  );
}

/** A user's peer id is its user id, so the self peer needs no conversion. */
async function selfPeerId(): Promise<number> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  return Number(self?.id ?? 0);
}

/**
 * Put `count` stars on a message. The stars are spent immediately — the
 * manager fires `messages.sendPaidReaction` and reserves the balance.
 */
export async function sendPaidReaction(
  peerId: number,
  mid: number,
  count: number,
  anonymous: boolean
): Promise<void> {
  if(count < 1) return;

  const {managers} = await bootTelegram();
  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');

  const sendAsPeerId = anonymous ? ANONYMOUS_PEER_ID : await selfPeerId();

  await managers.appReactionsManager.sendReaction({
    message: message as any,
    reaction: {_: 'reactionPaid'},
    count,
    sendAsPeerId: sendAsPeerId as any
  } as any);
}

/* ------------------------------------------------------------------ */
/* Per-chat settings (admins)                                          */
/* ------------------------------------------------------------------ */

export type ChatReactionsMode = 'all' | 'some' | 'none';

export type ChatReactionsSettings = {
  mode: ChatReactionsMode;
  /** Emoticons allowed in "some" mode. */
  emoticons: string[];
  /** Broadcast channels get a plain on/off in Web K, groups get the radio. */
  broadcast: boolean;
};

/** Only someone who can change the chat's info may change its reactions. */
export async function canEditChatReactions(peerId: number): Promise<boolean> {
  if(peerId >= 0) return false;
  const {managers} = await bootTelegram();
  try {
    const chatId = -peerId;
    return !!(await managers.appChatsManager.hasRights(chatId as any, 'change_info'));
  } catch(err) {
    return false;
  }
}

export async function chatReactionsSettings(peerId: number): Promise<ChatReactionsSettings | null> {
  if(peerId >= 0) return null;
  const {managers} = await bootTelegram();
  const chatId = -peerId;

  try {
    const [full, broadcast] = await Promise.all([
      managers.appProfileManager.getChatFull(chatId as any) as Promise<any>,
      managers.appChatsManager.isBroadcast(chatId as any)
    ]);

    const available = full?.available_reactions ?? {_: 'chatReactionsNone'};
    const mode: ChatReactionsMode = available._ === 'chatReactionsAll' ?
      'all' :
      (available._ === 'chatReactionsSome' ? 'some' : 'none');

    return {
      mode,
      emoticons: available._ === 'chatReactionsSome' ?
        (available.reactions ?? [])
          .filter((reaction: any) => reaction._ === 'reactionEmoji')
          .map((reaction: any) => reaction.emoticon) :
        [],
      broadcast: !!broadcast
    };
  } catch(err) {
    return null;
  }
}

/**
 * Save the chat's allowed reactions. "some" with nothing selected is stored as
 * "none" — the server would reject an empty list, and that is what Web K does.
 */
export async function setChatReactions(
  peerId: number,
  mode: ChatReactionsMode,
  emoticons: string[]
): Promise<void> {
  const {managers} = await bootTelegram();
  const chatId = -peerId;

  let reactions: any;
  if(mode === 'all') {
    reactions = {_: 'chatReactionsAll', pFlags: {allow_custom: true}};
  } else if(mode === 'some' && emoticons.length) {
    reactions = {
      _: 'chatReactionsSome',
      reactions: emoticons.map((emoticon) => ({_: 'reactionEmoji', emoticon}))
    };
  } else {
    reactions = {_: 'chatReactionsNone'};
  }

  await managers.appChatsManager.setChatAvailableReactions(chatId as any, reactions);
}

/* ------------------------------------------------------------------ */
/* Premium                                                             */
/* ------------------------------------------------------------------ */

/** Custom emoji reactions are a premium feature. */
export async function isPremium(): Promise<boolean> {
  const {managers} = await bootTelegram();
  try {
    const self: any = await managers.appUsersManager.getSelf();
    return !!self?.pFlags?.premium;
  } catch(err) {
    return false;
  }
}

/**
 * Custom emoji offered in the picker's premium tab: the account's recent
 * custom emoji plus the featured/installed emoji sets, flattened.
 */
export async function customEmojiChoices(limit = 64): Promise<ReactionOption[]> {
  const {managers} = await bootTelegram();

  const docs: any[] = [];
  try {
    const recent: any = await managers.appEmojiManager.getRecentEmojis('custom');
    const recentIds = (recent ?? [])
      .map((emoji: any) => (typeof emoji === 'string' ? emoji : emoji?.docId))
      .filter(Boolean)
      .map((docId: any) => '' + docId);
    if(recentIds.length) {
      const resolved: any[] = await managers.appEmojiManager.getCustomEmojiDocuments(recentIds.slice(0, limit));
      docs.push(...(resolved ?? []));
    }
  } catch(err) {
    // Falls through to the sets below.
  }

  if(docs.length < limit) {
    try {
      const sets: any = await managers.appStickersManager.getEmojiStickers();
      for(const set of (sets?.sets ?? [])) {
        if(docs.length >= limit) break;
        const full: any = await managers.appStickersManager.getStickerSet({
          _: 'inputStickerSetID',
          id: set.id,
          access_hash: set.access_hash
        } as any);
        docs.push(...((full?.documents ?? []) as any[]).slice(0, limit - docs.length));
      }
    } catch(err) {
      // No emoji sets installed, or the request failed — an empty tab is fine.
    }
  }

  const seen = new Set<string>();
  return docs.reduce<ReactionOption[]>((acc, doc) => {
    const docId = rememberDoc(doc);
    if(!docId || seen.has(docId)) return acc;
    seen.add(docId);

    const sticker = (doc.attributes ?? []).find((attribute: any) => (
      attribute._ === 'documentAttributeCustomEmoji' || attribute._ === 'documentAttributeSticker'
    ));

    acc.push({
      ...customReaction(docId, sticker?.alt ?? ''),
      title: sticker?.alt ?? '',
      iconDocId: docId,
      selectDocId: docId,
      aroundDocId: '',
      premium: false
    });
    return acc;
  }, []);
}
