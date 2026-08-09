# AGENTS.md — Web S

Canonical instructions for **every** coding agent working in this repo (Claude
Code, Codex, Cursor, Zed, …). `CLAUDE.md` is only a pointer that imports this
file — edit AGENTS.md, never CLAUDE.md.

## Two apps live here — read this first

| | `svelte/` | `src/` |
|---|---|---|
| What | **Web S** — the app this repo ships | tweb (Telegram Web K), upstream client |
| Framework | SvelteKit + Svelte 5 runes | Solid.js (custom fork in `src/vendor/solid/`) |
| Deployed | **yes** — https://telegram.codebam.ca | no |
| Role | the product | MTProto stack + managers the product imports |

**The application in this repo is the SvelteKit one.** `svelte/` is what gets
built and deployed; a user-facing bug ("the web app crashes", "the picker is
broken") means `svelte/`, and a fix landed only in `src/` ships to nobody.

`src/` is not dead code — it is the whole MTProto/worker/manager layer plus the
original Solid client, and `svelte/` imports it directly through the tweb path
aliases. Touch `src/` when the fix genuinely belongs to that shared layer (a
manager, the protocol, a helper), and expect it to reach users only through the
Svelte app.

Default to `svelte/` unless the task names tweb, the Solid client, or a manager.

## Development

```bash
pnpm install

pnpm start:svelte      # Web S dev server on :8081   <- the usual one
pnpm build:svelte      # -> svelte/build/
pnpm preview:svelte
pnpm deploy:svelte     # build + wrangler pages deploy -> project tweb-svelte

pnpm start             # tweb (Solid) dev server on :8080
pnpm build             # typecheck + changelog + tweb build -> dist/

pnpm typecheck         # tsc --noEmit over the whole repo
pnpm lint              # oxlint, src/ only (tweb) — does not cover svelte/
pnpm test              # Vitest
pnpm test:lottie       # Playwright specs in e2e/
```

Deployment is **manual**: `pnpm deploy:svelte` pushes `svelte/build` to
Cloudflare Pages with wrangler. Nothing deploys on push, so a merged commit is
not a released commit. Both apps read `.env` at the repo root (`VITE_API_ID`,
`VITE_API_HASH`, `VITE_MTPROTO_*`).

Debug query params (both apps, they share the stack): `?test=1` (test DCs),
`?debug=1` (verbose logging), `?noSharedWorker=1`.

The running build stamps its own commit into the bundle (see
`svelte/src/lib/buildInfo.ts`): the short SHA sits in the corner of the empty
chat pane and at the bottom of the sign-in card, linking to that commit on
GitHub. It is the quickest way to tell whether a deploy actually happened.

### tweb preview

Launch an authorized local tweb preview with `bash scripts/start-preview.sh`
(never plain `vite`) — it mints a fresh per-preview auth + picks a free port.
`.claude/launch.json` wires it into Claude Code's preview pane; other agents run
the script directly and open the printed URL.

## Directory structure

```
svelte/                       # THE APP
├── src/
│   ├── routes/
│   │   ├── +page.svelte      # auth flow (phone → code → password) + <Chat/>
│   │   └── +layout.svelte
│   ├── lib/
│   │   ├── components/       # 18 components: Chat, Picker, Sticker, Media, …
│   │   ├── telegram/         # the seam onto tweb's managers
│   │   │   ├── client.ts     # bootTelegram(): boots the worker, returns managers
│   │   │   ├── auth.ts       # sendCode / signIn / checkPassword
│   │   │   ├── chats.ts      # dialogs, messages, media, stickers, GIFs (~1.8k lines)
│   │   │   ├── extras.ts     # calls, stories, mini apps, folders
│   │   │   ├── loadQueue.ts  # bounded media-download queue
│   │   │   ├── staleGuard.ts # __BUILD_ID__ check for cached bundles
│   │   │   └── settings.ts / theme.ts / markdown.ts / notifications.ts
│   │   └── buildInfo.ts      # __GIT_COMMIT__ → link to the built commit
│   ├── app.html / app.css
├── static/                   # _redirects, _headers, manifest, icons
├── build/                    # adapter-static output (gitignored)
├── svelte.config.js          # adapter-static SPA fallback + tweb aliases
└── vite.config.ts            # tweb aliases, solid plugin for .tsx, defines

src/                          # tweb — shared stack + the Solid client
├── components/               # Solid UI (.tsx), 200+ feature folders
├── lib/
│   ├── appManagers/          # 55+ domain managers — the API the Svelte app uses
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

`svelte/` uses SvelteKit's `$lib` for its own code **and** tweb's aliases for the
shared layer — both are declared in `svelte/svelte.config.js` and mirrored in
`svelte/vite.config.ts`. Never reach into tweb with relative `../../src/…`.

```typescript
$lib/*          → svelte/src/lib/           // Svelte app's own code
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

## Svelte 5 conventions

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
- `pnpm typecheck` covers both apps and currently reports pre-existing errors in
  `src/tests/**` and a few `svelte/src/lib/telegram/*` signatures — check that
  your file is clean rather than expecting a clean run

## Important files

| File | Purpose |
|---|---|
| `svelte/src/routes/+page.svelte` | auth flow and app entry |
| `svelte/src/lib/components/Chat.svelte` | the whole chat UI |
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
- **Do not fix a user-facing bug in `src/` without checking `svelte/` first.**
  The two apps have separate UIs for the same features (pickers, chat, media);
  a fix in the Solid client does not reach the deployed app.
- Do not assume a push is live — Cloudflare Pages is updated by
  `pnpm deploy:svelte`, by hand.
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
There is no test suite for `svelte/` — verify Svelte changes by driving the app
in a browser against `pnpm start:svelte`.

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
