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
    capture_dead_clicks: true,
    capture_exceptions: true,
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

// ───────────────────────── Automatic event capture ─────────────────────────
// One document-level listener set covers every button, link, tab, control,
// form, dialog and API call in the app, so new UI is tracked without
// per-component wiring. Explicit `track()` calls (and `data-track` attributes)
// add named, business-level events on top.
//
// Event catalogue (all carry `screen`, `device`):
//   nav_clicked        sidebar / bottom bar / top bar item     (data-track)
//   cta_clicked        any button or link click                kind, style, label, component, in_dialog
//   tab_changed        role="tab" click (chips, tab groups)    label
//   control_changed    select / checkbox / radio / range / date / file
//   search_used        typing in a search box (debounced)      query_length — never the text
//   form_submitted     <form> submit                           form
//   dialog_opened      modal / sheet / drawer / lightbox       dialog
//   api_action         non-GET call to our /api/*              path, method, status, ok, duration_ms
//   api_error          failed or non-2xx call to our /api/*    path, status, duration_ms
//   js_error           uncaught error / unhandled rejection    message
//   text_copied        copy to clipboard                       length
// plus PostHog's own: $pageview, $pageleave, $autocapture, $rageclick,
// $dead_click, $exception.
//
// Privacy: labels are only taken from short, static-looking UI text (see
// safeText) and never from table cells or list rows, which carry ad,
// campaign and creator names. Typed text, select values and API bodies are
// never sent.

const NAME_CONTAINERS = "table, tr, td, [class*=rowCard], [class*=sheetListItem], [class*=pickerItem], [class*=partnerCard], [class*=Card], [data-ph-no-label]";

function safeText(el, raw) {
  if (!el || (el.closest && el.closest(NAME_CONTAINERS))) return undefined;
  // A label comes from a small element (a button, a tab) — never read the full text of a big
  // container (a table section, a list), which can be thousands of characters of DOM walking.
  if (raw == null && !el.getAttribute?.("aria-label") && (el.childElementCount || 0) > 8) return undefined;
  const t = (raw ?? (el.getAttribute?.("aria-label") || el.textContent || "")).replace(/\s+/g, " ").trim();
  if (!t || t.length > 32 || /[_@]/.test(t) || /\d{4,}/.test(t)) return undefined;
  return t;
}

// "Home_btnPrimary__x3F2a" / "Home-module__Abc12__btnPrimary" -> "btnPrimary"
function componentClass(el) {
  const cls = typeof el.className === "string" ? el.className : "";
  const first = cls.split(/\s+/).find(Boolean);
  if (!first) return undefined;
  return first.replace(/^.*?module__[^_]+__/, "").replace(/^[A-Za-z]+_/, "").replace(/__[A-Za-z0-9_-]{4,}$/, "");
}

function screenProps() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return { screen: window.location.pathname, ...(tab ? { tab } : {}) };
}

function dataTrackProps(el) {
  const out = {};
  for (const [k, v] of Object.entries(el.dataset || {})) {
    if (k.startsWith("track") && k !== "track") out[k.slice(5).replace(/^./, (c) => c.toLowerCase())] = v;
  }
  return out;
}

function onClick(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) return;
  const explicit = target.closest("[data-track]");
  if (explicit) {
    track(explicit.dataset.track, { ...screenProps(), ...dataTrackProps(explicit) });
    return;
  }
  const el = target.closest("button, a[href], [role=button], [role=tab], summary");
  if (!el || el.disabled) return;
  const dialog = el.closest("[role=dialog]");
  if (el.getAttribute("role") === "tab") {
    track("tab_changed", { ...screenProps(), label: safeText(el), component: componentClass(el) });
    return;
  }
  const cls = typeof el.className === "string" ? el.className : "";
  const isLink = el.tagName === "A";
  let href;
  if (isLink) {
    try {
      const u = new URL(el.getAttribute("href"), window.location.origin);
      href = u.origin === window.location.origin ? u.pathname : u.hostname;
    } catch {}
  }
  track("cta_clicked", {
    ...screenProps(),
    kind: isLink ? "link" : el.querySelector("svg") && !el.textContent.trim() ? "icon_button" : "button",
    style: /btnPrimary|btn-primary/.test(cls) ? "primary" : /btnSecondary|btn-secondary/.test(cls) ? "secondary" : "other",
    label: safeText(el),
    component: componentClass(el),
    href,
    in_dialog: !!dialog || undefined,
  });
}

