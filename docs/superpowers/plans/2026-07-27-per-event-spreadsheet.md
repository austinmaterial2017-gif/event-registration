# Per-Event Google Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly created activity automatically own a separate private Google Sheet while one public registration site safely serves all activities.

**Architecture:** The permanent registry Sheet gains an activity catalog and a ticket-routing index. Public and protected requests resolve the correct activity Sheet through the registry; new activity creation prepares a private Sheet before publishing its catalog entry. The administrator UI selects one activity at a time, removes manual IDs from ordinary work, and implements reliable in-page navigation.

**Tech Stack:** Google Apps Script V8, Google Sheets, signed public/staff internal gateway, vanilla HTML/CSS/JavaScript, Node.js built-in test runner.

## Global Constraints

- Each newly created activity automatically gets one private Google Sheet.
- Sessions, speakers, seats, questions, participants, registrations, attendance, and audits for one activity stay in that activity's Sheet.
- Existing Script Property names and the permanent registry Sheet remain stable.
- The participant site must never receive a Sheet ID, administrator URL, allowlist, shared secret, participant detail, or raw routing token.
- QR codes continue to contain only the public verification URL and an opaque ticket token.
- Existing activities and rows are never deleted automatically.
- No Apps Script change or redeployment is required after this one upgrade.
- All production behavior changes follow red-green-refactor.

---

### Task 1: Registry catalog and safe routing primitives

**Files:**
- Modify: `apps-script/Repository.gs`
- Modify: `staff-apps-script/Repository.gs`
- Test: `tests/apps-script-admin-vm.test.js`
- Test: `tests/apps-script-contract.test.js`

**Interfaces:**
- Produces: `initializeRegistrySpreadsheet_(registry)`
- Produces: `initializeEventSpreadsheet_(spreadsheet)`
- Produces: `getEventCatalogEntry_(registry, eventId)`
- Produces: `getEventSpreadsheet_(registry, eventId)`
- Produces: `getTicketRouteByNumber_(registry, ticketNumber)`
- Produces: `getTicketRouteByToken_(registry, token)`
- Produces: `upsertTicketRoute_(registry, route)`
- Produces: `digestTicketToken_(token)`

- [ ] **Step 1: Write failing registry-schema tests**

Add assertions proving that `setupSystem()` initializes exact `活动目录` and `票券索引` headers while `initializeEventSpreadsheet_()` initializes only activity-data sheets.

```js
assert.deepEqual(SHEET_DEFINITIONS["活动目录"], [
  "eventId", "spreadsheetId", "sheetName", "title", "description", "status",
  "opensAt", "closesAt", "location", "selectionMode", "minChoices",
  "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"
]);
assert.deepEqual(SHEET_DEFINITIONS["票券索引"], [
  "ticketNumber", "tokenDigest", "eventId", "registrationId",
  "status", "createdAt", "updatedAt"
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/apps-script-contract.test.js
```

Expected: failure because the two registry sheets and split initializers do not exist.

- [ ] **Step 3: Implement split registry/event initialization**

Keep `SHEET_DEFINITIONS` as the exact header authority and add explicit sheet-name arrays:

```js
var REGISTRY_SHEET_NAMES_ = ["系统设置", "活动目录", "票券索引", "操作记录"];
var EVENT_SHEET_NAMES_ = [
  "活动", "场次", "座位", "报名问题", "参加者",
  "报名项目", "签到记录", "操作记录"
];
```

`setupSystem()` must call `initializeRegistrySpreadsheet_()` and seed settings. New activity Sheets must call `initializeEventSpreadsheet_()` without a sample draft.

- [ ] **Step 4: Write failing routing tests**

Create two fake activity Sheets and registry rows. Assert that:

```js
assert.equal(context.getEventSpreadsheet_(registry, "event-a").getId(), "sheet-a");
assert.equal(context.getEventSpreadsheet_(registry, "event-b").getId(), "sheet-b");
assert.equal(context.getTicketRouteByNumber_(registry, "EVT-AAA").eventId, "event-a");
assert.equal(context.getTicketRouteByToken_(registry, "raw-secret-token").eventId, "event-b");
assert.notEqual(indexRow.tokenDigest, "raw-secret-token");
```

