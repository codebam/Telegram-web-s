import {bootTelegram} from './client';

/**
 * Data and storage: auto-download rules, cache usage, and the destructive
 * actions that clear them.
 *
 * Auto-download lives in tweb's shared settings state (`settings.autoDownload*`)
 * and is read and written through `appStateManager`, which persists it to the
 * cross-account common storage and fans a `settings_updated` event out to every
 * thread. Cache usage is measured on the main thread by walking the CacheStorage
 * entries and summing their `Content-Length`, the same way tweb's storage quota
 * tab does it — there is no cheaper accounting available.
 *
 * Everything crossing this seam is plain and structured-cloneable.
 */

/* ------------------------------------------------------------------ */
/* Auto-download                                                       */
/* ------------------------------------------------------------------ */

export type AutoDownloadMediaType = 'photo' | 'video' | 'file';
export type AutoDownloadPeerType = 'contacts' | 'private' | 'groups' | 'channels';

export const AUTO_DOWNLOAD_MEDIA_TYPES: {key: AutoDownloadMediaType; label: string}[] = [
  {key: 'photo', label: 'Photos'},
  {key: 'video', label: 'Videos'},
  {key: 'file', label: 'Files'}
];

export const AUTO_DOWNLOAD_PEER_TYPES: {key: AutoDownloadPeerType; label: string}[] = [
  {key: 'contacts', label: 'Contacts'},
  {key: 'private', label: 'Private chats'},
  {key: 'groups', label: 'Groups'},
  {key: 'channels', label: 'Channels'}
];

export type AutoDownloadSettings = {
  /** Master switch — when off, nothing downloads on its own. */
  enabled: boolean;
  matrix: Record<AutoDownloadMediaType, Record<AutoDownloadPeerType, boolean>>;
  photoSizeMax: number;
  videoSizeMax: number;
  fileSizeMax: number;
};

const DEFAULTS: AutoDownloadSettings = {
  enabled: true,
  matrix: {
    photo: {contacts: true, private: true, groups: true, channels: true},
    video: {contacts: true, private: true, groups: true, channels: true},
    file: {contacts: true, private: true, groups: true, channels: true}
  },
  photoSizeMax: 1048576,
  videoSizeMax: 15728640,
  fileSizeMax: 3145728
};

function readMatrix(autoDownload: any): AutoDownloadSettings['matrix'] {
  const matrix = {} as AutoDownloadSettings['matrix'];

  for(const {key: media} of AUTO_DOWNLOAD_MEDIA_TYPES) {
    const row = autoDownload?.[media] ?? {};
    matrix[media] = {} as Record<AutoDownloadPeerType, boolean>;
    for(const {key: peer} of AUTO_DOWNLOAD_PEER_TYPES) {
      matrix[media][peer] = row[peer] !== false;
    }
  }

  return matrix;
}

export async function loadAutoDownload(): Promise<AutoDownloadSettings> {
  const {managers} = await bootTelegram();

  try {
    const state: any = await managers.appStateManager.getState();
    const settings = state?.settings ?? {};
    const managerNew = settings.autoDownloadNew ?? {};

    return {
      enabled: !managerNew.pFlags?.disabled,
      matrix: readMatrix(settings.autoDownload),
      photoSizeMax: managerNew.photo_size_max ?? DEFAULTS.photoSizeMax,
      videoSizeMax: managerNew.video_size_max ?? DEFAULTS.videoSizeMax,
      fileSizeMax: managerNew.file_size_max ?? DEFAULTS.fileSizeMax
    };
  } catch(err) {
    return structuredClone(DEFAULTS);
  }
}

export async function setAutoDownloadEnabled(enabled: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  // `disabled` is a pFlag, so it is either `true` or absent — never `false`.
  await managers.appStateManager.setByKey(
    'settings.autoDownloadNew.pFlags.disabled',
    enabled ? undefined : true
  );
}

export async function setAutoDownloadRule(
  media: AutoDownloadMediaType,
  peer: AutoDownloadPeerType,
  value: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStateManager.setByKey(`settings.autoDownload.${media}.${peer}`, value);
}

const SIZE_KEY: Record<AutoDownloadMediaType, string> = {
  photo: 'photo_size_max',
  video: 'video_size_max',
  file: 'file_size_max'
};

export async function setAutoDownloadSizeLimit(
  media: AutoDownloadMediaType,
  bytes: number
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStateManager.setByKey(`settings.autoDownloadNew.${SIZE_KEY[media]}`, bytes);
}

export async function resetAutoDownload(): Promise<void> {
  const {managers} = await bootTelegram();
  const {SETTINGS_INIT} = await import('@config/state');

  // Cloned so the worker gets a detached copy rather than a live reference into
  // the shipped config module.
  const defaults: any = SETTINGS_INIT;
  await managers.appStateManager.setByKey(
    'settings.autoDownload',
    structuredClone(defaults.autoDownload ?? DEFAULTS.matrix)
  );
  await managers.appStateManager.setByKey(
    'settings.autoDownloadNew',
    structuredClone(defaults.autoDownloadNew ?? {})
  );
}

