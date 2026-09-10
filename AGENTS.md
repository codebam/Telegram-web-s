# AGENTS.md — Web S

Canonical instructions for **every** coding agent working in this repo (Claude
Code, Codex, Cursor, Zed, …). `CLAUDE.md` is only a pointer that imports this
file — edit AGENTS.md, never CLAUDE.md.

## Three apps live here — read this first

| | `astro/` | `svelte/` | `src/` |
|---|---|---|---|
| What | **Web S** — the client this repo ships | the previous client, retired | tweb (Telegram Web K), the upstream client |
| Framework | Astro + Preact islands (`@preact/signals`) | SvelteKit + Svelte 5 runes | Solid.js (custom fork in `src/vendor/solid/`) |
| Deployed | **yes** — https://tgws.codebam.ca | not built any more | no |
| Role | the product | the port source, kept for reference | MTProto stack + managers the product imports |

**The client this repo ships is `astro/`.** The Cloudflare Pages build runs
`pnpm install && pnpm run build:astro` and publishes `astro/dist`, so pushing to
`master` ships the Astro client. `svelte/` is the client it was ported from:
still in the tree as the reference the port is checked against, but nothing
builds or deploys it.

`astro/src/lib/telegram/` is a copy of `svelte/src/lib/telegram/` (framework-clean,
so the only edits were import paths and comments), and every one of the 85
components has a Preact port.

Which one to work on:

* **A user-facing bug** ("the app crashes", "the picker is broken") — `astro/`.
  That is what users run.
* **Anything in `src/`** — it is the whole MTProto/worker/manager layer plus the
  original Solid client, imported by *both* clients through the tweb path aliases.
  A fix there reaches users through the Astro client.
* **`svelte/`** — only when the task names the Svelte client explicitly, or when
  checking a port against its original. `astro/CONVERSION.md` documents the full
  mapping between the two, and is the reference to read before touching either.

`astro/CONVERSION.md` is the porting contract; `astro/scripts/` holds the tooling and
guards that keep the port honest (see "Migrating to Astro" below).

## Development

```bash
pnpm install

pnpm start:astro       # Web S (Astro + Preact) dev server on :8082   <- the usual one
pnpm build:astro       # -> astro/dist/
pnpm preview:astro
pnpm deploy:astro      # manual wrangler push — an escape hatch, NOT how we deploy
pnpm typecheck:astro   # astro/src only (tweb's own errors are not gated)
npx vitest run astro/scripts/   # the porting guards: class/markup/text parity, stylesheet invariants

pnpm start:svelte      # the previous client's dev server on :8081
pnpm build:svelte      # -> svelte/build/
pnpm preview:svelte
pnpm deploy:svelte     # manual wrangler push — an escape hatch, NOT how we deploy

pnpm start             # tweb (Solid) dev server on :8080
pnpm build             # typecheck + changelog + tweb build -> dist/

pnpm typecheck         # tsc --noEmit over tweb and the svelte client, then the astro app
pnpm lint              # oxlint, src/ only (tweb) — does not cover either client's UI
pnpm test              # Vitest
pnpm test:lottie       # Playwright specs in e2e/
```

## Keeping up with upstream tweb

`src/` is upstream tweb. The `upstream` remote is
`https://github.com/TelegramOrg/Telegram-web-k.git`, and `master` is kept rebased
on `upstream/master` — our own work (the two client trees, a handful of manager
methods) rides on top:

```bash
git fetch upstream
git rebase upstream/master
git rev-list --count upstream/master..master   # how thick our layer is
```

Upstream never touches `svelte/` or `astro/`, so after a rebase both trees must be
byte-identical to what they were. A conflict *inside* them is an artifact of
replaying this repo's merge commits linearly, not a real conflict — resolve it and
restore the trees from the pre-rebase ref, then check:

```bash
git diff <pre-rebase-ref> -- svelte astro      # must print nothing
git diff upstream/master -- src                # our tweb changes, and only those
```

Our additions to tweb are small and deliberate: methods on
`src/lib/appManagers/*` that the clients call, plus `src/lib/storages/filters.ts`.
Keep them that way — every line we add to `src/` is a line the next rebase has to
carry.