Also assert missing, duplicate, malformed, or mismatched mappings fail closed with `EVENT_NOT_FOUND`, `TICKET_NOT_FOUND`, or `INTEGRITY_ERROR`.

- [ ] **Step 5: Run routing tests and verify RED**

Run the same focused test command. Expected: failure because routing helpers do not exist.

- [ ] **Step 6: Implement minimal routing helpers**

Use normalized exact matches, `SpreadsheetApp.openById`, and SHA-256 token digests:

```js
function digestTicketToken_(token) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token || "").trim(),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) {
    var unsigned = value < 0 ? value + 256 : value;
    return ("0" + unsigned.toString(16)).slice(-2);
  }).join("");
}
```

Validate that the opened activity Sheet has exact headers and exactly one matching `活动` row before returning it.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/apps-script-contract.test.js
```

Expected: PASS.

Commit:

```powershell
git add apps-script/Repository.gs staff-apps-script/Repository.gs tests/apps-script-admin-vm.test.js tests/apps-script-contract.test.js
git commit -m "feat: add private activity sheet routing"
```

---

### Task 2: Public activity catalog and event-specific reads

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/RegistrationService.gs`
- Test: `tests/apps-script-admin-vm.test.js`
- Test: `tests/visibility-countdown.test.js`

**Interfaces:**
- Consumes: `getEventCatalogEntry_(registry, eventId)`
- Consumes: `getEventSpreadsheet_(registry, eventId)`
- Produces: `listEvents()` backed only by safe catalog rows
- Produces: `getEvent({ eventId })` backed by one event Sheet

- [ ] **Step 1: Write failing public routing tests**

Seed two catalog entries and two event Sheets. Assert:

```js
const listed = context.listEvents({});
assert.deepEqual(listed.data.events.map((event) => event.id), ["event-a", "event-b"]);
assert.equal(context.getEvent({ eventId: "event-b" }).data.event.title, "Activity B");
assert.equal(JSON.stringify(listed).includes("sheet-a"), false);
assert.equal(JSON.stringify(listed).includes("spreadsheetId"), false);
```

Add a test proving a private/draft catalog row is not listed.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/visibility-countdown.test.js
```

Expected: current code reads only the old active Sheet and cannot list both events.

- [ ] **Step 3: Implement catalog-backed `listEvents` and routed `getEvent`**

`listEvents` reads only `活动目录`, applies the current visible-status allowlist, and projects through `publicEventSummary_`. `getEvent` resolves the submitted `eventId`, opens only that activity Sheet, and validates that its event row matches the catalog.

- [ ] **Step 4: Route event-keyed seat operations**

Change `createSeatHold` and `releaseSeatHold` to call:

```js
var spreadsheet = getEventSpreadsheet_(registry, request.eventId);
```

Do not scan unrelated activity Sheets.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/visibility-countdown.test.js
```

Expected: PASS.

Commit:

```powershell
git add apps-script/Code.gs apps-script/RegistrationService.gs tests/apps-script-admin-vm.test.js tests/visibility-countdown.test.js
git commit -m "feat: route public events to activity sheets"
```

---

### Task 3: Registration writes and ticket index publication

**Files:**
- Modify: `apps-script/RegistrationService.gs`
- Modify: `apps-script/Repository.gs`
- Test: `tests/apps-script-registration-vm.test.js`
- Test: `tests/participant-flow.test.js`

**Interfaces:**
- Consumes: `getEventSpreadsheet_(registry, eventId)`
- Consumes: `upsertTicketRoute_(registry, route)`
- Produces: active registration plus one registry route containing ticket number and token digest

- [ ] **Step 1: Write failing isolation and index tests**

Create registrations for `event-a` and `event-b`. Assert:

```js
assert.equal(readRows(sheetA, "报名项目").length, 1);
assert.equal(readRows(sheetB, "报名项目").length, 1);
assert.equal(readRows(registry, "票券索引").length, 2);
assert.equal(readRows(registry, "票券索引")[0].tokenDigest.length, 64);
assert.equal(JSON.stringify(readRows(registry, "票券索引")).includes(ticket.token), false);
```

