/*
 * Text parity: the user-visible strings of a Svelte component must survive the
 * port.
 *
 * Handlers and classes are covered by the other guards, but nothing so far checks
 * that the *content* came across: a dropped label, a trimmed error message, a
 * placeholder lost with a rewritten attribute. Those are the failures a user
 * actually notices, and they are invisible to the type checker.
 *
 * Collected from the markup (script and style stripped): text nodes with at least
 * one letter, and the values of `placeholder`, `aria-label`, `title` and `alt`.
 * Each must appear literally in the ported `.tsx`. An expression (`{…}`) is not
 * text and is skipped — the original does not spell out what it renders either.
 *
 * Migration-time only: it reads svelte/, and has nothing to check once that is gone.
 */
import {existsSync, readFileSync, readdirSync} from 'fs';
import {join, resolve} from 'path';
import {describe, expect, it} from 'vitest';

const repoDir = resolve(process.cwd());
const svelteDir = join(repoDir, 'svelte/src/lib/components');
const astroDir = join(repoDir, 'astro/src/components');

function walk(dir, prefix = '') {
  const found = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) found.push(...walk(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if(entry.name.endsWith('.svelte')) found.push(prefix + entry.name);
  }

  return found;
}

/** Strings a user can read, as written in the Svelte markup. */
function visibleStrings(source) {
  const markup = source
  .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');

  const strings = new Set();

  // Text nodes: what sits between a `>` and the next `<`. Anything holding a brace
  // is Svelte syntax or an interpolation (`{#if …}`, `We sent {n}`) rather than a
  // literal string, so it is not compared.
  for(const match of markup.matchAll(/>([^<>]+)</g)) {
    const text = match[1].trim();
    if(text.length < 2 || !/\p{L}/u.test(text) || /[{}]/.test(text)) continue;
    strings.add(text);
  }

  for(const attribute of ['placeholder', 'aria-label', 'title', 'alt']) {
    for(const match of markup.matchAll(new RegExp(`\\s${attribute}="([^"]+)"`, 'g'))) {
      const value = match[1].trim();
      if(value.length >= 2 && /\p{L}/u.test(value) && !value.includes('{')) strings.add(value);
    }
  }

  return strings;
}

const files = walk(svelteDir).sort();
const ported = files.filter((file) => existsSync(join(astroDir, file.replace(/\.svelte$/, '.tsx'))));

/*
 * JSX collapses a multi-line text node to single spaces, the same way Svelte's
 * compiler does, so both sides are compared with their whitespace normalised —
 * otherwise every wrapped sentence in the source reads as "dropped".
 */
const normalize = (text) => text.replace(/\s+/g, ' ');

describe('user-visible text parity', () => {
  it('has ported components to compare', () => {
    expect(ported.length).toBeGreaterThan(0);
  });

  for(const file of ported) {
    it(file, () => {
      const expected = visibleStrings(readFileSync(join(svelteDir, file), 'utf8'));
      const markup = readFileSync(join(astroDir, file.replace(/\.svelte$/, '.tsx')), 'utf8');

      if(/port-pending/.test(markup)) return;

      const flattened = normalize(markup);
      const missing = [...expected]
      .filter((text) => !flattened.includes(normalize(text)))
      .sort();

      expect(missing, `user-visible text dropped from ${file}`).toEqual([]);
    });
  }
});