## Migrating to Astro

The conversion is done and `astro/` is what ships; the rules below are what keeps
the port honest.

* **Component stylesheets are copied verbatim** into `astro/src/components/X.css`
  with `node astro/scripts/extract-style.mjs X`. Scoping is added at build time:
  `scripts/babel-plugin-scope-jsx.mjs` (via `scripts/vite-plugin-scope-jsx.mjs`)
  stamps every host element with `data-ws="x"` and `scripts/postcss-plugin-scope-css.mjs`
  appends `[data-ws='x']` to the matching selectors, in exactly the places Svelte's
  compiler put its scope class. Class names are load-bearing outside the component —
  `src/app.css` styles bare `.bubble`, `.messages`, `.row-button` …, and tweb's layer
  adds classes imperatively — so renaming one is a silently unstyled element.
  `scripts/verify-scoping.mjs` checks the scheme against `svelte/compiler` itself.
* **The guards are the review**: `class-parity`, `markup-parity` and `text-parity`
  compare every ported component with its Svelte original, `components-css` checks
  the stylesheet invariants, and `audit-mutations.mjs` / `audit-hooks.mjs` flag the
  two translations that are silent when wrong (nested writes into a signal-held
  object, and hooks called from inside a callback).
* **`patches/@astrojs__preact@6.0.5.patch`** removes the integration's dependency on
  its `astro:preact:opts` virtual module (which Astro externalises, so Node dies on
  the `astro:` URL) and stops it forcing Babel's JSX transform (whose dev-mode plugin
  calls an API `@babel/core` 8 removed, which breaks `astro dev`). Read the patch
  before upgrading that package.

Deployment is **CI**: the Cloudflare Pages GitHub integration builds the Astro
client on every push to `master` and publishes it to
https://tgws.codebam.ca. The dashboard settings are build command
`pnpm install && pnpm run build:astro`, output directory `astro/dist`, root
directory **blank** (the build reads `src/`, the repo-root `.env` and `patches/`,
so it has to run from the repo root) — there is no workflow file in this repo
(`.github/workflows/production-image.yml` is upstream tweb's tag-triggered Docker
build and has nothing to do with the site). Pushing to master ships.
`pnpm deploy:astro` exists as a manual wrangler escape hatch; prefer the pipeline.

The build **fails loudly** when `VITE_API_ID` / `VITE_API_HASH` are missing
(`requireCredentials()` in `astro/astro.config.mjs`) instead of shipping a client
that could never connect: they come from the dashboard's environment variables in
CI, and from the repo-root `.env` locally. `astro/public/_headers` / `_redirects`
carry the Cloudflare rules the asset layout needs (`/_astro/*` immutable, SPA
fallback, real 404s for missing chunks).

`svelte/` is not built or deployed by anything any more; `pnpm build:svelte`
still works locally when you need to compare against the port source.

Anything the build reads from its environment is compiled into a **public**
bundle. Pages clones with a credentialed origin
(`https://x-access-token:ghs_…@github.com/…`), so never emit
`remote.origin.url`, a token, or any build env var into the output without
sanitising it first — see the `GIT_REPO_URL` derivation in
`svelte/vite.config.ts`.

Both apps read `.env` at the repo root (`VITE_API_ID`, `VITE_API_HASH`,
`VITE_MTPROTO_*`).

Debug query params (both apps, they share the stack): `?test=1` (test DCs),
`?debug=1` (verbose logging), `?noSharedWorker=1`.

The running build stamps its own commit into the bundle (see
`svelte/src/lib/buildInfo.ts`): the short SHA sits in the corner of the empty
chat pane and at the bottom of the sign-in card, linking to that commit on
GitHub. It is the quickest way to tell whether a deploy landed — compare it
against `git rev-parse --short origin/master`.

### tweb preview

Launch an authorized local tweb preview with `bash scripts/start-preview.sh`
(never plain `vite`) — it mints a fresh per-preview auth + picks a free port.
`.claude/launch.json` wires it into Claude Code's preview pane; other agents run
the script directly and open the printed URL.

### Popup sandbox

Every popup, opened by click with mock data and **no Telegram traffic**. Two ways in:

