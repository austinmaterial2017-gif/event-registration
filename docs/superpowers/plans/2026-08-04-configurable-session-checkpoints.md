# Configurable Session Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each session to require a configurable number of check-ins using single, automatic-next, manual-choice, or disabled behavior while preserving all existing tickets and attendance history.

**Architecture:** Store checkpoint policy in the existing private per-session administrator settings and extend attendance rows with stable checkpoint identity. The protected staff UI reads a server-projected checkpoint state; the public backend remains the only writer and serializes duplicate detection with the existing script lock. Existing sessions and legacy attendance rows project as one completed or available `checkpoint-1`.

**Tech Stack:** Google Apps Script V8, Google Sheets, vanilla HTML/CSS/JavaScript, Node.js built-in test runner and VM test harnesses.

## Global Constraints

- Session modes are exactly `none`, `single`, `automatic`, and `manual`.
- `automatic` and `manual` accept integer counts from 1 through 20; `single` is always 1 and `none` is 0.
- Empty labels render as `第 N 次签到`; labels are private administrator configuration.
- Activity-level `none` and `event` modes keep their existing meaning and override session checkpoint settings.
- Old sessions default to `single`; old attendance rows map to `checkpoint-1` without deleting or rewriting historical values.
- Server time, the authenticated staff account, and the public backend lock remain authoritative.
- No Sheet ID, allowlist, secret, participant answer, or staff identity may enter the GitHub Pages package.

---

### Task 1: Non-destructive attendance schema migration

**Files:**
- Modify: `apps-script/Repository.gs:1-380`
- Modify: `staff-apps-script/Repository.gs:1-380`
- Test: `tests/repository-attendance-migration.test.js`
- Test: `tests/apps-script-contract.test.js`

**Interfaces:**
- Produces the exact attendance header `['checkInId','registrationId','eventId','sessionId','checkpointId','checkpointLabel','checkedInAt','checkedInBy','status']`.
- Produces `migrateLegacyAttendanceHeader_(sheet, headers): boolean`, accepting both the six-column pre-session schema and the seven-column pre-checkpoint schema.
- Preserves every existing data cell while inserting missing columns.

- [ ] **Step 1: Read `writing-good-tests.md` and write failing migration tests**

Add cases that start with the current seven-column attendance sheet and assert that initialization inserts `checkpointId` and `checkpointLabel` after `sessionId`, shifts time/staff/status values right, and preserves every row. Keep the existing six-column migration case and assert the final nine-column header.

```js
assert.deepEqual(sheet.values[0], [
  'checkInId', 'registrationId', 'eventId', 'sessionId',
  'checkpointId', 'checkpointLabel', 'checkedInAt', 'checkedInBy', 'status'
]);
assert.deepEqual(sheet.values[1].slice(6), [oldTime, oldActor, 'checked_in']);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/repository-attendance-migration.test.js tests/apps-script-contract.test.js`

Expected: FAIL because the header still has seven columns and the checkpoint columns are absent.

- [ ] **Step 3: Implement the minimal dual legacy migration**

Update both repository definitions and make `migrateLegacyAttendanceHeader_` recognize:

```js
var preCheckpoint = [
  'checkInId', 'registrationId', 'eventId', 'sessionId',
  'checkedInAt', 'checkedInBy', 'status'
];
```

For this shape call `sheet.insertColumnsAfter(4, 2)` and write the two new headers. Retain the existing pre-session migration, but make it finish with the same nine-column layout.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test tests/repository-attendance-migration.test.js tests/apps-script-contract.test.js`

Expected: PASS with legacy row values unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps-script/Repository.gs staff-apps-script/Repository.gs tests/repository-attendance-migration.test.js tests/apps-script-contract.test.js
git commit -m "feat: migrate attendance checkpoints safely"
```

### Task 2: Persist and project per-session checkpoint settings

**Files:**
- Modify: `staff-apps-script/AdminService.gs:850-940,1770-1860`
- Modify: `scripts/build-internal-mutation-service.mjs`
- Generate: `apps-script/InternalMutationService.gs`
- Modify: `staff-apps-script/Admin.html:275-330`
- Modify: `staff-apps-script/AdminScript.html:230-260,500-530,620-700,920-980`
- Test: `tests/apps-script-admin-vm.test.js`
- Test: `tests/admin-ui-contract.test.js`
- Test: `tests/admin-ui-behavior.test.js`

