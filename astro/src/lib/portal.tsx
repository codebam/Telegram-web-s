import {createPortal} from 'preact/compat';
import type {ComponentChildren} from 'preact';

interface Props {
  children: ComponentChildren;
}

/**
 * Renders its children into `document.body` instead of in place.
 *
 * This is the port of the `use:portal` action the Svelte client used in
 * `Stories.svelte`. The reason it exists there still holds: the strip and the
 * sidebar live in a `backdrop-filter` pane, which makes that pane the containing
 * block for `position: fixed`, so a viewer or backdrop rendered in place covers
 * the chat list only. Moving the node to the body is what makes it cover the
 * viewport.
 */
export function Portal({children}: Props) {
  return createPortal(children, document.body);
}
