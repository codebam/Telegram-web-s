/*
 * Ported from svelte/src/lib/components/QrLogin.svelte.
 *
 * The two effects stayed two: the poll depends only on the handlers, so it is a
 * `useEffect` over those props, while the paint depends on the `url` signal and
 * re-runs on every token rotation without touching the poll.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {startQrLogin} from '$lib/telegram/auth';

import './QrLogin.css';

interface Props {
  onsuccess: () => void;
  onpasswordneeded: () => void;
  onerror: (message: string) => void;
}

export function QrLogin({onsuccess, onpasswordneeded, onerror}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const url = useSignal('');
  const painting = useSignal(true);

  /* The poll owns the token; the paint below reacts to whatever it hands over.
     Splitting them means a token rotation never restarts the poll, and a theme
     change never re-requests a token. */
  useEffect(() => {
    const stop = startQrLogin({
      onUrl: (next) => (url.value = next),
      onSuccess: onsuccess,
      onPasswordNeeded: onpasswordneeded,
      onError: onerror
    });

    return stop;
  }, [onsuccess, onpasswordneeded, onerror]);

  useEffect(() => {
    const element = host.current;
    const data = url.value;
    if(!element || !data) return;

    let cancelled = false;

    (async() => {
      const [{paintQrCode}, {default: QRCodeStyling}] = await Promise.all([
        import('@helpers/qrCode/paintQrCode'),
        import('qr-code-styling')
      ]);

      if(cancelled) return;

      // Read the live theme rather than hard-coding: the auth card is themed and
      // a light-on-light QR would not scan.
      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

      try {
        await paintQrCode({
          data,
          size: 240,
          host: element,
          background: read('--bg-elevated', '#ffffff'),
          foreground: read('--text', '#000000'),
          logoColor: read('--accent', '#3390ec'),
          canvasClass: 'qr-canvas',
          QRCodeStylingCtor: QRCodeStyling
        });
      } catch(err) {
        // A failed paint is not a failed login — the poll keeps running, and a
        // later token will try again.
        console.warn('QR paint failed', err);
        return;
      }

      if(cancelled) return;

      // paintQrCode appends; drop every canvas but the newest so a rotated
      // token replaces the old code instead of stacking under it.
      const canvases = element.querySelectorAll('canvas');
      for(let i = 0; i < canvases.length - 1; i++) canvases[i].remove();
      painting.value = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [url.value]);

  return (
    <>
      <div class="qr">
        <div class="qr-host" ref={host}></div>
        {painting.value && <div class="qr-placeholder">Generating code…</div>}
      </div>

      <ol class="steps">
        <li>Open Telegram on your phone</li>
        <li>Go to <b>Settings → Devices → Link Desktop Device</b></li>
        <li>Point your phone at this screen to confirm login</li>
      </ol>
    </>
  );
}
