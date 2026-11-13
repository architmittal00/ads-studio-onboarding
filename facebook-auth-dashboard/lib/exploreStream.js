// /api/fb/explore-insights always streams newline-delimited JSON once its validation passes: some `{type:"progress"}`
// lines, then one `{type:"done", rows, meta}` (or `{type:"done", error}`) line — never a single JSON body, so `res.json()`
// fails on it. This reads the stream and returns the final `{rows, meta}`; a validation failure (plain JSON error before the
// stream starts) and an error inside the stream both throw with the server's own message. Same reader as Custom Views'.
export async function readExploreInsightsStream(res) {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "done") finalResult = event;
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    if (event.type === "done") finalResult = event;
  }
  if (!finalResult) throw new Error("The read ended unexpectedly");
  if (finalResult.error) throw new Error(finalResult.error);
  return finalResult;
}
