# Registration Timer and Check-in Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable full-registration countdown and per-event check-in modes without changing existing registration or attendance history.

**Architecture:** Store both settings in the existing per-event registration policy, project them through the existing safe public event model, and enforce check-in modes in the signed internal mutation service. Keep the countdown as a focused public-browser module that owns formatting and one-shot expiry cleanup while the existing registration page remains responsible for selections and submission.

**Tech Stack:** Google Apps Script V8, vanilla JavaScript ES modules, HTML/CSS, Node.js built-in test runner.

## Global Constraints

- `registrationTimeLimitMinutes` is an integer at least 0; `0` disables the attempt timer.
- `checkInMode` is exactly `session`, `event`, or `none`.
- New and legacy activities default to 5 minutes and `session`.
- Countdown time derives from the server-time offset and never stores participant details.
- Expiry releases browser-owned seat holds, clears the form, and returns to `index.html?notice=registration-expired`.
- `none` mode retains read-only QR verification but rejects attendance writes.
- Existing registration, ticket, seat, and attendance rows are never deleted or rewritten.

---

### Task 1: Event policy and administrator controls

**Files:**
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `apps-script/Code.gs`
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `tests/apps-script-admin-vm.test.js`
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/admin-ui-contract.test.js`

**Interfaces:**
- Produces: admin/public event fields `registrationTimeLimitMinutes: number` and `checkInMode: "session"|"event"|"none"`.
- Consumes: existing `settings.registration.events[eventId]` event policy.

- [ ] **Step 1: Write failing policy and administrator tests**

Add assertions that saving `{ registrationTimeLimitMinutes: 5, checkInMode: "event" }` persists and projects both values, rejects `-1`, `1.5`, and unknown modes, and that the administrator form emits numeric `registrationTimeLimitMinutes`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/apps-script-admin-vm.test.js tests/admin-ui-behavior.test.js tests/admin-ui-contract.test.js`

Expected: FAIL because the event policy and controls do not contain the new fields.

- [ ] **Step 3: Implement policy persistence and safe projections**

In `saveAdminEvent_`, normalize the request with:

```js
policy.registrationTimeLimitMinutes = adminNonNegativeInteger_(
  adminField_(request, 'registrationTimeLimitMinutes',
    policy.registrationTimeLimitMinutes, 5)
);
var checkInMode = String(
  adminField_(request, 'checkInMode', policy.checkInMode, 'session')
).toLowerCase();
if (!{ session: true, event: true, none: true }[checkInMode]) {
  adminError_('INVALID_REQUEST');
}
policy.checkInMode = checkInMode;
```

Project the same normalized defaults from `adminEventProjection_` and `publicEventSummary_`. Include the fields in draft validation and finalization.

- [ ] **Step 4: Add administrator inputs and exact validation**

Add a non-negative integer input named `registrationTimeLimitMinutes`, a three-option select named `checkInMode`, payload conversion to `Number`, editor population, new-activity defaults, and messages:

```text
报名作答限时必须是 0 或正整数（0 代表不限时）。
签到模式无效，请重新选择。
```

Rename the session field label to `分组规则（选填）` and add help text: `相同文字代表同一组，参加者默认最多选 1 场；没有限制请留空。`

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/apps-script-admin-vm.test.js tests/admin-ui-behavior.test.js tests/admin-ui-contract.test.js`

Expected: PASS.

Commit: `feat: add registration timer and check-in settings`

---

### Task 2: Public registration attempt countdown

**Files:**
- Create: `public/js/registration-attempt-timer.js`
- Modify: `public/register.html`
- Modify: `public/js/register-page.js`
- Modify: `public/js/index-page.js`
- Modify: `public/css/app.css`
- Create: `tests/registration-attempt-timer.test.js`
- Modify: `tests/participant-flow.test.js`

**Interfaces:**
- Produces: `createRegistrationAttemptTimer({ limitMinutes, serverNow, onTick, onExpire })` returning `{ start(), stop(), remainingMs() }`.
- Consumes: public event `registrationTimeLimitMinutes`, existing server offset, existing seat hold release action.

- [ ] **Step 1: Write failing timer tests**

Cover zero-disabled timer, `05:00` initial formatting, `00:59` warning state, one-shot expiry, stopped timer ignoring later ticks, and countdown based on supplied server time.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/registration-attempt-timer.test.js tests/participant-flow.test.js`

Expected: FAIL because the timer module and visible timer panel do not exist.

- [ ] **Step 3: Implement the isolated timer**

The timer stores only an absolute deadline and calls:

```js
onTick({
  remainingMs,
  text: formatAttemptCountdown(remainingMs),
  urgent: remainingMs <= 60_000
});
```

It invokes `onExpire` exactly once at zero and schedules updates at the next whole-second boundary.

- [ ] **Step 4: Integrate expiry cleanup**

After event data loads, start the timer. On expiry:

