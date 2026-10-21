import { useEffect, useState } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// Module-level, not React state — the same piece of content shows up across
// Explore's grid cards, its own Details modal, Partnership Code's preview
// modal, the launch queue list, and the launch wizard's review step. This
// makes sure it's only ever resolved once per session no matter how many of
// those render it, rather than refetching on every mount.
const cache = new Map(); // key -> data | Promise

function keyFor(contentId, permalink) {
  return contentId || permalink || null;
}

export function useContentPreview(contentId, permalink) {
  const key = keyFor(contentId, permalink);
  // Read straight from the cache on every render instead of mirroring it
  // into React state — the effect below only ever needs to kick off a fetch
  // on a cache miss and force a re-render once that resolves, not re-derive
  // something already computable here.
  const cached = key ? cache.get(key) : null;
  const resolved = cached && !(cached instanceof Promise) ? cached : null;

  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!key) return undefined;
    const existing = cache.get(key);
    if (existing && !(existing instanceof Promise)) return undefined;

    let cancelled = false;
    const params = new URLSearchParams();
    if (contentId) params.set("contentId", contentId);
    if (permalink) params.set("permalink", permalink);
    const promise =
      existing instanceof Promise ? existing : fetchWithTimeout(`/api/fb/partnership/content-preview?${params.toString()}`).then(parseJsonResponse);
    cache.set(key, promise);
    promise
      .then((data) => {
        cache.set(key, data);
        if (!cancelled) forceRender((n) => n + 1);
      })
      .catch(() => {
        // Silent on failure — a missing preview falls back to each caller's
        // own placeholder, never a blocking error for content that's
        // otherwise perfectly usable (select it, request permission, queue
        // it) without a preview.
        cache.delete(key);
        if (!cancelled) forceRender((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [key, contentId, permalink]);

  if (!key) return { data: null, loading: false };
  return { data: resolved, loading: !resolved };
}
