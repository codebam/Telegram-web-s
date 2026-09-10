/*
 * Telegram Business settings: opening hours, location, quick replies, the
 * greeting, the away message, the intro and the connected chatbot.
 *
 * Ported from svelte/src/lib/components/BusinessSettings.svelte. Two adaptations
 * the framework forces, both mechanical:
 *
 *  - Svelte's `$state` was deeply reactive, so the markup could write
 *    `profile.hours.days[index].open = …` in place and the view followed. A
 *    signal holds a plain object and only notifies on assignment, so every editor
 *    writes a fresh object back through the signal — `editProfile`, `editHours`,
 *    `editDay`, `editGreeting`, `editAway`, `editBot`.
 *  - the load `$effect` reads no reactive value, so it ran once per mount and is
 *    a `useEffect` with an empty dependency list. The handler it calls after an
 *    `await` is kept in a ref, because a JSX closure would otherwise reach the
 *    one captured by the render that started the load.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  BOT_RIGHTS,
  DEFAULT_BOT_RIGHTS,
  WEEKDAYS,
  deleteQuickReply,
  disconnectBot,
  findBusinessBot,
  loadBusinessProfile,
  loadConnectedBot,
  loadQuickReplies,
  loadTimezones,
  minutesToTime,
  renameQuickReply,
  saveAway,
  saveBusinessLocation,
  saveConnectedBot,
  saveGreeting,
  saveIntro,
  saveWorkHours,
  timeToMinutes,
  type AwaySchedule,
  type AwaySettings,
  type BotRight,
  type BusinessProfile,
  type ConnectedBotInfo,
  type DayHours,
  type GreetingSettings,
  type QuickReplyItem,
  type RecipientSelection,
  type TimezoneOption,
  type WorkHours
} from '$lib/telegram/business';

import {Avatar} from './Avatar';

import './BusinessSettings.css';

interface Props {
  onerror: (message: string) => void;
}

type Panel = 'hours' | 'location' | 'replies' | 'greeting' | 'away' | 'intro' | 'chatbot';

const PANELS: {key: Panel; label: string}[] = [
  {key: 'hours', label: 'Hours'},
  {key: 'location', label: 'Location'},
  {key: 'replies', label: 'Quick replies'},
  {key: 'greeting', label: 'Greeting'},
  {key: 'away', label: 'Away'},
  {key: 'intro', label: 'Intro'},
  {key: 'chatbot', label: 'Chatbot'}
];

const RECIPIENT_FIELDS: {key: keyof RecipientSelection; label: string}[] = [
  {key: 'existingChats', label: 'Existing chats'},
  {key: 'newChats', label: 'New chats'},
  {key: 'contacts', label: 'Contacts'},
  {key: 'nonContacts', label: 'Non-contacts'}
];

export function BusinessSettings({onerror}: Props) {
  const panel = useSignal<Panel>('hours');

  const profile = useSignal<BusinessProfile | null>(null);
  const timezones = useSignal<TimezoneOption[]>([]);
  const replies = useSignal<QuickReplyItem[]>([]);
  const bot = useSignal<ConnectedBotInfo | null>(null);
  const connectedBotId = useSignal(0);
  const botUsername = useSignal('');
  const saving = useSignal('');
  const status = useSignal('');

  // The load effect's error path runs after an await, so the handler it needs is
  // kept current in a ref rather than captured by the closure.
  const currentOnerror = useRef(onerror);
  currentOnerror.current = onerror;

  // The editors a signal cannot do in place: each returns a fresh object, which
  // is what makes the pane re-render after an edit.
  function editProfile(change: (current: BusinessProfile) => BusinessProfile) {
    if(profile.value) profile.value = change(profile.value);
  }

  function editHours(change: (hours: WorkHours) => WorkHours) {
    editProfile((current) => ({...current, hours: change(current.hours)}));
  }

  function editDay(index: number, change: (day: DayHours) => DayHours) {
    editHours((hours) => ({...hours, days: hours.days.map((day, i) => (i === index ? change(day) : day))}));
  }

  function editGreeting(change: (greeting: GreetingSettings) => GreetingSettings) {
    editProfile((current) => ({...current, greeting: change(current.greeting)}));
  }

  function editAway(change: (away: AwaySettings) => AwaySettings) {
    editProfile((current) => ({...current, away: change(current.away)}));
  }

  function editBot(change: (current: ConnectedBotInfo) => ConnectedBotInfo) {
    if(bot.value) bot.value = change(bot.value);
  }

  useEffect(() => {
    (async() => {
      try {
        const [loaded, zones, quick, connected] = await Promise.all([
          loadBusinessProfile(),
          loadTimezones(),
          loadQuickReplies(),
          loadConnectedBot()
        ]);
        profile.value = loaded;
        timezones.value = zones;
        replies.value = quick;
        bot.value = connected ?? {
          botId: 0,
          rights: [...DEFAULT_BOT_RIGHTS],
          recipients: {
            existingChats: true,
            newChats: true,
            contacts: true,
            nonContacts: true,
            excludeSelected: false
          },
          excludedPeerIds: []
        };
        connectedBotId.value = connected?.botId ?? 0;
      } catch(err: any) {
        currentOnerror.current(err?.message || 'Could not load business settings');
      }
    })();
  }, []);

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  /** Every save shares this shape: mark busy, run, surface the error, unmark. */
  async function run(key: string, action: () => Promise<void>, message: string) {
    saving.value = key;
    try {
      await action();
      flash(message);
    } catch(err: any) {
      onerror(err?.type || err?.message || 'Could not save');
    } finally {
      saving.value = '';
    }
  }

  function toggleRight(right: BotRight) {
    if(!bot.value) return;
    bot.value = {
      ...bot.value,
      rights: bot.value.rights.includes(right) ?
        bot.value.rights.filter((r) => r !== right) :
        [...bot.value.rights, right]
    };
  }

  function toDateInput(unix: number): string {
    if(!unix) return '';
    // `datetime-local` wants a local-time string with no zone suffix.
    const date = new Date(unix * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDateInput(value: string): number {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }

  async function renameReply(reply: QuickReplyItem) {
    const next = prompt('Rename this quick reply:', reply.shortcut);
    if(next === null || next.trim() === reply.shortcut) return;

    try {
      await renameQuickReply(reply.shortcutId, next);
      replies.value = await loadQuickReplies();
      flash('Quick reply renamed');
    } catch(err: any) {
      onerror(err?.type || err?.message || 'Could not rename the quick reply');
    }
  }

  async function removeReply(reply: QuickReplyItem) {
    if(!confirm(`Delete the quick reply "${reply.shortcut}" and its messages?`)) return;

    try {
      await deleteQuickReply(reply.shortcutId);
      replies.value = replies.value.filter((r) => r.shortcutId !== reply.shortcutId);
      flash('Quick reply deleted');
    } catch(err: any) {
      onerror(err?.type || err?.message || 'Could not delete the quick reply');
    }
  }

  async function connectBot() {
    if(!bot.value) return;
    const username = botUsername.value.trim().replace(/^@/, '');
    if(!username) return;

    saving.value = 'chatbot';
    try {
      const botId = await findBusinessBot(username);
      const next = {...bot.value, botId};
      await saveConnectedBot(next, connectedBotId.value);
      bot.value = next;
      connectedBotId.value = botId;
      botUsername.value = '';
      flash('Chatbot connected');
    } catch(err: any) {
      onerror(err?.type || err?.message || 'Could not connect that bot');
    } finally {
      saving.value = '';
    }
  }

  async function removeBot() {
    if(!connectedBotId.value || !confirm('Disconnect this chatbot from your account?')) return;

    saving.value = 'chatbot';
    try {
      await disconnectBot(connectedBotId.value);
      connectedBotId.value = 0;
      if(bot.value) bot.value = {...bot.value, botId: 0};
      flash('Chatbot disconnected');
    } catch(err: any) {
      onerror(err?.type || err?.message || 'Could not disconnect the bot');
    } finally {
      saving.value = '';
    }
  }

  // The `{#if} {:else if} … {:else}` chain that picked the open panel's body,
  // resolved before the single return.
  let body: preact.JSX.Element;

  if(panel.value === 'hours') {
    body = (
      <>
        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.hours.enabled}
            onChange={() => editHours((hours) => ({...hours, enabled: !hours.enabled}))}
          />
          <span>Show opening hours on my profile</span>
        </label>

        <label class="field">
          <span>Timezone</span>
          <select
            value={profile.value!.hours.timezoneId}
            disabled={!profile.value!.hours.enabled}
            onChange={(e) => editHours((hours) => ({...hours, timezoneId: (e.currentTarget as HTMLSelectElement).value}))}
          >
            <option value="">Pick a timezone…</option>
            {timezones.value.map((zone) => (
              <option key={zone.id} value={zone.id}>{zone.name}</option>
            ))}
          </select>
        </label>

        {profile.value!.hours.days.map((day, index) => (
          <div key={index} class={['day', !profile.value!.hours.enabled && 'off'].filter(Boolean).join(' ')}>
            <label class="day-name">
              <input
                type="checkbox"
                checked={day.open}
                disabled={!profile.value!.hours.enabled}
                onChange={() => editDay(index, (day) => ({...day, open: !day.open}))}
              />
              <span>{WEEKDAYS[index]}</span>
            </label>
            {day.open ?
              <>
                <input
                  type="time"
                  value={minutesToTime(day.from)}
                  disabled={!profile.value!.hours.enabled}
                  onChange={(e) => editDay(index, (day) => ({...day, from: timeToMinutes(e.currentTarget.value)}))}
                />
                <span class="dash">–</span>
                <input
                  type="time"
                  value={minutesToTime(day.to)}
                  disabled={!profile.value!.hours.enabled}
                  onChange={(e) => editDay(index, (day) => ({...day, to: timeToMinutes(e.currentTarget.value)}))}
                />
              </> :
              <span class="muted small closed">Closed</span>}
          </div>
        ))}

        <p class="muted small">
          Hours are stored relative to the timezone above, so they stay correct for
          people reading your profile from elsewhere.
        </p>

        <button
          class="primary"
          disabled={saving.value === 'hours'}
          onClick={() =>
            run(
              'hours',
              // Snapshotted through JSON so no signal proxy reaches the worker.
              () => saveWorkHours(JSON.parse(JSON.stringify(profile.value!.hours))),
              'Opening hours saved'
            )}
        >
          {saving.value === 'hours' ? 'Saving…' : 'Save hours'}
        </button>
      </>
    );
  } else if(panel.value === 'location') {
    body = (
      <>
        <label class="field">
          <span>Address</span>
          <input
            value={profile.value!.locationAddress}
            placeholder="Where your business is"
            onInput={(e) =>
              editProfile((current) => ({...current, locationAddress: (e.currentTarget as HTMLInputElement).value}))}
          />
        </label>
        <p class="muted small">
          Leave the address empty to remove the location. Pinning an exact map point
          needs a place picker this client does not have yet.
        </p>
        <button
          class="primary"
          disabled={saving.value === 'location'}
          onClick={() => run('location', () => saveBusinessLocation(profile.value!.locationAddress), 'Location saved')}
        >
          {saving.value === 'location' ? 'Saving…' : 'Save location'}
        </button>
      </>
    );
  } else if(panel.value === 'replies') {
    body = (
      <>
        {!replies.value.length ?
          <p class="muted small">No quick replies yet.</p> :
          replies.value.map((reply) => (
            <div key={reply.shortcutId} class="reply">
              <span class="reply-name">/{reply.shortcut}</span>
              <span class="muted small">{reply.count} message{reply.count === 1 ? '' : 's'}</span>
              <div class="reply-actions">
                <button class="small-btn" onClick={() => renameReply(reply)}>Rename</button>
                <button class="danger small-btn" onClick={() => removeReply(reply)}>Delete</button>
              </div>
            </div>
          ))}
        <p class="muted small">
          A new quick reply is created by sending its first message, which this
          client's composer cannot target yet — create one in another Telegram app,
          then rename, reuse or delete it here.
        </p>
      </>
    );
  } else if(panel.value === 'greeting') {
    body = (
      <>
        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.greeting.enabled}
            onChange={() => editGreeting((greeting) => ({...greeting, enabled: !greeting.enabled}))}
          />
          <span>Send a greeting to new chats</span>
        </label>

        <label class="field">
          <span>Quick reply to send</span>
          <select
            value={profile.value!.greeting.shortcutId}
            disabled={!profile.value!.greeting.enabled}
            onChange={(e) => editGreeting((greeting) => ({...greeting, shortcutId: Number(e.currentTarget.value)}))}
          >
            <option value={0}>Pick a quick reply…</option>
            {replies.value.map((reply) => (
              <option key={reply.shortcutId} value={reply.shortcutId}>/{reply.shortcut}</option>
            ))}
          </select>
        </label>

        <label class="field">
          <span>Send after no messages for (days)</span>
          <input
            type="number"
            min="1"
            max="365"
            value={profile.value!.greeting.noActivityDays}
            disabled={!profile.value!.greeting.enabled}
            onInput={(e) =>
              editGreeting((greeting) => ({...greeting, noActivityDays: Number((e.currentTarget as HTMLInputElement).value)}))}
          />
        </label>

        <p class="label">Send to</p>
        {RECIPIENT_FIELDS.map((field, i) => (
          <label key={i} class="toggle">
            <input
              type="checkbox"
              checked={profile.value!.greeting.recipients[field.key] as boolean}
              disabled={!profile.value!.greeting.enabled}
              onChange={() =>
                editGreeting((greeting) => ({
                  ...greeting,
                  recipients: {...greeting.recipients, [field.key]: !greeting.recipients[field.key]}
                }))}
            />
            <span>{field.label}</span>
          </label>
        ))}
        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.greeting.recipients.excludeSelected}
            disabled={!profile.value!.greeting.enabled}
            onChange={() =>
              editGreeting((greeting) => ({
                ...greeting,
                recipients: {...greeting.recipients, excludeSelected: !greeting.recipients.excludeSelected}
              }))}
          />
          <span>Treat the list above as exclusions</span>
        </label>

        <button
          class="primary"
          disabled={saving.value === 'greeting'}
          onClick={() =>
            run('greeting', () => saveGreeting(JSON.parse(JSON.stringify(profile.value!.greeting))), 'Greeting saved')}
        >
          {saving.value === 'greeting' ? 'Saving…' : 'Save greeting'}
        </button>
      </>
    );
  } else if(panel.value === 'away') {
    body = (
      <>
        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.away.enabled}
            onChange={() => editAway((away) => ({...away, enabled: !away.enabled}))}
          />
          <span>Send an away message</span>
        </label>

        <label class="field">
          <span>Quick reply to send</span>
          <select
            value={profile.value!.away.shortcutId}
            disabled={!profile.value!.away.enabled}
            onChange={(e) => editAway((away) => ({...away, shortcutId: Number(e.currentTarget.value)}))}
          >
            <option value={0}>Pick a quick reply…</option>
            {replies.value.map((reply) => (
              <option key={reply.shortcutId} value={reply.shortcutId}>/{reply.shortcut}</option>
            ))}
          </select>
        </label>

        <label class="field">
          <span>Schedule</span>
          <select
            value={profile.value!.away.schedule}
            disabled={!profile.value!.away.enabled}
            onChange={(e) =>
              editAway((away) => ({...away, schedule: (e.currentTarget as HTMLSelectElement).value as AwaySchedule}))}
          >
            <option value="always">Always</option>
            <option value="outsideWorkHours">Outside opening hours</option>
            <option value="custom">A specific period</option>
          </select>
        </label>

        {profile.value!.away.schedule === 'custom' && (
          <>
            <label class="field">
              <span>From</span>
              <input
                type="datetime-local"
                value={toDateInput(profile.value!.away.startDate)}
                disabled={!profile.value!.away.enabled}
                onChange={(e) => editAway((away) => ({...away, startDate: fromDateInput(e.currentTarget.value)}))}
              />
            </label>
            <label class="field">
              <span>Until</span>
              <input
                type="datetime-local"
                value={toDateInput(profile.value!.away.endDate)}
                disabled={!profile.value!.away.enabled}
                onChange={(e) => editAway((away) => ({...away, endDate: fromDateInput(e.currentTarget.value)}))}
              />
            </label>
          </>
        )}

        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.away.offlineOnly}
            disabled={!profile.value!.away.enabled}
            onChange={() => editAway((away) => ({...away, offlineOnly: !away.offlineOnly}))}
          />
          <span>Only when I am offline</span>
        </label>

        <p class="label">Send to</p>
        {RECIPIENT_FIELDS.map((field, i) => (
          <label key={i} class="toggle">
            <input
              type="checkbox"
              checked={profile.value!.away.recipients[field.key] as boolean}
              disabled={!profile.value!.away.enabled}
              onChange={() =>
                editAway((away) => ({
                  ...away,
                  recipients: {...away.recipients, [field.key]: !away.recipients[field.key]}
                }))}
            />
            <span>{field.label}</span>
          </label>
        ))}
        <label class="toggle">
          <input
            type="checkbox"
            checked={profile.value!.away.recipients.excludeSelected}
            disabled={!profile.value!.away.enabled}
            onChange={() =>
              editAway((away) => ({...away, recipients: {...away.recipients, excludeSelected: !away.recipients.excludeSelected}}))}
          />
          <span>Treat the list above as exclusions</span>
        </label>

        <button
          class="primary"
          disabled={saving.value === 'away'}
          onClick={() => run('away', () => saveAway(JSON.parse(JSON.stringify(profile.value!.away))), 'Away message saved')}
        >
          {saving.value === 'away' ? 'Saving…' : 'Save away message'}
        </button>
      </>
    );
  } else if(panel.value === 'intro') {
    body = (
      <>
        <label class="field">
          <span>Title</span>
          <input
            value={profile.value!.introTitle}
            onInput={(e) => editProfile((current) => ({...current, introTitle: (e.currentTarget as HTMLInputElement).value}))}
          />
        </label>
        <label class="field">
          <span>Description</span>
          <input
            value={profile.value!.introDescription}
            onInput={(e) =>
              editProfile((current) => ({...current, introDescription: (e.currentTarget as HTMLInputElement).value}))}
          />
        </label>
        <p class="muted small">
          The intro replaces the default "no messages here yet" placeholder people see
          when they open a chat with you. Empty both fields to restore it.
        </p>
        <button
          class="primary"
          disabled={saving.value === 'intro'}
          onClick={() => run('intro', () => saveIntro(profile.value!.introTitle, profile.value!.introDescription), 'Intro saved')}
        >
          {saving.value === 'intro' ? 'Saving…' : 'Save intro'}
        </button>
      </>
    );
  } else {
    body = (
      <>
        {connectedBotId.value ?
          <div class="bot-head">
            <Avatar peerId={connectedBotId.value} title="Bot" size={48} />
            <span class="muted small">Connected bot</span>
          </div> :
          <>
            <label class="field">
              <span>Bot username</span>
              <input
                value={botUsername.value}
                placeholder="@mybusinessbot"
                onInput={(e) => (botUsername.value = (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <button class="primary" disabled={saving.value === 'chatbot'} onClick={connectBot}>
              {saving.value === 'chatbot' ? 'Connecting…' : 'Connect bot'}
            </button>
          </>}

        <p class="label">The bot may</p>
        {BOT_RIGHTS.map((right, i) => (
          <label key={i} class="toggle">
            <input
              type="checkbox"
              checked={bot.value!.rights.includes(right.key)}
              onChange={() => toggleRight(right.key)}
            />
            <span>{right.label}</span>
          </label>
        ))}

        <p class="label">Chats the bot handles</p>
        {RECIPIENT_FIELDS.map((field, i) => (
          <label key={i} class="toggle">
            <input
              type="checkbox"
              checked={bot.value!.recipients[field.key] as boolean}
              onChange={() =>
                editBot((current) => ({
                  ...current,
                  recipients: {...current.recipients, [field.key]: !current.recipients[field.key]}
                }))}
            />
            <span>{field.label}</span>
          </label>
        ))}
        <label class="toggle">
          <input
            type="checkbox"
            checked={bot.value!.recipients.excludeSelected}
            onChange={() =>
              editBot((current) => ({
                ...current,
                recipients: {...current.recipients, excludeSelected: !current.recipients.excludeSelected}
              }))}
          />
          <span>Treat the list above as exclusions</span>
        </label>

        {bot.value!.excludedPeerIds.length > 0 && (
          <>
            <p class="label">Excluded chats</p>
            {bot.value!.excludedPeerIds.map((peerId) => (
              <div key={peerId} class="excluded">
                <Avatar peerId={peerId} title="Chat" size={28} />
                <button
                  class="danger small-btn"
                  onClick={() =>
                    editBot((current) => ({
                      ...current,
                      excludedPeerIds: current.excludedPeerIds.filter((id) => id !== peerId)
                    }))}
                >Remove</button>
              </div>
            ))}
            <p class="muted small">
              Chats are added to this list from the chat itself; here they can only be
              lifted.
            </p>
          </>
        )}

        {connectedBotId.value > 0 && (
          <>
            <button
              class="primary"
              disabled={saving.value === 'chatbot'}
              onClick={() =>
                run(
                  'chatbot',
                  () => saveConnectedBot(JSON.parse(JSON.stringify(bot.value!)), connectedBotId.value),
                  'Chatbot updated'
                )}
            >
              {saving.value === 'chatbot' ? 'Saving…' : 'Save chatbot settings'}
            </button>
            <button class="danger" disabled={saving.value === 'chatbot'} onClick={removeBot}>Disconnect bot</button>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {status.value && <p class="ok">{status.value}</p>}

      {!profile.value || !bot.value ?
        <p class="muted">Loading…</p> :
        <>
          <nav class="panels">
            {PANELS.map((item, i) => (
              <button key={i} class={panel.value === item.key ? 'on' : ''} onClick={() => (panel.value = item.key)}>{item.label}</button>
            ))}
          </nav>

          {body}
        </>}
    </>
  );
}
