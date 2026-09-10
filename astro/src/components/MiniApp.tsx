/*
 * Bot mini apps (Telegram Web Apps) in a floating window.
 *
 * Ported from svelte/src/lib/components/MiniApp.svelte. Three details the port
 * had to make explicit:
 *  - `bind:this={iframe}` is a ref here; the bridge reads `iframe.current`
 *    wherever the Svelte version read the element.
 *  - `needConfirmation` and `popupAnswered` were plain `let`s rather than
 *    `$state`, so they become refs: a Preact body runs on every render and a
 *    plain local would be reset each time, while neither drives markup.
 *  - the effects are split by what they read — the signal-driven ones are
 *    `useSignalEffect`, the ones reading the `request` prop are `useEffect`
 *    with that prop in the dependency list.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {
  requestWebView,
  prolongWebView,
  sendWebViewData,
  allowBotSendMessage,
  invokeWebViewCustomMethod,
  readDeviceStorage,
  writeDeviceStorage,
  clearDeviceStorage,
  readMiniAppPermission,
  writeMiniAppPermission,
  botCanManageEmojiStatus,
  allowBotEmojiStatus,
  getPreparedMessage,
  sendPreparedMessage,
  themeParams,
  type MiniAppRequest,
  type PreparedMessage
} from '$lib/telegram/miniApps';
import {loadCustomEmoji, setEmojiStatus} from '$lib/telegram/emoji';

import './MiniApp.css';

interface Props {
  request: MiniAppRequest;
  onclose: () => void;
  onswitchinline?: (query: string) => void;
  /** Returns true when the host opened the link itself (another mini app). */
  onlink?: (url: string) => boolean;
}

type PopupButton = {type: string; text: string; id: string};
type ButtonState = {
  is_visible: boolean;
  is_active: boolean;
  text: string;
  color: string;
  text_color: string;
  is_progress_visible: boolean;
};

