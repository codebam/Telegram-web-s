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

## What has landed since this audit

The P0 and P1 slices below were implemented in the Astro client after the rebase.
Everything here is verified by `pnpm typecheck:astro`, the 456 guard tests,
`pnpm build:astro`, and a signed-in browser run against the built client.

| Feature | What it does now |
|---|---|
| Dice / animated random 🎲 🎯 🎳 ⚽ 🏀 🎰 | Renders the sticker set Telegram keeps for the emoji: the roll loops while our own throw is unacknowledged, an outcome plays once, a message that was already read shows its settled frame. The slot machine composes its sprite-sheet parts. Verified end to end by sending a real dice. |
| Stories in a chat | A shared story renders as its 9:16 preview and opens the viewer; a story *mention* renders Telegram's card (author avatar, "X mentioned you in a story", View Story); an expired story says so instead of showing an empty frame. |
| Service messages | 77 of the 81 action types have Telegram's own wording (four bot/Passport actions fall back, since upstream has no wording for them either), with the actor/tense rules and the channel variants; the machine splitter that produced "Set messages t t l" survives only as the last resort. Also feeds the dialog and topic previews. |
| Payment & gift cards | An early `message.service` branch used to swallow three card types before the bubble body could render them; a gift code, a receipt and a Star gift now render their cards, and the gift-code card reads the `days` field the action actually carries instead of a non-existent `months`. |
| Pin / unpin a message | A Pin (or Unpin) entry in the message menu where `pin_messages` is ours, updating the pinned bar from what the server stored. |
| Join / subscribe | A channel or supergroup you left (or found by username) is read-only: the composer is replaced by a banner with a Join button, which joins through the peer type's own call. |
| Delete for me | A second delete that removes a message only for you — the only delete a member has for someone else's message — plus the same choice for a multi-selection. Supergroups and channels keep the for-everyone delete only, because `channels.deleteMessages` has no revoke flag and would delete for everyone regardless. |
| Message translation, voice-to-text | Both are asked for from the message menu and shown under the message. They are Premium features on Telegram's side, so a free account sees the server's refusal rather than a control that fails silently. |
| Hashtags, cashtags, bot commands | Clickable at last: a tag opens an in-chat search for it (and `#tag@channel` switches chat first), a command is sent — Telegram's own behaviour. |
| Formatted dates, collapsible quotes, code blocks | `messageEntityFormattedDate` renders as a live-ticking relative date (or an absolute one) and copies on click; a collapsed blockquote clips to three lines and expands; a code block gets its language label and a copy header. |
| Message menu reachability | The menu now anchors by its bottom edge when the click is in the lower half of the screen — with this many actions, its last entries used to fall off the bottom of the viewport. |

| Copy Message Link | A t.me link to one message, from the message menu: a public channel by username, a private one by its short id, a forum topic with its root in the path and a comment with the post it comments on. The seam now has one builder — `viewer.ts` and `reply.ts` each had their own, and only one of them converted the local message id, so the link the media viewer copied was wrong in every channel. |
| Report a message | From the message menu on a channel's or supergroup's messages, with the server's own reason list (never a hardcoded one) and its optional comment step. Until now the client could only report a *peer*, by sending an empty message-id list. |
| Editing a media message | Edit is offered on a photo, video, document or checklist by Telegram's own rule rather than our own flag, so a forwarded message, a bot-authored one, a sticker or one older than the chat's edit window is excluded; the composer edits the caption, and an empty caption is a valid edit. Replacing the file itself is not wired up yet. |
| Clear History | Two entries in a chat's context menu — for me, and for everyone where the server's rules allow it — each behind an "are you sure?" prompt, keeping the chat itself (`justClear` is what separates this from Delete/Leave). The permission and the wording come from tweb's own rules per chat kind. |
| Favourite stickers | A Favourites grid at the top of the picker's sticker pane, hidden entirely while empty, with a star on the recent and favourite tiles; the list and the live `stickers_updated` refresh come from the manager. |
| Repeating schedules | A Repeat row in the send-options sheet (Never, daily, weekly, every 2 weeks, monthly, every 3/6 months, yearly), gated behind Premium the way Telegram's own picker is; the period is shown on the scheduled row, and editing a repeating message keeps its period (upstream drops it). |

