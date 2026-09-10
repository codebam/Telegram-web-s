/*
 * A new Astro-only settings pane (no Svelte original): Speakers & Camera.
 *
 * The call stack already reads a stored device choice every time it acquires a
 * stream — `getAudioConstraints` / `getVideoConstraints` look it up in the
 * main-thread `appSettings` store — but nothing in either client could set one.
 * This pane lists the browser's devices, persists the pick through
 * `setCallDevice` (which also swaps the device on a call that is already
 * running) and toggles noise suppression.
 *
 * Styling is global (`.call-settings*` in styles/app.css) because a new
 * component has no Svelte stylesheet for the verbatim-copy rule to compare
 * against.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  loadCallDevices,
  setCallDevice,
  setCallNoiseSuppression,
  type CallDeviceKind,
  type CallDevices
} from '$lib/telegram/extras';

const ROWS: {kind: CallDeviceKind; label: string; hint: string}[] = [
  {kind: 'microphone', label: 'Microphone', hint: 'Used for voice and video calls.'},
  {kind: 'speaker', label: 'Speakers', hint: 'Where the other side is played.'},
  {kind: 'camera', label: 'Camera', hint: 'Used when you turn on video.'}
];

export function CallSettings() {
  const devices = useSignal<CallDevices | null>(null);
  const error = useSignal('');
  const busy = useSignal(false);

  async function refresh() {
    try {
      devices.value = await loadCallDevices();
    } catch(err: any) {
      error.value = err?.message || 'Failed to list the devices';
    }
  }

  useEffect(() => {
    refresh();
    const media = navigator.mediaDevices;
    if(media?.addEventListener) {
      media.addEventListener('devicechange', refresh);
      return () => media.removeEventListener('devicechange', refresh);
    }
  }, []);

  async function pick(kind: CallDeviceKind, id: string) {
    if(!devices.value || busy.value || devices.value.selected[kind] === id) return;

    const previous = devices.value.selected[kind];
    busy.value = true;
    error.value = '';
    // Optimistic: the select already shows the new value; roll it back if the
    // live swap fails.
    devices.value = {...devices.value, selected: {...devices.value.selected, [kind]: id}};

    try {
      await setCallDevice(kind, id);
      // `getStream` may have cleared a stale id during its own fallback, so read
      // the store back rather than trusting the optimistic value.
      devices.value = await loadCallDevices();
    } catch(err: any) {
      devices.value = {...devices.value, selected: {...devices.value.selected, [kind]: previous}};
      error.value = err?.type || err?.message || `Failed to switch the ${kind}`;
    } finally {
      busy.value = false;
    }
  }

  async function toggleNoiseSuppression(enabled: boolean) {
    if(!devices.value) return;
    const previous = devices.value.noiseSuppression;
    devices.value = {...devices.value, noiseSuppression: enabled};

    try {
      await setCallNoiseSuppression(enabled);
    } catch(err: any) {
      devices.value = {...devices.value, noiseSuppression: previous};
      error.value = err?.type || err?.message || 'Failed to change noise suppression';
    }
  }

  if(!devices.value) {
    return <p class="call-settings-hint">Loading devices…</p>;
  }

  return (
    <div class="call-settings">
      {ROWS.map(({kind, label, hint}) => (
        <label key={kind} class="call-device">
          <span>{label}</span>
          <select
            value={devices.value!.selected[kind]}
            disabled={busy.value}
            onChange={(e) => pick(kind, (e.target as HTMLSelectElement).value)}
          >
            <option value="">Default</option>
            {devices.value![kind].map((device) => (
              <option key={device.id} value={device.id}>{device.label}</option>
            ))}
          </select>
          <span class="call-settings-hint">{hint}</span>
        </label>
      ))}

      <label class="call-toggle">
        <input
          type="checkbox"
          checked={devices.value.noiseSuppression}
          onChange={(e) => toggleNoiseSuppression((e.target as HTMLInputElement).checked)}
        />
        <span>Filter background noise</span>
      </label>

      <p class="call-settings-hint">
        Device names appear once this site has permission to use them — place a
        call, or pick a device, and the list fills in.
      </p>

      {error.value && <p class="call-settings-error">{error.value}</p>}
    </div>
  );
}
