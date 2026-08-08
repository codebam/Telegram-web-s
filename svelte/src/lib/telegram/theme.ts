/**
 * Theme handling.
 *
 * `system` follows the OS via the CSS `prefers-color-scheme` media query in
 * app.css; the explicit choices stamp `data-theme` on <html>, which the same
 * stylesheet overrides on. Accent colour is a single custom property so every
 * component picks it up without knowing about themes at all.
 */

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_KEY = 'tweb-svelte:theme';
const DENSITY_KEY = 'tweb-svelte:density';
const ACCENT_KEY = 'tweb-svelte:accent';

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
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const root = document.documentElement;
  if(mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);

  // Keep the browser UI (address bar, task switcher) in step with the theme.
  const dark = mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#0f1216' : '#ffffff');
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
