# AGENTS.md — Web S

Canonical instructions for **every** coding agent working in this repo (Claude
Code, Codex, Cursor, Zed, …). `CLAUDE.md` is only a pointer that imports this
file — edit AGENTS.md, never CLAUDE.md.

## Three apps live here — read this first

| | `astro/` | `svelte/` | `src/` |
|---|---|---|---|
| What | **Web S** — the client being migrated to | the previous client, still the one deployed | tweb (Telegram Web K), upstream client |
| Framework | Astro + Preact islands (`@preact/signals`) | SvelteKit + Svelte 5 runes | Solid.js (custom fork in `src/vendor/solid/`) |
| Deployed | not yet | **yes** — https://telegram.codebam.ca | no |
| Role | the target product | kept until the deploy switches | MTProto stack + managers both clients import |

**`svelte/` is being ported to `astro/`, file by file, and the port is complete in
the working tree.** Both clients are complete and independent: `astro/src/lib/telegram/`
is a copy of `svelte/src/lib/telegram/` (framework-clean, so the only edits were
import paths and comments), and every one of the 85 components has a Preact port.
`svelte/` stays in the tree, and stays the deployed app, until the Cloudflare Pages
build is pointed at `astro/` — that switch is a dashboard change, not a commit.

Which one to work on:

* **A user-facing bug** ("the app crashes", "the picker is broken") — fix `astro/`;
  that is the client being shipped. If the same bug is still live on the deployed
  site and the switch has not happened yet, port the fix to `svelte/` too, or say
  plainly that the fix only reaches users after the switch.
* **Anything in `src/`** — it is the whole MTProto/worker/manager layer plus the
  original Solid client, imported by *both* clients through the tweb path aliases.
  A fix there reaches users through whichever client is deployed.
* **`svelte/`** — only for that deploy-continuity case above, or when the task names
  the Svelte client explicitly. `astro/CONVERSION.md` documents the full mapping
  between the two, and is the reference to read before touching either.

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

## Migrating to Astro

The conversion is done but the deploy has not moved, so the rules below still matter.

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

Deployment is **CI**: the Cloudflare Pages GitHub integration builds `svelte/`
on every push to `master` and publishes it to https://telegram.codebam.ca. It is
configured in the Cloudflare dashboard, not in this repo — there is no workflow
file for it (`.github/workflows/production-image.yml` is upstream tweb's
tag-triggered Docker build and has nothing to do with the site). Pushing to
master ships. `pnpm deploy:svelte` exists as a manual wrangler escape hatch;
prefer the pipeline.

**Switching the deploy to the Astro client** is a dashboard change: build command
`pnpm run build:astro`, output directory `astro/dist`. Nothing in the repo needs to
change for it, and `astro/public/_headers` / `_redirects` already carry the
Cloudflare rules the new asset layout needs (`/_astro/*` immutable, SPA fallback,
real 404s for missing chunks).

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
| `src/lib/rootScope.ts` | global event emitter |
| `src/lib/appManagers/` | domain managers |
| `src/layer.d.ts` | MTProto API types (auto-generated) |
| `src/lang.ts` | tweb i18n strings |
| `vite.config.ts` | tweb build configuration |
| `server.js` | serves the compiled tweb in `public/` |

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