Add an injected route-write failure and assert the registration does not return success and no public ticket route becomes visible.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/apps-script-registration-vm.test.js tests/participant-flow.test.js
```

Expected: registration still uses the single configured Sheet and no ticket index row exists.

- [ ] **Step 3: Route registration by `eventId`**

After `requireRegistrationPayload_`, resolve only the requested activity Sheet. Keep all current capacity, identity, seat, pending-row, recovery, and audit behavior inside that Sheet.

- [ ] **Step 4: Publish the ticket route before returning success**

After registration activation and seat finalization, append:

```js
upsertTicketRoute_(registry, {
  ticketNumber: ticketNumber,
  tokenDigest: digestTicketToken_(token),
  eventId: event.eventId,
  registrationId: registrationId,
  status: "active",
  createdAt: createdAt,
  updatedAt: createdAt
});
```

On route publication failure, use the existing cleanup/recovery mechanisms to prevent a successful but unreachable ticket. Record a safe integrity audit if compensation cannot complete.

- [ ] **Step 5: Run focused tests and commit**

Run:

```powershell
node --test tests/apps-script-registration-vm.test.js tests/participant-flow.test.js
```

Expected: PASS.

Commit:

```powershell
git add apps-script/RegistrationService.gs apps-script/Repository.gs tests/apps-script-registration-vm.test.js tests/participant-flow.test.js
git commit -m "feat: index tickets across activity sheets"
```

---

### Task 4: Ticket, QR verification, exchange, and attendance routing

**Files:**
- Modify: `apps-script/TicketService.gs`
- Modify: `apps-script/AttendanceService.gs`
- Modify: `staff-apps-script/AttendanceService.gs`
- Modify: `scripts/build-internal-mutation-service.mjs`
- Generate: `apps-script/InternalMutationService.gs`
- Test: `tests/apps-script-registration-vm.test.js`
- Test: `tests/apps-script-attendance-vm.test.js`
- Test: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes: `getTicketRouteByNumber_(registry, ticketNumber)`
- Consumes: `getTicketRouteByToken_(registry, token)`
- Consumes: `getEventSpreadsheet_(registry, eventId)`
- Produces: route updates when a token rotates or registration status changes

- [ ] **Step 1: Write failing ticket and attendance routing tests**

Assert a ticket number from Sheet B is found without scanning Sheet A, a token from Sheet A verifies and checks in only against Sheet A, and an unknown token fails without opening any activity Sheet.

Add an exchange test:

```js
const before = context.getTicketRouteByToken_(registry, oldToken);
const exchanged = context.exchangeSeat(exchangePayload);
assert.equal(context.getTicketRouteByToken_(registry, oldToken), null);
assert.equal(context.getTicketRouteByToken_(registry, exchanged.data.token).eventId, "event-a");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/apps-script-registration-vm.test.js tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js
```

Expected: services still open one configured Sheet.

- [ ] **Step 3: Route ticket-number operations**

`lookupTicket`, `cancelRegistration`, and `exchangeSeat` first resolve the private ticket-number index, then open only the indexed event Sheet. Verify the found registration ID, ticket number, and event ID against the route before mutation.

- [ ] **Step 4: Route token operations**

`verifyTicket`, `staff.getTicket`, and `staff.checkIn` compute the token digest, resolve the route, open only the indexed activity Sheet, then call the existing ticket validation.

- [ ] **Step 5: Keep the index synchronized**

- Cancellation updates the route status to `cancelled`.
- Seat exchange replaces the old digest with the rotated token digest in the same locked mutation.
- A failed index update restores the old ticket rows/token and seat state using existing rollback helpers.
- Ended tickets keep their route so public verification can truthfully report the ended state.

- [ ] **Step 6: Regenerate the internal service**

Run:

```powershell
node scripts/build-internal-mutation-service.mjs
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
node --test tests/apps-script-registration-vm.test.js tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js
```

Expected: PASS.

Commit:

```powershell
git add apps-script/TicketService.gs apps-script/AttendanceService.gs staff-apps-script/AttendanceService.gs scripts/build-internal-mutation-service.mjs apps-script/InternalMutationService.gs tests/apps-script-registration-vm.test.js tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: route tickets and check-in by private index"
```

---

### Task 5: Automatic activity Sheet creation and protected administration

**Files:**
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `staff-apps-script/Repository.gs`
- Modify: `scripts/build-internal-mutation-service.mjs`
- Generate: `apps-script/InternalMutationService.gs`
- Modify: `apps-script/appsscript.json`
- Test: `tests/apps-script-admin-vm.test.js`
- Test: `tests/production-mutation-integration.test.js`
- Test: `tests/apps-script-contract.test.js`

**Interfaces:**
- Produces: `createActivitySpreadsheet_(eventId, title, actor)`
- Produces: `upsertActivityCatalogEntry_(registry, event, spreadsheet)`
- Changes: `getAdminDashboard({ eventId, search })`
- Changes: `saveAdminEvent(payload, actor)` automatically creates a Sheet for a new event

- [ ] **Step 1: Write failing automatic-creation tests**

Assert:

```js
const first = context.saveAdminEvent({ title: "Talk A", status: "draft" }, "admin@example.com");
const second = context.saveAdminEvent({ title: "Talk B", status: "draft" }, "admin@example.com");
const catalog = readRows(registry, "活动目录");
assert.notEqual(catalog[0].spreadsheetId, catalog[1].spreadsheetId);
assert.equal(createdSpreadsheets.length, 2);
assert.equal(createdSpreadsheets[0].editors.includes("admin@example.com"), true);
```

The production response must expose only `sheetUrl` to the authorized administrator, never a bare `spreadsheetId`.

Inject create, initialization, event-write, and catalog-write failures. Assert no failed event appears in `活动目录`, and existing catalog entries remain unchanged.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/production-mutation-integration.test.js tests/apps-script-contract.test.js
```

