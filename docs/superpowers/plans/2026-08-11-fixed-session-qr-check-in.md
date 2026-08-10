# Fixed Session QR Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff set one activity, session, and optional checkpoint once, then continuously scan QR tickets which are atomically validated and checked in with one request per ticket.

**Architecture:** Add a fixed-session control surface to the protected staff page. It loads safe event/session choices from a staff-only read endpoint, keeps the selected IDs in browser state, and routes each decoded QR directly to the existing atomic `checkIn` backend operation. The backend remains authoritative for ticket validity, event match, session registration, checkpoint and duplicate prevention.

**Tech Stack:** Google Apps Script HTML Service, existing signed internal gateway, vanilla JavaScript, Node built-in test runner.

## Global Constraints

- Do not expose activity Sheets, participant details, allowlists, tokens, or backend deployment secrets in public GitHub Pages files.
- The public participant package remains read-only with respect to attendance.
- Fixed mode sends exactly one `checkIn` RPC per decoded QR and never calls `getStaffTicketForCheckIn` first.
- Server validation remains the source of truth; a browser-selected session never bypasses registration, duplicate, or time checks.
- iPhone scanner continues to run at the GitHub Pages top level and returns only an opaque QR value to the protected staff page.

---

### Task 1: Add staff-safe activity and session choices

**Files:**
- Modify: `staff-apps-script/AttendanceService.gs`
- Modify: `apps-script/InternalGateway.gs`
- Modify: `apps-script/AttendanceService.gs`
- Test: `tests/apps-script-staff-route-vm.test.js`
- Test: `tests/apps-script-attendance-vm.test.js`

**Interfaces:**
- Produces `getStaffCheckInTargets(): { ok: boolean, data?: Array<{ eventId: string, title: string, sessions: Array<{ sessionId: string, title: string, speaker: string, startsAt: string, checkInMode: string, checkpoints: Array<{ checkpointId: string, label: string }> }> }>, code?: string }`.
- Consumes the current allowlisted Google session and the existing signed `invokeInternalBackend_` route.

- [ ] **Step 1: Write failing access and projection tests**

```js
test("an authorized staff session receives only active check-in targets", async () => {
  const result = context.getStaffCheckInTargets();
  assert.equal(result.ok, true);
  assert.deepEqual(result.data[0], {
    eventId: "event-1",
    title: "现代 F3 备战班",
    sessions: [{ sessionId: "mm", title: "MM", speaker: "邱老师", startsAt: "2026-08-15T13:00:00.000Z", checkInMode: "single", checkpoints: [] }]
  });
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js`

Expected: FAIL because `getStaffCheckInTargets` and its internal route do not exist.

- [ ] **Step 3: Implement the safe target route**

```js
function getStaffCheckInTargets() {
  return runStaffAttendanceService_(function() {
    var actor = requireAuthorizedStaffSession_();
    var result = invokeInternalBackend_('staff.getCheckInTargets', {}, actor);
    if (!result.ok) staffAttendanceError_(result.code);
    return result.data;
  });
}
```

Implement `staff.getCheckInTargets` in `InternalGateway.gs` and have the public backend project return only check-in-capable activities, sessions, display labels and configured checkpoints. Exclude participant, seat and answer data.

- [ ] **Step 4: Run focused tests to verify success**

Run: `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js`

Expected: PASS; unauthorized callers receive `STAFF_ACTION_DENIED` without Sheet access.

- [ ] **Step 5: Commit**

```bash
git add staff-apps-script/AttendanceService.gs apps-script/InternalGateway.gs apps-script/AttendanceService.gs tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js
git commit -m "feat: expose safe staff check-in targets"
```

### Task 2: Build fixed-session automatic check-in controls

**Files:**
- Modify: `staff-apps-script/StaffCheckIn.html`
- Test: `tests/ticket-attendance-behavior.test.js`

**Interfaces:**
- Consumes `google.script.run.getStaffCheckInTargets()` and `google.script.run.checkIn({ token, sessionId, checkpointId })`.
- Produces browser state `{ fixedEventId, fixedSessionId, fixedCheckpointId, fixedMode }` and `submitFixedScan_(scannedValue)`.