| Typing-action variety | The composer sends the action for what is actually happening (`sendMessageRecordAudioAction` while a voice note is being recorded, `sendMessageChooseStickerAction` while the sticker pane is open), and shows the peer's action with Telegram's own wording — "sending a photo", "recording video" — instead of "typing…" for everything. File uploads were already right: the manager reports those itself. |
| Captions above media | `invert_media` is read and the bubble puts its caption above the attachment the way the flag asks, moving the attachment in the DOM rather than reordering it with CSS, so the reading order matches the screen. Sending it works too: a "Caption above" pill in the attach sheet's send screen. |
| Animated single-emoji messages | A message that is nothing but emoji is drawn large (Telegram's 96/90/84/72/60/48/36px for one to seven of them, counted over graphemes), and a single emoji plays its animated sticker when the server has one. |
| Emoji suggestions | The suggestion strip answers an ordinary word as well as `/`, `@` and `#`: two letters or more is looked up in the emoji keyword index and the distinct matches are offered beside the word, Enter replacing it. |
| Replacing a media message's file | Edit offers "Replace media" for a photo, video, GIF or document of our own, sending the new file through `editMessageMedia` with the caption, so the message keeps its id, reactions and position. This also fixed the media URL cache, which was keyed by the message alone and would have served the replaced file's URL for the rest of the tab's life. |
| Reporting a multi-selection | Report is in the multi-selection bar beside Forward and Delete, and the flow carries the whole id list — the server's report state machine was always keyed to the peer and a list of messages; only the entry point sent one. |
| The six missing admin settings | Content protection, hidden members, join-to-send, pre-history and anti-spam are toggles in the edit pane, each a `channels.toggle*` call the layer already had; the group location is new — `channels.editLocation` had no wrapper in either client, so `appChatsManager.editLocation` was added, and "Use my location" takes the browser's coordinates since there is no map picker. |
| Admin log paging, search and filtering | The log was one page of 50 with no controls; it now uses the manager's own `getAdminLogs` (a cached fetcher per search/filter) so "Load more" walks a cursor and five event categories map onto the server's `channelAdminLogEventsFilter`. |
| Bulk delete | "Delete messages" on a member row deletes everything that user sent (`channels.deleteParticipantHistory`, tweb's own moderation call, gated by the `delete_messages` right); a basic group gets a From/To date-range section (`messages.deleteHistory`), while a channel does not, because `channels.deleteHistory` carries no date bounds. |

The P1 table below is clear. Its last six entries — captions above media,
animated single-emoji messages, emoji suggestions, typing-action variety,
replacing the *file* of a media message, and reporting a multi-selection — landed
in the slice recorded above; the P0 and P1 tables are kept as the audit found
them, and the "landed" table is what is true now. **Chat administration** has
since landed too: the six settings that had no UI, the admin log's paging/search/
filtering, and the two bulk deletes. What remains is the rest of the P2 areas
(group calls, RTMP, conferences, star-gift actions, sign-up, passkey login,
passcode lock, in-app browser and Instant View, channel statistics, settings
search), which are untouched.

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

**Admin** — the six settings, the admin-log filtering and the two bulk deletes
landed (see above). Still missing: no channel/group statistics, no revenue, no
suggested posts, no paid messages; no ownership transfer and no way to add
members to an existing group.

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

## Where to go next

The first three slices are done (see "What has landed since this audit" above):
the last of the P1 table, and then chat administration. The next natural slices,
smallest first:

1. **Search & discovery** — a hashtag can be searched inside a chat now, but the
   Public-posts scope (`channels.searchPosts`) and people-nearby are still
   absent, and the in-chat search has no `#`-scope rows.
2. **Calls** — group calls / voice chats are the largest missing area: nothing in
   the client calls `appGroupCallsManager` or `groupCallsController`, so a voice
   chat cannot be joined, and a video call cannot even be placed.
3. **Stars & gifts** — gifts are receive-only: no info popup, upgrade, wear,
   transfer, resale, collections or profile display.