1. Disable all registration controls.
2. Stop the seat-hold refresh timer.
3. Call the existing release API for every hold owned by the current browser attempt with `Promise.allSettled`.
4. Reset session, seat, answer, and review state.
5. Remove only registration-attempt local state.
6. Navigate to `index.html?notice=registration-expired`.

Stop the timer before successful ticket navigation.

- [ ] **Step 5: Add visible UI and return notice**

Add a sticky countdown card below the registration hero, hidden when limit is 0. Use large tabular digits, `aria-live="polite"`, and a red urgent state during the final minute. `index-page.js` reads the fixed notice value and displays `报名时间已结束，请重新进入。`

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/registration-attempt-timer.test.js tests/participant-flow.test.js tests/public-markup-contract.test.js`

Expected: PASS.

Commit: `feat: add timed registration attempts`

---

### Task 3: Signed backend check-in mode enforcement

**Files:**
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `apps-script/AttendanceService.gs`
- Modify: `tests/apps-script-attendance-vm.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes: event policy `checkInMode`.
- Produces: safe ticket/staff projection `checkInMode` and check-in result `{ status, sessionId, checkedInAt, checkInMode }`.
- Uses reserved event attendance session ID `__EVENT__` only for new event-level attendance rows.

- [ ] **Step 1: Write failing mode tests**

Test:

- `session` requires a registered session and permits each selected session once.
- `event` ignores client session selection, writes `sessionId: "__EVENT__"`, and returns already checked in on a duplicate.
- `none` returns `CHECK_IN_DISABLED` without appending a row.
- Existing per-session attendance remains readable after switching modes.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js`

Expected: FAIL because every check-in currently requires a session ID.

- [ ] **Step 3: Enforce the mode inside the signed mutation**

Read the authoritative event policy after resolving the ticket route. Normalize missing values to `session`. For `event`, replace the requested session with `__EVENT__`; for `none`, fail before any attendance write. Preserve current locking, duplicate detection, Google-session allowlist, and audit behavior.

- [ ] **Step 4: Project mode safely**

Expose only the fixed mode string to staff ticket lookup and read-only verification. Add the public message mapping:

```js
CHECK_IN_DISABLED: '此活动不需要签到。'
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/apps-script-attendance-vm.test.js tests/production-mutation-integration.test.js`

Expected: PASS.

Commit: `feat: support event and optional check-in`

---

### Task 4: Staff check-in interface

**Files:**
- Modify: `staff-apps-script/StaffCheckIn.html`
- Modify: `tests/staff-security-contract.test.js`
- Modify: `tests/ticket-attendance-behavior.test.js`

**Interfaces:**
- Consumes: staff ticket `checkInMode` and registered `sessions`.
- Calls: existing protected `checkIn({ token, sessionId })`.

- [ ] **Step 1: Write failing staff UI tests**

Assert that:

- `session` shows the session selector and button text `确认本场签到`.
- `event` hides the selector and uses `确认活动签到`.
- `none` hides the form and displays `此活动不需要签到；二维码仍可用于验票。`

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/staff-security-contract.test.js tests/ticket-attendance-behavior.test.js`

Expected: FAIL because the current UI always requires a session.

- [ ] **Step 3: Render mode-specific controls**

Keep one protected form. Send a selected session only for `session`; send an empty session for `event`; never call the mutation for `none`. Preserve pending-button feedback and duplicate submission blocking.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/staff-security-contract.test.js tests/ticket-attendance-behavior.test.js`

Expected: PASS.

Commit: `feat: adapt staff check-in to event policy`

---

### Task 5: Bundles, regression, deployment, and production verification

**Files:**
- Regenerate: `staff-apps-script/SourceBundles.gs`
- Regenerate: `source-bundles/staff-admin.txt`
- Regenerate: `source-bundles/public-backend.txt`
- Update cache-bust query strings in `public/index.html`, `public/register.html`, `public/js/index-page.js`, and `public/js/register-page.js`.

**Interfaces:**
- Deploys the existing public backend, staff/admin web app, and GitHub Pages participant site without changing their permanent URLs.

- [ ] **Step 1: Regenerate source bundles**

Run: `node scripts/build-admin-source-bundles.mjs`

- [ ] **Step 2: Run complete verification**

Run: `npm.cmd run check`

Expected: all tests pass, bundle check passes, and public-package check passes.

- [ ] **Step 3: Commit generated artifacts**

Commit: `build: refresh timer and check-in bundles`

- [ ] **Step 4: Update both Apps Script deployments**

Deploy a new public backend version and a new staff/admin version at their existing deployment IDs. Paste editor contents using full-selection replacement to avoid stale suffixes.

- [ ] **Step 5: Publish only the participant-safe files**

Push the approved public package to the existing GitHub Pages repository. Do not push the private staff branch, internal backend secrets, administrator files, or Sheet identifiers.

- [ ] **Step 6: Verify production**

Verify:

- Administrator can save 5 minutes and each of the three modes.
- Registration page displays the second-by-second timer.
- Zero hides the timer.
- Expiry returns to the event list with the notice.
- Staff UI changes for all three check-in modes.
- Participant site contains no private identifiers or staff source.