**Interfaces:**
- Produces `adminCheckpointPolicy_(value): {checkInMode:string, checkInCount:number, checkInLabels:string[]}`.
- `saveAdminSession_` accepts `checkInMode`, `checkInCount`, and `checkInLabels` and stores them in `ADMIN_SETTINGS.registration.events[eventId].sessions[sessionId]`.
- `adminSessionProjection_` returns all three normalized fields.

- [ ] **Step 1: Write failing backend policy tests**

Add tests proving that one session can save `{checkInMode:'manual', checkInCount:4, checkInLabels:['入场','','','离场']}` while another saves `{checkInMode:'automatic', checkInCount:3}`. Assert invalid modes, fractional counts, counts outside 1–20, and labels beyond the count return `INVALID_REQUEST`.

- [ ] **Step 2: Write failing administrator UI tests**

Add session-form controls named `checkInMode`, `checkInCount`, and `checkInLabels`. Assert mode changes show or hide the count/label group, reset `single` to 1, and send normalized labels split by line.

```js
assert.deepEqual(mutation.payload, {
  eventId: 'event-1',
  checkInMode: 'manual',
  checkInCount: 4,
  checkInLabels: ['入场', '', '', '离场']
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/apps-script-admin-vm.test.js tests/admin-ui-contract.test.js tests/admin-ui-behavior.test.js`

Expected: FAIL because the session policy fields and controls do not exist.

- [ ] **Step 4: Implement policy normalization and persistence**

Implement one normalizer with these canonical results:

```js
none      -> { checkInMode: 'none',      checkInCount: 0, checkInLabels: [] }
single    -> { checkInMode: 'single',    checkInCount: 1, checkInLabels: [''] }
automatic -> { checkInMode: 'automatic', checkInCount: n, checkInLabels: labels }
manual    -> { checkInMode: 'manual',    checkInCount: n, checkInLabels: labels }
```

Default missing policy to `single`. Store the normalized object only after the session row validates.

- [ ] **Step 5: Implement session form controls and feedback**

Add a select with the four Chinese options, a numeric input `min="1" max="20" step="1"`, and a textarea with “每行一个；留空自动使用第 N 次签到”. Reuse the existing pending/success save behavior and show exact validation messages before sending.

- [ ] **Step 6: Generate the public mutation service and verify GREEN**

Run: `node scripts/build-internal-mutation-service.mjs`

Run: `node --test tests/apps-script-admin-vm.test.js tests/admin-ui-contract.test.js tests/admin-ui-behavior.test.js`

Expected: PASS and generated source stays deterministic.

- [ ] **Step 7: Commit**

```bash
git add staff-apps-script/AdminService.gs staff-apps-script/Admin.html staff-apps-script/AdminScript.html scripts/build-internal-mutation-service.mjs apps-script/InternalMutationService.gs tests/apps-script-admin-vm.test.js tests/admin-ui-contract.test.js tests/admin-ui-behavior.test.js
git commit -m "feat: configure check-ins per session"
```

### Task 3: Project checkpoint status to authenticated staff

**Files:**
- Modify: `staff-apps-script/AttendanceService.gs:90-230`
- Modify: `apps-script/InternalMutationService.gs:110-150,360-430`
- Modify: `scripts/build-internal-mutation-service.mjs`
- Test: `tests/apps-script-staff-route-vm.test.js`
- Test: `tests/apps-script-attendance-vm.test.js`

**Interfaces:**
- Produces each staff session as `{sessionId,title,checkInMode,checkpoints}`.
- Each checkpoint is `{checkpointId,label,status,checkedInAt,checkedInBy}`.
- Blank legacy attendance checkpoint IDs compare as `checkpoint-1`.

- [ ] **Step 1: Write failing projection tests**

