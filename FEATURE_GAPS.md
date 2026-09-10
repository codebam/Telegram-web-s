# Web S feature gaps

What our client (`astro/`) is missing, measured against upstream tweb's
[`TELEGRAM_FEATURES.md`](TELEGRAM_FEATURES.md) — the 657-row matrix of Telegram
features. That file records **upstream tweb's own Solid client**, so a ✅ there is
not a ✅ here; this file is the answer for us.

Audited after the rebase onto upstream master `4a82cc766` (Sep 2026). Six passes,
one per section group, each reading the code that does the job and citing it; the
load-bearing claims were re-checked by hand afterwards.

**The port is not a factor.** `astro/src/lib/telegram/` is byte-identical to
`svelte/src/lib/telegram/` apart from `admin.ts`, and all 85 components have a
Preact port. Every gap below is a **product** gap — missing in both clients — not
something lost in the Svelte → Preact conversion. Where upstream tweb lacks the
feature too it is marked *(upstream too)*, i.e. nobody has it.

---

## What the rebase gave us

77 of the 125 upstream commits touched the shared layer our client imports
(`src/lib`, `src/helpers`, `src/config`, `src/lang.ts`, `src/stores`). All of it
now runs under the Astro client — verified by driving the rebuilt bundle signed
in (dialogs, media downloads, day dividers, link previews, zero console errors).

| Area | What landed |
|---|---|
| Dialogs & storage | row release/re-render fixes, subtitle elision, spoiler recolor, folder recovery, pin limits across archived folders, typing in freshly built rows, unread counters the server admits are inexact |
| Messages | topic paging by server offsets, "load every topic in a big forum", dice replay, spoiler rendering that cannot brick a chat, Clear History support (`canClearHistory`), jump centring |
| Media | bounded finished-download cache, lazy-load items dropped when their owner dies, object-URL registry/scope + `pinObjectURL`, frame url/height handling |
| Privacy/security | link-host validation, faked-domain warning, Instant View URL validation, mention parsing, call security audit fixes (E2E) |
| i18n | day-period rendering, plural-form selection from the count, cached `Intl` formatter |
| New surface | `appSavedMusicManager`, settings-search index, `highlightText()`, popup sandbox (dev), tlottie no-SIMD build |

---

## P0 — messages that render wrong or not at all

| Gap | Effect for a user | Evidence |
|---|---|---|
| Dice / animated random 🎲 🎯 🎰 | The bubble is **completely empty** | no `messageMediaDice` case in `astro/src/lib/telegram/chats.ts` (`mediaOf`) or `messageTypes.ts` (`extraOf`); upstream renders it in `src/components/chat/bubbleParts/dice.ts`, and `messages.getEmojiGameInfo` exists in the schema |
| Stories shared into a chat (`messageMediaStory`) | Blank bubble | only `astro/src/lib/telegram/reply.ts:145` returns the literal `'Story'`, for a reply preview; nothing renders the media |
| Live-stream messages (`messageMediaVideoStream`) | Blank and unjoinable | no group-call/video-stream code at all (see P2) |
| ~28 service actions | Machine-generated text: "Set messages t t l", "Payment sent me", "Gift ton", "Topic create" | `astro/src/lib/telegram/chats.ts:576-630` (`serviceText`) has real branches for 11 `messageAction*` types; everything else falls through to a camelCase splitter |
| Payment / gift-code cards | The card never appears, only the fallback text | `Chat.tsx:4378` renders `message.service` as `<p>{message.text}</p>` *before* the bubble body, so `MessagePayment` (`Chat.tsx:4629`) — and its `paymentSent` / `giftCode` / `starGift` branches — is unreachable for service messages |
| Pin / unpin a message | You cannot pin from this client; the pinned bar can only be read and dismissed | no Pin item in the message menu (`Chat.tsx:5181-5212`), while the manager supports it (`appMessagesManager.updatePinnedMessage`, `src/lib/appManagers/appMessagesManager.ts:6242`) |

## P1 — everyday actions that are missing

