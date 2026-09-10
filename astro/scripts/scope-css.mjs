/*
 * The CSS half of the scoping scheme described in scope-id.mjs: append
 * `[data-ws='<component>']` to every compound selector of a component's own
 * stylesheet, exactly where Svelte used to append its scope class.
 *
 * Rules that Svelte left alone are left alone here too:
 *  - `@keyframes` steps (`from`, `to`, `40%`) are not selectors;
 *  - a `:global(…)` compound is never scoped — and a *leading* `:global(…)`, as in
 *    `:global(:root[data-density='console']) .shell`, keeps only the trailing
 *    compound scoped, which is what Svelte's compiler emitted.
 *
 * The transform is deliberately total: it never throws on anything a browser
 * accepts, so a component with an unusual selector still builds.
 */
import postcss from 'postcss';
import {SCOPE_ATTR, isClientComponent, scopeFor} from './scope-id.mjs';

const OPENERS = {'(': ')', '[': ']'};
const CLOSERS = new Set([')', ']']);
const COMBINATORS = new Set(['>', '+', '~']);

/** Split on a top-level separator, ignoring anything inside (), [] or quotes. */
function splitTopLevel(input, separator) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;

  for(let i = 0; i < input.length; i++) {
    const char = input[i];

    if(quote) {
      if(char === '\\') i++;
      else if(char === quote) quote = '';
      continue;
    }

    if(char === '"' || char === "'") quote = char;
    else if(OPENERS[char]) depth++;
    else if(CLOSERS.has(char)) depth--;
    else if(char === separator && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(input.slice(start));
  return parts;
}

/** Index of the `)` matching the `(` at `open`. */
function matchParen(input, open) {
  let depth = 0;
  let quote = '';

  for(let i = open; i < input.length; i++) {
    const char = input[i];

    if(quote) {
      if(char === '\\') i++;
      else if(char === quote) quote = '';
      continue;
    }

    if(char === '"' || char === "'") quote = char;
    else if(char === '(') depth++;
    else if(char === ')') {
      depth--;
      if(depth === 0) return i;
    }
  }

  return -1;
}

/**
 * Split one complex selector into compounds, remembering which of them came out
 * of a `:global(…)` and must therefore stay unscoped.
 */
function expandCompounds(complex) {
  const segments = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if(buffer) segments.push({text: buffer, scoped: true});
    buffer = '';
  };

  while(i < complex.length) {
    if(complex.startsWith(':global(', i)) {
      const open = i + ':global'.length;
      const close = matchParen(complex, open);

      if(close === -1) {
        // Unbalanced — leave the rest of the selector as the author wrote it.
        buffer += complex.slice(i);
        break;
      }

      flush();
      segments.push({text: complex.slice(open + 1, close), scoped: false});
      i = close + 1;
    } else {
      buffer += complex[i];
      i++;
    }
  }

  flush();
  return segments;
}

/** Split a segment into compounds and the combinators between them. */
function splitCompounds(text) {
  const parts = [];
  let buffer = '';
  let depth = 0;
  let quote = '';

  const flush = () => {
    parts.push(buffer);
    buffer = '';
  };

  for(let i = 0; i < text.length; i++) {
    const char = text[i];

    if(quote) {
      buffer += char;
      if(char === '\\') buffer += text[++i] ?? '';
      else if(char === quote) quote = '';
      continue;
    }

    if(char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if(OPENERS[char]) {
      depth++;
      buffer += char;
    } else if(CLOSERS.has(char)) {
      depth--;
      buffer += char;
    } else if(depth === 0 && COMBINATORS.has(char)) {
      flush();
      parts.push(char);
    } else if(depth === 0 && /\s/.test(char)) {
      flush();
    } else {
      buffer += char;
    }
  }

  flush();
  return parts;
}

/**
 * Insert the scope token into a compound, before any pseudo — `.a::before` takes
 * `[data-ws]` as `.a[data-ws]::before`, since an attribute after a pseudo-element
 * is not a valid selector and the rule would be dropped.
 *
 * `first` picks the spelling, and that is not cosmetic. Svelte appended its scope
 * class to the first compound of a selector but only `:where(.svelte-x)` — zero
 * specificity — to the ones after it, so `.folders button` (0,1,1) compiled to
 * `.folders.svelte-x button:where(.svelte-x)` (0,2,1): the original specificity
 * plus exactly one class. Appending a real attribute everywhere would add one per
 * compound, and app.css is written around the numbers Svelte produced — it wins
 * some contests on specificity alone (see the console-density block).
 */
function scopeCompound(compound, scope, first) {
  const token = first ? `[${SCOPE_ATTR}='${scope}']` : `:where([${SCOPE_ATTR}='${scope}'])`;
  let depth = 0;
  let quote = '';

  for(let i = 0; i < compound.length; i++) {
    const char = compound[i];

    if(quote) {
      if(char === '\\') i++;
      else if(char === quote) quote = '';
      continue;
    }

    if(char === '"' || char === "'") quote = char;
    else if(OPENERS[char]) depth++;
    else if(CLOSERS.has(char)) depth--;
    else if(char === ':' && depth === 0) {
      return compound.slice(0, i) + token + compound.slice(i);
    }
  }

  return compound + token;
}

/** Rewrite one selector list. */
export function scopeSelector(selector, scope) {
  return splitTopLevel(selector, ',')
  .map((complex) => {
    // One direct token per complex selector; everything after it is `:where()`.
    let stamped = false;

    return expandCompounds(complex)
    .map((segment) => splitCompounds(segment.text)
    .map((part) => {
      const trimmed = part.trim();
      if(!trimmed) return '';
      if(COMBINATORS.has(trimmed)) return trimmed;
      if(!segment.scoped) return trimmed;

      const token = scopeCompound(trimmed, scope, !stamped);
      stamped = true;
      return token;
    })
    .filter(Boolean)
    .join(' '))
    .join(' ')
    .trim();
  })
  .join(', ');
}

/** True for rules that are steps of an animation rather than selectors. */
function insideKeyframes(rule) {
  for(let parent = rule.parent; parent; parent = parent.parent) {
    if(parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true;
  }

  return false;
}

/**
 * PostCSS plugin factory. It is registered for every stylesheet Vite handles and
 * decides per file: only `astro/src/components/*.css` is scoped, so app.css and
 * tweb's own SCSS pass through untouched.
 */
export function scopeCssPlugin(componentsDir) {
  // A plain PostCSS 8 plugin object: PostCSS and Vite both accept an object that
  // carries `postcssPlugin`, and it must NOT also carry `postcss: true` — that
  // flag tells PostCSS the value is a plugin *creator* and it calls it.
  return {
    postcssPlugin: 'web-s-scope-css',
    Once(root, {result}) {
      const from = result.opts.from;
      if(!from || !isClientComponent(from, componentsDir)) return;

      const name = scopeFor(from);
      if(!name) return;

      root.walkRules((rule) => {
        if(!rule.selector || insideKeyframes(rule)) return;
        rule.selector = scopeSelector(rule.selector, name);
      });
    }
  };
}

export default scopeCssPlugin;
