/*
 * Ported from svelte/src/lib/components/FormattedText.svelte.
 *
 * `plain`, `source` and `asMarkdown` were `$derived` over the `parts` and
 * `markdown` *props*, not over signals, so they are plain values recomputed each
 * render — a `useComputed` would never notice a new message arrive. The
 * `{#if} {:else if} … {:else}` chain that picked one element per run is the
 * early-return chain in `renderPart` below.
 *
 * Three kinds of run carry state of their own — a collapsed quote measures
 * itself, a relative date re-formats on a timer, a code block copies — and each
 * is a file-local component (`QuoteRun`, `FormattedDateRun`, `CodeBlockHeader`)
 * instead of a hook called from `renderPart`: hooks are keyed by call position,
 * so one called inside a `.map()` lands on whatever ran there on the previous
 * render. The quote and the code block render a `<blockquote>` and a `<div>`,
 * neither of which a `<p>` may contain — the HTML parser closes the paragraph
 * early and the rest of the message ends up outside it — so the wrapper is a
 * `<div class="text">`, the same class the stylesheet already targets.
 */
import {useEffect, useMemo} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {formatFormattedDate, formatRelativeTime, type FormattedDateFlags} from '$lib/telegram/dates';
import type {TextPart} from '$lib/telegram/chats';
import {looksLikeMarkdown} from '$lib/telegram/markdown';

import {CustomEmoji} from './CustomEmoji';
import {Markdown} from './Markdown';

import './FormattedText.css';
import '../styles/richText.css';

interface Props {
  parts: TextPart[];
  /**
   * Also treat inline markers (**bold**, `code`, links) as Markdown. Off by
   * default: people type asterisks in ordinary messages and mangling those
   * would be worse than showing them. Rich-message blocks opt in, because
   * their authors are bots writing Markdown.
   */
  markdown?: boolean;
  /** Called with a @username or a bare user id when a mention is clicked. */
  onmention?: (mention: string, kind: 'username' | 'userId') => void;
  /**
   * Given a first chance at a link. Returning true means it was handled in
   * the app — a t.me mini app link, say — and the browser should not follow it.
   */
  onlink?: (url: string) => boolean;
  /**
   * Called with the tag's own text when a hashtag, a cashtag or a bot command
   * is clicked. Without it those runs are inert, like every other mention.
   */
  ontag?: (text: string, kind: 'hashtag' | 'cashtag' | 'botCommand') => void;
  /** Called with the unix time of a formatted date when it is clicked. */
  ondate?: (unix: number) => void;
}

interface QuoteRunProps {
  text: string;
  collapsed: boolean;
  /** The inline formatting the same run carries (`bold`, `code` …), if any. */
  formatted: string;
}

/**
 * A `blockquote` run. Telegram's `collapsed` flag clips it to three lines until
 * it is clicked — tweb's `makeQuoteCollapsable` in
 * `src/lib/richTextProcessor/wrapRichText.ts`, whose `is-truncated` /
 * `is-expanded` classes are kept by name — and the chevron is only shown once
 * the content is known to be clipped, which is what the `ResizeObserver`
 * measures. Both pieces of state belong to one quote, so this is a component.
 */
