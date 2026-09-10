/*
 * Ported from svelte/src/lib/components/NewChat.svelte.
 *
 * `contacts` derives from the `dialogs` *prop*, so it is a `useMemo` keyed on
 * that prop rather than a `useComputed` — `useComputed` tracks signal reads and
 * would never see the prop change. `filtered` mixes both, so it re-computes on
 * the memoised list and on `query`, which sits in its dependency list.
 */
import {useMemo} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {createChannel, createGroup, setChatUsername, type DialogItem} from '$lib/telegram/chats';

import {Avatar} from './Avatar';

import './NewChat.css';

interface Props {
  dialogs: DialogItem[];
  onclose: () => void;
  oncreated: (peerId: number) => void;
}

export function NewChat({dialogs, onclose, oncreated}: Props) {
  const kind = useSignal<'group' | 'channel'>('group');
  const title = useSignal('');
  const about = useSignal('');
  const link = useSignal('');
  /**
   * Set once the chat exists. A failed @link must not create a second chat on
   * retry, so creation is skipped when this is filled in.
   */
  const createdPeerId = useSignal<number | null>(null);
  const query = useSignal('');
  const selected = useSignal<Set<number>>(new Set());
  const busy = useSignal(false);
  const error = useSignal('');

  // You cannot seed a chat with yourself, and only users can be invited.
  const contacts = useMemo(() => dialogs.filter((d) => d.isUser && !d.isSelf), [dialogs]);

  const filtered = useMemo(
    () => query.value.trim()
      ? contacts.filter((d) => d.title.toLowerCase().includes(query.value.trim().toLowerCase()))
      : contacts,
    [contacts, query.value]
  );

  // A basic group must be created with at least one other member; a channel can
  // start empty and be filled later.
  const canCreate = useComputed(
    () => !!title.value.trim() && (kind.value === 'channel' || selected.value.size > 0)
  );

  function toggle(peerId: number) {
    const next = new Set(selected.value);
    if(next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected.value = next;
  }

  async function create() {
    if(!canCreate.value || busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      const members = [...selected.value];
      if(createdPeerId.value === null) {
        createdPeerId.value =
          kind.value === 'channel'
            ? await createChannel(title.value.trim(), about.value.trim(), members)
            : await createGroup(title.value.trim(), members);
      }

      let peerId = createdPeerId.value;
      if(link.value.trim()) peerId = await setChatUsername(peerId, link.value);

      oncreated(peerId);
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Failed to create chat';
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>New {kind.value}</header>

        <div class="kinds">
          <button class={kind.value === 'group' ? 'on' : ''} onClick={() => (kind.value = 'group')}>Group</button>
          <button class={kind.value === 'channel' ? 'on' : ''} onClick={() => (kind.value = 'channel')}>Channel</button>
        </div>

        <label class="field">
          <span>Name</span>
          <input
            value={title.value}
            onInput={(e) => (title.value = (e.target as HTMLInputElement).value)}
            placeholder={kind.value === 'channel' ? 'Channel name' : 'Group name'}
            maxlength={128}
          />
        </label>

        {kind.value === 'channel' &&
          <label class="field">
            <span>Description</span>
            <textarea
              value={about.value}
              onInput={(e) => (about.value = (e.target as HTMLTextAreaElement).value)}
              placeholder="Optional"
              maxlength={255}
              rows={2}
            ></textarea>
          </label>}

        <label class="field">
          <span>Public link</span>
          <span class="link-edit">
            <span class="at">@</span>
            <input
              value={link.value}
              onInput={(e) => (link.value = (e.target as HTMLInputElement).value)}
              placeholder={`Optional — leave empty for a private ${kind.value}`}
              maxlength={32}
              spellcheck={false}
              autocapitalize="none"
            />
          </span>
          {kind.value === 'group' && !!link.value.trim() &&
            <span class="hint">A public group becomes a supergroup.</span>}
        </label>

        <p class="label">
          Members ({selected.value.size})
          {kind.value === 'channel' && <span class="muted">— optional</span>}
        </p>
        <input
          class="search"
          placeholder="Search contacts"
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />

        <div class="list">
          {filtered.map((dialog) => (
            <button
              key={dialog.peerId}
              class={['row', selected.value.has(dialog.peerId) && 'on'].filter(Boolean).join(' ')}
              onClick={() => toggle(dialog.peerId)}
            >
              <span class="check">{selected.value.has(dialog.peerId) ? '☑' : '☐'}</span>
              <Avatar peerId={dialog.peerId} title={dialog.title} size={32} />
              <span class="name">{dialog.title}</span>
            </button>
          ))}
          {!filtered.length && <p class="muted">No contacts found.</p>}
        </div>

        {error.value && <p class="error">{error.value}</p>}
        {createdPeerId.value !== null && !!error.value &&
          <p class="hint">The {kind.value} was created — only the link failed.</p>}

        <footer>
          <span class="spacer"></span>
          {createdPeerId.value !== null ?
            <button onClick={() => oncreated(createdPeerId.value!)} disabled={busy.value}>Open without link</button> :
            <button onClick={onclose} disabled={busy.value}>Cancel</button>}
          <button
            class="primary"
            onClick={create}
            disabled={busy.value || !canCreate.value}
          >
            {busy.value ? 'Creating…' : createdPeerId.value !== null ? 'Retry link' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}
