# Participant Registration Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified ticket owner add or remove individual sessions from the existing ticket before registration closes, with capacity, schedule, attendance, and seat rules enforced atomically.

**Architecture:** Extend the existing public Apps Script ticket service with one owner-authorized mutation, `updateRegistrationSessions`. Reuse the authoritative selection, capacity, seat, routing, snapshot, and audit patterns already used by registration, cancellation, and seat exchange. Extend the safe ticket projection with management options, then render and submit them from the existing electronic-ticket page.

**Tech Stack:** Google Apps Script V8, Google Sheets, static HTML/CSS, browser ES modules, Node.js built-in test runner.

## Global Constraints

- The entry point stays on the existing electronic-ticket page.
- The participant must verify the ticket with ticket number and the configured phone or Email identity value.
- Management is allowed only before the server-authoritative registration closing time.
- Required, started, and checked-in sessions cannot be removed.
- The original registration ID, ticket number, QR token, answers, and ticket route must remain unchanged.
- Shared seats remain assigned; per-session seats are claimed or released with their session.
- Any mutation failure restores registration rows, seats, and audit state.
- Public responses never expose raw participant data, Spreadsheet IDs, script errors, or stack traces.
- Every administrator and participant asynchronous action immediately shows a specific pending message, disables duplicate submission, and ends with an explicit success or safe failure result plus refreshed authoritative state.
- Existing unrelated working-tree changes in `public/js/api.js`, `tests/api-contract.test.js`, and `paste-ready/` must be inspected and preserved rather than overwritten.

---

### Task 1: Public API Contract and Safe Errors

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `public/js/api.js`
- Modify: `tests/api-contract.test.js`
- Modify: `tests/apps-script-contract.test.js`

**Interfaces:**
- Consumes: existing `request(action, payload)` and `PUBLIC_ROUTES`.
- Produces: `updateRegistrationSessions(requestData)` in the browser client and Apps Script route `updateRegistrationSessions(payload)`.

- [ ] **Step 1: Write the failing browser API test**

Add an API-contract case that expects:

```js
["updateRegistrationSessions", {
  ticketNumber: "T-01",
  verificationValue: "13800000000",
  sessionIds: ["s1", "s2"],
  seatChoices: ["seat-s2"],
  seatHoldOwner: "browser-owner-0001"
}, () => client.updateRegistrationSessions({
  ticketNumber: "T-01",
  verificationValue: "13800000000",
  sessionIds: ["s1", "s2"],
  seatChoices: ["seat-s2"],
  seatHoldOwner: "browser-owner-0001"
})]
```

Assert that only these five allowlisted fields are sent.

- [ ] **Step 2: Run the focused contract tests and verify RED**

Run:

```powershell
node --test tests/api-contract.test.js tests/apps-script-contract.test.js
```

Expected: FAIL because the client method and public route do not exist.

- [ ] **Step 3: Add the minimal route and client method**

Add to `PUBLIC_ROUTES`:

```js
'updateRegistrationSessions': function(payload) {
  return updateRegistrationSessions(payload);
},
```

Add to `createPublicClient` and named exports:

```js
updateRegistrationSessions: (requestData) => request("updateRegistrationSessions", {
  ticketNumber: requestData?.ticketNumber,
  verificationValue: requestData?.verificationValue,
  sessionIds: requestData?.sessionIds,
  seatChoices: requestData?.seatChoices,
  seatHoldOwner: requestData?.seatHoldOwner
})
```

