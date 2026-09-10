/**
 * The two renderings of a `messageEntityFormattedDate` run.
 *
 * Ported from tweb's `src/helpers/date/formatFormattedDate.ts` and
 * `src/helpers/date/formatRelativeTime.ts` rather than imported: the originals
 * resolve their strings and their `Intl.DateTimeFormat` through `@lib/langPack`,
 * which pulls in the lang pack and Solid. This client has no lang pack, so the
 * relative strings are hardcoded English (the plural forms of
 * `FormattedDate.*` in `src/lang.ts`) and the formatter cache lives here.
 *
 * `Intl` itself is not localized by that pack: it formats in the browser's own
 * locale, which is the closest thing this client has to the locale tweb's lang
 * pack would have chosen.
 */
import type {TextPart} from './chats';

/** The `pFlags` of a `messageEntityFormattedDate` entity. */
export type FormattedDateFlags = NonNullable<TextPart['dateFlags']>;

/**
 * Constructing an `Intl.DateTimeFormat` is expensive enough that a message list
 * full of dates notices it, and the option sets repeat, so one instance per set
 * is kept for the life of the page — upstream caches them the same way, in
 * `I18n.getDateTimeFormat`.
 */
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function getDateTimeFormat(options: Intl.DateTimeFormatOptions) {
  // The options are built in a fixed order below, so their JSON is a stable key.
  const key = JSON.stringify(options);
  let format = dateTimeFormats.get(key);
  if(!format) {
    format = new Intl.DateTimeFormat(undefined, options);
    dateTimeFormats.set(key, format);
  }

  return format;
}

/** `capitalizeFirstLetter` from `src/helpers/string` — "today" reads as "Today". */
function capitalizeFirstLetter(string: string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

/**
 * A formatted date, time or weekday. The flags combine (`short_time` +
 * `short_date` is "12/31/24, 05:30 PM"); with no flags at all the caller is
 * expected to keep the server's own text instead of rendering this.
 */
export function formatFormattedDate(unixSeconds: number, flags: FormattedDateFlags): string {
  const date = new Date(unixSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = {};

  if(flags.short_date) {
    options.year = '2-digit';
    options.month = 'numeric';
    options.day = 'numeric';
  }

  if(flags.long_date) {
    options.year = 'numeric';
    options.month = 'long';
    options.day = 'numeric';
  }

  if(flags.day_of_week) {
    options.weekday = 'long';
  }

  if(flags.short_time) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  if(flags.long_time) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
  }

  return capitalizeFirstLetter(getDateTimeFormat(options).format(date));
}

export type RelativeTime = {
  /** The label to render — "5 minutes ago", "in 2 hours", "Just now". */
  text: string;
  /**
   * Milliseconds until that label stops being true, i.e. until the reader has to
   * see a different one. This is what a ticking date re-arms its timer with: a
   * fixed cadence would either repaint for nothing or show a stale count.
   */
  updateInterval: number;
};

function plural(count: number, unit: string, isPast: boolean) {
  // English's plural rule: only exactly 1 is "one" (`FormattedDate.MinutesAgo`).
  const word = count === 1 ? unit : unit + 's';
  return capitalizeFirstLetter(isPast ? `${count} ${word} ago` : `in ${count} ${word}`);
}

/** "5 minutes ago" / "in 2 hours" — relative to `nowSeconds`, English. */
export function formatRelativeTime(unixSeconds: number, nowSeconds: number): RelativeTime {
  const diff = nowSeconds - unixSeconds;
  const absDiff = Math.abs(diff);
  const isPast = diff > 0;

  if(absDiff < 3) {
    return {text: 'Just now', updateInterval: (3 - absDiff) * 1000 || 1000};
  }

  if(absDiff < 60) {
    return {text: plural(absDiff | 0, 'second', isPast), updateInterval: 1000};
  }

  if(absDiff < 3600) {
    return {
      text: plural(absDiff / 60 | 0, 'minute', isPast),
      updateInterval: nextBoundaryDelay(absDiff, 60, isPast)
    };
  }

  if(absDiff < 86400) {
    return {
      text: plural(absDiff / 3600 | 0, 'hour', isPast),
      updateInterval: nextBoundaryDelay(absDiff, 3600, isPast)
    };
  }

  if(absDiff < 604800) {
    return {
      text: plural(absDiff / 86400 | 0, 'day', isPast),
      updateInterval: nextBoundaryDelay(absDiff, 86400, isPast)
    };
  }

  if(absDiff < 2592000) {
    return {
      text: plural(absDiff / 604800 | 0, 'week', isPast),
      updateInterval: nextBoundaryDelay(absDiff, 604800, isPast)
    };
  }

  if(absDiff < 31536000) {
    return {
      text: plural(absDiff / 2592000 | 0, 'month', isPast),
      updateInterval: nextBoundaryDelay(absDiff, 2592000, isPast)
    };
  }

  return {
    text: plural(absDiff / 31536000 | 0, 'year', isPast),
    updateInterval: nextBoundaryDelay(absDiff, 31536000, isPast)
  };
}

function nextBoundaryDelay(absDiff: number, unit: number, isPast: boolean): number {
  const remainder = absDiff % unit;
  // Past: the displayed whole-unit count increments at the next multiple of
  // `unit`, so a count valid at an exact boundary stays valid for a full unit.
  // Future: the count decrements as `absDiff` shrinks, so it changes in
  // `remainder` seconds — and at an exact boundary (`remainder === 0`) it drops
  // on the very next second, so refresh in ~1s rather than waiting a full unit.
  const seconds = isPast ? (unit - remainder) : (remainder || 1);
  return seconds * 1000;
}
