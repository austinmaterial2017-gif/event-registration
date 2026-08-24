# Registration Photo Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator question images and private participant photo-answer uploads without changing existing registration, seat, ticket, recovery, or check-in behavior.

**Architecture:** Store both feature configurations inside the existing question `options` JSON so the Sheet schema remains compatible. Public question projections expose only safe prompt-image display data and upload limits; the final registration request carries photo bytes separately from ordinary answers. A new Apps Script photo service writes prompt images to an intentionally public single-file area and answer images to private per-event/per-registration folders, with compensating deletion when the registration transaction fails.

**Tech Stack:** Vanilla browser JavaScript, HTML/CSS, Google Apps Script V8, Google DriveApp, Google Sheets, Node.js built-in test runner and VM harnesses.

**Spec:** `docs/superpowers/specs/2026-08-24-registration-photo-upload-design.md`

## Global Constraints

- Prompt images: one JPEG, PNG, or WebP file per question, maximum 5 MB.
- Participant answers: JPEG, PNG, HEIC, or HEIF; default maximum 3 files and 5 MB per file.
- Participant answer files and folders remain private; only prompt-image files are anonymously readable.
- File contents, Drive root IDs, private file IDs, and private links never appear in GitHub, public event responses, tickets, recovery responses, or logs.
- Existing anonymous registration, sessions, seats, countdowns, tickets, recovery, and check-in behavior must remain compatible.
- Every new administrator and participant button must have an automated behavior test; existing button flows must pass regression tests before deployment.
- Use failing tests before each production change and commit each independently testable task.

## File Structure

- `apps-script/PhotoUploadService.gs`: all MIME, size, Drive folder, file creation, metadata, and rollback behavior.
- `apps-script/RegistrationService.gs`: coordinates validated photo writes with the existing registration transaction.
- `apps-script/Code.gs`: publishes safe question image and photo-answer constraints only.
- `apps-script/InternalMutationService.gs`: protected backend routes for administrator prompt-image upload/removal.
- `staff-apps-script/AdminService.gs`: authorized administrator wrapper for prompt-image mutations.
- `staff-apps-script/Admin.html`: prompt-image and participant-upload controls.
- `staff-apps-script/AdminScript.html`: administrator validation, preview, upload/remove flow, and question payload mapping.
- `public/js/photo-answers.js`: browser-only file validation, serialization, preview data, and review labels.
- `public/js/domain.js`: required-answer semantics for the new photo type.
- `public/js/registration-flow.js`: maps `photo` to a file control.
- `public/js/register-page.js`: renders prompt images and photo pickers, maintains selected files, and shows upload progress.
- `public/js/api.js`: sends `uploads` separately from ordinary answers.
- `apps-script/ReadableViews.gs`: emits readable photo counts and administrator Drive links.
- `tests/photo-answers.test.js`: focused browser file rules.
- Existing admin, Apps Script VM, readable-view, contract, and integration tests: end-to-end regression coverage.

---

### Task 1: Define the Safe Public Question Contract

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `public/js/registration-flow.js`
- Modify: `public/js/domain.js`
- Test: `tests/apps-script-contract.test.js`
- Test: `tests/domain.test.js`

**Interfaces:**
- Consumes: question `options` JSON containing `promptImage` and `upload`.
- Produces: public field `{ id, label, type: "photo", required, promptImage: { url, alt }, upload: { maxFiles, maxBytes, accept } }` with no Drive ID or private link.

- [ ] **Step 1: Write failing public projection and answer-presence tests**

Add a contract fixture whose stored options contain both safe and private keys and assert that only the safe display URL, alt text, normalized limits, and MIME list are returned. Add domain assertions that `photo` required answers accept a nonempty metadata array and reject an empty array.

```js
assert.deepEqual(field.promptImage, { url: "https://safe.example/image", alt: "付款样本" });
assert.deepEqual(field.upload, {
  maxFiles: 3,
  maxBytes: 5 * 1024 * 1024,
  accept: ["image/jpeg", "image/png", "image/heic", "image/heif"]
});
assert.equal(JSON.stringify(field).includes("driveFileId"), false);
assert.equal(validateAnswers([photoField], { receipt: [] }).valid, false);
```

