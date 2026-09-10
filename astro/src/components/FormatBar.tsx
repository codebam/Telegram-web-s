/**
 * Formatting controls for the composer.
 *
 * Owns both entry points — the popup that appears over a selection and the
 * Ctrl/Cmd shortcuts — so the chat only has to render it next to the
 * textarea. Edits go back through a synthetic `input` event, which is what the
 * composer's `onInput` listens for, so the draft, the auto-resize and the
 * typing indicator all keep working untouched.
 *
 * Ported from svelte/src/lib/components/FormatBar.svelte. The `$effect` there
 * depended on the `textarea` *prop*, not on a signal, so it is a `useEffect`
 * with `textarea` in its dependency list — `useSignalEffect` tracks signal reads
 * only and would never re-run when the composer hands over another textarea.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {wrapSelection, formatShortcut, type FormatKind} from '$lib/telegram/composerFormat';

import './FormatBar.css';

interface Props {
  textarea: HTMLTextAreaElement | undefined;
}

export function FormatBar({textarea}: Props) {
  const open = useSignal(false);
  const top = useSignal(0);
  const left = useSignal(0);

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
    if(!textarea) return;
    const rect = textarea.getBoundingClientRect();
    top.value = rect.top;
    left.value = rect.left;
  }

  function sync() {
    if(!textarea || document.activeElement !== textarea) {
      open.value = false;
      return;
    }

    open.value = textarea.selectionStart !== textarea.selectionEnd;
    if(open.value) place();
  }

  function apply(kind: FormatKind) {
    if(!textarea) return;

    let url: string | undefined;
    if(kind === 'link') {
      url = window.prompt('Link URL')?.trim() || undefined;
      if(!url) return;
      if(!/^[a-z][\w+.-]*:/i.test(url)) url = `https://${url}`;
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

  useEffect(() => {
    const node = textarea;
    if(!node) return;

    // Capture: the chat's own keydown handler runs on the same element and a
    // handled shortcut must not reach it.
    const onkeydown = (e: KeyboardEvent) => {
      const kind = formatShortcut(e);
      if(!kind) return;
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
  }, [textarea]);

  return (
    <>
      {open.value && (
        <div
          class="format-bar"
          style={{top: `${top.value}px`, left: `${left.value}px`}}
          role="toolbar"
          aria-label="Formatting"
        >
          {actions.map((action) => (
            <button
              key={action.kind}
              type="button"
              class={action.kind}
              title={action.title}
              aria-label={action.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(action.kind)}
            >
              {action.kind === 'link' ?
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
                </svg> :
                action.kind === 'spoiler' ?
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
                </svg> :
                action.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
