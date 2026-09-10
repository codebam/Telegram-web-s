/*
 * Ported from svelte/src/lib/components/ReplyHeader.svelte.
 *
 * Two details of the port:
 *  - the `$effect` here depends on the `reply` prop rather than on a signal, so
 *    it becomes a `useEffect` with `reply` in its dependency list;
 *    `useSignalEffect` tracks signal reads only and would never re-run;
 *  - `retry` is memoised, as in `Avatar.tsx`: a component body runs once per
 *    instance in Svelte and on every render here, and a fresh retry budget each
 *    pass would defeat the bound it exists to enforce.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {enqueueLoad} from '$lib/telegram/loadQueue';
import {loadReplyThumbUrl, type ReplyInfo} from '$lib/telegram/reply';
import {staleUrlRetry} from '$lib/telegram/staleUrl';

import './ReplyHeader.css';

interface Props {
  reply: ReplyInfo;
  onjump: () => void;
}

export function ReplyHeader({reply, onjump}: Props) {
  const thumb = useSignal<string | null>(null);
  const retry = useMemo(() => staleUrlRetry(), []);

  // Svelte read `reply` inside the async callback and always saw the current
  // one; a closure in JSX would see the reply from the render that started the
  // load, so the latest is kept in a ref.
  const currentReply = useRef(reply);
  currentReply.current = reply;

  /** The worker revoked the URL out from under the element; ask again. */
  function reload() {
    if(!retry.shouldRetry()) {
      thumb.value = null;
      return;
    }

    const {peerId, mid} = reply;
    thumb.value = null;
    enqueueLoad(() => loadReplyThumbUrl(peerId, mid)).then((url) => {
      if(currentReply.current.peerId === peerId && currentReply.current.mid === mid) thumb.value = url;
    });
  }

  // A history full of replies is a history full of thumbnails, so they go
  // through the same bounded queue as the media grids.
  useEffect(() => {
    const {peerId, mid, hasMedia} = reply;
    thumb.value = null;
    retry.reset();
    if(!hasMedia) return;

    let cancelled = false;
    enqueueLoad(() => loadReplyThumbUrl(peerId, mid)).then((url) => {
      if(!cancelled) thumb.value = url;
    });

    return () => {
      cancelled = true;
    };
  }, [reply]);

  return (
    <button
      class="reply-header"
      style={{'--peer-color': reply.color}}
      onClick={onjump}
      disabled={reply.deleted}
      title={reply.deleted ? 'The original message is gone' : 'Go to message'}
    >
      {thumb.value && <img class="thumb" src={thumb.value} alt="" onError={reload} />}
      <span class="body">
        <span class="who">
          <span class="name">{reply.title}</span>
          {/* Cross-chat reply: the original lives somewhere else, and saying
              where is the only thing that makes the header make sense. */}
          {reply.chatTitle && <span class="in-chat">in {reply.chatTitle}</span>}
        </span>
        {reply.quote ?
          <span class="quote">
            <span class="quote-mark">❝</span>{reply.quote}
          </span> :
          <span class="preview">{reply.deleted ? 'Deleted message' : reply.text}</span>}
      </span>
    </button>
  );
}
