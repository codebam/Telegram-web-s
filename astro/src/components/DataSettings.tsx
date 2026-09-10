/*
 * Ported from svelte/src/lib/components/DataSettings.svelte.
 *
 * The `$state` values are signals, read as `.value` — including in the markup.
 * The initial load was an `$effect` that read no reactive value, so it ran once
 * per mount and is a `useEffect` with an empty dependency list; the handler it
 * calls after `await` comes from a ref, because a JSX closure would otherwise
 * reach the one from the render that started the load.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  AUTO_DOWNLOAD_MEDIA_TYPES,
  AUTO_DOWNLOAD_PEER_TYPES,
  CACHE_CATEGORIES,
  clearAllDrafts,
  clearCache,
  formatBytes,
  loadAutoDownload,
  loadCacheLimits,
  loadCacheUsage,
  resetAutoDownload,
  saveCacheLimits,
  setAutoDownloadEnabled,
  setAutoDownloadRule,
  setAutoDownloadSizeLimit,
  type AutoDownloadMediaType,
  type AutoDownloadPeerType,
  type AutoDownloadSettings,
  type CacheLimits,
  type CacheUsage,
  type ClearTarget
} from '$lib/telegram/storage';
import {
  deleteAccount,
  loadAccountTTL,
  saveAccountTTL
} from '$lib/telegram/settings';

import './DataSettings.css';

interface Props {
  onerror: (message: string) => void;
}

export function DataSettings({onerror}: Props) {
  const auto = useSignal<AutoDownloadSettings | null>(null);
  const limits = useSignal<CacheLimits | null>(null);
  const usage = useSignal<CacheUsage | null>(null);
  const measuring = useSignal(false);
  const clearing = useSignal('');
  const ttlDays = useSignal(0);
  const status = useSignal('');

  // The load effect's error path runs after an await, so the handler it needs
  // is kept current in a ref rather than captured by the closure.
  const currentOnerror = useRef(onerror);
  currentOnerror.current = onerror;

  const SIZE_OPTIONS: Record<AutoDownloadMediaType, {label: string; bytes: number}[]> = {
    photo: [
      {label: '512 KB', bytes: 524288},
      {label: '1 MB', bytes: 1048576},
      {label: '5 MB', bytes: 5242880}
    ],
    video: [
      {label: '5 MB', bytes: 5242880},
      {label: '15 MB', bytes: 15728640},
      {label: '50 MB', bytes: 52428800},
      {label: '200 MB', bytes: 209715200}
    ],
    file: [
      {label: '1 MB', bytes: 1048576},
      {label: '3 MB', bytes: 3145728},
      {label: '10 MB', bytes: 10485760},
      {label: '100 MB', bytes: 104857600}
    ]
  };

  const TTL_OPTIONS = [
    {label: '1 month', days: 30},
    {label: '3 months', days: 90},
    {label: '6 months', days: 180},
    {label: '1 year', days: 365}
  ];

  const RETENTION_OPTIONS = [
    {label: '1 day', seconds: 86400},
    {label: '1 week', seconds: 86400 * 7},
    {label: '1 month', seconds: 86400 * 30},
    {label: 'Forever', seconds: 0}
  ];

  const SIZE_CAP_OPTIONS = [
    {label: 'Automatic', bytes: 0},
    {label: '256 MB', bytes: 268435456},
    {label: '1 GB', bytes: 1073741824},
    {label: '4 GB', bytes: 4294967296}
  ];

  // Loaded once when the tab first mounts; the cache walk is deliberately not
  // part of it — it touches every cached response and runs only on request.
  useEffect(() => {
    (async() => {
      try {
        const [settings, cacheLimits, days] = await Promise.all([
          loadAutoDownload(),
          loadCacheLimits(),
          loadAccountTTL()
        ]);
        auto.value = settings;
        limits.value = cacheLimits;
        ttlDays.value = days;
      } catch(err) {
        currentOnerror.current(err?.message || 'Could not load data settings');
      }
    })();
  }, []);

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  function sizeOf(media: AutoDownloadMediaType): number {
    if(!auto.value) return 0;
    return media === 'photo' ? auto.value.photoSizeMax : media === 'video' ? auto.value.videoSizeMax : auto.value.fileSizeMax;
  }

  async function toggleEnabled() {
    if(!auto.value) return;
    const next = !auto.value.enabled;
    auto.value = {...auto.value, enabled: next};
    try {
      await setAutoDownloadEnabled(next);
    } catch(err) {
      auto.value = {...auto.value, enabled: !next};
      onerror(err?.message || 'Could not update auto-download');
    }
  }

  async function toggleRule(media: AutoDownloadMediaType, peer: AutoDownloadPeerType) {
    if(!auto.value) return;
    const next = !auto.value.matrix[media][peer];
    const row = {...auto.value.matrix[media], [peer]: next};
    auto.value = {...auto.value, matrix: {...auto.value.matrix, [media]: row}};

    try {
      await setAutoDownloadRule(media, peer, next);
    } catch(err) {
      const reverted = {...auto.value.matrix[media], [peer]: !next};
      auto.value = {...auto.value, matrix: {...auto.value.matrix, [media]: reverted}};
      onerror(err?.message || 'Could not update auto-download');
    }
  }

  async function changeSize(media: AutoDownloadMediaType, bytes: number) {
    if(!auto.value) return;
    auto.value =
      media === 'photo' ? {...auto.value, photoSizeMax: bytes} :
      media === 'video' ? {...auto.value, videoSizeMax: bytes} :
      {...auto.value, fileSizeMax: bytes};

    try {
      await setAutoDownloadSizeLimit(media, bytes);
    } catch(err) {
      onerror(err?.message || 'Could not update the size limit');
    }
  }

  async function resetAuto() {
    try {
      await resetAutoDownload();
      auto.value = await loadAutoDownload();
      flash('Auto-download reset to defaults');
    } catch(err) {
      onerror(err?.message || 'Could not reset auto-download');
    }
  }

  async function measure() {
    measuring.value = true;
    try {
      usage.value = await loadCacheUsage();
    } catch(err) {
      onerror(err?.message || 'Could not measure the cache');
    } finally {
      measuring.value = false;
    }
  }

  async function wipe(target: ClearTarget, label: string) {
    if(!confirm(`Clear ${label}? Anything you scroll back to will download again.`)) return;

    clearing.value = target;
    try {
      await clearCache(target);
      // Re-measure so the freed space is visible rather than implied.
      if(usage.value) usage.value = await loadCacheUsage();
      flash(`Cleared ${label}`);
    } catch(err) {
      onerror(err?.message || 'Could not clear the cache');
    } finally {
      clearing.value = '';
    }
  }

  async function changeLimits(next: CacheLimits) {
    limits.value = next;
    try {
      await saveCacheLimits(next);
    } catch(err) {
      onerror(err?.message || 'Could not save the cache limits');
    }
  }

  async function dropDrafts() {
    if(!confirm('Clear every unsent draft in every chat? This cannot be undone.')) return;

    try {
      await clearAllDrafts();
      flash('All drafts cleared');
    } catch(err) {
      onerror(err?.message || 'Could not clear drafts');
    }
  }

  async function changeTTL(days: number) {
    const previous = ttlDays.value;
    ttlDays.value = days;
    try {
      await saveAccountTTL(days);
      flash('Self-destruct period updated');
    } catch(err) {
      ttlDays.value = previous;
      onerror(err?.message || 'Could not update the self-destruct period');
    }
  }

  async function confirmDelete() {
    if(
      !confirm(
        'Delete your Telegram account?\n\n' +
          'This removes your account, all your messages and all your contacts from ' +
          'Telegram permanently. It cannot be undone.'
      )
    ) {
      return;
    }

    const reason = prompt('Optionally tell Telegram why you are leaving:') ?? '';
    if(!confirm('Last chance — delete the account for good?')) return;

    try {
      await deleteAccount(reason);
      location.reload();
    } catch(err) {
      onerror(err?.type || err?.message || 'Could not delete the account');
    }
  }

  return (
    <>
      {status.value && <p class="ok">{status.value}</p>}

      <p class="label">Automatic media download</p>
      {!auto.value ?
        <p class="muted">Loading…</p> :
        <>
          <label class="toggle">
            <input type="checkbox" checked={auto.value.enabled} onChange={toggleEnabled} />
            <span>Download media automatically</span>
          </label>

          <div class={['matrix', !auto.value.enabled && 'off'].filter(Boolean).join(' ')}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  {AUTO_DOWNLOAD_PEER_TYPES.map((peer, i) => (
                    <th key={i}>{peer.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AUTO_DOWNLOAD_MEDIA_TYPES.map((media, i) => (
                  <tr key={i}>
                    <th class="row-head">{media.label}</th>
                    {AUTO_DOWNLOAD_PEER_TYPES.map((peer, j) => (
                      <td key={j}>
                        <input
                          type="checkbox"
                          checked={auto.value.matrix[media.key][peer.key]}
                          disabled={!auto.value.enabled}
                          aria-label={`${media.label} in ${peer.label}`}
                          onChange={() => toggleRule(media.key, peer.key)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p class="label">Size limits</p>
          {AUTO_DOWNLOAD_MEDIA_TYPES.map((media, i) => (
            <label key={i} class="field row">
              <span>{media.label} up to</span>
              <select
                value={sizeOf(media.key)}
                disabled={!auto.value.enabled}
                onChange={(e) => changeSize(media.key, Number(e.currentTarget.value))}
              >
                {SIZE_OPTIONS[media.key].map((option, j) => (
                  <option key={j} value={option.bytes}>{option.label}</option>
                ))}
              </select>
            </label>
          ))}

          <button class="small-btn" onClick={resetAuto}>Reset to defaults</button>
        </>
      }

      <p class="label">Storage usage</p>
      {!usage.value ?
        <>
          <p class="muted small">
            Measuring walks every cached file, so it runs only when you ask.
          </p>
          <button class="small-btn" onClick={measure} disabled={measuring.value}>
            {measuring.value ? 'Measuring…' : 'Calculate cache size'}
          </button>
        </> :
        <>
          <p class="balance">{formatBytes(usage.value.total)}</p>
          {CACHE_CATEGORIES.map((category, i) => (
            <div key={i} class="usage-row">
              <span>{category.label}</span>
              <span class="muted">{formatBytes(usage.value.byCategory[category.key])}</span>
            </div>
          ))}
          <button class="small-btn" onClick={measure} disabled={measuring.value}>
            {measuring.value ? 'Measuring…' : 'Recalculate'}
          </button>
        </>
      }

      <p class="muted small">
        The browser stores media in two caches, and neither can drop a single category
        on its own — clearing works per cache, not per media type.
      </p>
      <button class="danger small-btn" onClick={() => wipe('files', 'downloaded media')} disabled={!!clearing.value}>
        {clearing.value === 'files' ? 'Clearing…' : 'Clear downloaded media'}
      </button>
      <button class="danger small-btn" onClick={() => wipe('streams', 'streamed video chunks')} disabled={!!clearing.value}>
        {clearing.value === 'streams' ? 'Clearing…' : 'Clear streamed video'}
      </button>
      <button class="danger small-btn" onClick={() => wipe('all', 'the entire media cache')} disabled={!!clearing.value}>
        {clearing.value === 'all' ? 'Clearing…' : 'Clear all cached media'}
      </button>

      {limits.value && (
        <>
          <p class="label">Keep media</p>
          <label class="field row">
            <span>For</span>
            <select
              value={limits.value.ttl}
              onChange={(e) => changeLimits({...limits.value!, ttl: Number(e.currentTarget.value)})}
            >
              {RETENTION_OPTIONS.map((option, i) => (
                <option key={i} value={option.seconds}>{option.label}</option>
              ))}
            </select>
          </label>
          <label class="field row">
            <span>Cache size</span>
            <select
              value={limits.value.maxSize}
              onChange={(e) => changeLimits({...limits.value!, maxSize: Number(e.currentTarget.value)})}
            >
              {SIZE_CAP_OPTIONS.map((option, i) => (
                <option key={i} value={option.bytes}>{option.label}</option>
              ))}
            </select>
          </label>
        </>
      )}

      <p class="label">Drafts</p>
      <button class="danger small-btn" onClick={dropDrafts}>Clear all drafts</button>

      <p class="label">Account self-destruct</p>
      <p class="muted small">
        If you stay away from Telegram for this long, the account and everything in it
        is deleted.
      </p>
      <label class="field row">
        <span>Delete after</span>
        <select value={ttlDays.value} onChange={(e) => changeTTL(Number(e.currentTarget.value))}>
          {!TTL_OPTIONS.some((option) => option.days === ttlDays.value) && (
            <option value={ttlDays.value}>{ttlDays.value} days</option>
          )}
          {TTL_OPTIONS.map((option, i) => (
            <option key={i} value={option.days}>{option.label}</option>
          ))}
        </select>
      </label>

      <p class="label">Delete account</p>
      <button class="danger" onClick={confirmDelete}>Delete my account</button>
    </>
  );
}
