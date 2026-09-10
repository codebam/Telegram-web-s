/*
 * Sign-in flow and app entry.
 *
 * Ported from the SvelteKit client's src/routes/+page.svelte. State that drives
 * the UI is a signal (Svelte's `$state` was a signal too — same fine-grained
 * updates, same "read it in the markup and you are subscribed" model); anything
 * handed back to the MTProto worker stays a plain value, because a signal's
 * `.value` is read at the call site and nothing proxy-shaped ever crosses the
 * worker boundary.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Chat} from './Chat';
import {Logo} from './Logo';
import {QrLogin} from './QrLogin';
import {bootTelegram} from '$lib/telegram/client';
import {GIT_COMMIT, GIT_COMMIT_SHORT, GIT_COMMIT_URL} from '$lib/buildInfo';
import {isAddingAccount, switchAccount} from '$lib/telegram/accounts';
import {installStaleRecovery, purgeStaleAssets} from '$lib/telegram/staleGuard';
import {
  AlreadySignedIn,
  checkPassword,
  codeLength,
  errorText,
  getPasswordState,
  getSelf,
  sendCode,
  signIn,
  type SentCode
} from '$lib/telegram/auth';

import './App.css';

type Step = 'boot' | 'phone' | 'qr' | 'code' | 'password' | 'signedIn';

export function App() {
  const step = useSignal<Step>('boot');
  const busy = useSignal(false);
  const error = useSignal('');

  const phone = useSignal('+');
  const code = useSignal('');
  const password = useSignal('');

  const sentCode = useSignal<SentCode | null>(null);
  // NOT a signal: this object is sent back to the MTProto worker, and a ref is
  // what keeps it a plain value. Only its hint is reactive.
  const passwordState = useRef<any>(null);
  const passwordHint = useSignal('');
  const self = useSignal<any>(null);

  // True when this tab is signing in to an extra account slot rather than the
  // first one — the sign-in card then offers a way back to the live account.
  const addingAccount = useSignal(false);

  useEffect(() => {
    // Runs before anything touches MTProto: a browser pinned to a previous
    // build has to be freed first, or every later step fails in confusing ways.
    installStaleRecovery();
    void purgeStaleAssets();

    // The prerendered splash has done its job the moment this island renders.
    document.getElementById('splash')?.remove();

    void (async() => {
      try {
        const {authState} = await bootTelegram();
        if (authState._ === 'authStateSignedIn') {
          await showSelf();
        } else {
          step.value = 'phone';
          addingAccount.value = await isAddingAccount();
        }
      } catch (err) {
        error.value = errorText(err);
        step.value = 'phone';
      }
    })();
  }, []);

  /** Abandon an in-progress "add account" and go back to the first account. */
  function cancelAddAccount() {
    switchAccount(1);
  }

  async function qrPasswordNeeded() {
    error.value = '';
    step.value = 'password';
    try {
      passwordState.current = await getPasswordState();
      passwordHint.value = passwordState.current?.hint || '';
    } catch (err) {
      error.value = errorText(err);
    }
  }

  async function showSelf() {
    step.value = 'signedIn';
    try {
      self.value = await getSelf();
    } catch (err) {
      // Signed in but the worker has not fetched the profile yet — not fatal.
      console.warn('getSelf failed', err);
    }
  }

  async function submitPhone(e: Event) {
    e.preventDefault();
    if (busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      sentCode.value = await sendCode(phone.value.trim());
      code.value = '';
      step.value = 'code';
    } catch (err) {
      if (err instanceof AlreadySignedIn) {
        await showSelf();
      } else {
        error.value = errorText(err);
      }
    } finally {
      busy.value = false;
    }
  }

  async function submitCode(e: Event) {
    e.preventDefault();
    if (busy.value || !sentCode.value) return;
    busy.value = true;
    error.value = '';

    try {
      const result = await signIn(sentCode.value, code.value.trim());
      if (result.type === 'signedIn') {
        await showSelf();
      } else if (result.type === 'passwordNeeded') {
        step.value = 'password';
        passwordState.current = await getPasswordState();
        passwordHint.value = passwordState.current?.hint || '';
      } else {
        error.value = 'This number is not registered yet — sign-up is not implemented here.';
      }
    } catch (err) {
      error.value = errorText(err);
    } finally {
      busy.value = false;
    }
  }

  async function submitPassword(e: Event) {
    e.preventDefault();
    if (busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      // The 2FA state expires; refresh it right before checking.
      passwordState.current = await getPasswordState();
      const ok = await checkPassword(password.value, passwordState.current);
      if (ok) await showSelf();
      else error.value = 'Incorrect password';
    } catch (err) {
      error.value = errorText(err);
      password.value = '';
    } finally {
      busy.value = false;
    }
  }

  function restart() {
    step.value = 'phone';
    sentCode.value = null;
    code.value = '';
    password.value = '';
    error.value = '';
  }

  if (step.value === 'signedIn') {
    return <Chat />;
  }

  return (
    <main>
      <div class="card">
        {step.value === 'boot' && (
          <>
            <div class="logo"><Logo size={48} /></div>
            <h1>Connecting…</h1>
            <p class="sub">Starting the MTProto worker.</p>
          </>
        )}

        {step.value === 'phone' && (
          <>
            <div class="logo"><Logo size={48} /></div>
            <h1>Sign in to Web S</h1>
            <p class="sub">Enter your phone number in international format.</p>
            <form onSubmit={submitPhone}>
              <input
                autofocus
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="+1 555 000 0000"
                value={phone.value}
                onInput={(e) => (phone.value = (e.target as HTMLInputElement).value)}
                disabled={busy.value}
              />
              <button type="submit" disabled={busy.value || phone.value.trim().length < 5}>
                {busy.value ? 'Sending…' : 'Next'}
              </button>
            </form>
            <button class="link" onClick={() => { error.value = ''; step.value = 'qr'; }}>Log in by QR code</button>
          </>
        )}

        {step.value === 'qr' && (
          <>
            <h1>Log in by QR code</h1>
            <QrLogin
              onsuccess={showSelf}
              onpasswordneeded={qrPasswordNeeded}
              onerror={(message) => (error.value = message)}
            />
            <button class="link" onClick={() => { error.value = ''; step.value = 'phone'; }}>Log in by phone number</button>
          </>
        )}

        {step.value === 'code' && (
          <>
            <div class="logo"><Logo size={48} /></div>
            <h1>{sentCode.value?.phone_number}</h1>
            <p class="sub">
              We sent a {sentCode.value ? codeLength(sentCode.value) : 5}-digit code to your other devices.
            </p>
            <form onSubmit={submitCode}>
              <input
                autofocus
                class="code"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                placeholder="- - - - -"
                value={code.value}
                onInput={(e) => (code.value = (e.target as HTMLInputElement).value)}
                disabled={busy.value}
              />
              <button type="submit" disabled={busy.value || code.value.trim().length < 4}>
                {busy.value ? 'Checking…' : 'Sign in'}
              </button>
            </form>
            <button class="link" onClick={restart}>Change number</button>
          </>
        )}

        {step.value === 'password' && (
          <>
            <div class="logo"><Logo size={48} /></div>
            <h1>Two-step verification</h1>
            <p class="sub">{passwordHint.value ? `Hint: ${passwordHint.value}` : 'Enter your cloud password.'}</p>
            <form onSubmit={submitPassword}>
              <input
                autofocus
                type="password"
                autocomplete="current-password"
                placeholder="Password"
                value={password.value}
                onInput={(e) => (password.value = (e.target as HTMLInputElement).value)}
                disabled={busy.value}
              />
              <button type="submit" disabled={busy.value || !password.value.length}>
                {busy.value ? 'Checking…' : 'Sign in'}
              </button>
            </form>
            <button class="link" onClick={restart}>Start over</button>
          </>
        )}

        {error.value && <p class="error">{error.value}</p>}

        {addingAccount.value && step.value !== 'boot' && (
          <p class="adding">
            Adding another account — your other accounts stay signed in.
            <button class="link inline" onClick={cancelAddAccount}>Cancel</button>
          </p>
        )}

        {/* Required by https://core.telegram.org/api/terms: a third-party client
            must state in-app that it is unofficial and uses the Telegram API. */}
        <p class="disclosure">
          Web S is an unofficial client built on the{' '}
          <a href="https://core.telegram.org/api" target="_blank" rel="noopener noreferrer">Telegram API</a>.
          It is not affiliated with, endorsed by, or operated by Telegram.
        </p>
      </div>

      {GIT_COMMIT_URL && (
        <a
          class="build-commit"
          href={GIT_COMMIT_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={`Built from ${GIT_COMMIT}`}
        >
          {GIT_COMMIT_SHORT}
        </a>
      )}
    </main>
  );
}