Add fixed client messages for `REGISTRATION_UPDATE_CLOSED`, `REQUIRED_SESSION`, `SESSION_STARTED`, `SESSION_CHECKED_IN`, `SESSION_FULL`, `SESSION_CONFLICT`, and `REGISTRATION_CHANGED`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add -- apps-script/Code.gs public/js/api.js tests/api-contract.test.js tests/apps-script-contract.test.js
git commit -m "feat: add participant session update contract"
```

---

### Task 2: No-Seat Session Update Transaction

**Files:**
- Modify: `apps-script/TicketService.gs`
- Modify: `tests/apps-script-registration-vm.test.js`

**Interfaces:**
- Consumes: `requireTicketNumberRoute_`, `requireVerifiedTicket_`, `validateSessionSelection_`, `validateSessionCapacity_`, `snapshotTicketRows_`, `restoreTicketSnapshots_`.
- Produces: `updateRegistrationSessions(payload): ApiResult<Ticket>` and `validateTicketSessionUpdate_(match, payload, now)`.

- [ ] **Step 1: Write failing service tests**

Add VM tests that create an active ticket with session `s1`, then call:

```js
context.updateRegistrationSessions({
  ticketNumber: "T-01",
  verificationValue: "13800000000",
  sessionIds: ["s1", "s2"],
  seatChoices: []
})
```

Assert one registration ID and ticket number remain, `s2` becomes active, the QR token and route digest are unchanged, and the returned projection contains `s1` and `s2`. Add a removal case that targets only `s2` and preserves historical rows by marking the removed `s1` row `cancelled` rather than deleting it.

- [ ] **Step 2: Run the focused service test and verify RED**

```powershell
node --test tests/apps-script-registration-vm.test.js
```

Expected: FAIL because `updateRegistrationSessions` is undefined.

- [ ] **Step 3: Implement the minimal locked transaction**

Implement:

```js
function updateRegistrationSessions(payload) {
  return runTicketService_(function() {
    return withScriptLock(function() {
      // Resolve registry route, enforce maintenance and active route,
      // recover transactions, verify ticket owner, validate target sessions,
      // snapshot rows, update/add/cancel rows, audit, and project the ticket.
    });
  });
}
```

Use one active row per selected session. Reactivate a matching historical row when safe; otherwise append a row with the existing `registrationId`, `participantId`, `ticketNumber`, stored answers, and token. Mark removed rows `cancelled`; never delete rows. Keep route token and status unchanged.

- [ ] **Step 4: Verify basic add/remove GREEN**

Run the command from Step 2. Expected: PASS for the new cases and all existing registration VM cases.

- [ ] **Step 5: Commit the basic transaction**

```powershell
git add -- apps-script/TicketService.gs tests/apps-script-registration-vm.test.js
git commit -m "feat: update ticket sessions without creating a new ticket"
```

---

### Task 3: Policy, Time, Capacity, and Attendance Validation

**Files:**
- Modify: `apps-script/TicketService.gs`
- Modify: `tests/apps-script-registration-vm.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes: target session IDs and the current verified ticket match.
- Produces: deterministic public error codes and an unchanged ticket on every rejected request.

- [ ] **Step 1: Add failing rule tests**

Add separate tests for:

```js
// registration closes exactly at server now
closesAt === now.toISOString() // REGISTRATION_UPDATE_CLOSED

// required or checked-in session removed
session.required === true       // REQUIRED_SESSION
attendance.sessionId === "s1"   // SESSION_CHECKED_IN

// target set violates policy
sessionIds.length < minChoices
sessionIds.length > maxChoices
two sessions overlap
topic group exceeds maximum

// newly added session unavailable
session.startsAt <= now
active unique registration count >= capacity
```

For each case, compare all registration rows, seat rows, ticket routes, and audit counts before and after; they must be identical.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
node --test tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
```

Expected: FAIL on the first missing validation.

- [ ] **Step 3: Implement validation by reusing authoritative helpers**

Build the target session objects from event-owned rows only. Call `validateSessionSelection_` and `validateSessionCapacity_` with active registrations excluding the current registration ID. Add exact server-time close/start checks and attendance lookup. Map internal validation failures to fixed public codes; do not return raw helper messages.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit validation**

```powershell
git add -- apps-script/TicketService.gs tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: enforce session update policy and attendance rules"
```

---

### Task 4: Seat Changes and Transaction Rollback

**Files:**
- Modify: `apps-script/TicketService.gs`
- Modify: `tests/apps-script-registration-vm.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes: `payload.seatChoices`, `payload.seatHoldOwner`, validated added/removed sessions, `match.policy.seatMode`.
- Produces: correctly claimed/released seats and complete rollback snapshots.

