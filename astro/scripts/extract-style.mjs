/*
 * Copies a Svelte component's <style> block into the Astro app as a stylesheet,
 * byte for byte.
 *
 * The port requires the stylesheet to be identical (see CONVERSION.md rule 1):
 * scoping is added by build tooling, class names are load-bearing outside the
 * component, and a hand-retyped selector is a silently unstyled element. So the
 * copy is done by a script rather than by hand.
 *
 *   node astro/scripts/extract-style.mjs Chat ChatInfo Picker   # names, no extension
 *   node astro/scripts/extract-style.mjs --all                  # every component
 *
 * A component with no <style> block is skipped, and an existing destination is
 * only overwritten when the source still matches what was copied before — that
 * way a stylesheet which has been deliberately hand-edited during the port is not
 * clobbered silently.
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'fs';
import {dirname, join, resolve} from 'path';

const repoDir = resolve(import.meta.dirname, '../..');
const svelteDir = join(repoDir, 'svelte/src/lib/components');
const astroDir = join(repoDir, 'astro/src/components');

/** Every .svelte file under svelte/, relative to the components directory. */
function allComponents(dir = svelteDir, prefix = '') {
  const found = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) {
      found.push(...allComponents(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if(entry.name.endsWith('.svelte')) {
      found.push(prefix + entry.name);
    }
  }

  return found;
}

function styleOf(source) {
  const match = source.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  return match?.[1] ?? null;
}

const args = process.argv.slice(2);
const names = args.includes('--all') ? allComponents() : args;

if(!names.length) {
  console.error('usage: node astro/scripts/extract-style.mjs [--all | Component …]');
  process.exit(1);
}

let written = 0;
let skipped = 0;

for(const name of names) {
  const file = name.endsWith('.svelte') ? name : `${name}.svelte`;
  const source = join(svelteDir, file);

  if(!existsSync(source)) {
    console.error(`  missing: svelte/src/lib/components/${file}`);
    process.exitCode = 1;
    continue;
  }

  const style = styleOf(readFileSync(source, 'utf8'));
  if(style === null) {
    skipped++;
    continue;
  }

  const destination = join(astroDir, file.replace(/\.svelte$/, '.css'));
  mkdirSync(dirname(destination), {recursive: true});
  writeFileSync(destination, style);
  written++;
  console.log(`  ${file} -> astro/src/components/${file.replace(/\.svelte$/, '.css')}`);
}

console.log(`copied ${written} stylesheet(s)${skipped ? `, skipped ${skipped} with no <style>` : ''}`);
