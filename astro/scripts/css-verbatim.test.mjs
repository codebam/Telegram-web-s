/*
 * Every ported stylesheet is byte-identical to the Svelte original's `<style>` block.
 *
 * CONVERSION.md rule 1: the CSS is copied by `extract-style.mjs`, never retyped,
 * re-indented or "tidied". A hand-edited stylesheet is worse than a missing one —
 * it still builds, and the difference only shows up as a subtly wrong layout, or
 * as scoping that no longer matches what Svelte's compiler decided.
 *
 * This is the whole-directory version of that rule, so it covers components the
 * build does not compile yet as well.
 *
 * Migration-time only: it reads svelte/ and has nothing to check once that is gone.
 */
import {existsSync, readdirSync, readFileSync} from 'fs';
import {join, resolve} from 'path';
import {describe, expect, it} from 'vitest';

const repoDir = resolve(process.cwd());
const svelteDir = join(repoDir, 'svelte/src/lib/components');
const astroDir = join(repoDir, 'astro/src/components');

/** The `<style>` content of a .svelte file, or null when it has none. */
function styleOf(source) {
  return source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? null;
}

/**
 * App.css is the one exception: it is the port of the route component's style
 * block, not of a lib component's, and it was written out without the two-space
 * indentation the block carries inside `+page.svelte`.
 */
const FROM_ROUTE = {'App.css': join(repoDir, 'svelte/src/routes/+page.svelte')};

const sheets = readdirSync(astroDir, {recursive: true})
.filter((name) => String(name).endsWith('.css'))
.map(String)
.sort();

const stripIndent = (text) => text.split('\n').map((line) => line.trim()).join('\n').trim();

describe('ported stylesheets are verbatim', () => {
  it('found stylesheets to compare', () => {
    expect(sheets.length).toBeGreaterThan(0);
  });

  for(const sheet of sheets) {
    const original = FROM_ROUTE[sheet] ?? join(svelteDir, sheet.replace(/\.css$/, '.svelte'));

    it(sheet, () => {
      if(!existsSync(original)) {
        throw new Error(`no Svelte original for ${sheet} (looked for ${original})`);
      }

      const expected = styleOf(readFileSync(original, 'utf8'));
      expect(expected, `${original} has no <style> block`).not.toBeNull();

      const actual = readFileSync(join(astroDir, sheet), 'utf8');

      if(actual === expected) return;
      // The route's style block is indented inside the component; App.css was
      // written de-indented, which changes nothing a browser sees.
      if(FROM_ROUTE[sheet] && stripIndent(actual) === stripIndent(expected)) return;

      const expectedLines = expected.split('\n');
      const actualLines = actual.split('\n');
      const at = expectedLines.findIndex((line, i) => line !== actualLines[i]);
      throw new Error(
        `${sheet} differs from its Svelte original at line ${at + 1}\n` +
        `  svelte: ${JSON.stringify(expectedLines[at] ?? '<end>')}\n` +
        `  astro:  ${JSON.stringify(actualLines[at] ?? '<end>')}`
      );
    });
  }
});
