# Porting `svelte/` to `astro/` — conventions

The client is being converted from SvelteKit to Astro + Preact, one component at a
time, in `astro/`. This file is the contract for that port: follow it exactly, and
check your work with the commands at the end.

The port is **mechanical**. The Svelte components are already runes-only, have no
stores, no slots, no transitions and no `createEventDispatcher`, so almost every
construct maps one-to-one. Where a decision is genuinely open, this file makes it.

---

## 1. Two rules that must not be broken

**1. Every component's stylesheet is copied verbatim — with the script, not by
hand.**

```bash
node astro/scripts/extract-style.mjs Chat        # writes astro/src/components/Chat.css
node astro/scripts/extract-style.mjs --all       # or every component at once
```

Same selectors, same class names, same order, same comments, byte for byte. Do not
rename a class, do not "tidy" a selector, do not add `:global`, do not merge rules,
do not re-indent.

Scoping is not your job — build tooling does it (`astro/scripts/scope-id.mjs`
explains the scheme): `scripts/babel-plugin-scope-jsx.mjs` stamps every host
element in `X.tsx` with `data-ws="x"`, and `scripts/postcss-plugin-scope-css.mjs`
appends `[data-ws='x']` to each compound of `X.css` in exactly the places Svelte's
compiler put its scope class.

A renamed class is a silently unstyled element. It is also load-bearing outside the
component: `src/app.css` styles bare `.bubble`, `.messages`, `.row-button` … (the
console-density and appearance features), and tweb's own 24k-line layer adds classes
imperatively (`classList.add('i18n')`, `querySelector('.media-sticker')`).

**2. Components are named exports.** `export function Chat(props: Props)`. Never
`export default`. The island in `index.astro` refers to the export by name.

---

## 2. Files and imports

| Svelte | Preact |
|---|---|
| `svelte/src/lib/components/Chat.svelte` | `astro/src/components/Chat.tsx` + `Chat.css` |
| `svelte/src/lib/components/chat/Bubble.svelte` | `astro/src/components/chat/Bubble.tsx` + `Bubble.css` (keep subdirectories) |
| `$lib/components/Chat.svelte` | `./Chat` |
| `./Avatar.svelte` | `./Avatar` |
| `$lib/telegram/chats` | `$lib/telegram/chats` (unchanged — same alias) |
| `@appManagers/...`, `@lib/...`, `@layer` | unchanged |

The whole `$lib/telegram/*` layer is already ported and framework-clean: **never
edit it to make a component compile** — adapt the component instead.

Every component imports its own stylesheet with its other imports: `import './Chat.css';`

## 3. Component shape

```tsx
/*
 * Ported from svelte/src/lib/components/Glyph.svelte.
 * (Keep the original explanatory comments — they document tweb behaviour and are
 * the most valuable thing in these files. Reword only the ones that talk about
 * Svelte itself: `$state` -> signal, "Svelte action" -> hook.)
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import './Glyph.css';

interface Props {
  name: string;
  size?: number;
}

export function Glyph({name, size = 18}: Props) {
  return <span class="glyph" style={{width: size, height: size}} />;
}
```

* Props: `let {a, b = 1}: {a: T; b?: number} = $props()` → an `interface Props` plus
  a destructured parameter, **with the same defaults**.
* Keep a `class` prop if the Svelte component declared one, on the same element.
* Style: `if(cond)`, no space before a call paren, single quotes, 2-space indent,
  LF, final newline, no trailing whitespace. Match the file you are in.

## 4. Runes → Preact signals

The state model is `@preact/signals`: Svelte 5's `$state` **is** a signal, so this
preserves fine-grained updates instead of re-rendering whole subtrees.

