# Shiprocket Studio — Dark Theme Design System

Covers all pages in the `dark-theme/` folder: `index.html`, `alerts.html`, `rules.html`, `creative_report.html`, `chat.html`, `brand_report.html`, `workspace.html`, `checkout.html`, `payment.html`, `inspiration_hub.html`, and others.

---

## 1. Color Tokens

All pages share a consistent `:root` definition.

```css
:root {
  /* Backgrounds */
  --bg:     #0B0B14;                  /* Page background */
  --card:   rgba(255,255,255,.04);    /* Card surface */
  --card2:  rgba(255,255,255,.07);    /* Elevated card / hover */

  /* Borders */
  --border:  rgba(255,255,255,.08);   /* Default border */
  --border2: rgba(255,255,255,.14);   /* Hover / focus border */

  /* Text hierarchy */
  --t1: #fff;                         /* Primary text */
  --t2: rgba(255,255,255,.55);        /* Secondary text */
  --t3: rgba(255,255,255,.28);        /* Tertiary / disabled text */

  /* Brand */
  --purple: #AF46FD;
  --pink:   #F4349D;
  --grad:   linear-gradient(135deg, #AF46FD, #DA3BC2, #F4349D);

  /* Semantic */
  --green: #22C55E;
  --amber: #F59E0B;
  --red:   #EF4444;
  --blue:  #60A5FA;
}
```

### Background layer stack

| Layer | Value | Used for |
|-------|-------|----------|
| Page base | `#0B0B14` | `<html>`, `<body>` |
| Sidebar | `#0d0d1a` | Left nav strip |
| Card | `rgba(255,255,255,.04)` | All cards |
| Card elevated | `rgba(255,255,255,.07)` | Hover state, sub-panels |
| Modal | `#0f0e1e` / `#0E0B18` | Dialog backgrounds |

### Semantic color usage

| Color | Hex | Used for |
|-------|-----|---------|
| Purple | `#AF46FD` | Active states, primary accent, focus rings |
| Pink | `#F4349D` | Gradient endpoint, branding |
| Green | `#22C55E` | Success, active, positive delta |
| Amber | `#F59E0B` | Warning, pending, auto-approve |
| Red | `#EF4444` | Pause actions, errors, destructive |
| Blue | `#60A5FA` | Move actions, info |

### Gradient

```css
/* Main brand gradient — buttons, active indicators, avatars */
linear-gradient(135deg, #AF46FD, #DA3BC2, #F4349D)

/* Text gradient (brand_report, chat) */
linear-gradient(135deg, #C084FC, #F472B6)
/* Applied via: background-clip: text; -webkit-text-fill-color: transparent */
```

---

## 2. Typography

**Font family:** `'Plus Jakarta Sans', sans-serif` (Google Fonts, weights 400 500 600 700 800)

`brand_report.html` also loads `Instrument Serif` for decorative italic headings.

### Size scale

| Size | Weight | Usage |
|------|--------|-------|
| 9px | 700–800 | Uppercase badge labels, connector tags (`AND` / `OR`) |
| 10px | 600–700 | Meta text, stat labels, pill text |
| 11px | 600–700 | Secondary descriptions, small buttons |
| 11.5px | 600 | Card subtitles, meta rows |
| 12px | 500–700 | Body text, dropdown items |
| 12.5px | 600–700 | Condition rows, compact body |
| 13px | 600–700 | Button text, card titles, input text |
| 14px | 400–700 | Primary page body |
| 15px | 700–800 | Section titles, modal titles |
| 16px | 800 | Topbar title, page headings |
| 18px–22px | 800 | Stat values, card section headers |
| 26px–40px | 800 | Hero / page-level headings (responsive) |

### Text hierarchy summary

```
Page title       → 16px / w800 / --t1
Section heading  → 15px / w700 / --t1
Card title       → 13–14px / w700 / --t1
Body primary     → 12–14px / w500 / --t1
Body secondary   → 11–12px / w600 / --t2
Meta / label     → 10–11px / w600 / --t3
Badge / tag      → 9–10px / w700–800 / uppercase / --t3 or status color
Stat value       → 18–32px / w800 / --t1 or gradient
```

