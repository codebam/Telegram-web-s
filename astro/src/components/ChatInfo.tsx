/*
 * The profile pane: identity, the peer actions, the shared-media tabs and every
 * dialog they open.
 *
 * Ported from svelte/src/lib/components/ChatInfo.svelte. Five conversions are
 * worth knowing when reading this:
 *
 *  - every loader `$effect` here reads the `peerId` *prop*, so each one is a
 *    `useEffect` keyed on that prop: `useSignalEffect` tracks signal reads only
 *    and would never notice a different chat being opened (CONVERSION.md §4);
 *  - the guards inside those loaders' `.then()`s compared against `peerId` as it
 *    was when the fetch *started*, which Svelte always read as current. A JSX
 *    closure sees the render that started the load, so the latest peer id is
 *    kept in a ref, as in `Avatar.tsx` — without it a slow response for a
 *    previously-opened chat overwrites the new one;
 *  - `signal()` is shallow where `$state` was a deep proxy, so the writes the
 *    original made *into* `info` and `thumbs` (`info.muted = next`) reassign the
 *    whole value here; a field write would not notify anything (CONVERSION.md §4);
 *  - `use:lazy` is the `useLazy` hook below (CONVERSION.md §6). The action ran
 *    per element while a hook can only be called from a component body, and the
 *    grid's list grows as pages load — so the cell it watched is the small
 *    `SharedCell` component, rather than a hook called from inside `.map()`;
 *  - the public-link field was `bind:value` *plus* `oninput`, and `onLinkInput`
 *    reads the new value — so the signal is written before the handler is called.
 *    `linkTimer` was a plain `let` in the Svelte body, which runs once per
 *    instance; here it is a `useRef`, or the handle would be lost on a re-render.
 */
import {Fragment} from 'preact';
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {Avatar} from './Avatar';
import {Glyph} from './Glyph';
import {Lightbox} from './Lightbox';
import {PeerPicker} from './PeerPicker';
import {ChatAdmin} from './ChatAdmin';
import {BoostPanel} from './BoostPanel';
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

import './ChatInfo.css';

interface Props {
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
}

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