function controlLabel(el) {
  return (
    safeText(el, el.getAttribute("aria-label") || "") ||
    safeText(el.closest("label"), el.closest("label")?.textContent) ||
    safeText(el, el.placeholder || "") ||
    el.name ||
    el.id ||
    componentClass(el)
  );
}

function onChange(e) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  const tag = el.tagName;
  const type = el.type;
  if (!(tag === "SELECT" || (tag === "INPUT" && ["checkbox", "radio", "range", "date", "file"].includes(type)))) return;
  track("control_changed", {
    ...screenProps(),
    control: controlLabel(el),
    type: tag === "SELECT" ? "select" : type,
    ...(type === "checkbox" || type === "radio" ? { checked: el.checked } : {}),
  });
}

let searchTimer = null;
function onInput(e) {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  const isSearch = el.type === "search" || /search/i.test(el.placeholder || "") || /search/i.test(el.getAttribute("aria-label") || "");
  if (!isSearch) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (el.value) track("search_used", { ...screenProps(), control: controlLabel(el), query_length: el.value.length });
  }, 1000);
}

function onSubmit(e) {
  const f = e.target;
  if (f instanceof HTMLFormElement) track("form_submitted", { ...screenProps(), form: f.id || f.getAttribute("name") || componentClass(f) });
}

const seenDialogs = new WeakSet();
function looksLikeDialog(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (node.getAttribute("role") === "dialog") return true;
  const cls = typeof node.className === "string" ? node.className : "";
  if (/(modal|drawer|lightbox|sheetBackdrop|overlay)/i.test(cls)) return true;
  return node.style?.position === "fixed" && node.style?.inset === "0px";
}
// A modal/drawer is one or a few nodes. A record that adds dozens at once is a table or list
// rendering its rows, and inspecting every one of those nodes was pure overhead on heavy pages.
const MAX_NODES_PER_RECORD = 12;
function onMutations(records) {
  for (const r of records) {
    if (r.addedNodes.length > MAX_NODES_PER_RECORD) continue;
    for (const node of r.addedNodes) {
      if (node.nodeType !== 1 || node.tagName === "TR" || node.tagName === "TD" || node.tagName === "TBODY") continue;
      if (!looksLikeDialog(node) || seenDialogs.has(node)) continue;
      seenDialogs.add(node);
      const dlg = node.getAttribute("role") === "dialog" ? node : node.querySelector("[role=dialog]") || node;
      const heading = dlg.getAttribute("aria-label") || dlg.querySelector("h1,h2,h3")?.textContent || "";
      track("dialog_opened", { ...screenProps(), dialog: safeText(dlg, heading), component: componentClass(node) });
    }
  }
}

function wrapFetch() {
  const orig = window.fetch;
  if (orig.__phWrapped) return;
  const wrapped = async function (input, init) {
    let path;
    let method = "GET";
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, window.location.origin);
      method = (init?.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
      if (u.origin === window.location.origin && u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth")) path = u.pathname;
    } catch {}
    if (!path) return orig.apply(this, arguments);
    const t0 = performance.now();
    try {
      const res = await orig.apply(this, arguments);
      const duration_ms = Math.round(performance.now() - t0);
      if (method !== "GET") track("api_action", { path, method, status: res.status, ok: res.ok, duration_ms });
      else if (!res.ok) track("api_error", { path, method, status: res.status, duration_ms });
      return res;
    } catch (err) {
      if (err?.name !== "AbortError") track("api_error", { path, method, status: 0, error: err?.name, duration_ms: Math.round(performance.now() - t0) });
      throw err;
    }
  };
  wrapped.__phWrapped = true;
  window.fetch = wrapped;
}

let autoInstalled = false;
export function installAutoTracking() {
  if (autoInstalled || !started || typeof window === "undefined") return;
  autoInstalled = true;
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("copy", () => track("text_copied", { ...screenProps(), length: String(window.getSelection?.() || "").length }));
  window.addEventListener("error", (e) => track("js_error", { ...screenProps(), message: String(e.message || "").slice(0, 120) }));
  window.addEventListener("unhandledrejection", (e) => track("js_error", { ...screenProps(), message: String(e.reason?.message || e.reason || "").slice(0, 120), kind: "unhandled_rejection" }));
  new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
  wrapFetch();
}