- [ ] **Step 1: Write failing seat-mode tests**

Cover:

```js
// shared seat
target sessions change; existing blank-session seat stays registered

// per-session seat
add s2 with seat-s2; remove s1 releases seat-s1

// unavailable seat
seat-s2 belongs to another registration // SEAT_UNAVAILABLE

// wrong hold owner
seat-s2 is held by a different browser owner // SEAT_UNAVAILABLE
```

Inject failures after the new seat claim, after registration-row writes, after old-seat release, and during audit. Each failure must restore every row and keep the original QR route.

- [ ] **Step 2: Run focused mutation tests and verify RED**

```powershell
node --test tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
```

Expected: FAIL because session updates do not yet reconcile seats.

- [ ] **Step 3: Implement seat reconciliation**

Compute `keptSeats`, `newSeats`, and `releasedSeats` before mutation. For per-session mode, require exactly the configured seat selection for each newly added session. For shared mode, retain the existing blank-session seat. Snapshot all affected registration rows and seats before the first write; use the existing pending/registered holder conventions and rollback helpers.

- [ ] **Step 4: Run focused mutation tests and verify GREEN**

Run the command from Step 2. Expected: PASS, including injected rollback failures.

- [ ] **Step 5: Commit seat transaction support**

```powershell
git add -- apps-script/TicketService.gs tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: reconcile seats during participant session updates"
```

---

### Task 5: Safe Ticket Management Projection

**Files:**
- Modify: `apps-script/TicketService.gs`
- Modify: `tests/apps-script-registration-vm.test.js`
- Modify: `tests/ticket-attendance-behavior.test.js`

**Interfaces:**
- Consumes: the verified `match`, event policy, all event sessions, capacity counts, seats, attendance, and server time.
- Produces:

```js
ticket.capabilities.canManageSessions
ticket.sessionManagement = {
  closesAt,
  selectionMode,
  minChoices,
  maxChoices,
  seatMode,
  sessions: [{
    sessionId, title, speaker, startsAt, endsAt, location,
    selected, required, disabledReason,
    seats: [{ seatId, label, zone, available }]
  }]
}
```

- [ ] **Step 1: Write failing projection tests**

Assert that a verified active ticket before closing receives safe management data; closed/cancelled/ended tickets receive `canManageSessions: false`. Assert no participant answers, verification value, Spreadsheet ID, holder registration ID, or raw capacity rows appear.

- [ ] **Step 2: Run focused projection tests and verify RED**

```powershell
node --test tests/apps-script-registration-vm.test.js tests/ticket-attendance-behavior.test.js
```

Expected: FAIL because management projection fields are absent.

- [ ] **Step 3: Add the projection**

Extend `ticketProjectionFromRecords_` with a dedicated `buildTicketSessionManagement_` helper. Derive disabled reasons on the server and expose only display fields and safe selectable seat facts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the projection**

```powershell
git add -- apps-script/TicketService.gs tests/apps-script-registration-vm.test.js tests/ticket-attendance-behavior.test.js
git commit -m "feat: expose safe ticket session management options"
```

---

### Task 6: Electronic-Ticket Management UI

**Files:**
- Modify: `public/js/ticket-page.js`
- Modify: `public/css/app.css`
- Modify: `tests/ticket-attendance-behavior.test.js`

**Interfaces:**
- Consumes: `ticket.sessionManagement`, `ticket.capabilities.canManageSessions`, and `updateRegistrationSessions`.
- Produces: accessible “管理我的报名” controls with confirmation summary, seat selectors, pending state, and rerendered ticket.

