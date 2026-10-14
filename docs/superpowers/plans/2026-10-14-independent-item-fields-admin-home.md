# Independent Item Fields and Admin Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every combination-plan item own distinct registration fields while reorganizing the administrator interface into a clear, safe-to-navigate home and workspaces.

**Architecture:** Combination-question snapshots gain an optional `itemIds` array. The backend filters fields by the selected item IDs before validation and persistence; the public page renders shared fields and selected-item sections separately. The existing administrator page stays the source of all actions, but an admin-home router exposes one workspace at a time and preserves all existing form IDs and event bindings.

**Tech Stack:** Google Apps Script (V8), static ES modules, HTML/CSS, Node built-in test runner, VM contract tests.

**Spec:** `docs/superpowers/specs/2026-10-14-independent-item-fields-admin-home-design.md`

## Global Constraints

- Existing questions with no `itemIds` remain shared questions and must remain valid.
- Do not alter ticket, capacity, time-window, scanner, check-in, upload rollback, or Sheet ownership behavior.
- Item-only answers must only be accepted when the item is selected in the same request.
- Administrator visual changes use the participant site’s pale cream, deep red, and dark text palette; actions remain keyboard accessible.
- Do not delete existing event, combination, ticket, check-in, Sheet, or system controls; organize them behind workspace entry points.

## Review Focus

- A participant deselects an item after attaching a photo: the item’s required field and local upload must disappear before submission.
- A legacy shared field has no `itemIds`: it still appears and validates for every combination registration.
- A crafted API request includes an answer for an unselected item: the backend must reject it rather than store hidden data.
- Two items use the same visible question label: Sheet headers must remain distinguishable by item title.
- A previously functional administrator action is reached after using the new home/back navigation and still invokes its old handler.

---

### Task 1: Add item ownership to combination-question snapshots

**Files:**
- Modify: `apps-script/InternalMutationService.gs:426-454`
- Modify: `apps-script/Code.gs:61-214`
- Modify: `apps-script/BundlePlanOverview.gs:30-130`
- Test: `tests/apps-script-bundle-admin-vm.test.js`

**Interfaces:**
- Consumes: `saveBundleQuestion_(payload, actor)` and `bundleRegistrationFields_(registry, planId)`.
- Produces: question snapshots shaped as `{ questionId, label, type, required, options, status, sortOrder, itemIds }` and `applicableBundleRegistrationFields_(questions, selectedItemIds)`.

- [ ] **Step 1: Write failing backend contract tests**

```js
test("bundle question normalizes only item IDs in its own plan", async () => {
  const context = await loadBundleValidation();
  const normalized = context.normalizeBundleQuestionItemIds_(
    ["item-badminton", "item-badminton", "unknown"],
    { "item-badminton": true }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), ["item-badminton"]);
});

test("applicable bundle fields include shared fields and selected-item fields only", async () => {
  const context = await loadBundleValidation();
  const fields = context.applicableBundleRegistrationFields_([
    { questionId: "shared", itemIds: [] },
    { questionId: "partner", itemIds: ["badminton"] },
    { questionId: "eater", itemIds: ["eating"] }
  ], { badminton: true });
  assert.deepEqual(JSON.parse(JSON.stringify(fields.map((field) => field.questionId))), ["shared", "partner"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/apps-script-bundle-admin-vm.test.js`

Expected: FAIL because the two helper functions do not exist.

- [ ] **Step 3: Implement snapshot normalization and applicable-field filtering**

```js
function normalizeBundleQuestionItemIds_(value, allowed) {
  var seen = {};
  return (Array.isArray(value) ? value : []).map(bundleText_).filter(function(itemId) {
    if (!itemId || !allowed[itemId] || seen[itemId]) return false;
    seen[itemId] = true;
    return true;
  });
}

function applicableBundleRegistrationFields_(questions, selected) {
  return (questions || []).filter(function(question) {
    var itemIds = Array.isArray(question.itemIds) ? question.itemIds : [];
    return !itemIds.length || itemIds.some(function(itemId) { return selected[itemId] === true; });
  });
}
```