Create a four-checkpoint manual session with attendance already stored for checkpoints 1 and 3. Assert the staff ticket returns all four in order, normalizes empty labels, and marks only 1 and 3 completed. Add a legacy blank checkpoint row and assert it completes checkpoint 1.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js`

Expected: FAIL because staff sessions have no checkpoint policy or state.

- [ ] **Step 3: Implement checkpoint projection helpers**

Add a shared generated-backend helper that creates stable IDs with:

```js
function checkpointId_(index) { return 'checkpoint-' + (index + 1); }
```

Project only attendance belonging to the resolved registration, event, and session. Never expose other participants or dynamic answers.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node scripts/build-internal-mutation-service.mjs`

Run: `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js`

Expected: PASS with the legacy case mapped to checkpoint 1.

- [ ] **Step 5: Commit**

```bash
git add staff-apps-script/AttendanceService.gs scripts/build-internal-mutation-service.mjs apps-script/InternalMutationService.gs tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js
git commit -m "feat: expose protected checkpoint status"
```

### Task 4: Enforce manual and automatic checkpoint mutations

**Files:**
- Modify: `apps-script/InternalMutationService.gs:360-440`
- Modify: `scripts/build-internal-mutation-service.mjs`
- Test: `tests/apps-script-attendance-vm.test.js`
- Test: `tests/production-mutation-integration.test.js`

**Interfaces:**
- `staff.checkIn` accepts optional `checkpointId` only for session/manual mode.
- Automatic mode ignores a submitted checkpoint and selects the first incomplete checkpoint under the public script lock.
- Success returns `{status:'checked_in',sessionId,checkpointId,checkpointLabel,checkedInAt,checkpoints}`.

- [ ] **Step 1: Write failing manual-mode mutation tests**

Assert a manual request for `checkpoint-2` writes exactly one row with the stable ID and normalized label. Repeating the same checkpoint returns `ALREADY_CHECKED_IN`; checkpoint 3 remains available.

- [ ] **Step 2: Write failing automatic and concurrency tests**

Assert consecutive automatic requests write checkpoints 1, 2, and 3; the fourth returns `ALL_CHECK_INS_COMPLETE`. Serialize two simultaneous requests and assert they commit different checkpoints rather than both choosing checkpoint 1.

- [ ] **Step 3: Write failing authorization and isolation tests**

Assert unknown checkpoint IDs, manual mode without a checkpoint, unregistered sessions, event-level disabled mode, closed windows, inactive tickets, and unauthorized staff write no row. Assert one session's checkpoint never satisfies another session.

- [ ] **Step 4: Run focused tests and verify RED**

Run: `node --test tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js`

Expected: FAIL because duplicate identity is currently only `(registrationId,eventId,sessionId)`.

- [ ] **Step 5: Implement the locked checkpoint mutation**

Within the existing public backend lock:

1. Normalize the event-level and session-level modes.
2. Resolve eligible checkpoints.
3. Treat legacy blank checkpoint IDs as `checkpoint-1` during duplicate checks.
4. Validate the manual checkpoint or select the first incomplete automatic checkpoint.
5. Append the nine-column attendance row.
6. Return refreshed checkpoint state.

Add fixed public codes and Chinese messages for `CHECKPOINT_REQUIRED`, `CHECKPOINT_INVALID`, and `ALL_CHECK_INS_COMPLETE` without reflecting internal error details.

- [ ] **Step 6: Generate and verify GREEN**

Run: `node scripts/build-internal-mutation-service.mjs`

Run: `node --test tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js`

Expected: PASS including serialized concurrency tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/build-internal-mutation-service.mjs apps-script/InternalMutationService.gs tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: record multiple session check-ins"
```

### Task 5: Add clear staff and administrator checkpoint interfaces

**Files:**
- Modify: `staff-apps-script/StaffCheckIn.html:45-160`
- Modify: `staff-apps-script/AdminScript.html:380-400`
- Test: `tests/ticket-attendance-behavior.test.js`
- Test: `tests/admin-ui-behavior.test.js`

**Interfaces:**
- Manual sessions render one button per incomplete checkpoint.
- Automatic sessions render one `签到下一次` button and display the next label.
- Every request carries the currently scanned token and selected session; manual requests also carry `checkpointId`.

- [ ] **Step 1: Write failing staff UI tests**

Assert scanning renders registered sessions only, displays completed checkpoint times, disables completed buttons, and sends one manual checkpoint ID. Assert automatic mode sends no checkpoint ID, disables its button while pending, then rerenders returned state.

- [ ] **Step 2: Write failing feedback and administrator record tests**

Assert exact pending/success/failure messages and that administrator attendance rows display `第 2 次签到 · checkpoint-2` or the configured label. Ensure repeated clicks send one request.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node --test tests/ticket-attendance-behavior.test.js tests/admin-ui-behavior.test.js`