function QuoteRun({text, collapsed, formatted}: QuoteRunProps) {
  const expanded = useSignal(false);
  // Measured rather than assumed: a quote that fits has nothing to open.
  const truncated = useSignal(false);
  // The observer below reacts to the element appearing, so this is a signal
  // with a callback ref rather than a plain ref (CONVERSION.md §4).
  const quote = useSignal<HTMLQuoteElement | null>(null);
  const setQuote = useMemo(() => (node: HTMLQuoteElement | null) => {
    quote.value = node;
  }, []);

  useEffect(() => {
    const node = quote.value;
    if(!node || !collapsed) return;

    const measure = () => {
      const scrollHeight = node.scrollHeight;
      if(!scrollHeight) return;

      // `scrollHeight` is the whole content however the box is clipped, so it
      // is also the height the quote opens to.
      node.style.setProperty('--ft-quote-height', scrollHeight + 'px');

      // While it is open the box is not clipped, so the measurement that says
      // whether it *needs* opening cannot be taken — the last one stands.
      if(expanded.value) return;

      truncated.value = scrollHeight - node.clientHeight > 1;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, quote.value]);

  function onClick(e: MouseEvent) {
    if(!collapsed || (!truncated.value && !expanded.value)) return;

    // Selecting the quote's text is not a toggle. tweb checks the same in
    // src/helpers/dom/onQuoteClick.ts.
    const selection = (e.currentTarget as HTMLElement).ownerDocument.defaultView?.getSelection();
    if(selection && !selection.isCollapsed) return;

    expanded.value = !expanded.value;
  }

  const classes = [
    'quote',
    'ft-quote-block',
    // Entities nest, so a run can be a quote *and* bold, code or italic.
    formatted,
    collapsed && 'ft-quote-collapsable',
    collapsed && expanded.value && 'is-expanded',
    collapsed && truncated.value && 'is-truncated'
  ].filter(Boolean).join(' ');

  return (
    <blockquote class={classes} ref={setQuote} onClick={onClick}>
      {text}
      {collapsed && <span class="ft-quote-chevron" />}
    </blockquote>
  );
}

interface FormattedDateRunProps {
  unix: number;
  flags: FormattedDateFlags;
  /** The inline formatting the same run carries (`bold`, `code` …), if any. */
  formatted: string;
  ondate?: (unix: number) => void;
}

/** The label a formatted date shows right now, relative or not. */
function dateText(unix: number, flags: FormattedDateFlags) {
  // A relative date ignores the rest of the flags, the way upstream's
  // `wrapRichText` picks one of the two renderings.
  return flags.relative ?
    formatRelativeTime(unix, Math.floor(Date.now() / 1000)).text :
    formatFormattedDate(unix, flags);
}

/**
 * A `messageEntityFormattedDate` run. A relative one is re-rendered on the
 * boundary `formatRelativeTime` reports — "in 5 minutes" has to become "in
 * 4 minutes" on the minute, not on some cadence of our own — and the label
 * lives in a signal, like the spoiler's `revealed` above, so a tick repaints
 * the one run.
 */
function FormattedDateRun({unix, flags, formatted, ondate}: FormattedDateRunProps) {
  const label = useSignal(dateText(unix, flags));
  const relative = flags.relative === true;

  useEffect(() => {
    if(!relative) return;

    let timerId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = formatRelativeTime(unix, Math.floor(Date.now() / 1000));
      label.value = next.text;
      timerId = setTimeout(tick, next.updateInterval);
    };

    tick();
    return () => clearTimeout(timerId);
  }, [unix, relative]);

  return (
    <span
      class={['formatted-date', ondate && 'ft-date-clickable', formatted].filter(Boolean).join(' ')}
      onClick={ondate ? () => ondate(unix) : undefined}
    >{label.value}</span>
  );
}

interface CodeBlockHeaderProps {
  /** Raw text of the block — what the copy gesture puts on the clipboard. */
  code: string;
  /** The `language` the sender tagged the block with, '' when there was none. */
  language: string;
}

/**
 * The header tweb draws above a code block: the language on the left, a copy
 * gesture on the right, and no highlighting — the body stays plain text.
 * Upstream copies the block on a click anywhere in it
 * (`getCodeBlockClickTarget` in `src/components/chat/bubbles.ts`); here the
 * gesture is the header, which is the part that advertises it.
 *
 * Nameless and unknown languages get no label: the copy button's own "copy" is
 * then the whole header.
 */
export function CodeBlockHeader({code, language}: CodeBlockHeaderProps) {
  const name = codeLanguageName(language);

  const copy = () => {
    // A denied or absent clipboard — an unfocused tab, a non-secure origin —
    // must not throw out of the click handler.
    void navigator.clipboard?.writeText(code).catch(() => {});
  };

  return (
    <div class="ft-code-header" onClick={copy}>
      {name && <span class="ft-code-language">{name}</span>}
      <button
        type="button"
        class="ft-code-copy"
        onClick={(e) => {
          e.stopPropagation();
          copy();
        }}
      >copy</button>
    </div>
  );
}

/**
 * The display name of the language a code block was tagged with — 'js' reads as
 * 'JavaScript' — or '' when the sender gave nothing we know.
 *
 * Ported from the `CodeLanguageAliases` table tweb builds out of
 * `CodeLanguageMap` in `src/codeLanguages.ts`. Only the aliases that differ from
 * a language's own name are listed below: upstream unshifts
 * `language.toLowerCase()` into every language's alias list, so a language that
 * is only known by its own name ('Ada', 'Zig') needs no entry and the fallback
 * covers it. The map is data because upstream's module pulls in Prism.
 */
function codeLanguageName(language: string) {
  if(!language) return '';
  const alias = language.toLowerCase();
  return CODE_LANGUAGE_ALIASES[alias] || CODE_LANGUAGE_NAMES[alias] || '';
}

