/*
 * Ported from svelte/src/lib/components/TopicEditor.svelte.
 *
 * The `$effect` that loads the icon choices reads no signal and no prop, so it
 * runs once — a `useEffect` with an empty dependency list, which is the same
 * mount-time load the original performed.
 *
 * `untrack` has no counterpart here: it was only there to make the intentional
 * one-time seeding from the props explicit, and a signal initialiser already
 * reads its value on the first render alone (CONVERSION.md §4).
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Sticker} from './Sticker';
import {TopicIcon} from './TopicIcon';
import {
  createTopic,
  editTopic,
  loadTopicIconChoices,
  TOPIC_ICON_COLORS,
  topicIconColor,
  type TopicItem
} from '$lib/telegram/topics';
import type {StickerItem} from '$lib/telegram/chats';

import './TopicEditor.css';

interface Props {
  peerId: number;
  /** null when creating. */
  topic: TopicItem | null;
  onclose: () => void;
  onsaved: (threadId: number) => void;
}

export function TopicEditor({peerId, topic, onclose, onsaved}: Props) {
  // Mounted fresh on each open, so seeding from the props once is deliberate.
  const title = useSignal(topic?.title ?? '');
  const iconColor = useSignal(topic?.iconColor ?? TOPIC_ICON_COLORS[0]);
  const iconEmojiId = useSignal(topic?.iconEmojiId ?? '');
  const choices = useSignal<StickerItem[]>([]);
  const busy = useSignal(false);
  const error = useSignal('');

  useEffect(() => {
    loadTopicIconChoices().then((items) => (choices.value = items));
  }, []);

  async function save() {
    if(!title.value.trim() || busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      if(topic) {
        await editTopic(peerId, topic.threadId, {
          title: title.value.trim(),
          iconEmojiId: iconEmojiId.value
        });
        onsaved(topic.threadId);
      } else {
        onsaved(await createTopic(peerId, title.value.trim(), {
          iconColor: iconColor.value,
          iconEmojiId: iconEmojiId.value
        }));
      }
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to save the topic';
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>
          <TopicIcon iconEmojiId={iconEmojiId.value} iconColor={iconColor.value} title={title.value} size={26} />
          <span>{topic ? 'Edit topic' : 'New topic'}</span>
        </header>

        <label class="field">
          <span>Name</span>
          <input
            value={title.value}
            onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
            placeholder="Topic name"
            maxlength={128}
          />
        </label>

        {!topic ?
          <>
            {/* The colour is fixed at creation: messages.editForumTopic cannot
                change it afterwards, only the custom emoji. */}
            <p class="label">Colour</p>
            <div class="colors">
              {TOPIC_ICON_COLORS.map((color) => (
                <button
                  key={color}
                  class={['swatch', color === iconColor.value && 'on'].filter(Boolean).join(' ')}
                  style={{background: topicIconColor(color)}}
                  aria-label="Icon colour"
                  onClick={() => (iconColor.value = color)}
                ></button>
              ))}
            </div>
          </> :
          null}

        <p class="label">Icon</p>
        <div class="icons">
          <button
            class={['icon', !iconEmojiId.value && 'on'].filter(Boolean).join(' ')}
            onClick={() => (iconEmojiId.value = '')}
            title="No icon"
          >
            <TopicIcon iconColor={iconColor.value} title={title.value} size={26} />
          </button>
          {choices.value.map((choice) => (
            <button
              key={choice.docId}
              class={['icon', choice.docId === iconEmojiId.value && 'on'].filter(Boolean).join(' ')}
              onClick={() => (iconEmojiId.value = choice.docId)}
            >
              <Sticker sticker={choice} size={26} />
            </button>
          ))}
        </div>

        {error.value ? <p class="error">{error.value}</p> : null}

        <footer>
          <span class="spacer"></span>
          <button onClick={onclose} disabled={busy.value}>Cancel</button>
          <button class="primary" onClick={save} disabled={busy.value || !title.value.trim()}>
            {busy.value ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
