# Confirmed Event Sheet Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save new activities as private registry drafts and create exactly one private activity Sheet only after the administrator explicitly confirms generation.

**Architecture:** Add one private registry sheet named `活动草稿` whose rows contain validated draft JSON. New administrator RPCs save a complete draft document and atomically promote it into the existing per-activity Sheet model. Existing generated activities and every participant, ticket, seat, and check-in path remain unchanged.

**Tech Stack:** Google Apps Script V8, Google Sheets/Drive, vanilla HTML/CSS/JavaScript, Node.js built-in test runner.

## Global Constraints

- A normal draft save must not call `SpreadsheetApp.create`.
- Drafts must never appear in `活动目录` and are therefore invisible to public participant APIs.
- Finalization requires `{ draftId, confirm: true }`, is serialized by the public backend lock, and is idempotent for repeated requests.
- A failed finalization keeps the draft and leaves no visible catalog entry.
- A successful finalization creates an activity with status `draft`; opening registration remains a separate administrator action.
- Draft deletion requires confirmation and never touches an activity Sheet.
- Generated activity deletion is allowed only when registrations, ticket routes, and check-ins are all empty; otherwise only end/archive remains available.
- Existing generated activities continue using their current private activity Sheets.
- No administrator must paste code, change Apps Script properties, or grant new scopes per activity.

---

### Task 1: Private Draft Repository

**Files:**
- Modify: `apps-script/Repository.gs`
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `tests/apps-script-admin-vm.test.js`
- Modify: `tests/apps-script-contract.test.js`

**Interfaces:**
- Produces: registry sheet `活动草稿` with exact headers `draftId`, `payload`, `createdBy`, `createdAt`, `updatedAt`, `finalizedEventId`.
- Produces: `readActivityDraft_(registry, draftId) -> object|null`.
- Produces: `writeActivityDraft_(registry, draft) -> object`.
- Produces: `validateActivityDraftDocument_(value) -> normalized draft document`.
- Consumes: existing `readAdminRows_`, `writeAdminRow_`, `getRequiredSheet_`, and script lock transaction journal.

- [ ] **Step 1: Write failing repository and schema tests**

Add tests that initialize a fresh registry and assert:

```js
assert.deepEqual(
  Array.from(harness.sourceSheets["活动草稿"].rows[0]),
  ["draftId", "payload", "createdBy", "createdAt", "updatedAt", "finalizedEventId"]
);
assert.equal(records(harness.sourceSheets["活动目录"]).length, 0);
```

Add validation cases for a complete document shaped as:

```js
{
  draftId: "draft-1",
  event: {
    title: "教育讲座",
    description: "",
    status: "draft",
    opensAt: "",
    closesAt: "",
    location: "",
    selectionMode: "all",
    minChoices: 0,
    maxChoices: 0,
    seatMode: "none",
    seatZones: []
  },
  sessions: [],
  seatPlan: { mode: "none", zones: [] },
  questions: []
}
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node --test tests/apps-script-contract.test.js tests/apps-script-admin-vm.test.js
```

Expected: failure because `活动草稿` and the draft repository functions do not exist.

- [ ] **Step 3: Add the exact draft schema and repository helpers**

Add to `SHEET_DEFINITIONS` and `REGISTRY_SHEET_NAMES_`:

```js
'活动草稿': [
  'draftId', 'payload', 'createdBy', 'createdAt', 'updatedAt', 'finalizedEventId'
]
```

Implement strict JSON parsing, duplicate-ID rejection, maximum serialized size enforcement below the Google Sheets single-cell limit, and normalized arrays for `sessions`, `seatPlan.zones`, and `questions`. Do not accept `spreadsheetId`, `sheetUrl`, ticket data, participant data, or attendance data in a draft.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the command from Step 2. Expected: all selected tests pass.

- [ ] **Step 5: Commit the repository unit**

```powershell
git add apps-script/Repository.gs apps-script/InternalMutationService.gs tests/apps-script-admin-vm.test.js tests/apps-script-contract.test.js
git commit -m "feat: add private activity draft repository"
```

