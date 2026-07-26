# Modern Future Public Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the public participant website as “现代X好未来” using the approved A palette and simplify the landing page heading to “请选择你参加的活动”.

**Architecture:** Keep all registration behavior unchanged and limit the work to public HTML copy plus shared public CSS. Add a static contract test for the exact brand text, removed legacy copy, and approved palette; then mirror the verified public files into the GitHub Pages package and publish them.

**Tech Stack:** Static HTML, CSS, JavaScript modules, Node.js built-in test runner, GitHub Pages.

## Global Constraints

- Public brand text must be exactly `现代X好未来`.
- The header must not include a tagline beside the brand.
- The landing hero must show only `请选择你参加的活动`.
- Remove `SUMMER PROGRAMME / 2026`, `为好奇心，预留一个座位。`, and its supporting sentence.
- Palette must use `#9D202B`, `#65040B`, `#FFF1C8`, and `#FFD58B`.
- Do not change registration, seat selection, ticket, Google Sheets, Apps Script, admin, or staff behavior.

---

### Task 1: Lock the new public brand contract

**Files:**
- Create: `tests/public-brand.test.js`

**Interfaces:**
- Consumes: public HTML files under `public/` and `public/css/app.css`.
- Produces: a regression test that protects the approved copy and palette.

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public pages use the 现代X好未来 brand and approved palette", async () => {
  const pages = await Promise.all(
    ["public/index.html", "public/register.html", "public/ticket.html", "public/verify.html", "public/404.html"].map(read),
  );
  const css = await read("public/css/app.css");

  pages.forEach((page) => {
    assert.match(page, /现代X好未来/);
    assert.doesNotMatch(page, /微光现场/);
  });
  assert.match(pages[0], />请选择你参加的活动</);
  assert.doesNotMatch(pages[0], /SUMMER PROGRAMME|为好奇心|把想见的人/);
  ["#9d202b", "#65040b", "#fff1c8", "#ffd58b"].forEach((color) => {
    assert.match(css.toLowerCase(), new RegExp(color));
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/public-brand.test.js`

Expected: FAIL because the current pages still contain `微光现场`.

- [ ] **Step 3: Commit the failing contract**

```bash
git add tests/public-brand.test.js
git commit -m "test: define modern future public brand"
```

### Task 2: Apply the approved copy and visual system

**Files:**
- Modify: `public/index.html`
- Modify: `public/register.html`
- Modify: `public/ticket.html`
- Modify: `public/verify.html`
- Modify: `public/404.html`
- Modify: `public/css/app.css`
- Test: `tests/public-brand.test.js`

**Interfaces:**
- Consumes: the existing HTML class names and behavior hooks.
- Produces: updated public presentation without changing JavaScript selectors or form behavior.

- [ ] **Step 1: Replace the public copy**

Use `现代X好未来` in page titles, brand links, accessible labels, and footers. In `public/index.html`, remove the header paragraph and old hero eyebrow/paragraph, and keep:

```html
<section class="hero" aria-labelledby="page-title">
  <h1 id="page-title">请选择你参加的活动</h1>
</section>
```

- [ ] **Step 2: Replace the shared theme variables and presentation**

Define the exact palette in `:root`:

```css
--wine: #9d202b;
--wine-deep: #65040b;
--cream: #fff1c8;
--apricot: #ffd58b;
```

Use deep wine for the header and strong accents, cream for the page background, apricot for cards, and dark wine text/borders. Preserve responsive layout and print rules.

- [ ] **Step 3: Run the focused test**

Run: `node --test tests/public-brand.test.js`

Expected: PASS.

- [ ] **Step 4: Run the full verification**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit the source changes**

```bash
git add public tests/public-brand.test.js
git commit -m "feat: rebrand public registration site"
```

### Task 3: Mirror, publish, and verify GitHub Pages

**Files:**
- Modify: `../event-registration-public/index.html`
- Modify: `../event-registration-public/register.html`
- Modify: `../event-registration-public/ticket.html`
- Modify: `../event-registration-public/verify.html`
- Modify: `../event-registration-public/404.html`
- Modify: `../event-registration-public/css/app.css`

**Interfaces:**
- Consumes: verified source public files.
- Produces: the live GitHub Pages participant experience.

- [ ] **Step 1: Copy only the verified presentation files**

Copy the five HTML files and `css/app.css` from `public/` to `../event-registration-public/`. Keep the production `js/config.js` and backend URLs unchanged.

- [ ] **Step 2: Check the public package**

Run:

```powershell
$env:PUBLIC_APPS_SCRIPT_URL='the existing public deployment URL'
$env:STAFF_APPS_SCRIPT_URL='the existing private deployment URL'
node scripts/check-public-package.mjs ..\event-registration-public
```

Expected: PASS with no private Apps Script files or secrets.

- [ ] **Step 3: Upload the changed public files**

Replace the matching files in `austinmaterial2017-gif/event-registration` and commit them with:

```text
Rebrand public registration site
```

- [ ] **Step 4: Verify the live site**

Open `https://austinmaterial2017-gif.github.io/event-registration/`, refresh after deployment, and confirm:

- Header shows only `现代X好未来`.
- Main heading shows `请选择你参加的活动`.
- The page uses the approved wine, cream, and apricot palette.
- The activity list loads from the existing Google Sheets backend.

