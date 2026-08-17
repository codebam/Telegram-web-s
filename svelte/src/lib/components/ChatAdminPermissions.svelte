<script lang="ts">
  import {
    PERMISSION_LABELS,
    PERMISSION_ORDER,
    SLOW_MODE_OPTIONS,
    saveDefaultPermissions,
    setSlowMode,
    type AdminChat,
    type PermissionKey,
    type Permissions
  } from '$lib/telegram/admin';

  let {chat, onchanged}: {chat: AdminChat; onchanged: () => void} = $props();

  // A plain object, deliberately not a `$state` proxy field-by-field: the whole
  // thing is handed back to the worker on save, and a proxy would not survive
  // structured cloning.
  let permissions = $state<Permissions>({...chat.permissions});
  let slowMode = $state(chat.slowModeSeconds);

  let busy = $state(false);
  let error = $state('');
  let status = $state('');

  // Topics only exist in a forum, so hide the switch that would do nothing.
  let keys = $derived(
    PERMISSION_ORDER.filter((key) => key !== 'topics' || chat.isForum)
  );

  let dirty = $derived(keys.some((key) => permissions[key] !== chat.permissions[key]));

  function toggle(key: PermissionKey) {
    permissions = {...permissions, [key]: !permissions[key]};
  }

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  async function save() {
    if (busy || !dirty) return;
    busy = true;
    error = '';

    try {
      // Strip the proxy before it crosses into the worker.
      await saveDefaultPermissions(chat.peerId, {...permissions});
      flash('Permissions saved');
      onchanged();
    } catch (err: any) {
      error = err?.type || err?.message || 'Failed to save permissions';
    } finally {
      busy = false;
    }
  }

  async function pickSlowMode(seconds: number) {
    if (busy || seconds === slowMode) return;
    const previous = slowMode;
    slowMode = seconds;
    busy = true;
    error = '';

    try {
      await setSlowMode(chat.peerId, seconds);
      onchanged();
    } catch (err: any) {
      slowMode = previous;
      error = err?.type || err?.message || 'Failed to set slow mode';
    } finally {
      busy = false;
    }
  }
</script>

<div class="pane">
  <p class="admin-label">What members can do</p>

  {#each keys as key (key)}
    <label class="admin-toggle">
      <input type="checkbox" checked={permissions[key]} onchange={() => toggle(key)} disabled={busy} />
      <span>{PERMISSION_LABELS[key]}</span>
    </label>
  {/each}

  <div class="admin-actions">
    <button class="admin-btn primary" onclick={save} disabled={busy || !dirty}>
      {busy ? 'Saving…' : 'Save'}
    </button>
  </div>

  {#if !chat.isBasicGroup}
    <section>
      <p class="admin-label">Slow mode</p>
      <p class="admin-hint">How long a member must wait between messages.</p>
      <div class="chips">
        {#each SLOW_MODE_OPTIONS as option (option.seconds)}
          <button
            class:on={slowMode === option.seconds}
            onclick={() => pickSlowMode(option.seconds)}
            disabled={busy}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if error}<p class="admin-error">{error}</p>{/if}
  {#if status}<p class="admin-ok">{status}</p>{/if}
</div>

<style>
  .pane {
    display: grid;
    gap: 10px;
  }

  section {
    display: grid;
    gap: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .chips button.on {
    border-color: var(--accent);
    background: var(--accent);
    color: #fff;
  }

  .chips button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