const CODE_LANGUAGE_ALIASES_TEXT: Record<string, string> = {
  'Markup': 'html xml svg mathml ssml atom rss',
  'C-like': 'clike',
  'JavaScript': 'js',
  'ANTLR4': 'g4',
  'Apache Configuration': 'apacheconf',
  'C++': 'cpp',
  'Arduino': 'ino',
  'ARM Assembly': 'armasm arm-asm',
  'Bash': 'sh shell',
  'YAML': 'yml',
  'Markdown': 'md',
  'Arturo': 'art',
  'AsciiDoc': 'adoc',
  'C#': 'csharp cs dotnet',
  'ASP.NET (C#)': 'aspnet',
  '6502 Assembly': 'asm6502',
  'Atmel AVR Assembly': 'asmatmel',
  'AviSynth': 'avs',
  'Avro IDL': 'avro-idl avdl',
  'AWK': 'gawk',
  'BBcode': 'shortcode',
  'BNF': 'rbnf',
  'CFScript': 'cfc',
  'Cilk/C': 'cilkc cilk-c',
  'Cilk/C++': 'cilkcpp cilk-cpp cilk',
  'CoffeeScript': 'coffee',
  'Concurnas': 'conc',
  'Content-Security-Policy': 'csp',
  'Ruby': 'rb',
  'Markup templating': 'markup-templating',
  'Django/Jinja2': 'django jinja2',
  'DNS zone file': 'dns-zone-file dns-zone',
  'Docker': 'dockerfile',
  'DOT (Graphviz)': 'dot gv',
  'EJS': 'eta',
  'Embedded Lua templating': 'etlua',
  'Excel Formula': 'excel-formula xlsx xls',
  'F#': 'fsharp',
  'Firestore security rules': 'firestore-security-rules',
  'FreeMarker Template Language': 'ftl',
  'GameMaker Language': 'gml gamemakerlanguage',
  'GAP (CAS)': 'gap',
  'G-code': 'gcode',
  'gettext': 'po',
  'GN': 'gni',
  'GNU Linker Script': 'linker-script ld',
  'Go module': 'go-module go-mod',
  'Sass (SCSS)': 'scss',
  'Handlebars': 'hbs mustache',
  'Haskell': 'hs',
  'HTTP Public-Key-Pins': 'hpkp',
  'HTTP Strict-Transport-Security': 'hsts',
  'JSON': 'webmanifest',
  'URI': 'url',
  'ICU Message Format': 'icu-message-format',
  'Idris': 'idr',
  '.ignore': 'ignore gitignore hgignore npmignore',
  'Inform 7': 'inform7',
  'JavaDoc-like': 'javadoclike',
  'Java stack trace': 'javastacktrace',
  'TypeScript': 'ts',
  'N4JS': 'n4jsd',
  'JS stack trace': 'jsstacktrace',
  'Keepalived Configure': 'keepalived',
  'Kotlin': 'kt kts',
  'LaTeX': 'tex context',
  'LilyPond': 'ly',
  'Lisp': 'emacs elisp emacs-lisp',
  'LLVM IR': 'llvm',
  'Log file': 'log',
  'Magma (CAS)': 'magma',
  'MoonScript': 'moon',
  'Nand To Tetris HDL': 'nand2tetris-hdl',
  'Naninovel Script': 'naniscript nani',
  'Objective-C': 'objectivec objc',
  'OpenQasm': 'qasm',
  'PARI/GP': 'parigp',
  'Pascal': 'objectpascal',
  'PATROL Scripting Language': 'psl',
  'PC-Axis': 'pcaxis px',
  'PeopleCode': 'pcode',
  'PlantUML': 'plant-uml',
  'PL/SQL': 'plsql',
  'PowerQuery': 'pq mscript',
  '.properties': 'properties',
  'Protocol Buffers': 'protobuf',
  'PureBasic': 'pbfasm',
  'Python': 'py',
  'Q#': 'qsharp qs',
  'Q (kdb+ database)': 'q',
  'Racket': 'rkt',
  'Razor C#': 'cshtml razor',
  'React JSX': 'jsx',
  'React TSX': 'tsx',
  'Ren\'py': 'renpy rpy',
  'ReScript': 'res',
  'reST (reStructuredText)': 'rest',
  'Robot Framework': 'robotframework robot',
  'Sass (Sass)': 'sass',
  'Shell session': 'shell-session sh-session shellsession',
  'SML': 'smlnj',
  'Solidity (Ethereum)': 'solidity sol',
  'Solution file': 'solution-file sln',
  'Soy (Closure Template)': 'soy',
  'Splunk SPL': 'splunk-spl',
  'SQF: Status Quo Function (Arma 3)': 'sqf',
  'Stata Ado': 'stata',
  'Structured Text (IEC 61131-3)': 'iecst',
  'SuperCollider': 'sclang',
  'Systemd configuration file': 'systemd',
  'T4 templating': 't4-templating',
  'T4 Text Templates (C#)': 't4-cs t4',
  'VB.Net': 'vbnet',
  'T4 Text Templates (VB)': 't4-vb',
  'Template Toolkit 2': 'tt2',
  'Tremor': 'trickle troy',
  'TypoScript': 'tsconfig',
  'UnrealScript': 'uscript uc',
  'UO Razor Script': 'uorazor',
  'Visual Basic': 'visual-basic vb vba',
  'WebAssembly': 'wasm',
  'Web IDL': 'web-idl webidl',
  'Wiki markup': 'wiki',
  'Wolfram language': 'wolfram mathematica nb wl',
  'Xeora': 'xeoracube',
  'Xojo (REALbasic)': 'xojo',
};

