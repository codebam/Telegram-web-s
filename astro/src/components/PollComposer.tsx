/*
 * Ported from svelte/src/lib/components/PollComposer.svelte.
 *
 * The one real change: `options` was `$state` and every edit mutated the array
 * in place (`options[index] = …`, `splice`, `push`). A signal only notifies on
 * assignment, so the same edits are made on a copy and assigned back — the
 * options list grows and shrinks exactly as it did.
 */
import {useComputed, useSignal} from '@preact/signals';

import {createPoll} from '$lib/telegram/messageTypes';

import './PollComposer.css';

interface Props {
  peerId: number;
  threadId?: number;
  replyToMsgId?: number;
  onclose: () => void;
  onerror?: (message: string) => void;
}

export function PollComposer({peerId, threadId, replyToMsgId, onclose, onerror}: Props) {
  const question = useSignal('');
  const options = useSignal(['', '']);
  const anonymous = useSignal(true);
  const multiple = useSignal(false);
  const quiz = useSignal(false);
  const correctIndex = useSignal(0);
  const explanation = useSignal('');
  const busy = useSignal(false);

  const filled = useComputed(() => options.value.filter((option) => option.trim()).length);
  const valid = useComputed(() => !!question.value.trim() && filled.value >= 2);

  function setOption(index: number, value: string) {
    const next = options.value.slice();
    next[index] = value;
    // Grow the form as it is filled, the way the official composer does.
    if(index === next.length - 1 && value.trim() && next.length < 10) next.push('');
    options.value = next;
  }

  function removeOption(index: number) {
    if(options.value.length <= 2) return;
    const next = options.value.slice();
    next.splice(index, 1);
    options.value = next;
    if(correctIndex.value >= next.length) correctIndex.value = 0;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if(!valid.value || busy.value) return;
    busy.value = true;
    try {
      await createPoll(
        peerId,
        {
          question: question.value,
          options: options.value,
          // A quiz always shows who voted, so the anonymous switch is ignored
          // there — matching what the API enforces.
          anonymous: quiz.value ? false : anonymous.value,
          multiple: multiple.value,
          quiz: quiz.value,
          correctIndex: correctIndex.value,
          explanation: explanation.value
        },
        {threadId, replyToMsgId}
      );
      onclose();
    } catch(err: any) {
      onerror?.(err?.message || err?.type || 'Could not create the poll');
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <form class="dialog" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <header>New poll</header>

        <input
          class="question"
          placeholder="Ask a question"
          value={question.value}
          onInput={(e) => (question.value = (e.target as HTMLInputElement).value)}
        />

        <div class="options">
          {options.value.map((option, index) => (
            <div class="option" key={index}>
              {quiz.value && (
                <input
                  type="radio"
                  name="correct"
                  checked={correctIndex.value === index}
                  onChange={() => (correctIndex.value = index)}
                  aria-label={`Correct answer ${index + 1}`}
                />
              )}
              <input
                placeholder={`Option ${index + 1}`}
                value={option}
                onInput={(e) => setOption(index, (e.currentTarget as HTMLInputElement).value)}
              />
              {options.value.length > 2 && (
                <button
                  type="button"
                  class="remove"
                  onClick={() => removeOption(index)}
                  aria-label="Remove option"
                >×</button>
              )}
            </div>
          ))}
        </div>

        <label class="switch">
          <input
            type="checkbox"
            checked={anonymous.value}
            disabled={quiz.value}
            onChange={(e) => (anonymous.value = (e.target as HTMLInputElement).checked)}
          />
          Anonymous voting
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked={multiple.value}
            disabled={quiz.value}
            onChange={(e) => (multiple.value = (e.target as HTMLInputElement).checked)}
          />
          Multiple answers
        </label>
        <label class="switch">
          <input
            type="checkbox"
            checked={quiz.value}
            onChange={(e) => (quiz.value = (e.target as HTMLInputElement).checked)}
          />
          Quiz mode
        </label>

        {quiz.value && (
          <input
            class="explanation"
            placeholder="Explanation (optional)"
            value={explanation.value}
            onInput={(e) => (explanation.value = (e.target as HTMLInputElement).value)}
          />
        )}

        <footer>
          <button type="button" onClick={onclose}>Cancel</button>
          <button type="submit" class="primary" disabled={!valid.value || busy.value}>
            {busy.value ? 'Sending…' : 'Create'}
          </button>
        </footer>
      </form>
    </div>
  );
}
