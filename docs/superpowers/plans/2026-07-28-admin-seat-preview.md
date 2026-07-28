# Admin Seat Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a participant-like live seat preview to the administrator page and make every administrator form reject invalid input with exact, non-stale feedback.

**Architecture:** Keep preview generation entirely in the protected administrator browser. A pure renderer reads the current activity and seat forms plus already-loaded seat projections, then builds safe DOM nodes without backend writes. Existing Apps Script RPCs remain the only mutation path.

**Tech Stack:** Google Apps Script HTML Service, vanilla JavaScript, CSS, Node.js `node:test`.

## Global Constraints

- Preview data never writes to Google Sheet, locks a seat, or occupies a seat.
- Desktop preview sits beside seat settings; mobile preview stacks below.
- Preview uses the participant meanings for available, selected, and unavailable seats.
- Existing participant and administrator security boundaries remain unchanged.

---

### Task 1: Complete administrator form validation

**Files:**
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `tests/admin-ui-behavior.test.js`

**Interfaces:**
- Consumes: existing `setStatus(message, kind)` and `formObject(form)`.
- Produces: `validateSessionValues_`, `validateSeatValues_`, `validateQuestionValues_`, and `bindEditedFeedback_`.

- [ ] **Step 1: Keep the failing cross-form validation test**

Assert that blank session titles, zero seat rows, optionless select questions, and blank registration IDs create no RPC mutation and show exact Chinese guidance.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/admin-ui-behavior.test.js`

Expected: the new cross-form validation test fails before implementation.

- [ ] **Step 3: Add minimal validators**

Implement exact checks:

```js
validateSessionValues_(values, form)
validateSeatValues_(values, form)
validateQuestionValues_(values, form, validation, options)
```

Reject missing titles, invalid date ranges, negative/non-integer capacities, invalid seat dimensions, missing zone names, missing question choices, invalid sort orders, and invalid record IDs before invoking an RPC.

- [ ] **Step 4: Bind stale-error clearing**

Bind `input` and `change` on event, session, seat, question, and record forms. When an error is visible, replace it with a neutral “内容已修改，请保存确认” message.

- [ ] **Step 5: Run the focused test**

Run: `node --test tests/admin-ui-behavior.test.js`

Expected: all administrator behavior tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- staff-apps-script/AdminScript.html tests/admin-ui-behavior.test.js
git commit -m "fix: validate every admin form"
```

### Task 2: Add the live seat preview markup and styles

**Files:**
- Modify: `staff-apps-script/Admin.html`
- Modify: `tests/admin-ui.test.js`

**Interfaces:**
- Consumes: existing `#seat-form` and selected activity panel.
- Produces: `#seat-preview`, `#seat-preview-stage`, `#seat-preview-floor`, `#seat-preview-message`, and `#expand-seat-preview`.

- [ ] **Step 1: Write markup assertions**

Assert that the administrator page contains one labelled preview region, a stage label, a floor container, a three-state legend, and a button whose accessible name is “放大预览”.

- [ ] **Step 2: Run the markup test**

Run: `node --test tests/admin-ui.test.js`

Expected: FAIL because preview markup is absent.

- [ ] **Step 3: Add responsive preview markup**

Place the preview next to `#seat-form`. Add scoped CSS for a participant-like dark floor, red/cream brand accents, compact seat buttons, clear legends, mobile stacking, focus rings, and a modal-size expanded state.

- [ ] **Step 4: Run the markup test**

Run: `node --test tests/admin-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- staff-apps-script/Admin.html tests/admin-ui.test.js
git commit -m "feat: add admin seat preview layout"
```

### Task 3: Render the participant-like seat preview

**Files:**
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `tests/admin-ui-behavior.test.js`

**Interfaces:**
- Consumes: `state.dashboard.seats`, current activity `seatMapLabel`, and seat-form `mode`, `zoneName`, `rows`, `seatsPerRow`, `sessionId`.
- Produces: `seatPreviewModel_()`, `renderSeatPreview_()`, and preview-only selected seat state.

- [ ] **Step 1: Write failing behavior tests**

Test these cases:

```js
mode: "none"     // renders 自由入座，无需选座
mode: "self"     // renders generated row/seat labels
mode: "zone"     // renders the entered zone name
existing seats   // unavailable seats are visibly unavailable
preview click    // toggles preview selection and emits no RPC
```

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/admin-ui-behavior.test.js`

Expected: FAIL because the renderer does not exist.

- [ ] **Step 3: Implement a pure preview model**

Create a model containing:

```js
{
  mode,
  stageLabel,
  message,
  zones: [{ name, seats: [{ id, label, state }] }]
}
```

Use currently saved seats when available; otherwise create preview-only labels from rows and seats-per-row. Never call `saveAdminSeatPlan`.

- [ ] **Step 4: Render with safe DOM APIs**

Build the preview only with `element`, `textContent`, and event listeners. A preview seat click may toggle `is-selected` locally but must not change `state.dashboard` or send an RPC.

- [ ] **Step 5: Bind live updates and expansion**

Update on seat-form input/change, activity selection, and dashboard refresh. Toggle the expanded preview with the button and Escape key while preserving keyboard focus.

- [ ] **Step 6: Run the focused tests**

Run: `node --test tests/admin-ui-behavior.test.js tests/admin-ui.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- staff-apps-script/AdminScript.html tests/admin-ui-behavior.test.js
git commit -m "feat: render live admin seat preview"
```

### Task 4: Build, regress, deploy, and verify

**Files:**
- Regenerate: `staff-apps-script/SourceBundles.gs`
- Regenerate: `source-bundles/staff-admin.txt`

**Interfaces:**
- Consumes: completed administrator HTML and script changes.
- Produces: a new immutable staff Apps Script deployment version at the existing administrator URL.

- [ ] **Step 1: Regenerate protected bundles**

Run: `node scripts/build-admin-source-bundles.mjs`

- [ ] **Step 2: Run the complete verification suite**

Run: `npm.cmd run check`

Expected: all tests, bundle checks, and public-package checks pass.

- [ ] **Step 3: Update the protected staff Apps Script project**

Paste the final `Admin.html` and `AdminScript.html`, save, and create a new deployment version. Do not change the deployment URL or Google permissions.

- [ ] **Step 4: Verify production**

Open the existing administrator URL with a cache-busting query. Confirm exact validation feedback, live preview updates, preview-only seat selection, mobile stacking, and no RPC from preview clicks.

- [ ] **Step 5: Commit generated bundles**

```powershell
git add -- staff-apps-script/SourceBundles.gs source-bundles/staff-admin.txt
git commit -m "build: refresh protected staff bundle"
```
