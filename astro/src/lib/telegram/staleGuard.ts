/**
 * Recovery from a stale cached build.
 *
 * tweb's service worker caches every same-origin asset into one `cachedAssets`
 * cache, cache-first, with no version key — nothing ever evicts it. Combined
 * with an old registration pointing at a hashed worker URL that no longer
 * exists, a deploy could leave a browser pinned to the previous build until the
 * user cleared storage by hand.
 *
 * Two defences, in order of preference:
 *  1. On boot, if the build id changed, drop the asset cache so the new shell
 *     is fetched from the network.
 *  2. If a module still fails to load — the tell-tale being HTML arriving where
 *     JavaScript was expected — purge everything and reload once.
 */

const BUILD_KEY = 'tweb-svelte:build';
const RELOAD_KEY = 'tweb-svelte:recovered';
const ASSET_CACHE = 'cachedAssets';

declare const __BUILD_ID__: string;

/** Drop the service worker's asset cache when the build id changes. */
export async function purgeStaleAssets(): Promise<void> {
  if(typeof caches === 'undefined') return;

  const current = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
  const previous = localStorage.getItem(BUILD_KEY);
  if(previous === current) return;

  try {
    await caches.delete(ASSET_CACHE);
  } catch(err) {
    // A failed purge is not fatal — the reload guard below still covers us.
  }

  localStorage.setItem(BUILD_KEY, current);
  // A fresh build is a fresh chance to recover.
  sessionStorage.removeItem(RELOAD_KEY);
}

/**
 * Last resort: a chunk failed to load, almost always because a stale cache or
 * an SPA fallback handed back index.html for a missing hashed file. Clear
 * every cache, unregister the workers, and reload — once per session, so a
 * genuine failure cannot become a reload loop.
 */
export function installStaleRecovery(): void {
  const looksStale = (message: string) =>
    /Failed to fetch dynamically imported module|Importing a module script failed|Unexpected token '<'|expected expression, got '<'/i.test(message);

  const recover = async() => {
    if(sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, '1');

    try {
      if(typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }

      const registrations = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
    } catch(err) {
      // Fall through to the reload regardless.
    }

    location.reload();
  };

  window.addEventListener('error', (event) => {
    if(looksStale(event.message ?? '')) recover();
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: any = event.reason;
    if(looksStale(reason?.message ?? String(reason ?? ''))) recover();
  });
}
