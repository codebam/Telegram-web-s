/*
 * Ported from svelte/src/lib/components/PollResults.svelte.
 *
 * The `$effect` reads props only — the message whose voters are being listed —
 * so it becomes a `useEffect` with those in its dependency list:
 * `useSignalEffect` tracks signal reads only and would never re-run for another
 * poll (CONVERSION.md §4). The `alive` flag the original returned as its cleanup
 * works unchanged.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {pollVoters, type PollVoter} from '$lib/telegram/messageTypes';
import type {PollPreview} from '$lib/telegram/chats';

import './PollResults.css';

interface Props {
  peerId: number;
  mid: number;
  poll: PollPreview;
  onclose: () => void;
  onpeer?: (peerId: number) => void;
}

export function PollResults({peerId, mid, poll, onclose, onpeer}: Props) {
  const voters = useSignal<Record<number, PollVoter[]>>({});
  const loading = useSignal(true);
  /** Anonymous polls answer with nothing — that is the feature, not an error. */
  const anonymous = useSignal(false);

  useEffect(() => {
    let alive = true;
    loading.value = true;

    Promise.all(poll.answers.map((_, index) => pollVoters(peerId, mid, index)))
      .then((lists) => {
        if(!alive) return;
        voters.value = lists.reduce((acc, list, index) => ({...acc, [index]: list}), {});
        anonymous.value = lists.every((list) => !list.length) && poll.totalVoters > 0;
      })
      .finally(() => {
        if(alive) loading.value = false;
      });

    return () => (alive = false);
  }, [peerId, mid, poll]);

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>{poll.question || 'Poll results'}</header>
        <span class="total">{poll.totalVoters} voters{poll.closed ? ' · closed' : ''}</span>

        {loading.value ?
          <p class="muted">Loading…</p> :
          anonymous.value ?
            <p class="muted">This poll is anonymous — individual votes are not shown.</p> :
            null}

        <div class="list">
          {poll.answers.map((answer, index) => (
            <section key={index}>
              <div class="answer">
                <span class="text">{answer.text}</span>
                <span class="pct">{answer.percent}% · {answer.voters}</span>
              </div>
              <span class="bar" style={{width: `${answer.percent}%`}} />
              {(voters.value[index] ?? []).map((voter) => (
                <button class="voter" key={voter.peerId} onClick={() => onpeer?.(voter.peerId)}>
                  <Avatar peerId={voter.peerId} title={voter.title} size={24} />
                  <span>{voter.title}</span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <footer><button onClick={onclose}>Close</button></footer>
      </div>
    </div>
  );
}