- [ ] **Step 1: Write failing view-model and markup tests**

Assert markup includes:

```html
<section data-ticket-session-management>
<input type="checkbox" data-session-id="...">
<select data-session-seat="...">
<button data-ticket-action="update-sessions">保存场次修改</button>
```

Assert selected sessions start checked, disabled reasons are visible, shared-seat mode has no new selector, and HTML values are escaped.

- [ ] **Step 2: Run the UI test and verify RED**

```powershell
node --test tests/ticket-attendance-behavior.test.js
```

Expected: FAIL because the management markup and behavior do not exist.

- [ ] **Step 3: Implement view model, markup, and controller**

Import `updateRegistrationSessions`. Extend `createTicketViewModel`, render the management panel, calculate the target session and seat arrays from the controls, show the added/removed summary in `confirm`, disable the save button during the request, and call `rerender(result.data, verificationValue)` on success. On failure, display the safe message and rerender the last server-confirmed ticket so stale choices disappear.

- [ ] **Step 4: Add and pass repeated-click behavior test**

Use a deferred API promise and invoke the click handler twice. Assert one request is emitted and the button stays disabled until resolution.

- [ ] **Step 5: Run UI tests and verify GREEN**

```powershell
node --test tests/ticket-attendance-behavior.test.js tests/api-contract.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the participant UI**

```powershell
git add -- public/js/ticket-page.js public/css/app.css tests/ticket-attendance-behavior.test.js
git commit -m "feat: manage registered sessions from the electronic ticket"
```

---

### Task 7: System-Wide Operation Feedback Audit

**Files:**
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `staff-apps-script/StaffCheckIn.html`
- Modify: `public/js/index-page.js`
- Modify: `public/js/register-page.js`
- Modify: `public/js/ticket-page.js`
- Modify: `public/js/verify-page.js`
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/ticket-attendance-behavior.test.js`
- Modify: `tests/participant-flow.test.js`
- Modify: `tests/apps-script-staff-route-vm.test.js`

**Interfaces:**
- Consumes: every existing asynchronous UI action and its current success/failure result.
- Produces: one pending request per action, specific live-region status, restored controls on failure, and refreshed authoritative UI on success.

- [ ] **Step 1: Write failing administrator feedback tests**

Build a table-driven test over activity, session, seat plan, question, draft finalization, draft deletion, empty-event deletion, lifecycle, registration record, Sheet test, and Sheet switch actions. For each action, use a deferred runner and assert:

```js
firstClickRequestCount === 1
secondClickBeforeResolutionRequestCount === 1
button.disabled === true
status.textContent.startsWith("正在") === true
```

Resolve success and assert a concrete success message plus refreshed data. Reject with a safe result and assert the button is restored with a visible error.

- [ ] **Step 2: Run administrator feedback tests and verify RED**

```powershell
node --test tests/admin-ui-behavior.test.js
```

Expected: FAIL on every action that lacks one of the required states.

- [ ] **Step 3: Implement missing administrator and staff feedback**

Use the existing `adminRunner_` pending guard pattern for every uncovered administrator mutation. Add an `aria-live="polite"` status region where absent. In `StaffCheckIn.html`, disable lookup/check-in controls during their request, report the exact success outcome, and restore controls on failure.

- [ ] **Step 4: Write failing participant feedback tests**

Cover event loading, ticket lookup, registration submission, seat hold/release, cancellation, exchange, session update, and verification loading. Assert one request while pending, a specific “正在……” message, success rerender/navigation, and restored controls on failure.

- [ ] **Step 5: Run participant feedback tests and verify RED**

```powershell
node --test tests/participant-flow.test.js tests/ticket-attendance-behavior.test.js tests/apps-script-staff-route-vm.test.js
```

Expected: FAIL for any uncovered operation.

