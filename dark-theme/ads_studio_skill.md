# Shiprocket Ads Studio — Product Knowledge Base

> **What is Shiprocket Ads Studio?**
> A DIY marketing intelligence and creative tool for D2C merchants running ads on Meta (Facebook/Instagram) and Google. It acts as a **marketing analyst + creative assistant** in one dashboard — helping merchants understand which ads work, why some fail, what competitors are doing, and generate new creatives using AI.
>
> **Target users:** D2C brands, Shopify/Shiprocket merchants, agencies managing ads for clients, performance marketers, and growth managers.

---

## Table of Contents

1. [Onboarding & Account Setup](#1-onboarding--account-setup)
2. [Workspaces](#2-workspaces)
3. [Subscription & Plans](#3-subscription--plans)
4. [Ad Account Connection](#4-ad-account-connection)
5. [2-Tier Managed Campaigns (Meta)](#5-2-tier-managed-campaigns-meta)
6. [Creative Audit (Meta)](#6-creative-audit-meta)
7. [Google Audit](#7-google-audit)
8. [Audit Actionables](#8-audit-actionables)
9. [Competitor Tracking & Research](#9-competitor-tracking--research)
10. [Instagram Intelligence](#10-instagram-intelligence)
11. [Ad Library & Search](#11-ad-library--search)
12. [AI Ad Creation](#12-ai-ad-creation)
13. [Motion Catalog (Video Ads)](#13-motion-catalog-video-ads)
14. [Manual Video Generation](#14-manual-video-generation)
15. [Characters (AI Models)](#15-characters-ai-models)
16. [Ad Launcher](#16-ad-launcher)
17. [Automated Campaign Optimizer](#17-automated-campaign-optimizer)
18. [Bookmarking & Collections](#18-bookmarking--collections)
19. [Audience Pro](#19-audience-pro)
20. [Ad Analyzer (Public Tool)](#20-ad-analyzer-public-tool)
21. [Reports & Notifications](#21-reports--notifications)
22. [FAQs Summary](#22-faqs-summary)

---

## 1. Onboarding & Account Setup

### Connecting a Facebook Ad Account
- User clicks **"Connect Facebook Ad Account"** → Facebook OAuth → selects ad account(s).
- System immediately fetches last 7 days of data.
- If token expires, user gets a reconnect prompt.
- Multiple accounts supported.

### Adding a Brand
- Triggered on first login or via manual "Add Brand" button.
- User searches for an existing brand **or** enters a domain URL.
- System auto-fetches brand name, logo, and product categories by crawling the domain.
- User reviews and confirms auto-detected categories, can add custom ones.
- After onboarding, a brand card appears on the dashboard; editable via the edit modal.
- Brand info drives personalized ad feeds, competitor suggestions, and ad ranking.

### Sign-In Flow
- First screen: phone number only.
- New users: asked for name + email.
- Returning users: phone login only (name/email not re-asked).

---

## 2. Workspaces

Workspaces let users organize multiple brands/business entities in one account.

### Left Panel — Workspace List
- Shows all workspaces with name, domain URL, status (Active/Inactive), and connected platforms (Meta, Google, Shopify).
- Total workspace count shown as a badge.
- Click any card to load details in the right panel.
- **Add New Workspace** button at the bottom creates a new workspace.

### Right Panel — Workspace Detail
- Shows workspace name, domain URL, status.
- **Mark Inactive / Mark Active** button at top right toggles workspace state.
- Three platform sections: Meta Ads, Google Ads, Shopify — each showing connected accounts, slots used (e.g., 2/3), and account tags.

### Platform Limits
| Platform | Max Accounts per Workspace |
|----------|--------------------------|
| Meta Ads | 3 |
| Google Ads | 3 |
| Shopify | 3 |

### User Actions
| Action | Where |
|--------|-------|
| Create workspace | Add New Workspace button |
| View workspace | Click workspace card |
| Deactivate | Mark Inactive button |
| Connect ad account | + Add Account inside platform section |
| Disconnect ad account | × button on account tag |
| Rename workspace | Edit icon next to workspace name |
| Switch workspace | Workspace switcher at bottom-left sidebar |

---

## 3. Subscription & Plans

Studio offers a **freemium model** with monthly paid tiers.

### Plan Tiers
| Feature | Free | ₹9,999/mo | ₹24,999/mo |
|---------|------|-----------|------------|
| Self Ad Accounts | 1 | 5 | 25 |
| Audit Reports | 5 | 50 | 250 |
| Static Ad Generations | 25 | 200 | 1,000 |
| Motion Catalog Videos | 5 | 50 | 250 |
| Brands to Follow | 2 | 5 | 25 |

### Key Billing Behaviors
- New users get a **30-day free trial** with upgrade nudges.
- When limits are hit, a blocking modal appears with a prominent upgrade CTA.
- **Upgrade:** Immediate effect; new limits replace old; updated invoice emailed.
- **Cancellation:** OTP-verified; access continues until end of billing cycle; no refunds.
- **Payment failure:** 7-day retry window with daily emails and in-app banners; account suspended if unpaid after D+7.
- **Usage Dashboard:** Visual progress bars per limit (e.g., "Accounts connected: 3/5").
- **Billing section:** Past payments, invoice PDF downloads, renewal date, cancellation option.

---

## 4. Ad Account Connection

- Studio connects to **Meta Ads** and **Google Ads** via secure OAuth.
- Studio reads ad data only — it **does NOT run or modify ads automatically**.
- Permissions required: campaign performance, creative assets, audience insights, spend metrics.
- No payment data is accessed. No campaign changes happen automatically.

---

## 5. 2-Tier Managed Campaigns (Meta)

A fully managed Meta ad campaign service for merchants who want Shiprocket to run ads on their behalf. This is a guided multi-step onboarding + campaign management flow.

### Part 1 — Meta Infrastructure Setup (Automated Wizard)
A 4-part automated wizard that sets up the merchant's Facebook advertising infrastructure:

1. **Identity & OAuth:** Merchant connects Facebook via OAuth (grants `ads_management`, `business_management`, `catalog_management`, page permissions). Selects their brand Facebook Page.
   - Edge cases: no page → deep link to create one + background polling every 15s; insufficient permissions → re-auth prompt.

2. **Account Infrastructure Setup:** Auto-creates a "Child Business Manager" under Shiprocket's parent BM, applies Shiprocket's Line of Credit (no merchant credit card needed), creates a funded Ad Account, and generates a Child System User with a CAPI token for Shopify/Conversions API integration.

3. **Asset Discovery & Mapping:** Scans existing Meta ecosystem for Pixels and Catalogs. Merchant selects or creates a Pixel. For catalogs, can select existing or connect Shopify. System handles cross-business asset sharing, links Pixel to Catalog for Dynamic Product Ads (DPAs).

4. **Confirmation Screen:** Shows a success checklist — Managed Ad Account active, Credit Line funded, Pixel receiving signals, CAPI token active, Catalog synced. If new Pixel created, shows CAPI token + Shopify setup instructions.

### Part 2 — Plan Selection & Payment
- **Plan cards** show: ad budget amount, traffic/click target, category-based performance baseline, and expected order outcomes. GST revealed only on plan selection.
- **Payment gateway** (Easebuzz/Razorpay): success → confetti + transaction details; failure → retry/go-back options with specific error messages (wrong OTP, bank limits, network errors, etc.).

### Part 3 — Campaign Asset Setup
- Merchant selects **products** (from Shopify catalog or custom URL) and **goal** (Sales or Lead Generation).
- Uploads creative assets (images/videos, max 100MB each).
- Submit CTA disabled until at least one product source + one media asset are provided.

### Campaign Panel States
| State | Description |
|-------|-------------|
| Under Review (creatives uploaded) | Setup complete and creatives provided |
| Under Review (no creatives) | Setup done but no creatives uploaded yet — shows upload nudge |
| Incomplete | Setup deferred — shows complete-setup prompt |
| Active | Live campaign with live metrics |

### Performance Analytics (Active Campaigns)
- Toggle between **Facebook** and **Instagram** tabs.
- Metrics: Impressions, Clicks, CTR, Conversions.
- Audience breakdowns: gender, age group.
- Delivery breakdowns: placements, devices.

---

## 6. Creative Audit (Meta)

The Creative Audit analyzes all ads in a connected account and evaluates them based on performance.

### Core Features
- **Multiple Ad Accounts:** Run an audit across multiple connected Facebook Ad Accounts simultaneously.
- **Date Range:** Select custom date ranges; regenerate for different ranges (opens in a new tab).
- **Report Generation:** Background async job; target under 3 minutes with a progress bar.
- **Generated Reports Page:** Shows only the logged-in user's reports with date range and account name(s).

### Audit Sections

**Creative Performance Table:** Sorted by descending ROAS by default. Shows: Creative thumbnail preview, ad name, ad set, campaign, status (Active/Inactive), CPR, Spend, ROAS. Users can add metrics (Purchases, Purchase Value, Conversion %, ATC %, LPV %). Ads with spend < ₹100 are excluded.

**Creative Sections:**
- **Scaling Ads:** ROAS improving week-on-week (only ads with ₹500+ spend shown).
- **Descaling Ads:** ROAS declining week-on-week (only ads with ₹500+ spend shown).
- **Best Performing Ads:** Top ROAS (only ads with ₹500+ spend shown).
- **Top Spends:** Highest spend.

**Week-on-Week Trends:** Key metrics (Spend, Revenue, ROAS, Conversion, CPP) — last 7 days vs. prior 7 days.

**Distribution Breakdowns:**
- Age-Gender performance
- Conversion graphs
- ROAS trends

**Granular Filtering (Campaign/Adset Level):**
- Multi-select dropdown to filter by specific campaigns, then drill down into their ad sets.
- All charts and insight panels update dynamically on filter selection.
- Default: all campaigns aggregated.

**Creative Audit V2 — Metadata Aggregation Pivot Table:**
- Performance metrics (ROAS, Spend, Purchase Value, etc.) aggregated by creative metadata dimensions.
- Metadata dimensions: Hook Type, Storytelling Style, Layout Type, Visual Style, Customer Lifecycle Stage.
- **Priority-based metadata resolution:** When an ad has multiple values for a dimension, a single "primary" value is chosen using a global priority ranking — eliminates double-counting.
- **Dynamic Pivot Table:** Switch dimension (e.g., Hook Type ↔ Storytelling Style), add/remove metrics — no page reloads.
- Ad counts in grouping tables are clickable hyperlinks opening filtered ad lists.

**Advanced Filters:**
- Keyword exclusion (filter out campaigns/adsets/ads by name keywords).
- Active Campaigns Only toggle.

**AI Summarization:** Auto-generated AI summary of the audit in four structured sections:
1. Overview
2. What's Working
3. What's Not Working
4. Priority Actions

Available on manual date selection in both Facebook and Google Audits.

**Frequency Metric:** Frequency is available as a metric across Creative Report, Meta Data Report, Top Performing, Scaling, Descaling, and All Ads tables.

**Top Spending Campaigns:** Top 10 campaigns scrollable view; shows Total Spend, ROAS, AOV, CPM. PDF export restricts to Top 3.

**Report Sharing:**
- Share icon on all reports.
- Logged-in recipients see the report immediately.
- Logged-out recipients must sign in first.
- Viewing a shared report does NOT save it to the viewer's account.
- Share via page header URL link.

---

## 7. Google Audit

Studio provides an audit for Google Ads accounts covering:
- Account-level KPIs: ROAS, CPA, CTR, CVR, etc.
- Device-level performance.
- Branded vs. non-branded keywords.
- Campaign type breakdown.
- Search campaign deep-dive: best/worst campaigns, keyword analysis, match type distribution.
- Product-level performance.
- Performance Max (PMax) campaigns.
- Merchant Center catalog health.

AI summarization available on manual date selection.

---

## 8. Audit Actionables

Transforms dense audit data into visual, interactive, actionable insights.

### Scatterplot Visualization
- All live campaigns plotted: **ROAS (Y-axis)** vs. **Spend (X-axis)**.
- Color-coded dots:
  - 🟢 **Green:** Healthy, no issues.
  - 🟠 **Orange:** Flagged for recent changes or technical signals.
  - 🔴 **Red:** Other actionable issues.
- Hover over a dot: campaign name, spend, ROAS, conversions, specific issue(s).

### Actionable Sections (5 tabs)
1. **Campaign-level** insights
2. **Creative-level** insights
3. **Adset-level** insights
4. **Technical Insights** — flags creatives where the ad redirect URL load time exceeds 3 seconds (crawled daily); mapped to affected campaigns/adsets.
5. **Recent Changes** — flags recent campaign edits correlated with performance shifts.

Each section shows flagged items with a headline, sub-headline, and an **Opportunity Lost** figure (sum of yesterday's spend for all flagged items in that section).

### Date Filter Logic
- Actionables load for: 7/30/60/90 day presets, or when T-1 is selected in a custom range.
- Invalid ranges show an explanatory message.

---

## 9. Competitor Tracking & Research

### Track Your Competitor (Facebook/Meta)
- Default view: ads from brands in the same category for last 7 days; adjustable date range.
- **Add competitor:** Search internal brand library or paste a Facebook Ad Library URL. System auto-fetches competitor name and initial 7-day ad set.
- Daily scheduled refresh; also surfaces historically scraped ads no longer publicly available.

**Creative Summary Block per competitor:**
- Total ad count, media type split (image/video/carousel).
- Unique landing pages (UTM-stripped).
- Active vs. inactive ad counts.
- Ad Library visible vs. archived counts.

**Creative Listing:**
- Thumbnail, media type, launch date.
- Inline video playback.
- "View this ad" modal with full creative detail: media, caption, CTA, landing page URL.

**Filters & Sorting:** Media Type (All/Image/Video), Status (All/Active/Inactive), Sort by newest/oldest. All combinable.

**Manual Refresh:** User can force-refresh from the UI at any time.

### Competitor Report (90-Day Auto-Generated)
One-click, structured analytics report covering the last 90 days of competitor ad activity:

| Section | Details |
|---------|---------|
| **Volume** | Total ads run in last 90 days |
| **Format Analysis** | Recommended top format; split of active/all ads by format (pie/bar charts) |
| **Creative Intelligence** | Customer lifecycle stage distribution; CTA split; top hooks, storytelling styles, visual styles |
| **Landing Page & Product** | Top landing pages, collections, products advertised |
| **Video-Specific Insights** | Product interaction type, audio type, duration distribution, creator presence, sequence patterns, offer visibility |
| **Drill-Down** | Every chart segment/table row → "View Ads" button → drawer with actual ads + creative previews + metadata |

AI Summarization: up to 500-word actionable competitor ad intelligence summary.

---

## 10. Instagram Intelligence

### Follow Your Competitors — Instagram
AI-powered competitor intelligence for Instagram posts.

**Phase 1 — Handle Onboarding:**
- Search bar for competitor Instagram @handles.
- Validates accounts via Instagram Business Discovery API (public Business/Creator accounts only).
- Triggers "warm-up scrape" of last 7 days of media on add.

**Phase 2 — Command Center (Aggregated Analytics):**
- Content Mix donut chart (Reels vs. Images ratio).
- User Insights (engaged users by sentiment level).
- Date Picker (dual-month calendar; all charts + post grid refresh on selection).
- 4-column infinite-scroll Creative Grid.

**Phase 3 — Deep-Dive Post Modal:**
- Split-pane: media (left) + intelligence (right).
- **Tab A — Creative AI Description:** AI summary of visual style and objective, "What Went Well" (scroll-stopper hooks), "What Can Be Improved" (tactical suggestions).
- **Tab B — Sentiment Analysis:** 8-level bar chart of comment intent distribution + scrollable comment feed.

**AI Sentiment Engine:** LLM classifies each comment into 8 buckets — Positive, Inquiring, Sharing, Complaining, Suggesting, Negative, Comparing, Partnering. Supports Hinglish, sarcasm, emoji intent.

### User Insights — Instagram
Turns competitor Instagram engagement data into a lead-generation tool.

- **Audience Population Counter:** Total unique users who engaged with a competitor's posts in a selected date range.
- **Interaction Breakdown:** Unique Likers vs. unique Commenters.
- **Cohort Segments for Export:**
  - Total Likers
  - Total Commenters
  - Positive Cohort (Positive, Inquiring, Sharing, Comparing, Suggesting, Partnering sentiments)
  - Negative Cohort (Negative, Complaining)
  - Mixed Engagement
- **Export:** Click "Generate & Email Report" → background job compiles + deduplicates list → emails CSV/Excel with Instagram Handle, Profile URL, Engagement Category, Interaction Frequency, Most Recent Comment.

---

## 11. Ad Library & Search

### Ad Library
- **100,000+ ads** across industries.
- Merchants browse for creative inspiration: discover new formats, explore hooks, identify trending styles.
- Infinite scroll; full-screen playback for videos.

### Search & Ranking System
**LLM-powered metadata per ad:**
| Dimension | Options |
|-----------|---------|
| Customer Lifecycle | Push Brand, Push Problem, Push Product, Push Differentiation, Push Offer, Retarget |
| Layout Type | 15 options (single product focus, multi-product grid, testimonial, step-by-step, etc.) |
| Storytelling Style | 26 options (problem-solution, before-after, UGC, meme, myth-busting, etc.) |
| Visual Style | 19 options (minimalistic, lifestyle, cinematic, luxury, meme-style, etc.) |
| Other | Product, Sub-Category, Category, Brand, Target Demographic Gender, Aspect Ratio |

**Personalized Feed:**
- Brand added → ads ranked by matching category first, then recency.
- No brand → purely by recency.

**Search Suggestions:**
- No input → recent searches, or category suggestions (no brand) / storytelling style suggestions (brand added).
- User types → hierarchy: Customer Life Cycle → Storytelling Style → Layout Type → Brand, sorted by count of matching ads.

**Search Ranking (weighted property matching):**
| Property | Weight |
|----------|--------|
| Product | 12× |
| Sub-Category | 11× |
| Category | 10× |
| Storytelling Style | 6× |
| Customer Life Cycle | 5× |
| Layout Type | 5× |
| Visual Style | 4× |
| Target Demographic Gender | 2× |

---

## 12. AI Ad Creation

### Core Flow (6 Steps)
1. **Inspiration Search:** Search reference ads by keywords from the library (100K+ ads with 50+ extracted parameters per ad).
2. **Inspiration Selection:** Select 1–5 reference images as style inspiration.
3. **Product Upload:** Upload product image (JPG/PNG/WEBP, max 10MB). System auto-removes background via AI; user confirms cleaned image.
4. **Creative Parameters:** Number of iterations per inspiration (1–10), aspect ratio (1:1, 9:16, 3:2, 5:4, 16:9), brand selection.
5. **AI Generation:** System merges inspiration style(s) with product image. Total creatives = inspirations × iterations. Progress indicator shown. Auto-retry: max 2 retries, 2-min timeout per batch.
6. **Output & Export:** Preview, export JPG/PNG, send to editor, save to Brand Library, regenerate, or compare against original inspiration.

### Upload Your Own Inspiration
- Entry point: "Create Ad from Your Inspiration" CTA.
- User uploads their own inspiration image (PNG/JPG/JPEG) → saved to personal "Your Uploaded Inspirations" collection.
- Then uploads product image → selects aspect ratio → generates ad.
- Per-ad regeneration available.

### In-Platform Creative Editor
After AI generation, merchants can edit creatives without leaving the platform:
- **Canvas:** Drag-and-drop, layer-based editing.
- **Text Module:** Multiple text boxes with font, size, color, alignment, line spacing controls.
- **CTA Component:** Editable shape, text (e.g., "Shop Now"), background color, text color, border radius, snap-to-grid positioning.
- **Asset Library:** Upload logos, product images, brand assets (PNG/JPG/SVG); stored at account level for reuse.
- **URL Asset Scraper:** Enter website URL → system scrapes logos, product images, and banners into the asset library.
- **Layout Tools:** Snap-to-grid, center alignment guides, layer ordering, resize/rotate.
- **Output:** Save as draft, export PNG/JPG, or send directly to ad creation flow.
- **Entry points:** Post-AI-image generation ("Edit & Convert to Ad") or from image library ("Open in Editor").

---

## 13. Motion Catalog (Video Ads)

A guided, automated motion video generation flow for apparel product catalog images.

### 5-Step Creation Flow
1. **Motion Style Selection:** Pick from 5 predefined animation styles — Zoom In/Out, Default Rotation, Zoom Bottom, Zoom Top, Flow. Hover to auto-play a preview.
2. **Product Selection:** Select an apparel product from the synced catalog (non-apparel blocked with error). Product must have at least 2 images.
3. **Product Image Selection:** Select one front + one back image from catalog or paste a PDP URL (auto-fetches images). Computer vision validates front/back apparel views.
4. **Character Selection:** Pick a character from personal library, platform library, or upload new (front + back images, validated as human models).
5. **Final Validation & Creation:** All checks must pass before "Create Motion Catalog Video" CTA is enabled. Video renders and saves to motion catalog library for preview, download, or use in ads.

**Phase 1 scope:** Apparel only. Custom editing, audio, and non-apparel are out of scope.

---

## 14. Manual Video Generation

A guided, human-assisted video ad production flow with low-risk payment.

### Flow
1. **Video Ad Library:** Infinite-scroll library of video ads; search by brand, category, hook type, storytelling style.
2. **Category-Based Templates:** Pre-defined video concepts grouped by vertical (Apparel, Beauty, Electronics, etc.).
3. **Video Preview:** Clicking a sample → popup with video + similar ads (matched by storytelling style, hook type, category).
4. **Multi-Select:** Select one or more video formats to proceed.
5. **Product Selection:** Provide product details via URL (auto-fills title, description, images) or manual upload + optional description.
6. **Aspect Ratio:** 1:1, 4:5, 9:16, or 16:9.
7. **AI Storyboard Generation:** System generates a scene-by-scene storyboard per concept using product inputs and template. Storyboard includes: timing, visual descriptions, voiceover dialogue, on-screen text. Adapted to product's physical nature; Hinglish phonetic transliteration supported.
8. **Storyboard Regeneration:** Users can request a new version with specific feedback.
9. **Final Selection:** Drop unwanted storyboards before paying.
10. **Payment:** 20% upfront via credits; full refund guaranteed on creative mismatch or withdrawal.
11. **Post-Payment:** Confirmation email sent; production team schedules a call.

---

## 15. Characters (AI Models)

A structured, two-phase guided creation flow for generating photorealistic AI characters for use in ad creatives.

### Flow A — Create Your Character (AI-Generated)
- **Form inputs:** Age Range, Ethnicity, Gender, Skin Tone, Body Structure, optional open-ended description.
- **Phase 1 (Identity Discovery):** 5 unique AI headshots generated → user selects one to lock facial identity anchor.
- **Phase 2 (Variation Matrix):** 5 style variations for the selected face — Balanced/Minimalist, Energetic/Athletic, Friendly/Casual, Poised/Professional, Striking/Editorial — each with front, side, and back view images (15 API calls total).
- User reviews all variations, selects one, saves to Characters library.

### Flow B — Upload Your Own Character
- Upload front (mandatory), back (mandatory), and side (optional) images.
- Real-time orientation validation per slot using MediaPipe (client-side).
- On save: background removed, auto-centered on white background, saved to Characters library.

### Characters Management Tab
- Grid view of all saved characters.
- Per-character actions: View (3-view sheet), Delete, Use as Base (pre-fills form for iteration), Download (in-app only).

---

## 16. Ad Launcher

Enables merchants to select creatives and launch ads directly to Meta from within Ads Studio.

### Creative Selection (4 Methods)
1. Pick from existing running/historical ads.
2. Duplicate existing ads.
3. Upload new creatives.
4. Pull from "My Collection Ads."

Selected ads go into a **persistent cart** (session-based staging area that doesn't auto-reset).

### Ad Configuration Fields
For each selected ad: Ad Name, Primary Text, Headline, Description, CTA, Pixel, UTM Parameters, Redirect Link, Facebook/Instagram Page, Ad Account, Campaign, Ad Set.

### Launch
- **Launch Active** or **Launch Paused** (default recommended: Paused for safety review in Meta).

### Naming Convention System
- Merchants define a naming structure template in Settings (e.g., `prs_product_pre_ifs_influencer...`).
- System auto-generates ad names from the template.

### Copy Templates
- Create, save, edit, and delete reusable copy templates covering Primary Text, Headline, Description, CTA, Pixel, UTM, etc.
- Bulk-apply templates across multiple selected ad rows.
- Selectively apply only specific fields (e.g., only UTMs).

---

## 17. Automated Campaign Optimizer

A rules-based automation engine that monitors campaign performance and recommends (or executes) actions to optimize budgets and scale winners.

### User-Configured Thresholds
- Expected ROAS, Minimum ROAS, acceptable CPM range, acceptable CPC range.
- Pre-filled with account-level benchmarks from last 30 days.

### Decision Hierarchy
Actions evaluated: Ad → Ad Set → Campaign (most granular first).

### Key Rules (14 total)
| Category | Rules | Trigger |
|----------|-------|---------|
| Turn Off | Rules 1–5 | 7-day ad ROAS 50–70% below account average; subject to min spend (3× CPR), min LPV, objective = sales, min spending days |
| Scale | Rules 6–8 | 7-day ad ROAS exceeds 130–150% of account average |
| Budget Reduction | Rule 9 | After ads turned off → reduce campaign budget to 1.3× yesterday's active ad spend |
| Budget Increase | Rules 10–13 | CBO/ABO-aware; increase by 10–20% based on ROAS trend (last 3 days); 48-hour cooldown on budget changes |
| Budget Decrease | Rule 14 | Decrease 20% if ROAS between expected and minimum for 3+ days and CPM/CPC out of range; turn off if budget < ₹500 |

### Current State (V0)
Recommendations are surfaced to an internal review team (not auto-applied to merchant campaigns). Team can approve, deny with reason, or override with a target ROAS/CPR.

---

## 18. Bookmarking & Collections

### Bookmarking
- Click bookmark icon on any ad → modal appears → select existing collection or create new → save.
- Works from both competitor feeds and the regular ad library.

### Collections
- Unlimited collections; users can rename or delete.
- Deleting a collection removes the association only — does not delete the underlying ad globally.

### Collection Page Features
- Grid layout with image/video filter.
- Per-ad actions: Download, Clone (triggers existing cloning workflow), Remove from Collection.
- Add more ads: redirect to broader library + return flow, or upload files directly.

### File Upload Support
- Drag-and-drop or file browser; supports multiple files simultaneously.
- **Images:** JPG, PNG, GIF, WEBP, SVG, TIFF.
- **Videos:** MP4, MOV, WEBM, AVI, MKV (AVI/MKV auto-transcoded to MP4).
- Files stored in secured cloud storage with virus scanning.
- Collection page targets <2s load for up to 500 items.

---

## 19. Audience Pro

A paid, self-serve feature to discover, purchase, and upload pre-generated high-intent audience segments to Meta ad accounts.

### How It Works
- **Default Audiences (4 types):** High AOV Buyers, Low RTO Buyers, Frequent Buyers, Prepaid Buyers — available to all users.
- **Personalized Audiences:** Submit brand URL → system analyzes brand website (category, pricing tier, demographics, discounting behavior) → recommends 4 audience types per category (up to 5 categories).

### Audience Sizes
- Default audiences: 1.5M users.
- Personalized audiences: 1M users, distributed across recency windows (30% M-1, 20% M-2, 50% M-3 to M-8).

### Purchase & Upload Flow
1. Add audiences to cart → single combined checkout.
2. On success → audience immediately "Ready to Upload" (from pre-computed Meta custom audiences).
3. User authenticates with Facebook → selects ad account → uploads audience to Meta.
4. Upload failures (expired token, API failure): retry options provided.

### Audience Refresh
- Monthly on the 4th of each month.
- Immediately for any audience purchased more than 5 times.

### Email Notifications
- Audience ready to upload (if not uploaded within 15 minutes of purchase).
- Successful upload.
- Upload failure.

### Scale
412 pre-computed audiences total (4 per L2 product category × 103 categories) + 4 default audiences.

---

## 20. Ad Analyzer (Public Tool)

A public-facing tool (also embeddable in the Checkout Dashboard) that lets any user paste a Meta ad link and receive an AI-generated performance analysis report.

### Input
- Meta ad library link, industry, target audience, price point.

### Report Output
- **Overall ad score out of 100.**
- Four scored sections:

| Section | Points |
|---------|--------|
| Visual & Creative Impact | 30 |
| Messaging & Value Proposition | 30 |
| Call to Action & Engagement Hooks | 20 |
| Caption Strategy & Copy Structure | 20 |

- Per section: "What works well" + "What can be improved" feedback.
- Sections scoring below 70% highlighted in red with a **"Fix Now"** CTA → Book a Demo form.

### Access & Sharing
- OTP phone verification required before viewing a report.
- Rate-limited per phone number.
- Reports shareable via WhatsApp or downloadable.
- GIF coachmarks guide users unfamiliar with the Meta Ad Library link format.
- Embeddable as a widget in the Checkout Dashboard (logged-in users) or as a standalone public web page.

---

## 21. Reports & Notifications

### Audit Report Email Notification
- When an audit report reaches COMPLETED status → automatic email to user.
- Email includes: platform (Google/Meta), report type, account name, account ID, and a deep-link CTA button to the report.
- If user is not logged in when they click → prompted to authenticate → lands on the report.

### Report Sharing
- Share icon on: Creative Report, Audit Report, Competition Report, Ads Analyzer.
- Logged-in recipients: see report immediately.
- Logged-out recipients: must sign in first.
- Viewing a shared report does NOT save it to the viewer's account.
- Shareable via page header URL.

---

## 22. FAQs Summary

| Topic | Key Answer |
|-------|-----------|
| What is Studio? | DIY marketing intelligence + creative tool. Analyze ads, discover competitors, generate creatives with AI. |
| Does Studio run ads? | No — read-only analytics only. Merchants remain fully in control. |
| Who is it for? | D2C brands, Shopify merchants, agencies, performance marketers. |
| Can beginners use it? | Yes — plain language explanations like "this ad should be paused." |
| What platforms? | Meta Ads (Facebook + Instagram) and Google Ads. |
| What is scaling? | Ads with ROAS improving week-on-week. |
| What is descaling? | Ads with ROAS declining week-on-week. |
| What is a creative audit? | Analysis of all ads in the account ranked by performance — identifies best/worst performers, scaling/descaling creatives. |
| What is hook analysis? | Identifies which first-few-seconds attention-grabbers drive performance. |
| What is storytelling analysis? | Identifies which formats (Problem→Solution, Before→After, Testimonial, etc.) perform best for a brand. |
| What is the ad score? | Out-of-100 score based on creative structure, hook strength, messaging clarity, visual quality. |
| Ad library size? | 100,000+ ads across industries. |
| AI ad creation? | Upload reference image + product image → AI generates a ready-to-use creative. |
| Future: Bulk launcher? | Launch up to 50 ads at once (upcoming). |
| Future: Audience purchase? | Buy high-performing audience segments with proven conversion history (upcoming). |

---

## Quick Reference: Feature → Module Mapping

| Feature | Module/Section |
|---------|---------------|
| Ad account connection | Analyze → Connect Account |
| Brand onboarding | Onboarding / Brand Setup |
| Workspace management | Spaces |
| Creative Audit (Meta) | Audit → Meta |
| Google Audit | Audit → Google |
| Audit Actionables | Audit → Actionables |
| Competitor tracking | Research → Track Competitors |
| Competitor Report | Research → Competitor Report |
| Instagram competitor tracking | Research → Instagram |
| Instagram User Insights | Research → User Insights |
| Ad Library browsing | Inspire → Ad Library |
| AI ad creation (from library) | Create → AI Generation |
| AI ad creation (your inspiration) | Create → Your Inspiration |
| In-platform creative editor | Create → Editor |
| Motion Catalog (video) | Create → Motion Catalog |
| Manual video generation | Create → Video Generation |
| AI Characters / Models | Create → Characters |
| Ad Launcher | Launch → Ad Launcher |
| Bookmarks & Collections | Collections |
| Audience Pro | Audiences |
| Ad Analyzer (public) | Analyze (standalone / widget) |
| Subscription & billing | Settings → Billing |
| 2-Tier Managed Campaigns | Campaigns (managed service) |
