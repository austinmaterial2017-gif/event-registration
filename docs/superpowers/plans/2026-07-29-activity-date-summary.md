# Activity Date Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a correct single date or date range on every participant activity card with configured session times.

**Architecture:** Session mutations persist a safe earliest/latest timestamp summary in the existing event policy. The public catalog exposes those two timestamps, and a focused participant formatter produces the displayed date without opening every private activity Sheet.

**Tech Stack:** Google Apps Script, browser JavaScript modules, Node.js test runner, GitHub Pages.

## Global Constraints

- Keep the participant activity list to one public request.
- Do not expose private Sheet identifiers or participant data.
- Use `Asia/Kuala_Lumpur` for date display.
- Missing or invalid summaries must display `日期待定`.

---

### Task 1: Participant date formatter

**Files:**
- Modify: `public/js/activity-ticket-view.js`
- Test: `tests/activity-ticket-view.test.js`

**Interfaces:**
- Consumes: `activity.eventStartsAt` and `activity.eventEndsAt` ISO strings.
- Produces: `buildActivityTicketView(...).dateLabel`.

- [ ] **Step 1: Write the failing formatter tests**

Add literal expectations for:

```js
assert.equal(buildActivityTicketView({}, false, "").dateLabel, "日期待定");
assert.equal(buildActivityTicketView({
  eventStartsAt: "2026-08-16T02:00:00.000Z",
  eventEndsAt: "2026-08-16T04:00:00.000Z"
}, false, "").dateLabel, "2026年8月16日");
assert.equal(buildActivityTicketView({
  eventStartsAt: "2026-08-16T02:00:00.000Z",
  eventEndsAt: "2026-08-18T04:00:00.000Z"
}, false, "").dateLabel, "2026年8月16日－2026年8月18日");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/activity-ticket-view.test.js`

Expected: FAIL because the current view reads the nonexistent `activity.date`.

- [ ] **Step 3: Implement the formatter**

Add a small formatter that parses both timestamps, uses:

```js
new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Kuala_Lumpur",
  year: "numeric",
  month: "long",
  day: "numeric"
})
```

Return one date when both formatted dates match, a range when they differ, and `日期待定` when either required value is invalid.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/activity-ticket-view.test.js`

Expected: PASS.

### Task 2: Persist and expose the safe session date summary

**Files:**
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `apps-script/Code.gs`
- Test: `tests/apps-script-admin-vm.test.js`
- Test: `tests/apps-script-registration-vm.test.js`

**Interfaces:**
- Produces policy fields `eventStartsAt` and `eventEndsAt`.
- Public summary returns those fields as ISO strings or empty strings.

- [ ] **Step 1: Write the failing Apps Script tests**

Create an activity with multiple sessions and assert that the public `listEvents` projection contains the earliest start and latest end. Edit a session and assert the summary changes.

- [ ] **Step 2: Run focused Apps Script tests and verify RED**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/apps-script-registration-vm.test.js
```

Expected: FAIL because session mutations do not yet maintain summary fields.

- [ ] **Step 3: Implement authoritative summary refresh**

After writing a session, read that activity's session rows, keep rows with valid start and end timestamps where end is after start, and store:

```js
policy.eventStartsAt = new Date(Math.min.apply(null, starts)).toISOString();
policy.eventEndsAt = new Date(Math.max.apply(null, ends)).toISOString();
```

Set both to empty strings when no valid timed sessions remain. Mirror the mutation logic in the staff source used by local and bundle tests.

- [ ] **Step 4: Expose the summary**

Extend `publicEventSummary_` with:

```js
eventStartsAt: publicText_(policy.eventStartsAt),
eventEndsAt: publicText_(policy.eventEndsAt)
```

- [ ] **Step 5: Run focused Apps Script tests and verify GREEN**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/apps-script-registration-vm.test.js
```

Expected: PASS.

### Task 3: Build, verify, and deploy

**Files:**
- Regenerate: `source-bundles/public-backend.txt`
- Regenerate: `source-bundles/staff-admin.txt`
- Regenerate: `staff-apps-script/SourceBundles.gs`
- Publish: `public/js/activity-ticket-view.js`

**Interfaces:**
- Public Apps Script continues using the existing deployment URL.
- GitHub Pages continues using the existing participant URL.

- [ ] **Step 1: Rebuild generated bundles**

Run:

```powershell
node scripts/build-internal-mutation-service.mjs
node scripts/build-admin-source-bundles.mjs
```

- [ ] **Step 2: Run the full verification suite**

Run `npm.cmd run check` with the approved public and staff deployment URLs.

Expected: all tests, bundle checks, and public-package checks pass.

- [ ] **Step 3: Deploy both required surfaces**

Publish a new public Apps Script version containing the summary fields. Publish the participant assets to the GitHub Pages branch without exposing staff source.

- [ ] **Step 4: Verify the live symptom**

Open the participant homepage and confirm:

- configured same-day sessions show one date;
- configured cross-date sessions show a range;
- activities without timed sessions still show `日期待定`.

- [ ] **Step 5: Commit and push**

Commit only tracked project changes and push the implementation branch and the Pages publishing branch.