### Task 2: Draft Save and Idempotent Finalization RPCs

**Files:**
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `apps-script/InternalGateway.gs`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `tests/apps-script-admin-vm.test.js`
- Modify: `tests/apps-script-staff-route-vm.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Produces: internal action `admin.saveDraft`.
- Produces: internal action `admin.finalizeDraft`.
- Produces: staff web functions `saveAdminDraft(payload)` and `finalizeAdminDraft(payload)`.
- Produces: staff web functions `deleteAdminDraft(payload)` and `deleteEmptyAdminEvent(payload)`.
- Returns from save:

```js
{ draftId, draft, nextStep: "sessions" | "seats" | "questions" | "confirm" }
```

- Returns from finalization:

```js
{ draftId, eventId, sheetUrl, status: "draft", alreadyFinalized: boolean }
```

- Consumes: Task 1 draft repository and existing `createActivitySpreadsheet_`, `initializeEventSpreadsheet_`, `upsertActivityCatalogEntry_`, transaction journal, and script lock.

- [ ] **Step 1: Write failing mutation tests**

Cover these exact cases:

```js
const saved = harness.context.saveAdminDraft({ event: { title: "A", status: "draft" } });
assert.equal(saved.ok, true);
assert.equal(harness.createdSpreadsheets.length, 0);
assert.equal(records(harness.sourceSheets["活动目录"]).length, 0);

const generated = harness.context.finalizeAdminDraft({
  draftId: saved.data.draftId,
  confirm: true
});
assert.equal(generated.ok, true);
assert.equal(harness.createdSpreadsheets.length, 1);
assert.equal(records(harness.sourceSheets["活动目录"]).length, 1);
assert.equal(records(harness.eventSheets["活动"])[0].status, "draft");
```

Also assert that `confirm: false`, unknown drafts, malformed JSON, cross-draft IDs, catalog-write failure, event-write failure, and repeated finalization all fail safely or return the same finalized activity without a second Sheet.

Add deletion tests:

```js
assert.equal(harness.context.deleteAdminDraft({ draftId, confirm: true }).ok, true);
assert.equal(records(harness.sourceSheets["活动草稿"]).length, 0);
```

For generated activities, assert deletion succeeds only when the event Sheet has no registration, ticket-route, or check-in rows; successful deletion removes the exact catalog row and moves only that activity Sheet to Drive trash. Any history row must return a fixed refusal and leave the catalog, Sheet, and history unchanged.

- [ ] **Step 2: Run the focused mutation tests and verify they fail**

Run:

```powershell
node --test tests/apps-script-admin-vm.test.js tests/apps-script-staff-route-vm.test.js tests/production-mutation-integration.test.js
```

Expected: failure because the two RPCs and actions are not defined.

- [ ] **Step 3: Implement draft saving**

Route `admin.saveDraft` through the existing authenticated staff-to-public signed gateway. Under the public script lock:

1. Normalize the complete draft document.
2. Generate an opaque `draft-<uuid>` ID only when no draft ID is supplied.
3. Preserve `createdBy` and `createdAt` on updates.
4. Write one registry row and an administrator audit row.
5. Return the normalized document and deterministic `nextStep`.

- [ ] **Step 4: Implement atomic finalization**

Route `admin.finalizeDraft` through the same gateway. Under the public script lock:

1. Require `confirm === true`.
2. Read and revalidate the draft.
3. If `finalizedEventId` already maps to one valid catalog row, return that event with `alreadyFinalized: true`.
4. Create and initialize one private activity Sheet.
5. Write the event with forced status `draft`, then sessions, generated seats, and questions.
6. Publish the catalog row last.
7. Store `finalizedEventId` in the draft row only after publication.
8. On any failure, use the existing transaction compensation to restore the catalog and draft; trash a newly created but unpublished Sheet when safe, otherwise leave it unlisted and record a recovery audit.

Implement `deleteAdminDraft` under the same lock with exact draft-ID lookup and `confirm === true`. Implement `deleteEmptyAdminEvent` with exact route validation, an empty-history preflight across registrations, ticket routes, and check-ins, catalog removal before recoverable Drive trashing, and an audit record. A failed preflight performs no mutation.

- [ ] **Step 5: Run the focused mutation tests and verify they pass**

Run the command from Step 2. Expected: all selected tests pass.

- [ ] **Step 6: Commit the RPC unit**

```powershell
git add apps-script/InternalMutationService.gs apps-script/InternalGateway.gs staff-apps-script/AdminService.gs tests/apps-script-admin-vm.test.js tests/apps-script-staff-route-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: confirm activity sheet generation"
```

### Task 3: Guided Draft Administrator Interface

**Files:**
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/admin-ui-contract.test.js`

