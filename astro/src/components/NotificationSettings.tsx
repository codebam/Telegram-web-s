/*
 * Ported from svelte/src/lib/components/NotificationSettings.svelte.
 *
 * The `$state` values are signals, read as `.value` — including in the markup.
 * The initial load was an `$effect` that read no reactive value, so it is a
 * `useEffect` with an empty dependency list; everything it touches is a signal,
 * so no handler has to be kept current in a ref.
 *
 * One consequence of `signal()` being shallow rather than a deep proxy is
 * already handled by the original: every settings write replaces the whole object
 * (`scopes.value = {...scopes.value, [scope]: {...previous, ...patch}}`) instead
 * of mutating a field, so readers of the signal are notified.
 */
import {Fragment} from 'preact';
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {PeerPicker} from './PeerPicker';
import {Avatar} from './Avatar';
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

import './NotificationSettings.css';

export function NotificationSettings() {
  const error = useSignal('');
  const desktopOn = useSignal(notificationsEnabled());
  const prefs = useSignal<LocalNotificationPrefs>(getLocalPrefs());

  const sounds = useSignal<SoundOption[]>([]);
  const scopes = useSignal<Record<NotifyScope, ScopeNotifications> | null>(null);
  const stories = useSignal<StoryNotifications | null>(null);
  const reactions = useSignal<ReactionNotifications | null>(null);
  const exceptions = useSignal<NotifyException[]>([]);

  const picking = useSignal(false);
  const dialogs = useSignal<DialogItem[]>([]);
  const busy = useSignal(false);

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

  useEffect(() => {
    (async() => {
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

        sounds.value = soundList;
        scopes.value = {users, groups, channels};
        stories.value = storySettings;
        reactions.value = reactionSettings;
        exceptions.value = await loadNotifyExceptions();
      } catch(err: any) {
        error.value = err?.type || err?.message || 'Failed to load notification settings';
      }
    })();
  }, []);

  function report(err: any) {
    error.value = err?.type || err?.message || 'Failed to update';
  }

  async function toggleDesktop() {
    if(desktopOn.value) {
      disableNotifications();
      desktopOn.value = false;
    } else {
      desktopOn.value = await enableNotifications();
      if(!desktopOn.value) error.value = 'Permission denied by the browser';
    }
  }

  function togglePref(key: keyof LocalNotificationPrefs) {
    prefs.value = setLocalPref(key, !prefs.value[key]);
  }

  async function patchScope(scope: NotifyScope, patch: Partial<ScopeNotifications>) {
    if(!scopes.value) return;
    const previous = scopes.value[scope];
    scopes.value = {...scopes.value, [scope]: {...previous, ...patch}};
    try {
      await setScopeNotifications(scope, patch);
    } catch(err) {
      scopes.value = {...scopes.value, [scope]: previous};
      report(err);
    }
  }

  async function patchStories(patch: Partial<StoryNotifications>) {
    if(!stories.value) return;
    const previous = stories.value;
    stories.value = {...previous, ...patch};
    try {
      await setStoryNotifications(patch);
    } catch(err) {
      stories.value = previous;
      report(err);
    }
  }

  async function patchReactions(patch: Partial<ReactionNotifications>) {
    if(!reactions.value) return;
    const previous = reactions.value;
    reactions.value = {...previous, ...patch};
    try {
      await setReactionNotifications(patch);
    } catch(err) {
      reactions.value = previous;
      report(err);
    }
  }

  async function refreshExceptions() {
    try {
      exceptions.value = await loadNotifyExceptions();
    } catch(err) {
      report(err);
    }
  }

  async function openPicker() {
    picking.value = true;
    if(!dialogs.value.length) {
      try {
        dialogs.value = await loadDialogs(100);
      } catch(err) {
        report(err);
      }
    }
  }

  async function addException(peerId: number) {
    picking.value = false;
    busy.value = true;
    try {
      // A new exception starts muted forever — the reason to add one at all.
      await setPeerNotifications(peerId, {muteFor: 'forever'});
      await refreshExceptions();
    } catch(err) {
      report(err);
    } finally {
      busy.value = false;
    }
  }

  async function mute(peerId: number, seconds: number | 'forever') {
    busy.value = true;
    try {
      await setPeerNotifications(peerId, {muteFor: seconds});
      await refreshExceptions();
    } catch(err) {
      report(err);
    } finally {
      busy.value = false;
    }
  }

  async function unmute(peerId: number) {
    busy.value = true;
    try {
      await setPeerNotifications(peerId, {muteFor: 0});
      await refreshExceptions();
    } catch(err) {
      report(err);
    } finally {
      busy.value = false;
    }
  }

  async function drop(peerId: number) {
    busy.value = true;
    try {
      await removePeerNotifications(peerId);
      exceptions.value = exceptions.value.filter((e) => e.peerId !== peerId);
    } catch(err) {
      report(err);
    } finally {
      busy.value = false;
    }
  }

  async function resetAll() {
    if(!confirm('Reset all notification settings?')) return;
    busy.value = true;
    try {
      await resetNotificationSettings();
      prefs.value = getLocalPrefs();
      const [users, groups, channels] = await Promise.all([
        loadScopeNotifications('users'),
        loadScopeNotifications('groups'),
        loadScopeNotifications('channels')
      ]);
      scopes.value = {users, groups, channels};
      stories.value = await loadStoryNotifications();
      exceptions.value = [];
    } catch(err) {
      report(err);
    } finally {
      busy.value = false;
    }
  }

  function mutedUntilText(exception: NotifyException) {
    if(exception.enabled) return 'Unmuted';
    if(exception.mutedUntil >= 0x7fffffff) return 'Muted';
    return `Muted until ${new Date(exception.mutedUntil * 1000).toLocaleString()}`;
  }

  return (
    <>
      {error.value && <p class="error">{error.value}</p>}

      <label class="toggle">
        <input type="checkbox" checked={desktopOn.value} onChange={toggleDesktop} />
        <span>Desktop notifications</span>
      </label>
      <p class="muted small">Browser permission: {permission()}</p>

      {!scopes.value ?
        <p class="muted">Loading…</p> :
        <>
          {SCOPE_LABELS.map(([scope, label], i) => (
            <Fragment key={i}>
              <p class="label">{label}</p>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={scopes.value![scope].enabled}
                  onChange={() => patchScope(scope, {enabled: !scopes.value![scope].enabled})}
                />
                <span>Notifications</span>
              </label>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={scopes.value![scope].preview}
                  onChange={() => patchScope(scope, {preview: !scopes.value![scope].preview})}
                />
                <span>Message preview</span>
              </label>
              <div class="row">
                <select
                  value={scopes.value![scope].sound}
                  onChange={(e) => patchScope(scope, {sound: e.currentTarget.value})}
                >
                  {sounds.value.map((sound) => (
                    <option value={sound.id} key={sound.id}>{sound.title}</option>
                  ))}
                </select>
                <button onClick={() => previewSound(scopes.value![scope].sound)}>Play</button>
              </div>
            </Fragment>
          ))}

          <p class="label">Stories</p>
          {stories.value && (
            <>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={stories.value.enabled}
                  onChange={() => patchStories({enabled: !stories.value!.enabled})}
                />
                <span>Story notifications</span>
              </label>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={stories.value.preview}
                  onChange={() => patchStories({preview: !stories.value!.preview})}
                />
                <span>Show the poster's name</span>
              </label>
              <div class="row">
                <select
                  value={stories.value.sound}
                  onChange={(e) => patchStories({sound: e.currentTarget.value})}
                >
                  {sounds.value.map((sound) => (
                    <option value={sound.id} key={sound.id}>{sound.title}</option>
                  ))}
                </select>
                <button onClick={() => previewSound(stories.value!.sound)}>Play</button>
              </div>
            </>
          )}

          <p class="label">Reactions</p>
          {reactions.value && (
            <>
              <div class="row">
                <span class="row-label">Messages</span>
                <select
                  value={reactions.value.messages}
                  onChange={(e) => patchReactions({messages: e.currentTarget.value as ReactionsFrom})}
                >
                  {REACTION_FROM.map(([value, label], i) => (
                    <option value={value} key={i}>{label}</option>
                  ))}
                </select>
              </div>
              <div class="row">
                <span class="row-label">Stories</span>
                <select
                  value={reactions.value.stories}
                  onChange={(e) => patchReactions({stories: e.currentTarget.value as ReactionsFrom})}
                >
                  {REACTION_FROM.map(([value, label], i) => (
                    <option value={value} key={i}>{label}</option>
                  ))}
                </select>
              </div>
              {(reactions.value.messages !== 'off' || reactions.value.stories !== 'off') && (
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={reactions.value.preview}
                    onChange={() => patchReactions({preview: !reactions.value!.preview})}
                  />
                  <span>Show reaction previews</span>
                </label>
              )}
            </>
          )}

          <p class="label">Exceptions</p>
          {!exceptions.value.length ?
            <p class="muted small">No chat overrides the settings above.</p> :
            <>
              {exceptions.value.map((exception) => (
                <div class="exception" key={exception.peerId}>
                  <div class="exception-head">
                    <Avatar peerId={exception.peerId} title={exception.title} size={28} />
                    <span class="name">{exception.title}</span>
                    <span class="muted small">{mutedUntilText(exception)}</span>
                  </div>
                  <div class="actions">
                    {MUTE_DURATIONS.map((duration, i) => (
                      <button key={i} disabled={busy.value} onClick={() => mute(exception.peerId, duration.seconds)}>
                        {duration.label}
                      </button>
                    ))}
                    <button disabled={busy.value} onClick={() => unmute(exception.peerId)}>Unmute</button>
                    <button class="danger" disabled={busy.value} onClick={() => drop(exception.peerId)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </>
          }
          <button onClick={openPicker} disabled={busy.value}>Add exception</button>

          <p class="label">Other</p>
          <label class="toggle">
            <input type="checkbox" checked={prefs.value.inAppSounds} onChange={() => togglePref('inAppSounds')} />
            <span>In-app sounds</span>
          </label>
          <label class="toggle">
            <input type="checkbox" checked={prefs.value.inAppFlash} onChange={() => togglePref('inAppFlash')} />
            <span>Flash the tab title</span>
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              checked={prefs.value.countMutedInBadge}
              onChange={() => togglePref('countMutedInBadge')}
            />
            <span>Count muted chats in the badge</span>
          </label>

          <button class="danger" onClick={resetAll} disabled={busy.value}>Reset all notifications</button>
        </>
      }

      {picking.value && (
        <PeerPicker
          title="Add exception"
          dialogs={dialogs.value}
          onpick={addException}
          onclose={() => (picking.value = false)}
        />
      )}
    </>
  );
}
