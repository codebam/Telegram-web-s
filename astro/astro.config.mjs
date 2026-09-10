import {defineConfig} from 'astro/config';
import preact from '@astrojs/preact';
import solidPlugin from 'vite-plugin-solid';
import {loadEnv} from 'vite';
import {scopeJsxPlugin} from './scripts/vite-plugin-scope-jsx.mjs';
import {scopeCssPlugin} from './scripts/scope-css.mjs';
import {fileURLToPath} from 'url';
import {copyFileSync, existsSync} from 'fs';
import {execSync} from 'child_process';
import {resolve} from 'path';

// Repo root — tweb's MTProto stack, managers and helpers live in ../src and are
// consumed as-is, exactly as the SvelteKit client consumed them.
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const appDir = fileURLToPath(new URL('.', import.meta.url));
const src = (p) => resolve(rootDir, 'src', p);

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
const solidAliases = (isDev) => ({
  'rxcore': resolve(SOLID_PATH, 'web/core'),
  'solid-js/jsx-runtime': resolve(SOLID_PATH, 'dist', isDev ? 'dev.js' : 'solid.js'),
  'solid-js/html': resolve(SOLID_PATH, 'html/dist/html.js'),
  'solid-js/h': resolve(SOLID_PATH, 'h/dist/h.js'),
  'solid-js/web': resolve(SOLID_PATH, 'web/dist', isDev ? 'dev.js' : 'web.js'),
  'solid-js/store': resolve(SOLID_PATH, 'store/dist', isDev ? 'dev.js' : 'store.js'),
  'solid-js': resolve(SOLID_PATH, 'dist', isDev ? 'dev.js' : 'solid.js')
});

const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Two JSX frameworks share this build, and they must not touch each other's
 * files:
 *
 *  - astro/src/**  is the Preact client (this app). @preact/preset-vite owns
 *    its .tsx and compiles JSX against preact/jsx-runtime.
 *  - ../src/**     is tweb, whose UI is SolidJS. vite-plugin-solid owns those
 *    and compiles against src/vendor/solid. tweb's managers (which the Preact
 *    app imports directly) reach real Solid modules — apiManagerProxy imports
 *    solid-js's `batch` and @components/appNavigationController — so the Solid
 *    transform cannot simply be dropped.
 *
 * Both filters are absolute-path regexes rather than globs so they do not
 * depend on the directory the build is started from.
 */
const APP_JSX = [new RegExp('^' + escapeRe(resolve(appDir, 'src')) + '/.*\\.[cm]?[jt]sx$')];
const TWEB_JSX = [new RegExp('^' + escapeRe(resolve(rootDir, 'src')) + '/.*\\.[jt]sx$')];

// The Preact client's components, and the only files whose styles are scoped —
// see scripts/scope-id.mjs for why the scoping is done by build tooling.
const COMPONENTS_DIR = resolve(appDir, 'src/components');

// Stamped into the bundle so the client can tell a new deployment from the
// build its browser has cached.
const BUILD_ID = new Date().toISOString();

