import {sveltekit} from '@sveltejs/kit/vite';
import solidPlugin from 'vite-plugin-solid';
import {defineConfig} from 'vite';
import {fileURLToPath} from 'url';
import {resolve} from 'path';

// Repo root — the existing tweb sources (MTProto stack, managers, helpers) live
// in ../src and are consumed as-is by the Svelte client.
const rootDir = fileURLToPath(new URL('..', import.meta.url));
const src = (p: string) => resolve(rootDir, 'src', p);

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

export default defineConfig(({command}) => ({
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
