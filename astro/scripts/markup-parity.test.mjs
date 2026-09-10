/*
 * Markup parity: every class name the Svelte markup applied must still appear in
 * the ported Preact component.
 *
 * This is the other half of class-parity.test.mjs. That one checks that the
 * stylesheet selects nothing the markup lacks; this one checks that the markup
 * lost nothing the stylesheet (or app.css, or a sibling class) expected. A
 * dropped class is invisible everywhere else: the build passes, the CSS still
 * parses, the element renders — it is simply no longer styled, and for the
 * console-density and appearance hooks in src/app.css that means a broken theme
 * rather than a missing border.
 *
 * Class names are collected from `class="…"` attributes and `class:x` directives.
 * A `class={expression}` contributes nothing, because Svelte's own markup does not
 * spell out what it evaluates to either.
 *
 * Migration-time only: it reads svelte/ and has nothing to check once that is gone.
 */
import {existsSync, readFileSync, readdirSync} from 'fs';
import {join, resolve} from 'path';
import {describe, expect, it} from 'vitest';

const repoDir = resolve(process.cwd());
const svelteDir = join(repoDir, 'svelte/src/lib/components');
const astroDir = join(repoDir, 'astro/src/components');

/** Every .svelte file under svelte/, as paths relative to the components dir. */
function walk(dir, prefix = '') {
  const found = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) found.push(...walk(join(dir, entry.name), `${prefix}${entry.name}/`));
    else if(entry.name.endsWith('.svelte')) found.push(prefix + entry.name);
  }

  return found;
}

/** Class tokens the component's own markup applies literally. */
function markupClasses(source) {
  // The stylesheet is checked separately, and it is where most class text is.
  const markup = source.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  const names = new Set();

  for(const match of markup.matchAll(/\sclass\s*=\s*"([^"]*)"/g)) {
    for(const token of match[1].split(/\s+/)) if(token) names.add(token);
  }

  for(const match of markup.matchAll(/\sclass:([\w-]+)/g)) {
    names.add(match[1]);
  }

  return names;
}

const files = walk(svelteDir).sort();
const ported = files.filter((file) => existsSync(join(astroDir, file.replace(/\.svelte$/, '.tsx'))));

describe('markup class parity', () => {
  it('has ported components to compare', () => {
    expect(ported.length).toBeGreaterThan(0);
  });

  for(const file of ported) {
    it(file, () => {
      const expected = markupClasses(readFileSync(join(svelteDir, file), 'utf8'));
      const markup = readFileSync(join(astroDir, file.replace(/\.svelte$/, '.tsx')), 'utf8');

      // A `/* port-pending */` file is a placeholder standing in for a component
      // that has not been ported yet; the marker disappears with the real port.
      if(/port-pending/.test(markup)) return;

      const missing = [...expected].filter((name) => !markup.includes(name)).sort();
      expect(missing, `class names dropped from ${file}`).toEqual([]);
    });
  }
});
