/*
 * Migration-time check: does scripts/scope-css.mjs make the same scoping
 * decisions Svelte's compiler made for the client we are porting?
 *
 * It compiles each Svelte component's <style> with svelte/compiler, runs the same
 * stylesheet through the PostCSS plugin the build uses, and compares the two
 * selector by selector. Scope tokens are normalised on both sides — Svelte's
 * `.svelte-1a2b3c` and our `[data-ws='chat']` both become a marker — so only the
 * *decisions* are compared: which compound is scoped, and whether it got the
 * direct token or the zero-specificity `:where(…)` one.
 *
 * Two things Svelte does that this script deliberately does not treat as errors:
 *  - it comments out selectors matching nothing in the component's markup
 *    (`/* (unused) .row {...} *\/`), which the port keeps live — they cannot match
 *    anything either way, because scoping still confines them to this component;
 *  - it merges rules with identical selectors.
 *
 * Run it while svelte/ still exists:
 *   node astro/scripts/verify-scoping.mjs
 *
 * Delete it together with svelte/, it has nothing left to check afterwards.
 */
import {readdirSync, readFileSync} from 'fs';
import {join} from 'path';
import {compile} from 'svelte/compiler';
import {fileURLToPath} from 'url';
import postcss from 'postcss';
import {scopeCssPlugin} from './scope-css.mjs';

const repoDir = fileURLToPath(new URL('../..', import.meta.url));
const svelteComponents = join(repoDir, 'svelte/src/lib/components');
const clientComponents = join(repoDir, 'astro/src/components');

const DIRECT = /\.svelte-[a-z0-9]+|\[data-ws='[^']*'\]/g;
const WHERE = /:where\((?:\.svelte-[a-z0-9]+|\[data-ws='[^']*'\])\)/g;
const UNUSED = /\(unused\)/;

/** Split a selector into compounds, keeping `|` between them and combinators apart. */
function compounds(selector) {
  return selector
  .split(',')
  .map((complex) => complex.trim().split(/\s+/).filter((part) => part && !/^[>+~]$/.test(part)));
}

/**
 * `marker + the compound's simple selectors, sorted` — so the position of the
 * scope token inside a compound or the order of `.a.b` does not matter, but
 * whether a compound is scoped at all, and how, does.
 */
function normalize(selector) {

  return compounds(selector.replace(/\s*\/\*[\s\S]*?\*\/\s*/g, ' '))
  .map((compound) => {
    const text = compound.join(' ');
    const direct = DIRECT.test(text);
    const where = WHERE.test(text);
    DIRECT.lastIndex = 0;
    WHERE.lastIndex = 0;

    const parts = text
    .replace(WHERE, ':where()')
    .replace(DIRECT, '')
    .split(/(?=[:[.])/)
    .filter(Boolean)
    .sort();

    return (direct ? '+D' : where ? '+W' : '-') + parts.join('');
  })
  .join('|');
}

/** Selectors the compiled stylesheet actually applies, and the ones it disabled. */
function readSelectors(css) {
  const used = [];
  const unused = [];
  const root = postcss.parse(css);

  root.walkAtRules((atRule) => {
    if(/keyframes$/i.test(atRule.name)) atRule.walkRules(() => {});
  });

  root.walkRules((rule) => {
    let selector = rule.selector;
    let keyframes = false;
    for(let parent = rule.parent; parent; parent = parent.parent) {
      if(parent.type === 'atrule' && /keyframes$/i.test(parent.name)) keyframes = true;
    }

    if(keyframes) return;

    // Svelte disables a dead selector in place, keeping it as a comment inside
    // the selector list: `/* (unused) input[type='text'],*/ input[type='radio']…`
    for(const comment of selector.match(/\/\*[\s\S]*?\*\//g) ?? []) {
      if(UNUSED.test(comment)) {
        unused.push(...comment.replace(/\/\*|\*\//g, '').replace('(unused)', '').split(',').map((s) => s.trim()).filter(Boolean));
      }
    }

    selector = selector.replace(/\s*\/\*[\s\S]*?\*\/\s*/g, ' ').trim();
    if(selector) used.push(...selector.split(',').map((s) => s.trim()).filter(Boolean));
  });

  // Whole rules that were commented out entirely.
  root.walkComments((comment) => {
    if(!UNUSED.test(comment.text)) return;
    for(const match of comment.text.replace('(unused)', '').matchAll(/([^{}]+)\{/g)) {
      const selector = match[1].trim();
      if(selector) unused.push(...selector.split(',').map((s) => s.trim()).filter(Boolean));
    }
  });

  return {used, unused};
}

const plugin = scopeCssPlugin(clientComponents);
let compared = 0;
let unusedTotal = 0;
const mismatched = [];

for(const file of readdirSync(svelteComponents).filter((name) => name.endsWith('.svelte')).sort()) {
  const source = readFileSync(join(svelteComponents, file), 'utf8');
  const style = source.match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1];
  if(!style?.trim()) continue;

  const {css} = compile(source, {filename: file, css: 'external', generate: 'client'});
  const expected = readSelectors(css?.code ?? '');
  // The plugin decides whether to scope by the file it is given, so hand it the
  // path the ported component will have.
  const ported = await postcss([plugin]).process(style, {from: join(clientComponents, file.replace(/\.svelte$/, '.tsx'))});
  const actual = readSelectors(ported.css);

  compared++;
  unusedTotal += expected.unused.length;

  const expectedSet = new Map(expected.used.map((selector) => [normalize(selector), selector]));
  const actualSet = new Map(actual.used.map((selector) => [normalize(selector), selector]));

  const missing = [...expectedSet].filter(([key]) => !actualSet.has(key)).map(([, selector]) => selector);
  const extra = [...actualSet].filter(([key]) => !expectedSet.has(key)).map(([, selector]) => selector);

  if(missing.length || extra.length) {
    mismatched.push({file, missing, extra});
  }
}

console.log(`compared ${compared} component stylesheets; ${unusedTotal} dead selectors Svelte had disabled`);
if(mismatched.length) {
  console.log(`\n${mismatched.length} stylesheet(s) differ:\n`);
  for(const {file, missing, extra} of mismatched) {
    console.log(file);
    for(const selector of missing.slice(0, 6)) console.log(`  Svelte applies, we do not: ${selector}`);
    for(const selector of extra.slice(0, 6)) console.log(`  we apply, Svelte does not: ${selector}`);
    if(missing.length > 6 || extra.length > 6) console.log(`  … ${missing.length} missing, ${extra.length} extra`);
  }

  process.exitCode = 1;
} else {
  console.log('every live selector is scoped exactly as Svelte scoped it');
}
