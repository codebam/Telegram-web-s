/*
 * The JSX half of the scoping scheme described in scope-id.mjs: stamp every host
 * element of a component file with `data-ws="<component>"`, so the matching
 * `[data-ws='<component>']` that postcss-plugin-scope-css.mjs appends to that
 * component's selectors can only ever match that component's own markup.
 *
 * Two deliberate exclusions:
 *  - Capitalised names are component usages (`<Avatar class="row" />`), not host
 *    elements. Svelte did not scope a class a parent passed down either, and
 *    stamping one here would let the parent's rules reach into the child.
 *  - Elements the tweb layer builds itself (custom emoji, lottie, cropper) never
 *    pass through this file, so they stay unscoped — which is exactly what the
 *    `:global(…)` selectors in the ported stylesheets are there for.
 */
import {SCOPE_ATTR, isClientComponent, scopeFor} from './scope-id.mjs';

export default function scopeJsx({componentsDir}) {
  return function scopeJsxPlugin({types: t}) {
    return {
      name: 'web-s-scope-jsx',
      visitor: {
        JSXOpeningElement(path, state) {
          const filename = state.filename || state.file?.opts?.filename;
          if(!filename || !isClientComponent(filename, componentsDir)) return;

          const scope = scopeFor(filename);
          if(!scope) return;

          const {name, attributes} = path.node;
          // `<Avatar />`, `<Foo.Bar />`, `<></>` — none of these is a host element.
          if(name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name)) return;

          const stamped = attributes.some((attribute) =>
            attribute.type === 'JSXAttribute' && attribute.name?.name === SCOPE_ATTR);
          if(stamped) return;

          attributes.push(t.jsxAttribute(t.jsxIdentifier(SCOPE_ATTR), t.stringLiteral(scope)));
        }
      }
    };
  };
}
