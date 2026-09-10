/*
 * The t.me link to a single message — "Copy Message Link".
 *
 * There was no single owner for this: `viewer.ts` and `reply.ts` each carried
 * their own builder, and only one of them converted the local message id, so the
 * link copied out of the media viewer was wrong in every channel (a channel's
 * mids are stored as `2^32 + serverId`). It lives here so both can share one
 * implementation, and because `reply.ts` is imported by `chats.ts` — a builder
 * in either of those would be a cycle.
 *
 * The shape follows tweb's own `getUrlToMessage`: a public channel or supergroup
 * links by username, a private one by its bare chat id, a forum topic puts its
 * root in the path, and a comment carries the post it comments on. `?comment=`
 * only means anything together with a username, so a private channel falls back
 * to `?thread=`.
 */
import getPeerId from '@appManagers/utils/peers/getPeerId';
import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';

import {bootTelegram} from './client';

/** Where a message sits, when it is not simply in the chat's main history. */
export type MessageLinkThread =
  /** A forum topic (or bot forum): the root message's mid. */
  | {kind: 'topic'; rootMid: number}
  /** A comment thread: the root message of the discussion group. */
  | {kind: 'comments'; rootMid: number};

export type MessageLink = {
  /** '' when the chat has no link that can be opened from outside. */
  url: string;
  /** True when only members can open it — tweb's wording for the notice. */
  isPrivate: boolean;
};

const NO_LINK: MessageLink = {url: '', isPrivate: false};

export async function messageLink(
  peerId: number,
  mid: number,
  thread?: MessageLinkThread
): Promise<MessageLink> {
  // A user chat, a basic group and Saved Messages have no addressable message:
  // tweb hides the entry for them rather than copying something that cannot open.
  if(!peerId || peerId > 0 || !mid) return NO_LINK;

  const {managers} = await bootTelegram();
  const serverId = getServerMessageId(mid);

  let username = '';
  try {
    username = (await managers.appPeersManager.getPeerUsername(peerId)) ?? '';
  } catch(err) {
    username = '';
  }

  const base = username ? `https://t.me/${username}` : `https://t.me/c/${Math.abs(peerId)}`;

  try {
    if(thread?.kind === 'comments') {
      // The root is a message in the group that hosts the comments, and it is a
      // forward of the channel post the comment belongs to.
      const root: any = await managers.appMessagesManager.getMessageByPeer(peerId, thread.rootMid);
      const post = root?.fwd_from?.channel_post;
      if(post) {
        const postServerId = getServerMessageId(post);
        const channelPeerId = Number(getPeerId(root.fwd_from.from_id));
        const channelUsername = channelPeerId ?
          await managers.appPeersManager.getPeerUsername(channelPeerId).catch(() => '') :
          '';

        if(channelUsername) {
          return {url: `https://t.me/${channelUsername}/${postServerId}?comment=${serverId}`, isPrivate: false};
        }

        return {url: `https://t.me/c/${Math.abs(channelPeerId)}/${serverId}?thread=${postServerId}`, isPrivate: true};
      }

      return {url: `${base}/${serverId}?thread=${getServerMessageId(thread.rootMid)}`, isPrivate: !username};
    }

    if(thread?.kind === 'topic') {
      return {url: `${base}/${getServerMessageId(thread.rootMid)}/${serverId}`, isPrivate: !username};
    }
  } catch(err) {
    // The thread's root could not be read — the plain form is still correct.
  }

  return {url: `${base}/${serverId}`, isPrivate: !username};
}
