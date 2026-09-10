import {GENERAL_TOPIC_ID} from '@appManagers/constants';
import getPeerId from '@appManagers/utils/peers/getPeerId';

import {bootTelegram} from './client';
import {getPeer, getSelfId, peerTitle, previewOf, toSticker, type StickerItem} from './chats';

/**
 * Forum topics, comment threads and Saved Messages sub-dialogs.
 *
 * The three live together because the MTProto stack models them the same way:
 * a peer plus a thread id. A forum topic's thread id is the id of its creation
 * service message, a comment thread's is the discussion-group message the
 * channel post was forwarded to, and a saved sub-dialog's is the peer the
 * messages were saved from.
 *
 * Same hard rule as `chats.ts`: everything returned from here is plain and
 * structured-cloneable, so it can enter Svelte state without a `$state` proxy
 * ever being posted back to the worker.
 */

/* ------------------------------------------------------------------ */
/* Forum topics                                                        */
/* ------------------------------------------------------------------ */

export type TopicItem = {
  threadId: number;
  title: string;
  preview: string;
  date: number;
  unread: number;
  closed: boolean;
  hidden: boolean;
  pinned: boolean;
  /** The forum's own "General" topic: it can be hidden, but never deleted. */
  isGeneral: boolean;
  /** Palette index the server picked for the default hash icon. */
  iconColor: number;
  /** Custom emoji document id used as the icon, '' when the topic has none. */
  iconEmojiId: string;
  /** Whether this account may edit, close, pin or delete the topic. */
  canManage: boolean;
};

/**
 * The six icon colours `messages.createForumTopic` accepts, in the order the
 * official clients offer them.
 */
export const TOPIC_ICON_COLORS = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];

/**
 * Forum topics are modelled as dialogs filtered by the forum's own peerId —
 * same call tweb's own topic list uses.
 */
export async function loadTopics(peerId: number, limit = 30): Promise<TopicItem[]> {
  const {managers} = await bootTelegram();
  const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId: peerId});

  return Promise.all(
    dialogs.map(async(topic: any) => {
      const topMessage = await managers.appMessagesManager.getMessageByPeer(peerId, topic.top_message);
      return {
        threadId: Number(topic.id),
        title: topic.title || 'Topic',
        preview: await previewOf(topMessage),
        date: topMessage?.date ?? 0,
        unread: topic.unread_count ?? 0,
        closed: !!topic.pFlags?.closed,
        hidden: !!topic.pFlags?.hidden,
        pinned: !!topic.pFlags?.pinned,
        isGeneral: Number(topic.id) === GENERAL_TOPIC_ID,
        iconColor: topic.icon_color ?? TOPIC_ICON_COLORS[0],
        iconEmojiId: topic.icon_emoji_id ? '' + topic.icon_emoji_id : '',
        canManage: await canManageTopic(peerId, Number(topic.id))
      };
    })
  );
}

async function canManageTopic(peerId: number, threadId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  try {
    const topic = await managers.dialogsStorage.getForumTopicById(peerId, threadId);
    return !!(topic && await managers.dialogsStorage.canManageTopic(topic));
  } catch(err) {
    return false;
  }
}

/** Whether this account may create topics in the forum at all. */
export async function canCreateTopic(peerId: number): Promise<boolean> {
  if(peerId >= 0) return false;
  const {managers} = await bootTelegram();
  try {
    return !!await managers.appChatsManager.hasRights(-peerId, 'manage_topics');
  } catch(err) {
    return false;
  }
}

/** Returns the thread id of the freshly created topic. */
export async function createTopic(
  peerId: number,
  title: string,
  options: {iconColor?: number; iconEmojiId?: string} = {}
): Promise<number> {
  const {managers} = await bootTelegram();
  const threadId = await managers.appMessagesManager.createForumTopic({
    peerId,
    title,
    iconColor: options.iconColor ?? TOPIC_ICON_COLORS[0],
    // The server rejects an empty string here: a topic without a custom emoji
    // must omit the field entirely and fall back to the coloured hash.
    iconEmojiId: options.iconEmojiId || undefined
  });
  return Number(threadId);
}

