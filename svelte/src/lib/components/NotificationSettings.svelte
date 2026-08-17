<script lang="ts">
  import PeerPicker from './PeerPicker.svelte';
  import Avatar from './Avatar.svelte';
  import {loadDialogs, type DialogItem} from '$lib/telegram/chats';
  import {
    disableNotifications,
    enableNotifications,
    getLocalPrefs,
    loadNotifyExceptions,
    loadReactionNotifications,
    loadScopeNotifications,
    loadSounds,
    loadStoryNotifications,
    MUTE_DURATIONS,
    notificationsEnabled,
    permission,
    previewSound,
    removePeerNotifications,
    resetNotificationSettings,
    setLocalPref,
    setPeerNotifications,
    setReactionNotifications,
    setScopeNotifications,
    setStoryNotifications,
    type LocalNotificationPrefs,
    type NotifyException,
    type NotifyScope,
    type ReactionNotifications,
    type ReactionsFrom,
    type ScopeNotifications,
    type SoundOption,
    type StoryNotifications
  } from '$lib/telegram/notifications';

  let error = $state('');
  let desktopOn = $state(notificationsEnabled());
  let prefs = $state<LocalNotificationPrefs>(getLocalPrefs());

  let sounds = $state<SoundOption[]>([]);
  let scopes = $state<Record<NotifyScope, ScopeNotifications> | null>(null);
  let stories = $state<StoryNotifications | null>(null);
  let reactions = $state<ReactionNotifications | null>(null);
  let exceptions = $state<NotifyException[]>([]);

  let picking = $state(false);
  let dialogs = $state<DialogItem[]>([]);
  let busy = $state(false);

  const SCOPE_LABELS: [NotifyScope, string][] = [
    ['users', 'Private chats'],
    ['groups', 'Groups'],
    ['channels', 'Channels']
  ];

  const REACTION_FROM: [ReactionsFrom, string][] = [
    ['off', 'Off'],
    ['contacts', 'Contacts'],
    ['all', 'Everyone']
  ];

  $effect(() => {
    (async () => {
      try {
        const [soundList, users, groups, channels, storySettings, reactionSettings] =
          await Promise.all([
            loadSounds(),
            loadScopeNotifications('users'),
            loadScopeNotifications('groups'),
            loadScopeNotifications('channels'),
            loadStoryNotifications(),
            loadReactionNotifications()
          ]);

        sounds = soundList;
        scopes = {users, groups, channels};
        stories = storySettings;
        reactions = reactionSettings;
        exceptions = await loadNotifyExceptions();
      } catch (err: any) {
        error = err?.type || err?.message || 'Failed to load notification settings';
      }
    })();
  });

  function report(err: any) {
    error = err?.type || err?.message || 'Failed to update';
  }

  async function toggleDesktop() {
    if (desktopOn) {
      disableNotifications();
      desktopOn = false;
    } else {
      desktopOn = await enableNotifications();
      if (!desktopOn) error = 'Permission denied by the browser';
    }
  }

  function togglePref(key: keyof LocalNotificationPrefs) {
    prefs = setLocalPref(key, !prefs[key]);
  }

  async function patchScope(scope: NotifyScope, patch: Partial<ScopeNotifications>) {
    if (!scopes) return;
    const previous = scopes[scope];
    scopes = {...scopes, [scope]: {...previous, ...patch}};
    try {
      await setScopeNotifications(scope, patch);
    } catch (err) {
      scopes = {...scopes, [scope]: previous};
      report(err);
    }
  }

  async function patchStories(patch: Partial<StoryNotifications>) {
    if (!stories) return;
    const previous = stories;
    stories = {...previous, ...patch};
    try {
      await setStoryNotifications(patch);
    } catch (err) {
      stories = previous;
      report(err);
    }
  }

  async function patchReactions(patch: Partial<ReactionNotifications>) {
    if (!reactions) return;
    const previous = reactions;
    reactions = {...previous, ...patch};
    try {
      await setReactionNotifications(patch);
    } catch (err) {
      reactions = previous;
      report(err);
    }
  }

  async function refreshExceptions() {
    try {
      exceptions = await loadNotifyExceptions();
    } catch (err) {
      report(err);
    }
  }

  async function openPicker() {
    picking = true;
    if (!dialogs.length) {
      try {
        dialogs = await loadDialogs(100);
      } catch (err) {
        report(err);
      }
    }
  }

  async function addException(peerId: number) {
    picking = false;
    busy = true;
    try {
      // A new exception starts muted forever — the reason to add one at all.
      await setPeerNotifications(peerId, {muteFor: 'forever'});
      await refreshExceptions();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  async function mute(peerId: number, seconds: number | 'forever') {
    busy = true;
    try {
      await setPeerNotifications(peerId, {muteFor: seconds});
      await refreshExceptions();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  async function unmute(peerId: number) {
    busy = true;
    try {
      await setPeerNotifications(peerId, {muteFor: 0});
      await refreshExceptions();
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  async function drop(peerId: number) {
    busy = true;
    try {
      await removePeerNotifications(peerId);
      exceptions = exceptions.filter((e) => e.peerId !== peerId);
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  async function resetAll() {
    if (!confirm('Reset all notification settings?')) return;
    busy = true;
    try {
      await resetNotificationSettings();
      prefs = getLocalPrefs();
      const [users, groups, channels] = await Promise.all([
        loadScopeNotifications('users'),
        loadScopeNotifications('groups'),
        loadScopeNotifications('channels')
      ]);
      scopes = {users, groups, channels};
      stories = await loadStoryNotifications();
      exceptions = [];
    } catch (err) {
      report(err);
    } finally {
      busy = false;
    }
  }

  function mutedUntilText(exception: NotifyException) {
    if (exception.enabled) return 'Unmuted';
    if (exception.mutedUntil >= 0x7fffffff) return 'Muted';
    return `Muted until ${new Date(exception.mutedUntil * 1000).toLocaleString()}`;
  }
</script>

{#if error}<p class="error">{error}</p>{/if}

<label class="toggle">
  <input type="checkbox" checked={desktopOn} onchange={toggleDesktop} />
  <span>Desktop notifications</span>
</label>
<p class="muted small">Browser permission: {permission()}</p>

{#if !scopes}
  <p class="muted">Loading…</p>
{:else}
  {#each SCOPE_LABELS as [scope, label]}
    <p class="label">{label}</p>
    <label class="toggle">
      <input
        type="checkbox"
        checked={scopes[scope].enabled}
        onchange={() => patchScope(scope, {enabled: !scopes![scope].enabled})}
      />
      <span>Notifications</span>
    </label>
    <label class="toggle">
      <input
        type="checkbox"
        checked={scopes[scope].preview}
        onchange={() => patchScope(scope, {preview: !scopes![scope].preview})}
      />
      <span>Message preview</span>
    </label>
    <div class="row">
      <select
        value={scopes[scope].sound}
        onchange={(e) => patchScope(scope, {sound: e.currentTarget.value})}
      >
        {#each sounds as sound (sound.id)}
          <option value={sound.id}>{sound.title}</option>
        {/each}
      </select>
      <button onclick={() => previewSound(scopes![scope].sound)}>Play</button>
    </div>
  {/each}

  <p class="label">Stories</p>
  {#if stories}
    <label class="toggle">
      <input
        type="checkbox"
        checked={stories.enabled}
        onchange={() => patchStories({enabled: !stories!.enabled})}
      />
      <span>Story notifications</span>
    </label>
    <label class="toggle">
      <input
        type="checkbox"
        checked={stories.preview}
        onchange={() => patchStories({preview: !stories!.preview})}
      />
      <span>Show the poster's name</span>
    </label>
    <div class="row">
      <select
        value={stories.sound}
        onchange={(e) => patchStories({sound: e.currentTarget.value})}
      >
        {#each sounds as sound (sound.id)}
          <option value={sound.id}>{sound.title}</option>
        {/each}
      </select>
      <button onclick={() => previewSound(stories!.sound)}>Play</button>
    </div>
  {/if}

  <p class="label">Reactions</p>
  {#if reactions}
    <div class="row">
      <span class="row-label">Messages</span>
      <select
        value={reactions.messages}
        onchange={(e) => patchReactions({messages: e.currentTarget.value as ReactionsFrom})}
      >
        {#each REACTION_FROM as [value, label]}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    <div class="row">
      <span class="row-label">Stories</span>
      <select
        value={reactions.stories}
        onchange={(e) => patchReactions({stories: e.currentTarget.value as ReactionsFrom})}
      >
        {#each REACTION_FROM as [value, label]}
          <option {value}>{label}</option>
        {/each}
      </select>
    </div>
    {#if reactions.messages !== 'off' || reactions.stories !== 'off'}
      <label class="toggle">
        <input
          type="checkbox"
          checked={reactions.preview}
          onchange={() => patchReactions({preview: !reactions!.preview})}
        />
        <span>Show reaction previews</span>
      </label>
    {/if}
  {/if}

  <p class="label">Exceptions</p>
  {#if !exceptions.length}
    <p class="muted small">No chat overrides the settings above.</p>
  {:else}
    {#each exceptions as exception (exception.peerId)}
      <div class="exception">
        <div class="exception-head">
          <Avatar peerId={exception.peerId} title={exception.title} size={28} />
          <span class="name">{exception.title}</span>
          <span class="muted small">{mutedUntilText(exception)}</span>
        </div>
        <div class="actions">
          {#each MUTE_DURATIONS as duration}
            <button disabled={busy} onclick={() => mute(exception.peerId, duration.seconds)}>
              {duration.label}
            </button>
          {/each}
          <button disabled={busy} onclick={() => unmute(exception.peerId)}>Unmute</button>
          <button class="danger" disabled={busy} onclick={() => drop(exception.peerId)}>
            Remove
          </button>
        </div>
      </div>
    {/each}
  {/if}
  <button onclick={openPicker} disabled={busy}>Add exception</button>

  <p class="label">Other</p>
  <label class="toggle">
    <input type="checkbox" checked={prefs.inAppSounds} onchange={() => togglePref('inAppSounds')} />
    <span>In-app sounds</span>
  </label>
  <label class="toggle">
    <input type="checkbox" checked={prefs.inAppFlash} onchange={() => togglePref('inAppFlash')} />
    <span>Flash the tab title</span>
  </label>
  <label class="toggle">
    <input
      type="checkbox"
      checked={prefs.countMutedInBadge}
      onchange={() => togglePref('countMutedInBadge')}
    />
    <span>Count muted chats in the badge</span>
  </label>

  <button class="danger" onclick={resetAll} disabled={busy}>Reset all notifications</button>
{/if}

{#if picking}
  <PeerPicker
    title="Add exception"
    {dialogs}
    onpick={addException}
    onclose={() => (picking = false)}
  />
{/if}

<style>
  .label {
    margin: 18px 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.6;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    cursor: pointer;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 0;
  }

  .row-label {
    min-width: 90px;
  }

  select {
    flex: 1;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
  }

  button {
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.danger {
    color: var(--danger, #e05c5c);
  }

  .exception {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .exception-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .muted {
    opacity: 0.65;
  }

  .small {
    font-size: 12px;
  }

  .error {
    color: var(--danger, #e05c5c);
  }
</style>
