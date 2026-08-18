/**
 * Recovery for blob URLs the worker has revoked underneath us.
 *
 * Every media URL is minted in the shared worker, which keeps its own LRU of
 * them (`ThumbsStorage`, `appAvatarsManager`, …) and revokes a URL ~30s after
 * evicting it. tweb copes because its components re-read the mirrored cache on
 * every render; this app memoises URL strings instead, so after a while on the
 * page a cached string points at nothing and the `<img>` that re-attaches fails
 * with `ERR_FILE_NOT_FOUND` — a broken-image icon where a photo used to be.
 *
 * There is no eviction event on this side for thumbs or avatars, so the load
 * failure itself is the signal: forget the URL and ask for it again. Bounded,
 * because a URL that fails for any other reason must not spin.
 */
export function staleUrlRetry(limit = 1) {
  let attempts = 0;

  return {
    /**
     * Report a failed load. Returns true when the caller should forget the URL
     * and request it again, false once the budget is spent.
     */
    shouldRetry(): boolean {
      if(attempts >= limit) return false;
      attempts++;
      return true;
    },

    /** Start over — a new peer, message or item gets its own budget. */
    reset(): void {
      attempts = 0;
    }
  };
}
