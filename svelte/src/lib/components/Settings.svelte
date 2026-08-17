<script lang="ts">
  import Avatar from './Avatar.svelte';
  import PrivacySettings from './PrivacySettings.svelte';
  import NotificationSettings from './NotificationSettings.svelte';
  import {
    loadAttachBots,
    loadBusiness,
    loadProfile,
    logOut,
    saveBusinessIntro,
    saveProfile,
    saveUsername,
    type AttachBot,
    type BusinessInfo,
    type ProfileInfo
  } from '$lib/telegram/settings';
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
    | 'privacy'
    | 'security'
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

  let business = $state<BusinessInfo | null>(null);
  let introTitle = $state('');
  let introDescription = $state('');
  let bots = $state<AttachBot[]>([]);
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
        } else if(current === 'business' && !business) {
          business = await loadBusiness();
          introTitle = business.introTitle;
          introDescription = business.introDescription;
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

  async function submitIntro() {
    saving = true;
    try {
      await saveBusinessIntro(introTitle.trim(), introDescription.trim());
      flash('Intro saved');
    } catch(err: any) {
      error = err?.type || err?.message || 'Failed to save intro';
    } finally {
      saving = false;
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
    {#each [['profile', 'Profile'], ['appearance', 'Appearance'], ['notifications', 'Notifications'], ['privacy', 'Privacy'], ['security', 'Security'], ['premium', 'Premium'], ['stars', 'Stars'], ['business', 'Business'], ['bots', 'Bots']] as [key, label]}
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
          <Avatar peerId={profile.userId} title={firstName || 'Me'} size={84} />
          <p class="phone">{profile.phone}{profile.isPremium ? ' · Premium' : ''}</p>
        </div>
        <label class="field"><span>First name</span><input bind:value={firstName} /></label>
        <label class="field"><span>Last name</span><input bind:value={lastName} /></label>
        <label class="field"><span>Bio</span><input bind:value={bio} maxlength="70" /></label>
        <label class="field"><span>Username</span><input bind:value={username} /></label>
        <button class="primary" onclick={submitProfile} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
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
      <NotificationSettings />

    {:else if section === 'privacy' || section === 'security'}
      <PrivacySettings view={section} />

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

    {:else if section === 'business'}
      {#if !business}
        <p class="muted">Loading…</p>
      {:else}
        <p class="label">Current business setup</p>
        <p class="muted small">Working hours: {business.hoursText || 'not set'}</p>
        <p class="muted small">Location: {business.location || 'not set'}</p>
        <p class="muted small">Greeting message: {business.greeting ? 'on' : 'off'}</p>
        <p class="muted small">Away message: {business.away ? 'on' : 'off'}</p>

        <p class="label">Intro</p>
        <label class="field"><span>Title</span><input bind:value={introTitle} /></label>
        <label class="field"><span>Description</span><input bind:value={introDescription} /></label>
        <button class="primary" onclick={submitIntro} disabled={saving}>
          {saving ? 'Saving…' : 'Save intro'}
        </button>
        <p class="muted small">
          Hours, location, greeting and away messages are read-only here — editing them
          needs Premium and the full business editor.
        </p>
      {/if}

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
  .danger {
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