- `?popups=1` on any dev/preview build (`.claude/launch.json` has a
  `tweb-popups` server for it — a plain vite server is enough, no auth needed).
  `src/index.ts` hands over before the session is restored, so nothing but the
  sandbox ever runs.
- `showPopupSandbox()` from the console of a running app, signed in or not. The
  panel opens over the app and closing it (×) puts the real managers back. The
  fixture peers/messages are merged into the mirrors key by key rather than
  replacing them, so a live session's own cache survives.

Signed in, the panel offers a second data source — **My data** — which builds the
stories out of the session's own dialogs, messages and gifts instead of the
fixtures, and runs them against the real managers. Writes are held back by a
name heuristic that fails closed (`liveManagers.ts`): only `get`/`is`/`has`/`can`
… reach the real manager, everything else resolves to `undefined` and is listed
in the panel. **Let popups write** removes that guard, and then a confirm button
does the real thing — deletes, leaves, pays. Stories with no live equivalent (a
payment form, a gift code) are marked `fixtureOnly` and stay on fixtures.

Either way every `rootScope.managers` call is answered from
`src/components/popupSandbox/`.

- A **story** is one popup in one state — arguments plus the manager answers it
  needs. They live in `src/components/popupSandbox/stories/`; add a file there
  and import it from that folder's `index.ts`. Import the popup module *inside*
  `open()`, never at the top (the popup graph has import cycles).
- A story asks `open(ctx)` for a peer by KIND (`ctx.peer('channel')`), a message
  (`ctx.message()`), a chat (`ctx.chat()`) or a gift — never for a fixture by
  name. That indirection is what lets the same story render from fixtures or from
  a real account; a story that reaches into `fixtures.ts` directly cannot go live.
- Anything a story does not answer resolves to `undefined` and is listed under
  "Unanswered manager calls" in the panel — that list is the to-do for making a
  half-rendered popup complete.
- The panel's theme select switches between `system` and every shipped theme
  (`day` / `night` / `light` / `tinted`) and survives a reload — the mock
  managers discard settings writes, so it is kept in `localStorage` instead.
- `window.popupSandbox` (`ready` / `show` / `hide` / `list` / `open` /
  `closePopups` / `calls` / `unhandled`) drives the same registry from a script;
  `calls` and `unhandled` follow the active data source.
  `pnpm test:popups` runs `e2e/popupSandbox.spec.ts`, which opens every story in
  headless Chromium and fails on one that throws or never becomes visible.
- `src/tests/popupSandboxCoverage.test.ts` fails when a module under
  `components/popups/` can open a popup and no story imports it, so a new popup
  cannot land without one. It also fails when a story builds its popup out of a
  fixture without being marked `fixtureOnly` — that mark is what keeps live mode
  from quietly showing made-up data.


## Directory structure

