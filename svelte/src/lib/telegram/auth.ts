import type {AuthSentCode, AuthAuthorization, AccountPassword} from '@layer';

import {bootTelegram} from './client';

export type SentCode = AuthSentCode.authSentCode & {phone_number: string};

export type SignInResult =
  | {type: 'signedIn'}
  | {type: 'passwordNeeded'}
  | {type: 'signUpRequired'};

/** Human-readable code length, when the server tells us one. */
export function codeLength(sentCode: SentCode): number {
  return (sentCode.type as any)?.length ?? 5;
}

/** How the code was delivered — drives the hint text on the code screen. */
export function codeDeliveryKey(sentCode: SentCode): string {
  return sentCode.type?._ ?? '';
}

export async function sendCode(phoneNumber: string): Promise<SentCode> {
  const {managers} = await bootTelegram();
  const {default: App} = await import('@config/app');

  const result = await managers.apiManager.invokeApi('auth.sendCode', {
    phone_number: phoneNumber,
    api_id: App.id,
    api_hash: App.hash,
    settings: {_: 'codeSettings', pFlags: {}}
  });

  // Rare path: the server can hand back an authorization straight away when the
  // number is already signed in on another device that approved the login.
  if(result._ === 'auth.sentCodeSuccess') {
    const {authorization} = result;
    if(authorization._ === 'auth.authorization') {
      await completeSignIn(authorization);
      throw new AlreadySignedIn();
    }
  }

  return Object.assign(result as AuthSentCode.authSentCode, {phone_number: phoneNumber});
}

export class AlreadySignedIn extends Error {
  constructor() {
    super('already signed in');
  }
}

export async function signIn(sentCode: SentCode, code: string): Promise<SignInResult> {
  const {managers} = await bootTelegram();

  // ignoreErrors: SESSION_PASSWORD_NEEDED is a normal branch, not a failure.
  let response: AuthAuthorization;
  try {
    response = await managers.apiManager.invokeApi('auth.signIn', {
      phone_number: sentCode.phone_number,
      phone_code_hash: sentCode.phone_code_hash,
      phone_code: code
    }, {ignoreErrors: true});
  } catch(err: any) {
    if(err?.type === 'SESSION_PASSWORD_NEEDED') {
      return {type: 'passwordNeeded'};
    }
    throw err;
  }

  if(response._ === 'auth.authorization') {
    await completeSignIn(response);
    return {type: 'signedIn'};
  }

  return {type: 'signUpRequired'};
}

export async function getPasswordState(): Promise<AccountPassword> {
  const {managers} = await bootTelegram();
  return managers.passwordManager.getState();
}

/**
 * Anything that crosses into the worker must be structured-cloneable — a Svelte
 * `$state` proxy is not, and postMessage then fails *silently* (the request is
 * dropped and its promise never settles). Guard the call so a hang surfaces.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms)
    )
  ]);
}

export async function checkPassword(password: string, state: AccountPassword): Promise<boolean> {
  const {managers} = await bootTelegram();
  const response = await withTimeout(
    managers.passwordManager.check(password, state),
    45_000,
    'Password check'
  );

  if(response._ === 'auth.authorization') {
    // passwordManager.check already stored the user on success.
    await markSignedIn();
    return true;
  }

  return false;
}

/** Persist the user and flip the stored auth state, like tweb's bootstrapIm. */
async function completeSignIn(authorization: AuthAuthorization.authAuthorization) {
  const {managers} = await bootTelegram();
  await managers.apiManager.setUser(authorization.user);
  await markSignedIn();
}

export async function markSignedIn() {
  const {managers} = await bootTelegram();
  await managers.appStateManager.pushToState('authState', {_: 'authStateSignedIn'});
}

export async function isSignedIn(): Promise<boolean> {
  const {authState} = await bootTelegram();
  return authState._ === 'authStateSignedIn';
}

export async function getSelf() {
  const {managers} = await bootTelegram();
  const userId = await managers.appUsersManager.getSelf();
  return userId;
}

/* ------------------------------------------------------------------ */
/* QR sign-in                                                          */
/* ------------------------------------------------------------------ */

export type QrLoginHandlers = {
  /** A fresh `tg://login?token=…` to paint. Fires again whenever it rotates. */
  onUrl: (url: string) => void;
  onSuccess: () => void;
  /** 2FA is on: the QR was accepted but the cloud password is still needed. */
  onPasswordNeeded: () => void;
  onError: (message: string) => void;
};

/** tweb polls no faster than this, even when the token lives longer. */
const QR_FETCH_INTERVAL = 3;