/**
 * Only the fields passed are sent — `messages.editForumTopic` treats an absent
 * field as "leave alone", so a title edit must not clear the icon.
 */
export async function editTopic(
  peerId: number,
  threadId: number,
  changes: {title?: string; iconEmojiId?: string}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.editForumTopic({
    peerId,
    topicId: threadId,
    title: changes.title,
    iconEmojiId: changes.iconEmojiId
  });
}

export async function setTopicClosed(peerId: number, threadId: number, closed: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.editForumTopic({peerId, topicId: threadId, closed});
}

/** Hiding is only meaningful for the General topic; the others are deleted instead. */
export async function setTopicHidden(peerId: number, threadId: number, hidden: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.editForumTopic({peerId, topicId: threadId, hidden});
}

export async function toggleTopicPin(peerId: number, threadId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.toggleDialogPin({peerId, topicOrSavedId: threadId});
}

/**
 * A topic is deleted by wiping its history — `messages.deleteTopicHistory`,
 * which the manager selects once a thread id is supplied.
 */
export async function deleteTopic(peerId: number, threadId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.flushHistory({
    peerId,
    threadOrSavedId: threadId
  });
}

/* ------------------------------------------------------------------ */
/* View as topics / view as messages                                   */
/* ------------------------------------------------------------------ */

/**
 * Forums can be shown as one flat timeline instead of a topic list. The flag
 * lives on the dialog, not the chat, so it survives a reload without a fetch.
 */
export async function isViewingForumAsMessages(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  try {
    const dialog: any = await managers.dialogsStorage.getDialogOnly(peerId);
    return !!dialog?.pFlags?.view_forum_as_messages;
  } catch(err) {
    return false;
  }
}

export async function setViewForumAsMessages(peerId: number, asMessages: boolean): Promise<void> {
  if(peerId >= 0) return;
  const {managers} = await bootTelegram();
  await managers.appChatsManager.toggleViewForumAsMessages(-peerId, asMessages);
}

/* ------------------------------------------------------------------ */
/* Topic icons                                                         */
/* ------------------------------------------------------------------ */

/**
 * Custom emoji documents are fetched in one batched request per icon and cached
 * in `chats.ts`'s document cache, so `Sticker` can render them like any other.
 */
export async function loadTopicIcon(docId: string): Promise<StickerItem | null> {
  if(!docId) return null;
  const {managers} = await bootTelegram();
  try {
    const doc: any = await managers.appEmojiManager.getCustomEmojiDocument(docId);
    return doc ? toSticker(doc) : null;
  } catch(err) {
    return null;
  }
}

/**
 * The custom emoji Telegram offers as topic icons — a server-side local set,
 * the same one the official clients show in the topic editor.
 */
export async function loadTopicIconChoices(): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  try {
    const set: any = await managers.appStickersManager.getLocalStickerSet('inputStickerSetEmojiDefaultTopicIcons');
    return (set?.documents ?? []).map((doc: any) => toSticker(doc));
  } catch(err) {
    return [];
  }
}

/** `#RRGGBB` for the plain hash icon a topic without a custom emoji gets. */
export function topicIconColor(color: number): string {
  return '#' + (color >>> 0).toString(16).padStart(6, '0').slice(-6);
}

/* ------------------------------------------------------------------ */
/* Comment threads                                                     */
/* ------------------------------------------------------------------ */

export type CommentThread = {
  /** The discussion group, not the channel the post lives in. */
  peerId: number;
  threadId: number;
  /** Comments already posted, for the thread header. */
  count: number;
  /** Highest comment this account has read, for the unread anchor. */
  readMaxId: number;
};

/**
 * Resolve a channel post into its discussion thread. The returned peer is the
 * linked group — the thread has no existence inside the channel itself.
 */
