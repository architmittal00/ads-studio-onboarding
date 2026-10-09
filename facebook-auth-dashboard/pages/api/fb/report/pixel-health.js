import { graphGetAllPages } from "@/lib/facebookGraph";
import { getCachedReport, setCachedReport } from "@/lib/reportCache";
import { lastNDaysRange } from "@/lib/adCreativeDetails";
import { requireReportRequest, settled } from "@/lib/reportShared";

// Pixel health (best-effort: existence + staleness only) — one Graph call,
// fully independent of every other report section and of the selected date
// range (pixel firing status is "as of now", not scoped to a window). Split
// into its own endpoint (see pages/api/fb/report/core.js for the full
// picture) so it shows up the moment this one call resolves, rather than
// waiting on whichever other section happens to be slowest.
export default async function handler(req, res) {
  const ctx = await requireReportRequest(req, res, lastNDaysRange);
  if (!ctx) return;
  const { token, accountId, force, cacheKeyBase } = ctx;
  const cacheKey = `${cacheKeyBase}:pixel-health`;

  if (!force) {
    const cached = getCachedReport(cacheKey);
    if (cached) return res.status(200).json({ ...cached.data, cachedAt: cached.fetchedAt, fromCache: true });
  }

  const warnings = [];
  const [pixelsResult] = await Promise.allSettled([
    graphGetAllPages(`/${accountId}/adspixels`, token, { fields: "id,name,last_fired_time,creation_time" }),
  ]);

  const pixelsJson = settled(pixelsResult, null);
  if (pixelsResult.status === "rejected") warnings.push(`Pixel health unavailable: ${pixelsResult.reason.message}`);

  const pixels = (pixelsJson?.data || []).map((p) => {
    const lastFired = p.last_fired_time ? new Date(p.last_fired_time) : null;
    const daysSinceFired = lastFired ? (Date.now() - lastFired.getTime()) / 86400000 : null;
    return {
      id: p.id,
      name: p.name,
      lastFiredTime: p.last_fired_time || null,
      daysSinceFired,
      status: !lastFired ? "never_fired" : daysSinceFired > 3 ? "stale" : "healthy",
    };
  });

  const pixelConcerns = pixels.filter((p) => p.status !== "healthy");
  if (pixelsJson && pixels.length === 0) {
    pixelConcerns.push({ name: "No pixel connected to this ad account", status: "missing" });
  }

  const payload = { pixelHealth: { pixels, concerns: pixelConcerns }, warnings };
  setCachedReport(cacheKey, payload);
  res.status(200).json({ ...payload, cachedAt: Date.now(), fromCache: false });
}