- [ ] **Step 2: Run tests and verify the missing photo contract fails**

Run: `node --test tests/apps-script-contract.test.js tests/domain.test.js`

Expected: FAIL because the projection omits `promptImage` and `upload`, and `photo` has no required-answer semantics.

- [ ] **Step 3: Implement normalized safe projection and photo presence**

In `Code.gs`, parse and clamp `maxFiles` to 1–5 and `maxBytes` to 1–5 MB, whitelist MIME values, and copy only `promptImage.url` and `promptImage.alt`. In `domain.js`, treat a photo answer as present only when it is a nonempty array. In `registration-flow.js`, return `{ tag: "input", inputType: "file" }` for `photo`.

- [ ] **Step 4: Run focused tests until green**

Run: `node --test tests/apps-script-contract.test.js tests/domain.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the contract**

```bash
git add apps-script/Code.gs public/js/registration-flow.js public/js/domain.js tests/apps-script-contract.test.js tests/domain.test.js
git commit -m "feat: define safe photo question contract"
```

### Task 2: Add Administrator Photo Question Controls

**Files:**
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `apps-script/InternalMutationService.gs`
- Test: `tests/admin-ui-behavior.test.js`
- Test: `tests/apps-script-admin-vm.test.js`

**Interfaces:**
- Consumes: `uploadAdminQuestionImage({ eventId, questionId, name, mimeType, base64 })` and `removeAdminQuestionImage({ eventId, questionId })`.
- Produces: question options `{ promptImage: { url, alt, storageKey }, upload: { maxFiles, maxBytes } }`; `storageKey` remains protected and is stripped from public projections.

- [ ] **Step 1: Write failing administrator UI tests**

Extend the test form with `promptImage`, `promptImageAlt`, `maxFiles`, and `maxMegabytes`. Assert `photo` reveals participant-upload limits, all types reveal the optional prompt-image control, incompatible semantic roles are rejected, and save payloads preserve existing choice/validation options.

```js
ui.questionForm.elements.type.value = "photo";
ui.questionForm.elements.maxFiles.value = "3";
ui.questionForm.elements.maxMegabytes.value = "5";
ui.questionForm.dispatch("submit");
assert.deepEqual(ui.mutations.at(-1).payload.upload, { maxFiles: 3, maxBytes: 5242880 });
```

- [ ] **Step 2: Write failing protected-route tests**

Assert administrator upload/remove functions require the existing authorized session and forward only to `admin.uploadQuestionImage` / `admin.removeQuestionImage` internal routes.

- [ ] **Step 3: Run admin tests and verify failure**

Run: `node --test tests/admin-ui-behavior.test.js tests/apps-script-admin-vm.test.js`

Expected: FAIL because controls, services, and routes do not exist.

- [ ] **Step 4: Implement controls and protected wrappers**

Add `photo` to the type menu, conditional numeric limits, one prompt-image file input, preview, replace/remove buttons, and explicit progress messages. Encode the selected prompt image only after client validation. Add authorized wrappers and internal mutation route names; do not implement Drive writes in this task.

- [ ] **Step 5: Run admin tests until green**

Run: `node --test tests/admin-ui-behavior.test.js tests/apps-script-admin-vm.test.js`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit administrator behavior**

```bash
git add staff-apps-script/Admin.html staff-apps-script/AdminScript.html staff-apps-script/AdminService.gs apps-script/InternalMutationService.gs tests/admin-ui-behavior.test.js tests/apps-script-admin-vm.test.js
git commit -m "feat: add photo question administration"
```

### Task 3: Build Drive Storage and Rollback Service

**Files:**
- Create: `apps-script/PhotoUploadService.gs`
- Modify: `tests/apps-script-registration-vm.test.js`
- Modify: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Produces: `savePromptQuestionImage_(request)`, `removePromptQuestionImage_(request)`, `validateRegistrationUploads_(questions, uploads)`, `saveRegistrationUploads_(eventId, registrationId, normalizedUploads)`, and `rollbackRegistrationUploads_(receipt)`.
- `saveRegistrationUploads_` returns `{ answersByQuestion, receipt }`, where metadata entries are `{ originalName, mimeType, size, adminUrl, storageKey }`.

- [ ] **Step 1: Extend the Apps Script VM Drive fake and write failing storage tests**

Add minimal fake `DriveApp`, `Utilities.base64Decode`, folders, files, sharing, and trash behavior. Assert prompt files become anonymously readable, answer files remain private, unsafe MIME/size/count fail before any write, generated names exclude path characters, and rollback trashes created files/folders.

```js
const saved = context.saveRegistrationUploads_("event-1", "registration-1", normalized);
assert.equal(saved.answersByQuestion.receipt[0].originalName, "receipt.jpg");
assert.equal(fakeDrive.answerFiles[0].sharing, "PRIVATE");
context.rollbackRegistrationUploads_(saved.receipt);
assert.equal(fakeDrive.answerFiles[0].trashed, true);
```

- [ ] **Step 2: Run VM tests and verify missing service failure**

Run: `node --test tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js`

Expected: FAIL because photo service functions are undefined.

- [ ] **Step 3: Implement `PhotoUploadService.gs`**

Read roots only through `PropertiesService.getScriptProperties()`. Decode base64 after checking the encoded length, verify the decoded byte count, whitelist MIME types, sanitize extensions, and generate server-owned names. Prompt images use one-file anonymous view; answer folders/files never call `setSharing`. Return opaque `storageKey` internally and `adminUrl` only for stored/private answers.

- [ ] **Step 4: Run VM tests until green**

Run: `node --test tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the Drive service**

