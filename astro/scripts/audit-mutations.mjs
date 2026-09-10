/*
 * Audit: nested writes into signal-held objects.
 *
 * `signal()` is shallow, while Svelte's `$state` was a deep proxy. A ported
 * `messages.value[i].read = true` therefore notifies nobody, where the original
 * re-rendered every reader of that field — a silent regression that the type
 * checker, the build and the parity guards all accept (see CONVERSION.md §4).
 *
 * This script does not judge: it lists every nested write so a human can confirm
 * each one is either reassigned or genuinely read imperatively. Run it during the
 * port and again before calling the conversion done:
 *
 *   node astro/scripts/audit-mutations.mjs
 *
 * Exit code is 0 — findings are a review list, not a failure. A `--strict` run
 * exits non-zero when anything is found, for use once the list has been vetted.
 */
import {readFileSync, readdirSync} from 'fs';
import {join, relative, resolve} from 'path';

const repoDir = resolve(import.meta.dirname, '../..');
const componentsDir = join(repoDir, 'astro/src/components');

function walk(dir) {
  const found = [];
  for(const entry of readdirSync(dir, {withFileTypes: true})) {
    if(entry.isDirectory()) found.push(...walk(join(dir, entry.name)));
    else if(entry.name.endsWith('.tsx')) found.push(join(dir, entry.name));
  }

  return found;
}

// `x.value.field = …`, `x.value.list.push(…)`, `x.value.map.set(…)`, `x.value.a.b = …`
const NESTED_WRITE = /\b(\w+)\.value((?:\.[\w$]+)+)\s*(=[^=]|\+\+|--)/g;
const NESTED_CALL = /\b(\w+)\.value(\.[\w$]+)*\.(push|pop|splice|shift|unshift|sort|reverse|set|delete|add|clear)\s*\(/g;

const findings = [];

for(const file of walk(componentsDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // Comments describe the hazard more often than they commit it.
    if(trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

    for(const pattern of [NESTED_WRITE, NESTED_CALL]) {
      pattern.lastIndex = 0;
      let match;
      while((match = pattern.exec(line))) {
        findings.push({
          file: relative(repoDir, file),
          line: i + 1,
          text: trimmed.slice(0, 120)
        });
      }
    }
  });
}

if(!findings.length) {
  console.log('no nested writes into signal-held objects');
  process.exit(0);
}

console.log(`${findings.length} nested write(s) into signal-held values — confirm each is reassigned or read imperatively only:\n`);

let lastFile = '';
for(const finding of findings) {
  if(finding.file !== lastFile) {
    console.log(finding.file);
    lastFile = finding.file;
  }

  console.log(`  ${String(finding.line).padStart(5)}  ${finding.text}`);
}

process.exit(process.argv.includes('--strict') ? 1 : 0);