| Svelte | Preact |
|---|---|
| `let x = $state(0)` | `const x = useSignal(0)` |
| read `x` (in markup or script) | `x.value` — **always write `.value`**, including in JSX |
| `x = 1` | `x.value = 1` |
| `let y = $derived(expr)` over **signals** | `const y = useComputed(() => expr)` |
| `let y = $derived(expr)` over **props** | plain `const y = expr` in the body (recomputed each render), or `useMemo(..., [props])` if it is expensive |
| `$effect(() => {…})` reading **signals** | `useSignalEffect(() => {…})` |
| `$effect(() => {…})` reading **props** | `useEffect(() => {…}, [props])` |
| `onMount(fn)` | `useEffect(() => { fn(); }, [])` |
| `onDestroy(fn)` | `useEffect(() => fn, [])` |
| `$bindable()` | a plain prop plus an `on…` callback prop (1 site in the port) |

**The dependency rule matters.** `useSignalEffect` and `useComputed` track *signal
reads only*. An effect or derivation that depends on a **prop** must use
`useEffect`/`useMemo` with that prop in its dependency list, or it will silently
never update. `Avatar.tsx` is the worked example.

**Any non-trivial per-instance object must be memoised.** A Svelte component body
runs once per instance; a Preact body runs on every render. So
`const retry = staleUrlRetry()` becomes `useMemo(() => staleUrlRetry(), [])`, and a
hand-built helper object becomes `useRef`/`useMemo`. Creating one per render resets
its internal state and can spin the component.

**A value that must be *current* inside an async callback belongs in a ref.** In
Svelte, reading a prop inside a `.then()` always saw the latest value; a JSX closure
sees the value from the render that started the work. `Avatar.tsx` keeps
`currentPeerId` in a ref for exactly this reason.

**`signal()` is shallow; Svelte's `$state` was a deep proxy.** This is the one
semantic difference that can silently stop the UI updating. In Svelte,
`card.expiryMonth = '12'` or `messages[i].read = true` notified every reader of
that field; a signal notifies only when the signal itself is assigned. So a nested
write must become a reassignment:

```tsx
// ❌ no notification — readers of `read` never re-render
messages.value[i].read = true;

// ✅
messages.value = messages.value.map((message, j) => j === i ? {...message, read: true} : message);
```

The port audit in `astro/scripts/audit-mutations.mjs` lists every nested write in
the ported files; each one has to be either reassigned or shown to be read
imperatively only. `Checkout`'s `card.value.expiryMonth` is the known benign case:
nothing derives from those fields — the inputs read them back and the submit
handler reads them at click time.

**Values that cross into the worker must be plain.** tweb rejects anything that is
not structured-cloneable: pass `sig.value`, never `sig`, into a manager call. Files
already carrying a comment about this keep it, reworded.

**Module-level `$state`** (shared state a few files keep outside the component, e.g.
player/queue state) becomes a module-level `signal()` imported by the components
that need it, read as `.value`.

Three more Svelte APIs appear in the larger components:

| Svelte | Preact |
|---|---|
| `await tick()` (9 uses, mostly scroll preservation) | `await tick()` from `$lib/tick` — `flushSync` from `preact/compat`, so the DOM reflects the state you just wrote |
| `untrack(() => expr)` (12 uses) | drop the wrapper: a plain `useEffect` never subscribes. Inside a `useSignalEffect`, read the signal with `.peek()` instead |
| `let el = $state<HTMLDivElement>()` + `bind:this={el}` | `const el = useRef<HTMLDivElement>(null)`, reads become `el.current` — **unless** an effect or the markup reacts to the element appearing, in which case `const el = useSignal<HTMLDivElement \| null>(null)` with `ref={(node) => (el.value = node)}` |

## 5. Markup → JSX

