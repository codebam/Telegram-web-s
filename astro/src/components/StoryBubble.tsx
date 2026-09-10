/*
 * A story that arrived in a chat: either a story someone shared, which renders
 * as its preview, or a mention of one, which Telegram renders as a small card.
 *
 * Not ported from `svelte/` — neither client ever rendered `messageMediaStory`,
 * so the message showed nothing at all. Upstream draws two quite different
 * things (`src/components/chat/bubbles.ts`): a `via_mention` message is turned
 * into a service-style card with the author's avatar and a "View Story" button,
 * while a shared story is a fixed 144×256 preview that the whole bubble opens.
 * A story that is gone is a row of its own in both cases rather than an empty
 * frame, which is why the lookup result matters as much as the media.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {getPeerBrief} from '$lib/telegram/chats';
import {loadStoryUrl, lookupStory, requestStoryViewer, type StoryItem} from '$lib/telegram/stories';
import type {StoryExtra} from '$lib/telegram/messageTypes';
import {Avatar} from './Avatar';

interface Props {
  extra: StoryExtra;
  /** The chat this bubble lives in — only the "you mentioned X" wording needs it. */
  chatTitle: string;
}

/** Upstream's preview box: `height = 256`, `width = height * 9 / 16`. */
const PREVIEW_WIDTH = 144;
const PREVIEW_HEIGHT = 256;

export function StoryBubble({extra, chatTitle}: Props) {
  const loading = useSignal(true);
  const story = useSignal<StoryItem | null>(null);
  const url = useSignal<string | null>(null);
  const author = useSignal<{title: string; isSelf: boolean} | null>(null);

  useEffect(() => {
    let cancelled = false;
    loading.value = true;
    story.value = null;
    url.value = null;

    (async() => {
      const [item, brief] = await Promise.all([
        lookupStory(extra.peerId, extra.storyId),
        getPeerBrief(extra.peerId).catch(() => null)
      ]);

      if(cancelled) return;
      author.value = brief ? {title: brief.title, isSelf: brief.isSelf} : null;

      if(!item) {
        loading.value = false;
        return;
      }

      story.value = item;
      // The preview needs the media itself; a mention only needs the avatar and
      // the wording, so it does not pay for a download it will not show.
      if(!extra.viaMention) {
        const mediaUrl = await loadStoryUrl(extra.peerId, extra.storyId);
        if(cancelled) return;
        url.value = mediaUrl;
      }

      loading.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [extra.peerId, extra.storyId, extra.viaMention]);

  const open = () => requestStoryViewer(extra.peerId, extra.storyId);

  if(loading.value) {
    return <span class="story-note">Loading…</span>;
  }

  if(!story.value) {
    /* Both wordings are Telegram's (lang.ts 'ExpiredStoryMention' /
       'ExpiredStoryMentionYou'): a mention of a story that is gone says whose it
       was, and when it was ours it names the chat it was mentioned in. */
    const text = !extra.viaMention ?
      'Story expired' :
      author.value?.isSelf ?
        `The story you mentioned ${chatTitle} in is no longer available` :
        'The story you were mentioned in is no longer available';

    return <span class="story-note story-expired">💥 {text}</span>;
  }

  if(extra.viaMention) {
    const title = author.value?.title ?? '';
    const mine = !!author.value?.isSelf;
    const media = story.value;

    return (
      <div class="story-mention">
        <button class="story-mention-avatar" onClick={open} aria-label="View story">
          <Avatar peerId={extra.peerId} title={title} size={72} />
        </button>
        <span class="story-mention-text">
          {mine ? `You mentioned ${chatTitle} in a story` : `${title} mentioned you in a story`}
        </span>
        <button class="story-mention-view" onClick={open} disabled={media.expireDate * 1000 < Date.now()}>
          View Story
        </button>
      </div>
    );
  }

  const media = story.value;
  const expired = media.expireDate * 1000 < Date.now();

  return (
    <button
      class="story-preview"
      onClick={open}
      aria-label="Open story"
      style={{width: `${PREVIEW_WIDTH}px`, height: `${PREVIEW_HEIGHT}px`}}
    >
      {expired || !url.value ?
        <span class="story-note">{url.value ? 'Story expired' : 'Loading…'}</span> :
        media.isVideo ?
          <video src={url.value} muted autoplay loop playsInline></video> :
          <img src={url.value} alt="Story" draggable={false} />}
    </button>
  );
}