---

## 3. Layout & Spacing

### Page shell

```
┌─────────────────────────────────────────────────┐
│  Sidebar (64px fixed)  │  Main                  │
│                        │  ┌─ Topbar (60px) ─┐  │
│                        │  └─ Content ────────┘  │
└─────────────────────────────────────────────────┘
```

| Element | Value |
|---------|-------|
| Sidebar width | `64px` |
| Topbar height | `60px` |
| Content padding | `32px 36px` (desktop) / `16px 14px` (mobile) |
| Card padding | `16px–20px` |
| Section gap | `20px–36px` |
| Element gap | `6px–14px` |

### Padding / gap reference

```
xs  →  4–6px    (icon gaps, tight inline)
sm  →  8–12px   (between sibling elements)
md  →  14–18px  (card padding, button padding)
lg  →  22–28px  (section spacing)
xl  →  32–40px  (content padding, hero sections)
```

### Grid patterns

```css
/* Stat bar */
display: flex; (equal-width children with dividers)

/* Creative grid */
grid-template-columns: repeat(4, 1fr);   /* desktop */
grid-template-columns: repeat(2, 1fr);   /* mobile */

/* Insight panels */
grid-template-columns: repeat(3, 1fr);
```

---

## 4. Border Radius

| Value | Usage |
|-------|-------|
| 4–6px | Checkbox, tiny tag, value pill |
| 7–8px | Small buttons, icon buttons |
| 9–10px | Inputs, condition rows, small cards |
| 12px | Standard cards, level tabs, rule cards |
| 14px | Larger cards, stat bars |
| 16–18px | Modals, large drawers |
| 20px | Full pills — badges, frequency chips, toggle pills |
| 50% | Avatars, toggle thumbs, status dots |

---

## 5. Components

### Sidebar

```css
width: 64px; background: #0d0d1a;
border-right: 1px solid var(--border);

.sb-item          → 44×44px, border-radius 12px, flex column
.sb-item:hover    → background: var(--card2); color: var(--t2)
.sb-item.active   → background: rgba(175,70,253,.12); color: var(--purple)
.sb-logo          → 36×36px, border-radius 10px
.sb-ws-bubble     → 32×32px, circular, gradient background
```

### Topbar

```css
height: 60px; padding: 0 28px;
background: rgba(11,11,20,.98);
border-bottom: 1px solid var(--border);
```

### Buttons

**Primary (gradient)**
```css
background: var(--grad); color: #fff; border: none;
padding: 7–9px 14–16px; border-radius: 8–10px;
font-size: 12–13px; font-weight: 700;
hover → opacity: .85–.88
box-shadow (optional): 0 4px 24px rgba(175,70,253,.3)
```

**Secondary**
```css
background: rgba(255,255,255,.06);
border: 1px solid rgba(255,255,255,.1);
color: var(--t2);
hover → background: rgba(255,255,255,.1); color: var(--t1)
```

**Ghost / topbar**
```css
background: var(--card); border: 1px solid var(--border);
color: var(--t2); padding: 7px 14px; border-radius: 9px;
hover → border-color: var(--border2); color: var(--t1)
```

**Icon button**
```css
width: 28–32px; height: 28–32px; border-radius: 7–8px;
background: rgba(255,255,255,.04);
border: 1px solid rgba(255,255,255,.08);
hover → background: rgba(255,255,255,.1)
```

**Disabled state (all)**
```css
opacity: .35; cursor: not-allowed; pointer-events: none;
```

### Cards

```css
background: var(--card);
border: 1px solid var(--border);
border-radius: 12–14px;
padding: 16–20px;
transition: border-color .2s, background .2s;
hover → background: var(--card2); border-color: var(--border2)
```

### Badges & pills

