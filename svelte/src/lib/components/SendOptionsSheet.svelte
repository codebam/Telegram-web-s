<script lang="ts">
  import {untrack} from 'svelte';
  import {
    MIN_SCHEDULE_LEAD_SECONDS,
    SEND_WHEN_ONLINE,
    setSilentByDefault
  } from '$lib/telegram/sendOptions';

  let {
    peerId,
    isUser = false,
    defaultSilent = false,
    onsend,
    onclose
  }: {
    peerId: number;
    /** "Send when online" only exists for a private chat. */
    isUser?: boolean;
    defaultSilent?: boolean;
    onsend: (options: {scheduleDate?: number; silent: boolean}) => void;
    onclose: () => void;
  } = $props();

  /** `datetime-local` wants a local-time string with no zone suffix. */
  function toLocalInput(date: Date) {
    const pad = (value: number) => `${value}`.padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  // Seeded once: an hour out is the default the official clients offer.
  let when = $state(untrack(() => toLocalInput(new Date(Date.now() + 60 * 60 * 1000))));
  let silent = $state(untrack(() => defaultSilent));
  let remember = $state(untrack(() => defaultSilent));
  let error = $state('');

  const minWhen = $derived(toLocalInput(new Date(Date.now() + MIN_SCHEDULE_LEAD_SECONDS * 1000)));

  function persist() {
    // Only write when the user asked us to remember, so a one-off silent send
    // does not quietly mute the chat forever.
    if (remember) setSilentByDefault(peerId, silent);
  }

  function sendNow() {
    persist();
    onsend({silent});
  }

  function sendWhenOnline() {
    persist();
    onsend({scheduleDate: SEND_WHEN_ONLINE, silent});
  }

  function schedule() {
    const at = new Date(when);
    const seconds = Math.floor(at.getTime() / 1000);
    if (!seconds || Number.isNaN(seconds)) {
      error = 'Pick a date and time.';
      return;
    }
    if (seconds <= Math.floor(Date.now() / 1000) + MIN_SCHEDULE_LEAD_SECONDS) {
      error = 'Pick a time at least a few seconds from now.';
      return;
    }
    persist();
    onsend({scheduleDate: seconds, silent});
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>Send when…</header>

    <label class="field">
      <span>Date and time</span>
      <input type="datetime-local" bind:value={when} min={minWhen} />
    </label>

    <div class="toggles">
      <button
        type="button"
        class="pill"
        class:on={silent}
        onclick={() => (silent = !silent)}
        title="The recipients get no notification sound"
      >Send without sound</button>
      <label class="remember">
        <input type="checkbox" bind:checked={remember} />
        Remember for this chat
      </label>
    </div>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <footer>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="button" onclick={sendNow}>Send now</button>
      {#if isUser}
        <button type="button" onclick={sendWhenOnline}>Send when online</button>
      {/if}
      <button type="button" class="primary" onclick={schedule}>Schedule</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 98;
  }

  .sheet {
    width: min(420px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 18px;
    background: var(--bg-solid, var(--bg-elevated));
    border: 1px solid var(--border);
    border-radius: 14px;
  }

  header {
    font-weight: 600;
    font-size: 17px;
  }

  .field {
    display: grid;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font-size: 14px;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .toggles {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .pill {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .pill.on {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  .remember {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
    cursor: pointer;
  }

  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger, #e05c5c);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-wrap: wrap;
  }

  footer button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  footer .primary {
    background: var(--action, var(--accent));
    border-color: transparent;
    color: var(--action-ink, #fff);
    font-weight: 600;
  }
</style>
