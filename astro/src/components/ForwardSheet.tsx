/*
 * Ported from svelte/src/lib/components/ForwardSheet.svelte.
 *
 * The `{#snippet extras()}` the sheet handed to `PeerPicker` is that component's
 * `extras` prop now, a `ComponentChildren`: the markup is passed as JSX rather
 * than as a function, so it is rendered in place of the old slot.
 */
import {useSignal} from '@preact/signals';

import {PeerPicker} from './PeerPicker';
import type {DialogItem} from '$lib/telegram/chats';
import type {ForwardOptions} from '$lib/telegram/reply';

import './ForwardSheet.css';

interface Props {
  dialogs: DialogItem[];
  /** How many messages are being forwarded, for the title. */
  count: number;
  /** Whether any of them carries a caption — the option is pointless without. */
  hasCaptions?: boolean;
  onforward: (targets: number[], options: ForwardOptions) => void;
  onclose: () => void;
}

export function ForwardSheet({
  dialogs,
  count,
  hasCaptions = false,
  onforward,
  onclose
}: Props) {
  const targets = useSignal<number[]>([]);
  const dropAuthor = useSignal(false);
  const dropCaptions = useSignal(false);
  const comment = useSignal('');

  function toggle(peerId: number) {
    targets.value = targets.value.includes(peerId) ?
      targets.value.filter((id) => id !== peerId) :
      [...targets.value, peerId];
  }

  function confirm() {
    if(!targets.value.length) return;
    // Plain values, not the signals: these end up in a worker message.
    onforward([...targets.value], {
      dropAuthor: dropAuthor.value,
      dropCaptions: dropCaptions.value,
      comment: comment.value.trim()
    });
  }

  return (
    <PeerPicker
      title={count > 1 ? `Forward ${count} messages` : 'Forward message'}
      dialogs={dialogs}
      selectedIds={targets.value}
      onpick={toggle}
      onconfirm={confirm}
      confirmLabel={targets.value.length > 1 ? `Send to ${targets.value.length}` : 'Send'}
      onclose={onclose}
      extras={
        <>
          <label class="option">
            <input
              type="checkbox"
              checked={dropAuthor.value}
              onChange={(e) => (dropAuthor.value = (e.target as HTMLInputElement).checked)}
            />
            <span>Hide sender name</span>
          </label>
          {hasCaptions && (
            <label class="option">
              <input
                type="checkbox"
                checked={dropCaptions.value}
                onChange={(e) => (dropCaptions.value = (e.target as HTMLInputElement).checked)}
              />
              <span>Hide captions</span>
            </label>
          )}
          <input
            class="comment"
            placeholder="Add a comment…"
            value={comment.value}
            onInput={(e) => (comment.value = (e.target as HTMLInputElement).value)}
          />
        </>
      }
    />
  );
}
