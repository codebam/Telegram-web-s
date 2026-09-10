import {bootTelegram} from './client';
import {getPresence, loadDialogs, type DialogItem} from './chats';

/**
 * Archive, folder membership and pinned ordering — everything the chat list
 * needs beyond the plain dialog fetch in `chats.ts`.
 *
 * Same hard rule as `chats.ts`: nothing raw leaves this module. Every value
 * handed to Svelte is a plain, structured-cloneable literal, because a `$state`
 * proxy cannot be posted back to the worker.
 */

/** tweb's REAL_FOLDER_ID values — the two folders the server itself knows. */
export const FOLDER_ID_ALL = 0;
export const FOLDER_ID_ARCHIVE = 1;

export type ArchiveSummary = {
  /** Archived chats currently loaded. */
  total: number;
  /** Unmuted archived chats with something unread — what the badge shows. */
  unread: number;
};

export async function loadArchivedDialogs(limit = 40): Promise<DialogItem[]> {
  return loadDialogs(limit, FOLDER_ID_ARCHIVE);
}

/** Count + badge for the archive entry at the top of the chat list. */
export async function getArchiveSummary(limit = 100): Promise<ArchiveSummary> {
  const {managers} = await bootTelegram();

  try {
    const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId: FOLDER_ID_ARCHIVE});
    const now = Date.now() / 1000;
    const list = dialogs ?? [];
    const unread = list.filter((dialog: any) => {
      const muted = (dialog.notify_settings?.mute_until ?? 0) > now;
      return !muted && ((dialog.unread_count ?? 0) > 0 || dialog.pFlags?.unread_mark);
    }).length;

    return {total: list.length, unread};
  } catch(err) {
    return {total: 0, unread: 0};
  }
}

/**
 * Move a chat in or out of the archive. `folders.editPeerFolders` is what the
 * archive is made of — there is no separate flag on the dialog.
 */
export async function setDialogArchived(peerId: number, archived: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.editPeerFolders(
    [peerId],
    (archived ? FOLDER_ID_ARCHIVE : FOLDER_ID_ALL) as any
  );
}

export async function isDialogArchived(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  const dialog: any = await managers.appMessagesManager.getDialogOnly(peerId);
  return (dialog?.folder_id ?? FOLDER_ID_ALL) === FOLDER_ID_ARCHIVE;
}

export type FolderMembership = {
  folderId: number;
  title: string;
  emoticon: string;
  /** Whether the chat is in this folder right now. */
  included: boolean;
};

function filterTitle(filter: any): string {
  return typeof filter?.title === 'string' ? filter.title : (filter?.title?.text ?? 'Folder');
}

/** Custom folders (the built-in All/Archive are not memberships) plus this chat's state in each. */
export async function loadFolderMemberships(peerId: number): Promise<FolderMembership[]> {
  const {managers} = await bootTelegram();

  try {
    const filters: any[] = await managers.filtersStorage.getDialogFilters();
    return (filters ?? [])
    .filter((filter) => filter?.id > FOLDER_ID_ARCHIVE)
    .sort((a, b) => (a.localId ?? 0) - (b.localId ?? 0))
    .map((filter) => ({
      folderId: filter.id,
      title: filterTitle(filter),
      emoticon: filter.emoticon ?? '',
      included:
        (filter.includePeerIds ?? []).some((id: any) => Number(id) === peerId) ||
        (filter.pinnedPeerIds ?? []).some((id: any) => Number(id) === peerId)
    }));
  } catch(err) {
    return [];
  }
}

/**
 * Add or remove a chat from a folder, the way Web K's addToFolderDropdownMenu
 * does it: adding also clears an explicit exclusion, removing also drops the
 * pin and records an exclusion so a broad `contacts`/`groups` rule cannot pull
 * the chat straight back in.
 */
export async function toggleFolderMembership(
  folderId: number,
  peerId: number,
  include: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  const filter: any = await managers.filtersStorage.getFilter(folderId);
  if(!filter) throw new Error('Folder not found');

  const inputPeer = await managers.appPeersManager.getInputPeerById(peerId);
  const without = (ids: any[]) => (ids ?? []).filter((id: any) => Number(id) !== peerId);
  const withoutPeers = (peers: any[], ids: any[]) =>
    (peers ?? []).filter((_: any, index: number) => Number((ids ?? [])[index]) !== peerId);

  const next: any = {
    ...filter,
    includePeerIds: without(filter.includePeerIds),
    include_peers: withoutPeers(filter.include_peers, filter.includePeerIds)
  };

  if(include) {
    if(filter._ === 'dialogFilter') {
      next.excludePeerIds = without(filter.excludePeerIds);
      next.exclude_peers = withoutPeers(filter.exclude_peers, filter.excludePeerIds);
    }

    const pinned = (filter.pinnedPeerIds ?? []).some((id: any) => Number(id) === peerId);
    if(!pinned) {
      next.includePeerIds = [...next.includePeerIds, peerId];
      next.include_peers = [...next.include_peers, inputPeer];
    }
  } else {
    next.pinnedPeerIds = without(filter.pinnedPeerIds);
    next.pinned_peers = withoutPeers(filter.pinned_peers, filter.pinnedPeerIds);

    if(filter._ === 'dialogFilter') {
      next.excludePeerIds = [...without(filter.excludePeerIds), peerId];
      next.exclude_peers = [...withoutPeers(filter.exclude_peers, filter.excludePeerIds), inputPeer];
    }
  }

  await managers.filtersStorage.updateDialogFilter(next);
}

/**
 * Persist a new order for a folder's pinned chats.
 *
 * tweb had no manager method for this at all — `messages.reorderPinnedDialogs`
 * was never wired up — so `appMessagesManager.reorderPinnedDialogs` was added
 * alongside `filtersStorage.reorderPinnedPeers` for custom folders. `order` is
 * the pinned peers top-first.
 */
export async function reorderPinnedDialogs(order: number[], filterId = FOLDER_ID_ALL): Promise<void> {
  if(!order.length) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.reorderPinnedDialogs({order, filterId});
}

/** Online state for the dot on a private chat's row. */
export async function isPeerOnline(peerId: number): Promise<boolean> {
  try {
    return (await getPresence(peerId)).online;
  } catch(err) {
    return false;
  }
}
