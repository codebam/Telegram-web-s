/*
 * Per-component style scoping for the Preact client.
 *
 * Svelte compiled every component's <style> block against the component's own
 * markup: `/foo/.svelte-1a2b3c` was appended to each compound selector and the
 * matching class was added to the elements that markup contained. Preact has no
 * compiler, so the port has to keep that guarantee some other way — and it does
 * have to keep it:
 *
 *  - the plain class names cannot be renamed, because src/app.css styles bare
 *    `.bubble`, `.messages`, `.row-button` … from the global sheet (that is the
 *    console-density and appearance feature), and because tweb's own layer adds
 *    classes imperatively (`classList.add('i18n')`, `querySelector('.media-sticker')`)
 *    from 24k lines of framework-agnostic code;
 *  - leaving the styles global is not an option either: 146 class names are
 *    reused across components with different meanings (`.row`, `.field`,
 *    `.muted`, `.primary`, …), so one component's rules would leak into another's.
 *
 * The scope token is therefore an attribute rather than a class:
 *
 *   <div class="bubble out" data-ws="chat">      (babel-plugin-scope-jsx.mjs)
 *   .bubble[data-ws='chat'] { … }                (postcss-plugin-scope-css.mjs)
 *
 * An attribute selector has the same specificity as Svelte's scope class, so
 * every specificity contest the CSS was written around — including app.css's
 * deliberate `:root[data-density='console'] .messages .line` overrides — resolves
 * exactly as it did before. It also leaves `class` untouched, so dynamic class
 * expressions (`class={cond ? 'a' : 'b'}`) port over verbatim.
 */

/**
 * `Chat.tsx` -> `chat`, `ChatAdminMembers.tsx` -> `chat-admin-members`.
 * Stable and readable: it is the name that shows up in devtools, and it lets a
 * human confirm at a glance which component a stray rule belongs to.
 */
export function scopeFor(filename) {
  const base = filename.replace(/\\/g, '/').split('/').pop();
  if(!base) return null;

  const name = base.replace(/\.(tsx|jsx|css)$/, '');
  if(!name || name.startsWith('_')) return null;

  return name
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .toLowerCase();
}

/** The attribute carrying the scope token. */
export const SCOPE_ATTR = 'data-ws';

/** Only the Preact client's own components are scoped; tweb's Solid UI is untouched. */
export function isClientComponent(filename, componentsDir) {
  // Vite hands CSS files to plugins with a query suffix (`?used`, `?inline`).
  const normalized = filename.replace(/\\/g, '/').split('?')[0];
  return normalized.startsWith(componentsDir.replace(/\\/g, '/') + '/');
}
