# Protected Administrator Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately authorized administrator application to the staff Apps Script project with complete event configuration, privacy-safe record operations, Sheet switching, and safe setup bundles.

**Architecture:** `Code.gs` owns view routing, `AdminService.gs` owns the nine explicit administrator RPCs and underscore-only validation/business helpers, and `Repository.gs` owns underscore-only Sheet/property primitives. `Admin.html` provides the protected responsive shell and `AdminScript.html` binds it to the RPCs without rendering server data as HTML.

**Tech Stack:** Google Apps Script V8 (`.gs` and HTML Service), browser JavaScript, Node.js built-in test runner, `node:vm`, and filesystem contract tests.

## Global Constraints

- Administrator code exists only under `staff-apps-script/`.
- The administrator allowlist is `ADMIN_EMAIL_ALLOWLIST` and is independent of `ATTENDANCE_STAFF_ALLOWLIST`.
- Every administrator RPC authorizes before lock, Sheet, or current-settings access.
- Every non-RPC server helper ends in `_`.
- No remote operation hard-deletes event, participant, registration, seat, question, or attendance history.
- Denials and service failures are fixed messages that do not enumerate allowlists or expose private runtime data.
- Source bundles contain no credentials, live properties, Sheet IDs, participant rows, or private answers.

---

### Task 1: Administrator route and callable boundary

**Files:**
- Modify: `staff-apps-script/Code.gs`
- Create: `staff-apps-script/AdminService.gs`
- Modify: `tests/apps-script-staff-route-vm.test.js`

**Interfaces:**
- Consumes: `requireAuthorizedStaffSession_(): string`
- Produces: `requireAuthorizedAdminSession_(): string`, the nine RPC names from the design, and `doGet(event)`

- [ ] **Step 1: Write failing route and authorization tests**

```js
test("staff membership does not grant the admin view", async () => {
  const result = (await createHarness({
    sessionEmail: "staff@example.com",
    staffAllowlist: ["staff@example.com"],
    adminAllowlist: []
  })).context.doGet({ parameter: { view: "admin" } });
  assert.equal(result.kind, "text");
});

test("every admin RPC denies before Sheet and lock access", async () => {
  for (const name of ADMIN_RPC_NAMES) {
    const result = context[name]({});
    assert.equal(result.code, "ADMIN_ACTION_DENIED");
  }
  assert.equal(sheetAccesses + lockAccesses, 0);
});
```

- [ ] **Step 2: Run the route test and verify the expected missing-function/surface failures**

Run: `node --test tests/apps-script-staff-route-vm.test.js`

Expected: FAIL because the administrator route, allowlist, and RPC declarations do not exist.

- [ ] **Step 3: Implement the minimal protected route and wrappers**

```js
function getAdminDashboard(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    return getAdminDashboard_(payload, actor);
  });
}

function requireAuthorizedAdminSession_() {
  var identity = normalizedActiveIdentity_();
  if (!identity || !isAllowlistedAdminIdentity_(identity)) adminError_("ADMIN_ACTION_DENIED");
  return identity;
}
```

Route `view=admin` through the administrator guard and `Admin` template.
Preserve the existing default staff route and use one generic administrator
denial page.

- [ ] **Step 4: Run the route test and verify it passes**

Run: `node --test tests/apps-script-staff-route-vm.test.js`

Expected: PASS, including the exact callable-surface assertion.

### Task 2: Repository, core CRUD, lifecycle preservation, and record actions

**Files:**
- Modify: `staff-apps-script/Repository.gs`
- Modify: `staff-apps-script/AdminService.gs`
- Create: `tests/apps-script-admin-vm.test.js`

**Interfaces:**
- Consumes: `getConfiguredSpreadsheet_()`, `readRows_(sheetName)`, and `normalizeRow_(sheetName,row)`
- Produces: locked implementations for dashboard, events, sessions, seats, questions, and record actions

- [ ] **Step 1: Write failing behavior tests**

```js
test("archive and close update only the event row and preserve related rows", async () => {
  const before = snapshot(harness.sheets);
  assert.equal(context.saveAdminEvent({ eventId: "event-1", action: "archive" }).data.status, "archived");
  assert.equal(context.saveAdminEvent({ eventId: "event-1", action: "close" }).data.status, "ended");
  assert.equal(rowCount(harness.sheets["报名项目"]), before.registrations);
  assert.equal(rowCount(harness.sheets["签到记录"]), before.attendance);
});

test("reopen requires confirmation and reports existing registrations", async () => {
  assert.equal(context.saveAdminEvent({ eventId: "event-1", action: "reopen" }).code, "CONFIRMATION_REQUIRED");
  const result = context.saveAdminEvent({ eventId: "event-1", action: "reopen", confirm: true });
  assert.equal(result.data.registrationCount, 1);
});
```

Add independent cases for event field validation, session CRUD, four seat
modes and reserve/close/reopen, question types/options/order/visibility,
masked dashboard search, cancellation, seat adjustment, and attendance.
Each test asserts observable row values and proves no delete method runs.

- [ ] **Step 2: Run the administrator VM test and verify the expected failures**

Run: `node --test tests/apps-script-admin-vm.test.js`

Expected: FAIL because the RPC business helpers and expanded schemas are absent.

- [ ] **Step 3: Implement the minimal locked CRUD and transitions**

```js
function saveAdminEvent_(payload, actor) {
  return withScriptLock_(function() {
    var spreadsheet = getConfiguredSpreadsheet_();
    var existing = findAdminRow_("活动", "eventId", payload.eventId);
    var row = normalizeAdminEvent_(payload, existing);
    writeAdminRow_(spreadsheet, "活动", existing && existing.rowNumber, row);
    appendAdminAudit_(spreadsheet, payload.action || "SAVE_EVENT", "event", row.eventId, actor);
    return adminEventProjection_(row);
  });
}
```

