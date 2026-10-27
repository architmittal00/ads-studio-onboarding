import posthog from "posthog-js";
import { MOBILE_MAX_WIDTH } from "./useIsMobile";

// PostHog product analytics (https://posthog.com) — who uses which screen,
// in what order, and where flows stall. Complements Microsoft Clarity
// (lib/clarity.js), which stays the session-recording tool, so PostHog's own
// recording is off. Loaded only when NEXT_PUBLIC_POSTHOG_KEY is set, so local
// dev and previews without it send nothing.
//
// The unique user is the Facebook user id (NextAuth's token.sub — see
// pages/api/auth/[...nextauth].js): stable for a person across devices and
// sessions, unlike email, which Facebook can omit or change. Email and name
// ride along as person properties.
//
// What is NEVER sent: ad copy, creative text, spend/metric values, API
// responses, access tokens. Events carry identifiers and counts only. Text
// typed into inputs is not captured.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let started = false;

export function initAnalytics() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;
  posthog.init(KEY, {
    api_host: HOST,
    // Page views are sent manually on route changes (pages router).
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
    person_profiles: "identified_only",
    mask_all_text: false,
    mask_all_element_attributes: false,
  });
}

export function identifyUser({ id, email, name }) {
  if (!started || !id) return;
  posthog.identify(String(id), { email: email || undefined, name: name || undefined });
}

export function resetAnalytics() {
  if (!started) return;
  posthog.reset();
}

export function trackPageview() {
  if (!started) return;
  posthog.capture("$pageview");
}

// Every event carries the device class; pass `account` (ad account id) and
// small identifiers/counts as properties — never content.
export function track(event, props = {}) {
  if (!started) return;
  posthog.capture(event, { ...props, device: window.innerWidth <= MOBILE_MAX_WIDTH ? "mobile" : "desktop" });
}
