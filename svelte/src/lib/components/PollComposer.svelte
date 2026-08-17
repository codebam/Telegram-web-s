<script lang="ts">
  import {createPoll} from '$lib/telegram/messageTypes';

  let {
    peerId,
    threadId,
    replyToMsgId,
    onclose,
    onerror
  }: {
    peerId: number;
    threadId?: number;
    replyToMsgId?: number;
    onclose: () => void;
    onerror?: (message: string) => void;
  } = $props();

  let question = $state('');
  let options = $state(['', '']);
  let anonymous = $state(true);
  let multiple = $state(false);
  let quiz = $state(false);
  let correctIndex = $state(0);
  let explanation = $state('');
  let busy = $state(false);

  const filled = $derived(options.filter((option) => option.trim()).length);
  const valid = $derived(!!question.trim() && filled >= 2);

  function setOption(index: number, value: string) {
    options[index] = value;
    // Grow the form as it is filled, the way the official composer does.
    if (index === options.length - 1 && value.trim() && options.length < 10) options.push('');
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    options.splice(index, 1);
    if (correctIndex >= options.length) correctIndex = 0;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    try {
      await createPoll(
        peerId,
        {
          question,
          options,
          // A quiz always shows who voted, so the anonymous switch is ignored
          // there — matching what the API enforces.
          anonymous: quiz ? false : anonymous,
          multiple,
          quiz,
          correctIndex,
          explanation
        },
        {threadId, replyToMsgId}
      );
      onclose();
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not create the poll');
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <form class="dialog" onsubmit={submit} onclick={(e) => e.stopPropagation()}>
    <header>New poll</header>

    <input class="question" placeholder="Ask a question" bind:value={question} />

    <div class="options">
      {#each options as option, index (index)}
        <div class="option">
          {#if quiz}
            <input
              type="radio"
              name="correct"
              checked={correctIndex === index}
              onchange={() => (correctIndex = index)}
              aria-label="Correct answer {index + 1}"
            />
          {/if}
          <input
            placeholder="Option {index + 1}"
            value={option}
            oninput={(e) => setOption(index, (e.currentTarget as HTMLInputElement).value)}
          />
          {#if options.length > 2}
            <button type="button" class="remove" onclick={() => removeOption(index)} aria-label="Remove option">×</button>
          {/if}
        </div>
      {/each}
    </div>

    <label class="switch">
      <input type="checkbox" bind:checked={anonymous} disabled={quiz} />
      Anonymous voting
    </label>
    <label class="switch">
      <input type="checkbox" bind:checked={multiple} disabled={quiz} />
      Multiple answers
    </label>
    <label class="switch">
      <input type="checkbox" bind:checked={quiz} />
      Quiz mode
    </label>

    {#if quiz}
      <input class="explanation" placeholder="Explanation (optional)" bind:value={explanation} />
    {/if}

    <footer>
      <button type="button" onclick={onclose}>Cancel</button>
      <button type="submit" class="primary" disabled={!valid || busy}>
        {busy ? 'Sending…' : 'Create'}
      </button>
    </footer>
  </form>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 95;
  }

  .dialog {
    width: min(400px, calc(100vw - 32px));
    max-height: min(620px, calc(100vh - 48px));
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 18px;
    background: var(--bg-solid);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    color: var(--text);
  }

  header {
    font-weight: 600;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  input[type='text'],
  .question,
  .explanation,
  .option input:not([type='radio']) {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 14px;
  }

  input[type='radio'],
  .switch input {
    accent-color: var(--accent);
  }

  .switch {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-dim);
  }

  .remove {
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  footer button {
    padding: 8px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }

  footer .primary {
    color: var(--accent);
  }

  footer button:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