/* ------------------------------------------------------------------ */
/* Cache usage                                                         */
/* ------------------------------------------------------------------ */

export type CacheCategory = 'images' | 'videos' | 'stickers' | 'other' | 'streams';

export type CacheUsage = {
  total: number;
  byCategory: Record<CacheCategory, number>;
};

export const CACHE_CATEGORIES: {key: CacheCategory; label: string}[] = [
  {key: 'images', label: 'Photos'},
  {key: 'videos', label: 'Videos'},
  {key: 'stickers', label: 'Stickers and animations'},
  {key: 'streams', label: 'Streamed video chunks'},
  {key: 'other', label: 'Other files'}
];

function emptyUsage(): CacheUsage {
  return {
    total: 0,
    byCategory: {images: 0, videos: 0, stickers: 0, other: 0, streams: 0}
  };
}

/**
 * Walks every cached response and sums `Content-Length`. This is O(entries) and
 * touches the disk, so the UI only runs it on demand, never on open.
 */
export async function loadCacheUsage(): Promise<CacheUsage> {
  await bootTelegram();

  const usage = emptyUsage();

  try {
    const [{default: CacheStorageController}, constants] = await Promise.all([
      import('@lib/files/cacheStorage'),
      import('@lib/constants')
    ]);

    const sizeOf = (headers: Headers) =>
      parseInt(headers.get(constants.HTTPHeaderNames.contentLength) || '0') || 0;

    const files = new CacheStorageController(constants.cachedFilesStorageName as any);
    await files.minimalBlockingIterateResponses(({response}) => {
      const size = sizeOf(response.headers);
      if(!size) return;

      const contentType = response.headers.get('content-type') ?? '';
      const category: CacheCategory =
        contentType.startsWith('image/') ? 'images' :
        contentType.startsWith('video/') ? 'videos' :
        contentType.startsWith('application/json') ? 'stickers' :
        'other';

      usage.byCategory[category] += size;
      usage.total += size;
    }).finally(() => files.forget());

    for(const name of constants.cachedVideoChunksStorageNames) {
      const storage = new CacheStorageController(name as any);
      await storage.minimalBlockingIterateResponses(({response}) => {
        const size = sizeOf(response.headers);
        usage.byCategory.streams += size;
        usage.total += size;
      }).finally(() => storage.forget());
    }
  } catch(err) {
    // A browser without CacheStorage reports nothing rather than failing the tab.
  }

  return usage;
}

/**
 * Clearing is per storage, not per content type — CacheStorage has no way to
 * evict a subset by MIME. "Downloaded media" drops the file cache (photos,
 * videos, stickers and documents alike); "streamed video" drops the chunk
 * caches. The UI says as much rather than implying finer control.
 */
export type ClearTarget = 'files' | 'streams' | 'all';

export async function clearCache(target: ClearTarget): Promise<void> {
  await bootTelegram();

  const [{default: apiManagerProxy}, constants] = await Promise.all([
    import('@lib/apiManagerProxy'),
    import('@lib/constants')
  ]);

  const names =
    target === 'files' ? [constants.cachedFilesStorageName] :
    target === 'streams' ? [...constants.cachedVideoChunksStorageNames] :
    [...constants.watchedCachedStorageNames];

  // Goes through the proxy so the service worker and every other thread
  // disable, clear and re-enable the same storages in step.
  await apiManagerProxy.clearCacheStoragesByNames(names as any);
}

/* ------------------------------------------------------------------ */
/* Cache retention                                                     */
/* ------------------------------------------------------------------ */

export type CacheLimits = {
  /** Seconds an entry may sit in the cache before the eviction pass drops it. */
  ttl: number;
  /** Byte ceiling for the watched caches; 0 means no limit. */
  maxSize: number;
};

export async function loadCacheLimits(): Promise<CacheLimits> {
  const {managers} = await bootTelegram();

  try {
    const state: any = await managers.appStateManager.getState();
    return {
      ttl: state?.settings?.cacheTTL ?? 86400 * 7,
      maxSize: state?.settings?.cacheSize ?? 0
    };
  } catch(err) {
    return {ttl: 86400 * 7, maxSize: 0};
  }
}

export async function saveCacheLimits(limits: CacheLimits): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStateManager.setByKey('settings.cacheTTL', limits.ttl);
  await managers.appStateManager.setByKey('settings.cacheSize', limits.maxSize);
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export async function clearAllDrafts(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appDraftsManager.clearAllDrafts();
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatBytes(bytes: number): string {
  if(!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while(value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    ++unit;
  }

  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
