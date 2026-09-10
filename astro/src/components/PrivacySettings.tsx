/*
 * Privacy & Security settings: per-key privacy rules and their exception lists,
 * blocked peers, two-step verification, active sessions, connected websites and
 * the account-wide auto-delete period.
 *
 * Ported from svelte/src/lib/components/PrivacySettings.svelte.
 *
 * The `$effect` that loads a section the first time it is opened reads the `view`
 * *prop*, so it is a `useEffect` with `view` in its dependency list: a
 * `useSignalEffect` would track signal reads only and never re-run on a section
 * switch (CONVERSION.md §4). The `loaded` guard it consults is a signal, read and
 * written as `.value`, and every other rune gained a `.value` the same way.
 */
import {Fragment} from 'preact';
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {PeerPicker} from './PeerPicker';
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

import './PrivacySettings.css';

interface Props {
  view: 'privacy' | 'security';
}

export function PrivacySettings({view}: Props) {
  const BLOCKED_PAGE = 30;

  const error = useSignal('');
  const status = useSignal('');

  /* -------------------------------------------------- privacy rules */

  const rules = useSignal<PrivacySetting[]>([]);
  const expanded = useSignal<PrivacyKeyId | null>(null);
  const global = useSignal<GlobalPrivacy | null>(null);
  const autoDelete = useSignal<number | null>(null);

  const dialogs = useSignal<DialogItem[]>([]);
  const picking = useSignal<{key: PrivacyKeyId; list: 'allow' | 'disallow'} | null>(null);

  /* ------------------------------------------------- blocked peers */

  const blocked = useSignal<BlockedPeer[]>([]);
  const blockedCount = useSignal(0);
  const blockedLoading = useSignal(false);
  const blockPicking = useSignal(false);

  /* -------------------------------------------------------- 2fa */

  const password = useSignal<PasswordState | null>(null);
  const pwCurrent = useSignal('');
  const pwNew = useSignal('');
  const pwRepeat = useSignal('');
  const pwHint = useSignal('');
  const pwEmail = useSignal('');
  const pwCode = useSignal('');
  const pwCodeLength = useSignal(0);
  const pwForm = useSignal<'idle' | 'set' | 'code'>('idle');
  const busy = useSignal(false);

  /* --------------------------------------------------- sessions */

  const sessions = useSignal<SessionDetail[]>([]);
  const webSessions = useSignal<WebSession[]>([]);

  const loaded = useSignal<Record<string, boolean>>({});

  useEffect(() => {
    const current = view;
    if(loaded.value[current]) return;
    loaded.value = {...loaded.value, [current]: true};

    (async() => {
      try {
        if(current === 'privacy') {
          const [loadedRules, loadedGlobal, period, loadedDialogs] = await Promise.all([
            loadAllPrivacy(),
            loadGlobalPrivacy(),
            loadAutoDeletePeriod(),
            loadDialogs(200)
          ]);
          rules.value = loadedRules;
          global.value = loadedGlobal;
          autoDelete.value = period;
          dialogs.value = loadedDialogs;
        } else {
          const [state, sessionList, webList] = await Promise.all([
            loadPasswordState(),
            loadSessionDetails(),
            loadWebSessions().catch((): WebSession[] => [])
          ]);
          password.value = state;
          pwHint.value = state.hint;
          sessions.value = sessionList;
          webSessions.value = webList;
          if(!dialogs.value.length) dialogs.value = await loadDialogs(200);
          await loadBlockedPage(true);
        }
      } catch(err: any) {
        error.value = err?.type || err?.message || 'Failed to load';
      }
    })();
  }, [view]);

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  function fail(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }

  function titleOf(peerId: number) {
    return dialogs.value.find((d) => d.peerId === peerId)?.title ?? `Peer ${peerId}`;
  }

  /* -------------------------------------------------- privacy rules */

  function ruleOf(key: PrivacyKeyId) {
    return rules.value.find((rule) => rule.key === key);
  }

  async function persist(setting: PrivacySetting) {
    // Send plain values — a signal-held object cannot be structured-cloned to the worker.
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
    rules.value = rules.value.map((rule) => (rule.key === key ? {...rule, value} : rule));
    const updated = ruleOf(key);
    if(updated) persist(updated);
  }

  function pickException(peerId: number) {
    if(!picking.value) return;
    const {key, list} = picking.value;
    picking.value = null;

    rules.value = rules.value.map((rule) => {
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
    rules.value = rules.value.map((rule) =>
      rule.key === key ? {...rule, [list]: rule[list].filter((id) => id !== peerId)} : rule
    );
    const updated = ruleOf(key);
    if(updated) persist(updated);
  }

  async function toggleGlobal(flag: keyof GlobalPrivacy) {
    if(!global.value) return;
    const next: GlobalPrivacy = {...global.value, [flag]: !global.value[flag]};
    const previous = global.value;
    global.value = next;
    try {
      await saveGlobalPrivacy(next);
    } catch(err: any) {
      global.value = previous;
      fail(err, 'Failed to save');
    }
  }

  async function chooseAutoDelete(period: number) {
    const previous = autoDelete.value;
    autoDelete.value = period;
    try {
      await saveAutoDeletePeriod(period);
      flash('Auto-delete updated');
    } catch(err: any) {
      autoDelete.value = previous;
      fail(err, 'Failed to save auto-delete');
    }
  }

  /* -------------------------------------------------- blocked peers */

  async function loadBlockedPage(reset = false) {
    if(blockedLoading.value) return;
    blockedLoading.value = true;
    try {
      const offset = reset ? 0 : blocked.value.length;
      const page = await loadBlocked(offset, BLOCKED_PAGE);
      blockedCount.value = page.count;
      blocked.value = reset ? page.peers : [...blocked.value, ...page.peers];
    } catch(err: any) {
      fail(err, 'Failed to load blocked users');
    } finally {
      blockedLoading.value = false;
    }
  }

  async function unblock(peer: BlockedPeer) {
    try {
      await unblockPeer(peer.peerId);
      blocked.value = blocked.value.filter((p) => p.peerId !== peer.peerId);
      blockedCount.value = Math.max(0, blockedCount.value - 1);
    } catch(err: any) {
      fail(err, 'Failed to unblock');
    }
  }

  async function block(peerId: number) {
    blockPicking.value = false;
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
    error.value = '';
    if(pwNew.value !== pwRepeat.value) {
      error.value = 'Passwords do not match';
      return;
    }
    if(!pwNew.value) {
      error.value = 'Enter a new password';
      return;
    }

    busy.value = true;
    try {
      const length = await updateCloudPassword({
        currentPassword: password.value?.hasPassword ? pwCurrent.value : undefined,
        newPassword: pwNew.value,
        hint: pwHint.value,
        email: pwEmail.value.trim()
      });

      if(length) {
        pwCodeLength.value = length;
        pwForm.value = 'code';
        flash(`Confirmation code sent to ${pwEmail.value.trim()}`);
      } else {
        await refreshPassword('Password saved');
      }
    } catch(err: any) {
      fail(err, 'Failed to set password');
    } finally {
      busy.value = false;
    }
  }

  async function submitCode() {
    busy.value = true;
    try {
      await confirmPasswordEmail(pwCode.value.trim());
      await refreshPassword('Recovery email confirmed');
    } catch(err: any) {
      fail(err, 'Wrong code');
    } finally {
      busy.value = false;
    }
  }

  async function refreshPassword(message: string) {
    password.value = await loadPasswordState();
    pwCurrent.value = pwNew.value = pwRepeat.value = pwEmail.value = pwCode.value = '';
    pwHint.value = password.value.hint;
    pwCodeLength.value = 0;
    pwForm.value = 'idle';
    flash(message);
  }

  async function turnOffPassword() {
    if(!pwCurrent.value) {
      error.value = 'Enter your current password to turn it off';
      return;
    }
    if(!confirm('Turn off the cloud password?')) return;

    busy.value = true;
    try {
      await disableCloudPassword(pwCurrent.value);
      await refreshPassword('Cloud password turned off');
    } catch(err: any) {
      fail(err, 'Failed to turn off the password');
    } finally {
      busy.value = false;
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
      sessions.value = sessions.value.filter((s) => s.hash !== session.hash);
    } catch(err: any) {
      fail(err, 'Failed to terminate');
    }
  }

  async function killOthers() {
    if(!confirm('Terminate all other sessions?')) return;
    try {
      await terminateOtherSessions();
      sessions.value = sessions.value.filter((s) => s.current);
      flash('Other sessions terminated');
    } catch(err: any) {
      fail(err, 'Failed to terminate');
    }
  }

  async function toggleCalls(session: SessionDetail) {
    const accepted = session.callsDisabled;
    try {
      await setSessionCallsAccepted(session.hash, accepted);
      sessions.value = sessions.value.map((s) => (s.hash === session.hash ? {...s, callsDisabled: !accepted} : s));
    } catch(err: any) {
      fail(err, 'Failed to update session');
    }
  }

  async function revokeWeb(session: WebSession) {
    try {
      await revokeWebSession(session.hash);
      webSessions.value = webSessions.value.filter((s) => s.hash !== session.hash);
    } catch(err: any) {
      fail(err, 'Failed to revoke');
    }
  }

  async function revokeAllWeb() {
    if(!confirm('Disconnect all websites?')) return;
    try {
      await revokeAllWebSessions();
      webSessions.value = [];
      flash('All websites disconnected');
    } catch(err: any) {
      fail(err, 'Failed to revoke');
    }
  }

  return (
    <>
      {error.value && <p class="error">{error.value}</p>}
      {status.value && <p class="ok">{status.value}</p>}

      {view === 'privacy' ?
        !rules.value.length ?
          <p class="muted">Loading…</p> :
          <>
            <p class="label">Who can see / do what</p>
            {PRIVACY_KEYS.map((meta) => {
              // `{@const rule = ruleOf(meta.key)}` — the rule is looked up once
              // per key, and a key the server did not answer for renders nothing.
              const rule = ruleOf(meta.key);

              return rule ? (
                <div key={meta.key} class="rule">
                  <button
                    class="rule-head"
                    onClick={() => (expanded.value = expanded.value === meta.key ? null : meta.key)}
                  >
                    <span class="rule-title">{meta.title}</span>
                    <span class="rule-value">
                      {rule.value === 'everybody' ? 'Everybody' : rule.value === 'contacts' ? 'My Contacts' : 'Nobody'}
                    </span>
                  </button>

                  {expanded.value === meta.key && (
                    <>
                      <div class="chips">
                        {([['everybody', 'Everybody'], ['contacts', 'My Contacts'], ['nobody', 'Nobody']] as [string, string][]).map(([value, label], i) => (
                          <button
                            key={i}
                            class={rule.value === value ? 'on' : ''}
                            onClick={() => setValue(meta.key, value as PrivacyValue)}
                          >{label}</button>
                        ))}
                      </div>
                      <p class="muted small">{meta.hint}</p>
                      {meta.premiumOnly && (
                        <p class="muted small">Premium only — saving fails without a Premium subscription.</p>
                      )}

                      {([['allow', 'Always allow'], ['disallow', 'Never allow']] as [string, string][]).map(([list, listLabel], i) => (
                        <Fragment key={i}>
                          <p class="sub-label">{listLabel}</p>
                          <div class="exceptions">
                            {rule[list as 'allow' | 'disallow'].map((peerId) => (
                              <span key={peerId} class="exception">
                                {titleOf(peerId)}
                                <button
                                  class="x"
                                  aria-label="Remove"
                                  onClick={() => removeException(meta.key, list as 'allow' | 'disallow', peerId)}
                                >✕</button>
                              </span>
                            ))}
                            <button
                              class="add"
                              onClick={() => (picking.value = {key: meta.key, list: list as 'allow' | 'disallow'})}
                            >+ Add exception</button>
                          </div>
                        </Fragment>
                      ))}
                    </>
                  )}
                </div>
              ) : null;
            })}

            {global.value && (
              <>
                <p class="label">Messages</p>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={global.value.restrictNonContacts}
                    onChange={() => toggleGlobal('restrictNonContacts')}
                  />
                  <span>Only contacts and Premium users can message me</span>
                </label>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={global.value.archiveNonContacts}
                    onChange={() => toggleGlobal('archiveNonContacts')}
                  />
                  <span>Archive and mute new chats from non-contacts</span>
                </label>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={global.value.hideReadMarks}
                    onChange={() => toggleGlobal('hideReadMarks')}
                  />
                  <span>Hide read time (you will not see theirs either)</span>
                </label>
              </>
            )}

            <p class="label">Auto-delete messages</p>
            <div class="chips">
              {AUTO_DELETE_OPTIONS.map((option, i) => (
                <button key={i} class={autoDelete.value === option.value ? 'on' : ''} onClick={() => chooseAutoDelete(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <p class="muted small">
              Applies to new chats you start. Existing chats keep their own timer.
            </p>
          </> :

        <>
          <p class="label">Two-step verification</p>
          {!password.value ?
            <p class="muted">Loading…</p> :
            <>
              <p class="status-line">
                {password.value.hasPassword ? 'Cloud password is on' : 'Cloud password is off'}
                {password.value.hint && password.value.hasPassword && <span class="muted small"> · hint: {password.value.hint}</span>}
              </p>

              {password.value.unconfirmedEmailPattern && pwForm.value !== 'code' && (
                <>
                  <p class="muted small">
                    Recovery email {password.value.unconfirmedEmailPattern} is not confirmed yet.
                  </p>
                  <div class="row-buttons">
                    <button class="small-btn" onClick={resendEmail}>Resend code</button>
                    <button class="small-btn danger" onClick={abortEmail}>Cancel email</button>
                  </div>
                </>
              )}

              {pwForm.value === 'code' ?
                <>
                  <label class="field">
                    <span>Confirmation code{pwCodeLength.value ? ` (${pwCodeLength.value} digits)` : ''}</span>
                    <input
                      value={pwCode.value}
                      inputmode="numeric"
                      onInput={(e) => (pwCode.value = (e.target as HTMLInputElement).value)}
                    />
                  </label>
                  <button class="primary" onClick={submitCode} disabled={busy.value}>
                    {busy.value ? 'Checking…' : 'Confirm email'}
                  </button>
                  <button class="small-btn" onClick={resendEmail}>Resend code</button>
                </> :
                pwForm.value === 'set' ?
                  <>
                    {password.value.hasPassword && (
                      <label class="field"><span>Current password</span><input type="password" value={pwCurrent.value} onInput={(e) => (pwCurrent.value = (e.target as HTMLInputElement).value)} /></label>
                    )}
                    <label class="field"><span>New password</span><input type="password" value={pwNew.value} onInput={(e) => (pwNew.value = (e.target as HTMLInputElement).value)} /></label>
                    <label class="field"><span>Repeat password</span><input type="password" value={pwRepeat.value} onInput={(e) => (pwRepeat.value = (e.target as HTMLInputElement).value)} /></label>
                    <label class="field"><span>Hint (optional)</span><input value={pwHint.value} onInput={(e) => (pwHint.value = (e.target as HTMLInputElement).value)} /></label>
                    <label class="field"><span>Recovery email (optional)</span><input value={pwEmail.value} onInput={(e) => (pwEmail.value = (e.target as HTMLInputElement).value)} /></label>
                    <button class="primary" onClick={submitPassword} disabled={busy.value}>
                      {busy.value ? 'Saving…' : password.value.hasPassword ? 'Change password' : 'Set password'}
                    </button>
                    <button class="small-btn" onClick={() => (pwForm.value = 'idle')}>Cancel</button>
                  </> :
                  <>
                    <button class="primary" onClick={() => (pwForm.value = 'set')}>
                      {password.value.hasPassword ? 'Change password' : 'Set a password'}
                    </button>
                    {password.value.hasPassword && (
                      <>
                        <label class="field"><span>Current password</span><input type="password" value={pwCurrent.value} onInput={(e) => (pwCurrent.value = (e.target as HTMLInputElement).value)} /></label>
                        <button class="danger" onClick={turnOffPassword} disabled={busy.value}>Turn password off</button>
                      </>
                    )}
                  </>}
            </>}

          <p class="label">Blocked users {blockedCount.value ? `(${blockedCount.value})` : ''}</p>
          <button class="small-btn" onClick={() => (blockPicking.value = true)}>+ Block a user</button>
          {!blocked.value.length ?
            <p class="muted small">{blockedLoading.value ? 'Loading…' : 'Nobody is blocked.'}</p> :
            <>
              {blocked.value.map((peer) => (
                <div key={peer.peerId} class="blocked">
                  <Avatar peerId={peer.peerId} title={peer.title} size={32} />
                  <span class="blocked-name">
                    {peer.title}
                    {peer.username && <span class="muted small">@{peer.username}</span>}
                  </span>
                  <button class="small-btn" onClick={() => unblock(peer)}>Unblock</button>
                </div>
              ))}
              {blocked.value.length < blockedCount.value && (
                <button class="small-btn" onClick={() => loadBlockedPage()} disabled={blockedLoading.value}>
                  {blockedLoading.value ? 'Loading…' : 'Load more'}
                </button>
              )}
            </>}

          <p class="label">Active sessions</p>
          {!sessions.value.length ?
            <p class="muted small">Loading…</p> :
            <>
              {sessions.value.map((session) => (
                <div key={session.hash} class="session">
                  <span class="session-name">
                    {session.appName}{session.appVersion ? ` ${session.appVersion}` : ''}
                    {session.current && <span class="badge">this device</span>}
                    {session.unconfirmed && <span class="badge warn">unconfirmed</span>}
                    {session.official && <span class="badge">official</span>}
                  </span>
                  <span class="muted small">{session.deviceModel}</span>
                  <span class="muted small">
                    {[session.platform, session.systemVersion].filter(Boolean).join(' ')}
                  </span>
                  <span class="muted small">{[session.ip, session.location].filter(Boolean).join(' · ')}</span>
                  <span class="muted small">
                    Last active {dateOf(session.dateActive)}{session.dateCreated ? ` · created ${dateOf(session.dateCreated)}` : ''}
                  </span>
                  {!session.current && (
                    <>
                      <label class="toggle small">
                        <input type="checkbox" checked={!session.callsDisabled} onChange={() => toggleCalls(session)} />
                        <span>Accept calls</span>
                      </label>
                      <button class="danger small-btn" onClick={() => kill(session)}>Terminate</button>
                    </>
                  )}
                </div>
              ))}
              {sessions.value.length > 1 && (
                <button class="danger" onClick={killOthers}>Terminate all other sessions</button>
              )}
            </>}

          <p class="label">Connected websites</p>
          {!webSessions.value.length ?
            <p class="muted small">No websites are connected.</p> :
            <>
              {webSessions.value.map((session) => (
                <div key={session.hash} class="session">
                  <span class="session-name">{session.domain || session.botTitle || 'Website'}</span>
                  {session.botTitle && <span class="muted small">via {session.botTitle}</span>}
                  <span class="muted small">{[session.browser, session.platform].filter(Boolean).join(' · ')}</span>
                  <span class="muted small">{[session.ip, session.location].filter(Boolean).join(' · ')}</span>
                  <span class="muted small">Last active {dateOf(session.dateActive)}</span>
                  <button class="danger small-btn" onClick={() => revokeWeb(session)}>Disconnect</button>
                </div>
              ))}
              <button class="danger" onClick={revokeAllWeb}>Disconnect all websites</button>
            </>}
        </>}

      {picking.value && (
        <PeerPicker
          title={picking.value.list === 'allow' ? 'Always allow' : 'Never allow'}
          dialogs={dialogs.value}
          onpick={pickException}
          onclose={() => (picking.value = null)}
        />
      )}

      {blockPicking.value && (
        <PeerPicker
          title="Block a user"
          dialogs={dialogs.value.filter((d) => d.isUser && !d.isSelf)}
          onpick={block}
          onclose={() => (blockPicking.value = false)}
        />
      )}
    </>
  );
}
