/*
 * Ported from svelte/src/lib/components/Suggestions.svelte.
 *
 * The `$effect` read the `active` prop (the `void active` was how it declared
 * that dependency), so it becomes a `useEffect` with `active` in its dependency
 * list; the list node is a ref.
 */
import {useEffect, useRef} from 'preact/hooks';

import type {SuggestionItem} from '$lib/telegram/botUi';

import './Suggestions.css';

interface Props {
  items: SuggestionItem[];
  /** Index the arrow keys have landed on; Enter and Tab take this one. */
  active?: number;
  label: string;
  onpick: (index: number) => void;
}

export function Suggestions({items, active = 0, label, onpick}: Props) {
  const list = useRef<HTMLDivElement>(null);

  // Keep the keyboard selection visible while arrowing through a long list.
  useEffect(() => {
    list.current?.querySelector('.suggestion.active')?.scrollIntoView({block: 'nearest'});
  }, [active]);

  return (
    <div class={['suggestions', items.some((item) => item.emoji) && 'emoji'].filter(Boolean).join(' ')} ref={list} role="listbox" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.key}
          type="button"
          class={['suggestion', index === active && 'active'].filter(Boolean).join(' ')}
          role="option"
          aria-selected={index === active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onpick(index)}
        >
          <span class="suggestion-title">{item.title}</span>
          {item.subtitle && <span class="suggestion-sub">{item.subtitle}</span>}
        </button>
      ))}
    </div>
  );
}