**Interfaces:**
- Consumes: `saveAdminDraft(payload)` and `finalizeAdminDraft(payload)` from Task 2.
- Produces: client state fields `selectedDraftId`, `draftDocument`, and `editorMode`.
- Produces: `getDraftNextStep_(draft) -> "#sessions" | "#seats" | "#questions" | "#events"`.
- Produces: button `#finalize-draft` with label `确认建立活动并生成数据表`.
- Produces: buttons `#delete-draft` and `#delete-empty-event` with separate confirmation copy.

- [ ] **Step 1: Write failing UI behavior tests**

Add DOM tests that assert:

```js
assert.equal(contextNode.textContent, "正在建立新活动草稿（尚未生成数据表）");
assert.equal(saveCalls[0].method, "saveAdminDraft");
assert.equal(finalizeCalls.length, 0);
```

Then cover automatic next-step behavior for:

```js
[
  [{ selectionMode: "all", seatMode: "none" }, "#sessions"],
  [{ selectionMode: "none", seatMode: "self" }, "#seats"],
  [{ selectionMode: "none", seatMode: "none" }, "#questions"]
]
```

Assert the finalization button is disabled during the request, repeated clicks produce one RPC, success reveals the returned Sheet link, and the activity remains `draft`.

Assert draft deletion removes only the selected draft and returns to the empty activity view. Assert generated deletion is shown only when the dashboard reports no registration, ticket, or check-in history; a refusal recommends “结束／归档” without clearing the selected activity.

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run:

```powershell
node --test tests/admin-ui-behavior.test.js tests/admin-ui-contract.test.js
```

Expected: failure because the draft mode, guided fields, and finalization button are absent.

- [ ] **Step 3: Add persistent activity context and progressive fields**

Update markup and styles so the context bar always says either:

```text
正在建立新活动草稿（尚未生成数据表）
```

or:

```text
正在设置：<活动名称>
```

Give conditional wrappers stable IDs:

```html
<div id="session-choice-fields">…</div>
<div id="seat-choice-fields">…</div>
```

Hide only irrelevant controls; never delete entered draft values.

- [ ] **Step 4: Switch new-activity forms to one complete draft document**

In draft mode, each event/session/seat/question save updates `state.draftDocument` and calls `saveAdminDraft`. After success, show a specific success notice and call `scrollToAdminSection_(getDraftNextStep_(draft))`. In generated-activity mode, preserve all existing `saveAdminEvent`, `saveAdminSession`, `saveAdminSeatPlan`, and `saveAdminQuestion` behavior.

- [ ] **Step 5: Add explicit finalization and separate opening**

Add a confirmation summary and the `#finalize-draft` button. Its handler must call:

```js
finalizeAdminDraft({ draftId: state.selectedDraftId, confirm: true })
```

On success, switch to generated-activity mode, select the returned `eventId`, show `数据表建立成功`, reveal `打开数据表`, and keep status `draft`. Do not call reopen/open automatically.

Add guarded deletion controls. Every delete button must show a second confirmation, disable while pending, and display either `草稿已删除` / `空活动已移到回收站` or the server refusal that historical activities can only be ended or archived.

- [ ] **Step 6: Run the focused UI tests and verify they pass**

Run the command from Step 2. Expected: all selected tests pass.

- [ ] **Step 7: Commit the administrator UI unit**

