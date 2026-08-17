<script lang="ts">
  import Avatar from './Avatar.svelte';
  import BusinessSettings from './BusinessSettings.svelte';
  import DataSettings from './DataSettings.svelte';
  import ImageCropper from './ImageCropper.svelte';
  import {
    disableNotifications,
    enableNotifications,
    notificationsEnabled,
    permission
  } from '$lib/telegram/notifications';
  import {
    loadAttachBots,
    loadBirthdayPrivacy,
    loadNotifyScopes,
    loadPersonalChannels,
    loadProfile,
    loadSessions,
    logOut,
    removeProfilePhoto,
    saveBirthday,
    saveBirthdayPrivacy,
    savePersonalChannel,
    saveProfile,
    saveUsername,
    setNotifyScope,
    terminateOtherSessions,
    terminateSession,
    uploadProfilePhoto,
    type AttachBot,
    type BirthdayPrivacy,
    type NotifyScope,
    type PersonalChannelOption,
    type ProfileInfo,
    type SessionInfo
  } from '$lib/telegram/settings';
  import {invalidateAvatarUrl} from '$lib/telegram/chats';
  import {
    ACCENTS,
    getAccent,
    getDensity,
    getThemeMode,
    setAccent,
    setDensity,
    setThemeMode,
    type Density,
    type ThemeMode
  } from '$lib/telegram/theme';
  import {loadPremium, loadStars, type PremiumInfo, type StarsInfo} from '$lib/telegram/extras';

  let {onclose, onminiapp}: {onclose: () => void; onminiapp: (botId: number) => void} = $props();

  type Section =
    | 'profile'
    | 'appearance'
    | 'notifications'
    | 'sessions'
    | 'data'
    | 'premium'
    | 'stars'
    | 'business'
    | 'bots';
  let section = $state<Section>('profile');

  let profile = $state<ProfileInfo | null>(null);
  let firstName = $state('');
  let lastName = $state('');
  let bio = $state('');
  let username = $state('');
  let saving = $state(false);
  let status = $state('');
  let error = $state('');

  let theme = $state<ThemeMode>(getThemeMode());
  let accent = $state(getAccent());
  let density = $state<Density>(getDensity());

  let scopes = $state<Record<NotifyScope, boolean> | null>(null);
  let desktopOn = $state(notificationsEnabled());

  let sessions = $state<SessionInfo[]>([]);
  let bots = $state<AttachBot[]>([]);

  // Profile extras: birthday, personal channel, avatar.
  let birthdayDate = $state('');
  let birthdayPrivacy = $state<BirthdayPrivacy>('nobody');
  let channels = $state<PersonalChannelOption[]>([]);
  let personalChannelId = $state(0);
  // Plain `let`, not `$state` — the File goes to the cropper and its Blob to the
  // worker, and a proxy there would fail to clone.
  let pendingPhoto: File | null = null;
  let cropping = $state(false);
  let photoBusy = $state('');
  let avatarVersion = $state(0);
  let photoInput: HTMLInputElement | null = $state(null);
  let premium = $state<PremiumInfo | null>(null);
  let stars = $state<StarsInfo | null>(null);

  $effect(() => {
    const current = section;
    error = '';

    (async () => {
      try {
        if(current === 'profile' && !profile) {
          profile = await loadProfile();
          firstName = profile.firstName;
          lastName = profile.lastName;
          bio = profile.bio;
          username = profile.username;
          personalChannelId = profile.personalChannelId;
          birthdayDate = profile.birthday ?
            `${String(profile.birthday.year ?? 1900).padStart(4, '0')}-${String(profile.birthday.month).padStart(2, '0')}-${String(profile.birthday.day).padStart(2, '0')}` :
            '';

          // Both are extras — a failure here must not blank the profile form.
          loadBirthdayPrivacy().then((value) => (birthdayPrivacy = value)).catch(() => {});
          loadPersonalChannels().then((value) => (channels = value)).catch(() => {});
        } else if(current === 'notifications' && !scopes) {
          scopes = await loadNotifyScopes();
        } else if(current === 'sessions' && !sessions.length) {
          sessions = await loadSessions();
        } else if(current === 'bots' && !bots.length) {
          bots = await loadAttachBots();
        } else if(current === 'premium' && !premium) {
          premium = await loadPremium();
        } else if(current === 'stars' && !stars) {
          stars = await loadStars();
        }
      } catch(err: any) {
        error = err?.type || err?.message || 'Failed to load';
      }
    })();
  });

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  async function submitProfile() {
    saving = true;
    error = '';
    try {
      await saveProfile(firstName.trim(), lastName.trim(), bio.trim());
      if(profile && username.trim() !== profile.username) {
        await saveUsername(username.trim());
      }
      profile = await loadProfile();
      flash('Saved');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to save';
    } finally {
      saving = false;
    }
  }

  async function toggleDesktop() {
    if(desktopOn) {
      disableNotifications();
      desktopOn = false;
    } else {
      desktopOn = await enableNotifications();
      if(!desktopOn) error = 'Permission denied by the browser';
    }
  }

  async function toggleScope(scope: NotifyScope) {
    if(!scopes) return;
    const next = !scopes[scope];
    scopes = {...scopes, [scope]: next};
    try {
      await setNotifyScope(scope, next);
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to update';
      scopes = {...scopes, [scope]: !next};
    }
  }

  async function kill(session: SessionInfo) {
    try {
      await terminateSession(session.hash);
      sessions = sessions.filter((s) => s.hash !== session.hash);
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to terminate';
    }
  }

  async function killOthers() {
    try {
      await terminateOtherSessions();
      sessions = sessions.filter((s) => s.current);
      flash('Other sessions terminated');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to terminate';
    }
  }

  /** `<input type="date">` gives `YYYY-MM-DD`; a blank value clears the birthday. */
  async function submitBirthday() {
    saving = true;
    error = '';
    try {
      if(!birthdayDate) {
        await saveBirthday(null);
      } else {
        const [year, month, day] = birthdayDate.split('-').map(Number);
        if(!day || !month) throw new Error('That date is not valid');
        // Telegram treats the year as optional; 1900 is our "not given" marker.
        await saveBirthday({day, month, year: year && year > 1900 ? year : null});
      }

      profile = await loadProfile();
      flash('Birthday saved');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to save birthday';
    } finally {
      saving = false;
    }
  }

  async function changeBirthdayPrivacy(value: BirthdayPrivacy) {
    const previous = birthdayPrivacy;
    birthdayPrivacy = value;
    try {
      await saveBirthdayPrivacy(value);
    } catch(err: any) {
      birthdayPrivacy = previous;
      error = err?.type || err?.message || 'Failed to update birthday privacy';
    }
  }

  async function changePersonalChannel(peerId: number) {
    const previous = personalChannelId;
    personalChannelId = peerId;
    try {
      await savePersonalChannel(peerId);
      flash(peerId ? 'Personal channel set' : 'Personal channel removed');
    } catch(err: any) {
      personalChannelId = previous;
      error = err?.type || err?.message || 'Failed to set the personal channel';
    }
  }

  function pickPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if(!file) return;

    pendingPhoto = file;
    cropping = true;
  }

  async function commitPhoto(blob: Blob) {
    cropping = false;
    pendingPhoto = null;
    photoBusy = 'upload';
    error = '';

    try {
      await uploadProfilePhoto(blob);
      if(profile) invalidateAvatarUrl(profile.userId);
      profile = await loadProfile();
      // Bumping the key remounts <Avatar/>, which re-reads the freshly
      // invalidated URL rather than showing the old cached one.
      ++avatarVersion;
      flash('Profile photo updated');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to upload the photo';
    } finally {
      photoBusy = '';
    }
  }

  async function dropPhoto() {
    if(!profile?.photoId || !confirm('Remove your profile photo?')) return;

    photoBusy = 'remove';
    error = '';
    try {
      await removeProfilePhoto(profile.photoId);
      invalidateAvatarUrl(profile.userId);
      profile = await loadProfile();
      ++avatarVersion;
      flash('Profile photo removed');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to remove the photo';
    } finally {
      photoBusy = '';
    }
  }

  async function doLogOut() {
    if(!confirm('Log out of this account?')) return;
    try {
      await logOut();
      location.reload();
    } catch(err: any) {
      error = err?.type || err?.message || 'Logout failed';
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }
</script>

<aside class="settings">
  <header>
    <span>Settings</span>
    <button class="close" onclick={onclose} aria-label="Close">✕</button>
  </header>

  <nav>
    {#each [['profile', 'Profile'], ['appearance', 'Appearance'], ['notifications', 'Notifications'], ['sessions', 'Devices'], ['data', 'Data'], ['premium', 'Premium'], ['stars', 'Stars'], ['business', 'Business'], ['bots', 'Bots']] as [key, label]}
      <button class:active={section === key} onclick={() => (section = key as Section)}>{label}</button>
    {/each}
  </nav>

  <div class="body">
    {#if error}<p class="error">{error}</p>{/if}
    {#if status}<p class="ok">{status}</p>{/if}

    {#if section === 'profile'}
      {#if !profile}
        <p class="muted">Loading…</p>
      {:else}
        <div class="head">
          {#key avatarVersion}
            <Avatar peerId={profile.userId} title={firstName || 'Me'} size={84} />
          {/key}
          <p class="phone">{profile.phone}{profile.isPremium ? ' · Premium' : ''}</p>
          <div class="photo-actions">
            <button class="small-btn" onclick={() => photoInput?.click()} disabled={!!photoBusy}>
              {photoBusy === 'upload' ? 'Uploading…' : profile.photoId ? 'Change photo' : 'Set photo'}
            </button>
            {#if profile.photoId}
              <button class="danger small-btn" onclick={dropPhoto} disabled={!!photoBusy}>
                {photoBusy === 'remove' ? 'Removing…' : 'Remove'}
              </button>
            {/if}
          </div>
          <input
            class="file-input"
            type="file"
            accept="image/*"
            bind:this={photoInput}
            onchange={pickPhoto}
          />
        </div>
        <label class="field"><span>First name</span><input bind:value={firstName} /></label>
        <label class="field"><span>Last name</span><input bind:value={lastName} /></label>
        <label class="field"><span>Bio</span><input bind:value={bio} maxlength="70" /></label>
        <label class="field"><span>Username</span><input bind:value={username} /></label>
        <button class="primary" onclick={submitProfile} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>

        <p class="label">Birthday</p>
        <label class="field">
          <span>Date</span>
          <input type="date" bind:value={birthdayDate} />
        </label>
        <label class="field">
          <span>Who can see it</span>
          <select
            value={birthdayPrivacy}
            onchange={(e) => changeBirthdayPrivacy(e.currentTarget.value as BirthdayPrivacy)}
          >
            <option value="everybody">Everybody</option>
            <option value="contacts">My contacts</option>
            <option value="nobody">Nobody</option>
          </select>
        </label>
        <p class="muted small">
          Setting a birthday does not reveal it on its own — the privacy above
          decides who sees it, and contacts who share theirs with you see yours.
        </p>
        <button class="small-btn" onclick={submitBirthday} disabled={saving}>
          {birthdayDate ? 'Save birthday' : 'Clear birthday'}
        </button>

        <p class="label">Personal channel</p>
        {#if !channels.length}
          <p class="muted small">
            You do not administer any channel that can be shown on your profile.
          </p>
        {:else}
          <label class="field">
            <span>Shown on your profile</span>
            <select
              value={personalChannelId}
              onchange={(e) => changePersonalChannel(Number(e.currentTarget.value))}
            >
              <option value={0}>None</option>
              {#each channels as channel (channel.peerId)}
                <option value={channel.peerId}>{channel.title}</option>
              {/each}
            </select>
          </label>
        {/if}

        <button class="danger" onclick={doLogOut}>Log out</button>
      {/if}

    {:else if section === 'appearance'}
      <p class="label">Theme</p>
      <div class="chips">
        {#each ['system', 'light', 'dark'] as mode}
          <button
            class:on={theme === mode}
            onclick={() => { theme = mode as ThemeMode; setThemeMode(theme); }}
          >{mode}</button>
        {/each}
      </div>

      <p class="label">Density</p>
      <div class="chips">
        <button
          class:on={density === 'comfortable'}
          onclick={() => { density = 'comfortable'; setDensity(density); }}
        >comfortable</button>
        <button
          class:on={density === 'console'}
          onclick={() => { density = 'console'; setDensity(density); }}
        >console</button>
      </div>
      <p class="muted small">
        Console swaps bubbles for an aligned monospace grid — about twice as many
        messages per screen.
      </p>

      <p class="label">Accent</p>
      <div class="swatches">
        {#each ACCENTS as option}
          <button
            class="swatch"
            class:on={accent === option.value}
            style="background: {option.value}"
            title={option.name}
            aria-label={option.name}
            onclick={() => { accent = option.value; setAccent(accent); }}
          ></button>
        {/each}
      </div>

    {:else if section === 'notifications'}
      <label class="toggle">
        <input type="checkbox" checked={desktopOn} onchange={toggleDesktop} />
        <span>Desktop notifications</span>
      </label>
      <p class="muted small">Browser permission: {permission()}</p>

      <p class="label">Notify me about</p>
      {#if !scopes}
        <p class="muted">Loading…</p>
      {:else}
        {#each [['users', 'Private chats'], ['groups', 'Groups'], ['channels', 'Channels']] as [key, label]}
          <label class="toggle">
            <input
              type="checkbox"
              checked={scopes[key as NotifyScope]}
              onchange={() => toggleScope(key as NotifyScope)}
            />
            <span>{label}</span>
          </label>
        {/each}
      {/if}

    {:else if section === 'sessions'}
      {#if !sessions.length}
        <p class="muted">Loading…</p>
      {:else}
        {#each sessions as session (session.hash)}
          <div class="session">
            <span class="session-name">
              {session.appName} · {session.deviceModel}
              {#if session.current}<span class="badge">this device</span>{/if}
            </span>
            <span class="muted small">
              {session.platform} · {[session.ip, session.country].filter(Boolean).join(' · ')}
            </span>
            <span class="muted small">{dateOf(session.dateActive)}</span>
            {#if !session.current}
              <button class="danger small-btn" onclick={() => kill(session)}>Terminate</button>
            {/if}
          </div>
        {/each}
        <button class="danger" onclick={killOthers}>Terminate all other sessions</button>
      {/if}

    {:else if section === 'premium'}
      {#if !premium}
        <p class="muted">Loading…</p>
      {:else}
        <p class="status-line">
          {premium.active ? '★ Premium is active on this account' : 'Premium is not active'}
        </p>
        <p class="label">What Premium includes</p>
        {#each premium.features as feature}
          <div class="feature">
            <span class="feature-title">{feature.title}</span>
            {#if feature.description}
              <span class="muted small">{feature.description}</span>
            {/if}
          </div>
        {/each}
        <p class="muted small">
          Subscribing is not wired up — payments need the full invoice flow.
        </p>
      {/if}

    {:else if section === 'stars'}
      {#if !stars}
        <p class="muted">Loading…</p>
      {:else}
        <p class="balance">★ {stars.balance.toLocaleString()}</p>
        <p class="label">Recent transactions</p>
        {#if !stars.transactions.length}
          <p class="muted small">No transactions yet.</p>
        {:else}
          {#each stars.transactions as transaction (transaction.id)}
            <div class="transaction">
              <span>{transaction.title}</span>
              <span class:incoming={transaction.incoming} class="amount">
                {transaction.incoming ? '+' : '−'}{transaction.amount}
              </span>
              <span class="muted small">{dateOf(transaction.date)}</span>
            </div>
          {/each}
        {/if}
      {/if}

    {:else if section === 'data'}
      <DataSettings onerror={(message) => (error = message)} />

    {:else if section === 'business'}
      <BusinessSettings onerror={(message) => (error = message)} />

    {:else}
      {#if !bots.length}
        <p class="muted">No mini apps installed.</p>
      {:else}
        {#each bots as bot (bot.botId)}
          <button class="bot" onclick={() => onminiapp(bot.botId)}>
            <Avatar peerId={bot.botId} title={bot.name || 'Bot'} size={36} />
            <span>{bot.name || 'Mini app'}</span>
          </button>
        {/each}
      {/if}
      <p class="muted small">
        Inline bots also work from the composer — type @botname followed by a query.
      </p>
    {/if}
  </div>
</aside>

{#if cropping && pendingPhoto}
  <ImageCropper
    file={pendingPhoto}
    title="Crop your profile photo"
    onconfirm={commitPhoto}
    oncancel={() => {
      cropping = false;
      pendingPhoto = null;
    }}
  />
{/if}

<style>
  .settings {
    width: 340px;
    flex: none;
    background: var(--pane);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    backdrop-filter: blur(var(--blur));
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  .close {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 15px;
  }

  nav {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  nav button {
    flex: none;
    padding: 6px 10px;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  nav button.active {
    background: var(--accent);
    color: #fff;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 18px;
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .head {
    display: grid;
    justify-items: center;
    gap: 6px;
  }

  .phone {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .field select {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field select:focus {
    border-color: var(--accent);
  }

  .photo-actions {
    display: flex;
    gap: 6px;
  }

  .file-input {
    display: none;
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    gap: 6px;
  }

  .chips button {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    text-transform: capitalize;
  }

  .chips button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .swatches {
    display: flex;
    gap: 8px;
  }

  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }

  .swatch.on {
    border-color: var(--text);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .session {
    display: grid;
    gap: 2px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }

  .session-name {
    font-size: 14px;
    font-weight: 500;
  }

  .badge {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
  }

  .bot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
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

  .status-line {
    margin: 0;
    font-size: 14px;
  }

  .feature {
    display: grid;
    gap: 2px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .feature-title {
    font-size: 14px;
    font-weight: 500;
  }

  .balance {
    margin: 0;
    font-size: 30px;
    font-weight: 700;
    color: var(--accent);
  }

  .transaction {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  .amount {
    font-weight: 600;
    color: var(--danger);
  }

  .amount.incoming {
    color: #3aa657;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }

  @media (max-width: 860px) {
    .settings {
      position: fixed;
      inset: 0;
      width: 100%;
      background: var(--bg);
      z-index: 85;
    }
  }
</style>
