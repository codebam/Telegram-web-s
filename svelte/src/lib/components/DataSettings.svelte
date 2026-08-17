<script lang="ts">
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

  let {onerror}: {onerror: (message: string) => void} = $props();

  let auto = $state<AutoDownloadSettings | null>(null);
  let limits = $state<CacheLimits | null>(null);
  let usage = $state<CacheUsage | null>(null);
  let measuring = $state(false);
  let clearing = $state('');
  let ttlDays = $state(0);
  let status = $state('');

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
  $effect(() => {
    (async () => {
      try {
        const [settings, cacheLimits, days] = await Promise.all([
          loadAutoDownload(),
          loadCacheLimits(),
          loadAccountTTL()
        ]);
        auto = settings;
        limits = cacheLimits;
        ttlDays = days;
      } catch (err: any) {
        onerror(err?.message || 'Could not load data settings');
      }
    })();
  });

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  function sizeOf(media: AutoDownloadMediaType): number {
    if (!auto) return 0;
    return media === 'photo' ? auto.photoSizeMax : media === 'video' ? auto.videoSizeMax : auto.fileSizeMax;
  }

  async function toggleEnabled() {
    if (!auto) return;
    const next = !auto.enabled;
    auto = {...auto, enabled: next};
    try {
      await setAutoDownloadEnabled(next);
    } catch (err: any) {
      auto = {...auto, enabled: !next};
      onerror(err?.message || 'Could not update auto-download');
    }
  }

  async function toggleRule(media: AutoDownloadMediaType, peer: AutoDownloadPeerType) {
    if (!auto) return;
    const next = !auto.matrix[media][peer];
    const row = {...auto.matrix[media], [peer]: next};
    auto = {...auto, matrix: {...auto.matrix, [media]: row}};

    try {
      await setAutoDownloadRule(media, peer, next);
    } catch (err: any) {
      const reverted = {...auto.matrix[media], [peer]: !next};
      auto = {...auto, matrix: {...auto.matrix, [media]: reverted}};
      onerror(err?.message || 'Could not update auto-download');
    }
  }

  async function changeSize(media: AutoDownloadMediaType, bytes: number) {
    if (!auto) return;
    auto =
      media === 'photo' ? {...auto, photoSizeMax: bytes} :
      media === 'video' ? {...auto, videoSizeMax: bytes} :
      {...auto, fileSizeMax: bytes};

    try {
      await setAutoDownloadSizeLimit(media, bytes);
    } catch (err: any) {
      onerror(err?.message || 'Could not update the size limit');
    }
  }

  async function resetAuto() {
    try {
      await resetAutoDownload();
      auto = await loadAutoDownload();
      flash('Auto-download reset to defaults');
    } catch (err: any) {
      onerror(err?.message || 'Could not reset auto-download');
    }
  }

  async function measure() {
    measuring = true;
    try {
      usage = await loadCacheUsage();
    } catch (err: any) {
      onerror(err?.message || 'Could not measure the cache');
    } finally {
      measuring = false;
    }
  }

  async function wipe(target: ClearTarget, label: string) {
    if (!confirm(`Clear ${label}? Anything you scroll back to will download again.`)) return;

    clearing = target;
    try {
      await clearCache(target);
      // Re-measure so the freed space is visible rather than implied.
      if (usage) usage = await loadCacheUsage();
      flash(`Cleared ${label}`);
    } catch (err: any) {
      onerror(err?.message || 'Could not clear the cache');
    } finally {
      clearing = '';
    }
  }

  async function changeLimits(next: CacheLimits) {
    limits = next;
    try {
      await saveCacheLimits(next);
    } catch (err: any) {
      onerror(err?.message || 'Could not save the cache limits');
    }
  }

  async function dropDrafts() {
    if (!confirm('Clear every unsent draft in every chat? This cannot be undone.')) return;

    try {
      await clearAllDrafts();
      flash('All drafts cleared');
    } catch (err: any) {
      onerror(err?.message || 'Could not clear drafts');
    }
  }

  async function changeTTL(days: number) {
    const previous = ttlDays;
    ttlDays = days;
    try {
      await saveAccountTTL(days);
      flash('Self-destruct period updated');
    } catch (err: any) {
      ttlDays = previous;
      onerror(err?.message || 'Could not update the self-destruct period');
    }
  }

  async function confirmDelete() {
    if (
      !confirm(
        'Delete your Telegram account?\n\n' +
          'This removes your account, all your messages and all your contacts from ' +
          'Telegram permanently. It cannot be undone.'
      )
    ) {
      return;
    }

    const reason = prompt('Optionally tell Telegram why you are leaving:') ?? '';
    if (!confirm('Last chance — delete the account for good?')) return;

    try {
      await deleteAccount(reason);
      location.reload();
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not delete the account');
    }
  }
</script>

