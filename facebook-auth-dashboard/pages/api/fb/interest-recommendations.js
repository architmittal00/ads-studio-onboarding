import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getInterestSuggestions } from "@/lib/openrouter";
import { fetchPageText } from "@/lib/fetchPageText";
import { searchAdInterests, pickBestMatch, mapWithConcurrency } from "@/lib/metaInterestSearch";

// `/search?type=adinterest` is one query per call — bounds how many of the
// ~50-80 AI suggestions get resolved at once (see lib/metaInterestSearch.js).
const SEARCH_CONCURRENCY = 6;
// Real matched Meta interests shown to the user, not the raw AI string list —
// capped so the 3 ad-set pickers (and any future UI) aren't choosing from an
// unreasonably long list.
const MAX_DISPLAYED_INTERESTS = 15;

function buildPromptFromLandingPages(landingPages) {
  const lines = landingPages
    .map((p, i) => `${i + 1}. ${p.url} — "${p.label}" — revenue ${Math.round(p.revenue)}`)
    .join("\n");
  return (
    `Brand's top landing pages by revenue (last 30 days), most valuable first:\n${lines}\n\n` +
    "Based on these products, suggest Meta Ads Interest targeting options a media buyer could search for."
  );
}

function buildPromptFromBrandText(brandUrl, pageText) {
  return (
    `Brand website: ${brandUrl}\n\nExtracted page text:\n${pageText}\n\n` +
    "Based on this brand's apparent products/positioning, suggest Meta Ads Interest targeting options a media " +
    "buyer could search for."
  );
}

// Orchestrates the AI + Meta-search pipeline: build a prompt from either the
// account's real top landing pages or a brand URL -> getInterestSuggestions
// (OpenRouter/Gemini) -> resolve each suggestion against Meta's real
// targeting system -> dedupe into a ranked, real-interest candidate list.
// Kept separate from the cheap /api/fb/interest-search (live typeahead) —
// this one costs real OpenRouter spend plus up to ~80 Graph calls per click,
// so it's only ever triggered by an explicit "Get AI Recommendations" button.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { source, landingPages, brandUrl } = req.body || {};
  const token = session.accessToken;
  const warnings = [];

  let promptContext;
  if (source === "landing_pages") {
    if (!Array.isArray(landingPages) || landingPages.length === 0) {
      return res.status(400).json({ error: "landingPages is required for source=landing_pages" });
    }
    promptContext = buildPromptFromLandingPages(landingPages);
  } else if (source === "brand_url") {
    if (!brandUrl || typeof brandUrl !== "string") {
      return res.status(400).json({ error: "brandUrl is required for source=brand_url" });
    }
    let pageText = null;
    try {
      pageText = await fetchPageText(brandUrl);
    } catch (err) {
      // A plain chat/completions call can't browse the web — if the fetch
      // fails (bot-blocked, timeout, non-HTML), fall back to reasoning from
      // the bare URL/domain rather than hard-failing the whole request.
      warnings.push(`Could not fetch the brand URL directly (${err.message}) — reasoning from the URL alone.`);
    }
    promptContext = buildPromptFromBrandText(brandUrl, pageText || "(could not fetch page content)");
  } else {
    return res.status(400).json({ error: 'source must be "landing_pages" or "brand_url"' });
  }

  let suggestions;
  try {
    const result = await getInterestSuggestions({ promptContext });
    suggestions = result.suggestions;
    warnings.push(...result.warnings);
  } catch (err) {
    return res.status(502).json({ error: err.message, warnings });
  }

  const matchResults = await mapWithConcurrency(suggestions, SEARCH_CONCURRENCY, async (suggestion) => {
    try {
      const results = await searchAdInterests(token, suggestion, { limit: 5 });
      return { suggestion, match: pickBestMatch(results, suggestion) };
    } catch {
      return { suggestion, match: null };
    }
  });

  // The same real Meta interest often gets hit by multiple AI strings (e.g.
  // "Skincare" and "Korean skincare" both resolving to Meta's "Skin care") —
  // dedupe by the real interest id and keep every AI suggestion that led to
  // it as a simple "consensus" signal for ranking.
  const byId = new Map();
  const unmatchedSuggestions = [];
  for (const { suggestion, match } of matchResults) {
    if (!match) {
      unmatchedSuggestions.push(suggestion);
      continue;
    }
    if (!byId.has(match.id)) {
      byId.set(match.id, {
        id: match.id,
        name: match.name,
        audienceSizeLowerBound: match.audience_size_lower_bound ?? null,
        audienceSizeUpperBound: match.audience_size_upper_bound ?? null,
        path: match.path || null,
        matchedFromSuggestions: [],
      });
    }
    byId.get(match.id).matchedFromSuggestions.push(suggestion);
  }

  const matched = [...byId.values()]
    .sort((a, b) => {
      if (b.matchedFromSuggestions.length !== a.matchedFromSuggestions.length) {
        return b.matchedFromSuggestions.length - a.matchedFromSuggestions.length;
      }
      return (b.audienceSizeUpperBound || 0) - (a.audienceSizeUpperBound || 0);
    })
    .slice(0, MAX_DISPLAYED_INTERESTS);

  res.status(200).json({
    source,
    aiSuggestionCount: suggestions.length,
    matched,
    unmatchedSuggestions,
    warnings,
  });
}
