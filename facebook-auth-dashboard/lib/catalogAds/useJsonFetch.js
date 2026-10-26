import { useEffect, useRef, useState } from "react";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";

// GET `url` and track {data, loading, error} — `url` is `null`/falsy to skip
// fetching entirely (e.g. no catalog picked yet). Re-fetches whenever `url`
// changes; a response for a `url` that's no longer the latest one requested
// is dropped, so a slow first catalog's product sets can't land after a
// faster second pick and clobber it. Shared by every Catalog Ads tab's data
// fetching (catalogs, product sets, products, set health, …) rather than
// each repeating the same loading/error/stale-response bookkeeping.
export function useJsonFetch(url) {
  const [state, setState] = useState({ data: null, loading: !!url, error: null });
  const latestUrl = useRef(url);

  useEffect(() => {
    latestUrl.current = url;
    if (!url) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to `url` becoming falsy (an external prop), not a derived-state anti-pattern
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState({ data: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetchWithTimeout(url);
        const json = await parseJsonResponse(res);
        if (latestUrl.current !== url) return;
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        setState({ data: json, loading: false, error: null });
      } catch (err) {
        if (latestUrl.current !== url) return;
        setState({ data: null, loading: false, error: err.message });
      }
    })();
  }, [url]);

  return state;
}