/**
 * Poll `auth.exportLoginToken` until the login is approved on another device.
 *
 * Transcribed from tweb's `SignQRCard`. Three things make this more than a
 * plain poll:
 *  - `auth.loginTokenMigrateTo` means the account lives on another DC; we have
 *    to re-point the base DC and re-import the token there before continuing.
 *  - the token expires, so the sleep is `expires - now - serverTimeOffset`
 *    (clamped) rather than a fixed delay — the server clock is authoritative.
 *  - `except_ids` excludes accounts already signed in, so scanning the QR from
 *    an account you already have does nothing instead of silently duplicating.
 *
 * Returns a stop function; call it when the QR panel goes away.
 */
export function startQrLogin(handlers: QrLoginHandlers): () => void {
  let stopped = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;

  const sleep = (ms: number) => new Promise<void>((resolve) => {
    sleepTimer = setTimeout(resolve, ms);
  });

  (async() => {
    const [{managers}, {default: App}, {default: AccountController}, {default: bytesToBase64}, {default: fixBase64String}] =
      await Promise.all([
        bootTelegram(),
        import('@config/app'),
        import('@lib/accounts/accountController'),
        import('@helpers/bytes/bytesToBase64'),
        import('@helpers/fixBase64String')
      ]);

    if(stopped) return;

    await managers.appStateManager.pushToState('authState', {_: 'authStateSignQr'});

    // Sticks once set: after a migrate we must keep talking to the new DC.
    const options: {dcId?: number, ignoreErrors: true} = {ignoreErrors: true};
    let prevToken = '';

    while(!stopped) {
      try {
        const userIds = await AccountController.getUserIds();

        let loginToken: any = await managers.apiManager.invokeApi('auth.exportLoginToken', {
          api_id: App.id,
          api_hash: App.hash,
          except_ids: userIds.map((userId: any) => Number(userId))
        }, {ignoreErrors: true});

        if(stopped) return;

        if(loginToken._ === 'auth.loginTokenMigrateTo') {
          if(!options.dcId) {
            options.dcId = loginToken.dc_id;
            await managers.apiManager.setBaseDcId(loginToken.dc_id);
          }

          loginToken = await managers.apiManager.invokeApi('auth.importLoginToken', {
            token: loginToken.token
          }, options as any);

          if(stopped) return;
        }

        if(loginToken._ === 'auth.loginTokenSuccess') {
          await completeSignIn(loginToken.authorization);
          if(!stopped) handlers.onSuccess();
          return;
        }

        const encoded = fixBase64String(bytesToBase64(loginToken.token), true);
        if(encoded !== prevToken) {
          prevToken = encoded;
          handlers.onUrl('tg://login?token=' + encoded);
        }

        // Refresh just before the server expires the token.
        const offset = await managers.timeManager.getServerTimeOffset();
        const diff = loginToken.expires - (Date.now() / 1000) - offset;
        await sleep(diff > QR_FETCH_INTERVAL ? QR_FETCH_INTERVAL * 1000 : Math.max(0, diff * 1000) | 0);
      } catch(err: any) {
        if(stopped) return;

        switch(err?.type) {
          case 'SESSION_PASSWORD_NEEDED':
            stopped = true;
            handlers.onPasswordNeeded();
            return;
          case 'AUTH_TOKEN_EXPIRED':
            // Normal: the token aged out between export and import. Loop again
            // for a fresh one rather than surfacing it as a failure.
            continue;
          default:
            stopped = true;
            handlers.onError(errorText(err));
            return;
        }
      }
    }
  })().catch((err) => {
    if(!stopped) handlers.onError(errorText(err));
  });

  return () => {
    stopped = true;
    if(sleepTimer) clearTimeout(sleepTimer);
  };
}

/** Maps an MTProto error to something showable. */
export function errorText(err: any): string {
  const type: string = err?.type || err?.message || 'UNKNOWN_ERROR';

  if(type.startsWith('FLOOD_WAIT')) {
    const seconds = +type.split('_').pop() || 0;
    return `Too many attempts — try again in ${Math.ceil(seconds / 60)} min`;
  }

  switch(type) {
    case 'PHONE_NUMBER_INVALID': return 'Invalid phone number';
    case 'PHONE_CODE_INVALID':
    case 'PHONE_CODE_EMPTY': return 'Invalid code';
    case 'PHONE_CODE_EXPIRED': return 'Code expired, start over';
    case 'PASSWORD_HASH_INVALID': return 'Incorrect password';
    case 'FLOOD_WAIT': return 'Too many attempts — wait a bit';
    default: return type;
  }
}
