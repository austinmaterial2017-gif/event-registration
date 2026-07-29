# Safe Session Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clear, safe session removal controls for both activity drafts and generated activities.

**Architecture:** Draft removal updates the existing draft document in the administrator browser. Generated-session removal uses a new authorized `admin.deleteSession` mutation; the server refuses permanent deletion when registration, seat, or attendance dependencies exist. A successful delete removes the session policy, recalculates the public activity date summary, and records an audit entry.

**Tech Stack:** Google Apps Script V8, vanilla JavaScript administrator UI, Google Sheets persistence, Node.js built-in test runner.

## Global Constraints

- Draft sessions may be removed directly.
- Generated sessions may be permanently deleted only when no registration, seat, or attendance row references them.
- Related participant, ticket, seat, registration, and attendance rows must never be deleted by this feature.
- Destructive actions require explicit confirmation and visible pending/success/error feedback.
- Successful deletion recalculates the activity date range.
- The protected administrator route must not expose private Sheet identifiers.

---

### Task 1: Server-Side Generated Session Removal

**Files:**
- Modify: `tests/apps-script-admin-vm.test.js`
- Modify: `staff-apps-script/AdminService.gs`
- Generate: `apps-script/InternalMutationService.gs`

**Interfaces:**
- Consumes: `{ eventId: string, sessionId: string, confirm: true }`
- Produces: `deleteAdminSession_(payload, actor)` and protected action `admin.deleteSession`
- Returns: `{ eventId: string, sessionId: string, deleted: true }`

- [ ] **Step 1: Write failing backend tests**

Add tests that call `deleteAdminSession` through the real Apps Script VM harness and assert:

```js
assert.equal(result.ok, true);
assert.deepEqual(result.data, {
  eventId: "event-1",
  sessionId: "session-unused",
  deleted: true
});
assert.equal(rows(harness.sheets["场次"]).some(
  (row) => row.sessionId === "session-unused"
), false);
```

Add separate fixtures proving deletion returns `CONFLICT` when the session ID appears in `报名项目.sessionIds`, `座位.sessionId`, or `签到记录.sessionId`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js
```

Expected: FAIL because `deleteAdminSession` / `admin.deleteSession` does not exist.

- [ ] **Step 3: Implement the protected mutation**

Add the public staff wrapper:

```js
function deleteAdminSession(payload) {
  return runAdminService_(function() {
    var actor = requireAuthorizedAdminSession_();
    var result = invokeInternalBackend_('admin.deleteSession', payload || {}, actor);
    if (!result.ok) adminError_(result.code);
    return result.data;
  });
}
```

Add `admin.deleteSession` to the internal action allowlist and dispatcher. Implement `deleteAdminSession_` under the script lock:

1. Require object payload, non-empty `eventId` and `sessionId`, and `confirm === true`.
2. Resolve the event Sheet and matching session row.
3. Reject with `CONFLICT` when any registration, seat, or attendance row references the session.
4. Delete only the matching session Sheet row.
5. Remove `settings.registration.events[eventId].sessions[sessionId]`.
6. Recalculate the event date summary and save settings.
7. Append `DELETE_SESSION` to the audit Sheet.
8. Return the safe result object.

- [ ] **Step 4: Regenerate the internal service and verify GREEN**

Run:

```powershell
node scripts/build-internal-mutation-service.mjs
node --test tests/apps-script-admin-vm.test.js
```

Expected: all focused backend tests pass.

### Task 2: Administrator Draft and Generated Session Buttons

**Files:**
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/production-mutation-integration.test.js`
- Modify: `tests/admin-ui-contract.test.js`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `staff-apps-script/AdminService.gs`

**Interfaces:**
- Consumes: selected draft/session item and its action button
- Produces: `deleteDraftSession_(item, button)` and `deleteGeneratedSession_(item, button)`

- [ ] **Step 1: Write failing UI behavior tests**

Exercise the real administrator script and assert:

```js
sessionDeleteButton.dispatch("click");
assert.equal(ui.confirmations.length, 1);
assert.equal(ui.calls.at(-1).method, "saveAdminDraft");
assert.equal(ui.calls.at(-1).payload.draft.sessions.length, 1);
```

For a generated session, assert the button forwards:

```js
{
  eventId: "event-1",
  sessionId: "session-1",
  confirm: true
}
```

and uses visible pending/success feedback through `runButtonAction_`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/admin-ui-behavior.test.js tests/production-mutation-integration.test.js tests/admin-ui-contract.test.js
```

Expected: FAIL because the session delete buttons and `deleteAdminSession` runner method do not exist.

- [ ] **Step 3: Add the administrator controls**

In `renderDashboard`, append an actions container containing **编辑场次** and **删除场次**. Draft deletion filters `state.draftDocument.sessions`, clears a matching draft seat-plan `sessionId`, and persists the draft. Generated deletion confirms the session title, calls `runner.deleteAdminSession(payload)`, shows **正在删除场次…**, then **场次已删除。**, resets the editor if necessary, and reloads the dashboard.

When the backend returns `CONFLICT`, the existing error channel must explain that related records exist and instruct the administrator to set the session status to `inactive`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/admin-ui-behavior.test.js tests/production-mutation-integration.test.js tests/admin-ui-contract.test.js
```

Expected: all focused UI and integration tests pass.

### Task 3: Bundles, Full Verification, and Publication

**Files:**
- Generate: `source-bundles/public-backend.txt`
- Generate: `source-bundles/staff-admin.txt`
- Generate: `staff-apps-script/SourceBundles.gs`

**Interfaces:**
- Consumes: verified public/staff source trees
- Produces: synchronized paste-ready bundles and deployed Google Apps Script versions

- [ ] **Step 1: Rebuild bundles**

Run:

```powershell
node scripts/build-admin-source-bundles.mjs
```

- [ ] **Step 2: Run complete verification**

Run:

```powershell
$env:PUBLIC_APPS_SCRIPT_WEB_APP_URL='https://script.google.com/macros/s/AKfycbwn7Y8B791vLgvkKOJ4sjtODBj8HlH-UgSTNg1GkyH4VM1Pcb0JMQlXWX_fGqs6FeWW/exec'
$env:STAFF_APPS_SCRIPT_WEB_APP_URL='https://script.google.com/macros/s/AKfycbw6zkdb6W7VNq41WhvyTLTZBZQdqZfkHrSy8XbcfNQRm0E4qLhkHKMltYO60MzLWldP/exec'
npm.cmd run check
```

Expected: all tests, bundle checks, and public privacy checks pass.

- [ ] **Step 3: Commit and publish**

Commit the source, tests, and generated bundles. Push `feature/stable-event-ticket-system`. Update and deploy both the public backend and staff administrator Apps Script projects while preserving their existing deployment URLs.

- [ ] **Step 4: Verify the live administrator UI**

Open the deployed administrator URL, select an activity, and confirm each session card exposes both **编辑场次** and **删除场次**. Delete an unused test session only if one exists and verify the success feedback and refreshed session list; otherwise stop before changing real event data and rely on the complete automated suite.
