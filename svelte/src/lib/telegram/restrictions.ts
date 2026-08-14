import {bootTelegram} from './client';

/**
 * Content restrictions (`restriction_reason`).
 *
 * Telegram marks some peers and messages as restricted per platform, and a
 * client is expected to honour that rather than render them anyway — see
 * https://core.telegram.org/api/terms. Two server-side settings soften it: the
 * app config's `ignore_restriction_reasons` lists reasons this platform may
 * ignore, and an account that has enabled sensitive content sees `sensitive`
 * material regardless.
 */

/** Platforms a web client must match, same set tweb uses. */
const PLATFORMS = new Set(['all', 'web', 'webk']);

type Settings = {ignore: Set<string>; sensitiveEnabled: boolean};

let settingsPromise: Promise<Settings> | null = null;

/**
 * Both values come from caches the app already warms at boot (app config,
 * account content settings), so this adds no round-trip to the chat-open path.
 * The promise is memoised: every message maps through it.
 */
function restrictionSettings(): Promise<Settings> {
  return settingsPromise ??= (async(): Promise<Settings> => {
    const {managers} = await bootTelegram();
    const {default: apiManagerProxy} = await import('@lib/apiManagerProxy');

    const [appConfig, contentSettings] = await Promise.all([
      Promise.resolve(apiManagerProxy.getAppConfig()).catch(() => null),
      Promise.resolve(managers.appPrivacyManager.getContentSettings()).catch(() => null)
    ]);

    return {
      ignore: new Set<string>((appConfig as any)?.ignore_restriction_reasons ?? []),
      sensitiveEnabled: !!(contentSettings as any)?.pFlags?.sensitive_enabled
    };
  })();
}

/** Kick the fetch off at boot so no later lookup waits on it. */
export function warmRestrictionSettings(): void {
  restrictionSettings().catch(() => {});
}

/** Drop the memoised settings so the next lookup refetches them. */
export function resetRestrictionSettings(): void {
  settingsPromise = null;
}

function pick(reasons: any[], settings: Settings): any {
  return reasons.find((reason) => {
    if(!PLATFORMS.has(reason.platform)) return false;
    if(settings.ignore.has(reason.reason)) return false;
    if(reason.reason === 'sensitive' && settings.sensitiveEnabled) return false;
    return true;
  });
}

/**
 * The reason text to show in place of restricted content, or '' when nothing
 * applies. The text is the server's own wording — clients do not invent it.
 */
export async function restrictionTextOf(reasons: any[] | undefined): Promise<string> {
  if(!reasons?.length) return '';
  const reason = pick(reasons, await restrictionSettings());
  return reason ? (reason.text || 'This content is not available') : '';
}

/**
 * Same for a whole peer. A peer only counts as restricted when the server also
 * set `pFlags.restricted` — the reasons alone can linger on an unrestricted
 * peer.
 */
export async function peerRestrictionText(peer: any): Promise<string> {
  if(!peer?.pFlags?.restricted) return '';
  return restrictionTextOf(peer.restriction_reason);
}
