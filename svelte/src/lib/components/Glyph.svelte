<script lang="ts">
  /**
   * Line icons for the app's own controls.
   *
   * These replace the emoji that used to stand in for buttons. An emoji is a
   * font glyph: it renders in a different style, weight and colour on every
   * platform, ignores `currentColor`, and reads as placeholder rather than
   * interface. Emoji people actually send are untouched — this is only for
   * chrome.
   */
  type GlyphName =
    | 'settings'
    | 'edit'
    | 'call'
    | 'search'
    | 'emoji'
    | 'attach'
    | 'send'
    | 'check'
    | 'down'
    | 'app'
    | 'pin'
    | 'muted'
    | 'file'
    | 'save'
    | 'close';

  let {name, size = 18}: {name: GlyphName; size?: number} = $props();
</script>

<svg
  class="glyph"
  width={size}
  height={size}
  viewBox="0 0 20 20"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if name === 'settings'}
    <circle cx="10" cy="10" r="2.6" />
    <path
      d="M10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.4 5.4l1.1 1.1M13.5 13.5l1.1 1.1M14.6 5.4l-1.1 1.1M6.5 13.5l-1.1 1.1"
    />
  {:else if name === 'edit'}
    <path d="M13.4 3.6l3 3L7.8 15.2l-3.9.9.9-3.9 8.6-8.6z" />
  {:else if name === 'call'}
    <path
      d="M6.3 3.6l2 .3 1 2.6-1.5 1.3a8.6 8.6 0 004.4 4.4l1.3-1.5 2.6 1 .3 2a1.4 1.4 0 01-1.5 1.5C9.6 15 5 10.4 4.8 5.1A1.4 1.4 0 016.3 3.6z"
    />
  {:else if name === 'search'}
    <circle cx="9" cy="9" r="5.2" />
    <path d="M12.8 12.8l3.6 3.6" />
  {:else if name === 'emoji'}
    <circle cx="10" cy="10" r="6.8" />
    <path d="M7.3 11.7a3.3 3.3 0 005.4 0" />
    <circle cx="7.7" cy="8.3" r="0.85" fill="currentColor" stroke="none" />
    <circle cx="12.3" cy="8.3" r="0.85" fill="currentColor" stroke="none" />
  {:else if name === 'attach'}
    <path d="M13.6 9.3l-4.4 4.4a2.6 2.6 0 01-3.7-3.7l5.3-5.3a1.8 1.8 0 012.5 2.5l-5.2 5.2a0.9 0.9 0 01-1.3-1.3l4.5-4.5" />
  {:else if name === 'send'}
    <path d="M10 16V4.6M10 4.6L5.6 9M10 4.6L14.4 9" />
  {:else if name === 'check'}
    <path d="M4.4 10.4l3.7 3.7 7.5-8" />
  {:else if name === 'down'}
    <path d="M10 4v11.4M10 15.4L5.6 11M10 15.4L14.4 11" />
  {:else if name === 'app'}
    <path d="M7.6 5.4l6.4 4.6-6.4 4.6V5.4z" />
  {:else if name === 'pin'}
    <path d="M12.1 2.9l5 5-2 .6-1 1 .5 3.4-2.2-.8-5.6 5.6.5-3.3-2.4-2.4-3.3.5L7.2 6.9l-.8-2.2 3.4.5 1-1 .6-2z" />
  {:else if name === 'file'}
    <path d="M11.2 2.8H6.4a1.6 1.6 0 00-1.6 1.6v11.2a1.6 1.6 0 001.6 1.6h7.2a1.6 1.6 0 001.6-1.6V6.6l-4-3.8z" />
    <path d="M11.2 2.8v3.9h3.9" />
  {:else if name === 'save'}
    <path d="M10 3.4v8.8M10 12.2L6.4 8.6M10 12.2l3.6-3.6" />
    <path d="M4.4 14.2v1.2a1.4 1.4 0 001.4 1.4h8.4a1.4 1.4 0 001.4-1.4v-1.2" />
  {:else if name === 'muted'}
    <path d="M6.6 8.2a3.4 3.4 0 016.8 0c0 3.2 1.3 4.3 1.3 4.3H5.3s1.3-1.1 1.3-4.3z" />
    <path d="M8.7 15a1.5 1.5 0 002.6 0" />
    <path d="M3.8 3.6l12.4 12.8" />
  {:else if name === 'close'}
    <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
  {/if}
</svg>

<style>
  .glyph {
    display: block;
    flex: none;
  }
</style>