```
astro/                        # THE CLIENT — Astro + Preact islands
├── src/
│   ├── pages/index.astro     # prerendered shell + the one client:only island
│   ├── layouts/Base.astro    # head; replaces SvelteKit's app.html
│   ├── components/           # 85 Preact components + one .css each (verbatim from svelte/)
│   │   └── App.tsx           # auth flow (phone → code → password) + <Chat/>
│   ├── lib/
│   │   ├── telegram/         # the seam onto tweb's managers (copy of svelte/src/lib/telegram)
│   │   │   ├── client.ts     # bootTelegram(): boots the worker, returns managers
│   │   │   ├── auth.ts       # sendCode / signIn / checkPassword
│   │   │   ├── chats.ts      # dialogs, messages, media, stickers, GIFs (~2.3k lines)
│   │   │   ├── extras.ts     # calls, stories, mini apps, folders
│   │   │   ├── loadQueue.ts  # bounded media-download queue
│   │   │   └── staleGuard.ts # __BUILD_ID__ check for cached bundles
│   │   ├── portal.tsx        # <Portal>, the port of Svelte's `use:portal`
│   │   ├── tick.ts           # `tick()` — flush Preact's pending render
│   │   └── buildInfo.ts      # __GIT_COMMIT__ → link to the built commit
│   ├── styles/app.css        # the design tokens + console density (same as svelte/src/app.css)
├── public/                   # _redirects, _headers, manifest, icons
├── scripts/                  # the porting tooling and guards (see "Migrating to Astro")
├── dist/                     # build output (gitignored)
├── astro.config.mjs          # integrations, aliases, defines, scope tooling
├── tsconfig.json             # Preact JSX + tweb aliases
└── CONVERSION.md             # the porting contract: every Svelte → Preact mapping

svelte/                       # the previous client — SvelteKit, still deployed
├── src/
│   ├── routes/
│   │   ├── +page.svelte      # auth flow + <Chat/>
│   │   └── +layout.svelte
│   ├── lib/
│   │   ├── components/       # 85 Svelte components — the source of truth for the port
│   │   ├── telegram/         # the same seam, Svelte-era copy
│   │   └── buildInfo.ts
│   ├── app.html / app.css
├── static/                   # _redirects, _headers, manifest, icons
├── build/                    # adapter-static output (gitignored)
├── svelte.config.js          # adapter-static SPA fallback + tweb aliases
└── vite.config.ts            # tweb aliases, solid plugin for .tsx, defines

src/                          # tweb — shared stack + the Solid client
├── components/               # Solid UI (.tsx), 200+ feature folders
├── lib/
│   ├── appManagers/          # 55+ domain managers — the API both clients use
│   ├── mtproto/              # MTProto implementation
│   ├── storages/             # IndexedDB/localStorage wrappers
│   └── rootScope.ts          # global event emitter & app context
├── stores/ helpers/ hooks/ pages/ config/ environment/ scss/ vendor/
├── layer.d.ts                # MTProto API types (auto-generated, 664KB)
└── tests/                    # Vitest

public/                       # compiled tweb, updated by "Build" commits, served by server.js
e2e/                          # Playwright (lottie rendering)
```

## Path aliases

Both clients use `$lib` for their own code **and** tweb's aliases for the shared
layer. In `astro/` they are declared in `astro/astro.config.mjs` (mirrored in
`astro/tsconfig.json`); in `svelte/` in `svelte/svelte.config.js` and
`svelte/vite.config.ts`. Never reach into tweb with relative `../../src/…`.

```typescript
$lib/*          → astro/src/lib/ (or svelte/src/lib/)   // the client's own code
@appManagers/*  → src/lib/appManagers/
@components/*   → src/components/
@helpers/*      → src/helpers/
@hooks/*        → src/hooks/
@stores/*       → src/stores/
@lib/*          → src/lib/
@environment/*  → src/environment/
@config/*       → src/config/
@vendor/*       → src/vendor/
@layer          → src/layer.d.ts            // MTProto API types
@types          → src/types.d.ts
@/*             → src/

// inside tweb, Solid.js resolves to the custom fork:
solid-js        → src/vendor/solid
```

## Code style

Two conventions coexist; match the file you are in.

- **`.svelte` files** — Prettier-ish Svelte style: `if (cond)`, space after
  keywords, 2-space indent, single quotes.
- **`.ts` files, both apps** — tweb style: `if(cond)`, `for(...)`, `catch`,
  `{a: 1}`, `[1, 2]`, no space before a function paren, no trailing comma, no
  `return await`. Enforced by oxlint on `src/`; `svelte/src/lib/telegram/*.ts`
  follows it by hand.

Shared: 2-space indent, single quotes, LF + final newline, no trailing
whitespace, max 2 blank lines, `prefer-const`.

## Preact + signals conventions (`astro/`)

The full mapping from Svelte to Preact is `astro/CONVERSION.md` — read it before
changing a component. The short version:

- State is `@preact/signals`: `$state` → `useSignal`, `$derived` → `useComputed`
  (signals only) or a plain const/`useMemo` (props), `$effect` →
  `useSignalEffect` (signals only) or `useEffect` with the props in its deps.
  Reading a signal is always `.value`.
- A signal is **shallow** where `$state` was a deep proxy: `obj.value.field = x`
  notifies nobody, so nested writes are reassignments
  (`astro/scripts/audit-mutations.mjs` lists them).
- Anything created in the component body that holds state (a helper object, a
  copy of a prop read inside an `await`) must be `useMemo`/`useRef` — a Preact
  body runs on every render, a Svelte body ran once per instance.