const CODE_LANGUAGE_ALIASES: Record<string, string> = {};
const CODE_LANGUAGE_NAMES: Record<string, string> = {};

for(const name in CODE_LANGUAGE_ALIASES_TEXT) {
  CODE_LANGUAGE_NAMES[name.toLowerCase()] = name;
  for(const alias of CODE_LANGUAGE_ALIASES_TEXT[name].split(' ')) {
    CODE_LANGUAGE_ALIASES[alias] = name;
  }
}

export function FormattedText({parts, onmention, onlink, markdown = false, ontag, ondate}: Props) {
  // Spoilers stay hidden until clicked, keyed by run index.
  const revealed = useSignal<Set<number>>(new Set());

  /**
   * Bots send Markdown as plain text. Render it as structure, but only when the
   * message carries no formatting entities of its own — otherwise Telegram's
   * own formatting is authoritative and re-parsing it would fight with it.
   */
  const plain = parts.every((part) =>
    !part.bold && !part.italic && !part.underline && !part.strike &&
    !part.code && !part.pre && !part.spoiler && !part.blockquote &&
    !part.url && !part.mention && !part.customEmojiDocId
  );

  const source = parts.map((part) => part.text).join('');
  const asMarkdown = plain && (looksLikeMarkdown(source) || (markdown && /(\*\*|__|~~|`|\[[^\]]+\]\()/.test(source)));

  function reveal(index: number) {
    revealed.value = new Set(revealed.value).add(index);
  }

  function renderPart(part: TextPart, i: number) {
    if(part.customEmojiDocId) {
      /* The alt text stays as the fallback, so a document that will not load
         still reads as the emoji the sender meant. */
      return <CustomEmoji key={i} docId={part.customEmojiDocId} size={20} fallback={part.text} />;
    }

    // `class:bold={part.bold}` and friends, as one class string — an empty
    // string rather than a gap, so no stray space ends up in the attribute.
    // Entities nest, so a run can carry these *and* be a quote or a date, and
    // the branches that render an element of their own take them along.
    const formatted = [
      part.bold && 'bold',
      part.italic && 'italic',
      part.underline && 'underline',
      part.strike && 'strike',
      part.code && 'code'
    ].filter(Boolean).join(' ');

    if(part.pre) {
      return (
        <div key={i} class="ft-code-block">
          <CodeBlockHeader code={part.text} language={part.preLanguage ?? ''} />
          <code class="pre">{part.text}</code>
        </div>
      );
    }

    /* A run the server marked as a formatted date, with the flags that say how
       to render it. Without them the run keeps the server's own text, which is
       the only thing the entity carried. */
    if(part.dateUnix !== undefined && part.dateFlags && Object.keys(part.dateFlags).length) {
      return (
        <FormattedDateRun
          key={i}
          unix={part.dateUnix}
          flags={part.dateFlags}
          formatted={formatted}
          ondate={ondate}
        />
      );
    }

    if(part.spoiler && !revealed.value.has(i)) {
      return (
        <button key={i} class="spoiler" onClick={() => reveal(i)} aria-label="Show spoiler">
          {part.text}
        </button>
      );
    }

    if(part.url) {
      return (
        <a
          key={i}
          href={part.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if(onlink?.(part.url!)) e.preventDefault();
          }}
        >{part.text}</a>
      );
    }

    if(part.mention && part.mentionKind !== 'tag' && onmention) {
      return (
        <button
          key={i}
          class="mention"
          onClick={() => onmention(part.mention!, part.mentionKind as 'username' | 'userId')}
        >{part.text}</button>
      );
    }

    /* A hashtag, a cashtag or a bot command: a search (or a sent command), not
       a profile. Only clickable when the app is listening. */
    if(part.mention && part.tagKind && ontag) {
      return (
        <button
          key={i}
          class="mention"
          onClick={() => ontag(part.mention!, part.tagKind!)}
        >{part.text}</button>
      );
    }

    if(part.mention) {
      return <span key={i} class="mention">{part.text}</span>;
    }

    // A quote is a block: it may not live in the inline `<span>` below, and the
    // classes it needs are its own (`blockquote` overrides `display` for it).
    if(part.blockquote) {
      return <QuoteRun key={i} text={part.text} collapsed={part.blockquoteCollapsed === true} formatted={formatted} />;
    }

    return <span key={i} class={formatted}>{part.text}</span>;
  }

  return asMarkdown ?
    <Markdown text={source} onmention={onmention} /> :
    <div class="text">{parts.map(renderPart)}</div>;
}