- [ ] **Step 6: Implement missing participant feedback**

Add small per-controller pending flags rather than one global lock, so unrelated read-only actions remain usable. Always render server-confirmed state after mutations, and use fixed public error messages.

- [ ] **Step 7: Verify all feedback tests GREEN**

```powershell
node --test tests/admin-ui-behavior.test.js tests/participant-flow.test.js tests/ticket-attendance-behavior.test.js tests/apps-script-staff-route-vm.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit the feedback audit**

```powershell
git add -- staff-apps-script/Admin.html staff-apps-script/AdminScript.html staff-apps-script/StaffCheckIn.html public/js/index-page.js public/js/register-page.js public/js/ticket-page.js public/js/verify-page.js tests/admin-ui-behavior.test.js tests/participant-flow.test.js tests/ticket-attendance-behavior.test.js tests/apps-script-staff-route-vm.test.js
git commit -m "fix: make every user action visibly pending and complete"
```

---

### Task 7A: Configurable Visual Seat Map

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `public/js/register-page.js`
- Modify: `public/css/app.css`
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `apps-script/InternalMutationService.gs`
- Test: `tests/registration-behavior.test.js`
- Test: `tests/apps-script-admin-vm.test.js`

- [x] Publish every seat with only its safe availability state; never publish its holder.
- [x] Group generated seats into visual zones with row and column gaps.
- [x] Disable occupied seats and show clear lock progress.
- [x] Allow the administrator to change the stage/whiteboard label per activity.

---

### Task 8: Bundles, Integration Verification, and Deployment

**Files:**
- Modify: `staff-apps-script/SourceBundles.gs`
- Modify: `source-bundles/public-backend.txt`
- Modify: `source-bundles/staff-admin.txt`
- Modify: `apps-script/DEPLOYMENT.md`
- Test: `tests/production-mutation-integration.test.js`
- Test: all `tests/*.test.js`

**Interfaces:**
- Consumes: all completed server and participant changes.
- Produces: deterministic paste-ready bundles and live public backend/static site versions.

- [ ] **Step 1: Add the final end-to-end test**

Create one real assembled-system flow:

```js
lookup original ticket
update from ["s1"] to ["s1", "s2"]
lookup same ticket number
verify same QR token
staff lookup sees both sessions
check in s2 succeeds
```

Also assert no second participant, ticket route, or ticket number was created.

- [ ] **Step 2: Run the integration test and verify RED if any wiring is missing**

```powershell
node --test tests/production-mutation-integration.test.js
```

Expected: PASS only after all route, service, projection, and attendance wiring is complete.

- [ ] **Step 3: Regenerate deterministic bundles**

```powershell
node scripts/build-admin-source-bundles.mjs
npm.cmd run check:bundles
```

Expected: both commands exit 0.

- [ ] **Step 4: Run full verification**

```powershell
npm.cmd test
npm.cmd run check:bundles
git diff --check
```

Expected: all tests pass, bundle check passes, and diff check has no errors.

- [ ] **Step 5: Commit generated artifacts and deployment notes**

```powershell
git add -- apps-script/DEPLOYMENT.md staff-apps-script/SourceBundles.gs source-bundles/public-backend.txt source-bundles/staff-admin.txt tests/production-mutation-integration.test.js
git commit -m "build: package participant registration management"
```

- [ ] **Step 6: Deploy without changing URLs or permissions**

Update the existing public Apps Script project with the tested public backend files and deploy a new version on the existing public deployment ID. Publish the static participant files to the existing GitHub Pages repository. No new OAuth scopes or sharing changes are permitted.

- [ ] **Step 7: Verify the live flow non-destructively**

Reload the participant electronic-ticket page and confirm the management region is present only after owner verification. Use a controlled test activity or fixture ticket; do not modify the user’s real activity records. Confirm the live backend returns safe fixed errors for an invalid ticket and the public URLs remain unchanged.
