import posthog from "posthog-js";
import { MOBILE_MAX_WIDTH } from "./useIsMobile";

// PostHog product analytics (https://posthog.com) — who uses which screen,
// in what order, and where flows stall. Complements Microsoft Clarity
// (lib/clarity.js), which stays the session-recording tool, so PostHog's own
// recording is off. Loaded only when NEXT_PUBLIC_POSTHOG_KEY is set, so local
// dev and previews without it send nothing.
//
// The unique user is Facebook user id + a per-browser device id
// ("<fbId>:<deviceId>"). Many people share one Facebook login, so the Facebook
// id alone would merge them into a single person; the device id (a random id
// kept in this browser's localStorage, so it survives sign-out/in) tells them
// apart. Consequences: the same person on two browsers/devices shows as two
// users, and clearing site data or using a private window makes a new one.
// fb_user_id and device_id are also person properties, so you can still group
// all of one Facebook login's users in PostHog. NextAuth's token.sub is the
// Facebook id (see pages/api/auth/[...nextauth].js). Email/name ride along too.
//
// What is NEVER sent: ad copy, creative text, spend/metric values, API
// responses, access tokens. Events carry identifiers and counts only. Text
// typed into inputs is not captured.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

const DEVICE_KEY = "fb-dashboard:device-id";
let started = false;

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // Storage blocked: fall back to a per-page-load id (still never merges people).
    return (getDeviceId.fallback ||= crypto.randomUUID());
  }
}

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
  const deviceId = getDeviceId();
  posthog.identify(`${id}:${deviceId}`, {
    fb_user_id: String(id),
    device_id: deviceId,
    email: email || undefined,
    name: name || undefined,
  });
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