```css
/* Base */
padding: 3–4px 8–10px; border-radius: 6–20px;
font-size: 10–11px; font-weight: 700;

/* Pause / danger */
background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.15); color: #ff7070;

/* Budget up / success */
background: rgba(34,197,94,.07); border: 1px solid rgba(34,197,94,.15); color: #4ade80;

/* Warning / amber */
background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.25); color: #fbbf24;

/* Move / blue */
background: rgba(96,165,250,.07); border: 1px solid rgba(96,165,250,.15); color: #93c5fd;

/* Purple accent */
background: rgba(175,70,253,.12); border: 1px solid rgba(175,70,253,.2); color: var(--purple);
```

### Toggle (on/off switch)

```css
width: 34px; height: 20px; border-radius: 20px;
background: rgba(255,255,255,.07); /* off */
background: var(--purple);         /* on */

.thumb → width: 12px; height: 12px; border-radius: 50%;
         left: 3px (off) → translateX(14px) (on)
         background: rgba(255,255,255,.35) → #fff
```

### Inputs & selects

```css
padding: 9–10px 13–14px; border-radius: 9–12px;
background: rgba(255,255,255,.04);
border: 1px solid rgba(255,255,255,.1);
color: var(--t1); font-family: inherit; font-size: 13px;
outline: none;
focus → border-color: rgba(175,70,253,.4); background: rgba(175,70,253,.05)
placeholder → color: var(--t3)
```

### Modals

```css
/* Overlay */
background: rgba(0,0,0,.65); backdrop-filter: blur(4–8px);
transition: opacity .2s;

/* Dialog */
width: 640px; max-width: 96vw; max-height: 88vh;
background: #0f0e1e;
border: 1px solid rgba(175,70,253,.25);
border-radius: 18px;
box-shadow: 0 24px 80px rgba(0,0,0,.7);
transform: translateY(12px) → translateY(0); /* open animation */

/* Mobile bottom sheet */
width: 100%; border-radius: 18px 18px 0 0;
```

### Dropdowns / popovers

```css
position: absolute; top: calc(100% + 8px);
min-width: 240px;
background: #13122a;
border: 1px solid rgba(255,255,255,.1);
border-radius: 14px;
box-shadow: 0 8px 32px rgba(0,0,0,.5);
overflow: hidden;
```

### Stat bar

```css
display: flex; background: var(--card);
border: 1px solid var(--border); border-radius: 12px;
overflow: hidden;

.page-stat → flex: 1; padding: 13px 20px; gap: 10px;
+ divider  → 1px rgba(255,255,255,.07), height 60%
```

### Tabs (level filter)

```css
background: rgba(255,255,255,.03); border: 1px solid var(--border);
border-radius: 10px; padding: 3px; width: fit-content;

.tab → padding: 7px 16px; border-radius: 7px; font-size: 11.5px; font-weight: 700;
.tab.active → background: rgba(175,70,253,.15);
              border: 1px solid rgba(175,70,253,.3);
              color: var(--purple);
```

### Condition tree (rules — V2 mode)

```css
.t2-tree    → padding-left: 22px; vertical line at left: 6px
.t2-dot     → 9×9px circle, purple (#AF46FD), absolute left: -22px
.t2-dot.sm  → 7×7px, amber (nested group indicator)
.t2-branch  → border-left: 1px solid rgba(255,160,50,.25); margin-left: 8px
.t2-and     → pill, purple, 9px uppercase
.t2-or      → pill, amber, 9px uppercase
```

---

## 6. Shadows & Effects

### Box shadows

| Context | Value |
|---------|-------|
| Dropdown / popover | `0 8px 32px rgba(0,0,0,.5)` |
| Modal | `0 24px 80px rgba(0,0,0,.7)` |
| Modal glow (special) | `0 0 80px rgba(175,70,253,.18), 0 32px 80px rgba(0,0,0,.7)` |
| Gradient button | `0 4px 24px rgba(175,70,253,.3)` |
| Active tab | `0 1px 8px rgba(175,70,253,.12)` |

### Background glows (radial-gradient overlays on page)

```css
/* Subtle corner glow — most pages */
radial-gradient(ellipse 40% 50% at 75% 20%, rgba(175,70,253,.07), transparent 65%)

/* Modal inner glow */
radial-gradient(ellipse 80% 50% at 50% 0%, rgba(175,70,253,.12), transparent 60%)
```

### Backdrop filter

