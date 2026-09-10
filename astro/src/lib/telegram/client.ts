import type {ProxiedManagers} from '@lib/getProxiedManagers';
import type {AuthState} from '@types';

/**
 * Boots the tweb MTProto stack for the Svelte client.
 *
 * The whole lib layer (`../../src/lib`) is framework-agnostic: managers live in
 * a SharedWorker and are reached through a proxy. This is the minimal subset of
 * `src/index.ts`'s DOMContentLoaded sequence needed before any `invokeApi` call:
 * polyfills, worker-URL hook, proxied managers, state load + push to the worker,
 * environment handshake.
 *
 * Everything is imported dynamically so nothing touches `window` until the
 * browser actually runs this (SvelteKit SSR is off, but prerender/build still
 * evaluates modules).
 */
export type TelegramClient = {
  managers: ProxiedManagers;
  authState: AuthState;
};

let bootPromise: Promise<TelegramClient> | undefined;

export function bootTelegram(): Promise<TelegramClient> {
  return (bootPromise ??= doBoot());
}

async function doBoot(): Promise<TelegramClient> {
  // Order matters: polyfills patch prototypes the rest of the lib assumes.
  await import('@lib/polyfill');
  await import('@helpers/peerIdPolyfill');

  const [
    {default: setWorkerProxy},
    {default: rootScope},
    {default: getProxiedManagers},
    {default: apiManagerProxy},
    {getCurrentAccount}
  ] = await Promise.all([
    import('@helpers/setWorkerProxy'),
    import('@lib/rootScope'),
    import('@lib/getProxiedManagers'),
    import('@lib/apiManagerProxy'),
    import('@lib/accounts/getCurrentAccount')
  ]);

  // Propagates ?test=1 / ?debug=1 into every Worker/SharedWorker URL.
  setWorkerProxy();

  const managers = (rootScope.managers = getProxiedManagers());

  const allStates = await apiManagerProxy.loadAllStates();
  await apiManagerProxy.sendAllStates(allStates);
  apiManagerProxy.sendEnvironment();

  // Hydrate the main-thread settings store. The calls stack reads the saved
  // microphone, camera and speaker ids from it when it acquires media
  // (`getAudioConstraints` / `getVideoConstraints`), and main-thread tweb
  // modules read theme and time settings from it too. tweb does this during its
  // own boot; this client never did, so a chosen device was invisible to
  // `getStream` and every call opened on the OS defaults.
  try {
    const [{default: commonStateStorage}, {setAppSettingsSilent}] = await Promise.all([
      import('@lib/commonStateStorage'),
      import('@stores/appSettings')
    ]);
    const settings = await commonStateStorage.get('settings');
    settings && setAppSettingsSilent(settings);
  } catch(err) {
    console.warn('Failed to load the persisted settings', err);
  }

  // Main-thread singletons that tweb wires up in appDialogsManager.start().
  // Without this the download manager has no `managers` and every media
  // download throws "Cannot read properties of undefined (reading
  // 'apiFileManager')".
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');
  appDownloadManager.construct(managers as any);

  // Register this tab with the worker. Several worker-side flows deliver to a
  // *known* tab rather than broadcasting — call updates are routed with
  // appTabsManager.getTabs(), which only counts tabs that have sent their
  // state. Without this a call is created and then never progresses, because
  // its phoneCall updates have nowhere to go.
  apiManagerProxy.updateTabState('idleStartTime', 0);

  const authState = allStates[getCurrentAccount()].state.authState;

  // Only an account that already has a session may run the signed-in boot work.
  // The rest of the app starts it on sign-in — see `startSignedInServices`.
  if (authState._ === 'authStateSignedIn') {
    await startSignedInServices(managers);
  }

  return {managers, authState};
}

/**
 * Boot work that only makes sense once there is a session: the updates loop and
 * the content-restriction warm-up. Both call account-only methods
 * (`updates.getState`, `account.getContentSettings`), which the server answers
 * with AUTH_KEY_UNREGISTERED (401) while the tab is still on the sign-in
 * screen. tweb's api layer reads a 401 as a dead session: it logs the account
 * out, and this client answers `logging_out` by reloading the page. Running
 * this before login therefore cleared storage and reloaded every few seconds —
 * the sign-in form was wiped before it could be submitted, over and over.
 *
 * Called during boot for a stored session, and again from `markSignedIn()` when
 * the user finishes signing in. `attach()` is idempotent and the warm-up is
 * memoised in `restrictions.ts`, so a second call is harmless.
 */
export async function startSignedInServices(managers: ProxiedManagers): Promise<void> {
  // Subscribe to server updates. Without this the worker never opens the
  // updates loop, so nothing arrives after load: no incoming messages, no
  // deletions, no edits — only the local echo of what we send ourselves.
  // tweb does this from uiNotificationsManager, which the IM bootstrap starts
  // and we never run.
  await managers.apiUpdatesManager.attach().catch((err) => {
    // A failure here must not fail the sign-in that triggered it.
    console.warn('Failed to attach the updates loop', err);
  });

  // Warm the content-restriction settings here so the first history load never
  // pays for them on the chat-open path.
  import('./restrictions')
    .then(({warmRestrictionSettings}) => warmRestrictionSettings())
    .catch(() => {});
}
