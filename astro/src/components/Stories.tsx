/*
 * The story viewer: the strip in the sidebar, the full-screen player, and the
 * sheets stacked on top of it — the composer, "my stories" management, the
 * viewers list, the audience editor, close friends, and the share picker.
 *
 * Ported from svelte/src/lib/components/Stories.svelte. Notes on the port:
 *
 *  - The seven `use:portal` sites are `<Portal>` from `$lib/portal` now. The
 *    reason the action was there still holds: the strip lives in the sidebar,
 *    and the sidebar is a `backdrop-filter` pane, which makes it the containing
 *    block for `position: fixed`, so the viewer would cover the chat list only.
 *    Moving the node to the body is what makes it cover the viewport.
 *  - The `$effect`s are split by what they read (CONVERSION.md §4): the ones
 *    reading signals are `useSignalEffect`s, while the initial load and the
 *    `visibilitychange` listener take no reactive dependency at all and are
 *    plain `useEffect`s with an empty dependency list.
 *  - Everything Svelte kept in a plain `let` is a ref here: `toastTimer`,
 *    `frame`, `startedAt` and `elapsedBeforePause` are never rendered, and a
 *    plain local in a Preact body would be reset on every render. `video` was a
 *    `bind:this` and is only read imperatively (`startPlayback`, `pause`), so it
 *    is a ref too.
 *  - The `untrack(() => …)` around `pause()`/`resume()` is `untracked` from
 *    `@preact/signals`, and it is load-bearing: both touch `paused`, so tracking
 *    that read would let this effect undo a press-and-hold pause the moment the
 *    pointer went down.
 */
