import {flushSync} from 'preact/compat';

/**
 * Waits for the DOM to reflect state written just before the call.
 *
 * This is the port of Svelte's `tick()`, and it exists for the same reason the
 * Svelte client called it: several places measure the DOM around a state change —
 * they read `scrollHeight`/`scrollTop`, add messages above the viewport, then
 * restore the scroll offset. Svelte applied its pending updates inside `tick()`;
 * Preact renders on a microtask, so reading straight after a signal write would
 * measure the previous frame.
 *
 * `flushSync` from `preact/compat` runs the pending render synchronously, which is
 * exactly the guarantee the callers need. It is followed by a microtask so the
 * function can be awaited, like the original.
 */
export async function tick(): Promise<void> {
  flushSync(() => {});
  await Promise.resolve();
}
