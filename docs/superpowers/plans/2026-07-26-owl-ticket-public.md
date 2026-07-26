# Owl Ticket Public Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat public participant theme with the approved cartoon-owl ticket design while preserving all registration and Google Sheets behavior.

**Architecture:** Add one local SVG mascot asset, reshape only public participant markup and rendering hooks, and implement the visual system in the existing shared stylesheet. Keep the API client and business logic unchanged; the controller will continue consuming the same event projection while rendering ticket-shaped activity cards and a directed empty state.

**Tech Stack:** Static HTML, CSS, SVG, browser JavaScript modules, Node.js built-in test runner, GitHub Pages.

## Global Constraints

- Brand text remains exactly `现代X好未来`.
- The decorative oversized `X` is forbidden; `X` appears only inside the brand name.
- Mascot is a local cartoon owl SVG with no external image URL.
- Exact palette: `#9D202B`, `#65040B`, `#FFF1C8`, `#FFD58B`.
- Do not modify Apps Script, Google Sheet structure, deployment URLs, registration rules, seats, tickets, QR codes, or attendance logic.
- Administrator and staff pages are outside scope.
- The layout must work at 320px without horizontal clipping.
- Motion must stop under `prefers-reduced-motion`.

---

### Task 1: Lock the owl-ticket visual contract

**Files:**
- Create: `tests/activity-ticket-view.test.js`
- Modify: `public/index.html`
- Create: `public/assets/owl-mascot.svg`
- Create: `public/js/activity-ticket-view.js`

**Interfaces:**
- Consumes: existing `#activity-list`, `#activity-status`, and `js/index-page.js` hooks.
- Produces: `.hero-copy`, `.owl-mascot`, the local `assets/owl-mascot.svg` asset, and pure ticket view-model helpers.

- [ ] **Step 1: Write the failing contract test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityTicketView, buildEmptyActivityView } from "../public/js/activity-ticket-view.js";

test("ticket view preserves the event facts and produces the same safe registration destination", () => {
  const view = buildActivityTicketView({
    id: "talk / 01",
    date: "2026-07-28 10:00",
    title: "未来教育对谈",
    description: "主讲：林老师",
    place: "A礼堂",
    status: "open",
  }, true, "报名开放");

  assert.deepEqual(view, {
    dateLabel: "2026-07-28 10:00",
    title: "未来教育对谈",
    description: "主讲：林老师",
    placeLabel: "⌖ A礼堂",
    statusLabel: "报名开放",
    actionLabel: "立即报名",
    actionHref: "register.html?event=talk%20%2F%2001",
    actionEnabled: true,
  });
});

