import adapter from '@sveltejs/adapter-static';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // The client is a pure SPA: every route renders in the browser on top of
    // tweb's MTProto worker stack, so there is nothing to prerender.
    adapter: adapter({fallback: 'index.html', strict: false}),
    // Mirrors the alias table in vite.config.ts so the generated tsconfig knows
    // about tweb's own module aliases too.
    alias: {
      '@components/*': '../src/components/*',
      '@helpers/*': '../src/helpers/*',
      '@hooks/*': '../src/hooks/*',
      '@stores/*': '../src/stores/*',
      '@lib/*': '../src/lib/*',
      '@appManagers/*': '../src/lib/appManagers/*',
      '@richTextProcessor/*': '../src/lib/richTextProcessor/*',
      '@environment/*': '../src/environment/*',
      '@customEmoji/*': '../src/lib/customEmoji/*',
      '@config/*': '../src/config/*',
      '@vendor/*': '../src/vendor/*',
      '@layer': '../src/layer',
      '@types': '../src/types',
      '@/*': '../src/*'
    }
  }
};