- [ ] **Step 1: Write failing behavior tests**

```js
test("fixed mode sends one atomic check-in for a scanned QR", async () => {
  await listeners["fixed:start"]();
  await scannerResult("https://events.example/v.html?t=" + "a".repeat(64));
  assert.deepEqual(calls.checkIn, [{ token: "a".repeat(64), sessionId: "mm", checkpointId: undefined }]);
  assert.equal(calls.getTicket, 0);
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `node --test tests/ticket-attendance-behavior.test.js`

Expected: FAIL because the page currently reads each ticket before selecting its session.

- [ ] **Step 3: Implement fixed-mode UI and state**

```js
async function submitFixedScan_(scannedValue) {
  const token = parseScannedTicketToken(scannedValue);
  if (!token || !fixedSessionId || checkInPending) return;
  checkInPending = true;
  google.script.run
    .withSuccessHandler(handleFixedCheckInResult_)
    .withFailureHandler(handleFixedCheckInFailure_)
    .checkIn({ token, sessionId: fixedSessionId, checkpointId: fixedCheckpointId || undefined });
}
```

Render activity, session and conditional checkpoint selects before the scanner button. Disable scanning until a session is selected. Show the active choice above the camera. On success or safe failure, restore continuous scanning without submitting another request automatically.

- [ ] **Step 4: Run focused test to verify success**

Run: `node --test tests/ticket-attendance-behavior.test.js`

Expected: PASS; a scan produces exactly one check-in request with the fixed session, and the old manual flow remains usable.

- [ ] **Step 5: Commit**

```bash
git add staff-apps-script/StaffCheckIn.html tests/ticket-attendance-behavior.test.js
git commit -m "feat: add fixed-session continuous QR check-in"
```

### Task 3: Preserve iPhone continuous scanner return and ship

**Files:**
- Modify: `public/js/staff-scanner.js`
- Modify: `public/staff-scanner.html`
- Modify: `staff-apps-script/Code.gs`
- Modify: `scripts/build-admin-source-bundles.mjs` only if bundle tests require it
- Test: `tests/ticket-attendance-behavior.test.js`

**Interfaces:**
- Consumes a protected staff return URL with `fixedSessionId` and optional `fixedCheckpointId` query parameters.
- Produces a return URL whose QR value is read once by `submitFixedScan_` after the protected staff page restores fixed mode.

- [ ] **Step 1: Write failing iPhone return test**

```js
test("the iPhone scanner returns a QR to the fixed staff session", () => {
  const target = returnWithScan("ticket-url");
  assert.match(target, /fixedSessionId=mm/);
  assert.match(target, /scan=ticket-url/);
});
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `node --test tests/ticket-attendance-behavior.test.js`

Expected: FAIL because the scanner currently returns only `scan` and loses the fixed session selection.

- [ ] **Step 3: Preserve fixed selection through top-level iPhone scanner**

```js
target.searchParams.set("scan", scannedValue);
target.searchParams.set("fixedSessionId", fixedSessionId);
if (fixedCheckpointId) target.searchParams.set("fixedCheckpointId", fixedCheckpointId);
window.location.replace(target.href);
```

Validate that the return URL remains the approved protected staff endpoint; ignore malformed fixed IDs in the browser and rely on server validation during check-in.

- [ ] **Step 4: Run full verification**

Run: `node scripts/build-admin-source-bundles.mjs && npm run check && git diff --check`

Expected: all tests pass, generated staff bundle is current, and no public package check fails.

- [ ] **Step 5: Commit and deploy**

```bash
git add public/staff-scanner.html public/js/staff-scanner.js staff-apps-script/Code.gs staff-apps-script/SourceBundles.gs source-bundles/staff-admin.txt tests/ticket-attendance-behavior.test.js
git commit -m "feat: keep fixed session through iPhone QR scans"
git push origin feature/stable-event-ticket-system
```

Paste the tested staff aggregate into Apps Script `代码.gs`, update `StaffCheckIn.html`, deploy a new version of the existing staff web app, then verify the live protected page can select a session and returns a successful fixed-scan check-in response with a test ticket.