- Values crossing into the worker are `sig.value`, never the signal.
- Components are **named exports**; the island in `index.astro` names the export.
- Component CSS is copied verbatim from `svelte/` (`extract-style.mjs`) and scoped
  at build time by the `data-ws` tooling — never rename a class.

## Svelte 5 conventions (`svelte/` — the previous client)

Runes only — no legacy `export let`, no `$:` labels:

```svelte
<script lang="ts">
  let {sticker, size = 128}: {sticker: StickerItem; size?: number} = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    // cleanups are returned, not registered
    const observer = new IntersectionObserver(/* … */);
    return () => observer.disconnect();
  });
</script>
```

- Objects handed back to the MTProto worker must **not** be `$state` proxies —
  a proxy is not structured-cloneable and the request silently never leaves the
  tab (`DataCloneError`). Keep such values as plain `let`; see `passwordState`
  in `+page.svelte`.
- Media in a list is loaded lazily and through `enqueueLoad` from
  `$lib/telegram/loadQueue` — grids run to hundreds of items and every one is a
  full document download.

## Working with the MTProto layer

The Svelte app never talks to MTProto directly. `bootTelegram()` returns tweb's
`managers` proxy, and everything goes through a wrapper in `$lib/telegram/`:

```typescript
import {bootTelegram} from '$lib/telegram/client';

export async function loadGifs(): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const docs = await managers.appGifsManager.getGifs();
  return (docs ?? []).map(toSticker);
}
```

`rootScope.managers.*` are **asynchronous proxies to a shared worker** — every
method returns a Promise, however synchronous the manager looks.

**Strict rule — never call `apiManager.invokeApi*` from UI code** (Svelte or
Solid). It bypasses every wrapper: no caching, no `saveApiPeers`, no
`processUpdateMessage`, no dedup with the rest of the app. Add or extend a
method on the relevant `app*Manager` and call that:

```typescript
// ❌ wrong — UI making a raw MTProto call
await rootScope.managers.apiManager.invokeApi('messages.getSearchResultsCalendar', {...});

// ✅ right — manager method wraps the call, UI invokes by domain intent
await rootScope.managers.appMessagesManager.getSearchResultsCalendar({peerId, filter, offsetDate});
```

Inside a manager:

```typescript
await this.apiManager.invokeApi('payments.checkCanSendGift', {gift_id: gift.id})
await this.apiManager.invokeApiSingle('payments.checkCanSendGift', {gift_id: gift.id})  // deduped
return this.apiManager.invokeApiSingleProcess({
  method: 'some.method',
  params: {...},
  processResult: (result) => {
    this.appPeersManager.saveApiPeers(result);          // when result has {chats, users}
    this.apiUpdatesManager.processUpdateMessage(result); // when result is `Updates`
  }
});
```

Managers live in `src/lib/appManagers/` as `AppManager` subclasses and
communicate over `rootScope` events. They are the source of truth: they wrap the
raw API with caching and the side effects (saving peers, dispatching updates)
the rest of the stack expects.

### Media devices (camera / microphone)

**Never call `navigator.mediaDevices.getUserMedia` directly. Use `getStream`
from `@lib/calls/helpers/getStream`.** It is the single chokepoint for every
`getUserMedia` (calls, voice notes, round videos), so two things come free: it
honours the device picked in Settings → Speakers and Camera, and it self-heals a
stale selection by stripping a dead `deviceId` and retrying on the OS default.

```typescript
import getStream from '@lib/calls/helpers/getStream';
const stream = await getStream({video, audio});
```

For call-tuned constraints use `getVideoConstraints()` / `getAudioConstraints()`
from the same folder.

### Object URLs (`blob:`)

Shared blob URLs (thumbnails, avatars, backgrounds — anything minted by the
worker) are revocable: the worker's LRU may evict and revoke them at any time
(30 s grace after eviction). The rule is not enforced by types or lint, and
getting it wrong fails rarely and unreproducibly — so pick the right case
consciously:

- **Rendering an image** (`<img>`, canvas, one-shot CSS): just use the URL
  from the manager (`downloadMediaURL` / `cacheContext.url`). No bookkeeping —
  a decoded bitmap survives revocation, and a later re-render simply
  re-requests a fresh URL.