Update `saveBundleQuestion_` to load the plan’s native `组合项目` IDs, normalize `payload.itemIds`, and store them in `snapshot`. In `createBundleRegistration`, construct the selected item map before upload and answer validation, then call `validateRegistrationUploads_` and `validateDynamicAnswers_` only with `applicableBundleRegistrationFields_`. Reject payload answer or upload keys not belonging to those applicable fields.

- [ ] **Step 4: Make the public plan projection and Sheet labels explicit**

Return `itemIds` in `publicQuestionProjection_`. In `BundlePlanOverview.gs`, map each question header to `项目名称：题目` when `itemIds` is non-empty; preserve the existing title for shared fields. Use the same header function in both 报名总览 and 签到总览.

- [ ] **Step 5: Run backend tests and full suite**

Run: `node --test tests/apps-script-bundle-admin-vm.test.js && npm test`

Expected: PASS, including legacy plan, item capacity, and ticket-display tests.

- [ ] **Step 6: Commit the backend slice**

```bash
git add apps-script/InternalMutationService.gs apps-script/Code.gs apps-script/BundlePlanOverview.gs tests/apps-script-bundle-admin-vm.test.js
git commit -m "feat: scope bundle questions to selected items"
```

### Task 2: Render isolated field sections in the participant combination form

**Files:**
- Modify: `public/js/bundle-register-page.js:1-192`
- Modify: `public/bundle-register.html:1`
- Modify: `public/css/app.css`
- Test: `tests/api-contract.test.js`

**Interfaces:**
- Consumes: public fields with optional `itemIds`, `selection.selectedEventIds`, `createBundleRegistration({ planId, itemIds, answers, uploads })`.
- Produces: `visibleBundleFields_()` and field sections keyed by item ID; submission payloads with only visible question IDs.

- [ ] **Step 1: Write failing participant-page contract tests**

```js
test("combination registration separates shared and item-specific questions", async () => {
  const source = await readFile(new URL("../public/js/bundle-register-page.js", import.meta.url), "utf8");
  assert.match(source, /function visibleBundleFields_\(/);
  assert.match(source, /itemIds\.some/);
  assert.match(source, /bundle-field-section/);
});

test("combination form discards unselected item photo files", async () => {
  const source = await readFile(new URL("../public/js/bundle-register-page.js", import.meta.url), "utf8");
  assert.match(source, /pruneHiddenBundlePhotoFiles_\(/);
});
```

- [ ] **Step 2: Run the participant-page contract tests to verify they fail**

Run: `node --test tests/api-contract.test.js`

Expected: FAIL because the field-visibility helpers and section class do not exist.

- [ ] **Step 3: Implement visible field selection and isolated sections**

```js
function visibleBundleFields_(allFields, selectedIds) {
  const selectedIdsSet = new Set(selectedIds);
  return allFields.filter((field) => {
    const itemIds = Array.isArray(field.itemIds) ? field.itemIds : [];
    return !itemIds.length || itemIds.some((itemId) => selectedIdsSet.has(itemId));
  });
}
```

Change `renderFields()` to group returned fields into one shared section labelled `共用资料` and one section per selected item, using the item title from `rules`. Keep the current field control renderer, accessibility labels, photo validation, and delete-photo behavior unchanged.

- [ ] **Step 4: Keep state and submissions limited to visible fields**

Call the renderer after every selection change. Implement `pruneHiddenBundlePhotoFiles_` to delete `photoFiles` entries for invisible question IDs. Validate and build `answers`/`uploads` from `visibleBundleFields_` only, so cancelled projects never submit stale values.

- [ ] **Step 5: Add section styling without changing current form controls**

Add `.bundle-field-section` and `.bundle-field-section-title` rules using the existing public page’s cream surface, deep red divider, and responsive layout. Do not modify `.question`, `.primary-button`, or the ticket pages’ styles.

- [ ] **Step 6: Run public checks**

Run: `node --test tests/api-contract.test.js && npm run check:public`