export async function openCommentThread(peerId: number, mid: number): Promise<CommentThread | null> {
  const {managers} = await bootTelegram();

  try {
    // The manager hands back the root message *inside the discussion group*,
    // not the raw messages.discussionMessage: its peer is the linked group and
    // its mid is the thread id.
    const message: any = await managers.appMessagesManager.getDiscussionMessage(peerId, mid);
    if(!message?.mid) return null;

    return {
      peerId: Number(message.peerId),
      threadId: message.mid,
      count: message.replies?.replies ?? 0,
      readMaxId: Number(message.replies?.read_max_id ?? 0)
    };
  } catch(err) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Saved Messages sub-dialogs                                          */
/* ------------------------------------------------------------------ */

export type SavedDialogItem = {
  /** The peer the messages were originally saved from — also the thread id. */
  savedPeerId: number;
  title: string;
  preview: string;
  date: number;
  pinned: boolean;
};

/**
 * Saved Messages can be read as one timeline or split per original sender.
 * The split view is `dialogsStorage`'s saved-dialog list; each row's peer id
 * doubles as the thread id `getHistory` filters the saved timeline by.
 */
export async function loadSavedDialogs(limit = 40): Promise<SavedDialogItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId: selfId});

  return Promise.all(
    (dialogs ?? []).map(async(dialog: any) => {
      const savedPeerId = Number(dialog.savedPeerId ?? getPeerId(dialog.peer));
      const [peer, topMessage] = await Promise.all([
        getPeer(savedPeerId),
        managers.appMessagesManager.getMessageByPeer(selfId, dialog.top_message)
      ]);

      return {
        savedPeerId,
        title: peerTitle(peer, selfId),
        preview: await previewOf(topMessage),
        date: topMessage?.date ?? 0,
        pinned: !!dialog.pFlags?.pinned
      };
    })
  );
}

const SAVED_AS_CHATS_KEY = 'webs.saved-as-chats';

/**
 * Unlike a forum's "view as messages", the saved split is a client-side
 * preference — tweb keeps it in its own settings and never tells the server.
 */
export function isSavedViewedAsChats(): boolean {
  try {
    return localStorage.getItem(SAVED_AS_CHATS_KEY) === '1';
  } catch(err) {
    return false;
  }
}

export function setSavedViewedAsChats(asChats: boolean): void {
  try {
    localStorage.setItem(SAVED_AS_CHATS_KEY, asChats ? '1' : '0');
  } catch(err) {}
}

/* ------------------------------------------------------------------ */
/* Saved Messages tags                                                 */
/* ------------------------------------------------------------------ */

export type SavedTagItem = {
  emoticon: string;
  count: number;
  /** User-chosen name for the tag, '' when it has never been renamed. */
  title: string;
};

/**
 * Tags are reactions on your own saved messages. Scoped to a saved sub-dialog
 * when `savedPeerId` is given, otherwise to all of Saved Messages.
 */
export async function loadSavedTags(savedPeerId?: number): Promise<SavedTagItem[]> {
  const {managers} = await bootTelegram();
  try {
    const tags: any[] = await managers.appReactionsManager.getSavedReactionTags(savedPeerId);
    return (tags ?? [])
      .filter((tag) => tag?.reaction?._ === 'reactionEmoji')
      .map((tag) => ({
        emoticon: tag.reaction.emoticon,
        count: tag.count ?? 0,
        title: tag.title ?? ''
      }));
  } catch(err) {
    return [];
  }
}

/** An empty title clears the name and leaves the bare emoji. */
export async function renameSavedTag(emoticon: string, title: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appReactionsManager.updateSavedReactionTag(
    {_: 'reactionEmoji', emoticon},
    title || undefined
  );
}

/**
 * Tagging has no API of its own — a tag *is* a reaction on a message in Saved
 * Messages, and sending the same one again removes it.
 */
export async function toggleSavedTag(mid: number, emoticon: string): Promise<void> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const message = await managers.appMessagesManager.getMessageByPeer(selfId, mid);
  if(!message) throw new Error('Message not found');
  await managers.appReactionsManager.sendReaction({
    message: message as any,
    reaction: {_: 'reactionEmoji', emoticon}
  });
}