- **Handing the URL to something that will RESOLVE it later** — a playing or
  looping media element (seek/loop re-read the blob), MediaSession artwork,
  long-lived CSS background: take `pinObjectURL(url)` from `@helpers/objectUrl`
  and call the returned unpin in the consumer's cleanup (usually
  `middleware.onClean`). A missing pin breaks playback only after the URL is
  evicted — i.e. almost never in testing, occasionally in production.
- **Tab-local one-off URL** (editor previews, probes, worklet scripts): create
  it through an `ObjectURLScope` and dispose the scope. Never pass a tab-minted
  blob URL to the worker (`setSharedObjectURL` accepts worker-minted URLs
  only — a tab's URL dies with the tab).


### Highlighting text in rendered DOM

**Strict rule — never wrap matched text in `<span>`/`<mark>` or synthesize
`messageEntityHighlight` entities to point at a piece of rendered text. Use
`highlightText()` from `@helpers/dom/textHighlight`** (options and modes are
documented in the file; styles in `scss/partials/_textHighlight.scss`).


### Settings tabs are indexed for search

Settings has a search over every screen and row, and its index is **generated
from the tabs themselves** (`src/scripts/generate_settings_search.js` →
`src/lib/settingsSearch/generated.ts`, rebuilt by the Vite plugin on build and on
every settings-tab edit). A new tab or row is picked up with no bookkeeping —
*if* it follows the conventions the extractor reads. When adding to Settings,
check the things it cannot guess:

- **Declare the tab in `solidJsTabs/tabs.ts`** — `scaffoldSolidJSTab({title: 'LangKey', getComponentModule: () => import(...)})`. The export name becomes the section id and `title` its heading; a tab declared elsewhere, or without a title key, never appears in results.
- **It has to be reachable.** The tree is built from the tab constructors an indexed tab references in a row that opens them (`makeSubTabConfig(icon, 'Key', Tab, tab)`, `addRow(..., () => createTab(Tab))`). A tab nothing opens is dropped.
- **A tab that needs a payload needs an opener.** The search opens a section directly, passing the class's `getInitArgs` when it declares one; anything else `open()` requires goes in `SECTION_OPENERS` (`@lib/settingsSearch/openers.ts`), or the result opens an empty screen. A tab that only makes sense inside a flow (wizard steps, detail views) belongs in `NON_NAVIGABLE_SECTIONS` in the same file — it and everything under it leave the results.
- **Rows come from the labels a tab renders**: `<Row.Title>{i18n('K')}</Row.Title>`, `<Section name="K">`, title-ish props and option lists, `ButtonMenuToggle` items. Titles computed at runtime, and labels that exist only in a row's context menu, are not indexed. Captions, notices and input labels are excluded by the generator's deny lists — extend those there instead of contorting a tab.

Two things travel with a new setting:

- **Synonyms are language-pack strings, never build-time text** — add `'<TitleKey>.SearchKeywords'` (comma-separated) to `lang.ts` so every language gets its own from the server.
- **Deep links** live in `src/scripts/in/settings-links.csv`, the `tg://settings/...` table shared with the other clients. A link points at its control instead of performing the action, the way tdesktop does (`edit/log-out` opens the header menu and flashes the item); where another client's behaviour differs, follow that client. Paths the index cannot address are cases in `internalLinkProcessor`.

`src/tests/settingsSearchIndex.test.ts` fails if the checked-in index is stale, holds anything but identifiers, or drops a link from the table — run it after touching a settings tab.


### tweb's own UI (Solid)

Our clients never import from `@components` — tweb's UI is upstream's, and this is
the short version of its conventions for the rare change that belongs there:
components are `.tsx` with inline prop types and `classNames()`, scoped styles are
`.module.scss` next to the component, stores in `src/stores/` are `createRoot` +
`createSignal` behind a hook, and every `rootScope.managers` call is a Promise.

### MTProto types

```typescript
import {Message, Chat, User, InputPeer} from '@layer';
```

## TypeScript notes

- `strict: true` but `strictNullChecks: false` and
  `strictPropertyInitialization: false`
- `useDefineForClassFields: false` — matters for class field behaviour
- `jsxImportSource: solid-js` — JSX in `src/` is Solid, not React
- Globals available everywhere: `PeerId`, `UserId`, `ChatId`, `BotId`, `DocId`,
  `Long`, `Icon`, `ApiError`, `ErrorType`, `MaybePromise<T>` (`src/global.d.ts`)
- `pnpm typecheck` runs root `tsc` over tweb and `svelte/`, then
  `astro/scripts/typecheck.mjs` for the Astro app. Root `tsc` currently reports
  pre-existing errors in `src/tests/**` and a few `svelte/src/lib/telegram/*`
  signatures; the Astro run gates only `astro/src/**` for the same reason — check
  that your own file is clean rather than expecting a clean run.
- `astro/tsconfig.json` sets `jsxImportSource: preact` and enables
  `verbatimModuleSyntax: false` / `useDefineForClassFields: false` so tweb's own
  modules stay type-checkable as dependencies.

## Important files

| File | Purpose |
|---|---|
| `astro/src/components/App.tsx` | auth flow and app entry (the island) |
| `astro/src/components/Chat.tsx` | the whole chat UI |
| `astro/astro.config.mjs` | integrations, aliases, defines, scope tooling, prerender fix |
| `astro/CONVERSION.md` | the Svelte → Preact porting contract |
| `svelte/src/routes/+page.svelte` | the same auth flow, Svelte-era |
| `svelte/src/lib/components/Chat.svelte` | the same chat UI, Svelte-era (port source) |
| `svelte/src/lib/telegram/chats.ts` | dialogs, messages, media, stickers, GIFs |
| `svelte/src/lib/telegram/client.ts` | `bootTelegram()` — worker boot |
| `svelte/vite.config.ts` | aliases, `__BUILD_ID__`, `__GIT_COMMIT__` |
| `svelte/svelte.config.js` | adapter-static SPA + alias table |
| `astro/scripts/` | the porting tooling and its guard suites |
| `src/index.ts` | tweb entry: account/auth init |
| `src/lib/rootScope.ts` | global event emitter |
| `src/lib/appManagers/` | domain managers |
| `src/layer.d.ts` | MTProto API types (auto-generated) |
| `src/lang.ts` | tweb i18n strings |
| `vite.config.ts` | tweb build configuration |
| `server.js` | serves the compiled tweb in `public/` |

## Agent Workflow

- **Never duplicate code.** Before adding logic, helpers, components, styles, or
  constants, search the codebase for an existing implementation and reuse or
  extend it. Every final review must explicitly check the completed change for
  duplicated code and remove any duplication found.
- **After every context compaction, reread this entire `AGENTS.md` before
  continuing work.** A compacted context or summary does not replace the
  canonical instructions in this file.


## What NOT to do

(Style rules are in "Code style"; aliases, `invokeApi`-from-UI, and
`getUserMedia`-via-`getStream` are covered above and not repeated here.)

- **Never commit on your own initiative — only when explicitly asked.**
  Iterating on a feature must not produce a trail of commits: keep the work in
  the working tree, and when asked to commit, fold the whole feature into ONE
  commit (directly on master, no feature branch) unless told otherwise.
- **Do not fix a user-facing bug in `src/` without checking `astro/` first** (and
  `svelte/` while it is still the deployed client). The three codebases have
  separate UIs for the same features (pickers, chat, media); a fix in the Solid
  client reaches users only through whichever client is deployed.
- Do not hand-deploy with `pnpm deploy:svelte` when the intent is to ship —
  pushing to master is the deploy. A manual wrangler push puts the site on a
  build nobody can trace back to a commit.
- Never let a build-environment value reach the bundle unsanitised — the CI
  checkout's git remote carries an access token, and the bundle is public.
- Do not add `eslint-disable` / `oxlint-disable` without a reason
- Never hand-edit or run `format-lang` to regenerate
  `src/scripts/out/langPack.strings` — it is generated from `lang.ts` /
  `langSign.ts` by the Vite-wired watcher (`watch-lang.js`). Edit the `.ts`
  source only.
- Never hand-edit `src/lib/settingsSearch/generated.ts` — it is the settings-search index, generated from the tabs (see "Settings tabs are indexed for search"). Change what the tabs render, or the extractor, and let it regenerate.
- Do not import from `react` or use React patterns anywhere
- Do not use heavy CSS selectors (deep descendant chains, universal `*`,
  expensive attribute matchers, `:not()` with complex arguments) — prefer a
  dedicated class on the target element
- **Never add a blocking MTProto request on the chat-open path.** In tweb,
  `ChatInput.finishPeerChange` awaits a `Promise.all` before unfreezing the
  input — every entry is paid in chat-open latency. Do not add
  `appPrivacyManager.getGlobalPrivacySettings`, `appProfileManager.getProfile`
  for unrelated peers, fresh `account.*` fetches, or any new uncached round-trip
  there. Instead: read from a manager cache that is already warm
  (`apiManagerProxy.getAppConfig`, cached userFull), fetch lazily after render
  and reconcile via an event (`peer_full_update`, `privacy_update`), or preload
  at startup. Same rule for `appImManager.setPeer` and `setChatListeners`.

## Testing

```bash
pnpm test                  # all Vitest tests
pnpm test src/tests/foo    # one file
pnpm test:lottie           # Playwright (e2e/), tweb only
pnpm test:popups           # Playwright (e2e/), the popup sandbox
```

Vitest: `globals: true`, jsdom, `pool: 'forks'`, setup in `src/tests/setup.ts`.

Neither client has a unit-test suite. The Astro client's coverage is the guard
suites in `astro/scripts/*.test.mjs` (`npx vitest run astro/scripts/`), which
compare every component with its Svelte original, plus the browser check:
`pnpm build:astro`, serve `astro/dist`, and drive it — sign-in and the chat UI
need a real account, and a session stored in a Chrome profile can be reused for
that. Svelte-side changes are verified by driving `pnpm start:svelte`.

## Agents & shared tooling

Skills and commands live **in the repo** as the single source; per-agent
integration only points at them:

- **Skills** — `.claude/skills/*/SKILL.md` (standard Agent Skills format:
  `name` + `description` frontmatter, optional bundled scripts). Claude Code
  discovers them automatically. Codex discovers them via symlinks in
  `~/.codex/skills/` pointing at these directories. An agent without skill
  auto-discovery should still open the matching SKILL.md and follow it when a
  task fits its description. Paths inside skills are relative to the repo root.
  Note that these skills predate the Svelte client and are written about tweb.
- **Commands / prompts** — `.claude/commands/*.md` are slash-command prompt
  files (`$ARGUMENTS`-style placeholders); Codex reads them via symlinks in
  `~/.codex/prompts/`. Exception: `forge.md` is Claude-Code-only — it depends
  on a Claude statusline usage gate and will not work elsewhere.
- **Tool-name mapping** — skill/command texts may name Claude Code tools.
  Substitute your agent's equivalent: "Agent tool" / "subagent" / `Explore`
  → spawn a sub-task or do the search inline; browser-pane `preview_start`
  → run `bash scripts/start-preview.sh` and open the printed URL;
  `AskUserQuestion` → ask in chat.
- `.claude/launch.json` (preview servers) and `.claude/settings.local.json`
  (permissions) are Claude-Code-specific; the Codex counterpart is
  `~/.codex/config.toml`.

Re-create the Codex symlinks on a new machine (run from the repo root):

```bash
mkdir -p ~/.codex/skills ~/.codex/prompts
for s in graphify run-build tg-port-feature tweb-bugs tweb-mtproto-debug; do
  ln -sfn "$(pwd)/.claude/skills/$s" ~/.codex/skills/$s
done
for c in planner task refactor-popup-procedural; do
  ln -sfn "$(pwd)/.claude/commands/$c.md" ~/.codex/prompts/$c.md
done
```

<!-- rtk-instructions v2 -->
## RTK — token-optimized commands

If `rtk` is on PATH, prefix every shell command with it, including each command
inside `&&` chains: `rtk git add . && rtk git commit -m "msg"`. RTK applies a
filter when it has one, otherwise passes through unchanged — so it is always
safe. It is not installed everywhere; when `which rtk` finds nothing, run
commands plainly.
<!-- /rtk-instructions -->
