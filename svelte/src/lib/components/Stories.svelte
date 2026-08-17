<script lang="ts">
  import {untrack} from 'svelte';

  import Avatar from './Avatar.svelte';
  import PeerPicker from './PeerPicker.svelte';
  import ReactionSticker from './ReactionSticker.svelte';
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

  let {dialogs = []}: {dialogs?: DialogItem[]} = $props();

  let feed = $state<StoryPeer[]>([]);
  let mine = $state<StoryItem[]>([]);
  let selfId = $state(0);
  let openPeer = $state<StoryPeer | null>(null);
  let stories = $state<StoryItem[]>([]);
  let index = $state(0);
  let url = $state<string | null>(null);
  /** 0–1 fill of the current segment; drives both the bar and auto-advance. */
  let progress = $state(0);
  let paused = $state(false);
  let video = $state<HTMLVideoElement | null>(null);

  const current = $derived(stories[index] ?? null);

  const AUDIENCES: Array<{value: StoryAudience; label: string}> = [
    {value: 'everyone', label: 'Everyone'},
    {value: 'contacts', label: 'Contacts'},
    {value: 'close', label: 'Close friends'},
    {value: 'selected', label: 'Selected contacts'}
  ];

  const audienceLabel = (value: StoryAudience) =>
    AUDIENCES.find((a) => a.value === value)?.label ?? '';

  /* ---------------- overlays on top of the viewer ---------------- */

  let composerOpen = $state(false);
  let manageOpen = $state(false);
  let closeFriendsOpen = $state(false);
  let viewersFor = $state<StoryItem | null>(null);
  let sharing = $state<StoryItem | null>(null);
  let audienceFor = $state<StoryItem | null>(null);
  let toast = $state('');

  const overlayOpen = $derived(
    composerOpen || manageOpen || closeFriendsOpen || !!viewersFor || !!sharing || !!audienceFor
  );

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function say(message: string) {
    toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 2600);
  }

  const MUTED_KEY = 'webs:stories-muted';
  /** Sound is on unless it was turned off before; the choice sticks. */
  let muted = $state(localStorage.getItem(MUTED_KEY) === '1');

  function toggleMuted() {
    muted = !muted;
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  }

  /**
   * Opening a story is a click, so unmuted autoplay is normally allowed — but
   * a browser that still blocks it rejects play() and would otherwise leave a
   * frozen frame. Fall back to muted rather than to nothing.
   */
  function startPlayback() {
    const el = video;
    el?.play().catch(() => {
      if (el !== video || el.muted) return;
      muted = true;
      el.play().catch(() => {});
    });
  }

  /** Photos get a fixed run; videos play for their own duration. */
  const PHOTO_SECONDS = 5;

  /**
   * The strip lives in the sidebar, and the sidebar is a `backdrop-filter`
   * pane: that makes it the containing block for `position: fixed`, so the
   * viewer would cover the chat list only. Move it to the body instead.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  let frame: number | undefined;
  let startedAt = 0;
  let elapsedBeforePause = 0;

  $effect(() => {
    loadStoriesFeed().then((loaded) => (feed = loaded));
    loadMyActiveStories().then((loaded) => (mine = loaded));
    selfPeerId().then((id) => (selfId = id));
    activeReactions().then((list) => (reactionChoices = list.slice(0, 8)));
  });

  // Resolve the media for whichever story is on screen.
  $effect(() => {
    const peer = openPeer;
    const story = stories[index];
    if (!peer || !story) return;

    url = null;
    loadStoryUrl(peer.peerId, story.id).then((resolved) => {
      if (openPeer?.peerId === peer.peerId && stories[index]?.id === story.id) url = resolved;
    });
  });

  /**
   * Runs the current story to completion, then advances. Uses rAF rather than a
   * timeout so the bar animates and a pause can resume mid-story.
   */
  function play() {
    stop();
    const story = stories[index];
    if (!story || !url) return;

    const seconds = story.isVideo && story.duration ? story.duration : PHOTO_SECONDS;
    startedAt = performance.now() - elapsedBeforePause;

    const tick = () => {
      if (paused) return;
      const elapsed = performance.now() - startedAt;
      progress = Math.min(1, elapsed / (seconds * 1000));

      if (progress >= 1) {
        elapsedBeforePause = 0;
        step(1);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
  }

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function pause() {
    if (!openPeer || paused) return;
    paused = true;
    elapsedBeforePause = performance.now() - startedAt;
    stop();
    video?.pause();
  }

  function resume() {
    if (!openPeer || !paused || overlayOpen || replying) return;
    paused = false;
    play();
    startPlayback();
  }

  // Restart the timer whenever the story or its media changes.
  $effect(() => {
    if (!openPeer || !url) return;
    void index;
    progress = 0;
    elapsedBeforePause = 0;
    paused = false;
    play();
    return stop;
  });

  // A sheet on top of the viewer must not let the story run out behind it.
  // Only the overlay flag is tracked: `pause`/`resume` touch `paused`, and
  // tracking that too would make this effect undo a press-and-hold pause the
  // moment the pointer went down.
  $effect(() => {
    const blocked = overlayOpen;
    untrack(() => (blocked ? pause() : resume()));
  });

  // A backgrounded tab should not burn through someone's stories.
  $effect(() => {
    const onVisibility = () => (document.hidden ? pause() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  async function open(peer: StoryPeer) {
    openPeer = peer;
    index = 0;
    stories = await loadStories(peer.peerId, peer.storyIds);
    if (!stories.length) return;

    if (peer.peerId !== selfId) {
      await markStoriesRead(peer.peerId, stories[stories.length - 1].id);
      feed = feed.map((p) => (p.peerId === peer.peerId ? {...p, unread: false} : p));
    }
  }

  function openMine() {
    if (!mine.length) {
      composerOpen = true;
      return;
    }

    open({
      peerId: selfId,
      title: 'Your story',
      unread: false,
      storyIds: mine.map((story) => story.id)
    });
  }

  function close() {
    stop();
    openPeer = null;
    stories = [];
    url = null;
    progress = 0;
    replyText = '';
    replying = false;
  }

  function step(delta: number) {
    const next = index + delta;
    if (next < 0 || next >= stories.length) close();
    else {
      elapsedBeforePause = 0;
      index = next;
    }
  }

  // Somebody else's story counts as a view the moment it is on screen.
  $effect(() => {
    const story = current;
    if (!story || story.mine) return;
    countStoryView(story.peerId, story.id);
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (composerOpen) composerOpen = false;
      else if (closeFriendsOpen) closeFriendsOpen = false;
      else if (audienceFor) audienceFor = null;
      else if (viewersFor) viewersFor = null;
      else if (sharing) sharing = null;
      else if (manageOpen) manageOpen = false;
      else if (openPeer) close();
      return;
    }

    if (!openPeer || overlayOpen || replying) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }

  /* ---------------- reply and react ---------------- */

  let replyText = $state('');
  let replying = $state(false);
  let reactionChoices = $state<ReactionOption[]>([]);

  async function sendReply() {
    const story = current;
    const text = replyText.trim();
    if (!story || !text) return;

    replyText = '';
    await replyToStory(story.peerId, story.id, text);
    say('Reply sent');
  }

  async function react(option: ReactionOption) {
    const story = current;
    if (!story) return;

    const already = story.sentReaction?.key === option.key;
    const next = already ? null : {kind: option.kind, emoticon: option.emoticon, docId: option.docId, key: option.key};
    // Plain object, not the $state proxy: this crosses into the worker.
    await reactToStory(story.peerId, story.id, next);
    stories = stories.map((item, i) => (i === index ? {...item, sentReaction: next} : item));
  }

  async function copyLink(story: StoryItem) {
    const link = await storyLink(story.peerId, story.id);
    if (!link) {
      say('This story has no public link');
      return;
    }

    say((await copyText(link)) ? 'Link copied' : link);
  }

  async function share(targets: number[]) {
    const story = sharing;
    if (!story || !targets.length) return;

    sharing = null;
    shareTargets = [];
    await shareStoryTo(story.peerId, story.id, targets);
    say(targets.length > 1 ? `Shared to ${targets.length} chats` : 'Shared');
  }

  let shareTargets = $state<number[]>([]);

  function toggleShareTarget(peerId: number) {
    shareTargets = shareTargets.includes(peerId)
      ? shareTargets.filter((id) => id !== peerId)
      : [...shareTargets, peerId];
  }

  /* ---------------- viewers list ---------------- */

  let viewers = $state<StoryViewer[]>([]);
  let viewersOffset = $state('');
  let viewersLoading = $state(false);

  async function openViewers(story: StoryItem) {
    viewersFor = story;
    viewers = [];
    viewersOffset = '';
    await moreViewers();
  }

  async function moreViewers() {
    const story = viewersFor;
    if (!story || viewersLoading) return;

    viewersLoading = true;
    const page = await loadStoryViewers(story.peerId, story.id, viewersOffset);
    if (viewersFor?.id === story.id) {
      viewers = [...viewers, ...page.viewers];
      viewersOffset = page.nextOffset;
    }
    viewersLoading = false;
  }

  /* ---------------- composer ---------------- */

  let file = $state<File | null>(null);
  let filePreview = $state('');
  let caption = $state('');
  let audience = $state<StoryAudience>('everyone');
  let period = $state(DEFAULT_STORY_PERIOD);
  let keepOnProfile = $state(false);
  let picked = $state<number[]>([]);
  let posting = $state(false);
  let composerError = $state('');

  let contacts = $state<StoryContact[]>([]);
  let contactsLoaded = $state(false);

  async function ensureContacts() {
    if (contactsLoaded) return;
    contacts = await loadContacts();
    contactsLoaded = true;
  }

  $effect(() => {
    if (audience === 'selected' || closeFriendsOpen) ensureContacts();
  });

  function chooseFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    if (!chosen) return;

    if (filePreview) URL.revokeObjectURL(filePreview);
    // A File is a host object, not a plain one, so it is not proxied by $state
    // and stays structured-cloneable on the way to the worker.
    file = chosen;
    filePreview = URL.createObjectURL(chosen);
    composerError = '';
  }

  function closeComposer() {
    composerOpen = false;
    if (filePreview) URL.revokeObjectURL(filePreview);
    filePreview = '';
    file = null;
    caption = '';
    picked = [];
    composerError = '';
  }

  async function post() {
    if (!file || posting) return;

    posting = true;
    composerError = '';

    try {
      await postStory({
        file,
        caption,
        audience,
        allowUserIds: [...picked],
        period,
        pinned: keepOnProfile
      });

      closeComposer();
      mine = await loadMyActiveStories();
      say('Story posted');
    } catch (err: any) {
      composerError = err?.type || err?.message || 'Could not post the story';
    } finally {
      posting = false;
    }
  }

  function togglePicked(peerId: number) {
    picked = picked.includes(peerId) ? picked.filter((id) => id !== peerId) : [...picked, peerId];
  }

  /* ---------------- my stories management ---------------- */

  let manageTab = $state<MyStoriesKind>('profile');
  let managed = $state<StoryItem[]>([]);
  let managedCount = $state(0);
  let managedLoading = $state(false);
  let stealth = $state<StealthMode>({activeUntil: 0, cooldownUntil: 0});

  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const stealthActive = $derived(stealth.activeUntil > nowSeconds());
  const stealthCooling = $derived(!stealthActive && stealth.cooldownUntil > nowSeconds());

  $effect(() => {
    if (!manageOpen) return;
    const tab = manageTab;

    managedLoading = true;
    loadMyStories(tab).then((page) => {
      if (!manageOpen || manageTab !== tab) return;
      managed = page.stories;
      managedCount = page.count;
      managedLoading = false;
    });
  });

  $effect(() => {
    if (manageOpen) loadStealthMode().then((mode) => (stealth = mode));
  });

  async function reloadManaged() {
    const page = await loadMyStories(manageTab);
    managed = page.stories;
    managedCount = page.count;
    mine = await loadMyActiveStories();
  }

  async function togglePin(story: StoryItem) {
    const pinned = !story.pinned;
    await setStoryPinned(story.peerId, story.id, pinned);
    // The viewer holds its own copy of the story, so the chip would keep the
    // old label until the story was reopened.
    stories = stories.map((item) => (item.id === story.id ? {...item, pinned} : item));
    await reloadManaged();
    say(pinned ? 'Kept on profile' : 'Removed from profile');
  }

  async function remove(story: StoryItem) {
    await deleteStory(story.peerId, story.id);
    stories = stories.filter((item) => item.id !== story.id);
    if (!stories.length && openPeer) close();
    await reloadManaged();
    say('Story deleted');
  }

  async function turnOnStealth() {
    await activateStealthMode();
    stealth = await loadStealthMode();
    say('Stealth mode on');
  }

  /* ---------------- audience editing ---------------- */

  let editAudience = $state<StoryAudience>('everyone');
  let editPicked = $state<number[]>([]);
  let savingAudience = $state(false);

  function openAudience(story: StoryItem) {
    audienceFor = story;
    editAudience = story.audience;
    editPicked = [];
    ensureContacts();
  }

  function toggleEditPicked(peerId: number) {
    editPicked = editPicked.includes(peerId)
      ? editPicked.filter((id) => id !== peerId)
      : [...editPicked, peerId];
  }

  async function saveAudience() {
    const story = audienceFor;
    if (!story || savingAudience) return;

    savingAudience = true;
    try {
      await setStoryAudience(story.peerId, story.id, editAudience, [...editPicked]);
      stories = stories.map((item) =>
        item.id === story.id ? {...item, audience: editAudience} : item
      );
      managed = managed.map((item) =>
        item.id === story.id ? {...item, audience: editAudience} : item
      );
      audienceFor = null;
      say('Audience updated');
    } catch (err: any) {
      say(err?.type || 'Could not change the audience');
    } finally {
      savingAudience = false;
    }
  }

  /* ---------------- close friends ---------------- */

  let closeFriendIds = $state<number[]>([]);
  let savingFriends = $state(false);

  function openCloseFriends() {
    closeFriendsOpen = true;
    ensureContacts().then(() => {
      closeFriendIds = contacts.filter((c) => c.closeFriend).map((c) => c.peerId);
    });
  }

  function toggleCloseFriend(peerId: number) {
    closeFriendIds = closeFriendIds.includes(peerId)
      ? closeFriendIds.filter((id) => id !== peerId)
      : [...closeFriendIds, peerId];
  }

  async function saveFriends() {
    if (savingFriends) return;

    savingFriends = true;
    try {
      const ids = [...closeFriendIds];
      await saveCloseFriends(ids);
      contacts = contacts.map((c) => ({...c, closeFriend: ids.includes(c.peerId)}));
      closeFriendsOpen = false;
      say('Close friends saved');
    } catch (err: any) {
      say(err?.type || 'Could not save the list');
    } finally {
      savingFriends = false;
    }
  }

  const dateLabel = (seconds: number) =>
    seconds ? new Date(seconds * 1000).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : '';
</script>

<svelte:window onkeydown={onKey} />

<div class="strip">
  <button class="story add" onclick={() => (composerOpen = true)} title="Add a story">
    <span class="ring plus">+</span>
    <span class="name">Add story</span>
  </button>

  {#if mine.length}
    <button class="story" onclick={openMine} title="Your story">
      <span class="ring own">
        <Avatar peerId={selfId} title="You" size={52} />
      </span>
      <span class="name">Your story</span>
    </button>
  {/if}

  <button class="story" onclick={() => (manageOpen = true)} title="My stories, stealth mode, close friends">
    <span class="ring plus">⋯</span>
    <span class="name">Manage</span>
  </button>

  {#each feed as peer (peer.peerId)}
    <button class="story" onclick={() => open(peer)}>
      <span class="ring" class:unread={peer.unread}>
        <Avatar peerId={peer.peerId} title={peer.title} size={52} />
      </span>
      <span class="name">{peer.title}</span>
    </button>
  {/each}
</div>

{#if openPeer}
  <div class="viewer" use:portal onclick={close} role="presentation">
    <div
      class="stage"
      onclick={(e) => e.stopPropagation()}
      onpointerdown={pause}
      onpointerup={resume}
      onpointercancel={resume}
      role="presentation"
    >
      <div class="progress">
        {#each stories as _, i}
          <span class="segment">
            <span
              class="fill"
              style="transform: scaleX({i < index ? 1 : i === index ? progress : 0})"
            ></span>
          </span>
        {/each}
      </div>

      <header>
        <Avatar peerId={openPeer.peerId} title={openPeer.title} size={32} />
        <span>{openPeer.title}</span>
        {#if stories[index]?.isVideo}
          <button
            class="sound"
            onclick={toggleMuted}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >{muted ? '🔇' : '🔊'}</button>
        {/if}
        <button class="close" onclick={close} aria-label="Close">✕</button>
      </header>

      {#if !url}
        <p class="muted">Loading…</p>
      {:else if stories[index]?.isVideo}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          bind:this={video}
          src={url}
          autoplay
          playsinline
          {muted}
          oncanplay={startPlayback}
          onended={() => step(1)}
        ></video>
      {:else}
        <img src={url} alt="" />
      {/if}

      <div class="foot">
        {#if stories[index]?.caption}
          <p class="caption">{stories[index].caption}</p>
        {/if}

        {#if current}
          {#if current.mine}
            <div class="owner-bar">
              <button class="chip" onclick={() => openViewers(current)}>
                👁 {current.viewsCount}{current.reactionsCount ? ` · ❤️ ${current.reactionsCount}` : ''}
              </button>
              <button class="chip" onclick={() => openAudience(current)}>
                {audienceLabel(current.audience)}
              </button>
              <button class="chip" onclick={() => togglePin(current)}>
                {current.pinned ? 'Unpin' : 'Pin to profile'}
              </button>
              <button class="chip" onclick={() => copyLink(current)}>Copy link</button>
              <button class="chip" onclick={() => (sharing = current)}>Share</button>
              <button class="chip danger" onclick={() => remove(current)}>Delete</button>
            </div>
          {:else}
            <div class="reactions">
              {#each reactionChoices as option (option.key)}
                <button
                  class="reaction"
                  class:picked={current.sentReaction?.key === option.key}
                  onclick={() => react(option)}
                  aria-label={option.title}
                >
                  <ReactionSticker docId={option.iconDocId} fallback={option.emoticon} size={26} />
                </button>
              {/each}
            </div>

            <div class="reply-bar">
              <input
                placeholder="Reply to story"
                bind:value={replyText}
                onfocus={() => {
                  replying = true;
                  pause();
                }}
                onblur={() => {
                  replying = false;
                  resume();
                }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') sendReply();
                }}
              />
              <button class="chip" onclick={sendReply} disabled={!replyText.trim()}>Send</button>
              <button class="chip" onclick={() => (sharing = current)}>Share</button>
              <button class="chip" onclick={() => copyLink(current)}>Link</button>
            </div>
          {/if}
        {/if}
      </div>

      <button class="nav prev" onclick={() => step(-1)} aria-label="Previous">‹</button>
      <button class="nav next" onclick={() => step(1)} aria-label="Next">›</button>
    </div>
  </div>
{/if}

{#if composerOpen}
  <div class="backdrop" use:portal onclick={closeComposer} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
      <header class="sheet-head">Post a story</header>

      <div class="sheet-body">
        <label class="file">
          <input type="file" accept="image/*,video/*" onchange={chooseFile} />
          <span>{file ? file.name : 'Choose a photo or video'}</span>
        </label>

        {#if filePreview}
          {#if file?.type.startsWith('video/')}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video class="preview" src={filePreview} controls playsinline></video>
          {:else}
            <img class="preview" src={filePreview} alt="" />
          {/if}
        {/if}

        <input class="caption-input" placeholder="Caption (optional)" bind:value={caption} />

        <fieldset>
          <legend>Who can see it</legend>
          {#each AUDIENCES as option (option.value)}
            <label class="option">
              <input type="radio" value={option.value} bind:group={audience} />
              <span>{option.label}</span>
            </label>
          {/each}
        </fieldset>

        {#if audience === 'selected'}
          <div class="contacts">
            {#each contacts as contact (contact.peerId)}
              <button
                class="contact"
                class:picked={picked.includes(contact.peerId)}
                onclick={() => togglePicked(contact.peerId)}
              >
                <Avatar peerId={contact.peerId} title={contact.title} size={28} />
                <span class="name">{contact.title}</span>
                <span class="check">{picked.includes(contact.peerId) ? '✓' : ''}</span>
              </button>
            {:else}
              <p class="hint">No contacts yet.</p>
            {/each}
          </div>
        {/if}

        <label class="row">
          <span>Keep up for</span>
          <select bind:value={period}>
            {#each STORY_PERIODS as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label class="option">
          <input type="checkbox" bind:checked={keepOnProfile} />
          <span>Keep on my profile after it expires</span>
        </label>

        {#if composerError}
          <p class="error">{composerError}</p>
        {/if}
      </div>

      <footer class="sheet-foot">
        <button onclick={closeComposer}>Cancel</button>
        <button class="primary" onclick={post} disabled={!file || posting}>
          {posting ? 'Posting…' : 'Post'}
        </button>
      </footer>
    </div>
  </div>
{/if}

{#if manageOpen}
  <div class="backdrop" use:portal onclick={() => (manageOpen = false)} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
      <header class="sheet-head">My stories</header>

      <div class="tabs">
        <button class:active={manageTab === 'profile'} onclick={() => (manageTab = 'profile')}>
          On profile
        </button>
        <button class:active={manageTab === 'archive'} onclick={() => (manageTab = 'archive')}>
          Archive
        </button>
      </div>

      <div class="sheet-body">
        {#if managedLoading}
          <p class="hint">Loading…</p>
        {:else if !managed.length}
          <p class="hint">
            {manageTab === 'profile'
              ? 'No stories kept on your profile.'
              : 'Your expired stories will show up here.'}
          </p>
        {:else}
          <p class="hint">{managedCount} {managedCount === 1 ? 'story' : 'stories'}</p>
          {#each managed as story (story.id)}
            <div class="managed">
              <div class="managed-info">
                <strong>{story.caption || (story.isVideo ? 'Video story' : 'Photo story')}</strong>
                <span class="meta">
                  {dateLabel(story.date)} · 👁 {story.viewsCount} · {audienceLabel(story.audience)}
                </span>
              </div>
              <div class="managed-actions">
                <button class="chip" onclick={() => openViewers(story)}>Viewers</button>
                <button class="chip" onclick={() => openAudience(story)}>Audience</button>
                <button class="chip" onclick={() => togglePin(story)}>
                  {story.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button class="chip danger" onclick={() => remove(story)}>Delete</button>
              </div>
            </div>
          {/each}
        {/if}

        <div class="tools">
          <button class="chip" onclick={openCloseFriends}>Edit close friends</button>
          <button class="chip" onclick={turnOnStealth} disabled={stealthActive || stealthCooling}>
            {#if stealthActive}
              Stealth mode is on
            {:else if stealthCooling}
              Stealth mode cooling down
            {:else}
              Turn on stealth mode
            {/if}
          </button>
        </div>
        <p class="hint">
          Stealth mode hides you from the viewer lists of the stories you watch, for the last 5
          minutes and the next 25.
        </p>
      </div>

      <footer class="sheet-foot">
        <button onclick={() => (manageOpen = false)}>Close</button>
      </footer>
    </div>
  </div>
{/if}

{#if viewersFor}
  <div class="backdrop" use:portal onclick={() => (viewersFor = null)} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
      <header class="sheet-head">Viewers</header>

      <div class="sheet-body">
        {#each viewers as viewer (viewer.peerId)}
          <div class="viewer-row">
            <Avatar peerId={viewer.peerId} title={viewer.title} size={32} />
            <span class="name">{viewer.title}</span>
            {#if viewer.reaction}
              <span class="viewer-reaction">{viewer.reaction.emoticon || '❤️'}</span>
            {/if}
            <span class="meta">{dateLabel(viewer.date)}</span>
          </div>
        {:else}
          {#if !viewersLoading}
            <p class="hint">Nobody has watched this story yet.</p>
          {/if}
        {/each}

        {#if viewersLoading}
          <p class="hint">Loading…</p>
        {:else if viewersOffset}
          <button class="chip" onclick={moreViewers}>Load more</button>
        {/if}
      </div>

      <footer class="sheet-foot">
        <button onclick={() => (viewersFor = null)}>Close</button>
      </footer>
    </div>
  </div>
{/if}

{#if audienceFor}
  <div class="backdrop" use:portal onclick={() => (audienceFor = null)} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
      <header class="sheet-head">Who can see this story</header>

      <div class="sheet-body">
        <fieldset>
          {#each AUDIENCES as option (option.value)}
            <label class="option">
              <input type="radio" value={option.value} bind:group={editAudience} />
              <span>{option.label}</span>
            </label>
          {/each}
        </fieldset>

        {#if editAudience === 'selected'}
          <div class="contacts">
            {#each contacts as contact (contact.peerId)}
              <button
                class="contact"
                class:picked={editPicked.includes(contact.peerId)}
                onclick={() => toggleEditPicked(contact.peerId)}
              >
                <Avatar peerId={contact.peerId} title={contact.title} size={28} />
                <span class="name">{contact.title}</span>
                <span class="check">{editPicked.includes(contact.peerId) ? '✓' : ''}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <footer class="sheet-foot">
        <button onclick={() => (audienceFor = null)}>Cancel</button>
        <button class="primary" onclick={saveAudience} disabled={savingAudience}>Save</button>
      </footer>
    </div>
  </div>
{/if}

{#if closeFriendsOpen}
  <div class="backdrop" use:portal onclick={() => (closeFriendsOpen = false)} role="presentation">
    <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
      <header class="sheet-head">Close friends</header>

      <div class="sheet-body">
        <div class="contacts">
          {#each contacts as contact (contact.peerId)}
            <button
              class="contact"
              class:picked={closeFriendIds.includes(contact.peerId)}
              onclick={() => toggleCloseFriend(contact.peerId)}
            >
              <Avatar peerId={contact.peerId} title={contact.title} size={28} />
              <span class="name">{contact.title}</span>
              <span class="check">{closeFriendIds.includes(contact.peerId) ? '✓' : ''}</span>
            </button>
          {:else}
            <p class="hint">No contacts yet.</p>
          {/each}
        </div>
      </div>

      <footer class="sheet-foot">
        <button onclick={() => (closeFriendsOpen = false)}>Cancel</button>
        <button class="primary" onclick={saveFriends} disabled={savingFriends}>Save</button>
      </footer>
    </div>
  </div>
{/if}

{#if sharing}
  <PeerPicker
    title="Share story"
    {dialogs}
    selectedIds={shareTargets}
    onpick={toggleShareTarget}
    onconfirm={() => share([...shareTargets])}
    confirmLabel={shareTargets.length > 1 ? `Send to ${shareTargets.length}` : 'Send'}
    onclose={() => {
      sharing = null;
      shareTargets = [];
    }}
  />
{/if}

{#if toast}
  <div class="toast" use:portal>{toast}</div>
{/if}

<style>
  .strip {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .story {
    display: grid;
    justify-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    width: 68px;
    flex: none;
  }

  .ring {
    padding: 2px;
    border-radius: 50%;
    border: 2px solid transparent;
    display: block;
  }

  .ring.unread {
    border-color: var(--accent);
  }

  .ring.own {
    border-color: var(--border);
  }

  .ring.plus {
    width: 52px;
    height: 52px;
    line-height: 52px;
    text-align: center;
    font-size: 22px;
    border-color: var(--border);
    color: var(--text-dim);
  }

  .name {
    font-size: 11px;
    color: var(--text-dim);
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .viewer {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    display: grid;
    place-items: center;
    z-index: 98;
  }

  .stage {
    position: relative;
    width: min(420px, calc(100vw - 24px));
    height: min(760px, calc(100vh - 40px));
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 8px;
    padding: 10px;
  }

  .progress {
    display: flex;
    gap: 4px;
  }

  .segment {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.25);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: #fff;
    transform-origin: left;
    will-change: transform;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fff;
    font-size: 14px;
  }

  header span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header .sound,
  header .close {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 16px;
    flex: none;
  }

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    min-height: 0;
  }

  .foot {
    display: grid;
    gap: 6px;
  }

  .caption {
    margin: 0;
    color: #fff;
    font-size: 14px;
  }

  .reactions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .reaction {
    background: rgba(255, 255, 255, 0.12);
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .reaction.picked {
    background: var(--accent);
  }

  .reply-bar {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .reply-bar input {
    flex: 1;
    min-width: 0;
    border-radius: 16px;
    border: none;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  .owner-bar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .chip {
    background: rgba(255, 255, 255, 0.14);
    border: none;
    border-radius: 14px;
    padding: 6px 10px;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .chip.danger {
    color: #ff8080;
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .owner-bar .chip,
  .reply-bar .chip {
    color: #fff;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 22px;
    cursor: pointer;
  }

  .prev {
    left: -50px;
  }

  .next {
    right: -50px;
  }

  .muted {
    color: rgba(255, 255, 255, 0.7);
    align-self: center;
    justify-self: center;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 99;
  }

  .sheet {
    width: min(420px, calc(100vw - 24px));
    max-height: calc(100vh - 60px);
    display: flex;
    flex-direction: column;
    background: var(--panel, #1e1e1e);
    color: var(--text, #fff);
    border-radius: 12px;
    overflow: hidden;
  }

  .sheet-head {
    padding: 12px 14px;
    font-weight: 600;
    border-bottom: 1px solid var(--border);
  }

  .sheet-body {
    padding: 12px 14px;
    overflow-y: auto;
    display: grid;
    gap: 10px;
  }

  .sheet-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .sheet-foot button {
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .sheet-foot .primary {
    background: var(--accent);
    color: #fff;
  }

  .sheet-foot button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .tabs {
    display: flex;
    gap: 6px;
    padding: 8px 14px 0;
  }

  .tabs button {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text-dim);
    padding: 6px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }

  .tabs .active {
    color: inherit;
    border-bottom-color: var(--accent);
  }

  .file {
    display: block;
    cursor: pointer;
  }

  .file input {
    display: none;
  }

  .file span {
    display: block;
    padding: 10px;
    border: 1px dashed var(--border);
    border-radius: 8px;
    text-align: center;
    font-size: 13px;
    color: var(--text-dim);
  }

  .preview {
    width: 100%;
    max-height: 240px;
    object-fit: contain;
    border-radius: 8px;
    background: #000;
  }

  .caption-input {
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    padding: 8px 10px;
  }

  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }

  legend {
    font-size: 12px;
    color: var(--text-dim);
    padding: 0 0 4px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }

  .contacts {
    max-height: 200px;
    overflow-y: auto;
    display: grid;
    gap: 2px;
  }

  .contact {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    color: inherit;
    padding: 5px 4px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }

  .contact.picked {
    background: rgba(255, 255, 255, 0.08);
  }

  .contact .name {
    flex: 1;
    min-width: 0;
    max-width: none;
    font-size: 13px;
    color: inherit;
  }

  .check {
    color: var(--accent);
  }

  .viewer-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .viewer-row .name {
    flex: 1;
    min-width: 0;
    max-width: none;
    font-size: 13px;
    color: inherit;
  }

  .viewer-reaction {
    font-size: 15px;
  }

  .managed {
    display: grid;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .managed-info {
    display: grid;
    gap: 2px;
    font-size: 13px;
  }

  .managed-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .meta,
  .hint {
    font-size: 12px;
    color: var(--text-dim);
    margin: 0;
  }

  .tools {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 6px;
  }

  .error {
    color: #ff8080;
    font-size: 12px;
    margin: 0;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 8px 14px;
    border-radius: 16px;
    font-size: 13px;
    z-index: 120;
  }

  @media (max-width: 860px) {
    .prev {
      left: 4px;
    }

    .next {
      right: 4px;
    }
  }
</style>
