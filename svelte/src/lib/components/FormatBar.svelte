<script lang="ts">
  /**
   * Formatting controls for the composer.
   *
   * Owns both entry points — the popup that appears over a selection and the
   * Ctrl/Cmd shortcuts — so the chat only has to render it next to the
   * textarea. Edits go back through a synthetic `input` event, which is what
   * `bind:value` listens for, so the draft, the auto-resize and the typing
   * indicator all keep working untouched.
   */
  import {wrapSelection, formatShortcut, type FormatKind} from '$lib/telegram/composerFormat';

  let {textarea}: {textarea: HTMLTextAreaElement | undefined} = $props();

  let open = $state(false);
  let top = $state(0);
  let left = $state(0);

  const actions: {kind: FormatKind; label: string; title: string}[] = [
    {kind: 'bold', label: 'B', title: 'Bold (Ctrl+B)'},
    {kind: 'italic', label: 'I', title: 'Italic (Ctrl+I)'},
    {kind: 'underline', label: 'U', title: 'Underline (Ctrl+U)'},
    {kind: 'strike', label: 'S', title: 'Strikethrough (Ctrl+Shift+X)'},
    {kind: 'mono', label: '</>', title: 'Monospace (Ctrl+Shift+M)'},
    {kind: 'spoiler', label: '', title: 'Spoiler (Ctrl+Shift+P)'},
    {kind: 'link', label: '', title: 'Link (Ctrl+K)'}
  ];

  function place() {
    if (!textarea) return;
    const rect = textarea.getBoundingClientRect();
    top = rect.top;
    left = rect.left;
  }

  function sync() {
    if (!textarea || document.activeElement !== textarea) {
      open = false;
      return;
    }

    open = textarea.selectionStart !== textarea.selectionEnd;
    if (open) place();
  }

  function apply(kind: FormatKind) {
    if (!textarea) return;

    let url: string | undefined;
    if (kind === 'link') {
      url = window.prompt('Link URL')?.trim() || undefined;
      if (!url) return;
      if (!/^[a-z][\w+.-]*:/i.test(url)) url = `https://${url}`;
    }

    const next = wrapSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      kind,
      url
    );

    textarea.value = next.value;
    textarea.dispatchEvent(new Event('input', {bubbles: true}));
    textarea.focus();
    textarea.setSelectionRange(next.start, next.end);
    sync();
  }

  $effect(() => {
    const node = textarea;
    if (!node) return;

    // Capture: the chat's own keydown handler runs on the same element and a
    // handled shortcut must not reach it.
    const onkeydown = (e: KeyboardEvent) => {
      const kind = formatShortcut(e);
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      apply(kind);
    };

    const onselectionchange = () => sync();

    node.addEventListener('keydown', onkeydown, true);
    node.addEventListener('blur', onselectionchange);
    document.addEventListener('selectionchange', onselectionchange);
    window.addEventListener('resize', onselectionchange);
    window.addEventListener('scroll', onselectionchange, true);

    return () => {
      node.removeEventListener('keydown', onkeydown, true);
      node.removeEventListener('blur', onselectionchange);
      document.removeEventListener('selectionchange', onselectionchange);
      window.removeEventListener('resize', onselectionchange);
      window.removeEventListener('scroll', onselectionchange, true);
    };
  });
</script>

{#if open}
  <div class="format-bar" style="top: {top}px; left: {left}px" role="toolbar" aria-label="Formatting">
    {#each actions as action (action.kind)}
      <button
        type="button"
        class={action.kind}
        title={action.title}
        aria-label={action.title}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => apply(action.kind)}
      >
        {#if action.kind === 'link'}
          <svg
            class="icon"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M8.4 11.6a2.9 2.9 0 000 0l3.2-3.2" />
            <path d="M9.2 6.4l1.8-1.8a3 3 0 014.4 4.4l-1.8 1.8" />
            <path d="M10.8 13.6l-1.8 1.8a3 3 0 01-4.4-4.4l1.8-1.8" />
          </svg>
        {:else if action.kind === 'spoiler'}
          <svg
            class="icon"
            viewBox="0 0 20 20"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M3.2 10s2.7-4.4 6.8-4.4S16.8 10 16.8 10s-2.7 4.4-6.8 4.4S3.2 10 3.2 10z" />
            <path d="M4.4 4.4l11.2 11.2" />
          </svg>
        {:else}
          {action.label}
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .format-bar {
    position: fixed;
    transform: translateY(calc(-100% - 8px));
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
  }

  .format-bar button {
    min-width: 30px;
    height: 28px;
    padding: 0 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .icon {
    display: block;
  }

  .format-bar button:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .bold {
    font-weight: 700;
  }

  .italic {
    font-style: italic;
  }

  .underline {
    text-decoration: underline;
  }

  .strike {
    text-decoration: line-through;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
</style>