function duration(seconds: number): string {
  if(!seconds) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${`${total % 60}`.padStart(2, '0')}`;
}

/**
 * The `use:lazy` action as a hook (CONVERSION.md §6): its body is the action's
 * `mounted` logic, its return value the `destroy` logic, and its parameter
 * (`mid`) the dependency list.
 */
function useLazy(mid: number, onSeen: (mid: number) => void) {
  const el = useRef<HTMLButtonElement>(null);

  // The observer outlives the render that created it, so the callback that
  // requests the thumbnail is kept current in a ref instead of making the effect
  // re-run — and re-observe the same cell — on every render.
  const currentOnSeen = useRef(onSeen);
  currentOnSeen.current = onSeen;

  useEffect(() => {
    const node = el.current;
    if(!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if(entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          currentOnSeen.current(mid);
        }
      },
      {rootMargin: '250px'}
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mid]);

  return el;
}

interface CellProps {
  item: MessageItem;
  thumb: string;
  onseen: (mid: number) => void;
  onopen: () => void;
}

/**
 * One shared-media cell. It exists as its own component only because of
 * `use:lazy`: the observer is per cell, and the grid's list changes length as
 * pages load, so the hook cannot be called from inside its `.map()`.
 */
function SharedCell({item, thumb, onseen, onopen}: CellProps) {
  const cell = useLazy(item.mid, onseen);

  return (
    <button class="cell" ref={cell} onClick={onopen}>
      {thumb && (
        item.media?.kind === 'gif' ?
          /* A GIF is a silent looping video with no caption track to offer; the
             original carried the equivalent svelte-ignore a11y_media_has_caption. */
          <video src={thumb} autoplay loop muted playsinline></video> :
          <img src={thumb} alt="" />
      )}
      {item.media?.kind === 'video' && (
        <span class="cell-tag">{duration(item.media.duration) || '▶'}</span>
      )}
    </button>
  );
}

export function ChatInfo({peerId, onclose, onmessage, onpeer, onmigrated, onjump}: Props) {
  const info = useSignal<ProfileInfo | null>(null);
  const error = useSignal('');
  const boosting = useSignal(false);

  const tab = useSignal<TabId>('media');
  const shared = useSignal<Record<SharedTab, SharedState>>(emptyShared());
  const thumbs = useSignal<Record<number, string>>({});

  const members = useSignal<ProfileMember[]>([]);
  const membersLoaded = useSignal(false);
  const membersEnd = useSignal(false);
  const membersBusy = useSignal(false);

  const commonGroups = useSignal<PeerChip[]>([]);
  const similarChannels = useSignal<PeerChip[]>([]);
  const chipsLoaded = useSignal<Record<string, boolean>>({});

  const lightboxItems = useSignal<MessageItem[]>([]);
  const lightboxIndex = useSignal<number | null>(null);

  const playingMid = useSignal(0);
  const playingUrl = useSignal('');

  const busy = useSignal('');
  const notice = useSignal('');

  const folders = useSignal<ProfileFolder[]>([]);
  const foldersOpen = useSignal(false);

  const report = useSignal<ReportStep | null>(null);
  const reportComment = useSignal('');
  const reportOptionId = useSignal(0);

  const qrOpen = useSignal(false);
  // The effect below reacts to the host element appearing, so this is a signal
  // with a callback ref rather than a plain ref (CONVERSION.md §4). The callback
  // is stable, so a re-render does not detach and re-attach the host — which
  // would repaint the QR on every render.
  const qrHost = useSignal<HTMLElement | null>(null);
  const setQrHost = useMemo(() => (node: HTMLDivElement | null) => {
    qrHost.value = node;
  }, []);

  const sharePickerOpen = useSignal(false);
  const shareDialogs = useSignal<DialogItem[]>([]);

  const contactFormOpen = useSignal(false);
  const contactFirst = useSignal('');
  const contactLast = useSignal('');

  const editingLink = useSignal(false);
  const link = useSignal('');
  const linkBusy = useSignal(false);
  const linkError = useSignal('');
  const linkFree = useSignal<boolean | null>(null);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Whether this account may administer the chat, and the admin panel it opens.
  const canManage = useSignal(false);
  const managing = useSignal(false);

  // The running loaders compare their own prop against the latest one — see the
  // note at the top of the file.
  const currentPeerId = useRef(peerId);
  currentPeerId.current = peerId;

  useEffect(() => {
    const id = peerId;
    canManage.value = false;
    managing.value = false;
    // Non-fatal: without it the profile simply has no "Manage" entry.
    loadAdminAccess(id)
      .then((access) => {
        if(id === currentPeerId.current) canManage.value = access.canManage;
      })
      .catch(() => {});
  }, [peerId]);

  const tabs = useComputed((): {id: TabId; label: string}[] => {
    const list: {id: TabId; label: string}[] = [...SHARED_TABS];
    if(info.value && !info.value.isUser) list.push({id: 'members', label: 'Members'});
    if(info.value?.isUser && info.value.commonChatsCount > 0) list.push({id: 'common', label: 'Groups'});
    if(info.value?.isChannel) list.push({id: 'similar', label: 'Similar'});
    return list;
  });

  function resetForPeer() {
    info.value = null;
    error.value = '';
    tab.value = 'media';
    shared.value = emptyShared();
    thumbs.value = {};
    members.value = [];
    membersLoaded.value = false;
    membersEnd.value = false;
    commonGroups.value = [];
    similarChannels.value = [];
    chipsLoaded.value = {};
    lightboxIndex.value = null;
    playingMid.value = 0;
    playingUrl.value = '';
    busy.value = '';
    notice.value = '';
    folders.value = [];
    foldersOpen.value = false;
    report.value = null;
    qrOpen.value = false;
    sharePickerOpen.value = false;
    contactFormOpen.value = false;
    editingLink.value = false;
    linkError.value = '';
    linkFree.value = null;
  }

  useEffect(() => {
    const id = peerId;
    resetForPeer();
    loadProfile(id)
      .then((loaded) => {
        if(id === currentPeerId.current) info.value = loaded;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load info'));
  }, [peerId]);

  // Reading the cached page inside the effect would make the effect depend on
  // what it writes, so the check happens after a microtask — outside tracking.
  // It carries both the prop and the `tab` signal, which is what decides that
  // this is a `useEffect` and not a `useSignalEffect`.
  useEffect(() => {
    const id = peerId;
    const active = tab.value;
    void openTab(id, active);
  }, [peerId, tab.value]);

  async function openTab(id: number, active: TabId) {
    await Promise.resolve();
    // Compared against the current peer and tab, not the ones this call started
    // with — a slow response must not take over the chat now on screen.
    if(id !== currentPeerId.current || active !== tab.value) return;

    if(active === 'members') {
      if(!membersLoaded.value) await moreMembers();
      return;
    }

    if(active === 'common') {
      if(!chipsLoaded.value.common) {
        chipsLoaded.value = {...chipsLoaded.value, common: true};
        commonGroups.value = await loadCommonGroups(id);
      }
      return;
    }

    if(active === 'similar') {
      if(!chipsLoaded.value.similar) {
        chipsLoaded.value = {...chipsLoaded.value, similar: true};
        similarChannels.value = await loadSimilarChannels(id);
      }
      return;
    }

    if(!shared.value[active].loaded) await moreShared(active);
  }

  async function moreShared(which: SharedTab) {
    const id = peerId;
    const page = shared.value[which];
    if(page.loading || page.isEnd) return;

    shared.value = {...shared.value, [which]: {...page, loading: true}};
    try {
      const next = await loadSharedMedia(id, which, {offsetId: page.nextOffsetId || undefined});
      if(id !== currentPeerId.current) return;

      const current = shared.value[which];
      const seen = new Set(current.items.map((item) => item.mid));
      shared.value = {
        ...shared.value,
        [which]: {
          items: [...current.items, ...next.items.filter((item) => !seen.has(item.mid))],
          nextOffsetId: next.nextOffsetId,
          isEnd: next.isEnd || !next.nextOffsetId,
          loading: false,
          loaded: true
        }
      };
    } catch (err: any) {
      shared.value = {
        ...shared.value,
        [which]: {...shared.value[which], loading: false, loaded: true, isEnd: true}
      };
      notice.value = err?.type || err?.message || 'Could not load that tab';
    }
  }

  async function moreMembers() {
    if(membersBusy.value || membersEnd.value) return;
    const id = peerId;
    membersBusy.value = true;
    try {
      const page = await loadMembers(id, {offset: members.value.length, limit: 50});
      if(id !== currentPeerId.current) return;
      const seen = new Set(members.value.map((member) => member.peerId));
      members.value = [...members.value, ...page.filter((member) => !seen.has(member.peerId))];
      membersEnd.value = page.length < 50;
    } finally {
      membersLoaded.value = true;
      membersBusy.value = false;
    }
  }

  /* Thumbnails — bounded, and only for cells the user has actually scrolled to. */
  async function requestThumb(mid: number) {
    if(thumbs.value[mid] !== undefined) return;
    const id = peerId;
    thumbs.value = {...thumbs.value, [mid]: ''};
    const url = await enqueueLoad(() => loadMediaUrl(id, mid, 260));
    if(id === currentPeerId.current) thumbs.value = {...thumbs.value, [mid]: url ?? ''};
  }

  function openLightbox(items: MessageItem[], index: number) {
    lightboxItems.value = items;
    lightboxIndex.value = index;
  }

  async function play(item: MessageItem) {
    if(playingMid.value === item.mid) {
      playingMid.value = 0;
      playingUrl.value = '';
      return;
    }
    playingMid.value = item.mid;
    playingUrl.value = '';
    const url = await loadMediaUrl(peerId, item.mid, 0, true);
    if(playingMid.value === item.mid) playingUrl.value = url ?? '';
  }

  async function download(item: MessageItem) {
    try {
      await saveMediaToDisk(peerId, item.mid);
    } catch (err: any) {
      notice.value = err?.type || err?.message || 'Could not download that file';
    }
  }

  function fileSize(bytes: number): string {
    if(!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while(value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  function dateOf(item: MessageItem): string {
    return new Date(item.date * 1000).toLocaleDateString();
  }

  async function copy(text: string, what: string) {
    notice.value = (await copyText(text)) ? `${what} copied` : 'Could not copy';
  }

  /* ---------------------------------------------------------------- */
  /* Peer actions                                                      */
  /* ---------------------------------------------------------------- */

  async function run(name: string, action: () => Promise<void>) {
    if(busy.value) return;
    busy.value = name;
    notice.value = '';
    try {
      await action();
    } catch (err: any) {
      notice.value = err?.type || err?.message || 'That did not work';
    } finally {
      busy.value = '';
    }
  }

  function toggleMuted() {
    if(!info.value) return;
    const next = !info.value.muted;
    run('mute', async () => {
      await setMuted(peerId, next);
      // Reassigned rather than written field-by-field: `signal()` is shallow, so
      // `info.value.muted = next` would not notify the reader (CONVERSION.md §4).
      if(info.value) info.value = {...info.value, muted: next};
    });
  }

  function toggleBlocked() {
    if(!info.value) return;
    const next = !info.value.blocked;
    run('block', async () => {
      await setBlocked(peerId, next);
      if(info.value) info.value = {...info.value, blocked: next};
    });
  }

  async function openFolders() {
    foldersOpen.value = !foldersOpen.value;
    if(foldersOpen.value) folders.value = await loadFoldersForPeer(peerId);
  }

  function toggleFolder(folder: ProfileFolder) {
    run('folder', async () => {
      if(folder.contains) await removePeerFromFolder(peerId, folder.id);
      else await addPeerToFolder(peerId, folder.id);
      folders.value = await loadFoldersForPeer(peerId);
    });
  }

  function beginContact() {
    contactFirst.value = info.value?.firstName ?? '';
    contactLast.value = info.value?.lastName ?? '';
    contactFormOpen.value = true;
  }

  function saveContact() {
    run('contact', async () => {
      await addContact(peerId, contactFirst.value, contactLast.value, info.value?.phone ?? '');
      contactFormOpen.value = false;
      forgetPeer(peerId);
      info.value = await loadProfile(peerId);
    });
  }

  function dropContact() {
    run('contact', async () => {
      await deleteContact(peerId);
      forgetPeer(peerId);
      info.value = await loadProfile(peerId);
    });
  }

  async function openSharePicker() {
    shareDialogs.value = await loadDialogs(60);
    sharePickerOpen.value = true;
  }

  function pickShareTarget(target: number) {
    sharePickerOpen.value = false;
    run('share', async () => {
      await shareContact(peerId, target);
      notice.value = 'Contact sent';
    });
  }

  function beginReport() {
    reportComment.value = '';
    reportOptionId.value = 0;
    run('report', async () => {
      report.value = await startReport(peerId);
    });
  }

  function chooseReportOption(optionId: number) {
    run('report', async () => {
      const next = await submitReport(peerId, optionId);
      if(next.kind === 'comment') reportOptionId.value = next.options[0]?.id ?? 0;
      report.value = next;
      if(next.kind === 'done') {
        notice.value = 'Report sent';
        report.value = null;
      }
    });
  }

  function sendReportComment() {
    run('report', async () => {
      const next = await submitReport(peerId, reportOptionId.value, reportComment.value);
      if(next.kind === 'done') {
        notice.value = 'Report sent';
        report.value = null;
      } else {
        report.value = next;
      }
    });
  }

  /* QR is painted imperatively — the styling library owns the canvas. */
  useSignalEffect(() => {
    const host = qrHost.value;
    const url = info.value?.link ?? '';
    if(!qrOpen.value || !host || !url) return;

    let teardown: (() => void) | null = null;
    const styles = getComputedStyle(document.documentElement);
    paintPeerQr(host, url, {
      size: 220,
      foreground: styles.getPropertyValue('--text').trim() || '#000000',
      background: styles.getPropertyValue('--bg-solid').trim() || '#ffffff'
    })
      .then((dispose) => (teardown = dispose))
      .catch(() => (notice.value = 'Could not draw the QR code'));

    return () => teardown?.();
  });

  /* ---------------------------------------------------------------- */
  /* Public link editing                                               */
  /* ---------------------------------------------------------------- */

  function startEditingLink() {
    link.value = info.value?.username ?? '';
    linkError.value = '';
    linkFree.value = null;
    editingLink.value = true;
  }

  function onLinkInput() {
    clearTimeout(linkTimer.current);
    linkError.value = '';
    linkFree.value = null;
    const wanted = link.value.trim().replace(/^@/, '');
    if(wanted.length < 5 || wanted === info.value?.username) return;

    linkTimer.current = setTimeout(async () => {
      try {
        const free = await checkChatUsername(peerId, wanted);
        // The field may have moved on while the check was in flight.
        if(link.value.trim().replace(/^@/, '') === wanted) linkFree.value = free;
      } catch (err: any) {
        if(link.value.trim().replace(/^@/, '') === wanted) {
          linkFree.value = false;
          linkError.value = err?.type || err?.message || 'That link cannot be used';
        }
      }
    }, 400);
  }

  async function saveLink() {
    if(linkBusy.value) return;
    linkBusy.value = true;
    linkError.value = '';

    try {
      const newPeerId = await setChatUsername(peerId, link.value);
      editingLink.value = false;
      forgetPeer(peerId);
      forgetPeer(newPeerId);

      // Setting a link on a basic group migrates it to a supergroup, which is
      // a different peer — reopen on the new one rather than showing a stale
      // profile for a chat that no longer receives messages.
      const onMoved = onmigrated ?? onpeer;
      if(newPeerId !== peerId && onMoved) onMoved(newPeerId);
      else info.value = await loadProfile(peerId);
    } catch (err: any) {
      linkError.value = err?.type || err?.message || 'Failed to save the link';
    } finally {
      linkBusy.value = false;
    }
  }

  async function removeLink() {
    link.value = '';
    await saveLink();
  }

  // Read once so the `{#if}`/`{:else if}` chain over signals below narrows it
  // the way the original's `tab` did — a signal read is a property access, which
  // the compiler cannot narrow across a branch.
  const activeTab = tab.value;

  return (
    <>
      <aside class="info">
        <header>
          <span>Info</span>
          <button class="close" onClick={onclose} aria-label="Close">✕</button>
        </header>

        <div class="body">
          {error.value ?
            <p class="muted">{error.value}</p> :
            !info.value ?
              <p class="muted">Loading…</p> :
              <>
                <div class="head">
                  <Avatar peerId={info.value.peerId} title={info.value.title} size={84} />
                  <h2 style={info.value.nameColor ? `color: ${info.value.nameColor}` : ''}>
                    <span class="title-text">{info.value.title}</span>
                    {info.value.verified && (
                      <span class="badge verified" title="Verified"><Glyph name="check" size={11} /></span>
                    )}
                    {info.value.premium && (
                      <span class="badge premium" title="Premium">
                        <svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true">
                          <path
                            d="M10 2.6l2.3 4.7 5.2.8-3.8 3.7.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.5 8.1l5.2-.8z"
                            fill="currentColor"
                          />
                        </svg>
                      </span>
                    )}
                    {info.value.scam && <span class="badge warn">SCAM</span>}
                    {info.value.fake && <span class="badge warn">FAKE</span>}
                  </h2>

                  {info.value.username && <p class="username">@{info.value.username}</p>}
                  <p class="kind">
                    {info.value.isChannel ? 'Channel' : info.value.isGroup ? 'Group' : info.value.isBot ? 'Bot' : 'User'}
                    {/* `{#if info.membersCount}` — the count is a number, so a
                        bare `&&` would render a literal `0` for a chat with
                        none; the guard has to be the comparison. */}
                    {info.value.membersCount > 0 && (
                      <>
                        {' '}· {info.value.membersCount.toLocaleString()}{' '}
                        {info.value.isChannel ? 'subscribers' : 'members'}
                      </>
                    )}
                    {info.value.onlineCount > 0 && <>{' '}· {info.value.onlineCount.toLocaleString()} online</>}
                  </p>

                  {onmessage && (
                    <button class="primary" onClick={() => onmessage(info.value.peerId)}>
                      {info.value.isChannel || info.value.isGroup ? 'Open chat' : 'Send message'}
                    </button>
                  )}

                  {canManage.value && (
                    <button class="link-btn" onClick={() => (managing.value = true)}>Manage</button>
                  )}

                  {info.value.isChannel && (
                    <button class="link-btn" onClick={() => (boosting.value = true)}>Boosts</button>
                  )}
                </div>

                {notice.value && <p class="notice">{notice.value}</p>}

                <section class="identity">
                  {info.value.about && (
                    <div class="row">
                      <div class="row-main">
                        <p class="label">{info.value.isUser ? 'Bio' : 'About'}</p>
                        <p class="about">{info.value.about}</p>
                      </div>
                      <button class="icon-btn" onClick={() => copy(info.value.about, 'Bio')} aria-label="Copy bio">
                        <Glyph name="file" size={16} />
                      </button>
                    </div>
                  )}

                  {info.value.phone && (
                    <div class="row">
                      <div class="row-main">
                        <p class="label">Phone</p>
                        <p class="value">{info.value.phone}</p>
                      </div>
                      <button class="icon-btn" onClick={() => copy(info.value.phone, 'Phone')} aria-label="Copy phone">
                        <Glyph name="file" size={16} />
                      </button>
                    </div>
                  )}

                  {info.value.usernames.map((username) => (
                    <div key={username} class="row">
                      <div class="row-main">
                        <p class="label">Username</p>
                        <p class="value">@{username}</p>
                      </div>
                      <button
                        class="icon-btn"
                        onClick={() => copy(`https://t.me/${username}`, 'Link')}
                        aria-label="Copy link"
                      >
                        <Glyph name="file" size={16} />
                      </button>
                    </div>
                  ))}
                </section>

                {info.value.canSetUsername && (
                  <section>
                    <p class="label">Public link</p>
                    {editingLink.value ?
                      <>
                        <div class="link-edit">
                          <span class="at">@</span>
                          <input
                            value={link.value}
                            onInput={(e) => {
                              link.value = (e.target as HTMLInputElement).value;
                              onLinkInput();
                            }}
                            placeholder="link"
                            maxlength={32}
                            spellcheck={false}
                            autocapitalize="none"
                          />
                        </div>
                        {linkFree.value === true && (
                          <p class="ok">@{link.value.trim().replace(/^@/, '')} is available</p>
                        )}
                        {linkError.value && <p class="err">{linkError.value}</p>}
                        {info.value.isGroup && !info.value.username && (
                          <p class="hint">A public group becomes a supergroup.</p>
                        )}
                        <div class="link-actions">
                          {info.value.username && (
                            <button class="link-btn danger" onClick={removeLink} disabled={linkBusy.value}>
                              Remove
                            </button>
                          )}
                          <button
                            class="link-btn"
                            onClick={() => (editingLink.value = false)}
                            disabled={linkBusy.value}
                          >
                            Cancel
                          </button>
                          <button
                            class="link-btn primary"
                            onClick={saveLink}
                            disabled={linkBusy.value || linkFree.value === false || link.value.trim().replace(/^@/, '').length < 5}
                          >
                            {linkBusy.value ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </> :
                      <div class="link-row">
                        <span class="link-value">
                          {info.value.username ? `@${info.value.username}` : 'Private — invite only'}
                        </span>
                        <button class="link-btn" onClick={startEditingLink}>
                          {info.value.username ? 'Edit' : 'Set link'}
                        </button>
                      </div>}
                  </section>
                )}

                <section class="actions">
                  <button class="action" onClick={toggleMuted} disabled={busy.value === 'mute'}>
                    <Glyph name="muted" size={16} />
                    <span>{info.value.muted ? 'Unmute notifications' : 'Mute notifications'}</span>
                  </button>

                  <button class="action" onClick={openFolders}>
                    <Glyph name="pin" size={16} />
                    <span>Add to folder</span>
                  </button>

                  {foldersOpen.value && (
                    <div class="folders">
                      {folders.value.map((folder) => (
                        <button
                          key={folder.id}
                          class="folder"
                          onClick={() => toggleFolder(folder)}
                          disabled={busy.value === 'folder'}
                        >
                          <span>{folder.title}</span>
                          {folder.contains && <Glyph name="check" size={14} />}
                        </button>
                      ))}
                      {!folders.value.length && <p class="muted small">No editable folders yet.</p>}
                    </div>
                  )}

                  {info.value.link && (
                    <button class="action" onClick={() => (qrOpen.value = true)}>
                      <Glyph name="app" size={16} />
                      <span>Show QR code</span>
                    </button>
                  )}

                  {info.value.isUser && !info.value.isSelf && (
                    <>
                      <button class="action" onClick={openSharePicker} disabled={busy.value === 'share'}>
                        <Glyph name="send" size={16} />
                        <span>Share contact</span>
                      </button>

                      {!info.value.isBot && (
                        <>
                          {info.value.isContact ?
                            <>
                              <button class="action" onClick={beginContact}>
                                <Glyph name="edit" size={16} />
                                <span>Edit contact</span>
                              </button>
                              <button class="action danger" onClick={dropContact} disabled={busy.value === 'contact'}>
                                <Glyph name="close" size={16} />
                                <span>Delete contact</span>
                              </button>
                            </> :
                            <button class="action" onClick={beginContact}>
                              <Glyph name="edit" size={16} />
                              <span>Add to contacts</span>
                            </button>}
                        </>
                      )}

                      <button class="action danger" onClick={toggleBlocked} disabled={busy.value === 'block'}>
                        <Glyph name="close" size={16} />
                        <span>{info.value.blocked ? 'Unblock user' : 'Block user'}</span>
                      </button>
                    </>
                  )}

                  {!info.value.isSelf && (
                    <button class="action danger" onClick={beginReport} disabled={busy.value === 'report'}>
                      <Glyph name="muted" size={16} />
                      <span>Report</span>
                    </button>
                  )}
                </section>

                {contactFormOpen.value && (
                  <section class="contact-form">
                    <p class="label">Contact name</p>
                    <input
                      value={contactFirst.value}
                      onInput={(e) => (contactFirst.value = (e.target as HTMLInputElement).value)}
                      placeholder="First name"
                    />
                    <input
                      value={contactLast.value}
                      onInput={(e) => (contactLast.value = (e.target as HTMLInputElement).value)}
                      placeholder="Last name"
                    />
                    <div class="link-actions">
                      <button class="link-btn" onClick={() => (contactFormOpen.value = false)}>Cancel</button>
                      <button
                        class="link-btn primary"
                        onClick={saveContact}
                        disabled={busy.value === 'contact' || !contactFirst.value.trim()}
                      >
                        Save
                      </button>
                    </div>
                  </section>
                )}

                {report.value && (
                  <section class="report">
                    <p class="label">{report.value.title}</p>
                    {report.value.kind === 'choose' ?
                      report.value.options.map((option) => (
                        <button
                          key={option.id}
                          class="action"
                          onClick={() => chooseReportOption(option.id)}
                          disabled={busy.value === 'report'}
                        >
                          <span>{option.text}</span>
                        </button>
                      )) :
                      report.value.kind === 'comment' ?
                        <>
                          <textarea
                            value={reportComment.value}
                            onInput={(e) => (reportComment.value = (e.target as HTMLTextAreaElement).value)}
                            rows={3}
                            placeholder="Add a comment"
                          ></textarea>
                          <div class="link-actions">
                            <button class="link-btn" onClick={() => (report.value = null)}>Cancel</button>
                            <button
                              class="link-btn primary"
                              onClick={sendReportComment}
                              disabled={busy.value === 'report' || (!report.value.commentOptional && !reportComment.value.trim())}
                            >
                              Send
                            </button>
                          </div>
                        </> :
                        null}
                  </section>
                )}

                <nav class="tabs">
                  {tabs.value.map((entry) => (
                    <button
                      key={entry.id}
                      class={['tab', activeTab === entry.id && 'active'].filter(Boolean).join(' ')}
                      onClick={() => (tab.value = entry.id as TabId)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </nav>

                <section class="tab-body">
                  {activeTab === 'media' || activeTab === 'gifs' ? (() => {
                    // `{@const page = shared[tab]}` of the media/gifs branch.
                    const page = shared.value[activeTab];
                    return (
                      <>
                        <div class="grid">
                          {page.items.map((item, index) => (
                            <SharedCell
                              key={item.mid}
                              item={item}
                              thumb={thumbs.value[item.mid]}
                              onseen={requestThumb}
                              onopen={() => openLightbox(page.items, index)}
                            />
                          ))}
                        </div>
                        {!page.items.length && page.loaded && (
                          <p class="muted small">Nothing here yet.</p>
                        )}
                      </>
                    );
                  })() :
                    activeTab === 'members' ?
                      <>
                        {members.value.map((member) => (
                          <button key={member.peerId} class="member" onClick={() => onpeer?.(member.peerId)}>
                            <Avatar peerId={member.peerId} title={member.title} size={32} />
                            <span class="member-name">{member.title}</span>
                            {member.role && <span class="role">{member.role}</span>}
                          </button>
                        ))}
                        {!members.value.length && membersLoaded.value && (
                          <p class="muted small">No members to show.</p>
                        )}
                      </> :
                      activeTab === 'common' || activeTab === 'similar' ? (() => {
                        // `{@const chips = tab === 'common' ? commonGroups : similarChannels}`.
                        const chips = activeTab === 'common' ? commonGroups.value : similarChannels.value;
                        return (
                          <>
                            {chips.map((chip) => (
                              <button key={chip.peerId} class="member" onClick={() => onpeer?.(chip.peerId)}>
                                <Avatar peerId={chip.peerId} title={chip.title} size={32} />
                                <span class="member-main">
                                  <span class="member-name">{chip.title}</span>
                                  {chip.subtitle && <span class="member-sub">{chip.subtitle}</span>}
                                </span>
                              </button>
                            ))}
                            {!chips.length && chipsLoaded.value[activeTab] && (
                              <p class="muted small">Nothing to show.</p>
                            )}
                          </>
                        );
                      })() : (() => {
                        // `{@const page = shared[tab]}` of the links and list tabs.
                        const page = shared.value[activeTab];
                        return (
                          <>
                            {page.items.map((item) => (
                              <Fragment key={item.mid}>
                                <div class="entry">
                                  <div class="entry-main">
                                    {activeTab === 'links' ?
                                      <>
                                        {linksOf(item).map((url) => (
                                          <a
                                            key={url}
                                            class="entry-link"
                                            href={url}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                          >
                                            {url}
                                          </a>
                                        ))}
                                        {item.webpage?.title && <p class="entry-sub">{item.webpage.title}</p>}
                                        {!linksOf(item).length && <p class="entry-name">{item.text}</p>}
                                      </> :
                                      <>
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
                                      </>}
                                  </div>

                                  <div class="entry-actions">
                                    {(activeTab === 'music' || activeTab === 'voice') ?
                                      <button class="icon-btn" onClick={() => play(item)} aria-label="Play">
                                        <Glyph name="app" size={16} />
                                      </button> :
                                      activeTab === 'files' ?
                                        <button class="icon-btn" onClick={() => download(item)} aria-label="Download">
                                          <Glyph name="save" size={16} />
                                        </button> :
                                        null}
                                    {onjump && (
                                      <button class="icon-btn" onClick={() => onjump(item.mid)} aria-label="Go to message">
                                        <Glyph name="search" size={16} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {playingMid.value === item.mid && playingUrl.value && (
                                  <audio class="player" src={playingUrl.value} controls autoplay></audio>
                                )}
                              </Fragment>
                            ))}
                            {!page.items.length && page.loaded && (
                              <p class="muted small">Nothing here yet.</p>
                            )}
                          </>
                        );
                      })()}

                  {activeTab !== 'members' && activeTab !== 'common' && activeTab !== 'similar' && !shared.value[activeTab].isEnd && (
                    <button
                      class="more"
                      onClick={() => moreShared(activeTab as SharedTab)}
                      disabled={shared.value[activeTab].loading}
                    >
                      {shared.value[activeTab].loading ? 'Loading…' : 'Load more'}
                    </button>
                  )}

                  {activeTab === 'members' && !membersEnd.value && membersLoaded.value && (
                    <button class="more" onClick={moreMembers} disabled={membersBusy.value}>
                      {membersBusy.value ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </section>
              </>}
        </div>
      </aside>

      {lightboxIndex.value !== null && (
        <Lightbox
          peerId={peerId}
          items={lightboxItems.value}
          index={lightboxIndex.value}
          onIndexChange={(index) => (lightboxIndex.value = index)}
          onclose={() => (lightboxIndex.value = null)}
        />
      )}

      {sharePickerOpen.value && (
        <PeerPicker
          title="Share contact with"
          dialogs={shareDialogs.value}
          onpick={pickShareTarget}
          onclose={() => (sharePickerOpen.value = false)}
        />
      )}

      {qrOpen.value && info.value?.link && (
        <div class="backdrop" onClick={() => (qrOpen.value = false)} role="presentation">
          <div class="qr-card" onClick={(e) => e.stopPropagation()} role="presentation">
            <div class="qr-host" ref={setQrHost}></div>
            <p class="qr-link">{info.value.link}</p>
            <div class="link-actions">
              <button class="link-btn" onClick={() => (qrOpen.value = false)}>Close</button>
              <button class="link-btn primary" onClick={() => copy(info.value.link, 'Link')}>Copy link</button>
            </div>
          </div>
        </div>
      )}

      {managing.value && (
        <ChatAdmin
          peerId={peerId}
          onclose={() => {
            managing.value = false;
            // The chat may have been renamed, made public, or left entirely.
            loadProfile(peerId)
              .then((loaded) => (info.value = loaded))
              .catch(() => {});
          }}
          onmigrated={(newPeerId) => (onmigrated ?? onpeer)?.(newPeerId)}
          onpeer={onpeer}
        />
      )}

      {boosting.value && info.value && (
        <BoostPanel
          peerId={info.value.peerId}
          title={info.value.title}
          canCreateGiveaway={info.value.isChannel}
          onclose={() => (boosting.value = false)}
        />
      )}
    </>
  );
}