Expected: FAIL because the current UI has only one check-in action per session.

- [ ] **Step 4: Implement staff checkpoint rendering**

Render checkpoint labels using text nodes only. For manual mode attach the checkpoint ID to the button dataset. For automatic mode show the next incomplete checkpoint but let the server select it. Replace controls with the returned server projection after success.

- [ ] **Step 5: Implement administrator attendance display**

Display the configured checkpoint label, stable ID, server time, and masked staff identity in the existing attendance list without exposing Sheet links or participant answers.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test tests/ticket-attendance-behavior.test.js tests/admin-ui-behavior.test.js`

Expected: PASS with pending controls and duplicate prevention.

- [ ] **Step 7: Commit**

```bash
git add staff-apps-script/StaffCheckIn.html staff-apps-script/AdminScript.html tests/ticket-attendance-behavior.test.js tests/admin-ui-behavior.test.js
git commit -m "feat: add multi-check-in staff controls"
```

### Task 6: Bundle, verify, deploy, and smoke-test

**Files:**
- Generate: `source-bundles/public-backend.txt`
- Generate: `source-bundles/staff-admin.txt`
- Generate: `staff-apps-script/SourceBundles.gs`
- Modify: `apps-script/DEPLOYMENT.md`
- Test: all `tests/*.test.js`

**Interfaces:**
- Produces deployable public and staff source bundles containing the same checkpoint schema, policies, and UI.
- Keeps the current public and staff deployment URLs unchanged while publishing new immutable versions.

- [ ] **Step 1: Update deployment documentation**

Document the non-destructive two-column attendance migration, the old-session default, per-session administrator settings, and rollback: redeploy the prior immutable version without deleting the new columns or rows.

- [ ] **Step 2: Regenerate all bundles**

Run: `node scripts/build-internal-mutation-service.mjs`

Run: `node scripts/build-admin-source-bundles.mjs`

- [ ] **Step 3: Run the complete verification suite**

Run with the approved public and staff URLs:

```powershell
$env:PUBLIC_APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfycbwn7Y8B791vLgvkKOJ4sjtODBj8HlH-UgSTNg1GkyH4VM1Pcb0JMQlXWX_fGqs6FeWW/exec'
$env:STAFF_APPS_SCRIPT_URL='https://script.google.com/macros/s/AKfycbw6zkdb6W7VNq41WhvyTLTZBZQdqZfkHrSy8XbcfNQRm0E4qLhkHKMltYO60MzLWldP/exec'
npm.cmd run check
```

Expected: all tests pass, bundle check passes, and the public package checker reports only approved participant files.

- [ ] **Step 4: Publish new public and staff Apps Script versions**

Update the public backend generated files and the protected staff files, preserving script properties and deployment IDs. The staff `代码.gs` must contain the complete executable concatenation in this order: `Repository.gs`, `InternalClient.gs`, `AttendanceService.gs`, `AdminService.gs`, `Code.gs`; never replace it with `AdminService.gs` alone.

- [ ] **Step 5: Smoke-test both modes without changing real participant history**

Use a dedicated unused test activity/session. Confirm manual checkpoint selection, automatic progression, completed-state feedback, and administrator history. If no safe test activity exists, verify the deployed UI and endpoint contracts without submitting a real check-in.

- [ ] **Step 6: Run the complete suite again after deployment**

Run: `npm.cmd run check` with both live deployment URLs.

Expected: all tests pass and both live pages load without `doGet` or authorization-surface regressions.

- [ ] **Step 7: Commit and push the feature branch**

```bash
git add source-bundles/public-backend.txt source-bundles/staff-admin.txt staff-apps-script/SourceBundles.gs apps-script/DEPLOYMENT.md
git commit -m "docs: deploy configurable session check-ins"
git push origin feature/stable-event-ticket-system
```