| Svelte | Preact |
|---|---|
| `{#if c} … {:else if d} … {:else} … {/if}` | `{c ? (…) : d ? (…) : (…)}`, or `{c && (…)}` when there is no else |
| a long `{#if}` chain that selects one value | compute the value before the `return` with `switch`/`if` and render it once (see `Glyph.tsx`) |
| `{#each items as item, i (item.id)}` | `{items.map((item, i) => …)}` with `key={item.id}` on the returned element |
| `{#each items as item}` (no key) | `items.map((item, i) => …)`; add `key={i}` |
| `{#key expr} … {/key}` | `key={expr}` on the wrapper element |
| `{@const x = expr}` | a `const` in the enclosing block, or above the JSX |
| `{#snippet name(args)}` … `{/snippet}` | `const name = (args) => (…)` |
| `{@render name(args)}` | `{name(args)}` |
| `{@html expr}` | none in this codebase; if you meet one, use `<span innerHTML={expr}/>` and comment why |
| `<svelte:window onresize={…} onkeydown={…}/>` | a `useEffect` that adds and removes the same listeners |
| `<svelte:head><title>…</title></svelte:head>` | drop it; the head lives in `astro/src/layouts/Base.astro` |
| `text {expr} text` | JSX trims whitespace — use `{' '}` where a space matters |
| `style="width: {w}px"` | `style={{width: `${w}px`}}` — object, camelCase, strings for units |
| `class="a b"` | identical: `class="a b"` (Preact uses `class`, not `className`) |

Events — Svelte 5's lowercase form and the older `on:` directive form both become
the camelCase Preact prop, with the same handler body:

| Svelte | Preact |
|---|---|
| `onclick` / `on:click` | `onClick` |
| `oninput` | `onInput` |
| `onsubmit` / `on:submit\|preventDefault` | `onSubmit={(e) => { e.preventDefault(); … }}` |
| `onkeydown` | `onKeyDown` |
| `oncontextmenu` | `onContextMenu` |
| `onchange`, `onfocus`, `onblur`, `onscroll`, `onplay`, `onerror`, `onload` | `onChange`, `onFocus`, `onBlur`, `onScroll`, `onPlay`, `onError`, `onLoad` |

Handler parameters are typed explicitly where Svelte inferred them:
`(e: Event) => …`, `(e: KeyboardEvent) => …`, and
`(e.target as HTMLInputElement).value` to read an input.

Bindings:

| Svelte | Preact |
|---|---|
| `bind:value={v}` (input/textarea) | `value={v.value} onInput={(e) => (v.value = (e.target as HTMLInputElement).value)}` |
| `bind:checked={c}` | `checked={c.value} onChange={(e) => (c.value = (e.target as HTMLInputElement).checked)}` |
| `bind:group={g}` (radios) | `checked={g.value === value} onChange={() => (g.value = value)}` |
| `bind:this={el}` | `ref={el}` with `const el = useRef<HTMLDivElement>(null)` |
| `bind:clientWidth={w}` | a `ResizeObserver` hook writing `w.value` |
| `bind:index={i}` on `<Lightbox>` | keep `index` and add `onIndexChange={(i) => …}`; pass it at the call site |
| `class:active={cond}` | build one class string: `` class={['row', cond && 'active'].filter(Boolean).join(' ')} `` — never rename or drop a class |

**Booleans are booleans, not strings.** Preact writes known attributes as DOM
*properties*, so the HTML habit of `draggable="false"` backfires: it sets
`element.draggable = "false"`, which is truthy, and the element becomes draggable —
the opposite of what the markup said. Svelte compared the string against `"false"`
and got it right. Write `draggable={false}`, `contentEditable={false}`,
`spellcheck={false}` and friends as booleans. Numeric attributes are the same
story: `maxlength="16"`, `rows="2"` and `tabindex="0"` are `maxlength={16}`,
`rows={2}`, `tabIndex={0}` — Preact types them as numbers and the DOM result is
identical.

**A callback ref needs a block body.** Preact 10.29's
`RefCallback<T> = (instance: T | null) => void | (() => void)`, so the obvious
`ref={(node) => (el.current = node)}` is a type error — the arrow returns the node.
Write `ref={(node) => { el.current = node; }}`. The same reasoning applies when the
ref must clean up after itself: returning a function from the ref detaches it.

## 6. Actions → hooks

Six custom actions exist. Each becomes a small hook returning a `ref` object: the
hook body is the action's `mounted` logic, its return value the `destroy` logic, and
its dependency list the action's parameters.

