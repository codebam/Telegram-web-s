<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Glyph from './Glyph.svelte';
  import Lightbox from './Lightbox.svelte';
  import PeerPicker from './PeerPicker.svelte';
  import ChatAdmin from './ChatAdmin.svelte';
  import {loadAdminAccess} from '$lib/telegram/admin';
  import {
    checkChatUsername,
    loadDialogs,
    loadMediaUrl,
    saveMediaToDisk,
    setChatUsername,
    type DialogItem,
    type MessageItem
  } from '$lib/telegram/chats';
  import {enqueueLoad} from '$lib/telegram/loadQueue';
  import {
    addContact,
    addPeerToFolder,
    copyText,
    deleteContact,
    forgetPeer,
    linksOf,
    loadCommonGroups,
    loadFoldersForPeer,
    loadMembers,
    loadProfile,
    loadSharedMedia,
    loadSimilarChannels,
    paintPeerQr,
    removePeerFromFolder,
    setBlocked,
    setMuted,
    shareContact,
    startReport,
    submitReport,
    type PeerChip,
    type ProfileFolder,
    type ProfileInfo,
    type ProfileMember,
    type ReportStep,
    type SharedTab
  } from '$lib/telegram/profile';

  let {
    peerId,
    onclose,
    onmessage,
    onpeer,
    onmigrated,
    onjump
  }: {
    peerId: number;
    onclose: () => void;
    /** Open a direct chat with this peer. */
    onmessage?: (peerId: number) => void;
    /** Drill into another profile, e.g. a member of this group. */
    onpeer?: (peerId: number) => void;
    /** This chat became a supergroup and lives under a new peer id. */
    onmigrated?: (peerId: number) => void;
    /** Scroll the open chat to a message found in the shared-media tabs. */
    onjump?: (mid: number) => void;
  } = $props();

  type TabId = SharedTab | 'members' | 'common' | 'similar';

  type SharedState = {
    items: MessageItem[];
    nextOffsetId: number;
    isEnd: boolean;
    loading: boolean;
    loaded: boolean;
  };

  const SHARED_TABS: {id: SharedTab; label: string}[] = [
    {id: 'media', label: 'Media'},
    {id: 'files', label: 'Files'},
    {id: 'links', label: 'Links'},
    {id: 'music', label: 'Music'},
    {id: 'voice', label: 'Voice'},
    {id: 'gifs', label: 'GIFs'}
  ];

  function emptyShared(): Record<SharedTab, SharedState> {
    const blank = () => ({items: [], nextOffsetId: 0, isEnd: false, loading: false, loaded: false});
    return {
      media: blank(),
      files: blank(),
      links: blank(),
      music: blank(),
      voice: blank(),
      gifs: blank()
    };
  }

  let info = $state<ProfileInfo | null>(null);
  let error = $state('');

  let tab = $state<TabId>('media');
  let shared = $state<Record<SharedTab, SharedState>>(emptyShared());
  let thumbs = $state<Record<number, string>>({});

  let members = $state<ProfileMember[]>([]);
  let membersLoaded = $state(false);
  let membersEnd = $state(false);
  let membersBusy = $state(false);

  let commonGroups = $state<PeerChip[]>([]);
  let similarChannels = $state<PeerChip[]>([]);
  let chipsLoaded = $state<Record<string, boolean>>({});

  let lightboxItems = $state<MessageItem[]>([]);
  let lightboxIndex = $state<number | null>(null);

  let playingMid = $state(0);
  let playingUrl = $state('');

  let busy = $state('');
  let notice = $state('');

  let folders = $state<ProfileFolder[]>([]);
  let foldersOpen = $state(false);

  let report = $state<ReportStep | null>(null);
  let reportComment = $state('');
  let reportOptionId = $state(0);

  let qrOpen = $state(false);
  let qrHost = $state<HTMLElement | null>(null);

  let sharePickerOpen = $state(false);
  let shareDialogs = $state<DialogItem[]>([]);

  let contactFormOpen = $state(false);
  let contactFirst = $state('');
  let contactLast = $state('');

  let editingLink = $state(false);
  let link = $state('');
  let linkBusy = $state(false);
  let linkError = $state('');
  let linkFree = $state<boolean | null>(null);
  let linkTimer: ReturnType<typeof setTimeout> | undefined;

  // Whether this account may administer the chat, and the admin panel it opens.
  let canManage = $state(false);
  let managing = $state(false);

  $effect(() => {
    const id = peerId;
    canManage = false;
    managing = false;
    // Non-fatal: without it the profile simply has no "Manage" entry.
    loadAdminAccess(id)
      .then((access) => {
        if (id === peerId) canManage = access.canManage;
      })
      .catch(() => {});
  });

  const tabs = $derived.by((): {id: TabId; label: string}[] => {
    const list: {id: TabId; label: string}[] = [...SHARED_TABS];
    if (info && !info.isUser) list.push({id: 'members', label: 'Members'});
    if (info?.isUser && info.commonChatsCount > 0) list.push({id: 'common', label: 'Groups'});
    if (info?.isChannel) list.push({id: 'similar', label: 'Similar'});
    return list;
  });

  function resetForPeer() {
    info = null;
    error = '';
    tab = 'media';
    shared = emptyShared();
    thumbs = {};
    members = [];
    membersLoaded = false;
    membersEnd = false;
    commonGroups = [];
    similarChannels = [];
    chipsLoaded = {};
    lightboxIndex = null;
    playingMid = 0;
    playingUrl = '';
    busy = '';
    notice = '';
    folders = [];
    foldersOpen = false;
    report = null;
    qrOpen = false;
    sharePickerOpen = false;
    contactFormOpen = false;
    editingLink = false;
    linkError = '';
    linkFree = null;
  }

  $effect(() => {
    const id = peerId;
    resetForPeer();
    loadProfile(id)
      .then((loaded) => {
        if (id === peerId) info = loaded;
      })
      .catch((err) => (error = err?.type || err?.message || 'Failed to load info'));
  });

  // Reading the cached page inside the effect would make the effect depend on
  // what it writes, so the check happens after a microtask — outside tracking.
  $effect(() => {
    const id = peerId;
    const active = tab;
    void openTab(id, active);
  });

  async function openTab(id: number, active: TabId) {
    await Promise.resolve();
    if (id !== peerId || active !== tab) return;

    if (active === 'members') {
      if (!membersLoaded) await moreMembers();
      return;
    }

    if (active === 'common') {
      if (!chipsLoaded.common) {
        chipsLoaded = {...chipsLoaded, common: true};
        commonGroups = await loadCommonGroups(id);
      }
      return;
    }

    if (active === 'similar') {
      if (!chipsLoaded.similar) {
        chipsLoaded = {...chipsLoaded, similar: true};
        similarChannels = await loadSimilarChannels(id);
      }
      return;
    }

    if (!shared[active].loaded) await moreShared(active);
  }

  async function moreShared(which: SharedTab) {
    const id = peerId;
    const page = shared[which];
    if (page.loading || page.isEnd) return;

    shared[which] = {...page, loading: true};
    try {
      const next = await loadSharedMedia(id, which, {offsetId: page.nextOffsetId || undefined});
      if (id !== peerId) return;

      const current = shared[which];
      const seen = new Set(current.items.map((item) => item.mid));
      shared[which] = {
        items: [...current.items, ...next.items.filter((item) => !seen.has(item.mid))],
        nextOffsetId: next.nextOffsetId,
        isEnd: next.isEnd || !next.nextOffsetId,
        loading: false,
        loaded: true
      };
    } catch (err: any) {
      shared[which] = {...shared[which], loading: false, loaded: true, isEnd: true};
      notice = err?.type || err?.message || 'Could not load that tab';
    }
  }

  async function moreMembers() {
    if (membersBusy || membersEnd) return;
    const id = peerId;
    membersBusy = true;
    try {
      const page = await loadMembers(id, {offset: members.length, limit: 50});
      if (id !== peerId) return;
      const seen = new Set(members.map((member) => member.peerId));
      members = [...members, ...page.filter((member) => !seen.has(member.peerId))];
      membersEnd = page.length < 50;
    } finally {
      membersLoaded = true;
      membersBusy = false;
    }
  }

  /* Thumbnails — bounded, and only for cells the user has actually scrolled to. */
  async function requestThumb(mid: number) {
    if (thumbs[mid] !== undefined) return;
    const id = peerId;
    thumbs[mid] = '';
    const url = await enqueueLoad(() => loadMediaUrl(id, mid, 260));
    if (id === peerId) thumbs[mid] = url ?? '';
  }

  function lazy(node: HTMLElement, mid: number) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          requestThumb(mid);
        }
      },
      {rootMargin: '250px'}
    );
    observer.observe(node);
    return {destroy: () => observer.disconnect()};
  }

  function openLightbox(items: MessageItem[], index: number) {
    lightboxItems = items;
    lightboxIndex = index;
  }

  async function play(item: MessageItem) {
    if (playingMid === item.mid) {
      playingMid = 0;
      playingUrl = '';
      return;
    }
    playingMid = item.mid;
    playingUrl = '';
    const url = await loadMediaUrl(peerId, item.mid, 0, true);
    if (playingMid === item.mid) playingUrl = url ?? '';
  }

  async function download(item: MessageItem) {
    try {
      await saveMediaToDisk(peerId, item.mid);
    } catch (err: any) {
      notice = err?.type || err?.message || 'Could not download that file';
    }
  }

  function fileSize(bytes: number): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  function duration(seconds: number): string {
    if (!seconds) return '';
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    return `${minutes}:${`${total % 60}`.padStart(2, '0')}`;
  }

  function dateOf(item: MessageItem): string {
    return new Date(item.date * 1000).toLocaleDateString();
  }

  async function copy(text: string, what: string) {
    notice = (await copyText(text)) ? `${what} copied` : 'Could not copy';
  }

  /* ---------------------------------------------------------------- */
  /* Peer actions                                                      */
  /* ---------------------------------------------------------------- */

  async function run(name: string, action: () => Promise<void>) {
    if (busy) return;
    busy = name;
    notice = '';
    try {
      await action();
    } catch (err: any) {
      notice = err?.type || err?.message || 'That did not work';
    } finally {
      busy = '';
    }
  }

  function toggleMuted() {
    if (!info) return;
    const next = !info.muted;
    run('mute', async () => {
      await setMuted(peerId, next);
      if (info) info.muted = next;
    });
  }

  function toggleBlocked() {
    if (!info) return;
    const next = !info.blocked;
    run('block', async () => {
      await setBlocked(peerId, next);
      if (info) info.blocked = next;
    });
  }

  async function openFolders() {
    foldersOpen = !foldersOpen;
    if (foldersOpen) folders = await loadFoldersForPeer(peerId);
  }

  function toggleFolder(folder: ProfileFolder) {
    run('folder', async () => {
      if (folder.contains) await removePeerFromFolder(peerId, folder.id);
      else await addPeerToFolder(peerId, folder.id);
      folders = await loadFoldersForPeer(peerId);
    });
  }

  function beginContact() {
    contactFirst = info?.firstName ?? '';
    contactLast = info?.lastName ?? '';
    contactFormOpen = true;
  }

  function saveContact() {
    run('contact', async () => {
      await addContact(peerId, contactFirst, contactLast, info?.phone ?? '');
      contactFormOpen = false;
      forgetPeer(peerId);
      info = await loadProfile(peerId);
    });
  }

  function dropContact() {
    run('contact', async () => {
      await deleteContact(peerId);
      forgetPeer(peerId);
      info = await loadProfile(peerId);
    });
  }

  async function openSharePicker() {
    shareDialogs = await loadDialogs(60);
    sharePickerOpen = true;
  }

  function pickShareTarget(target: number) {
    sharePickerOpen = false;
    run('share', async () => {
      await shareContact(peerId, target);
      notice = 'Contact sent';
    });
  }

  function beginReport() {
    reportComment = '';
    reportOptionId = 0;
    run('report', async () => {
      report = await startReport(peerId);
    });
  }

  function chooseReportOption(optionId: number) {
    run('report', async () => {
      const next = await submitReport(peerId, optionId);
      if (next.kind === 'comment') reportOptionId = next.options[0]?.id ?? 0;
      report = next;
      if (next.kind === 'done') {
        notice = 'Report sent';
        report = null;
      }
    });
  }

  function sendReportComment() {
    run('report', async () => {
      const next = await submitReport(peerId, reportOptionId, reportComment);
      if (next.kind === 'done') {
        notice = 'Report sent';
        report = null;
      } else {
        report = next;
      }
    });
  }

  /* QR is painted imperatively — the styling library owns the canvas. */
  $effect(() => {
    const host = qrHost;
    const url = info?.link ?? '';
    if (!qrOpen || !host || !url) return;

    let teardown: (() => void) | null = null;
    const styles = getComputedStyle(document.documentElement);
    paintPeerQr(host, url, {
      size: 220,
      foreground: styles.getPropertyValue('--text').trim() || '#000000',
      background: styles.getPropertyValue('--bg-solid').trim() || '#ffffff'
    })
      .then((dispose) => (teardown = dispose))
      .catch(() => (notice = 'Could not draw the QR code'));

    return () => teardown?.();
  });

  /* ---------------------------------------------------------------- */
  /* Public link editing                                               */
  /* ---------------------------------------------------------------- */

  function startEditingLink() {
    link = info?.username ?? '';
    linkError = '';
    linkFree = null;
    editingLink = true;
  }

  function onLinkInput() {
    clearTimeout(linkTimer);
    linkError = '';
    linkFree = null;
    const wanted = link.trim().replace(/^@/, '');
    if (wanted.length < 5 || wanted === info?.username) return;

    linkTimer = setTimeout(async () => {
      try {
        const free = await checkChatUsername(peerId, wanted);
        // The field may have moved on while the check was in flight.
        if (link.trim().replace(/^@/, '') === wanted) linkFree = free;
      } catch (err: any) {
        if (link.trim().replace(/^@/, '') === wanted) {
          linkFree = false;
          linkError = err?.type || err?.message || 'That link cannot be used';
        }
      }
    }, 400);
  }

  async function saveLink() {
    if (linkBusy) return;
    linkBusy = true;
    linkError = '';

    try {
      const newPeerId = await setChatUsername(peerId, link);
      editingLink = false;
      forgetPeer(peerId);
      forgetPeer(newPeerId);

      // Setting a link on a basic group migrates it to a supergroup, which is
      // a different peer — reopen on the new one rather than showing a stale
      // profile for a chat that no longer receives messages.
      const onMoved = onmigrated ?? onpeer;
      if (newPeerId !== peerId && onMoved) onMoved(newPeerId);
      else info = await loadProfile(peerId);
    } catch (err: any) {
      linkError = err?.type || err?.message || 'Failed to save the link';
    } finally {
      linkBusy = false;
    }
  }

  async function removeLink() {
    link = '';
    await saveLink();
  }