| Gap | Evidence |
|---|---|
| Join / subscribe a public channel or group | `pFlags.left` is never read and `channels.joinChannel` is never called; only invite-hash joins work (`astro/src/lib/telegram/links.ts:370`) |
| Delete for me (vs for everyone) | both delete paths default `revoke = true` and neither caller passes `false` (`chats.ts:1050,1109`) |
| Copy message link, report a specific message | no `t.me/c/…` builder in the message path; `reportMessages(peerId, [], …)` sends an empty id list (`profile.ts:453-472`) |
| Hashtags / cashtags / bot commands in received messages are inert | `FormattedText.tsx:93` skips `mentionKind === 'tag'`; there is no hashtag or public-posts search (`channels.searchPosts` unused) — upstream added hashtag search in this rebase |
| Message translation, voice-to-text transcription | absent entirely, both advertised on the Premium page (`payments.ts:1084,1090`) |
| Collapsible quotes, formatted dates, code highlighting | the quote is a plain bordered span (`FormattedText.css:42-48`), `messageEntityFormattedDate` is unknown, `messageEntityPre.language` is dropped before render |
| Repeating scheduled messages, captions-above-media, favourite stickers, animated single-emoji messages, emoji suggestions | no `schedule_repeat_period`, no `show_caption_above_media`, no fave tab, no big-emoji path, suggestion strip handles only `/ @ #` |
| Clear History for a normal chat | upstream added `canClearHistory` + the manager paths; our only "Clear history" is in `BotBar.tsx:55` |
| Edit media / media-only messages, typing-action variety, view-once media | `editMessageMedia` never called and Edit shows only when `message.text`; only typing/cancel actions are sent; self-destructing media shows a placeholder (`Chat.tsx:4500-4506`) |

## P2 — whole feature areas

**Calls** — group calls / voice chats have no create, join, participant list,
video, scheduling or settings UI (`appGroupCallsManager`, `groupCallsController`
never called); RTMP live streaming is absent ("rtmp" is not a string in the
client); conference calls and shareable call links are absent; a video call
cannot be *placed* (`startCall` never receives `isVideo`); there is no
Speakers & Camera device selection, and the mic pre-flight bypasses the
`getStream` chokepoint (`extras.ts:166`).

**Stars & gifts** — star gifts are receive-only: no info popup, upgrade to
collectible, wear, transfer, resale/buy-resale, collections, gifts on profiles,
value/floor price, offers, auctions, crafting or themes; no stars
revenue/withdrawal, subscriptions, commission or exchange rates; paid messages
unsupported in both directions; suggested posts cannot be approved or rejected;
no stars rating.

**Stories** — no entry point on avatars or profiles (only the sidebar strip),
no music in stories, no weather/hashtag widgets, no live stories *(upstream
too)*, plain-text captions only.

**Auth & security** — sign-up is a hardcoded refusal (`App.tsx:142-144`), no
email recovery, no passkey login, no email-setup-on-sign-in, no code resend;
no passcode lock; content protection (`noforwards`) is neither settable nor
honoured; no age verification, no frozen-account handling *(upstream partially)*.

**Browsing** — no in-app browser and no Instant View: external links, bot games
and articles all eject to an OS browser tab (`Chat.tsx:2262`,
`GameBubble.tsx:44-47`); web-page previews drop the page photo.

**Admin** — no channel/group statistics, no revenue, no suggested posts, no paid
messages; six chat-admin settings have no UI (content protection, hidden
members, join-to-send, pre-history, anti-spam, location); the admin log is
capped at 50 rows with no filtering; no bulk delete by user or date range; no
ownership transfer and no way to add members to an existing group.

**Mini apps** — location access answers a hardcoded `available: false`
(`MiniApp.tsx:300-306`); fullscreen is refused; emoji-status access is
unhandled; `web_app_allowed_protocols` is unenforced and events post to `'*'`.

**Settings & personalisation** — per-chat wallpaper/theme/TTL do not exist
(the UI admits the wallpaper gap at `AppearanceSettings.tsx:445-449`);
per-chat notifications are mute-only; the language picker switches the shared
lang pack but the client's own labels stay English; several animation toggles
persist without a consumer; business chat links are absent and quick replies
cannot be created (which also blocks greeting/away); no global posts search,
people nearby or recommended channels; passkeys and multiple usernames are not
manageable.

**Media editor** — the strongest area (crop, adjustments, five brush tools,
text/sticker layers, real video re-encode all work); missing WebGL, a real
colour picker (fixed 10-swatch palette) and a rotation wheel.

---

## Suggested first slice

Small, self-contained, and each one turns a wrong-or-blank rendering into the
real thing — the manager layer already supports all of them:

1. **Dice** — add the `messageMediaDice` media kind and the animated reveal
   (port `src/components/chat/bubbleParts/dice.ts`).
2. **Story messages** — render `messageMediaStory` as a tappable card.
3. **Service-message text** — extend `serviceText` to the remaining
   `messageAction*` types, with the actor, amount and tense Telegram uses
   (port the wording from upstream's service parts).
4. **Payment / gift-code cards** — stop the early `message.service` branch from
   swallowing the card types.
5. **Pin / unpin** — a Pin item in the message menu calling
   `appMessagesManager.updatePinnedMessage`.
6. **Join / subscribe** — a Join button on a chat you have left, calling
   `channels.joinChannel` (`pFlags.left`).
