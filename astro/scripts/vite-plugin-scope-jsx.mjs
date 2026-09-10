/*
 * Vite wrapper around the `data-ws` stamping in babel-plugin-scope-jsx.mjs.
 *
 * It has to be its own plugin rather than a Babel plugin passed to
 * `@astrojs/preact`, for one reason: passing any `babel` options to that
 * integration switches its JSX transform from esbuild/oxc to Babel, and it picks
 * `@babel/plugin-transform-react-jsx-development` outside production — which
 * calls `path.scope.buildUndefinedNode()`, an API @babel/core 8 removed. The dev
 * server then answers every component with a 500 and the island never hydrates,
 * while the production build keeps working because it uses the non-development
 * plugin. (Reported upstream; a version bump of the integration will fix it.)
 *
 * Keeping Babel out of the JSX conversion means this transform only mutates the
 * AST — attributes are added and the code is re-printed with its JSX intact — and
 * esbuild or oxc performs the actual JSX transform afterwards, exactly as it does
 * for components the plugin does not touch.
 */
import {transformAsync} from '@babel/core';
import scopeJsx from './babel-plugin-scope-jsx.mjs';
import {isClientComponent} from './scope-id.mjs';

const JSX = /\.[cm]?[jt]sx$/;

export function scopeJsxPlugin({componentsDir}) {
  return {
    name: 'web-s-scope-jsx',
    enforce: 'pre',

    async transform(code, id) {
      const filename = id.split('?')[0];
      if(!JSX.test(filename) || !isClientComponent(filename, componentsDir)) return null;

      const result = await transformAsync(code, {
        filename,
        babelrc: false,
        configFile: false,
        ast: false,
        sourceMaps: true,
        plugins: [scopeJsx({componentsDir})],
        parserOpts: {plugins: ['jsx', 'typescript']}
      });

      return {code: result.code, map: result.map};
    }
  };
}

export default scopeJsxPlugin;