Expected: new events are still written into one active Sheet.

- [ ] **Step 3: Implement prepare-then-publish creation**

For a request without `eventId`:

1. Generate `eventId`.
2. `SpreadsheetApp.create(safeActivitySheetName_(title, eventId))`.
3. `initializeEventSpreadsheet_(spreadsheet)`.
4. Grant the normalized `actor` editor access.
5. Write the event row and audit to the new Sheet.
6. Append the catalog entry last.

Use a maximum safe Sheet name and strip control characters. Never accept a client-submitted Sheet ID for normal creation.

- [ ] **Step 4: Route protected activity mutations**

For event, session, seat, question, record, and dashboard operations, resolve the event Sheet from the registry. `getAdminDashboard` returns all catalog event summaries, but returns sessions, seats, questions, records, and attendance only for the selected `eventId`.

Every projected event contains protected `sheetUrl`:

```js
sheetUrl: "https://docs.google.com/spreadsheets/d/" +
  encodeURIComponent(spreadsheet.getId()) + "/edit"
```

Do not include this field in any public projection.

- [ ] **Step 5: Add the one-time Drive authorization scope**

Append the exact public-backend scope needed for creating/sharing private Sheets:

```json
"https://www.googleapis.com/auth/drive"
```

Keep the staff/admin project scopes unchanged.

- [ ] **Step 6: Regenerate the internal service and run tests**

Run:

```powershell
node scripts/build-internal-mutation-service.mjs
node --test tests/apps-script-admin-vm.test.js tests/production-mutation-integration.test.js tests/apps-script-contract.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add staff-apps-script/AdminService.gs staff-apps-script/Repository.gs scripts/build-internal-mutation-service.mjs apps-script/InternalMutationService.gs apps-script/appsscript.json tests/apps-script-admin-vm.test.js tests/production-mutation-integration.test.js tests/apps-script-contract.test.js
git commit -m "feat: create a private sheet for each activity"
```

---

### Task 6: Simple administrator workflow and working navigation

**Files:**
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Test: `tests/admin-ui-contract.test.js`

**Interfaces:**
- Consumes: `getAdminDashboard({ eventId, search })`
- Consumes: protected event `sheetUrl`
- Produces: selected-activity UI state
- Produces: reliable `scrollToAdminSection_(targetId)`

- [ ] **Step 1: Write failing UI contract tests**

Require:

```js
assert.match(html, /id="activity-selector"/);
assert.match(script, /scrollIntoView\(\{\s*behavior:\s*"smooth"/);
assert.match(script, /event\.preventDefault\(\)/);
assert.match(html, /打开活动数据表/);
assert.doesNotMatch(html, /所属活动 ID<input/);
```

