<script lang="ts">
  import Avatar from './Avatar.svelte';
  import PeerPicker from './PeerPicker.svelte';
  import {loadDialogs, type DialogItem} from '$lib/telegram/chats';
  import {
    AUTO_DELETE_OPTIONS,
    PRIVACY_KEYS,
    blockPeer,
    cancelPasswordEmail,
    confirmPasswordEmail,
    disableCloudPassword,
    loadAllPrivacy,
    loadAutoDeletePeriod,
    loadBlocked,
    loadGlobalPrivacy,
    loadPasswordState,
    loadSessionDetails,
    loadWebSessions,
    resendPasswordEmail,
    revokeAllWebSessions,
    revokeWebSession,
    saveAutoDeletePeriod,
    saveGlobalPrivacy,
    savePrivacy,
    setSessionCallsAccepted,
    unblockPeer,
    updateCloudPassword,
    type BlockedPeer,
    type GlobalPrivacy,
    type PasswordState,
    type PrivacyKeyId,
    type PrivacySetting,
    type PrivacyValue,
    type SessionDetail,
    type WebSession
  } from '$lib/telegram/privacy';
  import {terminateOtherSessions, terminateSession} from '$lib/telegram/settings';

  let {view}: {view: 'privacy' | 'security'} = $props();

  const BLOCKED_PAGE = 30;

  let error = $state('');
  let status = $state('');

  /* -------------------------------------------------- privacy rules */

  let rules = $state<PrivacySetting[]>([]);
  let expanded = $state<PrivacyKeyId | null>(null);
  let global = $state<GlobalPrivacy | null>(null);
  let autoDelete = $state<number | null>(null);

  let dialogs = $state<DialogItem[]>([]);
  let picking = $state<{key: PrivacyKeyId; list: 'allow' | 'disallow'} | null>(null);

  /* ------------------------------------------------- blocked peers */

  let blocked = $state<BlockedPeer[]>([]);
  let blockedCount = $state(0);
  let blockedLoading = $state(false);
  let blockPicking = $state(false);

  /* -------------------------------------------------------- 2fa */

  let password = $state<PasswordState | null>(null);
  let pwCurrent = $state('');
  let pwNew = $state('');
  let pwRepeat = $state('');
  let pwHint = $state('');
  let pwEmail = $state('');
  let pwCode = $state('');
  let pwCodeLength = $state(0);
  let pwForm = $state<'idle' | 'set' | 'code'>('idle');
  let busy = $state(false);

  /* --------------------------------------------------- sessions */

  let sessions = $state<SessionDetail[]>([]);
  let webSessions = $state<WebSession[]>([]);

  let loaded = $state<Record<string, boolean>>({});

  $effect(() => {
    const current = view;
    if(loaded[current]) return;
    loaded = {...loaded, [current]: true};

    (async () => {
      try {
        if(current === 'privacy') {
          const [loadedRules, loadedGlobal, period, loadedDialogs] = await Promise.all([
            loadAllPrivacy(),
            loadGlobalPrivacy(),
            loadAutoDeletePeriod(),
            loadDialogs(200)
          ]);
          rules = loadedRules;
          global = loadedGlobal;
          autoDelete = period;
          dialogs = loadedDialogs;
        } else {
          const [state, sessionList, webList] = await Promise.all([
            loadPasswordState(),
            loadSessionDetails(),
            loadWebSessions().catch((): WebSession[] => [])
          ]);
          password = state;
          pwHint = state.hint;
          sessions = sessionList;
          webSessions = webList;
          if(!dialogs.length) dialogs = await loadDialogs(200);
          await loadBlockedPage(true);
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

  function fail(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }

  function titleOf(peerId: number) {
    return dialogs.find((d) => d.peerId === peerId)?.title ?? `Peer ${peerId}`;
  }

  /* -------------------------------------------------- privacy rules */

  function ruleOf(key: PrivacyKeyId) {
    return rules.find((rule) => rule.key === key);
  }

  async function persist(setting: PrivacySetting) {
    // Send plain values — a $state proxy cannot be structured-cloned to the worker.
    const plain: PrivacySetting = {
      key: setting.key,
      value: setting.value,
      allow: [...setting.allow],
      disallow: [...setting.disallow]
    };

    try {
      await savePrivacy(plain);
      flash('Privacy updated');
    } catch(err: any) {
      fail(err, 'Failed to save privacy');
    }
  }

  function setValue(key: PrivacyKeyId, value: PrivacyValue) {
    rules = rules.map((rule) => (rule.key === key ? {...rule, value} : rule));
    const updated = ruleOf(key);
    if(updated) persist(updated);
  }

  function pickException(peerId: number) {
    if(!picking) return;
    const {key, list} = picking;
    picking = null;

    rules = rules.map((rule) => {
      if(rule.key !== key) return rule;
      if(rule[list].includes(peerId)) return rule;
      const other = list === 'allow' ? 'disallow' : 'allow';
      return {
        ...rule,
        [list]: [...rule[list], peerId],
        [other]: rule[other].filter((id) => id !== peerId)
      };
    });

    const updated = ruleOf(key);
    if(updated) persist(updated);
  }

  function removeException(key: PrivacyKeyId, list: 'allow' | 'disallow', peerId: number) {
    rules = rules.map((rule) =>
      rule.key === key ? {...rule, [list]: rule[list].filter((id) => id !== peerId)} : rule
    );
    const updated = ruleOf(key);
    if(updated) persist(updated);
  }

  async function toggleGlobal(flag: keyof GlobalPrivacy) {
    if(!global) return;
    const next: GlobalPrivacy = {...global, [flag]: !global[flag]};
    const previous = global;
    global = next;
    try {
      await saveGlobalPrivacy(next);
    } catch(err: any) {
      global = previous;
      fail(err, 'Failed to save');
    }
  }

  async function chooseAutoDelete(period: number) {
    const previous = autoDelete;
    autoDelete = period;
    try {
      await saveAutoDeletePeriod(period);
      flash('Auto-delete updated');
    } catch(err: any) {
      autoDelete = previous;
      fail(err, 'Failed to save auto-delete');
    }
  }

  /* -------------------------------------------------- blocked peers */

  async function loadBlockedPage(reset = false) {
    if(blockedLoading) return;
    blockedLoading = true;
    try {
      const offset = reset ? 0 : blocked.length;
      const page = await loadBlocked(offset, BLOCKED_PAGE);
      blockedCount = page.count;
      blocked = reset ? page.peers : [...blocked, ...page.peers];
    } catch(err: any) {
      fail(err, 'Failed to load blocked users');
    } finally {
      blockedLoading = false;
    }
  }

  async function unblock(peer: BlockedPeer) {
    try {
      await unblockPeer(peer.peerId);
      blocked = blocked.filter((p) => p.peerId !== peer.peerId);
      blockedCount = Math.max(0, blockedCount - 1);
    } catch(err: any) {
      fail(err, 'Failed to unblock');
    }
  }

  async function block(peerId: number) {
    blockPicking = false;
    try {
      await blockPeer(peerId);
      await loadBlockedPage(true);
      flash('User blocked');
    } catch(err: any) {
      fail(err, 'Failed to block');
    }
  }

  /* -------------------------------------------------------- 2fa */

  async function submitPassword() {
    error = '';
    if(pwNew !== pwRepeat) {
      error = 'Passwords do not match';
      return;
    }
    if(!pwNew) {
      error = 'Enter a new password';
      return;
    }

    busy = true;
    try {
      const length = await updateCloudPassword({
        currentPassword: password?.hasPassword ? pwCurrent : undefined,
        newPassword: pwNew,
        hint: pwHint,
        email: pwEmail.trim()
      });

      if(length) {
        pwCodeLength = length;
        pwForm = 'code';
        flash(`Confirmation code sent to ${pwEmail.trim()}`);
      } else {
        await refreshPassword('Password saved');
      }
    } catch(err: any) {
      fail(err, 'Failed to set password');
    } finally {
      busy = false;
    }
  }

  async function submitCode() {
    busy = true;
    try {
      await confirmPasswordEmail(pwCode.trim());
      await refreshPassword('Recovery email confirmed');
    } catch(err: any) {
      fail(err, 'Wrong code');
    } finally {
      busy = false;
    }
  }

  async function refreshPassword(message: string) {
    password = await loadPasswordState();
    pwCurrent = pwNew = pwRepeat = pwEmail = pwCode = '';
    pwHint = password.hint;
    pwCodeLength = 0;
    pwForm = 'idle';
    flash(message);
  }

  async function turnOffPassword() {
    if(!pwCurrent) {
      error = 'Enter your current password to turn it off';
      return;
    }
    if(!confirm('Turn off the cloud password?')) return;

    busy = true;
    try {
      await disableCloudPassword(pwCurrent);
      await refreshPassword('Cloud password turned off');
    } catch(err: any) {
      fail(err, 'Failed to turn off the password');
    } finally {
      busy = false;
    }
  }

  async function resendEmail() {
    try {
      await resendPasswordEmail();
      flash('Code sent again');
    } catch(err: any) {
      fail(err, 'Failed to resend');
    }
  }

  async function abortEmail() {
    try {
      await cancelPasswordEmail();
      await refreshPassword('Recovery email cancelled');
    } catch(err: any) {
      fail(err, 'Failed to cancel');
    }
  }

  /* --------------------------------------------------- sessions */

  async function kill(session: SessionDetail) {
    try {
      await terminateSession(session.hash);
      sessions = sessions.filter((s) => s.hash !== session.hash);
    } catch(err: any) {
      fail(err, 'Failed to terminate');
    }
  }

  async function killOthers() {
    if(!confirm('Terminate all other sessions?')) return;
    try {
      await terminateOtherSessions();
      sessions = sessions.filter((s) => s.current);
      flash('Other sessions terminated');
    } catch(err: any) {
      fail(err, 'Failed to terminate');
    }
  }

  async function toggleCalls(session: SessionDetail) {
    const accepted = session.callsDisabled;
    try {
      await setSessionCallsAccepted(session.hash, accepted);
      sessions = sessions.map((s) => (s.hash === session.hash ? {...s, callsDisabled: !accepted} : s));
    } catch(err: any) {
      fail(err, 'Failed to update session');
    }
  }

  async function revokeWeb(session: WebSession) {
    try {
      await revokeWebSession(session.hash);
      webSessions = webSessions.filter((s) => s.hash !== session.hash);
    } catch(err: any) {
      fail(err, 'Failed to revoke');
    }
  }

  async function revokeAllWeb() {
    if(!confirm('Disconnect all websites?')) return;
    try {
      await revokeAllWebSessions();
      webSessions = [];
      flash('All websites disconnected');
    } catch(err: any) {
      fail(err, 'Failed to revoke');
    }
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if status}<p class="ok">{status}</p>{/if}

{#if view === 'privacy'}
  {#if !rules.length}
    <p class="muted">Loading…</p>
  {:else}
    <p class="label">Who can see / do what</p>
    {#each PRIVACY_KEYS as meta (meta.key)}
      {@const rule = ruleOf(meta.key)}
      {#if rule}
        <div class="rule">
          <button
            class="rule-head"
            onclick={() => (expanded = expanded === meta.key ? null : meta.key)}
          >
            <span class="rule-title">{meta.title}</span>
            <span class="rule-value">
              {rule.value === 'everybody' ? 'Everybody' : rule.value === 'contacts' ? 'My Contacts' : 'Nobody'}
            </span>
          </button>

          {#if expanded === meta.key}
            <div class="chips">
              {#each [['everybody', 'Everybody'], ['contacts', 'My Contacts'], ['nobody', 'Nobody']] as [value, label]}
                <button
                  class:on={rule.value === value}
                  onclick={() => setValue(meta.key, value as PrivacyValue)}
                >{label}</button>
              {/each}
            </div>
            <p class="muted small">{meta.hint}</p>
            {#if meta.premiumOnly}
              <p class="muted small">Premium only — saving fails without a Premium subscription.</p>
            {/if}

            {#each [['allow', 'Always allow'], ['disallow', 'Never allow']] as [list, listLabel]}
              <p class="sub-label">{listLabel}</p>
              <div class="exceptions">
                {#each rule[list as 'allow' | 'disallow'] as peerId (peerId)}
                  <span class="exception">
                    {titleOf(peerId)}
                    <button
                      class="x"
                      aria-label="Remove"
                      onclick={() => removeException(meta.key, list as 'allow' | 'disallow', peerId)}
                    >✕</button>
                  </span>
                {/each}
                <button
                  class="add"
                  onclick={() => (picking = {key: meta.key, list: list as 'allow' | 'disallow'})}
                >+ Add exception</button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    {/each}

    {#if global}
      <p class="label">Messages</p>
      <label class="toggle">
        <input
          type="checkbox"
          checked={global.restrictNonContacts}
          onchange={() => toggleGlobal('restrictNonContacts')}
        />
        <span>Only contacts and Premium users can message me</span>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          checked={global.archiveNonContacts}
          onchange={() => toggleGlobal('archiveNonContacts')}
        />
        <span>Archive and mute new chats from non-contacts</span>
      </label>
      <label class="toggle">
        <input
          type="checkbox"
          checked={global.hideReadMarks}
          onchange={() => toggleGlobal('hideReadMarks')}
        />
        <span>Hide read time (you will not see theirs either)</span>
      </label>
    {/if}

    <p class="label">Auto-delete messages</p>
    <div class="chips">
      {#each AUTO_DELETE_OPTIONS as option}
        <button class:on={autoDelete === option.value} onclick={() => chooseAutoDelete(option.value)}>
          {option.label}
        </button>
      {/each}
    </div>
    <p class="muted small">
      Applies to new chats you start. Existing chats keep their own timer.
    </p>
  {/if}

{:else}
  <p class="label">Two-step verification</p>
  {#if !password}
    <p class="muted">Loading…</p>
  {:else}
    <p class="status-line">
      {password.hasPassword ? 'Cloud password is on' : 'Cloud password is off'}
      {#if password.hint && password.hasPassword}<span class="muted small"> · hint: {password.hint}</span>{/if}
    </p>

    {#if password.unconfirmedEmailPattern && pwForm !== 'code'}
      <p class="muted small">
        Recovery email {password.unconfirmedEmailPattern} is not confirmed yet.
      </p>
      <div class="row-buttons">
        <button class="small-btn" onclick={resendEmail}>Resend code</button>
        <button class="small-btn danger" onclick={abortEmail}>Cancel email</button>
      </div>
    {/if}

    {#if pwForm === 'code'}
      <label class="field">
        <span>Confirmation code{pwCodeLength ? ` (${pwCodeLength} digits)` : ''}</span>
        <input bind:value={pwCode} inputmode="numeric" />
      </label>
      <button class="primary" onclick={submitCode} disabled={busy}>
        {busy ? 'Checking…' : 'Confirm email'}
      </button>
      <button class="small-btn" onclick={resendEmail}>Resend code</button>
    {:else if pwForm === 'set'}
      {#if password.hasPassword}
        <label class="field"><span>Current password</span><input type="password" bind:value={pwCurrent} /></label>
      {/if}
      <label class="field"><span>New password</span><input type="password" bind:value={pwNew} /></label>
      <label class="field"><span>Repeat password</span><input type="password" bind:value={pwRepeat} /></label>
      <label class="field"><span>Hint (optional)</span><input bind:value={pwHint} /></label>
      <label class="field"><span>Recovery email (optional)</span><input bind:value={pwEmail} /></label>
      <button class="primary" onclick={submitPassword} disabled={busy}>
        {busy ? 'Saving…' : password.hasPassword ? 'Change password' : 'Set password'}
      </button>
      <button class="small-btn" onclick={() => (pwForm = 'idle')}>Cancel</button>
    {:else}
      <button class="primary" onclick={() => (pwForm = 'set')}>
        {password.hasPassword ? 'Change password' : 'Set a password'}
      </button>
      {#if password.hasPassword}
        <label class="field"><span>Current password</span><input type="password" bind:value={pwCurrent} /></label>
        <button class="danger" onclick={turnOffPassword} disabled={busy}>Turn password off</button>
      {/if}
    {/if}
  {/if}

  <p class="label">Blocked users {blockedCount ? `(${blockedCount})` : ''}</p>
  <button class="small-btn" onclick={() => (blockPicking = true)}>+ Block a user</button>
  {#if !blocked.length}
    <p class="muted small">{blockedLoading ? 'Loading…' : 'Nobody is blocked.'}</p>
  {:else}
    {#each blocked as peer (peer.peerId)}
      <div class="blocked">
        <Avatar peerId={peer.peerId} title={peer.title} size={32} />
        <span class="blocked-name">
          {peer.title}
          {#if peer.username}<span class="muted small">@{peer.username}</span>{/if}
        </span>
        <button class="small-btn" onclick={() => unblock(peer)}>Unblock</button>
      </div>
    {/each}
    {#if blocked.length < blockedCount}
      <button class="small-btn" onclick={() => loadBlockedPage()} disabled={blockedLoading}>
        {blockedLoading ? 'Loading…' : 'Load more'}
      </button>
    {/if}
  {/if}

  <p class="label">Active sessions</p>
  {#if !sessions.length}
    <p class="muted small">Loading…</p>
  {:else}
    {#each sessions as session (session.hash)}
      <div class="session">
        <span class="session-name">
          {session.appName}{session.appVersion ? ` ${session.appVersion}` : ''}
          {#if session.current}<span class="badge">this device</span>{/if}
          {#if session.unconfirmed}<span class="badge warn">unconfirmed</span>{/if}
          {#if session.official}<span class="badge">official</span>{/if}
        </span>
        <span class="muted small">{session.deviceModel}</span>
        <span class="muted small">
          {[session.platform, session.systemVersion].filter(Boolean).join(' ')}
        </span>
        <span class="muted small">{[session.ip, session.location].filter(Boolean).join(' · ')}</span>
        <span class="muted small">
          Last active {dateOf(session.dateActive)}{session.dateCreated ? ` · created ${dateOf(session.dateCreated)}` : ''}
        </span>
        {#if !session.current}
          <label class="toggle small">
            <input type="checkbox" checked={!session.callsDisabled} onchange={() => toggleCalls(session)} />
            <span>Accept calls</span>
          </label>
          <button class="danger small-btn" onclick={() => kill(session)}>Terminate</button>
        {/if}
      </div>
    {/each}
    {#if sessions.length > 1}
      <button class="danger" onclick={killOthers}>Terminate all other sessions</button>
    {/if}
  {/if}

  <p class="label">Connected websites</p>
  {#if !webSessions.length}
    <p class="muted small">No websites are connected.</p>
  {:else}
    {#each webSessions as session (session.hash)}
      <div class="session">
        <span class="session-name">{session.domain || session.botTitle || 'Website'}</span>
        {#if session.botTitle}<span class="muted small">via {session.botTitle}</span>{/if}
        <span class="muted small">{[session.browser, session.platform].filter(Boolean).join(' · ')}</span>
        <span class="muted small">{[session.ip, session.location].filter(Boolean).join(' · ')}</span>
        <span class="muted small">Last active {dateOf(session.dateActive)}</span>
        <button class="danger small-btn" onclick={() => revokeWeb(session)}>Disconnect</button>
      </div>
    {/each}
    <button class="danger" onclick={revokeAllWeb}>Disconnect all websites</button>
  {/if}
{/if}

{#if picking}
  <PeerPicker
    title={picking.list === 'allow' ? 'Always allow' : 'Never allow'}
    {dialogs}
    onpick={pickException}
    onclose={() => (picking = null)}
  />
{/if}

{#if blockPicking}
  <PeerPicker
    title="Block a user"
    dialogs={dialogs.filter((d) => d.isUser && !d.isSelf)}
    onpick={block}
    onclose={() => (blockPicking = false)}
  />
{/if}

<style>
  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .sub-label {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-dim);
  }

  .rule {
    display: grid;
    gap: 6px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .rule-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .rule-title {
    font-size: 14px;
  }

  .rule-value {
    font-size: 12px;
    color: var(--accent);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chips button {
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
  }

  .chips button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .exceptions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .exception {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
  }

  .exception .x {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }

  .add {
    padding: 4px 10px;
    border: 1px dashed var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .toggle.small {
    font-size: 12px;
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

  .blocked {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
  }

  .blocked-name {
    flex: 1;
    min-width: 0;
    display: grid;
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

  .badge.warn {
    background: var(--danger);
  }

  .row-buttons {
    display: flex;
    gap: 6px;
  }

  .status-line {
    margin: 0;
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
</style>