```bash
git add apps-script/PhotoUploadService.gs tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: store registration photos privately"
```

### Task 4: Make Photo Uploads Transactional With Registration

**Files:**
- Modify: `public/js/api.js`
- Modify: `apps-script/RegistrationService.gs`
- Modify: `apps-script/Code.gs`
- Test: `tests/api-contract.test.js`
- Test: `tests/apps-script-registration-vm.test.js`
- Test: `tests/production-mutation-integration.test.js`

**Interfaces:**
- Consumes request `{ eventId, sessionIds, seatChoices, answers, uploads, seatHoldOwner }`.
- Stores photo metadata in `storedAnswers.values[questionId]`; public success data remains unchanged.

- [ ] **Step 1: Write failing request and transaction tests**

Assert `api.js` sends `uploads`; the server rejects upload keys that are not active photo questions; successful registration stores metadata; Drive failure leaves no participant, registration, ticket route, seat holder, or photo; and a later registration failure calls rollback once.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test tests/api-contract.test.js tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js`

Expected: FAIL because upload payloads are dropped and registration does not coordinate photo writes.

- [ ] **Step 3: Implement registration coordination**

Parse `payload.uploads` separately from ordinary answers. Validate before mutation, generate the registration ID, write private files inside the existing registration lock, merge metadata arrays into normalized answers, and wrap the existing transaction so every catch path invokes `rollbackRegistrationUploads_`. Keep private file metadata out of ticket fields by excluding `photo` questions in `buildStoredTicketFields_`.

- [ ] **Step 4: Run focused tests until green**

Run: `node --test tests/api-contract.test.js tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit transactional registration**

```bash
git add public/js/api.js apps-script/RegistrationService.gs apps-script/Code.gs tests/api-contract.test.js tests/apps-script-registration-vm.test.js tests/production-mutation-integration.test.js
git commit -m "feat: submit photo answers transactionally"
```

### Task 5: Render and Validate Participant Photo Answers

**Files:**
- Create: `public/js/photo-answers.js`
- Modify: `public/js/register-page.js`
- Modify: `public/css/app.css`
- Modify: `public/register.html`
- Create: `tests/photo-answers.test.js`
- Modify: `tests/registration-behavior.test.js`
- Modify: `tests/participant-flow.test.js`

**Interfaces:**
- Produces `validatePhotoFiles(field, files)`, `serializePhotoFiles(field, files)`, and `photoReviewLabel(files)`.
- `collectAnswers()` returns photo filenames/metadata placeholders for validation; `collectUploads()` returns encoded payloads for the API only at final submission.

- [ ] **Step 1: Write failing focused browser tests**

Use real `File` objects where available or small file-like objects. Assert count, MIME, byte limits, optional empty input, serialized base64 payload, and readable review labels.