Use literal allowlists for lifecycle states, selection modes, seat modes,
field types, question visibility, and seat actions. Preserve `createdAt`,
write `updatedAt`, append audit rows, and never call a delete API.

- [ ] **Step 4: Run the administrator VM test and verify it passes**

Run: `node --test tests/apps-script-admin-vm.test.js`

Expected: PASS with real in-memory row mutations and preserved history.

### Task 3: Sheet connection and non-destructive switch

**Files:**
- Modify: `staff-apps-script/Repository.gs`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `tests/apps-script-admin-vm.test.js`

**Interfaces:**
- Produces: `{connected:boolean,sheetName:string}` test result without an ID and a fixed switch warning

- [ ] **Step 1: Write failing target-validation and switch tests**

```js
test("switch tests the target then changes only the active property", async () => {
  const result = context.switchAdminSheet({ spreadsheetId: "target-id", confirm: true });
  assert.equal(result.ok, true);
  assert.equal(properties.ACTIVE_SPREADSHEET_ID, "target-id");
  assert.match(result.data.warning, /old data remains/i);
  assert.equal(sourceSheet.rows.length, sourceRows);
  assert.equal(targetSheet.rows.length, targetRows);
  assert.equal(JSON.stringify(result).includes("target-id"), false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/apps-script-admin-vm.test.js --test-name-pattern="connection|switch"`

Expected: FAIL because connection and property-update helpers are absent.

- [ ] **Step 3: Implement connection checking and confirmed switching**

Open the submitted ID only for target testing, verify every required Sheet and
header, then set `ACTIVE_SPREADSHEET_ID`. Do not initialize, insert, copy,
migrate, or delete anything. Return only connection state, spreadsheet name,
and the fixed warning.

- [ ] **Step 4: Run the focused and full administrator tests**

Run: `node --test tests/apps-script-admin-vm.test.js`

Expected: PASS.

### Task 4: Protected UI and source bundles

**Files:**
- Create: `staff-apps-script/Admin.html`
- Create: `staff-apps-script/AdminScript.html`
- Create: `staff-apps-script/SourceBundles.gs`
- Create: `scripts/build-admin-source-bundles.mjs`
- Create: `source-bundles/public-backend.txt`
- Create: `source-bundles/staff-admin.txt`
- Create: `tests/admin-ui-contract.test.js`
- Create: `tests/admin-source-bundles.test.js`

**Interfaces:**
- Consumes: the nine explicit administrator RPCs
- Produces: accessible administrator controls and two redacted copyable source bundles

- [ ] **Step 1: Write failing UI and bundle tests**

```js
test("admin UI has labelled controls, confirmations, warnings, and copy buttons", async () => {
  assert.match(admin, /<label\b/);
  assert.match(admin, /data-action="reopen"/);
  assert.match(admin, /old data remains|旧数据.*保留/i);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
});

test("generated bundle snapshots match tracked source and contain no runtime private data", async () => {
  assert.equal(extractBundle(sourceBundles, "PUBLIC"), expectedPublic);
  assert.equal(extractBundle(sourceBundles, "STAFF"), expectedStaff);
  assert.doesNotMatch(publicBundle + staffBundle, PRIVATE_VALUE_PATTERNS);
});
```

- [ ] **Step 2: Run both tests and verify missing-artifact failures**

Run: `node --test tests/admin-ui-contract.test.js tests/admin-source-bundles.test.js`

Expected: FAIL because the templates, generator, snapshots, and bundle constants do not exist.

- [ ] **Step 3: Implement the UI and deterministic bundle generator**

The UI renders dashboard arrays with `createElement` and `textContent`, sends
explicit confirmation booleans for reopen/switch, displays the migration
warning, and copies only the server-returned bundle selected by its button.
The generator concatenates deterministic labelled sections from fixed source
lists, rejects files containing private-value patterns, and emits the
runtime constants and tracked snapshots.

- [ ] **Step 4: Run focused UI and bundle tests**

Run: `node --test tests/admin-ui-contract.test.js tests/admin-source-bundles.test.js`

Expected: PASS.

### Task 5: Deployment guide, report, and full verification

**Files:**
- Modify: `apps-script/DEPLOYMENT.md`
- Create: `.superpowers/sdd/2026-07-25-event-registration-ticket-system/task-7-report.md`

**Interfaces:**
- Produces: complete administrator deployment/setup instructions and verification evidence

- [ ] **Step 1: Update deployment instructions and report**

Document `ADMIN_EMAIL_ALLOWLIST`, `?view=admin`, separate staff/admin
permissions, Sheet switching behavior, and bundle-copy workflow. Record
authorization, privacy, preservation, source-bundle, UI, and test evidence in
the report.

- [ ] **Step 2: Run focused security verification**

Run: `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-admin-vm.test.js tests/admin-source-bundles.test.js tests/admin-ui-contract.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run full verification**

Run: `npm.cmd test`

Expected: all repository tests pass with zero failures.

- [ ] **Step 4: Review the patch**

Run: `git diff --check`

Then inspect `git diff --stat`, the exact callable surface, all occurrences of
`ADMIN_EMAIL_ALLOWLIST`, public-project changes, delete APIs, and likely
credential/Sheet-ID patterns. Correct any finding and rerun verification.

- [ ] **Step 5: Commit the completed Task 7 implementation**

```text
git add <Task 7 files>
git commit -m "feat: add protected administrator application"
```