export function MiniApp({request, onclose, onswitchinline, onlink}: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const url = useSignal('');
  const queryId = useSignal('');
  const error = useSignal('');
  const ready = useSignal(false);
  const title = useSignal(request.title || request.buttonText || 'Mini app');

  const mainButton = useSignal<ButtonState | null>(null);
  const secondaryButton = useSignal<ButtonState | null>(null);
  const backVisible = useSignal(false);
  const settingsVisible = useSignal(false);
  // Not signals, exactly as in the original: refs keep them per-instance without
  // making them reactive.
  const needConfirmation = useRef(false);
  const popup = useSignal<{title: string; message: string; buttons: PopupButton[]} | null>(null);
  const popupAnswered = useRef(false);
  /** A message the bot prepared for us to post into the chat, awaiting confirmation. */
  const prepared = useSignal<PreparedMessage | null>(null);
  /** True once the page has said anything at all over the bridge. */
  const sawEvent = useSignal(false);
  /** The page loaded nothing and never spoke — most often a frame-ancestors CSP. */
  const stalled = useSignal(false);

  /** The bot page talks to us with `postMessage(JSON.stringify({eventType, eventData}))`. */
  function send(eventType: string, eventData?: any) {
    iframe.current?.contentWindow?.postMessage(JSON.stringify({eventType, eventData}), '*');
  }

  function viewport() {
    const height = iframe.current?.clientHeight || window.innerHeight;
    return {height, is_state_stable: true, is_expanded: true};
  }

  function close() {
    if(needConfirmation.current && !confirm('Close this mini app?')) return;
    onclose();
  }

  function answerPopup(id: string) {
    popup.value = null;
    if(popupAnswered.current) return;
    popupAnswered.current = true;
    send('popup_closed', id ? {button_id: id} : {});
  }

  function haptic(data: any) {
    if(!navigator.vibrate) return;
    if(data?.type === 'notification') navigator.vibrate([12, 40, 12]);
    else if(data?.type === 'selection_change') navigator.vibrate(4);
    else navigator.vibrate(data?.impact_style === 'heavy' ? 20 : 10);
  }

  function openExternal(target: string) {
    // A t.me link may itself point at a mini app; let the host take it first.
    if(onlink?.(target)) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  async function confirmPrepared() {
    const message = prepared.value;
    if(!message) return;
    prepared.value = null;

    try {
      await sendPreparedMessage(request.peerId, request.botId, message.queryAndResultId);
      send('prepared_message_sent', undefined);
      onclose();
    } catch(err: any) {
      send('prepared_message_failed', {error: err?.type || err?.message || 'UNKNOWN_ERROR'});
    }
  }

  function declinePrepared() {
    prepared.value = null;
    send('prepared_message_failed', {error: 'USER_DECLINED'});
  }

  /** Whether the browser will even consider a location request. */
  async function locationAvailable(): Promise<boolean> {
    if(!navigator.geolocation) return false;
    try {
      const permission = await navigator.permissions?.query({name: 'geolocation' as PermissionName});
      return permission?.state !== 'denied';
    } catch(err) {
      // `permissions.query` is unavailable in some browsers; fall back to
      // whether the API exists at all.
      return true;
    }
  }

  async function handleCheckLocation() {
    if(!(await locationAvailable())) {
      send('location_checked', {available: false});
      return;
    }

    const stored = await readMiniAppPermission(request.botId, 'locationPermission');
    send('location_checked', {
      available: true,
      access_requested: stored != null,
      access_granted: stored === 'true'
    });
  }

  /**
   * The bot wants our coordinates. The decision is ours, asked once per bot and
   * kept in the bot's internal storage; only then is the browser asked for a
   * position, and its own refusal is reported as unavailable too.
   */
  async function handleRequestLocation() {
    const stored = await readMiniAppPermission(request.botId, 'locationPermission');

    if(stored == null) {
      const granted = confirm(`Share your location with ${title.value}?`);
      await writeMiniAppPermission(request.botId, 'locationPermission', String(granted));
      if(!granted) {
        send('location_requested', {available: false});
        return;
      }
    } else if(stored !== 'true') {
      send('location_requested', {available: false});
      return;
    }

    if(!navigator.geolocation) {
      send('location_requested', {available: false});
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => send('location_requested', {
        available: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
        course: position.coords.heading,
        speed: position.coords.speed,
        horizontal_accuracy: position.coords.accuracy,
        vertical_accuracy: position.coords.altitudeAccuracy,
        course_accuracy: null,
        speed_accuracy: null
      }),
      () => send('location_requested', {available: false})
    );
  }

  /** The bot wants to change our emoji status; ask once, then remember it. */
  async function handleEmojiStatusAccess() {
    try {
      if(await botCanManageEmojiStatus(request.botId)) {
        send('emoji_status_access_requested', {status: 'allowed'});
        return;
      }

      if(!confirm(`Allow ${title.value} to change your emoji status?`)) {
        send('emoji_status_access_requested', {status: 'cancelled'});
        return;
      }

      await allowBotEmojiStatus(request.botId);
      send('emoji_status_access_requested', {status: 'allowed'});
    } catch(err) {
      send('emoji_status_access_requested', {status: 'cancelled'});
    }
  }

  async function handleSetEmojiStatus(data: any) {
    try {
      const docId = '' + (data?.custom_emoji_id ?? '');
      // The id has to resolve to a real custom emoji before we offer it.
      if(!docId || !(await loadCustomEmoji(docId))) {
        send('emoji_status_failed', {error: 'SUGGESTED_EMOJI_INVALID'});
        return;
      }

      if(!confirm('Set this emoji as your status?')) {
        send('emoji_status_failed', {error: 'USER_DECLINED'});
        return;
      }

      await setEmojiStatus(docId, Number(data?.duration ?? 0) || 0);
      send('emoji_status_set', undefined);
    } catch(err) {
      send('emoji_status_failed', {error: 'SERVER_ERROR'});
    }
  }

  async function handle(eventType: string, data: any) {
    switch(eventType) {
      case 'iframe_ready':
      case 'web_app_ready':
        ready.value = true;
        send('theme_changed', {theme_params: themeParams()});
        send('viewport_changed', viewport());
        break;

      case 'web_app_request_theme':
        send('theme_changed', {theme_params: themeParams()});
        break;

      case 'web_app_request_viewport':
      case 'web_app_expand':
        send('viewport_changed', viewport());
        break;

      case 'web_app_request_safe_area':
        send('safe_area_changed', {top: 0, bottom: 0, left: 0, right: 0});
        break;

      case 'web_app_request_content_safe_area':
        send('content_safe_area_changed', {top: 0, bottom: 0, left: 0, right: 0});
        break;

      case 'web_app_close':
        onclose();
        break;

      case 'web_app_setup_closing_behavior':
        needConfirmation.current = !!data?.need_confirmation;
        break;

      case 'web_app_setup_main_button':
        mainButton.value = data?.is_visible ? (data as ButtonState) : null;
        break;

      case 'web_app_setup_secondary_button':
        secondaryButton.value = data?.is_visible ? (data as ButtonState) : null;
        break;

      case 'web_app_setup_back_button':
        backVisible.value = !!data?.is_visible;
        break;

      case 'web_app_setup_settings_button':
        settingsVisible.value = !!data?.is_visible;
        break;

      case 'web_app_open_popup':
        popupAnswered.current = false;
        popup.value = {
          title: data?.title ?? '',
          message: data?.message ?? '',
          buttons: data?.buttons?.length ? data.buttons : [{type: 'ok', text: 'OK', id: ''}]
        };
        break;

      case 'web_app_open_link':
        if(data?.url) openExternal(data.url);
        break;

      case 'web_app_open_tg_link':
        if(data?.path_full) openExternal('https://t.me' + data.path_full);
        break;

      case 'web_app_open_invoice':
        // Payments are not implemented in this client yet.
        send('invoice_closed', {slug: data?.slug ?? '', status: 'failed'});
        break;

      case 'web_app_open_scan_qr_popup':
        send('scan_qr_popup_closed', {});
        break;

      case 'web_app_read_text_from_clipboard':
        try {
          const text = await navigator.clipboard.readText();
          send('clipboard_text_received', {req_id: data?.req_id, data: text});
        } catch(err) {
          send('clipboard_text_received', {req_id: data?.req_id});
        }
        break;

      case 'web_app_trigger_haptic_feedback':
        haptic(data);
        break;

      case 'web_app_data_send':
        // Only a keyboard-button web view may answer the bot this way.
        try {
          await sendWebViewData(request.botId, request.buttonText || '', data?.data ?? '');
        } catch(err) {
          // The bot simply gets nothing; closing is still the right move.
        }
        onclose();
        break;

      case 'web_app_switch_inline_query':
        onswitchinline?.(data?.query ?? '');
        onclose();
        break;

      case 'web_app_request_write_access':
        try {
          await allowBotSendMessage(request.botId);
          send('write_access_requested', {status: 'allowed'});
        } catch(err) {
          send('write_access_requested', {status: 'cancelled'});
        }
        break;

      case 'web_app_request_phone':
        send('phone_requested', {status: 'cancelled'});
        break;

      case 'web_app_request_emoji_status_access':
        handleEmojiStatusAccess();
        break;

      case 'web_app_set_emoji_status':
        handleSetEmojiStatus(data);
        break;

      case 'web_app_invoke_custom_method': {
        const answer = await invokeWebViewCustomMethod(request.botId, data?.method, data?.params);
        send('custom_method_invoked', {req_id: data?.req_id, result: answer.result, error: answer.error});
        break;
      }

      case 'web_app_device_storage_save_key':
        try {
          const failure = await writeDeviceStorage(request.botId, data?.key, data?.value ?? null);
          if(failure) send('device_storage_failed', {req_id: data?.req_id, error: failure});
          else send('device_storage_key_saved', {req_id: data?.req_id});
        } catch(err) {
          send('device_storage_failed', {req_id: data?.req_id, error: 'UNKNOWN_ERROR'});
        }
        break;

      case 'web_app_device_storage_get_key':
        try {
          const value = await readDeviceStorage(request.botId, data?.key);
          send('device_storage_key_received', {req_id: data?.req_id, value: value ?? null});
        } catch(err) {
          send('device_storage_failed', {req_id: data?.req_id, error: 'UNKNOWN_ERROR'});
        }
        break;

      case 'web_app_device_storage_clear':
        try {
          await clearDeviceStorage(request.botId);
          send('device_storage_cleared', {req_id: data?.req_id});
        } catch(err) {
          send('device_storage_failed', {req_id: data?.req_id, error: 'UNKNOWN_ERROR'});
        }
        break;

      case 'web_app_secure_storage_save_key':
      case 'web_app_secure_storage_get_key':
      case 'web_app_secure_storage_restore_key':
      case 'web_app_secure_storage_clear':
        send('secure_storage_failed', {req_id: data?.req_id, error: 'UNSUPPORTED'});
        break;

      case 'web_app_biometry_get_info':
        send('biometry_info_received', {
          available: false,
          access_requested: false,
          access_granted: false,
          token_saved: false,
          device_id: ''
        });
        break;

      case 'web_app_check_location':
        handleCheckLocation();
        break;

      case 'web_app_request_location':
        handleRequestLocation();
        break;

      case 'web_app_check_home_screen':
        send('home_screen_checked', {status: 'unsupported'});
        break;

      case 'web_app_add_to_home_screen':
        send('home_screen_failed', {error: 'UNSUPPORTED'});
        break;

      case 'web_app_start_accelerometer':
        send('accelerometer_failed', {error: 'UNSUPPORTED'});
        break;

      case 'web_app_start_gyroscope':
        send('gyroscope_failed', {error: 'UNSUPPORTED'});
        break;

      case 'web_app_start_device_orientation':
        send('device_orientation_failed', {error: 'UNSUPPORTED'});
        break;

      case 'web_app_request_fullscreen':
        fullscreen.value = true;
        send('fullscreen_changed', {is_fullscreen: true});
        break;

      case 'web_app_exit_fullscreen':
        fullscreen.value = false;
        send('fullscreen_changed', {is_fullscreen: false});
        break;

      case 'web_app_send_prepared_message':
        try {
          prepared.value = await getPreparedMessage(request.botId, data?.id);
        } catch(err: any) {
          send('prepared_message_failed', {error: err?.type || err?.message || 'MESSAGE_EXPIRED'});
        }
        break;

      case 'web_app_request_chat':
        send('requested_chat_failed', {req_id: data?.req_id, error: 'UNSUPPORTED'});
        break;

      case 'web_app_verify_age':
        break;

      case 'web_app_set_header_color':
      case 'web_app_set_background_color':
      case 'web_app_set_bottom_bar_color':
      case 'web_app_setup_swipe_behavior':
      case 'web_app_toggle_orientation_lock':
      case 'web_app_stop_accelerometer':
      case 'web_app_stop_gyroscope':
      case 'web_app_stop_device_orientation':
        break;

      default:
        // An app waiting on an answer we never send just stalls, so make the
        // gap visible rather than silent.
        console.warn('[mini app] unhandled event', eventType, data);
    }
  }

  function onMessage(event: MessageEvent) {
    if(!iframe.current || event.source !== iframe.current.contentWindow) return;

    let payload: any;
    try {
      payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch(err) {
      return;
    }

    if(!payload?.eventType) return;
    sawEvent.value = true;

    // Every inbound event is logged: when an app stalls, the last line before
    // it stopped is the answer it is waiting for.
    console.debug('[mini app] ←', payload.eventType, payload.eventData);
    handle(payload.eventType, payload.eventData === '' ? undefined : payload.eventData);
  }

  // A signal effect would be the wrong tool here: what the listener reaches
  // through `onMessage` → `handle` is the `request` prop and the callbacks, so
  // those go in the dependency list — with an empty one the first render's props
  // would be frozen into the listener for good.
  useEffect(() => {
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [request, onclose, onswitchinline, onlink]);

  useEffect(() => {
    const current = request;
    url.value = '';
    queryId.value = '';
    error.value = '';
    sawEvent.value = false;
    stalled.value = false;
    title.value = current.title || current.buttonText || 'Mini app';
    ready.value = false;
    mainButton.value = null;
    secondaryButton.value = null;
    backVisible.value = false;
    settingsVisible.value = false;
    needConfirmation.current = false;

    let cancelled = false;
    requestWebView(current)
      .then((session) => {
        if(cancelled) return;
        url.value = session.url;
        queryId.value = session.queryId;
      })
      .catch((err) => {
        if(!cancelled) error.value = err?.type || err?.message || 'Failed to open the mini app';
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  // The query id expires after a minute or so; keep it alive while the app is open.
  useSignalEffect(() => {
    if(!queryId.value) return;
    const timer = setInterval(() => {
      prolongWebView(request.peerId, request.botId, queryId.value).catch(() => {});
    }, 50_000);
    return () => clearInterval(timer);
  });

  /**
   * Some mini apps pin `frame-ancestors` to web.telegram.org, so the iframe is
   * blocked before a single byte runs and the window would otherwise sit blank
   * forever. The block is invisible to us cross-origin — silence is the only
   * signal there is.
   */
  useSignalEffect(() => {
    if(!url.value || sawEvent.value) return;
    const timer = setTimeout(() => {
      if(!sawEvent.value) stalled.value = true;
    }, 8000);
    return () => clearTimeout(timer);
  });

  function onKey(event: KeyboardEvent) {
    // Escape only dismisses the app's own popup — the window is not modal, so
    // it must not swallow Escape from the chat behind it.
    if(event.key === 'Escape' && popup.value) answerPopup('');
  }

  /* ---------- floating window ---------- */

  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 320;

  const left = useSignal(0);
  const top = useSignal(0);
  const width = useSignal(420);
  const height = useSignal(720);
  /** True while dragging or resizing: the iframe must not eat the pointer. */
  const moving = useSignal(false);
  /** The bot asked for fullscreen; the window fills the viewport until it exits. */
  const fullscreen = useSignal(false);

  function clampIntoView() {
    width.value = Math.max(MIN_WIDTH, Math.min(width.value, window.innerWidth - 16));
    height.value = Math.max(MIN_HEIGHT, Math.min(height.value, window.innerHeight - 16));
    left.value = Math.max(8, Math.min(left.value, window.innerWidth - width.value - 8));
    top.value = Math.max(8, Math.min(top.value, window.innerHeight - height.value - 8));
  }

  // Placed once, on open. This must not be a signal effect: clampIntoView reads
  // the very state it writes, so the window would snap back to centre on every drag.
  useEffect(() => {
    width.value = Math.min(420, window.innerWidth - 16);
    height.value = Math.min(720, window.innerHeight - 16);
    left.value = Math.round((window.innerWidth - width.value) / 2);
    top.value = Math.round((window.innerHeight - height.value) / 2);
    clampIntoView();
  }, []);

  /**
   * Pointer capture on the grabbed element, so a fast drag that leaves the
   * window (or crosses the iframe) keeps delivering moves.
   */
  function drag(event: PointerEvent, onMove: (dx: number, dy: number) => void) {
    if(event.button !== 0) return;
    event.preventDefault();

    const target = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startY = event.clientY;
    moving.value = true;
    target.setPointerCapture(event.pointerId);

    const move = (e: PointerEvent) => onMove(e.clientX - startX, e.clientY - startY);
    const up = () => {
      moving.value = false;
      target.releasePointerCapture(event.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      send('viewport_changed', viewport());
    };

    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function startMove(event: PointerEvent) {
    if(fullscreen.value) return;
    const originLeft = left.value;
    const originTop = top.value;
    drag(event, (dx, dy) => {
      left.value = originLeft + dx;
      top.value = originTop + dy;
      clampIntoView();
    });
  }

  // Apps lay themselves out against the viewport they were told about.
  useSignalEffect(() => {
    // Reading `fullscreen` keeps a fullscreen toggle in this effect's dependencies.
    const isFullscreen = fullscreen.value;
    const size = width.value + height.value;
    if(ready.value && size) send('viewport_changed', viewport());
  });

  function startResize(event: PointerEvent) {
    if(fullscreen.value) return;
    const originWidth = width.value;
    const originHeight = height.value;
    drag(event, (dx, dy) => {
      width.value = originWidth + dx;
      height.value = originHeight + dy;
      clampIntoView();
    });
  }

  // The window listeners the Svelte version hung off `<svelte:window>`: both
  // handlers read signals, so one registration lasts the component's life.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', clampIntoView);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', clampIntoView);
    };
  }, []);

  return (
    <div
      class={['window', fullscreen.value && 'fullscreen'].filter(Boolean).join(' ')}
      style={fullscreen.value ? {
        left: '0px',
        top: '0px',
        width: '100vw',
        height: '100vh',
        borderRadius: 0
      } : {
        left: `${left.value}px`,
        top: `${top.value}px`,
        width: `${width.value}px`,
        height: `${height.value}px`
      }}
    >
      <header onPointerDown={startMove}>
        {backVisible.value &&
          <button
            class="icon"
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
            onClick={() => send('back_button_pressed', undefined)}
            aria-label="Back"
          >‹</button>
        }
        <span class="title">{title.value}</span>
        {settingsVisible.value &&
          <button
            class="icon"
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
            onClick={() => send('settings_button_pressed', undefined)}
            aria-label="Settings"
          >⚙</button>
        }
        <button
          class="icon"
          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          onClick={() => { ready.value = false; send('reload_iframe', undefined); }}
          aria-label="Reload"
        >⟳</button>
        <button
          class="icon"
          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          onClick={close}
          aria-label="Close"
        >✕</button>
      </header>

      {error.value ?
        <p class="muted">{error.value}</p> :
        !url.value ?
          <p class="muted">Loading…</p> :
          /* Bot mini apps are third-party pages; keep them sandboxed. */
          <iframe
            ref={iframe}
            src={url.value}
            title="Mini app"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
            allow="camera; microphone; geolocation; clipboard-write; autoplay; fullscreen; payment"
            allowFullScreen
            class={moving.value ? 'inert' : ''}
          ></iframe>
      }

      {secondaryButton.value || mainButton.value ?
        <div class="buttons">
          {secondaryButton.value &&
            <button
              class="tg-button secondary"
              disabled={!secondaryButton.value.is_active}
              style={{background: secondaryButton.value.color, color: secondaryButton.value.text_color}}
              onClick={() => send('secondary_button_pressed', undefined)}
            >
              {secondaryButton.value.is_progress_visible ? '…' : secondaryButton.value.text}
            </button>
          }
          {mainButton.value &&
            <button
              class="tg-button"
              disabled={!mainButton.value.is_active}
              style={{background: mainButton.value.color, color: mainButton.value.text_color}}
              onClick={() => send('main_button_pressed', undefined)}
            >
              {mainButton.value.is_progress_visible ? '…' : mainButton.value.text}
            </button>
          }
        </div> :
        null
      }

      {stalled.value &&
        <div class="stalled">
          <p>This app would not load here.</p>
          <p class="hint">
            Some mini apps only allow the official Telegram web app to embed them.
          </p>
          <button onClick={() => window.open(url.value, '_blank', 'noopener,noreferrer')}>
            Open in a new tab
          </button>
        </div>
      }

      {prepared.value &&
        <div class="popup" role="dialog" aria-modal="true">
          <div class="popup-card">
            <strong>Send this message?</strong>
            <p>{prepared.value.title}{prepared.value.description ? ` — ${prepared.value.description}` : ''}</p>
            <div class="popup-buttons">
              <button onClick={declinePrepared}>Cancel</button>
              <button onClick={confirmPrepared}>Send</button>
            </div>
          </div>
        </div>
      }

      {popup.value &&
        <div class="popup" role="dialog" aria-modal="true">
          <div class="popup-card">
            {popup.value.title ? <strong>{popup.value.title}</strong> : null}
            <p>{popup.value.message}</p>
            <div class="popup-buttons">
              {popup.value.buttons.map((button) => (
                <button
                  key={button.id + button.text}
                  class={button.type === 'destructive' ? 'destructive' : ''}
                  onClick={() => answerPopup(button.id ?? '')}
                >{button.text || button.type}</button>
              ))}
            </div>
          </div>
        </div>
      }

      {!fullscreen.value &&
        <div
          class="grip"
          onPointerDown={startResize}
          role="separator"
          aria-label="Resize"
        ></div>
      }
    </div>
  );
}
