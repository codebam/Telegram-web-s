<script lang="ts">
  import {onMount} from 'svelte';

  import Chat from '$lib/components/Chat.svelte';
  import {bootTelegram} from '$lib/telegram/client';
  import {GIT_COMMIT, GIT_COMMIT_SHORT, GIT_COMMIT_URL} from '$lib/buildInfo';
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

  type Step = 'boot' | 'phone' | 'code' | 'password' | 'signedIn';

  let step = $state<Step>('boot');
  let busy = $state(false);
  let error = $state('');

  let phone = $state('+');
  let code = $state('');
  let password = $state('');

  let sentCode = $state<SentCode | null>(null);
  // NOT a rune: this object is sent back to the MTProto worker, and a $state
  // proxy is not structured-cloneable (DataCloneError → the request never
  // leaves the tab and hangs). Only its hint is reactive.
  let passwordState: any = null;
  let passwordHint = $state('');
  let self = $state<any>(null);

  onMount(async () => {
    try {
      const {authState} = await bootTelegram();
      if (authState._ === 'authStateSignedIn') {
        await showSelf();
      } else {
        step = 'phone';
      }
    } catch (err) {
      error = errorText(err);
      step = 'phone';
    }
  });

  async function showSelf() {
    step = 'signedIn';
    try {
      self = await getSelf();
    } catch (err) {
      // Signed in but the worker has not fetched the profile yet — not fatal.
      console.warn('getSelf failed', err);
    }
  }

  async function submitPhone(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';

    try {
      sentCode = await sendCode(phone.trim());
      code = '';
      step = 'code';
    } catch (err) {
      if (err instanceof AlreadySignedIn) {
        await showSelf();
      } else {
        error = errorText(err);
      }
    } finally {
      busy = false;
    }
  }

  async function submitCode(e: Event) {
    e.preventDefault();
    if (busy || !sentCode) return;
    busy = true;
    error = '';

    try {
      const result = await signIn(sentCode, code.trim());
      if (result.type === 'signedIn') {
        await showSelf();
      } else if (result.type === 'passwordNeeded') {
        step = 'password';
        passwordState = await getPasswordState();
        passwordHint = passwordState?.hint || '';
      } else {
        error = 'This number is not registered yet — sign-up is not implemented here.';
      }
    } catch (err) {
      error = errorText(err);
    } finally {
      busy = false;
    }
  }

  async function submitPassword(e: Event) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = '';

    try {
      // The 2FA state expires; refresh it right before checking.
      passwordState = await getPasswordState();
      const ok = await checkPassword(password, passwordState);
      if (ok) await showSelf();
      else error = 'Incorrect password';
    } catch (err) {
      error = errorText(err);
      password = '';
    } finally {
      busy = false;
    }
  }

  function restart() {
    step = 'phone';
    sentCode = null;
    code = '';
    password = '';
    error = '';
  }
</script>

<svelte:head><title>Web S</title></svelte:head>

{#if step === 'signedIn'}
  <Chat />
{:else}
<main>
  <div class="card">
    {#if step === 'boot'}
      <div class="logo"></div>
      <h1>Connecting…</h1>
      <p class="sub">Starting the MTProto worker.</p>
    {:else if step === 'phone'}
      <div class="logo"></div>
      <h1>Sign in to Web S</h1>
      <p class="sub">Enter your phone number in international format.</p>
      <form onsubmit={submitPhone}>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          placeholder="+1 555 000 0000"
          bind:value={phone}
          disabled={busy}
        />
        <button type="submit" disabled={busy || phone.trim().length < 5}>
          {busy ? 'Sending…' : 'Next'}
        </button>
      </form>
    {:else if step === 'code'}
      <div class="logo"></div>
      <h1>{sentCode?.phone_number}</h1>
      <p class="sub">
        We sent a {sentCode ? codeLength(sentCode) : 5}-digit code to your other devices.
      </p>
      <form onsubmit={submitCode}>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          class="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          placeholder="- - - - -"
          bind:value={code}
          disabled={busy}
        />
        <button type="submit" disabled={busy || code.trim().length < 4}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
      <button class="link" onclick={restart}>Change number</button>
    {:else if step === 'password'}
      <div class="logo"></div>
      <h1>Two-step verification</h1>
      <p class="sub">{passwordHint ? `Hint: ${passwordHint}` : 'Enter your cloud password.'}</p>
      <form onsubmit={submitPassword}>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          autofocus
          type="password"
          autocomplete="current-password"
          placeholder="Password"
          bind:value={password}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !password.length}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
      <button class="link" onclick={restart}>Start over</button>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>

  {#if GIT_COMMIT_URL}
    <a
      class="build-commit"
      href={GIT_COMMIT_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Built from {GIT_COMMIT}"
    >
      {GIT_COMMIT_SHORT}
    </a>
  {/if}
</main>
{/if}

<style>
  main {
    position: relative;
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  /* The commit this build came from — same marker the empty chat pane shows
     once you're signed in, so a stale bundle is visible before logging in. */
  .build-commit {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    padding: 2px 6px;
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    text-decoration: none;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .build-commit:hover {
    opacity: 1;
  }

  .card {
    width: 100%;
    max-width: 380px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 32px 28px;
    text-align: center;
  }

  .logo {
    width: 84px;
    height: 84px;
    margin: 0 auto 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 25%, var(--accent-hover), var(--accent));
  }

  h1 {
    margin: 0 0 8px;
    font-size: 21px;
    font-weight: 600;
  }

  .sub {
    margin: 0 0 20px;
    color: var(--text-dim);
    font-size: 14px;
    line-height: 1.45;
  }

  form {
    display: grid;
    gap: 12px;
  }

  input {
    width: 100%;
    padding: 13px 14px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 10px;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: var(--accent);
  }

  input.code {
    text-align: center;
    letter-spacing: 6px;
    font-size: 20px;
  }

  button[type='submit'] {
    padding: 13px 14px;
    background: var(--accent);
    border: none;
    border-radius: 10px;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
  }

  button[type='submit']:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .link {
    margin-top: 14px;
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 14px;
  }

  .error {
    margin: 16px 0 0;
    color: var(--danger);
    font-size: 14px;
  }
</style>