Expected: PASS; the original return link, API imports, and existing ticket recovery contracts remain present.

- [ ] **Step 7: Commit the participant-form slice**

```bash
git add public/js/bundle-register-page.js public/bundle-register.html public/css/app.css tests/api-contract.test.js
git commit -m "feat: group combination fields by selected item"
```

### Task 3: Add project-scoped question controls in the administrator UI

**Files:**
- Modify: `staff-apps-script/Admin.html:294-329`
- Modify: `staff-apps-script/AdminScript.html:126-180, 519-695, 1817-1850`
- Test: `tests/apps-script-bundle-admin-vm.test.js`

**Interfaces:**
- Consumes: `state.bundlePlans`, plan `items`, question `itemIds`, `runner.saveBundleQuestion(payload)`.
- Produces: `renderBundleQuestionScope_`, `selectedBundleQuestionItemIds_`, and `saveBundleQuestion` payloads containing `itemIds`.

- [ ] **Step 1: Write failing administrator markup tests**

```js
test("administrator can scope a combination question to a specific project", async () => {
  const html = await readFile(new URL("../staff-apps-script/Admin.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(html, /id="bundle-question-scope"/);
  assert.match(html, /name="itemIds"/);
  assert.match(script, /renderBundleQuestionScope_/);
  assert.match(script, /itemIds: selectedBundleQuestionItemIds_/);
});
```

- [ ] **Step 2: Run the administrator test to verify it fails**

Run: `node --test tests/apps-script-bundle-admin-vm.test.js`

Expected: FAIL because the scope selector and payload mapping do not exist.

- [ ] **Step 3: Build a scoped question editor**

Add a `fieldset#bundle-question-scope` beneath the plan ID with radios for `所有项目共用` and `只在以下项目填写`, plus a checkbox list named `itemIds`. Populate only items of the selected plan. Disable the item checkboxes in shared mode. When editing a legacy question, select shared mode; when editing an item question, preselect its item IDs.

- [ ] **Step 4: Split question lists by project in the dashboard**

Render a `共用资料` list and one `项目资料：<项目名称>` list per item. Keep the existing edit/delete buttons inside each row and preserve their handlers. When a project has no questions, render `尚未新增资料问题` and retain the "新增问题" path.

- [ ] **Step 5: Update previews and ticket display choices**

`openBundlePreview_` must show shared fields and item field sections using the same labels as public registration. Ticket-display checkboxes retain their question ID selection and append the project name for item-scoped questions, preventing duplicate visible labels.

- [ ] **Step 6: Run administrator test coverage**

Run: `node --test tests/apps-script-bundle-admin-vm.test.js`

Expected: PASS, including current tests for editing plans, items, ticket display, Sheet link, and question deletion.

- [ ] **Step 7: Commit the administrator question slice**

```bash
git add staff-apps-script/Admin.html staff-apps-script/AdminScript.html tests/apps-script-bundle-admin-vm.test.js
git commit -m "feat: manage combination questions by project"
```

### Task 4: Create a safe administrator home and workspace router

**Files:**
- Modify: `staff-apps-script/Admin.html:1-230, 294-490`
- Modify: `staff-apps-script/AdminScript.html:1-125, 1850-1900`
- Test: `tests/apps-script-bundle-admin-vm.test.js`

**Interfaces:**
- Consumes: existing sections and their fixed IDs, existing `loadDashboard()` and `loadBundleDashboard_()` entry points.
- Produces: `showAdminWorkspace_(workspaceId)` and return-home buttons without replacing existing action listeners.

- [ ] **Step 1: Write failing home-router tests**

```js
test("administrator home keeps existing workspaces reachable", async () => {
  const html = await readFile(new URL("../staff-apps-script/Admin.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../staff-apps-script/AdminScript.html", import.meta.url), "utf8");
  assert.match(html, /id="admin-home"/);
  assert.match(html, /data-workspace="bundle"/);
  assert.match(html, /data-workspace="records"/);
  assert.match(script, /function showAdminWorkspace_\(/);
  assert.match(script, /loadDashboard\(\);/);
  assert.match(script, /loadBundleDashboard_\(\);/);
});
```

