<script lang="ts">
  import Avatar from './Avatar.svelte';
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
    type BotRight,
    type BusinessProfile,
    type ConnectedBotInfo,
    type QuickReplyItem,
    type RecipientSelection,
    type TimezoneOption
  } from '$lib/telegram/business';

  let {onerror}: {onerror: (message: string) => void} = $props();

  type Panel = 'hours' | 'location' | 'replies' | 'greeting' | 'away' | 'intro' | 'chatbot';
  let panel = $state<Panel>('hours');

  let profile = $state<BusinessProfile | null>(null);
  let timezones = $state<TimezoneOption[]>([]);
  let replies = $state<QuickReplyItem[]>([]);
  let bot = $state<ConnectedBotInfo | null>(null);
  let connectedBotId = $state(0);
  let botUsername = $state('');
  let saving = $state('');
  let status = $state('');

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

  $effect(() => {
    (async () => {
      try {
        const [loaded, zones, quick, connected] = await Promise.all([
          loadBusinessProfile(),
          loadTimezones(),
          loadQuickReplies(),
          loadConnectedBot()
        ]);
        profile = loaded;
        timezones = zones;
        replies = quick;
        bot = connected ?? {
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
        connectedBotId = connected?.botId ?? 0;
      } catch (err: any) {
        onerror(err?.message || 'Could not load business settings');
      }
    })();
  });

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  /** Every save shares this shape: mark busy, run, surface the error, unmark. */
  async function run(key: string, action: () => Promise<void>, message: string) {
    saving = key;
    try {
      await action();
      flash(message);
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not save');
    } finally {
      saving = '';
    }
  }

  function toggleRight(right: BotRight) {
    if (!bot) return;
    bot = {
      ...bot,
      rights: bot.rights.includes(right)
        ? bot.rights.filter((r) => r !== right)
        : [...bot.rights, right]
    };
  }

  function toDateInput(unix: number): string {
    if (!unix) return '';
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
    if (next === null || next.trim() === reply.shortcut) return;

    try {
      await renameQuickReply(reply.shortcutId, next);
      replies = await loadQuickReplies();
      flash('Quick reply renamed');
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not rename the quick reply');
    }
  }

  async function removeReply(reply: QuickReplyItem) {
    if (!confirm(`Delete the quick reply "${reply.shortcut}" and its messages?`)) return;

    try {
      await deleteQuickReply(reply.shortcutId);
      replies = replies.filter((r) => r.shortcutId !== reply.shortcutId);
      flash('Quick reply deleted');
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not delete the quick reply');
    }
  }

  async function connectBot() {
    if (!bot) return;
    const username = botUsername.trim().replace(/^@/, '');
    if (!username) return;

    saving = 'chatbot';
    try {
      const botId = await findBusinessBot(username);
      const next = {...bot, botId};
      await saveConnectedBot(next, connectedBotId);
      bot = next;
      connectedBotId = botId;
      botUsername = '';
      flash('Chatbot connected');
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not connect that bot');
    } finally {
      saving = '';
    }
  }

  async function removeBot() {
    if (!connectedBotId || !confirm('Disconnect this chatbot from your account?')) return;

    saving = 'chatbot';
    try {
      await disconnectBot(connectedBotId);
      connectedBotId = 0;
      if (bot) bot = {...bot, botId: 0};
      flash('Chatbot disconnected');
    } catch (err: any) {
      onerror(err?.type || err?.message || 'Could not disconnect the bot');
    } finally {
      saving = '';
    }
  }
</script>

{#if status}<p class="ok">{status}</p>{/if}

{#if !profile || !bot}
  <p class="muted">Loading…</p>
{:else}
  <nav class="panels">
    {#each PANELS as item}
      <button class:on={panel === item.key} onclick={() => (panel = item.key)}>{item.label}</button>
    {/each}
  </nav>

  {#if panel === 'hours'}
    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.hours.enabled}
        onchange={() => (profile!.hours.enabled = !profile!.hours.enabled)}
      />
      <span>Show opening hours on my profile</span>
    </label>

    <label class="field">
      <span>Timezone</span>
      <select bind:value={profile.hours.timezoneId} disabled={!profile.hours.enabled}>
        <option value="">Pick a timezone…</option>
        {#each timezones as zone (zone.id)}
          <option value={zone.id}>{zone.name}</option>
        {/each}
      </select>
    </label>

    {#each profile.hours.days as day, index}
      <div class="day" class:off={!profile.hours.enabled}>
        <label class="day-name">
          <input
            type="checkbox"
            checked={day.open}
            disabled={!profile.hours.enabled}
            onchange={() => (profile!.hours.days[index].open = !day.open)}
          />
          <span>{WEEKDAYS[index]}</span>
        </label>
        {#if day.open}
          <input
            type="time"
            value={minutesToTime(day.from)}
            disabled={!profile.hours.enabled}
            onchange={(e) => (profile!.hours.days[index].from = timeToMinutes(e.currentTarget.value))}
          />
          <span class="dash">–</span>
          <input
            type="time"
            value={minutesToTime(day.to)}
            disabled={!profile.hours.enabled}
            onchange={(e) => (profile!.hours.days[index].to = timeToMinutes(e.currentTarget.value))}
          />
        {:else}
          <span class="muted small closed">Closed</span>
        {/if}
      </div>
    {/each}

    <p class="muted small">
      Hours are stored relative to the timezone above, so they stay correct for
      people reading your profile from elsewhere.
    </p>

    <button
      class="primary"
      disabled={saving === 'hours'}
      onclick={() =>
        run(
          'hours',
          // Snapshotted through JSON so no `$state` proxy reaches the worker.
          () => saveWorkHours(JSON.parse(JSON.stringify(profile!.hours))),
          'Opening hours saved'
        )}
    >
      {saving === 'hours' ? 'Saving…' : 'Save hours'}
    </button>

  {:else if panel === 'location'}
    <label class="field">
      <span>Address</span>
      <input bind:value={profile.locationAddress} placeholder="Where your business is" />
    </label>
    <p class="muted small">
      Leave the address empty to remove the location. Pinning an exact map point
      needs a place picker this client does not have yet.
    </p>
    <button
      class="primary"
      disabled={saving === 'location'}
      onclick={() => run('location', () => saveBusinessLocation(profile!.locationAddress), 'Location saved')}
    >
      {saving === 'location' ? 'Saving…' : 'Save location'}
    </button>

  {:else if panel === 'replies'}
    {#if !replies.length}
      <p class="muted small">No quick replies yet.</p>
    {:else}
      {#each replies as reply (reply.shortcutId)}
        <div class="reply">
          <span class="reply-name">/{reply.shortcut}</span>
          <span class="muted small">{reply.count} message{reply.count === 1 ? '' : 's'}</span>
          <div class="reply-actions">
            <button class="small-btn" onclick={() => renameReply(reply)}>Rename</button>
            <button class="danger small-btn" onclick={() => removeReply(reply)}>Delete</button>
          </div>
        </div>
      {/each}
    {/if}
    <p class="muted small">
      A new quick reply is created by sending its first message, which this
      client's composer cannot target yet — create one in another Telegram app,
      then rename, reuse or delete it here.
    </p>

  {:else if panel === 'greeting'}
    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.greeting.enabled}
        onchange={() => (profile!.greeting.enabled = !profile!.greeting.enabled)}
      />
      <span>Send a greeting to new chats</span>
    </label>

    <label class="field">
      <span>Quick reply to send</span>
      <select bind:value={profile.greeting.shortcutId} disabled={!profile.greeting.enabled}>
        <option value={0}>Pick a quick reply…</option>
        {#each replies as reply (reply.shortcutId)}
          <option value={reply.shortcutId}>/{reply.shortcut}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Send after no messages for (days)</span>
      <input
        type="number"
        min="1"
        max="365"
        bind:value={profile.greeting.noActivityDays}
        disabled={!profile.greeting.enabled}
      />
    </label>

    <p class="label">Send to</p>
    {#each RECIPIENT_FIELDS as field}
      <label class="toggle">
        <input
          type="checkbox"
          checked={profile.greeting.recipients[field.key] as boolean}
          disabled={!profile.greeting.enabled}
          onchange={() =>
            ((profile!.greeting.recipients[field.key] as boolean) = !profile!.greeting.recipients[field.key])}
        />
        <span>{field.label}</span>
      </label>
    {/each}
    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.greeting.recipients.excludeSelected}
        disabled={!profile.greeting.enabled}
        onchange={() =>
          (profile!.greeting.recipients.excludeSelected = !profile!.greeting.recipients.excludeSelected)}
      />
      <span>Treat the list above as exclusions</span>
    </label>

    <button
      class="primary"
      disabled={saving === 'greeting'}
      onclick={() =>
        run('greeting', () => saveGreeting(JSON.parse(JSON.stringify(profile!.greeting))), 'Greeting saved')}
    >
      {saving === 'greeting' ? 'Saving…' : 'Save greeting'}
    </button>

  {:else if panel === 'away'}
    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.away.enabled}
        onchange={() => (profile!.away.enabled = !profile!.away.enabled)}
      />
      <span>Send an away message</span>
    </label>

    <label class="field">
      <span>Quick reply to send</span>
      <select bind:value={profile.away.shortcutId} disabled={!profile.away.enabled}>
        <option value={0}>Pick a quick reply…</option>
        {#each replies as reply (reply.shortcutId)}
          <option value={reply.shortcutId}>/{reply.shortcut}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>Schedule</span>
      <select bind:value={profile.away.schedule} disabled={!profile.away.enabled}>
        <option value="always">Always</option>
        <option value="outsideWorkHours">Outside opening hours</option>
        <option value="custom">A specific period</option>
      </select>
    </label>

    {#if profile.away.schedule === 'custom'}
      <label class="field">
        <span>From</span>
        <input
          type="datetime-local"
          value={toDateInput(profile.away.startDate)}
          disabled={!profile.away.enabled}
          onchange={(e) => (profile!.away.startDate = fromDateInput(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span>Until</span>
        <input
          type="datetime-local"
          value={toDateInput(profile.away.endDate)}
          disabled={!profile.away.enabled}
          onchange={(e) => (profile!.away.endDate = fromDateInput(e.currentTarget.value))}
        />
      </label>
    {/if}

    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.away.offlineOnly}
        disabled={!profile.away.enabled}
        onchange={() => (profile!.away.offlineOnly = !profile!.away.offlineOnly)}
      />
      <span>Only when I am offline</span>
    </label>

    <p class="label">Send to</p>
    {#each RECIPIENT_FIELDS as field}
      <label class="toggle">
        <input
          type="checkbox"
          checked={profile.away.recipients[field.key] as boolean}
          disabled={!profile.away.enabled}
          onchange={() =>
            ((profile!.away.recipients[field.key] as boolean) = !profile!.away.recipients[field.key])}
        />
        <span>{field.label}</span>
      </label>
    {/each}
    <label class="toggle">
      <input
        type="checkbox"
        checked={profile.away.recipients.excludeSelected}
        disabled={!profile.away.enabled}
        onchange={() => (profile!.away.recipients.excludeSelected = !profile!.away.recipients.excludeSelected)}
      />
      <span>Treat the list above as exclusions</span>
    </label>

    <button
      class="primary"
      disabled={saving === 'away'}
      onclick={() => run('away', () => saveAway(JSON.parse(JSON.stringify(profile!.away))), 'Away message saved')}
    >
      {saving === 'away' ? 'Saving…' : 'Save away message'}
    </button>

  {:else if panel === 'intro'}
    <label class="field"><span>Title</span><input bind:value={profile.introTitle} /></label>
    <label class="field">
      <span>Description</span>
      <input bind:value={profile.introDescription} />
    </label>
    <p class="muted small">
      The intro replaces the default "no messages here yet" placeholder people see
      when they open a chat with you. Empty both fields to restore it.
    </p>
    <button
      class="primary"
      disabled={saving === 'intro'}
      onclick={() => run('intro', () => saveIntro(profile!.introTitle, profile!.introDescription), 'Intro saved')}
    >
      {saving === 'intro' ? 'Saving…' : 'Save intro'}
    </button>

  {:else}
    {#if connectedBotId}
      <div class="bot-head">
        <Avatar peerId={connectedBotId} title="Bot" size={48} />
        <span class="muted small">Connected bot</span>
      </div>
    {:else}
      <label class="field">
        <span>Bot username</span>
        <input bind:value={botUsername} placeholder="@mybusinessbot" />
      </label>
      <button class="primary" disabled={saving === 'chatbot'} onclick={connectBot}>
        {saving === 'chatbot' ? 'Connecting…' : 'Connect bot'}
      </button>
    {/if}

    <p class="label">The bot may</p>
    {#each BOT_RIGHTS as right}
      <label class="toggle">
        <input
          type="checkbox"
          checked={bot.rights.includes(right.key)}
          onchange={() => toggleRight(right.key)}
        />
        <span>{right.label}</span>
      </label>
    {/each}

    <p class="label">Chats the bot handles</p>
    {#each RECIPIENT_FIELDS as field}
      <label class="toggle">
        <input
          type="checkbox"
          checked={bot.recipients[field.key] as boolean}
          onchange={() => ((bot!.recipients[field.key] as boolean) = !bot!.recipients[field.key])}
        />
        <span>{field.label}</span>
      </label>
    {/each}
    <label class="toggle">
      <input
        type="checkbox"
        checked={bot.recipients.excludeSelected}
        onchange={() => (bot!.recipients.excludeSelected = !bot!.recipients.excludeSelected)}
      />
      <span>Treat the list above as exclusions</span>
    </label>

    {#if bot.excludedPeerIds.length}
      <p class="label">Excluded chats</p>
      {#each bot.excludedPeerIds as peerId (peerId)}
        <div class="excluded">
          <Avatar {peerId} title="Chat" size={28} />
          <button
            class="danger small-btn"
            onclick={() => (bot!.excludedPeerIds = bot!.excludedPeerIds.filter((id) => id !== peerId))}
          >Remove</button>
        </div>
      {/each}
      <p class="muted small">
        Chats are added to this list from the chat itself; here they can only be
        lifted.
      </p>
    {/if}

    {#if connectedBotId}
      <button
        class="primary"
        disabled={saving === 'chatbot'}
        onclick={() =>
          run(
            'chatbot',
            () => saveConnectedBot(JSON.parse(JSON.stringify(bot!)), connectedBotId),
            'Chatbot updated'
          )}
      >
        {saving === 'chatbot' ? 'Saving…' : 'Save chatbot settings'}
      </button>
      <button class="danger" disabled={saving === 'chatbot'} onclick={removeBot}>Disconnect bot</button>
    {/if}
  {/if}
{/if}

<style>
  .panels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .panels button {
    padding: 5px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
  }

  .panels button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .day {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .day.off {
    opacity: 0.5;
  }

  .day-name {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 120px;
    flex: none;
  }

  .closed {
    margin-left: 2px;
  }

  .dash {
    color: var(--text-dim);
  }

  .reply {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .reply-name {
    font-size: 14px;
    font-weight: 500;
  }

  .reply-actions {
    grid-row: span 2;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .bot-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .excluded {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    margin: 10px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input,
  select {
    padding: 8px 11px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus,
  select:focus {
    border-color: var(--accent);
  }

  .day input[type='time'] {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 12px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .primary,
  .danger,
  .small-btn {
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  .danger {
    color: var(--danger);
  }

  .small-btn {
    padding: 6px 10px;
    font-size: 12px;
    justify-self: start;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }
</style>
