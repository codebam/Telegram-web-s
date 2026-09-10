/*
 * Guards the selector rewrite that stands in for Svelte's compiler (see
 * scripts/scope-id.mjs). The cases below are the shapes the ported stylesheets
 * actually contain — pseudo-elements, `:not(…)`/`:has(…)`, attribute selectors,
 * comma lists, `@keyframes` steps and the `:global(:root[…])` overrides in
 * Chat.svelte that deliberately outrank the component's own rules.
 *
 * scripts/verify-scoping.mjs checks the same transform against the real Svelte
 * compiler over all 83 stylesheets; this file is the fast, permanent version of
 * that check and stays useful once svelte/ is gone.
 */
import {describe, expect, it} from 'vitest';
import postcss from 'postcss';
import {scopeCssPlugin, scopeSelector} from './scope-css.mjs';

const COMPONENTS = '/repo/astro/src/components';

describe('scopeSelector', () => {
  const cases = [
    ['.bubble', "chat", ".bubble[data-ws='chat']"],
    ['.line.out', "chat", ".line.out[data-ws='chat']"],
    ['.bubble::before', "chat", ".bubble[data-ws='chat']::before"],
    ['.row:not(:last-child)', "x", ".row[data-ws='x']:not(:last-child)"],
    ['.a:has(> .b)', "x", ".a[data-ws='x']:has(> .b)"],
    ['*', "x", "*[data-ws='x']"],
    // The token goes immediately before the first pseudo, so it stays valid CSS.
    ['input[type=\'tel\']:focus', "app", "input[type='tel'][data-ws='app']:focus"],
    ['.bubble, .bubble.out', "chat", ".bubble[data-ws='chat'], .bubble.out[data-ws='chat']"],

    /*
     * Only the first compound of a selector gets a real attribute; the rest get
     * it inside `:where()`, which has no specificity. That is what Svelte did, and
     * it is what keeps a rule's weight at "original + one class" — app.css is
     * written around those numbers (see its console-density block, which wins on
     * specificity alone).
     */
    ['.messages .line', "chat", ".messages[data-ws='chat'] .line:where([data-ws='chat'])"],
    ['.bubble:hover .stamp', "chat", ".bubble[data-ws='chat']:hover .stamp:where([data-ws='chat'])"],
    [
      '.a > .b + .c ~ .d',
      "x",
      ".a[data-ws='x'] > .b:where([data-ws='x']) + .c:where([data-ws='x']) ~ .d:where([data-ws='x'])"
    ],
    [
      'footer button:disabled',
      "chatadmin",
      "footer[data-ws='chatadmin'] button:where([data-ws='chatadmin']):disabled"
    ],

    // `:global(…)` covers only what is inside it. A leading global compound stays
    // unscoped, which leaves the compound after it as the first scoped one.
    [":global(:root[data-density='console']) .shell", "chat", ":root[data-density='console'] .shell[data-ws='chat']"],
    [":global(:root[data-density='console']) aside", "chat", ":root[data-density='console'] aside[data-ws='chat']"],
    [':global(.custom-emoji) canvas', "x", ".custom-emoji canvas[data-ws='x']"]
  ];

  for(const [input, scope, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      expect(scopeSelector(input, scope)).toBe(expected);
    });
  }
});

describe('scopeCssPlugin', () => {
  const css = `
@keyframes pulse {
  from {opacity: 0}
  40% {opacity: 0.4}
  to {opacity: 1}
}
.bubble {animation: pulse 1s}
@media (max-width: 600px) {
  .bubble::after {content: ''}
}
`;

  const run = (from) => postcss([scopeCssPlugin(COMPONENTS)]).process(css, {from});

  it('scopes a component stylesheet but leaves keyframes alone', async() => {
    const {css: out} = await run(COMPONENTS + '/Chat.css');
    expect(out).toContain('@keyframes pulse');
    expect(out).toContain('from {opacity: 0}');
    expect(out).toContain(".bubble[data-ws='chat']");
    expect(out).toContain(".bubble[data-ws='chat']::after");
  });

  it('leaves a list of entirely global selectors untouched', async() => {
    // ChatAdmin.css reaches tweb's own admin rows this way, one `:global(…)` per
    // comma-separated selector; nothing in such a list belongs to the component.
    const css = `:global(.admin-field input),\n:global(.admin-field textarea),\n:global(.admin-field select) {width: 100%}\n`;

    const {css: out} = await postcss([scopeCssPlugin(COMPONENTS)]).process(css, {from: COMPONENTS + '/ChatAdmin.css'});

    expect(out).not.toContain('data-ws');
    // The marker itself is Svelte syntax and is stripped; the selector survives
    // unscoped, which is what `:global(…)` asked for.
    expect(out).toContain('.admin-field input');
    expect(out).toContain('.admin-field textarea');
    expect(out).not.toContain(':global(');
  });

  it('scopes the scoped parts of a mixed list and leaves the global parts alone', async() => {
    const css = `:global(.admin-field input), .admin-row {width: 100%}\n`;

    const {css: out} = await postcss([scopeCssPlugin(COMPONENTS)]).process(css, {from: COMPONENTS + '/ChatAdmin.css'});

    expect(out).toContain('.admin-field input');
    expect(out).not.toContain(".admin-field input[data-ws");
    expect(out).toContain(".admin-row[data-ws='chat-admin']");
  });

  it('leaves everything outside the components directory untouched', async() => {
    const {css: out} = await run('/repo/astro/src/styles/app.css');
    expect(out).toBe(css);
  });
});