// The commit this bundle was built from, so the running app can link to its own
// source. Anything unavailable (no git, no remote) degrades to '' and the link
// simply isn't rendered.
const git = (command) => {
  try {
    return execSync(command, {cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
  } catch {
    return '';
  }
};

// CF_PAGES_* are the Cloudflare Pages build environment's own view of the
// deployment, and they are the fallback for a CI checkout with no usable .git.
const GIT_COMMIT = git('git rev-parse HEAD') || process.env.CF_PAGES_COMMIT_SHA || '';

// git@github.com:owner/repo.git | https://github.com/owner/repo.git -> https://github.com/owner/repo
//
// The credential strip is not cosmetic: a CI checkout's origin carries the
// token it cloned with (Cloudflare Pages uses
// https://x-access-token:ghs_…@github.com/…), and this URL is compiled into a
// bundle served to the public. Never emit the userinfo half of a remote.
const GIT_REPO_URL = (() => {
  const remote = (git('git config --get remote.origin.url') || process.env.REPO_URL || '')
  .replace(/^git@([^:]+):/, 'https://$1/')
  .replace(/^ssh:\/\/git@/, 'https://')
  .replace(/^(https?:\/\/)[^/@]*@/, '$1')
  .replace(/\.git$/, '');

  // Whatever survived must be a bare https origin with no credentials left in
  // it; anything else is dropped rather than shipped.
  return /^https:\/\/[^/@\s]+\/[^@\s]+$/.test(remote) ? remote : '';
})();

const isDev = process.env.NODE_ENV === 'development';

/**
 * The API credentials are compiled into the bundle, and a build without them does
 * not fail — it publishes a client that cannot connect to Telegram at all, which
 * is what a missing `VITE_API_ID` looked like the first time here (the symptom was
 * a worker dying on a null transport, hours away from the cause). So a production
 * build refuses to run without them. Vite's `loadEnv` reads `.env` at the repo
 * root and also picks the variables up from the process environment, which is how
 * they reach a Cloudflare Pages build (the project's environment variables).
 */
function requireCredentials() {
  return {
    name: 'web-s-require-credentials',
    configResolved(config) {
      if(config.command !== 'build') return;

      const env = loadEnv(config.mode, rootDir, 'VITE_');
      const missing = ['VITE_API_ID', 'VITE_API_HASH'].filter((key) => !env[key]);
      if(missing.length) {
        throw new Error(
          `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set. ` +
          'The client would be built without Telegram credentials and could never connect. ' +
          'Set them in the repo-root .env, or as environment variables on the build (Cloudflare Pages → Settings → Environment variables).'
        );
      }
    }
  };
}

export default defineConfig({
  site: 'https://tgws.codebam.ca',
  // A static SPA: every route is the same client, so there is exactly one page
  // and it is prerendered. Islands do the rest in the browser.
  output: 'static',
  srcDir: './src',
  publicDir: './public',
  outDir: './dist',
  server: {
    // 8081 is taken by another project's dev server on this machine.
    port: 8082,
    /*
     * tweb's service worker is served from an fs path in dev (`/@fs/...`), so its
     * scope would default to that prefix and registration fails — and with no
     * controlling worker the client's service-message port is never attached, so
     * every boot call stays pending forever and the app sits on "Connecting…".
     * Astro runs its own dev server, so this has to be said here as well as on the
     * Vite server below.
     */
    headers: {'Service-Worker-Allowed': '/'}
  },
  integrations: [
    /*
     * No `babel` options on purpose: passing any switches the integration's JSX
     * transform to Babel, which breaks in dev (see vite-plugin-scope-jsx.mjs).
     * The `data-ws` stamping that used to ride along with it is its own plugin.
     */
    preact({include: APP_JSX})
  ],
  vite: {
    // .env with VITE_API_ID / VITE_API_HASH / VITE_MTPROTO_* lives at the repo root.
    envDir: rootDir,
    /*
     * Astro only exposes `PUBLIC_`-prefixed variables to `import.meta.env` by
     * default, so every `VITE_*` one — the API id and hash, the DC and transport
     * flags — compiled to `undefined`. The MTProto worker then built its
     * connection with no credentials and died inside `sendPlainRequest` on a null
     * transport, which surfaces as "Cannot read properties of null (reading
     * 'send')" the moment you submit a phone number. These names are shared with
     * the tweb build and the SvelteKit client, so both prefixes are enabled
     * rather than renaming the file.
     */
    envPrefix: ['VITE_', 'PUBLIC_'],
    css: {
      postcss: {plugins: [scopeCssPlugin(COMPONENTS_DIR)]}
    },
    define: {
      __BUILD_ID__: JSON.stringify(BUILD_ID),
      __GIT_COMMIT__: JSON.stringify(GIT_COMMIT),
      __GIT_REPO_URL__: JSON.stringify(GIT_REPO_URL)
    },
    plugins: [requireCredentials(), scopeJsxPlugin({componentsDir: COMPONENTS_DIR}), solidPlugin({include: TWEB_JSX})],
    resolve: {
      alias: {
        // The app's own lib, under the name the ported tweb wrappers already
        // import it by ($lib/telegram/...).
        $lib: resolve(appDir, 'src/lib'),
        ...solidAliases(isDev),
        ...TWEB_ALIASES
      }
    },
    worker: {
      format: 'es'
    },
    /*
     * Pre-bundle the Preact runtime explicitly. Without it the dev server's
     * optimizer rewrites the island's `@preact/signals` import to
     * `/node_modules/.vite/deps/@preact_signals.js` but emits the chunk under a
     * nested-dependency name (`@astrojs_preact_n_@preact_signals.js`), so the
     * browser 404s that import and the island never hydrates — the page sits on
     * the prerendered splash forever. Naming them here pins the chunk names.
     */
    optimizeDeps: {
      include: ['preact', 'preact/hooks', 'preact/jsx-runtime', 'preact/compat', '@preact/signals']
    },
    /*
     * The `resolve.noExternal` overrides that used to sit here are gone: they only
     * existed to work around `@astrojs/preact`'s renderer importing the virtual
     * module `astro:preact:opts`, which Astro externalises and Node then cannot
     * resolve (see patches/@astrojs__preact@6.0.5.patch). The patch removes that
     * import, so the renderer loads normally in the dev server and in the static
     * build, and neither environment needs to bundle its dependencies.
     */
    server: {
      port: 8082,
      // tweb's service worker is served from an fs path in dev; without this its
      // scope would be limited to that prefix and registration fails.
      headers: {'Service-Worker-Allowed': '/'},
      fs: {
        // ../src is outside the Astro project root.
        allow: [rootDir]
      }
    }
  }
});
