// Microsoft Clarity (https://clarity.microsoft.com) — free session
// recording + heatmaps. Loaded only when NEXT_PUBLIC_CLARITY_PROJECT_ID is
// set, so local dev and any preview deploy without it configured loads
// nothing. Clarity sessions are anonymous by default; identifyClarityUser()
// tags each one with the real NextAuth user's email instead, so a session
// in Clarity's dashboard can be found/filtered by the actual person who
// generated it, not just an anonymous visitor id.
export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || null;

export function identifyClarityUser(email) {
  if (!email || typeof window === "undefined" || typeof window.clarity !== "function") return;
  window.clarity("identify", email);
}