</script>

<aside class="info">
  <header>
    <span>Info</span>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>

  <div class="body">
    {#if error}
      <p class="muted">{error}</p>
    {:else if !info}
      <p class="muted">Loading…</p>
    {:else}
      <div class="head">
        <Avatar peerId={info.peerId} title={info.title} size={84} />
        <h2 style={info.nameColor ? `color: ${info.nameColor}` : ''}>
          <span class="title-text">{info.title}</span>
          {#if info.verified}
            <span class="badge verified" title="Verified"><Glyph name="check" size={11} /></span>
          {/if}
          {#if info.premium}
            <span class="badge premium" title="Premium">
              <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
                <path
                  d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.5 8.1l5.2-.8z"
                  fill="currentColor"
                />
              </svg>
            </span>
          {/if}
          {#if info.scam}<span class="badge warn">SCAM</span>{/if}
          {#if info.fake}<span class="badge warn">FAKE</span>{/if}
        </h2>

        {#if info.username}<p class="username">@{info.username}</p>{/if}
        <p class="kind">
          {info.isChannel ? 'Channel' : info.isGroup ? 'Group' : info.isBot ? 'Bot' : 'User'}
          {#if info.membersCount}
            · {info.membersCount.toLocaleString()} {info.isChannel ? 'subscribers' : 'members'}
          {/if}
          {#if info.onlineCount}
            · {info.onlineCount.toLocaleString()} online
          {/if}
        </p>

        {#if onmessage}
          <button class="primary" onclick={() => onmessage(info.peerId)}>
            {info.isChannel || info.isGroup ? 'Open chat' : 'Send message'}
          </button>
        {/if}

        {#if canManage}
          <button class="link-btn" onclick={() => (managing = true)}>Manage</button>
        {/if}
      </div>

      {#if notice}<p class="notice">{notice}</p>{/if}

      <section class="identity">
        {#if info.about}
          <div class="row">
            <div class="row-main">
              <p class="label">{info.isUser ? 'Bio' : 'About'}</p>
              <p class="about">{info.about}</p>
            </div>
            <button class="icon-btn" onclick={() => copy(info.about, 'Bio')} aria-label="Copy bio">
              <Glyph name="file" size={16} />
            </button>
          </div>
        {/if}

        {#if info.phone}
          <div class="row">
            <div class="row-main">
              <p class="label">Phone</p>
              <p class="value">{info.phone}</p>
            </div>
            <button class="icon-btn" onclick={() => copy(info.phone, 'Phone')} aria-label="Copy phone">
              <Glyph name="file" size={16} />
            </button>
          </div>
        {/if}

        {#each info.usernames as username (username)}
          <div class="row">
            <div class="row-main">
              <p class="label">Username</p>
              <p class="value">@{username}</p>
            </div>
            <button
              class="icon-btn"
              onclick={() => copy(`https://t.me/${username}`, 'Link')}
              aria-label="Copy link"
            >
              <Glyph name="file" size={16} />
            </button>
          </div>
        {/each}
      </section>

      {#if info.canSetUsername}
        <section>
          <p class="label">Public link</p>
          {#if editingLink}
            <div class="link-edit">
              <span class="at">@</span>
              <input
                bind:value={link}
                oninput={onLinkInput}
                placeholder="link"
                maxlength="32"
                spellcheck="false"
                autocapitalize="none"
              />
            </div>
            {#if linkFree === true}<p class="ok">@{link.trim().replace(/^@/, '')} is available</p>{/if}
            {#if linkError}<p class="err">{linkError}</p>{/if}
            {#if info.isGroup && !info.username}
              <p class="hint">A public group becomes a supergroup.</p>
            {/if}
            <div class="link-actions">
              {#if info.username}
                <button class="link-btn danger" onclick={removeLink} disabled={linkBusy}>Remove</button>
              {/if}
              <button class="link-btn" onclick={() => (editingLink = false)} disabled={linkBusy}>Cancel</button>
              <button
                class="link-btn primary"
                onclick={saveLink}
                disabled={linkBusy || linkFree === false || link.trim().replace(/^@/, '').length < 5}
              >
                {linkBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          {:else}
            <div class="link-row">
              <span class="link-value">{info.username ? `@${info.username}` : 'Private — invite only'}</span>
              <button class="link-btn" onclick={startEditingLink}>{info.username ? 'Edit' : 'Set link'}</button>
            </div>
          {/if}
        </section>
      {/if}

      <section class="actions">
        <button class="action" onclick={toggleMuted} disabled={busy === 'mute'}>
          <Glyph name="muted" size={16} />
          <span>{info.muted ? 'Unmute notifications' : 'Mute notifications'}</span>
        </button>

        <button class="action" onclick={openFolders}>
          <Glyph name="pin" size={16} />
          <span>Add to folder</span>
        </button>

        {#if foldersOpen}
          <div class="folders">
            {#each folders as folder (folder.id)}
              <button class="folder" onclick={() => toggleFolder(folder)} disabled={busy === 'folder'}>
                <span>{folder.title}</span>
                {#if folder.contains}<Glyph name="check" size={14} />{/if}
              </button>
            {/each}
            {#if !folders.length}<p class="muted small">No editable folders yet.</p>{/if}
          </div>
        {/if}

        {#if info.link}
          <button class="action" onclick={() => (qrOpen = true)}>
            <Glyph name="app" size={16} />
            <span>Show QR code</span>
          </button>
        {/if}

        {#if info.isUser && !info.isSelf}
          <button class="action" onclick={openSharePicker} disabled={busy === 'share'}>
            <Glyph name="send" size={16} />
            <span>Share contact</span>
          </button>

          {#if !info.isBot}
            {#if info.isContact}
              <button class="action" onclick={beginContact}>
                <Glyph name="edit" size={16} />
                <span>Edit contact</span>
              </button>
              <button class="action danger" onclick={dropContact} disabled={busy === 'contact'}>
                <Glyph name="close" size={16} />
                <span>Delete contact</span>
              </button>
            {:else}
              <button class="action" onclick={beginContact}>
                <Glyph name="edit" size={16} />
                <span>Add to contacts</span>
              </button>
            {/if}
          {/if}

          <button class="action danger" onclick={toggleBlocked} disabled={busy === 'block'}>
            <Glyph name="close" size={16} />
            <span>{info.blocked ? 'Unblock user' : 'Block user'}</span>
          </button>
        {/if}

        {#if !info.isSelf}
          <button class="action danger" onclick={beginReport} disabled={busy === 'report'}>
            <Glyph name="muted" size={16} />
            <span>Report</span>
          </button>
        {/if}
      </section>

      {#if contactFormOpen}
        <section class="contact-form">
          <p class="label">Contact name</p>
          <input bind:value={contactFirst} placeholder="First name" />
          <input bind:value={contactLast} placeholder="Last name" />
          <div class="link-actions">
            <button class="link-btn" onclick={() => (contactFormOpen = false)}>Cancel</button>
            <button
              class="link-btn primary"
              onclick={saveContact}
              disabled={busy === 'contact' || !contactFirst.trim()}
            >
              Save
            </button>
          </div>
        </section>
      {/if}

      {#if report}
        <section class="report">
          <p class="label">{report.title}</p>
          {#if report.kind === 'choose'}
            {#each report.options as option (option.id)}
              <button class="action" onclick={() => chooseReportOption(option.id)} disabled={busy === 'report'}>
                <span>{option.text}</span>
              </button>
            {/each}
          {:else if report.kind === 'comment'}
            <textarea bind:value={reportComment} rows="3" placeholder="Add a comment"></textarea>
            <div class="link-actions">
              <button class="link-btn" onclick={() => (report = null)}>Cancel</button>
              <button
                class="link-btn primary"
                onclick={sendReportComment}
                disabled={busy === 'report' || (!report.commentOptional && !reportComment.trim())}
              >
                Send
              </button>
            </div>
          {/if}
        </section>
      {/if}

      <nav class="tabs">
        {#each tabs as entry (entry.id)}
          <button class="tab" class:active={tab === entry.id} onclick={() => (tab = entry.id as TabId)}>
            {entry.label}
          </button>
        {/each}
      </nav>

      <section class="tab-body">
        {#if tab === 'media' || tab === 'gifs'}
          {@const page = shared[tab]}
          <div class="grid">
            {#each page.items as item, index (item.mid)}
              <button class="cell" use:lazy={item.mid} onclick={() => openLightbox(page.items, index)}>
                {#if thumbs[item.mid]}
                  {#if item.media?.kind === 'gif'}
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video src={thumbs[item.mid]} autoplay loop muted playsinline></video>
                  {:else}
                    <img src={thumbs[item.mid]} alt="" />
                  {/if}
                {/if}
                {#if item.media?.kind === 'video'}
                  <span class="cell-tag">{duration(item.media.duration) || '▶'}</span>
                {/if}
              </button>
            {/each}
          </div>
          {#if !page.items.length && page.loaded}
            <p class="muted small">Nothing here yet.</p>
          {/if}
        {:else if tab === 'members'}
          {#each members as member (member.peerId)}
            <button class="member" onclick={() => onpeer?.(member.peerId)}>
              <Avatar peerId={member.peerId} title={member.title} size={32} />
              <span class="member-name">{member.title}</span>
              {#if member.role}<span class="role">{member.role}</span>{/if}
            </button>
          {/each}
          {#if !members.length && membersLoaded}<p class="muted small">No members to show.</p>{/if}
        {:else if tab === 'common' || tab === 'similar'}
          {@const chips = tab === 'common' ? commonGroups : similarChannels}
          {#each chips as chip (chip.peerId)}
            <button class="member" onclick={() => onpeer?.(chip.peerId)}>
              <Avatar peerId={chip.peerId} title={chip.title} size={32} />
              <span class="member-main">
                <span class="member-name">{chip.title}</span>
                {#if chip.subtitle}<span class="member-sub">{chip.subtitle}</span>{/if}
              </span>
            </button>
          {/each}
          {#if !chips.length && chipsLoaded[tab]}<p class="muted small">Nothing to show.</p>{/if}
        {:else}
          {@const page = shared[tab]}
          {#each page.items as item (item.mid)}
            <div class="entry">
              <div class="entry-main">
                {#if tab === 'links'}
                  {#each linksOf(item) as url (url)}
                    <a class="entry-link" href={url} target="_blank" rel="noreferrer noopener">{url}</a>
                  {/each}
                  {#if item.webpage?.title}<p class="entry-sub">{item.webpage.title}</p>{/if}
                  {#if !linksOf(item).length}<p class="entry-name">{item.text}</p>{/if}
                {:else}
                  <p class="entry-name">{item.media?.name || item.text || 'File'}</p>
                  <p class="entry-sub">
                    {[
                      duration(item.media?.duration ?? 0),
                      fileSize(item.media?.size ?? 0),
                      dateOf(item)
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                {/if}
              </div>

              <div class="entry-actions">
                {#if tab === 'music' || tab === 'voice'}
                  <button class="icon-btn" onclick={() => play(item)} aria-label="Play">
                    <Glyph name="app" size={16} />
                  </button>
                {:else if tab === 'files'}
                  <button class="icon-btn" onclick={() => download(item)} aria-label="Download">
                    <Glyph name="save" size={16} />
                  </button>
                {/if}
                {#if onjump}
                  <button class="icon-btn" onclick={() => onjump(item.mid)} aria-label="Go to message">
                    <Glyph name="search" size={16} />
                  </button>
                {/if}
              </div>
            </div>
            {#if playingMid === item.mid && playingUrl}
              <audio class="player" src={playingUrl} controls autoplay></audio>
            {/if}
          {/each}
          {#if !page.items.length && page.loaded}<p class="muted small">Nothing here yet.</p>{/if}
        {/if}

        {#if tab !== 'members' && tab !== 'common' && tab !== 'similar' && !shared[tab].isEnd}
          <button class="more" onclick={() => moreShared(tab as SharedTab)} disabled={shared[tab].loading}>
            {shared[tab].loading ? 'Loading…' : 'Load more'}
          </button>
        {/if}

        {#if tab === 'members' && !membersEnd && membersLoaded}
          <button class="more" onclick={moreMembers} disabled={membersBusy}>
            {membersBusy ? 'Loading…' : 'Load more'}
          </button>
        {/if}
      </section>
    {/if}
  </div>
</aside>

{#if lightboxIndex !== null}
  <Lightbox
    {peerId}
    items={lightboxItems}
    bind:index={lightboxIndex}
    onclose={() => (lightboxIndex = null)}
  />
{/if}

{#if sharePickerOpen}
  <PeerPicker
    title="Share contact with"
    dialogs={shareDialogs}
    onpick={pickShareTarget}
    onclose={() => (sharePickerOpen = false)}
  />
{/if}

{#if qrOpen && info?.link}
  <div class="backdrop" onclick={() => (qrOpen = false)} role="presentation">
    <div class="qr-card" onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="qr-host" bind:this={qrHost}></div>
      <p class="qr-link">{info.link}</p>
      <div class="link-actions">
        <button class="link-btn" onclick={() => (qrOpen = false)}>Close</button>
        <button class="link-btn primary" onclick={() => copy(info!.link, 'Link')}>Copy link</button>
      </div>
    </div>
  </div>
{/if}

{#if managing}
  <ChatAdmin
    {peerId}
    onclose={() => {
      managing = false;
      // The chat may have been renamed, made public, or left entirely.
      loadProfile(peerId)
        .then((loaded) => (info = loaded))
        .catch(() => {});
    }}
    onmigrated={(newPeerId) => (onmigrated ?? onpeer)?.(newPeerId)}
    {onpeer}
  />
{/if}

<style>
  .info {
    width: 320px;
    flex: none;
    background: var(--pane);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    backdrop-filter: blur(var(--blur));
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  .close {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px;
  }

  .head {
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
  }

  h2 {
    margin: 8px 0 0;
    font-size: 18px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .title-text {
    overflow-wrap: anywhere;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }

  .badge.verified {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
  }

  .badge.premium {
    color: var(--accent-hover);
  }

  .badge.warn {
    padding: 1px 5px;
    border: 1px solid var(--danger);
    border-radius: 5px;
    color: var(--danger);
    font-size: 10px;
    letter-spacing: 0.04em;
  }

  .username,
  .kind {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  section {
    margin-top: 22px;
  }

  .label {
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .about {
    margin: 0;
    font-size: 14px;
    white-space: pre-wrap;
  }

  .value {
    margin: 0;
    font-size: 14px;
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .row-main {
    flex: 1;
    min-width: 0;
  }

  .icon-btn {
    flex: none;
    padding: 5px;
    border: none;
    border-radius: 8px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .link-value {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-edit {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .link-edit:focus-within {
    border-color: var(--accent);
  }

  .at {
    color: var(--text-dim);
  }

  .link-edit input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    outline: none;
  }

  .link-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .link-btn {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .link-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .link-btn.danger {
    color: var(--danger);
  }

  .link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ok,
  .err,
  .hint {
    margin: 6px 0 0;
    font-size: 12px;
  }

  .ok {
    color: var(--accent);
  }

  .err {
    color: var(--danger);
  }

  .hint {
    color: var(--text-dim);
  }

  .notice {
    margin: 14px 0 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    font-size: 12px;
  }

  .actions {
    display: grid;
    gap: 2px;
  }

  .action {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 8px;
    border: none;
    border-radius: 10px;
    background: none;
    color: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .action:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .action.danger {
    color: var(--danger);
  }

  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .folders {
    display: grid;
    gap: 2px;
    margin: 4px 0 4px 26px;
  }

  .folder {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 8px;
    border: none;
    border-radius: 8px;
    background: none;
    color: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .folder:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .contact-form input,
  .report textarea {
    width: 100%;
    margin-bottom: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    resize: vertical;
  }

  .contact-form input:focus,
  .report textarea:focus {
    border-color: var(--accent);
  }

  .tabs {
    display: flex;
    gap: 4px;
    margin-top: 22px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    flex: none;
    padding: 8px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-dim);
    font-size: 13px;
    cursor: pointer;
  }

  .tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .tab-body {
    margin-top: 12px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
  }

  .cell {
    position: relative;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 6px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    cursor: pointer;
  }

  .cell img,
  .cell video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cell-tag {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 10px;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .entry-main {
    flex: 1;
    min-width: 0;
  }

  .entry-name {
    margin: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-sub {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .entry-link {
    display: block;
    font-size: 13px;
    color: var(--accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-actions {
    display: flex;
    flex: none;
    gap: 2px;
  }

  .player {
    width: 100%;
    margin: 6px 0 10px;
  }

  .more {
    width: 100%;
    margin-top: 12px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .more:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 4px;
    border: none;
    border-radius: 8px;
    background: none;
    color: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .member:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .member-main {
    display: grid;
    min-width: 0;
  }

  .member-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-sub {
    font-size: 12px;
    color: var(--text-dim);
  }

  .role {
    flex: none;
    padding: 1px 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .primary {
    margin-top: 10px;
    padding: 9px 18px;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 13px;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 95;
  }

  .qr-card {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 20px;
    border-radius: 16px;
    background: var(--bg-solid);
    border: 1px solid var(--border);
  }

  .qr-host {
    display: grid;
    place-items: center;
    min-width: 220px;
    min-height: 220px;
  }

  .qr-link {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  /* Phones have no room for a third column — show it as a full-screen sheet. */
  @media (max-width: 860px) {
    .info {
      position: fixed;
      inset: 0;
      width: 100%;
      background: var(--bg);
      z-index: 80;
    }
  }
</style>