Also assert the manual whole-system switch panel is inside a collapsed `<details>` labelled `高级维护`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node --test tests/admin-ui-contract.test.js
```

Expected: no activity selector and no JavaScript-controlled navigation.

- [ ] **Step 3: Implement selected-activity workflow**

- The event list remains visible.
- Clicking an event sets `state.selectedEventId`, reloads its dashboard, and fills hidden event IDs for session, seat, and question forms.
- New event creation clears `state.selectedEventId`; successful creation selects the returned event automatically.
- Show “打开活动数据表” only from the protected `sheetUrl`.
- Remove ordinary Sheet ID fields from the normal workflow.

- [ ] **Step 4: Fix the top navigation**

Attach click handlers to `nav a[href^="#"]`:

```js
event.preventDefault();
const target = document.querySelector(link.getAttribute("href"));
if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
```

Update `aria-current` when a section is selected.

- [ ] **Step 5: Run UI tests and commit**

Run:

```powershell
node --test tests/admin-ui-contract.test.js
```

Expected: PASS.

Commit:

```powershell
git add staff-apps-script/Admin.html staff-apps-script/AdminScript.html tests/admin-ui-contract.test.js
git commit -m "feat: simplify activity administration"
```

---

### Task 7: Bundles, documentation, complete verification, and deployment handoff

**Files:**
- Modify: `README.md`
- Modify: `apps-script/DEPLOYMENT.md`
- Generate: `source-bundles/public-backend.txt`
- Generate: `source-bundles/staff-admin.txt`
- Generate: `staff-apps-script/SourceBundles.gs`
- Test: `tests/admin-source-bundles.test.js`
- Test: `tests/public-package-check.test.js`

**Interfaces:**
- Consumes: all completed per-event routing and administrator behavior
- Produces: paste-ready, redacted one-time upgrade bundles

- [ ] **Step 1: Write failing documentation/bundle assertions**

Require deployment docs to state:

- the registry Sheet remains permanent;
- each new event Sheet is automatic and private;
- the first upgraded run requests one-time Drive authorization;
- no future per-event Apps Script setup or deployment is required;
- existing nonempty legacy event data is not automatically split.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/admin-source-bundles.test.js tests/public-package-check.test.js
```

Expected: docs and generated bundles do not describe the new model.

- [ ] **Step 3: Update docs and regenerate all bundles**

Run:

```powershell
node scripts/build-internal-mutation-service.mjs
node scripts/build-admin-source-bundles.mjs
```

Ensure source bundles contain no deployed URL, Sheet ID, allowlist value, or shared secret.

- [ ] **Step 4: Run the full test suite**

Run:

```powershell
npm.cmd test
node scripts/build-admin-source-bundles.mjs --check
```

Expected: all tests PASS and generated sources are current.

- [ ] **Step 5: Run the production public-package safety check**

Run with the separately approved public/staff deployment URLs:

```powershell
if (-not $env:PUBLIC_APPS_SCRIPT_WEB_APP_URL) { throw 'Load the approved public deployment URL from the protected deployment record.' }
if (-not $env:STAFF_APPS_SCRIPT_WEB_APP_URL) { throw 'Load the approved staff deployment URL from the protected deployment record.' }
node scripts/check-public-package.mjs --public-dir '..\event-registration-public'
```

Expected: the participant package contains only approved public files and no private deployment data.

- [ ] **Step 6: Commit the handoff**

```powershell
git add README.md apps-script/DEPLOYMENT.md source-bundles staff-apps-script/SourceBundles.gs tests/admin-source-bundles.test.js tests/public-package-check.test.js
git commit -m "docs: prepare per-event sheet deployment"
```

- [ ] **Step 7: One-time live deployment and end-to-end verification**

Using the existing protected deployment workflow:

1. Replace the public-backend Apps Script files with `source-bundles/public-backend.txt`.
2. Deploy a new public-backend version and approve the new Drive scope once.
3. Replace the staff/admin Apps Script files with `source-bundles/staff-admin.txt`.
4. Deploy a new staff/admin version.
5. Create Activity A and Activity B through the protected administrator page.
6. Confirm two distinct private Sheet links.
7. Open the one public GitHub Pages site and confirm both activity cards appear.
8. Submit one registration to each activity and verify each appears only in its own Sheet.
9. Verify both QR tokens, then check in one session from each activity.
10. Confirm administrator navigation scrolls to every named section.

Expected: the full per-event workflow works without entering any Sheet ID or editing Apps Script after deployment.