```js
assert.deepEqual(validatePhotoFiles(field, [jpeg]), { valid: true, errors: [] });
assert.equal(photoReviewLabel([jpeg, png]), "2 张照片：a.jpg、b.png");
```

- [ ] **Step 2: Write failing registration rendering assertions**

Assert prompt images use lazy loading and safe alt text, file inputs use `accept="image/jpeg,image/png,image/heic,image/heif"` and `multiple`, selected items have remove controls, and submission displays `正在上传照片…` while disabled.

- [ ] **Step 3: Run browser tests and verify failure**

Run: `node --test tests/photo-answers.test.js tests/registration-behavior.test.js tests/participant-flow.test.js`

Expected: FAIL because the module and UI do not exist.

- [ ] **Step 4: Implement focused photo module and UI**

Keep file state outside ordinary form strings. Create object URLs for previews and revoke them on remove/page exit. Encode files only after the user confirms the review step. Preserve chosen files and ordinary answers after recoverable network failure. Show a filename fallback when HEIC cannot be previewed.

- [ ] **Step 5: Run browser tests until green**

Run: `node --test tests/photo-answers.test.js tests/registration-behavior.test.js tests/participant-flow.test.js`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit participant UI**

```bash
git add public/js/photo-answers.js public/js/register-page.js public/css/app.css public/register.html tests/photo-answers.test.js tests/registration-behavior.test.js tests/participant-flow.test.js
git commit -m "feat: add participant photo answer UI"
```

### Task 6: Add Readable Sheet Photo Columns Without Leaks

**Files:**
- Modify: `apps-script/ReadableViews.gs`
- Modify: `tests/readable-views.test.js`
- Modify: `tests/apps-script-registration-vm.test.js`

**Interfaces:**
- Consumes stored private photo metadata.
- Produces registration overview cells `N 张照片` and a neighboring `题目名称（照片链接）` cell containing newline-separated administrator URLs; no public API change.

- [ ] **Step 1: Write failing readable-view and leak tests**

Add a photo answer fixture and assert headers, count, and URL cells. Assert ticket creation, recovery, verification, and event detail JSON contain neither `storageKey` nor `adminUrl`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/readable-views.test.js tests/apps-script-registration-vm.test.js`

Expected: FAIL because photo arrays render as generic text and no link column exists.

- [ ] **Step 3: Implement photo-aware columns and public redaction**

Detect `question.type === "photo"`; create two unique headers; render `未上传` or the count and safe Sheet hyperlinks/text. Keep formula-injection protection from `readableSafeCell_`. Confirm all public projections omit private metadata.

- [ ] **Step 4: Run tests until green**

Run: `node --test tests/readable-views.test.js tests/apps-script-registration-vm.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit readable views**

```bash
git add apps-script/ReadableViews.gs tests/readable-views.test.js tests/apps-script-registration-vm.test.js
git commit -m "feat: show photo answers in registration overview"
```

### Task 7: Assemble Bundles, Verify Regressions, and Prepare Deployment

**Files:**
- Modify: generated `source-bundles/*` and `paste-ready/*` outputs through the repository's existing generation commands.
- Modify: deployment documentation only if the new Script Properties are not already explained by generated instructions.
- Test: full repository suite.

**Interfaces:**
- Produces deployable public and staff Apps Script bundles plus GitHub Pages assets matching source files byte-for-byte.

- [ ] **Step 1: Add failing bundle/package contract assertions**

Assert generated bundles contain `PhotoUploadService.gs`, both new property names, the `photo` field contract, and no literal folder IDs, file IDs, participant files, or private URLs.

- [ ] **Step 2: Run package tests and verify failure**

Run: `npm test -- --test-name-pattern="bundle|package|photo"`

Expected: FAIL until bundle generation includes the new source.

- [ ] **Step 3: Run the existing source-bundle generation workflow**

Use the scripts documented in `package.json`/`apps-script/DEPLOYMENT.md`; do not manually paste concatenated source into generated artifacts.

- [ ] **Step 4: Run syntax, focused, and complete test suites**

Run:

```bash
node --check public/js/photo-answers.js
node --check public/js/register-page.js
npm test
git diff --check
```

Expected: every test passes, JavaScript syntax exits 0, and `git diff --check` reports no errors.

- [ ] **Step 5: Perform local security inspection**

Run:

```bash
rg -n "REGISTRATION_UPLOAD_ROOT_FOLDER_ID|QUESTION_IMAGE_ROOT_FOLDER_ID|drive.google.com|storageKey|adminUrl" public source-bundles paste-ready
```

Expected: property names may appear in protected/deployment sources; no literal secret values or private metadata appears in public assets.

- [ ] **Step 6: Commit deployable artifacts**

```bash
git add source-bundles paste-ready apps-script/DEPLOYMENT.md tests
git commit -m "build: package registration photo uploads"
```

- [ ] **Step 7: Prepare the deployment checklist without changing production**

Record the required order: configure `QUESTION_IMAGE_ROOT_FOLDER_ID` and `REGISTRATION_UPLOAD_ROOT_FOLDER_ID`, deploy the public Apps Script, deploy the staff Apps Script, then publish GitHub Pages. Do not change production until Task 8 passes and deployment is authorized. Validation must use a test activity and generated test files only, never real participant photos.

### Task 8: Verify Every New and Existing Button Flow

**Files:**
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/registration-behavior.test.js`
- Modify: `tests/participant-flow.test.js`
- Modify: `tests/registration-ticket-transition.test.js`
- Modify: `tests/ticket-attendance-behavior.test.js`
- Create: `tests/photo-upload-button-matrix.test.js`

**Interfaces:**
- Consumes: the assembled administrator, registration, ticket, and check-in pages.
- Produces: a button matrix proving single-click behavior, visible progress, duplicate-click protection, success feedback, recoverable failure feedback, and unchanged legacy navigation.

- [ ] **Step 1: Write a failing matrix test for every new button**

Cover administrator prompt-image select, upload, replace, remove, save-question and participant choose, preview, remove-selected, return-to-edit, final-submit and retry controls. For each mutation button assert: one user click produces one request, the button disables while pending, a visible status appears, success updates the relevant preview/record, and failure re-enables the button without losing form data.

```js
assert.equal(matrix.uploadPromptImage.requestsAfterDoubleClick, 1);
assert.equal(matrix.removeSelectedPhoto.preservesOtherAnswers, true);
assert.equal(matrix.finalSubmit.statusWhilePending, "正在上传照片…");
```

- [ ] **Step 2: Run the new matrix and verify failure**

Run: `node --test tests/photo-upload-button-matrix.test.js`

Expected: FAIL until all new controls expose the required states and handlers.

- [ ] **Step 3: Extend the legacy regression matrix**

Exercise save activity, new/edit/save session, generate seats, preview seats, save ordinary question, hide question, select sessions, select seat, review, return to edit, submit ordinary registration, recover ticket, edit registration sessions, cancel registration, and scan/check-in. Use an event with no photo questions to prove the payload and visible flow remain unchanged.

- [ ] **Step 4: Run all UI and flow regressions**

Run:

```bash
node --test tests/admin-ui-behavior.test.js tests/registration-behavior.test.js tests/participant-flow.test.js tests/registration-ticket-transition.test.js tests/ticket-attendance-behavior.test.js tests/photo-upload-button-matrix.test.js
```

Expected: PASS with zero failures and no duplicate mutation requests.

- [ ] **Step 5: Perform browser verification using a disposable test activity**

On desktop and iPhone-sized browser views, click every new photo control and the critical legacy controls. Verify visible loading/success/error feedback, keyboard focus, back-navigation preservation, and that an old activity without photo questions can still register and reach its electronic ticket. Use generated test images only.

- [ ] **Step 6: Re-run the complete suite after browser findings**

Run: `npm test && git diff --check`

Expected: all tests pass and no whitespace errors remain.

- [ ] **Step 7: Commit the verified interaction matrix**

```bash
git add tests/admin-ui-behavior.test.js tests/registration-behavior.test.js tests/participant-flow.test.js tests/registration-ticket-transition.test.js tests/ticket-attendance-behavior.test.js tests/photo-upload-button-matrix.test.js
git commit -m "test: verify photo and legacy button flows"
```

- [ ] **Step 8: Deploy after clean verification and authorization**

Follow the Task 7 checklist in order, retain the existing production URLs where possible, then repeat one no-photo registration and one test-photo registration against production. Stop and roll back to the prior deployment if either flow fails.