- [ ] **Step 2: Run the home-router test to verify it fails**

Run: `node --test tests/apps-script-bundle-admin-vm.test.js`

Expected: FAIL because the home and router do not exist.

- [ ] **Step 3: Add non-destructive workspace wrappers**

Wrap existing panels into `data-admin-workspace` containers rather than moving individual control IDs or rewriting forms. Add home cards for 活动管理, 组合报名, 项目资料, 签到管理, 报名与 Sheet, 系统设置. Each workspace gains a `返回管理员首页` button that calls `showAdminWorkspace_("home")`.

- [ ] **Step 4: Implement the router and deep-link behavior**

```js
function showAdminWorkspace_(workspaceId) {
  document.querySelectorAll("[data-admin-workspace]").forEach((section) => {
    section.hidden = section.dataset.adminWorkspace !== workspaceId;
  });
  document.querySelector("#admin-home").hidden = workspaceId !== "home";
  location.hash = workspaceId === "home" ? "" : `admin-${workspaceId}`;
}
```

Initialize from `location.hash`, fall back to home, and listen to `hashchange`. Existing navigation and forms keep their current IDs, so their event listeners need no replacement.

- [ ] **Step 5: Apply the light visual system**

Introduce CSS variables in `Admin.html`: `--paper: #fff3cf`, `--surface: #fffaf0`, `--ink: #34140f`, `--red: #8f0715`, `--line: #d77a61`. Use them on body, cards, inputs, buttons, status text, focus outlines, and the home cards. Preserve explicit success/error status semantics and contrast.

- [ ] **Step 6: Run all local checks**

Run: `npm run check`

Expected: PASS. If an existing unrelated test fails, record its exact name and leave it unchanged; do not claim full verification until it is resolved.

- [ ] **Step 7: Commit the home/workspace slice**

```bash
git add staff-apps-script/Admin.html staff-apps-script/AdminScript.html tests/apps-script-bundle-admin-vm.test.js
git commit -m "feat: organize administrator tools into workspaces"
```

### Task 5: Regenerate deployment bundles and perform regression verification

**Files:**
- Modify (generated): `staff-apps-script/SourceBundles.gs`
- Modify (generated): `source-bundles/public-backend.txt`
- Modify (generated): `source-bundles/staff-admin.txt`
- Test: `tests/api-contract.test.js`
- Test: `tests/apps-script-bundle-admin-vm.test.js`

**Interfaces:**
- Consumes: source files from Tasks 1-4.
- Produces: source bundles matching exactly the deployable backend and administrator source.

- [ ] **Step 1: Rebuild generated source bundles**

Run: `node scripts/build-admin-source-bundles.mjs`

Expected: source bundle files change only according to Tasks 1-4.

- [ ] **Step 2: Verify generated content is current**

Run: `npm run check:bundles && npm run check:public && npm test`

Expected: all commands pass and `git diff --check` emits no whitespace errors.

- [ ] **Step 3: Perform manual regression checklist in a local browser**

1. Open the administrator home and enter every card, then return home.
2. Save and delete a shared question, then save and delete a badminton-only question.
3. Open preview: select badminton and confirm team fields appear; select only a personal item and confirm they do not appear.
4. Submit a valid personal-item registration and a valid badminton registration; inspect the overview Sheet labels.
5. Verify the ticket, ticket recovery, ordinary activity registration, normal scan, and combination scan page load paths remain available.

- [ ] **Step 4: Commit generated deployment outputs**

```bash
git add staff-apps-script/SourceBundles.gs source-bundles/public-backend.txt source-bundles/staff-admin.txt
git commit -m "build: refresh deployment bundles for item fields"
```

- [ ] **Step 5: Prepare deploy instructions without overwriting existing Apps Script projects**

Provide the exact updated source files and require a new deployment version for both public backend and staff administrator projects. Do not change a production deployment or delete prior versions during local implementation.
