<script lang="ts">
  import {startQrLogin} from '$lib/telegram/auth';

  let {
    onsuccess,
    onpasswordneeded,
    onerror
  }: {
    onsuccess: () => void;
    onpasswordneeded: () => void;
    onerror: (message: string) => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let url = $state('');
  let painting = $state(true);

  /* The poll owns the token; the paint below reacts to whatever it hands over.
     Splitting them means a token rotation never restarts the poll, and a theme
     change never re-requests a token. */
  $effect(() => {
    const stop = startQrLogin({
      onUrl: (next) => (url = next),
      onSuccess: onsuccess,
      onPasswordNeeded: onpasswordneeded,
      onError: onerror
    });

    return stop;
  });

  $effect(() => {
    const element = host;
    const data = url;
    if (!element || !data) return;

    let cancelled = false;

    (async () => {
      const [{paintQrCode}, {default: QRCodeStyling}] = await Promise.all([
        import('@helpers/qrCode/paintQrCode'),
        import('qr-code-styling')
      ]);

      if (cancelled) return;

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
      } catch (err) {
        // A failed paint is not a failed login — the poll keeps running, and a
        // later token will try again.
        console.warn('QR paint failed', err);
        return;
      }

      if (cancelled) return;

      // paintQrCode appends; drop every canvas but the newest so a rotated
      // token replaces the old code instead of stacking under it.
      const canvases = element.querySelectorAll('canvas');
      for (let i = 0; i < canvases.length - 1; i++) canvases[i].remove();
      painting = false;
    })();

    return () => {
      cancelled = true;
    };
  });
</script>

<div class="qr">
  <div class="qr-host" bind:this={host}></div>
  {#if painting}
    <div class="qr-placeholder">Generating code…</div>
  {/if}
</div>

<ol class="steps">
  <li>Open Telegram on your phone</li>
  <li>Go to <b>Settings → Devices → Link Desktop Device</b></li>
  <li>Point your phone at this screen to confirm login</li>
</ol>

<style>
  .qr {
    position: relative;
    width: 240px;
    height: 240px;
    margin: 0 auto 20px;
    display: grid;
    place-items: center;
  }

  .qr-host {
    width: 240px;
    height: 240px;
    display: grid;
    place-items: center;
  }

  /* paintQrCode sizes the canvas by device pixel ratio; keep it in the box. */
  .qr-host :global(canvas) {
    width: 100% !important;
    height: 100% !important;
    border-radius: 12px;
  }

  .qr-placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 13px;
  }

  .steps {
    margin: 0 0 4px;
    padding: 0;
    list-style: none;
    counter-reset: step;
    text-align: left;
    display: grid;
    gap: 10px;
  }

  .steps li {
    position: relative;
    padding-left: 32px;
    font-size: 14px;
    line-height: 1.4;
    color: var(--text-dim);
  }

  .steps li::before {
    counter-increment: step;
    content: counter(step);
    position: absolute;
    left: 0;
    top: -1px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    display: grid;
    place-items: center;
  }
</style>
