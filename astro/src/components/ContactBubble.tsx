/*
 * Ported from svelte/src/lib/components/ContactBubble.svelte.
 */
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {addContact, type ContactExtra} from '$lib/telegram/messageTypes';

import './ContactBubble.css';

interface Props {
  contact: ContactExtra;
  onmessage?: (peerId: number) => void;
  onerror?: (message: string) => void;
}

export function ContactBubble({contact, onmessage, onerror}: Props) {
  const adding = useSignal(false);
  const added = useSignal(false);

  async function add() {
    if(adding.value) return;
    adding.value = true;
    try {
      await addContact(contact);
      added.value = true;
    } catch(err: any) {
      onerror?.(err?.message || 'Could not add the contact');
    } finally {
      adding.value = false;
    }
  }

  return (
    <div class="contact">
      <Avatar peerId={contact.userId} title={contact.name} size={40} />
      <div class="who">
        <span class="name">{contact.name}</span>
        {contact.phone ?
          <a class="phone" href={`tel:${contact.phone}`}>+{contact.phone.replace(/^\+/, '')}</a> :
          <span class="phone muted">Phone number hidden</span>}
      </div>
      <div class="actions">
        {contact.userId && <button onClick={() => onmessage?.(contact.userId)}>Message</button>}
        <button onClick={add} disabled={adding.value || added.value || !contact.userId}>
          {added.value ? 'Added' : adding.value ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
