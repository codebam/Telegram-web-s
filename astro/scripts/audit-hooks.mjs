/*
 * Audit: hooks called from inside a callback.
 *
 * Preact keys hook state by call position within a component, so a `useXxx()`
 * that only runs conditionally, or once per item of a rendered list, is
 * mis-associated with whatever ran at that position on the previous render —
 * refs and effect deps end up attached to the wrong element. Nothing catches it:
 * it type-checks, it builds, and the page renders.
 *
 * The check is a heuristic on indentation: a hook call nested deeper than the
 * component body's own statements is inside a callback (an arrow function passed
 * to `.map()`, a handler, a promise continuation). Each finding is a review item,
 * not automatically an error — a hook inside a *file-local component* (the
 * `SharedCell` / `MessageRow` pattern used to give each list item its own hook
 * state) is exactly right, and only the ones whose enclosing callback is a
 * `.map()`/`.then()`/timer continuation are bugs. The script prints findings and
 * exits 0 unless `--strict` is passed.
 *
 *   node astro/scripts/audit-hooks.mjs
 */
import {readFileSync, readdirSync} from 'fs';
import {join, relative, resolve} from 'path';

const repoDir = resolve(import.meta.dirname, '../..');
const componentsDir = join(repoDir, 'astro/src/components');

// Hook calls from preact/hooks, @preact/signals and our own local helpers.
const HOOK = /\b(use(?:State|Effect|SignalEffect|Computed|Memo|Ref|Callback|Context|Reducer|LayoutEffect|Signal)|use[A-Z]\w*)\s*\(/;

function walk(dir) {
  const found = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) found.push(...walk(join(dir, entry.name)));
    else if(entry.name.endsWith('.tsx')) found.push(join(dir, entry.name));
  }

  return found;
}

/**
 * Indentation of the component's own statements: the shallowest hook call in the
 * file, which is the one sitting directly in a component body.
 */
function baselineIndent(lines) {
  let min = Infinity;
  for(const line of lines) {
    const trimmed = line.trim();
    if(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if(!HOOK.test(trimmed)) continue;
    const indent = line.length - line.trimStart().length;
    // A call at the very start of a line is a statement in a body; one that is
    // part of an assignment or a JSX attribute is still a body-level call.
    min = Math.min(min, indent);
  }

  return min === Infinity ? 0 : min;
}

const findings = [];

for(const file of walk(componentsDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const baseline = baselineIndent(lines);

  // A file-local component indents its hooks the same as the outer one, so the
  // signal is depth *relative* to the shallowest hook, plus being inside a
  // callback expression on an earlier line.
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if(!HOOK.test(trimmed)) return;
    if(/^import\b/.test(trimmed)) return;

    const indent = line.length - line.trimStart().length;
    if(indent <= baseline) return;

    // Look back for the callback that opened this block.
    for(let back = index - 1; back >= 0 && back > index - 40; back--) {
      const earlier = lines[back];
      if(/\.map\(|\.filter\(|\.forEach\(|\.then\(|\.catch\(|setTimeout\(|requestAnimationFrame\(/.test(earlier)) {
        findings.push({
          file: relative(repoDir, file),
          line: index + 1,
          opened: earlier.trim().slice(0, 80),
          call: trimmed.slice(0, 100)
        });
        break;
      }
    }
  });
}

if(!findings.length) {
  console.log('no hooks called from inside a callback');
  process.exit(0);
}

console.log(`${findings.length} hook call(s) inside a callback — each must be a component of its own, or a hook-free helper:\n`);

let lastFile = '';
for(const finding of findings) {
  if(finding.file !== lastFile) {
    console.log(finding.file);
    lastFile = finding.file;
  }

  console.log(`  ${String(finding.line).padStart(5)}  ${finding.call}`);
  console.log(`         inside: ${finding.opened}`);
}

process.exit(process.argv.includes('--strict') ? 1 : 0);