test("empty activity view directs participants without inventing events", () => {
  assert.deepEqual(buildEmptyActivityView(), {
    kicker: "稍后再来看看",
    title: "目前没有开放报名的活动",
    description: "新的讲座、课堂或工作坊开放后，会显示在这里。",
    mascotPath: "assets/owl-mascot.svg",
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/public-owl-ticket-design.test.js`

Expected: FAIL because `public/js/activity-ticket-view.js` does not exist.

- [ ] **Step 3: Add the approved hero markup**

Use this structure while preserving the existing heading and list hooks:

```html
<section class="hero" aria-labelledby="page-title">
  <div class="hero-copy">
    <p class="hero-kicker">欢迎来到活动报名站</p>
    <h1 id="page-title">请选择你参加的活动</h1>
    <p class="hero-description">讲座、课堂和工作坊，都从一张属于你的入场券开始。</p>
  </div>
  <img class="owl-mascot" src="assets/owl-mascot.svg" alt="现代X好未来猫头鹰吉祥物">
</section>
```

- [ ] **Step 4: Add the local owl SVG**

Create an original self-contained SVG using only the four approved colors plus `#2E1718` for pupils and outlines. Include `role="img"`, a Chinese `<title>`, and no script, external font, link, or remote image.

- [ ] **Step 5: Add the pure ticket view-model module**

Implement `buildActivityTicketView(activity, canRegister, statusLabel)` and `buildEmptyActivityView()` with the literal outputs defined by the test.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `node --test tests/activity-ticket-view.test.js`

Expected: PASS.

### Task 2: Render tickets, empty state, and responsive visual system

**Files:**
- Modify: `public/js/index-page.js`
- Modify: `public/js/activity-ticket-view.js`
- Modify: `public/css/app.css`
- Modify: `scripts/check-public-package.mjs`
- Test: `tests/activity-ticket-view.test.js`
- Test: `tests/public-brand.test.js`
- Test: `tests/public-package-check.test.js`

**Interfaces:**
- Consumes: the unchanged event fields `id`, `title`, `description`, `date`, `place`, `status`, and `canRegister`.
- Produces: `.activity-ticket`, `.ticket-date`, `.ticket-copy`, `.ticket-action`, and `.empty-ticket` DOM structures.

- [ ] **Step 1: Add an explicit empty-state renderer**

When `visibleActivities.length === 0`, replace the list with:

```html
<article class="empty-ticket">
  <img src="assets/owl-mascot.svg" alt="">
  <div>
    <p class="hero-kicker">稍后再来看看</p>
    <h3>目前没有开放报名的活动</h3>
    <p>新的讲座、课堂或工作坊开放后，会显示在这里。</p>
  </div>
</article>
```

The accessible status remains `已显示 0 个活动。`.

- [ ] **Step 2: Replace generic activity cards with ticket structure**

Each visible activity must use `article.activity-ticket`. Split the existing date string into a strong display block without changing the source data. Keep the existing status, countdown, place, registration link, and disabled-state logic intact.

```js
const article = node("article", "activity-ticket");
const dateBlock = node("div", "ticket-date");
const copy = node("div", "ticket-copy");
const actions = node("div", "ticket-action");
```

The registration URL remains:

```js
action.href = `register.html?event=${encodeURIComponent(activity.id)}`;
```

- [ ] **Step 3: Implement the approved shared CSS**

Apply these visual decisions:

- cream page and thin deep-wine header rule;
- two-column hero with one cartoon owl;
- ticket cards with square corners, perforation dots, dashed stub divider, deep-wine/red alternating backgrounds;
- no generic large rounded activity cards;
- one-column ticket layout below 760px;
- no heading clipping at 320px;
- subtle one-time owl rise and ticket reveal;
- `@media (prefers-reduced-motion: reduce)` disables transitions and animations.

Preserve readable form controls, ticket printing, focus styles, and all existing structural selectors used by registration and verification pages.

- [ ] **Step 4: Update the stylesheet cache version**

Change public stylesheet references in `index.html`, `register.html`, `ticket.html`, and `verify.html` from `v=20260726-1` to `v=20260726-2`. Update `tests/public-brand.test.js` to expect the new exact version.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/public-owl-ticket-design.test.js
node --test tests/public-brand.test.js
```

Expected: both tests PASS.

- [ ] **Step 6: Allow exactly the new public mascot asset**

Add `"assets/owl-mascot.svg"` and `"js/activity-ticket-view.js"` to the exact `allowedFiles` set in `scripts/check-public-package.mjs`. Update the valid-package fixture in `tests/public-package-check.test.js` to include both files and add a test proving another unapproved asset still fails with `unexpected file`.

- [ ] **Step 7: Run the complete test suite**

Run: `npm.cmd test`

Expected: 0 failures.

- [ ] **Step 8: Commit the verified source**

```powershell
git add public scripts/check-public-package.mjs tests/activity-ticket-view.test.js tests/public-brand.test.js tests/public-package-check.test.js
git commit -m "feat: add owl ticket participant experience"
```

### Task 3: Publish and visually verify

**Files:**
- Create: `../event-registration-public/assets/owl-mascot.svg`
- Modify: `../event-registration-public/index.html`
- Modify: `../event-registration-public/register.html`
- Modify: `../event-registration-public/ticket.html`
- Modify: `../event-registration-public/verify.html`
- Modify: `../event-registration-public/css/app.css`
- Modify: `../event-registration-public/js/index-page.js`
- Create: `../event-registration-public/js/activity-ticket-view.js`

**Interfaces:**
- Consumes: the verified source participant files.
- Produces: the live public GitHub Pages owl-ticket experience.

- [ ] **Step 1: Mirror only approved public files**

Copy the changed HTML, CSS, index controller, and owl SVG into `../event-registration-public/`. Do not replace its production `js/config.js`.

- [ ] **Step 2: Run the public package security check**

Run:

```powershell
$env:PUBLIC_APPS_SCRIPT_WEB_APP_URL='https://script.google.com/macros/s/AKfycbwn7Y8B791vLgvkKOJ4sjtODBj8HlH-UgSTNg1GkyH4VM1Pcb0JMQlXWX_fGqs6FeWW/exec'
$env:STAFF_APPS_SCRIPT_WEB_APP_URL='https://script.google.com/macros/s/AKfycbw6zkdb6W7VNq41WhvyTLTZBZQdqZfkHrSy8XbcfNQRm0E4qLhkHKMltYO60MzLWldP/exec'
node scripts/check-public-package.mjs --public-dir ..\event-registration-public
```

Expected: PASS with 20 approved participant files and no private backend files or secrets.

- [ ] **Step 3: Upload the changed files to GitHub**

Replace the matching files in `austinmaterial2017-gif/event-registration` and commit with:

```text
Add owl ticket participant design
```

- [ ] **Step 4: Verify desktop and mobile behavior**

Open `https://austinmaterial2017-gif.github.io/event-registration/` after deployment and confirm:

- the owl SVG loads from the repository;
- no large decorative `X` is present;
- the heading is not clipped;
- the palette is correct;
- zero activities display the owl empty-state ticket;
- the accessible status says `已显示 0 个活动。`;
- an activity card, when data exists, retains the same registration link behavior.

- [ ] **Step 5: Keep the verified live page open**

Finalize browser tabs with only the GitHub Pages site kept as the deliverable.
