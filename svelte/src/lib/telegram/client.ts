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

  // Subscribe to server updates. Without this the worker never opens the
  // updates loop, so nothing arrives after load: no incoming messages, no
  // deletions, no edits — only the local echo of what we send ourselves.
  // tweb does this from uiNotificationsManager, which the IM bootstrap starts
  // and we never run.
  await managers.apiUpdatesManager.attach();

  return {
    managers,
    authState: allStates[getCurrentAccount()].state.authState
  };
}
