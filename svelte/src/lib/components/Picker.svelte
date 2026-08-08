<script lang="ts">
  import Sticker from './Sticker.svelte';
  import {
    loadGifs,
    loadRecentStickers,
    loadSetStickers,
    loadStickerSets,
    type StickerItem,
    type StickerSetItem
  } from '$lib/telegram/chats';

  let {
    onemoji,
    ondocument
  }: {onemoji: (emoji: string) => void; ondocument: (docId: string) => void} = $props();

  type Tab = 'emoji' | 'stickers' | 'gifs';
  let tab = $state<Tab>('emoji');

  let recent = $state<StickerItem[]>([]);
  let sets = $state<StickerSetItem[]>([]);
  let setStickers = $state<Record<string, StickerItem[]>>({});
  let openSet = $state<string>('');
  let gifs = $state<StickerItem[]>([]);
  let loading = $state(false);

  // A compact built-in set; the full Unicode catalogue lives in tweb's emoji
  // data and is not needed to send any emoji (typing works too).
  const EMOJI_GROUPS: {name: string; emoji: string[]}[] = [
    {
      name: 'Smileys',
      emoji: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 👿 💀 💩 🤡'.split(' ')
    },
    {
      name: 'Gestures',
      emoji: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 ✍️ 💪 🦾 👏 🙌 👐 🤲 🤜 🤛 ✊ 👊'.split(' ')
    },
    {
      name: 'Hearts & symbols',
      emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🔥 ⭐ 🌟 ✨ ⚡ 💥 💫 🎉 🎊 🎈 🎁 ✅ ❌ ❓ ❗ 💯 👀'.split(' ')
    },
    {
      name: 'Animals & nature',
      emoji: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🐙 🦑 🦀 🐠 🐬 🐳 🌵 🌲 🌳 🌴 🌱 🌿 🍀 🌸 🌼 🌻 🌞 🌝 🌙 ⛅ ☔ ❄️'.split(' ')
    },
    {
      name: 'Food & objects',
      emoji: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶 🥒 🍞 🧀 🍗 🍔 🍟 🍕 🌭 🌮 🍿 🍩 🍪 🎂 🍰 🍫 🍬 ☕ 🍵 🍺 🍷 🥂 💻 📱 ⌨️ 🖥 🎧 📷 🎮 💡 🔑 🔒'.split(' ')
    }
  ];

  async function select(next: Tab) {
    tab = next;
    if(next === 'stickers' && !recent.length && !sets.length) {
      loading = true;
      try {
        [recent, sets] = await Promise.all([loadRecentStickers(), loadStickerSets()]);
      } finally {
        loading = false;
      }
    } else if(next === 'gifs' && !gifs.length) {
      loading = true;
      try {
        gifs = await loadGifs();
      } finally {
        loading = false;
      }
    }
  }

  async function toggleSet(set: StickerSetItem) {
    openSet = openSet === set.id ? '' : set.id;
    if(openSet && !setStickers[set.id]) {
      setStickers = {...setStickers, [set.id]: await loadSetStickers(set.id)};
    }
  }
</script>

<div class="picker">
  <div class="tabs">
    <button class:active={tab === 'emoji'} onclick={() => select('emoji')}>Emoji</button>
    <button class:active={tab === 'stickers'} onclick={() => select('stickers')}>Stickers</button>
    <button class:active={tab === 'gifs'} onclick={() => select('gifs')}>GIFs</button>
  </div>

  <div class="body">
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if tab === 'emoji'}
      {#each EMOJI_GROUPS as group}
        <p class="group">{group.name}</p>
        <div class="emoji-grid">
          {#each group.emoji as emoji}
            <button class="emoji" onclick={() => onemoji(emoji)}>{emoji}</button>
          {/each}
        </div>
      {/each}
    {:else if tab === 'stickers'}
      {#if recent.length}
        <p class="group">Recent</p>
        <div class="sticker-grid">
          {#each recent as sticker (sticker.docId)}
            <button onclick={() => ondocument(sticker.docId)}>
              <Sticker {sticker} size={64} />
            </button>
          {/each}
        </div>
      {/if}
      {#each sets as set (set.id)}
        <button class="group set" onclick={() => toggleSet(set)}>
          {openSet === set.id ? '▾' : '▸'} {set.title} ({set.count})
        </button>
        {#if openSet === set.id}
          <div class="sticker-grid">
            {#each setStickers[set.id] ?? [] as sticker (sticker.docId)}
              <button onclick={() => ondocument(sticker.docId)}>
                <Sticker {sticker} size={64} />
              </button>
            {/each}
          </div>
        {/if}
      {/each}
      {#if !recent.length && !sets.length}
        <p class="muted">No stickers.</p>
      {/if}
    {:else}
      <div class="gif-grid">
        {#each gifs as gif (gif.docId)}
          <button onclick={() => ondocument(gif.docId)}>
            <Sticker sticker={gif} size={110} />
          </button>
        {/each}
      </div>
      {#if !gifs.length}<p class="muted">No saved GIFs.</p>{/if}
    {/if}
  </div>
</div>

<style>
  .picker {
    position: absolute;
    bottom: 100%;
    right: 18px;
    width: min(380px, calc(100% - 36px));
    height: 340px;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    z-index: 20;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .tabs button {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .tabs button.active {
    color: var(--accent);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px 12px;
  }

  .group {
    margin: 10px 2px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  button.set {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
    gap: 2px;
  }

  .emoji {
    font-size: 22px;
    line-height: 1;
    padding: 4px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .emoji:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .sticker-grid,
  .gif-grid {
    display: grid;
    gap: 4px;
  }

  .sticker-grid {
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  }

  .gif-grid {
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  }

  .sticker-grid button,
  .gif-grid button {
    background: none;
    border: none;
    padding: 2px;
    border-radius: 8px;
    cursor: pointer;
  }

  .sticker-grid button:hover,
  .gif-grid button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .muted {
    color: var(--text-dim);
    padding: 12px;
    font-size: 13px;
  }
</style>