| Usage | Value |
|-------|-------|
| Modal overlay | `blur(4–8px)` |
| Topbar sticky | `blur(16–20px)` |

---

## 7. Animations

```css
/* General */
transition: all .15s;               /* hover state changes */
transition: background .2s, border-color .2s;   /* cards */

/* Modal open */
transform: translateY(12px) → translateY(0); /* .25s */

/* Drawer / sidebar */
transform: translateX(-100%) → translateX(0); /* .25–.28s cubic-bezier(.4,0,.2,1) */

/* Keyframes */
@keyframes spin      { to { transform: rotate(360deg) } }  /* .7s linear infinite */
@keyframes fadeUp    { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
@keyframes pulse     { 0%,100% { opacity:1; transform:scale(1) } 50% { opacity:.5; transform:scale(1.5) } }
@keyframes payPulse  { 0% → 50% → 100% green glow ring }
```

---

## 8. Icons

All icons are inline SVGs with `stroke="currentColor"`, `fill="none"`, and `stroke-width="2"` (occasionally `1.8` or `2.5` for finer/bolder strokes).

| Size | Context |
|------|---------|
| 10px | Badge checkmarks, tiny inline indicators |
| 12–13px | Button icons, card action icons |
| 14–15px | Topbar buttons, stat icons |
| 17px | Sidebar nav icons |
| 18–20px | Bottom nav icons |
| 24px | Modal / hero section icons |
| 36–40px | Empty state illustrations |

---

## 9. Responsive Breakpoints

| Breakpoint | Trigger |
|------------|---------|
| `max-width: 768px` | Mobile (rules.html) |
| `max-width: 640px` | Mobile (alerts.html, most pages) |
| `max-width: 760px` | Tablet / narrow (chat, workspace) |
| `max-width: 1100px` | Large tablet / narrow desktop |
| `max-width: 1400px` | Wide desktop column reduction |

### Mobile changes (≤640–768px)

- Sidebar → hidden; bottom nav → visible (`position: fixed; bottom: 0; height: 56–60px`)
- Topbar → height auto, wraps to 2 rows; padding `10–14px`
- Content padding → `14–16px`
- Stats bar → `grid-template-columns: 1fr 1fr`
- Level tabs → horizontal scroll, `overflow-x: auto; scrollbar: none`
- Modals → full-width bottom sheet: `border-radius: 18px 18px 0 0`
- Cards → remove large left padding, show drag handle with bigger touch target
- Drag-and-drop → HTML5 drag events + `touchstart/touchmove/touchend` fallback

### Bottom nav (mobile)

```css
position: fixed; bottom: 0; left: 0; right: 0;
height: 56–60px; background: #0d0d1a;
border-top: 1px solid rgba(255,255,255,.08);
display: flex; justify-content: space-around;

.nav-item       → flex-direction: column; gap: 3px; font-size: 9px; font-weight: 600;
.nav-item.active → color: var(--purple)
```

---

## 10. Z-Index Scale

| Layer | Value |
|-------|-------|
| Cards, content | 0–10 |
| Sticky topbar | 100–200 |
| Fixed bottom nav | 300 |
| Dropdowns / popovers | 300–500 |
| Modals | 600–800 |
| Toasts / alerts | 900 |

---

## 11. Scrollbars

All scrollable regions use a custom thin scrollbar:

```css
::-webkit-scrollbar       { width: 3–4px }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,.07); border-radius: 3px }
/* Hide entirely on mobile */
::-webkit-scrollbar       { display: none }
scrollbar-width: none;   /* Firefox */
```

---

## 12. Quick Reference — Opacity Scale

| Token | Value | Meaning |
|-------|-------|---------|
| `--t1` | `#fff` (100%) | Primary text |
| `--t2` | 55% white | Secondary / body |
| `--t3` | 28% white | Tertiary / placeholder |
| `--card` | 4% white | Surface fill |
| `--card2` | 7% white | Elevated surface |
| `--border` | 8% white | Default dividers |
| `--border2` | 14% white | Hover / focus dividers |
| Disabled | ~35% opacity | Any disabled element |
