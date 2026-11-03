import { parseJsonResponse } from "@/lib/fetchJson";

const BATCH_SIZE = 50;
const PARALLEL_BATCHES = 2;

// Pauses ads in batches of 50 (one Graph call each, see /api/fb/entity-action-batch) rather than one
// request per ad. `onProgress(done, total)` fires as each batch comes back. Resolves to
// Map(id -> { ok, error? }); a batch that fails as a whole marks all its ids failed with that message.
export async function pauseInBatches(ids, onProgress = () => {}) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) chunks.push(ids.slice(i, i + BATCH_SIZE));
  const out = new Map();
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      try {
        const res = await fetch("/api/fb/entity-action-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityIds: chunk, action: "pause" }),
        });
        const json = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
        if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
        for (const r of json.results) out.set(r.id, r);
      } catch (err) {
        for (const id of chunk) out.set(id, { id, ok: false, error: err.message });
      }
      done += chunk.length;
      onProgress(done, ids.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, chunks.length) }, worker));
  return out;
}