```tsx
function useObserveForRead(mid: number) {
  const el = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = el.current;
    if(!node) return;
    // …the action's mounted() body
    return () => {
      // …the action's destroy() body
    };
  }, [mid]);

  return el;
}
```

| action | where | port |
|---|---|---|
| `portal` | `Stories.svelte` (7×) | wrap the element in `<Portal>` from `$lib/portal` |
| `observeForRead(node, mid)` | `Chat.svelte` | `IntersectionObserver` hook |
| `pressMenu(node, mid)` | `Chat.svelte` | hook adding a `contextmenu` listener |
| `sponsoredSeen(node, key)` | `Chat.svelte` | `IntersectionObserver` hook |
| `lazy(node, mid)` | `ChatInfo.svelte` | `IntersectionObserver` hook |
| `play(node, effectId)` | `EffectOverlay.svelte` | hook starting the animation on the node |

Keep the action's explanatory comments: they say *why* the observer or the portal is
there.

## 7. Stylesheets

* Extract with the script (rule 1) and `import './X.css';`.
* Nothing else: no scope class to add by hand, no `:global` marker to introduce, no
  class attribute to change.
* `:global(...)` stays exactly as written in the source. It is what keeps a rule
  reaching elements tweb paints itself (custom emoji, lottie, cropper) or a
  `:root` override working; the build strips the marker — it is Svelte syntax, not
  CSS — and leaves those selectors unscoped.
* `@keyframes`, `@media`, `@supports`, comments: unchanged.

`astro/src/components/App.css`, `Glyph.css` and `Markdown.css` are worked examples.

## 8. Before you report a component done

Run all three from the repo root:

```bash
node astro/scripts/extract-style.mjs <Name>   # for each component you port
pnpm run typecheck:astro                      # must end "astro/src type-checks clean"
npx vitest run astro/scripts/                 # class/markup/text parity + stylesheet invariants
node astro/scripts/audit-mutations.mjs        # nested writes into signal-held objects
node astro/scripts/audit-hooks.mjs            # hooks called from inside a callback
pnpm run build:astro                          # must end "Complete!"
```

The audit lists nested writes for review (see §4): each one must be reassigned, or
be read only imperatively. `Checkout`'s `card.value.expiryMonth` is the known benign
shape — no derivation reads those fields.

Note that the Astro build only compiles what the page can reach, so a component
nothing imports yet is *not* compiled by it — the typecheck and the two guard suites
are what cover those.

Also confirm by reading your own diff:

* every `<style>` rule of the original is in `X.css`, selectors identical;
* no class name was added, removed or renamed anywhere in the markup;
* every prop, default, event handler, early return and comment survived;
* nothing under `$lib/telegram/`, `src/`, or `svelte/` was edited;
* no `any` was introduced to silence an error the Svelte original did not have.

---

## This contract is now about maintenance, not conversion

The port is finished and the Astro client is what ships, so the rules above are
read as: keep the two in step where the Svelte file is the reference, and do not
re-introduce differences that are really regressions. Two things have changed
since §1-§8 were written:

* **New features have no Svelte original.** Dice and story messages, pin/unpin,
  join, delete-for-me, translation and voice-to-text, and the service-message
  wording exist only in `astro/`. Their styles cannot go in a component
  stylesheet — `astro/scripts/css-verbatim.test.mjs` byte-compares those with the
  Svelte `<style>` blocks, and a new component sheet would have no original at all
  — so they use `astro/src/styles/app.css` (or another sheet under
  `astro/src/styles/`, which no guard owns). New class names are prefixed by the
  thing they draw; the guards that read class names (`class-parity`,
  `markup-parity`, `text-parity`) only fail when something is *dropped*, so
  additions are safe.
* **The seam has diverged.** `astro/src/lib/telegram/` and
  `svelte/src/lib/telegram/` are no longer identical: every post-port feature
  landed in the Astro copy only. Edit the Svelte copy only when a task names that
  client.