{#if status}<p class="ok">{status}</p>{/if}

<p class="label">Automatic media download</p>
{#if !auto}
  <p class="muted">Loading…</p>
{:else}
  <label class="toggle">
    <input type="checkbox" checked={auto.enabled} onchange={toggleEnabled} />
    <span>Download media automatically</span>
  </label>

  <div class="matrix" class:off={!auto.enabled}>
    <table>
      <thead>
        <tr>
          <th></th>
          {#each AUTO_DOWNLOAD_PEER_TYPES as peer}
            <th>{peer.label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each AUTO_DOWNLOAD_MEDIA_TYPES as media}
          <tr>
            <th class="row-head">{media.label}</th>
            {#each AUTO_DOWNLOAD_PEER_TYPES as peer}
              <td>
                <input
                  type="checkbox"
                  checked={auto.matrix[media.key][peer.key]}
                  disabled={!auto.enabled}
                  aria-label="{media.label} in {peer.label}"
                  onchange={() => toggleRule(media.key, peer.key)}
                />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <p class="label">Size limits</p>
  {#each AUTO_DOWNLOAD_MEDIA_TYPES as media}
    <label class="field row">
      <span>{media.label} up to</span>
      <select
        value={sizeOf(media.key)}
        disabled={!auto.enabled}
        onchange={(e) => changeSize(media.key, Number(e.currentTarget.value))}
      >
        {#each SIZE_OPTIONS[media.key] as option}
          <option value={option.bytes}>{option.label}</option>
        {/each}
      </select>
    </label>
  {/each}

  <button class="small-btn" onclick={resetAuto}>Reset to defaults</button>
{/if}

<p class="label">Storage usage</p>
{#if !usage}
  <p class="muted small">
    Measuring walks every cached file, so it runs only when you ask.
  </p>
  <button class="small-btn" onclick={measure} disabled={measuring}>
    {measuring ? 'Measuring…' : 'Calculate cache size'}
  </button>
{:else}
  <p class="balance">{formatBytes(usage.total)}</p>
  {#each CACHE_CATEGORIES as category}
    <div class="usage-row">
      <span>{category.label}</span>
      <span class="muted">{formatBytes(usage.byCategory[category.key])}</span>
    </div>
  {/each}
  <button class="small-btn" onclick={measure} disabled={measuring}>
    {measuring ? 'Measuring…' : 'Recalculate'}
  </button>
{/if}

<p class="muted small">
  The browser stores media in two caches, and neither can drop a single category
  on its own — clearing works per cache, not per media type.
</p>
<button class="danger small-btn" onclick={() => wipe('files', 'downloaded media')} disabled={!!clearing}>
  {clearing === 'files' ? 'Clearing…' : 'Clear downloaded media'}
</button>
<button class="danger small-btn" onclick={() => wipe('streams', 'streamed video chunks')} disabled={!!clearing}>
  {clearing === 'streams' ? 'Clearing…' : 'Clear streamed video'}
</button>
<button class="danger small-btn" onclick={() => wipe('all', 'the entire media cache')} disabled={!!clearing}>
  {clearing === 'all' ? 'Clearing…' : 'Clear all cached media'}
</button>

{#if limits}
  <p class="label">Keep media</p>
  <label class="field row">
    <span>For</span>
    <select
      value={limits.ttl}
      onchange={(e) => changeLimits({...limits!, ttl: Number(e.currentTarget.value)})}
    >
      {#each RETENTION_OPTIONS as option}
        <option value={option.seconds}>{option.label}</option>
      {/each}
    </select>
  </label>
  <label class="field row">
    <span>Cache size</span>
    <select
      value={limits.maxSize}
      onchange={(e) => changeLimits({...limits!, maxSize: Number(e.currentTarget.value)})}
    >
      {#each SIZE_CAP_OPTIONS as option}
        <option value={option.bytes}>{option.label}</option>
      {/each}
    </select>
  </label>
{/if}

<p class="label">Drafts</p>
<button class="danger small-btn" onclick={dropDrafts}>Clear all drafts</button>

<p class="label">Account self-destruct</p>
<p class="muted small">
  If you stay away from Telegram for this long, the account and everything in it
  is deleted.
</p>
<label class="field row">
  <span>Delete after</span>
  <select value={ttlDays} onchange={(e) => changeTTL(Number(e.currentTarget.value))}>
    {#if !TTL_OPTIONS.some((option) => option.days === ttlDays)}
      <option value={ttlDays}>{ttlDays} days</option>
    {/if}
    {#each TTL_OPTIONS as option}
      <option value={option.days}>{option.label}</option>
    {/each}
  </select>
</label>

<p class="label">Delete account</p>
<button class="danger" onclick={confirmDelete}>Delete my account</button>

<style>
  .matrix {
    overflow-x: auto;
  }

  .matrix.off {
    opacity: 0.5;
  }

  table {
    border-collapse: collapse;
    font-size: 12px;
    width: 100%;
  }

  th {
    font-weight: 500;
    color: var(--text-dim);
    padding: 4px 6px;
    text-align: center;
  }

  .row-head {
    text-align: left;
    color: var(--text);
  }

  td {
    text-align: center;
    padding: 4px 6px;
  }

  .usage-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }

  .balance {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    color: var(--accent);
  }

  .label {
    margin: 10px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field.row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  select {
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .danger,
  .small-btn {
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .danger {
    color: var(--danger);
  }

  .small-btn {
    padding: 6px 10px;
    font-size: 12px;
    justify-self: start;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }
</style>
