/*
 * Type-checks the Astro app and fails only on errors in the app's own files.
 *
 * The program necessarily includes tweb's `../src/**`: the client imports its
 * managers directly, and a manager's imports are part of the program. Two things
 * make that noise rather than signal:
 *
 *  - tweb's `.tsx` is SolidJS, and a tsconfig has one `jsxImportSource` for the
 *    whole program, so those files are checked against Preact's JSX types;
 *  - tweb already reports pre-existing errors under the root `pnpm typecheck`.
 *
 * Neither is this app's to fix, so only `src/**` (this project's own sources) is
 * gated. Run it with `--verbose` to see the full tsc output.
 */
import {spawnSync} from 'child_process';
import {fileURLToPath} from 'url';

const appDir = fileURLToPath(new URL('..', import.meta.url));

// `astro sync` generates .astro/types.d.ts, which the tsconfig includes.
const sync = spawnSync('npx', ['astro', 'sync'], {cwd: appDir, encoding: 'utf8'});
if(sync.status !== 0) {
  process.stdout.write(sync.stdout ?? '');
  process.stderr.write(sync.stderr ?? '');
  process.exit(sync.status ?? 1);
}

const result = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {cwd: appDir, encoding: 'utf8'});
const output = (result.stdout ?? '') + (result.stderr ?? '');
const lines = output.split('\n').filter(Boolean);

// Paths are relative to astro/, so the app's own files start with `src/`.
const ours = lines.filter((line) => /^src\//.test(line));
const theirs = lines.length - ours.length;

if(process.argv.includes('--verbose')) {
  process.stdout.write(output);
  console.log(`\n${ours.length} error(s) in astro/src, ${theirs} in ../src (not gated)`);
} else if(ours.length) {
  console.log(ours.join('\n'));
  console.log(`\n${ours.length} error(s) in astro/src (${theirs} in ../src — run with --verbose to see them)`);
} else {
  console.log(`astro/src type-checks clean (${theirs} pre-existing error(s) in ../src, not gated)`);
}

process.exit(ours.length ? 1 : 0);
