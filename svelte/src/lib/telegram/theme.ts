/**
 * Theme handling.
 *
 * `system` follows the OS via the CSS `prefers-color-scheme` media query in
 * app.css; the explicit choices stamp `data-theme` on <html>, which the same
 * stylesheet overrides on. Accent colour is a single custom property so every
 * component picks it up without knowing about themes at all.
 */

export type ThemeMode = 'system' | 'light' | 'dark' | 'schedule';

const THEME_KEY = 'tweb-svelte:theme';
const DENSITY_KEY = 'tweb-svelte:density';
const ACCENT_KEY = 'tweb-svelte:accent';
const SCHEDULE_KEY = 'tweb-svelte:nightSchedule';

export const ACCENTS = [
  {name: 'Iris', value: '#6e63ff'},
  {name: 'Indigo', value: '#4f46e5'},
  {name: 'Blue', value: '#3390ec'},
  {name: 'Teal', value: '#0f9d8f'},
  {name: 'Violet', value: '#8b5cf6'},
  {name: 'Rose', value: '#e5484d'},
  {name: 'Amber', value: '#d98416'},
  {name: 'Green', value: '#3aa657'}
];

export function getThemeMode(): ThemeMode {
  if(typeof localStorage === 'undefined') return 'system';
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'schedule' ? stored : 'system';
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

/**
 * Auto night mode. `from`/`to` are minutes since midnight, so a range that
 * wraps past midnight (the normal case: 22:00 → 08:00) is simply `from > to`.
 */
export type NightSchedule = {from: number; to: number};

const DEFAULT_SCHEDULE: NightSchedule = {from: 22 * 60, to: 8 * 60};

export function getNightSchedule(): NightSchedule {
  if(typeof localStorage === 'undefined') return DEFAULT_SCHEDULE;
  try {
    const parsed = JSON.parse(localStorage.getItem(SCHEDULE_KEY) ?? 'null');
    if(typeof parsed?.from === 'number' && typeof parsed?.to === 'number') {
      return {from: clampMinutes(parsed.from), to: clampMinutes(parsed.to)};
    }
  } catch(err) {}
  return DEFAULT_SCHEDULE;
}

export function setNightSchedule(schedule: NightSchedule) {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify({
    from: clampMinutes(schedule.from),
    to: clampMinutes(schedule.to)
  }));
  applyTheme();
}

function clampMinutes(value: number) {
  return Math.min(24 * 60 - 1, Math.max(0, Math.round(value)));
}

/** `"22:30"` ↔ minutes, for <input type="time">. */
export function minutesToTime(minutes: number): string {
  const m = clampMinutes(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => parseInt(part, 10));
  if(isNaN(hours) || isNaN(minutes)) return 0;
  return clampMinutes(hours * 60 + minutes);
}

export function isScheduledNight(schedule: NightSchedule = getNightSchedule(), now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const {from, to} = schedule;
  if(from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

let scheduleTimer: ReturnType<typeof setInterval> | undefined;

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const root = document.documentElement;
  const resolved = mode === 'schedule' ? (isScheduledNight() ? 'dark' : 'light') : mode;

  if(resolved === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', resolved);

  // A schedule only changes at a wall-clock boundary, so poll rather than try to
  // compute a timeout that a sleeping tab would sleep straight through.
  if(mode === 'schedule' && !scheduleTimer) {
    scheduleTimer = setInterval(() => applyTheme(), 30_000);
  } else if(mode !== 'schedule' && scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = undefined;
  }

  // Keep the browser UI (address bar, task switcher) in step with the theme.
  const dark = resolved === 'dark' ||
    (resolved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0f1216' : '#ffffff');
}

/** Which of the two palettes is on screen right now — wallpapers pick per side. */
export function isDarkTheme(): boolean {
  const attribute = document.documentElement.getAttribute('data-theme');
  if(attribute === 'dark') return true;
  if(attribute === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Density is an appearance option layered on top of the theme: `comfortable`
 * is the floating-pane default, `console` collapses the same markup into an
 * aligned monospace grid for people watching many busy chats.
 */
export type Density = 'comfortable' | 'console';

export function getDensity(): Density {
  if(typeof localStorage === 'undefined') return 'comfortable';
  return localStorage.getItem(DENSITY_KEY) === 'console' ? 'console' : 'comfortable';
}

export function setDensity(density: Density) {
  localStorage.setItem(DENSITY_KEY, density);
  applyDensity(density);
}

export function applyDensity(density: Density = getDensity()) {
  const root = document.documentElement;
  if(density === 'console') root.setAttribute('data-density', 'console');
  else root.removeAttribute('data-density');
}

export function getAccent(): string {
  if(typeof localStorage === 'undefined') return ACCENTS[0].value;
  return localStorage.getItem(ACCENT_KEY) ?? ACCENTS[0].value;
}

export function setAccent(color: string) {
  localStorage.setItem(ACCENT_KEY, color);
  applyAccent(color);
}

export function applyAccent(color: string = getAccent()) {
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', lighten(color, 0.15));
}

/** Cheap perceptual-enough lightening for the hover shade. */
function lighten(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const num = parseInt(value.length === 3 ? value.replace(/./g, '$&$&') : value, 16);
  const channels = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map((c) =>
    Math.round(c + (255 - c) * amount)
  );
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
