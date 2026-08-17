<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {addContact, type ContactExtra} from '$lib/telegram/messageTypes';

  let {
    contact,
    onmessage,
    onerror
  }: {
    contact: ContactExtra;
    onmessage?: (peerId: number) => void;
    onerror?: (message: string) => void;
  } = $props();

  let adding = $state(false);
  let added = $state(false);

  async function add() {
    if (adding) return;
    adding = true;
    try {
      await addContact(contact);
      added = true;
    } catch (err: any) {
      onerror?.(err?.message || 'Could not add the contact');
    } finally {
      adding = false;
    }
  }
</script>

<div class="contact">
  <Avatar peerId={contact.userId} title={contact.name} size={40} />
  <div class="who">
    <span class="name">{contact.name}</span>
    {#if contact.phone}
      <a class="phone" href="tel:{contact.phone}">+{contact.phone.replace(/^\+/, '')}</a>
    {:else}
      <span class="phone muted">Phone number hidden</span>
    {/if}
  </div>
  <div class="actions">
    {#if contact.userId}
      <button onclick={() => onmessage?.(contact.userId)}>Message</button>
    {/if}
    <button onclick={add} disabled={adding || added || !contact.userId}>
      {added ? 'Added' : adding ? 'Adding…' : 'Add'}
    </button>
  </div>
</div>

<style>
  .contact {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    align-items: center;
    min-width: 220px;
  }

  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-weight: 600;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .phone {
    font-size: 12px;
    color: var(--text-dim);
    text-decoration: none;
  }

  .phone.muted {
    opacity: 0.7;
  }

  .actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 6px;
  }

  .actions button {
    flex: 1;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--accent);
    font-size: 13px;
    cursor: pointer;
  }

  .actions button:disabled {
    color: var(--text-dim);
    cursor: default;
  }
</style>
