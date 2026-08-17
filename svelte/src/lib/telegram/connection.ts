/**
 * Live connection state for the status bar above the chat list.
 *
 * This is the state machine from tweb's `src/components/connectionStatus.ts`,
 * lifted out of its DOM component. Two independent signals feed it:
 *
 *  - `connection_status_change` — per-networker socket state. Only the base
 *    DC's *client* networker (`NET-<baseDcId>`) decides whether we are online;
 *    file up/download networkers come and go constantly and would flap the bar.
 *  - `state_synchronizing` / `state_synchronized` — the updates loop fetching
 *    the difference. Socket-connected but mid-difference is "Updating", not
 *    "Connected".
 *
 * `hadConnect` is what separates a first-ever connect ("Waiting for network")
 * from a dropped one ("Connecting"), matching tweb's wording.
 */
export type ConnectionState = 'connected' | 'connecting' | 'waitingForNetwork' | 'updating';

export const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connected: '',
  connecting: 'Connecting…',
  waitingForNetwork: 'Waiting for network…',
  updating: 'Updating…'
};

/**
 * Subscribe to the connection state. Returns an unsubscribe function that is
 * safe to call before the async wiring has finished.
 */
export function subscribeConnection(onState: (state: ConnectionState) => void): () => void {
  let cancelled = false;
  const teardown: Array<() => void> = [];

  (async() => {
    const [{default: rootScope}, {ConnectionStatus}, {bootTelegram}] = await Promise.all([
      import('@lib/rootScope'),
      import('@lib/mtproto/connectionStatus'),
      import('./client')
    ]);

    if(cancelled) return;

    const {managers} = await bootTelegram();
    if(cancelled) return;

    // The account's home DC — the only networker whose state means "online".
    let baseDcId: number;
    try {
      baseDcId = await managers.apiManager.getBaseDcId();
    } catch(err) {
      return;
    }
    if(!baseDcId) baseDcId = (await import('@config/app')).default.baseDcId;
    if(cancelled) return;

    /**
     * The networkers live in the worker, so the statuses this tab has are only
     * the ones it was listening for. The socket is normally up long before this
     * subscribes — and a status that never changes never fires an event — so
     * the map has to be seeded from the worker or the bar sits on
     * "Waiting for network" for the whole session.
     */
    let statuses: Record<string, {status: number; name: string}> = {};
    try {
      statuses = {...((await managers.rootScope.getConnectionStatus()) as any)};
    } catch(err) {}
    if(cancelled) return;

    let hadConnect = false;
    let connecting = false;
    let timedOut = false;
    let updating = false;
    let last: ConnectionState | undefined;

    const emit = () => {
      let state: ConnectionState;
      if(connecting) {
        if(timedOut) state = 'updating';
        else if(hadConnect) state = 'connecting';
        else state = 'waitingForNetwork';
      } else if(updating) {
        state = 'updating';
      } else {
        state = 'connected';
      }

      // The browser knowing it is offline outranks a socket that has not
      // noticed yet.
      if(state !== 'connected' && typeof navigator !== 'undefined' && navigator.onLine === false) {
        state = 'waitingForNetwork';
      }

      if(state === last) return;
      last = state;
      onState(state);
    };

    const applyStatus = () => {
      const status = statuses['NET-' + baseDcId];
      const online = !!status && status.status === ConnectionStatus.Connected;

      if(online) hadConnect = true;
      timedOut = !!status && status.status === ConnectionStatus.TimedOut;
      connecting = !online;
      emit();
    };

    const onStatusChange = (status?: any) => {
      if(status?.name) statuses[status.name] = status;
      applyStatus();
    };
    const onSyncing = () => {
      updating = true;
      emit();
    };
    const onSynced = () => {
      updating = false;
      emit();
    };

    rootScope.addEventListener('connection_status_change', onStatusChange);
    rootScope.addEventListener('state_synchronizing', onSyncing);
    rootScope.addEventListener('state_synchronized', onSynced);
    teardown.push(() => {
      rootScope.removeEventListener('connection_status_change', onStatusChange);
      rootScope.removeEventListener('state_synchronizing', onSyncing);
      rootScope.removeEventListener('state_synchronized', onSynced);
    });

    if(typeof window !== 'undefined') {
      window.addEventListener('online', onStatusChange);
      window.addEventListener('offline', onStatusChange);
      teardown.push(() => {
        window.removeEventListener('online', onStatusChange);
        window.removeEventListener('offline', onStatusChange);
      });
    }

    // Seed from whatever the proxy already knows — a tab that connected before
    // this component mounted would otherwise sit on a stale "connecting".
    applyStatus();
  })().catch(() => {});

  return () => {
    cancelled = true;
    for(const off of teardown) off();
    teardown.length = 0;
  };
}
