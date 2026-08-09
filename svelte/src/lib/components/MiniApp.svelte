<script lang="ts">
  import {
    requestWebView,
    prolongWebView,
    sendWebViewData,
    allowBotSendMessage,
    invokeWebViewCustomMethod,
    readDeviceStorage,
    writeDeviceStorage,
    clearDeviceStorage,
    getPreparedMessage,
    sendPreparedMessage,
    themeParams,
    type MiniAppRequest,
    type PreparedMessage
  } from '$lib/telegram/miniApps';

  let {
    request,
    onclose,
    onswitchinline,
    onlink
  }: {
    request: MiniAppRequest;
    onclose: () => void;
    onswitchinline?: (query: string) => void;
    /** Returns true when the host opened the link itself (another mini app). */
    onlink?: (url: string) => boolean;
  } = $props();

  type PopupButton = {type: string; text: string; id: string};
  type ButtonState = {
    is_visible: boolean;
    is_active: boolean;
    text: string;
    color: string;
    text_color: string;
    is_progress_visible: boolean;
  };

  let iframe = $state<HTMLIFrameElement | undefined>();
  let url = $state('');
  let queryId = $state('');
  let error = $state('');
  let ready = $state(false);
  let title = $state(request.title || request.buttonText || 'Mini app');

  let mainButton = $state<ButtonState | null>(null);
  let secondaryButton = $state<ButtonState | null>(null);
  let backVisible = $state(false);
  let settingsVisible = $state(false);
  let needConfirmation = false;
  let popup = $state<{title: string; message: string; buttons: PopupButton[]} | null>(null);
  let popupAnswered = false;
  /** A message the bot prepared for us to post into the chat, awaiting confirmation. */
  let prepared = $state<PreparedMessage | null>(null);

  /** The bot page talks to us with `postMessage(JSON.stringify({eventType, eventData}))`. */
  function send(eventType: string, eventData?: any) {
    iframe?.contentWindow?.postMessage(JSON.stringify({eventType, eventData}), '*');
  }

  function viewport() {
    const height = iframe?.clientHeight || window.innerHeight;
    return {height, is_state_stable: true, is_expanded: true};
  }

  function close() {
    if(needConfirmation && !confirm('Close this mini app?')) return;
    onclose();
  }

  function answerPopup(id: string) {
    popup = null;
    if(popupAnswered) return;
    popupAnswered = true;
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
    const message = prepared;
    if(!message) return;
    prepared = null;

    try {
      await sendPreparedMessage(request.peerId, request.botId, message.queryAndResultId);
      send('prepared_message_sent', undefined);
      onclose();
    } catch(err: any) {
      send('prepared_message_failed', {error: err?.type || err?.message || 'UNKNOWN_ERROR'});
    }
  }

  function declinePrepared() {
    prepared = null;
    send('prepared_message_failed', {error: 'USER_DECLINED'});
  }

  async function handle(eventType: string, data: any) {
    switch (eventType) {
      case 'iframe_ready':
      case 'web_app_ready':
        ready = true;
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
        needConfirmation = !!data?.need_confirmation;
        break;

      case 'web_app_setup_main_button':
        mainButton = data?.is_visible ? (data as ButtonState) : null;
        break;

      case 'web_app_setup_secondary_button':
        secondaryButton = data?.is_visible ? (data as ButtonState) : null;
        break;

      case 'web_app_setup_back_button':
        backVisible = !!data?.is_visible;
        break;

      case 'web_app_setup_settings_button':
        settingsVisible = !!data?.is_visible;
        break;

      case 'web_app_open_popup':
        popupAnswered = false;
        popup = {
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
        send('location_checked', {available: false});
        break;

      case 'web_app_request_location':
        send('location_requested', {available: false});
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
        send('fullscreen_failed', {error: 'UNSUPPORTED'});
        break;

      case 'web_app_exit_fullscreen':
        send('fullscreen_changed', {is_fullscreen: false});
        break;

      case 'web_app_send_prepared_message':
        try {
          prepared = await getPreparedMessage(request.botId, data?.id);
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
    if(!iframe || event.source !== iframe.contentWindow) return;

    let payload: any;
    try {
      payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch(err) {
      return;
    }

    if(!payload?.eventType) return;
    handle(payload.eventType, payload.eventData === '' ? undefined : payload.eventData);
  }

  $effect(() => {
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  $effect(() => {
    const current = request;
    url = '';
    queryId = '';
    error = '';
    title = current.title || current.buttonText || 'Mini app';
    ready = false;
    mainButton = null;
    secondaryButton = null;
    backVisible = false;
    settingsVisible = false;
    needConfirmation = false;

    let cancelled = false;
    requestWebView(current)
      .then((session) => {
        if(cancelled) return;
        url = session.url;
        queryId = session.queryId;
      })
      .catch((err) => {
        if(!cancelled) error = err?.type || err?.message || 'Failed to open the mini app';
      });

    return () => {
      cancelled = true;
    };
  });

  // The query id expires after a minute or so; keep it alive while the app is open.
  $effect(() => {
    if(!queryId) return;
    const timer = setInterval(() => {
      prolongWebView(request.peerId, request.botId, queryId).catch(() => {});
    }, 50_000);
    return () => clearInterval(timer);
  });

  function onKey(event: KeyboardEvent) {
    if(event.key !== 'Escape') return;
    if(popup) answerPopup('');
    else close();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={close} role="presentation">
  <div class="frame" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      {#if backVisible}
        <button
          class="icon"
          onclick={() => send('back_button_pressed', undefined)}
          aria-label="Back"
        >‹</button>
      {/if}
      <span class="title">{title}</span>
      {#if settingsVisible}
        <button
          class="icon"
          onclick={() => send('settings_button_pressed', undefined)}
          aria-label="Settings"
        >⚙</button>
      {/if}
      <button
        class="icon"
        onclick={() => { ready = false; send('reload_iframe', undefined); }}
        aria-label="Reload"
      >⟳</button>
      <button class="icon" onclick={close} aria-label="Close">✕</button>
    </header>

    {#if error}
      <p class="muted">{error}</p>
    {:else if !url}
      <p class="muted">Loading…</p>
    {:else}
      <!-- Bot mini apps are third-party pages; keep them sandboxed. -->
      <iframe
        bind:this={iframe}
        src={url}
        title="Mini app"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"
        allow="camera; microphone; geolocation; clipboard-write; autoplay; fullscreen; payment"
        allowfullscreen
      ></iframe>
    {/if}

    {#if secondaryButton || mainButton}
      <div class="buttons">
        {#if secondaryButton}
          <button
            class="tg-button secondary"
            disabled={!secondaryButton.is_active}
            style="background: {secondaryButton.color}; color: {secondaryButton.text_color}"
            onclick={() => send('secondary_button_pressed', undefined)}
          >
            {secondaryButton.is_progress_visible ? '…' : secondaryButton.text}
          </button>
        {/if}
        {#if mainButton}
          <button
            class="tg-button"
            disabled={!mainButton.is_active}
            style="background: {mainButton.color}; color: {mainButton.text_color}"
            onclick={() => send('main_button_pressed', undefined)}
          >
            {mainButton.is_progress_visible ? '…' : mainButton.text}
          </button>
        {/if}
      </div>
    {/if}

    {#if prepared}
      <div class="popup" role="dialog" aria-modal="true">
        <div class="popup-card">
          <strong>Send this message?</strong>
          <p>{prepared.title}{prepared.description ? ` — ${prepared.description}` : ''}</p>
          <div class="popup-buttons">
            <button onclick={declinePrepared}>Cancel</button>
            <button onclick={confirmPrepared}>Send</button>
          </div>
        </div>
      </div>
    {/if}

    {#if popup}
      <div class="popup" role="dialog" aria-modal="true">
        <div class="popup-card">
          {#if popup.title}<strong>{popup.title}</strong>{/if}
          <p>{popup.message}</p>
          <div class="popup-buttons">
            {#each popup.buttons as button (button.id + button.text)}
              <button
                class:destructive={button.type === 'destructive'}
                onclick={() => answerPopup(button.id ?? '')}
              >{button.text || button.type}</button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 96;
  }

  .frame {
    position: relative;
    width: min(460px, calc(100vw - 24px));
    height: min(760px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--bg-solid);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 16px;
    padding: 4px 8px;
    border-radius: 8px;
  }

  .icon:hover {
    color: var(--text);
    background: var(--bg-elevated);
  }

  iframe {
    flex: 1;
    border: none;
    width: 100%;
    background: var(--bg-solid);
  }

  .muted {
    color: var(--text-dim);
    padding: 18px;
  }

  .buttons {
    display: flex;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid var(--border);
    flex: none;
  }

  .tg-button {
    flex: 1;
    border: none;
    border-radius: 10px;
    padding: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }

  .tg-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .popup {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    padding: 16px;
  }

  .popup-card {
    background: var(--bg-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    max-width: 100%;
  }

  .popup-card p {
    margin: 8px 0 14px;
    color: var(--text-dim);
  }

  .popup-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .popup-buttons button {
    background: none;
    border: none;
    color: var(--accent);
    font-weight: 600;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 8px;
  }

  .popup-buttons button.destructive {
    color: var(--danger);
  }

  .popup-buttons button:hover {
    background: var(--bg-elevated);
  }
</style>
