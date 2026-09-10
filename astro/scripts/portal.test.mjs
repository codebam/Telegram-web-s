/*
 * `<Portal>` is the port of Svelte's `use:portal` action and the only piece of
 * Astro/Preact plumbing the browser check cannot reach casually — Stories' viewer
 * and its sheets are behind clicks. If `preact/compat`'s `createPortal` did not
 * work with this build's Preact, the fullscreen viewer would silently render
 * inside the `backdrop-filter` sidebar instead of over the viewport, which is
 * exactly the bug the action existed to prevent.
 *
 * So the mechanism is asserted directly: children land in `document.body`, the
 * node the component itself renders stays empty, and unmounting takes the
 * portal's node back out.
 */
import {describe, expect, it} from 'vitest';
import {h, render} from 'preact';
import {Portal} from '../src/lib/portal.tsx';

describe('Portal', () => {
  it('renders its children into document.body, not in place', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(h(Portal, null, h('div', {class: 'viewer'}, 'story')), host);

    expect(host.querySelector('.viewer')).toBeNull();
    expect(document.body.querySelector('.viewer')).not.toBeNull();

    render(null, host);
    expect(document.body.querySelector('.viewer')).toBeNull();
  });

  it('keeps later siblings of the portal in place', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(h('div', null, [h(Portal, null, h('span', {class: 'portalled'}, 'x')), h('span', {class: 'sibling'}, 'y')]), host);

    expect(host.querySelector('.sibling')).not.toBeNull();
    expect(host.querySelector('.portalled')).toBeNull();
    expect(document.body.querySelector('.portalled')).not.toBeNull();

    render(null, host);
    expect(document.body.querySelector('.portalled')).toBeNull();
  });
});
