/*
 * `$lib/tick` is the port of Svelte's `tick()` and several places depend on its
 * guarantee: write state, await it, then measure the DOM (scroll positions when
 * messages are prepended). If it did not actually flush the pending render, those
 * callers would measure the previous frame and the thread would jump — a bug that
 * only shows up as a scroll glitch in a real browser.
 *
 * So the guarantee is asserted here: a signal write must be visible in the DOM by
 * the time `tick()` resolves.
 */
import {describe, expect, it} from 'vitest';
import {h, render} from 'preact';
import {signal} from '@preact/signals';
import {tick} from '../src/lib/tick.ts';

describe('tick', () => {
  it('applies a pending signal write to the DOM before it resolves', async() => {
    const count = signal(1);
    const host = document.createElement('div');
    document.body.appendChild(host);

    const App = () => h('span', null, count.value);
    render(h(App, null), host);
    expect(host.textContent).toBe('1');

    count.value = 41;
    await tick();

    expect(host.textContent).toBe('41');
    render(null, host);
  });

  it('resolves even when nothing is pending', async() => {
    await expect(tick()).resolves.toBeUndefined();
  });
});