import {useEffect, useRef} from 'preact/hooks';
import {untracked, useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {Avatar} from './Avatar';
import {PeerPicker} from './PeerPicker';
import {ReactionSticker} from './ReactionSticker';
import {Portal} from '$lib/portal';
import type {DialogItem} from '$lib/telegram/chats';
import {copyText} from '$lib/telegram/profile';
import {activeReactions, type ReactionOption} from '$lib/telegram/reactions';
import {
  activateStealthMode,
  countStoryView,
  deleteStory,
  DEFAULT_STORY_PERIOD,
  loadContacts,
  loadMyActiveStories,
  loadMyStories,
  loadStealthMode,
  loadStories,
  loadStoriesFeed,
  loadStoryUrl,
  loadStoryViewers,
  markStoriesRead,
  postStory,
  reactToStory,
  replyToStory,
  saveCloseFriends,
  selfPeerId,
  setStoryAudience,
  setStoryPinned,
  shareStoryTo,
  storyLink,
  STORY_PERIODS,
  type MyStoriesKind,
  type StealthMode,
  type StoryAudience,
  type StoryContact,
  type StoryItem,
  type StoryPeer,
  type StoryViewer
} from '$lib/telegram/stories';

import './Stories.css';

interface Props {
  dialogs?: DialogItem[];
}

export function Stories({dialogs = []}: Props) {
  const feed = useSignal<StoryPeer[]>([]);
  const mine = useSignal<StoryItem[]>([]);
  const selfId = useSignal(0);
  const openPeer = useSignal<StoryPeer | null>(null);
  const stories = useSignal<StoryItem[]>([]);
  const index = useSignal(0);
  const url = useSignal<string | null>(null);
  /** 0–1 fill of the current segment; drives both the bar and auto-advance. */
  const progress = useSignal(0);
  const paused = useSignal(false);
  const video = useRef<HTMLVideoElement>(null);

  const current = useComputed(() => stories.value[index.value] ?? null);

  const AUDIENCES: Array<{value: StoryAudience; label: string}> = [
    {value: 'everyone', label: 'Everyone'},
    {value: 'contacts', label: 'Contacts'},
    {value: 'close', label: 'Close friends'},
    {value: 'selected', label: 'Selected contacts'}
  ];

  const audienceLabel = (value: StoryAudience) =>
    AUDIENCES.find((a) => a.value === value)?.label ?? '';

  /* ---------------- overlays on top of the viewer ---------------- */

  const composerOpen = useSignal(false);
  const manageOpen = useSignal(false);
  const closeFriendsOpen = useSignal(false);
  const viewersFor = useSignal<StoryItem | null>(null);
  const sharing = useSignal<StoryItem | null>(null);
  const audienceFor = useSignal<StoryItem | null>(null);
  const toast = useSignal('');

  const overlayOpen = useComputed(
    () =>
      composerOpen.value ||
      manageOpen.value ||
      closeFriendsOpen.value ||
      !!viewersFor.value ||
      !!sharing.value ||
      !!audienceFor.value
  );

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function say(message: string) {
    toast.value = message;
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => (toast.value = ''), 2600);
  }

  const MUTED_KEY = 'webs:stories-muted';
  /** Sound is on unless it was turned off before; the choice sticks. */
  const muted = useSignal(localStorage.getItem(MUTED_KEY) === '1');

  function toggleMuted() {
    muted.value = !muted.value;
    localStorage.setItem(MUTED_KEY, muted.value ? '1' : '0');
  }

  /**
   * Opening a story is a click, so unmuted autoplay is normally allowed — but
   * a browser that still blocks it rejects play() and would otherwise leave a
   * frozen frame. Fall back to muted rather than to nothing.
   */
  function startPlayback() {
    const el = video.current;
    el?.play().catch(() => {
      if(el !== video.current || el.muted) return;
      muted.value = true;
      el.play().catch(() => {});
    });
  }

  /** Photos get a fixed run; videos play for their own duration. */
  const PHOTO_SECONDS = 5;

  /*
   * The strip lives in the sidebar, and the sidebar is a `backdrop-filter`
   * pane: that makes it the containing block for `position: fixed`, so the
   * viewer would cover the chat list only. Move it to the body instead — which
   * is what `<Portal>` from `$lib/portal` does, so every one of the seven
   * `use:portal` sites below wraps that element in one.
   */

  const frame = useRef<number | undefined>(undefined);
  const startedAt = useRef(0);
  const elapsedBeforePause = useRef(0);

  useEffect(() => {
    loadStoriesFeed().then((loaded) => (feed.value = loaded));
    loadMyActiveStories().then((loaded) => (mine.value = loaded));
    selfPeerId().then((id) => (selfId.value = id));
    activeReactions().then((list) => (reactionChoices.value = list.slice(0, 8)));
  }, []);

  // Resolve the media for whichever story is on screen.
  useSignalEffect(() => {
    const peer = openPeer.value;
    const story = stories.value[index.value];
    if(!peer || !story) return;

    url.value = null;
    loadStoryUrl(peer.peerId, story.id).then((resolved) => {
      if(openPeer.value?.peerId === peer.peerId && stories.value[index.value]?.id === story.id) {
        url.value = resolved;
      }
    });
  });

  /**
   * Runs the current story to completion, then advances. Uses rAF rather than a
   * timeout so the bar animates and a pause can resume mid-story.
   */
  function play() {
    stop();
    const story = stories.value[index.value];
    if(!story || !url.value) return;

    const seconds = story.isVideo && story.duration ? story.duration : PHOTO_SECONDS;
    startedAt.current = performance.now() - elapsedBeforePause.current;

    const tick = () => {
      if(paused.value) return;
      const elapsed = performance.now() - startedAt.current;
      progress.value = Math.min(1, elapsed / (seconds * 1000));

      if(progress.value >= 1) {
        elapsedBeforePause.current = 0;
        step(1);
        return;
      }

      frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
  }

  function stop() {
    if(frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  }

  function pause() {
    if(!openPeer.value || paused.value) return;
    paused.value = true;
    elapsedBeforePause.current = performance.now() - startedAt.current;
    stop();
    video.current?.pause();
  }

  function resume() {
    if(!openPeer.value || !paused.value || overlayOpen.value || replying.value) return;
    paused.value = false;
    play();
    startPlayback();
  }

  // Restart the timer whenever the story or its media changes.
  useSignalEffect(() => {
    if(!openPeer.value || !url.value) return;
    void index.value;
    progress.value = 0;
    elapsedBeforePause.current = 0;
    paused.value = false;
    play();
    return stop;
  });

  // A sheet on top of the viewer must not let the story run out behind it.
  // Only the overlay flag is tracked: `pause`/`resume` touch `paused`, and
  // tracking that too would make this effect undo a press-and-hold pause the
  // moment the pointer went down.
  useSignalEffect(() => {
    const blocked = overlayOpen.value;
    untracked(() => (blocked ? pause() : resume()));
  });

  // A backgrounded tab should not burn through someone's stories.
  useEffect(() => {
    const onVisibility = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  async function open(peer: StoryPeer) {
    openPeer.value = peer;
    index.value = 0;
    stories.value = await loadStories(peer.peerId, peer.storyIds);
    if(!stories.value.length) return;

    if(peer.peerId !== selfId.value) {
      await markStoriesRead(peer.peerId, stories.value[stories.value.length - 1].id);
      feed.value = feed.value.map((p) => (p.peerId === peer.peerId ? {...p, unread: false} : p));
    }
  }

  function openMine() {
    if(!mine.value.length) {
      composerOpen.value = true;
      return;
    }

    open({
      peerId: selfId.value,
      title: 'Your story',
      unread: false,
      storyIds: mine.value.map((story) => story.id)
    });
  }

  function close() {
    stop();
    openPeer.value = null;
    stories.value = [];
    url.value = null;
    progress.value = 0;
    replyText.value = '';
    replying.value = false;
  }

  function step(delta: number) {
    const next = index.value + delta;
    if(next < 0 || next >= stories.value.length) close();
    else {
      elapsedBeforePause.current = 0;
      index.value = next;
    }
  }

  // Somebody else's story counts as a view the moment it is on screen.
  useSignalEffect(() => {
    const story = current.value;
    if(!story || story.mine) return;
    countStoryView(story.peerId, story.id);
  });

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') {
      if(composerOpen.value) composerOpen.value = false;
      else if(closeFriendsOpen.value) closeFriendsOpen.value = false;
      else if(audienceFor.value) audienceFor.value = null;
      else if(viewersFor.value) viewersFor.value = null;
      else if(sharing.value) sharing.value = null;
      else if(manageOpen.value) manageOpen.value = false;
      else if(openPeer.value) close();
      return;
    }

    if(!openPeer.value || overlayOpen.value || replying.value) return;
    if(e.key === 'ArrowLeft') step(-1);
    else if(e.key === 'ArrowRight') step(1);
  }

  /* ---------------- reply and react ---------------- */

  const replyText = useSignal('');
  const replying = useSignal(false);
  const reactionChoices = useSignal<ReactionOption[]>([]);

  async function sendReply() {
    const story = current.value;
    const text = replyText.value.trim();
    if(!story || !text) return;

    replyText.value = '';
    await replyToStory(story.peerId, story.id, text);
    say('Reply sent');
  }

  async function react(option: ReactionOption) {
    const story = current.value;
    if(!story) return;

    const already = story.sentReaction?.key === option.key;
    const next = already ? null : {kind: option.kind, emoticon: option.emoticon, docId: option.docId, key: option.key};
    // Plain object, not a signal value: this crosses into the worker.
    await reactToStory(story.peerId, story.id, next);
    stories.value = stories.value.map((item, i) => (i === index.value ? {...item, sentReaction: next} : item));
  }

  async function copyLink(story: StoryItem) {
    const link = await storyLink(story.peerId, story.id);
    if(!link) {
      say('This story has no public link');
      return;
    }

    say((await copyText(link)) ? 'Link copied' : link);
  }

  async function share(targets: number[]) {
    const story = sharing.value;
    if(!story || !targets.length) return;

    sharing.value = null;
    shareTargets.value = [];
    await shareStoryTo(story.peerId, story.id, targets);
    say(targets.length > 1 ? `Shared to ${targets.length} chats` : 'Shared');
  }

  const shareTargets = useSignal<number[]>([]);

  function toggleShareTarget(peerId: number) {
    shareTargets.value = shareTargets.value.includes(peerId) ?
      shareTargets.value.filter((id) => id !== peerId) :
      [...shareTargets.value, peerId];
  }

  /* ---------------- viewers list ---------------- */

  const viewers = useSignal<StoryViewer[]>([]);
  const viewersOffset = useSignal('');
  const viewersLoading = useSignal(false);

  async function openViewers(story: StoryItem) {
    viewersFor.value = story;
    viewers.value = [];
    viewersOffset.value = '';
    await moreViewers();
  }

  async function moreViewers() {
    const story = viewersFor.value;
    if(!story || viewersLoading.value) return;

    viewersLoading.value = true;
    const page = await loadStoryViewers(story.peerId, story.id, viewersOffset.value);
    if(viewersFor.value?.id === story.id) {
      viewers.value = [...viewers.value, ...page.viewers];
      viewersOffset.value = page.nextOffset;
    }
    viewersLoading.value = false;
  }

  /* ---------------- composer ---------------- */

  const file = useSignal<File | null>(null);
  const filePreview = useSignal('');
  const caption = useSignal('');
  const audience = useSignal<StoryAudience>('everyone');
  const period = useSignal(DEFAULT_STORY_PERIOD);
  const keepOnProfile = useSignal(false);
  const picked = useSignal<number[]>([]);
  const posting = useSignal(false);
  const composerError = useSignal('');

  const contacts = useSignal<StoryContact[]>([]);
  const contactsLoaded = useSignal(false);

  async function ensureContacts() {
    if(contactsLoaded.value) return;
    contacts.value = await loadContacts();
    contactsLoaded.value = true;
  }

  useSignalEffect(() => {
    if(audience.value === 'selected' || closeFriendsOpen.value) ensureContacts();
  });

  function chooseFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    if(!chosen) return;

    if(filePreview.value) URL.revokeObjectURL(filePreview.value);
    // A File is a host object, not a plain one, so a signal holds it as-is — it
    // is not proxied — and it stays structured-cloneable on the way to the worker.
    file.value = chosen;
    filePreview.value = URL.createObjectURL(chosen);
    composerError.value = '';
  }

  function closeComposer() {
    composerOpen.value = false;
    if(filePreview.value) URL.revokeObjectURL(filePreview.value);
    filePreview.value = '';
    file.value = null;
    caption.value = '';
    picked.value = [];
    composerError.value = '';
  }

  async function post() {
    if(!file.value || posting.value) return;

    posting.value = true;
    composerError.value = '';

    try {
      await postStory({
        file: file.value,
        caption: caption.value,
        audience: audience.value,
        allowUserIds: [...picked.value],
        period: period.value,
        pinned: keepOnProfile.value
      });

      closeComposer();
      mine.value = await loadMyActiveStories();
      say('Story posted');
    } catch (err: any) {
      composerError.value = err?.type || err?.message || 'Could not post the story';
    } finally {
      posting.value = false;
    }
  }

  function togglePicked(peerId: number) {
    picked.value = picked.value.includes(peerId) ?
      picked.value.filter((id) => id !== peerId) :
      [...picked.value, peerId];
  }

  /* ---------------- my stories management ---------------- */

  const manageTab = useSignal<MyStoriesKind>('profile');
  const managed = useSignal<StoryItem[]>([]);
  const managedCount = useSignal(0);
  const managedLoading = useSignal(false);
  const stealth = useSignal<StealthMode>({activeUntil: 0, cooldownUntil: 0});

  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const stealthActive = useComputed(() => stealth.value.activeUntil > nowSeconds());
  const stealthCooling = useComputed(() => !stealthActive.value && stealth.value.cooldownUntil > nowSeconds());

  useSignalEffect(() => {
    if(!manageOpen.value) return;
    const tab = manageTab.value;

    managedLoading.value = true;
    loadMyStories(tab).then((page) => {
      if(!manageOpen.value || manageTab.value !== tab) return;
      managed.value = page.stories;
      managedCount.value = page.count;
      managedLoading.value = false;
    });
  });

  useSignalEffect(() => {
    if(manageOpen.value) loadStealthMode().then((mode) => (stealth.value = mode));
  });

  async function reloadManaged() {
    const page = await loadMyStories(manageTab.value);
    managed.value = page.stories;
    managedCount.value = page.count;
    mine.value = await loadMyActiveStories();
  }

  async function togglePin(story: StoryItem) {
    const pinned = !story.pinned;
    await setStoryPinned(story.peerId, story.id, pinned);
    // The viewer holds its own copy of the story, so the chip would keep the
    // old label until the story was reopened.
    stories.value = stories.value.map((item) => (item.id === story.id ? {...item, pinned} : item));
    await reloadManaged();
    say(pinned ? 'Kept on profile' : 'Removed from profile');
  }

  async function remove(story: StoryItem) {
    await deleteStory(story.peerId, story.id);
    stories.value = stories.value.filter((item) => item.id !== story.id);
    if(!stories.value.length && openPeer.value) close();
    await reloadManaged();
    say('Story deleted');
  }

  async function turnOnStealth() {
    await activateStealthMode();
    stealth.value = await loadStealthMode();
    say('Stealth mode on');
  }

  /* ---------------- audience editing ---------------- */

  const editAudience = useSignal<StoryAudience>('everyone');
  const editPicked = useSignal<number[]>([]);
  const savingAudience = useSignal(false);

  function openAudience(story: StoryItem) {
    audienceFor.value = story;
    editAudience.value = story.audience;
    editPicked.value = [];
    ensureContacts();
  }

  function toggleEditPicked(peerId: number) {
    editPicked.value = editPicked.value.includes(peerId) ?
      editPicked.value.filter((id) => id !== peerId) :
      [...editPicked.value, peerId];
  }

  async function saveAudience() {
    const story = audienceFor.value;
    if(!story || savingAudience.value) return;

    savingAudience.value = true;
    try {
      await setStoryAudience(story.peerId, story.id, editAudience.value, [...editPicked.value]);
      stories.value = stories.value.map((item) =>
        item.id === story.id ? {...item, audience: editAudience.value} : item
      );
      managed.value = managed.value.map((item) =>
        item.id === story.id ? {...item, audience: editAudience.value} : item
      );
      audienceFor.value = null;
      say('Audience updated');
    } catch (err: any) {
      say(err?.type || 'Could not change the audience');
    } finally {
      savingAudience.value = false;
    }
  }

  /* ---------------- close friends ---------------- */

  const closeFriendIds = useSignal<number[]>([]);
  const savingFriends = useSignal(false);

  function openCloseFriends() {
    closeFriendsOpen.value = true;
    ensureContacts().then(() => {
      closeFriendIds.value = contacts.value.filter((c) => c.closeFriend).map((c) => c.peerId);
    });
  }

  function toggleCloseFriend(peerId: number) {
    closeFriendIds.value = closeFriendIds.value.includes(peerId) ?
      closeFriendIds.value.filter((id) => id !== peerId) :
      [...closeFriendIds.value, peerId];
  }

  async function saveFriends() {
    if(savingFriends.value) return;

    savingFriends.value = true;
    try {
      const ids = [...closeFriendIds.value];
      await saveCloseFriends(ids);
      contacts.value = contacts.value.map((c) => ({...c, closeFriend: ids.includes(c.peerId)}));
      closeFriendsOpen.value = false;
      say('Close friends saved');
    } catch (err: any) {
      say(err?.type || 'Could not save the list');
    } finally {
      savingFriends.value = false;
    }
  }

  const dateLabel = (seconds: number) =>
    seconds ? new Date(seconds * 1000).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : '';

  // The original listened through <svelte:window>; the same listener is added
  // and removed here. Everything `onKey` reaches is a signal (always current),
  // so there is no prop to depend on.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div class="strip">
        <button class="story add" onClick={() => (composerOpen.value = true)} title="Add a story">
          <span class="ring plus">+</span>
          <span class="name">Add story</span>
        </button>

        {mine.value.length > 0 && (
          <button class="story" onClick={openMine} title="Your story">
            <span class="ring own">
              <Avatar peerId={selfId.value} title="You" size={52} />
            </span>
            <span class="name">Your story</span>
          </button>
        )}

        <button class="story" onClick={() => (manageOpen.value = true)} title="My stories, stealth mode, close friends">
          <span class="ring plus">⋯</span>
          <span class="name">Manage</span>
        </button>

        {feed.value.map((peer) => (
          <button class="story" key={peer.peerId} onClick={() => open(peer)}>
            <span class={['ring', peer.unread && 'unread'].filter(Boolean).join(' ')}>
              <Avatar peerId={peer.peerId} title={peer.title} size={52} />
            </span>
            <span class="name">{peer.title}</span>
          </button>
        ))}
      </div>

      {openPeer.value && (
        <Portal>
          <div class="viewer" onClick={close} role="presentation">
            <div
              class="stage"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={pause}
              onPointerUp={resume}
              onPointerCancel={resume}
              role="presentation"
            >
              <div class="progress">
                {stories.value.map((_, i) => (
                  <span class="segment" key={i}>
                    <span
                      class="fill"
                      style={{transform: `scaleX(${i < index.value ? 1 : i === index.value ? progress.value : 0})`}}
                    ></span>
                  </span>
                ))}
              </div>

              <header>
                <Avatar peerId={openPeer.value.peerId} title={openPeer.value.title} size={32} />
                <span>{openPeer.value.title}</span>
                {stories.value[index.value]?.isVideo && (
                  <button class="sound" onClick={toggleMuted} aria-label={muted.value ? 'Unmute' : 'Mute'}>
                    {muted.value ? '🔇' : '🔊'}
                  </button>
                )}
                <button class="close" onClick={close} aria-label="Close">✕</button>
              </header>

              {/* The original carried the equivalent svelte-ignore a11y_media_has_caption. */}
              {!url.value ?
                <p class="muted">Loading…</p> :
                stories.value[index.value]?.isVideo ?
                  <video
                    ref={video}
                    src={url.value}
                    autoplay
                    playsinline
                    muted={muted.value}
                    onCanPlay={startPlayback}
                    onEnded={() => step(1)}
                  ></video> :
                  <img src={url.value} alt="" />}

              <div class="foot">
                {stories.value[index.value]?.caption && (
                  <p class="caption">{stories.value[index.value].caption}</p>
                )}

                {current.value && (
                  current.value.mine ?
                    <div class="owner-bar">
                      <button class="chip" onClick={() => openViewers(current.value)}>
                        👁 {current.value.viewsCount}{current.value.reactionsCount ? ` · ❤️ ${current.value.reactionsCount}` : ''}
                      </button>
                      <button class="chip" onClick={() => openAudience(current.value)}>
                        {audienceLabel(current.value.audience)}
                      </button>
                      <button class="chip" onClick={() => togglePin(current.value)}>
                        {current.value.pinned ? 'Unpin' : 'Pin to profile'}
                      </button>
                      <button class="chip" onClick={() => copyLink(current.value)}>Copy link</button>
                      <button class="chip" onClick={() => (sharing.value = current.value)}>Share</button>
                      <button class="chip danger" onClick={() => remove(current.value)}>Delete</button>
                    </div> :
                    <>
                      <div class="reactions">
                        {reactionChoices.value.map((option) => (
                          <button
                            class={['reaction', current.value?.sentReaction?.key === option.key && 'picked'].filter(Boolean).join(' ')}
                            key={option.key}
                            onClick={() => react(option)}
                            aria-label={option.title}
                          >
                            <ReactionSticker docId={option.iconDocId} fallback={option.emoticon} size={26} />
                          </button>
                        ))}
                      </div>

                      <div class="reply-bar">
                        <input
                          placeholder="Reply to story"
                          value={replyText.value}
                          onInput={(e) => (replyText.value = (e.target as HTMLInputElement).value)}
                          onFocus={() => {
                            replying.value = true;
                            pause();
                          }}
                          onBlur={() => {
                            replying.value = false;
                            resume();
                          }}
                          onKeyDown={(e) => {
                            if(e.key === 'Enter') sendReply();
                          }}
                        />
                        <button class="chip" onClick={sendReply} disabled={!replyText.value.trim()}>Send</button>
                        <button class="chip" onClick={() => (sharing.value = current.value)}>Share</button>
                        <button class="chip" onClick={() => copyLink(current.value)}>Link</button>
                      </div>
                    </>
                )}
              </div>

              <button class="nav prev" onClick={() => step(-1)} aria-label="Previous">‹</button>
              <button class="nav next" onClick={() => step(1)} aria-label="Next">›</button>
            </div>
          </div>
        </Portal>
      )}

      {composerOpen.value && (
        <Portal>
          <div class="backdrop" onClick={closeComposer} role="presentation">
            <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
              <header class="sheet-head">Post a story</header>

              <div class="sheet-body">
                <label class="file">
                  <input type="file" accept="image/*,video/*" onChange={chooseFile} />
                  <span>{file.value ? file.value.name : 'Choose a photo or video'}</span>
                </label>

                {/* The original carried the equivalent svelte-ignore a11y_media_has_caption here too. */}
                {!!filePreview.value &&
                  (file.value?.type.startsWith('video/') ?
                    <video class="preview" src={filePreview.value} controls playsinline></video> :
                    <img class="preview" src={filePreview.value} alt="" />)}

                <input
                  class="caption-input"
                  placeholder="Caption (optional)"
                  value={caption.value}
                  onInput={(e) => (caption.value = (e.target as HTMLInputElement).value)}
                />

                <fieldset>
                  <legend>Who can see it</legend>
                  {AUDIENCES.map((option) => (
                    <label class="option" key={option.value}>
                      <input
                        type="radio"
                        value={option.value}
                        checked={audience.value === option.value}
                        onChange={() => (audience.value = option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>

                {audience.value === 'selected' && (
                  <div class="contacts">
                    {contacts.value.map((contact) => (
                      <button
                        class={['contact', picked.value.includes(contact.peerId) && 'picked'].filter(Boolean).join(' ')}
                        key={contact.peerId}
                        onClick={() => togglePicked(contact.peerId)}
                      >
                        <Avatar peerId={contact.peerId} title={contact.title} size={28} />
                        <span class="name">{contact.title}</span>
                        <span class="check">{picked.value.includes(contact.peerId) ? '✓' : ''}</span>
                      </button>
                    ))}
                    {!contacts.value.length && (
                      <p class="hint">No contacts yet.</p>
                    )}
                  </div>
                )}

                <label class="row">
                  <span>Keep up for</span>
                  <select
                    value={period.value}
                    onChange={(e) => (period.value = Number((e.target as HTMLSelectElement).value))}
                  >
                    {STORY_PERIODS.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label class="option">
                  <input
                    type="checkbox"
                    checked={keepOnProfile.value}
                    onChange={(e) => (keepOnProfile.value = (e.target as HTMLInputElement).checked)}
                  />
                  <span>Keep on my profile after it expires</span>
                </label>

                {!!composerError.value && (
                  <p class="error">{composerError.value}</p>
                )}
              </div>

              <footer class="sheet-foot">
                <button onClick={closeComposer}>Cancel</button>
                <button class="primary" onClick={post} disabled={!file.value || posting.value}>
                  {posting.value ? 'Posting…' : 'Post'}
                </button>
              </footer>
            </div>
          </div>
        </Portal>
      )}

      {manageOpen.value && (
        <Portal>
          <div class="backdrop" onClick={() => (manageOpen.value = false)} role="presentation">
            <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
              <header class="sheet-head">My stories</header>

              <div class="tabs">
                <button
                  class={[manageTab.value === 'profile' && 'active'].filter(Boolean).join(' ')}
                  onClick={() => (manageTab.value = 'profile')}
                >
                  On profile
                </button>
                <button
                  class={[manageTab.value === 'archive' && 'active'].filter(Boolean).join(' ')}
                  onClick={() => (manageTab.value = 'archive')}
                >
                  Archive
                </button>
              </div>

              <div class="sheet-body">
                {managedLoading.value ?
                  <p class="hint">Loading…</p> :
                  !managed.value.length ?
                    <p class="hint">
                      {manageTab.value === 'profile' ?
                        'No stories kept on your profile.' :
                        'Your expired stories will show up here.'}
                    </p> :
                    <>
                      <p class="hint">{managedCount.value} {managedCount.value === 1 ? 'story' : 'stories'}</p>
                      {managed.value.map((story) => (
                        <div class="managed" key={story.id}>
                          <div class="managed-info">
                            <strong>{story.caption || (story.isVideo ? 'Video story' : 'Photo story')}</strong>
                            <span class="meta">
                              {dateLabel(story.date)} · 👁 {story.viewsCount} · {audienceLabel(story.audience)}
                            </span>
                          </div>
                          <div class="managed-actions">
                            <button class="chip" onClick={() => openViewers(story)}>Viewers</button>
                            <button class="chip" onClick={() => openAudience(story)}>Audience</button>
                            <button class="chip" onClick={() => togglePin(story)}>
                              {story.pinned ? 'Unpin' : 'Pin'}
                            </button>
                            <button class="chip danger" onClick={() => remove(story)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </>}

                <div class="tools">
                  <button class="chip" onClick={openCloseFriends}>Edit close friends</button>
                  <button class="chip" onClick={turnOnStealth} disabled={stealthActive.value || stealthCooling.value}>
                    {stealthActive.value ?
                      'Stealth mode is on' :
                      stealthCooling.value ?
                        'Stealth mode cooling down' :
                        'Turn on stealth mode'}
                  </button>
                </div>
                <p class="hint">
                  Stealth mode hides you from the viewer lists of the stories you watch, for the last 5
                  minutes and the next 25.
                </p>
              </div>

              <footer class="sheet-foot">
                <button onClick={() => (manageOpen.value = false)}>Close</button>
              </footer>
            </div>
          </div>
        </Portal>
      )}

      {viewersFor.value && (
        <Portal>
          <div class="backdrop" onClick={() => (viewersFor.value = null)} role="presentation">
            <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
              <header class="sheet-head">Viewers</header>

              <div class="sheet-body">
                {viewers.value.map((viewer) => (
                  <div class="viewer-row" key={viewer.peerId}>
                    <Avatar peerId={viewer.peerId} title={viewer.title} size={32} />
                    <span class="name">{viewer.title}</span>
                    {viewer.reaction && (
                      <span class="viewer-reaction">{viewer.reaction.emoticon || '❤️'}</span>
                    )}
                    <span class="meta">{dateLabel(viewer.date)}</span>
                  </div>
                ))}
                {!viewers.value.length && !viewersLoading.value && (
                  <p class="hint">Nobody has watched this story yet.</p>
                )}

                {viewersLoading.value ?
                  <p class="hint">Loading…</p> :
                  viewersOffset.value ?
                    <button class="chip" onClick={moreViewers}>Load more</button> :
                    null}
              </div>

              <footer class="sheet-foot">
                <button onClick={() => (viewersFor.value = null)}>Close</button>
              </footer>
            </div>
          </div>
        </Portal>
      )}

      {audienceFor.value && (
        <Portal>
          <div class="backdrop" onClick={() => (audienceFor.value = null)} role="presentation">
            <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
              <header class="sheet-head">Who can see this story</header>

              <div class="sheet-body">
                <fieldset>
                  {AUDIENCES.map((option) => (
                    <label class="option" key={option.value}>
                      <input
                        type="radio"
                        value={option.value}
                        checked={editAudience.value === option.value}
                        onChange={() => (editAudience.value = option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>

                {editAudience.value === 'selected' && (
                  <div class="contacts">
                    {contacts.value.map((contact) => (
                      <button
                        class={['contact', editPicked.value.includes(contact.peerId) && 'picked'].filter(Boolean).join(' ')}
                        key={contact.peerId}
                        onClick={() => toggleEditPicked(contact.peerId)}
                      >
                        <Avatar peerId={contact.peerId} title={contact.title} size={28} />
                        <span class="name">{contact.title}</span>
                        <span class="check">{editPicked.value.includes(contact.peerId) ? '✓' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <footer class="sheet-foot">
                <button onClick={() => (audienceFor.value = null)}>Cancel</button>
                <button class="primary" onClick={saveAudience} disabled={savingAudience.value}>Save</button>
              </footer>
            </div>
          </div>
        </Portal>
      )}

      {closeFriendsOpen.value && (
        <Portal>
          <div class="backdrop" onClick={() => (closeFriendsOpen.value = false)} role="presentation">
            <div class="sheet" onClick={(e) => e.stopPropagation()} role="presentation">
              <header class="sheet-head">Close friends</header>

              <div class="sheet-body">
                <div class="contacts">
                  {contacts.value.map((contact) => (
                    <button
                      class={['contact', closeFriendIds.value.includes(contact.peerId) && 'picked'].filter(Boolean).join(' ')}
                      key={contact.peerId}
                      onClick={() => toggleCloseFriend(contact.peerId)}
                    >
                      <Avatar peerId={contact.peerId} title={contact.title} size={28} />
                      <span class="name">{contact.title}</span>
                      <span class="check">{closeFriendIds.value.includes(contact.peerId) ? '✓' : ''}</span>
                    </button>
                  ))}
                  {!contacts.value.length && (
                    <p class="hint">No contacts yet.</p>
                  )}
                </div>
              </div>

              <footer class="sheet-foot">
                <button onClick={() => (closeFriendsOpen.value = false)}>Cancel</button>
                <button class="primary" onClick={saveFriends} disabled={savingFriends.value}>Save</button>
              </footer>
            </div>
          </div>
        </Portal>
      )}

      {sharing.value && (
        <PeerPicker
          title="Share story"
          dialogs={dialogs}
          selectedIds={shareTargets.value}
          onpick={toggleShareTarget}
          onconfirm={() => share([...shareTargets.value])}
          confirmLabel={shareTargets.value.length > 1 ? `Send to ${shareTargets.value.length}` : 'Send'}
          onclose={() => {
            sharing.value = null;
            shareTargets.value = [];
          }}
        />
      )}

      {!!toast.value && (
        <Portal>
          <div class="toast">{toast.value}</div>
        </Portal>
      )}
    </>
  );
}
