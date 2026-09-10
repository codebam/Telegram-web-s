/*
 * Ported from svelte/src/lib/components/InlinePreview.svelte.
 *
 * Two effect subtleties, both from the conversion contract:
 *  - `bind:this={el}` became `ref`, so the observer effect reads `el.current`
 *    after the commit instead of watching a `$state` node;
 *  - the loader effect reads a *prop* (`result.queryAndResultId`, the property
 *    Svelte tracked) and the signal `seen`, so it is a `useEffect` keyed on both
 *    — `useSignalEffect` tracks signal reads only and would never notice a
 *    different result. `seen` stays a signal because it is what makes that effect
 *    run, exactly as `$state` did.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadInlineResultThumbnail, type InlineResultItem} from '$lib/telegram/settings';
import {enqueueLoad} from '$lib/telegram/loadQueue';

import './InlinePreview.css';

interface Props {
  result: InlineResultItem;
  size?: number;
  isGrid?: boolean;
}

export function InlinePreview({result, size = 44, isGrid = false}: Props) {
  const url = useSignal<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  const seen = useSignal(false);

  // Svelte read `result` inside the async callback and always saw the current
  // item; a closure in JSX would see the render that started the load, so the
  // latest id is kept in a ref.
  const currentId = useRef(result.queryAndResultId);
  currentId.current = result.queryAndResultId;

  useEffect(() => {
    const node = el.current;
    if(!node || seen.value) return;

    const observer = new IntersectionObserver((entries) => {
      if(entries.some((entry) => entry.isIntersecting)) {
        seen.value = true;
        observer.disconnect();
      }
    }, {rootMargin: '120px'});

    observer.observe(node);
    return () => observer.disconnect();
  }, [seen.value]);

  useEffect(() => {
    const id = result.queryAndResultId;
    if(!seen.value) return;
    url.value = null;
    enqueueLoad(() => loadInlineResultThumbnail(id)).then((resolved) => {
      if(id === currentId.current) url.value = resolved;
    });
  }, [result.queryAndResultId, seen.value]);

  const fallback = (result.title.trim() || result.type || '?')[0].toUpperCase();

  return (
    <span
      ref={el}
      class={['inline-preview', isGrid && 'grid-mode'].filter(Boolean).join(' ')}
      style={isGrid ? undefined : {width: `${size}px`, height: `${size}px`}}
    >
      {url.value ?
        result.isGif ?
          /* Decorative loop: there are no captions to describe. */
          <video src={url.value} autoplay loop muted playsinline></video> :
          <img src={url.value} alt={result.title} /> :
        <span class="fallback">{fallback}</span>}
    </span>
  );
}
