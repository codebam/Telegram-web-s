import {sveltekit} from '@sveltejs/kit/vite';
import solidPlugin from 'vite-plugin-solid';
import {defineConfig} from 'vite';
import {fileURLToPath} from 'url';
import {copyFileSync, existsSync} from 'fs';
import {execSync} from 'child_process';
import {resolve} from 'path';

// Repo root — the existing tweb sources (MTProto stack, managers, helpers) live
// in ../src and are consumed as-is by the Svelte client.
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const src = (p: string) => resolve(rootDir, 'src', p);

// src/langPackLocalVersion.ts is gitignored and generated from its .example
// counterpart by the root vite.config.ts. A clean checkout (CI) does not have
// it, and @config/app.ts imports it — so generate it here too.
if(!existsSync(src('langPackLocalVersion.ts'))) {
  copyFileSync(src('langPackLocalVersion.example.ts'), src('langPackLocalVersion.ts'));
}

// Mirrors the alias table in ../vite.config.ts. tweb's modules import each other
// through these, so they must resolve identically here.
const TWEB_ALIASES = {
  'solid-transition-group': src('vendor/solid-transition-group'),
  '@components': src('components'),
  '@helpers': src('helpers'),
  '@hooks': src('hooks'),
  '@stores': src('stores'),
  '@lib': src('lib'),
  '@appManagers': src('lib/appManagers'),
  '@richTextProcessor': src('lib/richTextProcessor'),
  '@environment': src('environment'),
  '@customEmoji': src('lib/customEmoji'),
  '@config': src('config'),
  '@vendor': src('vendor'),
  '@layer': src('layer'),
  '@types': src('types'),
  '@': src('')
};

// tweb ships its own patched Solid build in src/vendor/solid (see ../vite.config.ts).
// Vite 8 no longer sniffs aliased package formats, so point at the browser builds.
const SOLID_PATH = resolve(rootDir, 'src/vendor/solid');
const solidAliases = (isDev: boolean) => ({
  'rxcore': resolve(SOLID_PATH, 'web/core'),
  'solid-js/jsx-runtime': resolve(SOLID_PATH, 'dist', isDev ? 'dev.js' : 'solid.js'),
  'solid-js/html': resolve(SOLID_PATH, 'html/dist/html.js'),
  'solid-js/h': resolve(SOLID_PATH, 'h/dist/h.js'),
  'solid-js/web': resolve(SOLID_PATH, 'web/dist', isDev ? 'dev.js' : 'web.js'),
  'solid-js/store': resolve(SOLID_PATH, 'store/dist', isDev ? 'dev.js' : 'store.js'),
  'solid-js': resolve(SOLID_PATH, 'dist', isDev ? 'dev.js' : 'solid.js')
});

// Stamped into the bundle so the client can tell a new deployment from the
// build its browser has cached.
const BUILD_ID = new Date().toISOString();

// The commit this bundle was built from, so the running app can link to its own
// source. Anything unavailable (no git, no remote) degrades to '' and the link
// simply isn't rendered.
const git = (command: string) => {
  try {
    return execSync(command, {cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
  } catch {
    return '';
  }
};

const GIT_COMMIT = git('git rev-parse HEAD');
// git@github.com:owner/repo.git | https://github.com/owner/repo.git -> https://github.com/owner/repo
const GIT_REPO_URL = git('git config --get remote.origin.url')
.replace(/^git@([^:]+):/, 'https://$1/')
.replace(/^ssh:\/\/git@/, 'https://')
.replace(/\.git$/, '');

export default defineConfig(({command}) => ({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
    __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
    __GIT_REPO_URL__: JSON.stringify(GIT_REPO_URL)
  },
  // .env with VITE_API_ID / VITE_API_HASH / VITE_MTPROTO_* lives at the repo root.
  envDir: rootDir,
  plugins: [
    // tweb still ships .tsx (SolidJS) modules inside the shared lib layer; keep
    // the Solid transform for those files only so Svelte owns everything else.
    solidPlugin({include: [/\.[jt]sx$/]}),
    sveltekit()
  ],
  resolve: {
    alias: {
      ...solidAliases(command === 'serve'),
      ...TWEB_ALIASES
    }
  },
  worker: {
    format: 'es'
  },
  server: {
    port: 8081,
    // tweb's service worker is served from /@fs/… in dev; without this its scope
    // would be limited to that prefix and registration fails.
    headers: {'Service-Worker-Allowed': '/'},
    fs: {
      // ../src is outside the SvelteKit project root.
      allow: [rootDir]
    }
  }
}));
