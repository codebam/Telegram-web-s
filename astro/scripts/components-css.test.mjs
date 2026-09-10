/*
 * Invariants for the ported component stylesheets.
 *
 * The Astro build only compiles what the page can reach, so a component nothing
 * imports yet is not compiled at all — and a stylesheet is only processed once its
 * component is. These checks cover the whole directory instead, and they encode
 * the two failures that are otherwise silent:
 *
 *  1. a stylesheet that no longer parses (PostCSS throws here; the browser would
 *     quietly drop the rule);
 *  2. a rule that lost its scope token, which makes a component's styles global —
 *     the failure mode Svelte's compiler existed to prevent.
 *
 * A compound the author wrote inside `:global(…)` is *meant* to stay unscoped
 * (`.animated :global(canvas)` reaches the canvas tweb's lottie player injects),
 * so a rule only has to carry a token if the original had a compound outside
 * `:global(…)`. The original and the transformed sheet are walked in the same
 * order, so the two can be compared rule by rule.
 */
import {readFileSync, readdirSync} from 'fs';
import {join, resolve} from 'path';
import postcss from 'postcss';
import {describe, expect, it} from 'vitest';
import {scopeCssPlugin} from './scope-css.mjs';

// Vitest resolves this module through a virtual URL, so the directory comes from
// the repo root the tests run in rather than from import.meta.url.
const componentsDir = resolve(process.cwd(), 'astro/src/components');
const files = readdirSync(componentsDir, {recursive: true})
.filter((name) => String(name).endsWith('.css'))
.map(String)
.sort();

/** The selectors of a stylesheet, in document order, keyframes excluded. */
function selectorsOf(css) {
  const selectors = [];

  postcss.parse(css).walkRules((rule) => {
    for(let parent = rule.parent; parent; parent = parent.parent) {
      if(parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
    }

    selectors.push(rule.selector);
  });

  return selectors;
}

/**
 * True when a selector has any compound the author did not mark `:global(…)`.
 *
 * The `:global(…)` groups are removed per comma-separated complex selector, and
 * what is left is checked for anything that would need a scope token. A whole
 * list of `:global(…)` selectors — `:global(.a input), :global(.a textarea)` —
 * is therefore correctly "nothing to scope"; only the leftover commas of a naive
 * strip-and-split would look like a compound.
 */
function hasScopableCompound(selector) {
  return selector.split(',').some((complex) => {
    const withoutGlobals = complex.replace(/:global\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, ' ');
    return /[^\s>+~]/.test(withoutGlobals);
  });
}

describe('component stylesheets', () => {
  it('found the stylesheets to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for(const file of files) {
    it(`${file} parses and is scoped where it should be`, async() => {
      const source = readFileSync(join(componentsDir, file), 'utf8');
      const {css} = await postcss([scopeCssPlugin(componentsDir)])
      .process(source, {from: join(componentsDir, file)});

      const before = selectorsOf(source);
      const after = selectorsOf(css);

      expect(after.length, `rule count changed in ${file}`).toBe(before.length);

      const unscoped = before
      .map((selector, i) => ({selector: after[i], original: selector}))
      .filter(({original, selector}) => hasScopableCompound(original) && !/data-ws=/.test(selector))
      .map(({original}) => original);

      expect(unscoped, `rules that lost their scope token in ${file}`).toEqual([]);
    });
  }
});
