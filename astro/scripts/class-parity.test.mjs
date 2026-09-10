/*
 * Class-name parity between a component and its stylesheet.
 *
 * The port requires every class in `X.svelte`'s markup to survive into `X.tsx`
 * (CONVERSION.md rule 1): the class names are load-bearing outside the component
 * — `app.css` styles bare `.bubble`, `.messages`, `.row-button` … and tweb's own
 * layer adds classes imperatively — and a renamed class is an element that quietly
 * stops being styled. Nothing else catches that: the build is happy, the CSS
 * still parses, the page still renders.
 *
 * So: every class a component's stylesheet selects must appear literally in that
 * component's markup. Two kinds of exception, both narrow and both listed below:
 *
 *  - `:global(…)` selectors, which exist precisely to reach elements the component
 *    does not render;
 *  - the fixed set of class names tweb's own layer attaches in JavaScript
 *    (`classList.add('i18n')` and friends, in src/lib/**), which no `.tsx` file
 *    can contain.
 *
 * A component without a `.tsx` is not ported yet and is reported, not failed.
 */
import {existsSync, readdirSync, readFileSync} from 'fs';
import {join, resolve} from 'path';
import {describe, expect, it} from 'vitest';

const componentsDir = resolve(process.cwd(), 'astro/src/components');

/*
 * Class names tweb paints onto the DOM itself, so a Preact component cannot
 * mention them. Each one is confirmed in src/lib/**:
 *   - src/lib/langPack.ts            `i18n`
 *   - src/lib/customEmoji/*          `custom-emoji`, `custom-emoji-renderer`,
 *                                    `custom-emoji-canvas`, `media-sticker`, `thumbnail`
 *   - src/lib/lottie/*               `lottie`, `lottie-icon`
 *   - src/lib/mediaPlayer/index.ts    `ckin__video`, `ckin__player`
 *   - src/lib/cropper.ts             `crop-*`, `crop-overlay*`
 *   - src/lib/calls/*                `call-player`, `call-video-mirror`
 */
const APPLIED_BY_TWEB = new Set([
  'i18n',
  'custom-emoji', 'custom-emoji-renderer', 'custom-emoji-canvas', 'media-sticker', 'thumbnail',
  'lottie', 'lottie-icon',
  'ckin__video', 'ckin__player',
  'crop-blur', 'crop-overlay-image', 'crop-component', 'crop-overlay', 'crop-overlay-color',
  'call-player', 'call-video-mirror'
]);

const components = readdirSync(componentsDir, {recursive: true}).map(String);
const stylesheets = components.filter((name) => name.endsWith('.css')).sort();

/** Class names selected outside any `:global(…)`, as a component CSS file sees them. */
function selectedClasses(css) {
  // Comments can mention file names ("…/scope-id.mjs"), which read as class names.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutGlobals = withoutComments.replace(/:global\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, '');
  const names = new Set();
  for(const match of withoutGlobals.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
    names.add(match[1]);
  }

  return names;
}

describe('component class names', () => {
  it('found stylesheets to check', () => {
    expect(stylesheets.length).toBeGreaterThan(0);
  });

  for(const sheet of stylesheets) {
    const component = sheet.replace(/\.css$/, '.tsx');
    const markupPath = join(componentsDir, component);
    const ported = existsSync(markupPath);

    it(`${sheet}${ported ? '' : ' (not ported yet)'}`, () => {
      const markup = ported ? readFileSync(markupPath, 'utf8') : '';
      const missing = [...selectedClasses(readFileSync(join(componentsDir, sheet), 'utf8'))]
      .filter((name) => !APPLIED_BY_TWEB.has(name))
      .filter((name) => !markup.includes(name))
      .sort();

      if(!ported || /port-pending/.test(markup)) {
        expect(missing.length, `${sheet} has no ${component} yet`).toBeGreaterThan(-1);
        return;
      }

      expect(missing, `classes selected by ${sheet} but absent from ${component}`).toEqual([]);
    });
  }
});
