/*
 * Ported from svelte/src/lib/components/ChatAdmin.svelte.
 *
 * The two `$effect`s are split by what they read, which is what decides the hook
 * (CONVERSION.md §4): the loader reads the `peerId` prop *and* the `revision`
 * signal, so it is a `useEffect` over both — a `useSignalEffect` tracks signal
 * reads only and would never notice a different chat being opened. The
 * section-fallback below reads signals alone and stays a `useSignalEffect`.
 *
 * The loader's guard compared against the prop as it was when the fetch was
 * *started*, which Svelte always read as current; a JSX closure would see the
 * render that started the load, so the latest peer id is kept in a ref, as in
 * `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {ChatAdminEdit} from './ChatAdminEdit';
import {ChatAdminPermissions} from './ChatAdminPermissions';
import {ChatAdminMembers} from './ChatAdminMembers';
import {ChatAdminInvites} from './ChatAdminInvites';
import {ChatAdminLog} from './ChatAdminLog';
import {ChatAdminDelete} from './ChatAdminDelete';
import {ChatAdminDiscussion} from './ChatAdminDiscussion';
import {loadAdminChat, type AdminChat} from '$lib/telegram/admin';

import './ChatAdmin.css';

interface Props {
  peerId: number;
  onclose: () => void;
  /** The chat became a supergroup and lives under a new peer id. */
  onmigrated?: (peerId: number) => void;
  /** Open a member's profile. */
  onpeer?: (peerId: number) => void;
}

type Section =
  | 'edit'
  | 'permissions'
  | 'admins'
  | 'members'
  | 'removed'
  | 'invites'
  | 'requests'
  | 'log'
  | 'delete'
  | 'discussion';

export function ChatAdmin({peerId, onclose, onmigrated, onpeer}: Props) {
  const chat = useSignal<AdminChat | null>(null);
  const error = useSignal('');
  const section = useSignal<Section>('edit');
  // Bumped after any change that alters the chat itself, so the shell reloads
  // and the sections below it see the new title, permissions or link.
  const revision = useSignal(0);

  // The running fetch compares its own prop against the latest one — see the
  // note at the top of the file.
  const currentPeerId = useRef(peerId);
  currentPeerId.current = peerId;

  useEffect(() => {
    const id = peerId;
    error.value = '';
    loadAdminChat(id)
      .then((loaded) => {
        if(id === currentPeerId.current) chat.value = loaded;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load the chat'));
  }, [peerId, revision.value]);

  /**
   * Which sections this chat has at all. A basic group has no invite-link
   * management, no admin log and no discussion group until it is migrated, and
   * a broadcast channel has no member permissions to set.
   */
  const sections = useComputed((): [Section, string][] => {
    if(!chat.value) return [];
    const {access, isChannel, isBasicGroup} = chat.value;
    const list: [Section, string][] = [];

    if(access.changeInfo || access.changeType || access.isCreator) list.push(['edit', 'Edit']);
    if(!isChannel && access.changePermissions) list.push(['permissions', 'Permissions']);
    list.push(['admins', 'Admins']);
    if(access.banUsers || access.addAdmins) list.push(['members', 'Members']);
    if(access.banUsers && !isBasicGroup) list.push(['removed', 'Removed']);
    if(access.inviteLinks) list.push(['invites', 'Invite links']);
    if(access.inviteLinks && !isBasicGroup) list.push(['requests', 'Requests']);
    if(access.viewAdminLog) list.push(['log', 'Recent actions']);
    // A date-range clear is only honoured on the messages.deleteHistory path,
    // i.e. a basic group; a channel gets the per-member delete instead.
    if(access.deleteMessages && isBasicGroup) list.push(['delete', 'Delete messages']);
    if(isChannel && access.isCreator) list.push(['discussion', 'Discussion']);

    return list;
  });

  // A section can disappear when the chat's shape changes under us — falling
  // back to the first one beats rendering an empty pane.
  useSignalEffect(() => {
    const available = sections.value;
    if(available.length && !available.some(([key]) => key === section.value)) {
      section.value = available[0][0];
    }
  });

  function changed() {
    revision.value += 1;
  }

  function migrated(newPeerId: number) {
    onmigrated?.(newPeerId);
    onclose();
  }

  // The `{#if} {:else if} …` chain that picked the open section's body, resolved
  // before the single return. Nothing renders when the section is unknown, as in
  // the original.
  let body: preact.JSX.Element;

  if(section.value === 'edit') {
    body = (
      <ChatAdminEdit chat={chat.value} onchanged={changed} onmigrated={migrated} onleft={onclose} />
    );
  } else if(section.value === 'permissions') {
    body = <ChatAdminPermissions chat={chat.value} onchanged={changed} />;
  } else if(section.value === 'admins') {
    body = <ChatAdminMembers chat={chat.value} mode="admins" onchanged={changed} onpeer={onpeer} />;
  } else if(section.value === 'members') {
    body = <ChatAdminMembers chat={chat.value} mode="members" onchanged={changed} onpeer={onpeer} />;
  } else if(section.value === 'removed') {
    body = <ChatAdminMembers chat={chat.value} mode="removed" onchanged={changed} onpeer={onpeer} />;
  } else if(section.value === 'invites') {
    body = <ChatAdminInvites chat={chat.value} mode="links" />;
  } else if(section.value === 'requests') {
    body = <ChatAdminInvites chat={chat.value} mode="requests" onpeer={onpeer} />;
  } else if(section.value === 'log') {
    body = <ChatAdminLog chat={chat.value} onpeer={onpeer} />;
  } else if(section.value === 'delete') {
    body = <ChatAdminDelete chat={chat.value} onchanged={changed} />;
  } else if(section.value === 'discussion') {
    body = <ChatAdminDiscussion chat={chat.value} onchanged={changed} />;
  }

  return (
    <div class="admin-backdrop" onClick={onclose} role="presentation">
      <div class="admin-dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>
          <span>{chat.value ? chat.value.title || 'Manage' : 'Manage'}</span>
          <button class="close" onClick={onclose} aria-label="Close">✕</button>
        </header>

        {error.value ?
          <p class="admin-error">{error.value}</p> :
          !chat.value ?
            <p class="admin-muted">Loading…</p> :
            <>
              <nav class="admin-nav">
                {sections.value.map(([key, label]) => (
                  <button
                    key={key}
                    class={section.value === key ? 'active' : ''}
                    onClick={() => (section.value = key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div class="admin-body">{body}</div>
            </>}
      </div>
    </div>
  );
}