```powershell
git add staff-apps-script/Admin.html staff-apps-script/AdminScript.html tests/admin-ui-behavior.test.js tests/admin-ui-contract.test.js
git commit -m "feat: guide administrators through draft setup"
```

### Task 4: Regression, Bundles, and Production Assembly

**Files:**
- Modify: `scripts/build-admin-source-bundles.mjs` only if its source list needs the new RPC surface
- Regenerate: `source-bundles/public-backend.txt`
- Regenerate: `source-bundles/staff-admin.txt`
- Regenerate: `staff-apps-script/SourceBundles.gs`
- Modify: `tests/bundle-generation.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes: all Task 1–3 source files.
- Produces: paste-ready bundles with the same draft/finalization behavior as tracked source.

- [ ] **Step 1: Add a production assembly test**

Run the real staff UI through the real staff wrapper and signed public backend. Assert normal draft saves create zero Sheets, one confirmed finalization creates one Sheet, a repeated finalization still leaves one Sheet, and the public catalog only sees the finalized draft-status activity.

- [ ] **Step 2: Run the assembly test and verify it fails before regeneration**

Run:

```powershell
node --test tests/production-mutation-integration.test.js tests/bundle-generation.test.js
```

Expected: bundle parity or production assembly failure.

- [ ] **Step 3: Regenerate protected source bundles**

Run:

```powershell
node scripts/build-admin-source-bundles.mjs
```

Verify generated public files contain no deployment secrets, participant details, Google Sheet IDs, or staff URLs.

- [ ] **Step 4: Run the complete local verification**

Run:

```powershell
npm.cmd test
npm.cmd run check:bundles
git diff --check
```

Expected: zero failing tests, bundle check exit code `0`, and no whitespace errors.

- [ ] **Step 5: Commit the assembled unit**

```powershell
git add scripts/build-admin-source-bundles.mjs source-bundles/public-backend.txt source-bundles/staff-admin.txt staff-apps-script/SourceBundles.gs tests/bundle-generation.test.js tests/production-mutation-integration.test.js
git commit -m "build: assemble confirmed activity generation"
```

### Task 5: Existing-Deployment Upgrade and Live Verification

**Files:**
- Modify: `docs/deployment.md`
- Modify: `docs/participant-package-handoff.md`

**Interfaces:**
- Consumes: completed public and staff Apps Script sources from Task 4.
- Produces: upgraded public backend and staff administrator deployments at their existing URLs.

- [ ] **Step 1: Document the one-time automatic schema upgrade**

State that opening the upgraded administrator system initializes the private `活动草稿` registry tab automatically and that no per-activity Apps Script configuration is required. Document that existing activity Sheets and registrations are untouched.

- [ ] **Step 2: Deploy the public backend first**

Save the updated public Apps Script source, create the next deployment version on the existing public deployment ID, and confirm the URL remains unchanged. Do not change script properties or request new scopes.

- [ ] **Step 3: Deploy the staff administrator second**

Save updated staff source files, create the next deployment version on the existing staff deployment ID, and confirm the administrator URL remains unchanged.

- [ ] **Step 4: Perform non-destructive live verification**

Create one named test draft and verify:

1. Saving it shows immediate progress and creates no catalog row.
2. Refreshing restores the draft.
3. The correct next section opens from its configuration.
4. Repeated finalization clicks create one activity Sheet.
5. The generated activity remains `draft` and is absent from the participant site.
6. The returned Sheet link opens the new private Sheet.
7. A temporary empty generated activity can be moved to trash, while an activity with seeded history refuses deletion.

Move the named test draft and generated test Sheet to trash after verification, and confirm unrelated registry rows and activity Sheets are unchanged.

- [ ] **Step 5: Run final verification after deployment**

Run:

```powershell
npm.cmd test
npm.cmd run check:bundles
git diff --check
```

Expected: all tests pass again after the exact deployed source state is assembled.

- [ ] **Step 6: Commit deployment documentation**

```powershell
git add docs/deployment.md docs/participant-package-handoff.md
git commit -m "docs: explain confirmed activity generation"
```
