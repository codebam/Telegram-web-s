import {describe, expect, it} from 'vitest';
import {reactionPeerFromResult} from '../../svelte/src/lib/telegram/chats';

describe('reaction participant names', () => {
  it('uses the user returned with the reaction list rather than an unrelated peer cache', () => {
    const result = {
      users: [{_: 'user', id: 42, first_name: 'Ada', last_name: 'Lovelace'}],
      chats: [],
      reactions: [{peer_id: {_: 'peerUser', user_id: 42}}]
    };

    expect(reactionPeerFromResult(result, result.reactions[0])).toMatchObject({
      _: 'user',
      first_name: 'Ada',
      last_name: 'Lovelace'
    });
  });

  it('uses channel and basic-chat records returned with the reaction list', () => {
    const result = {
      users: [],
      chats: [
        {_: 'channel', id: 100, title: 'Announcements'},
        {_: 'chat', id: 200, title: 'Study group'}
      ]
    };

    expect(reactionPeerFromResult(result, {peer_id: {_: 'peerChannel', channel_id: 100}})?.title).toBe('Announcements');
    expect(reactionPeerFromResult(result, {peer_id: {_: 'peerChat', chat_id: 200}})?.title).toBe('Study group');
  });
});
