# Event Total Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-event total participant limit while preserving independent session capacities.

**Architecture:** Store `totalCapacity` in the existing per-event registration policy so old Sheet schemas remain compatible. Validate and project it through both admin paths, then enforce it inside the existing locked registration mutation before session capacity and writes.

**Tech Stack:** Google Apps Script, vanilla HTML/JavaScript, Node built-in test runner.

## Global Constraints

- `totalCapacity` is a non-negative integer; `0` means unlimited.
- Active registrations count once per registration, including registrations containing multiple sessions.
- Updating an existing active registration does not consume another event place.
- Cancelled or inactive registrations do not count.
- No new Sheet or private data is exposed publicly.

---

### Task 1: Admin Policy and UI

**Files:**
- Modify: `tests/apps-script-admin-vm.test.js`
- Modify: `tests/admin-ui-contract.test.js`
- Modify: `tests/admin-ui-behavior.test.js`
- Modify: `tests/production-mutation-integration.test.js`
- Modify: `apps-script/InternalMutationService.gs`
- Modify: `staff-apps-script/AdminService.gs`
- Modify: `staff-apps-script/Admin.html`
- Modify: `staff-apps-script/AdminScript.html`

**Interfaces:**
- Consumes: existing event policy object.
- Produces: `event.registration.totalCapacity: number` and admin payload field `totalCapacity`.

- [ ] Add failing tests that save, load, validate, reset, and render `totalCapacity`.
- [ ] Run the focused admin tests and confirm failure because the field is absent.
- [ ] Add the admin input labelled `活动总容量（0 = 不限人数）`, default it to `0`, serialize it, validate it, and persist it in both admin service paths.
- [ ] Run the focused admin tests and confirm they pass.
- [ ] Commit the admin policy and UI change.

### Task 2: Public Projection and Registration Enforcement

**Files:**
- Modify: `tests/apps-script-registration-vm.test.js`
- Modify: `tests/apps-script-contract.test.js`
- Modify: `apps-script/Code.gs`
- Modify: `apps-script/RegistrationService.gs`
- Modify: `public/js/api-client.js`

**Interfaces:**
- Consumes: `event.registration.totalCapacity`.
- Produces: public event field `totalCapacity`, error code `EVENT_CAPACITY_FULL`, and participant message `活动总名额已满`.

- [ ] Add failing tests for unlimited capacity, final available place, full rejection, inactive registrations, and updating an existing registration without double counting.
- [ ] Run the focused registration tests and confirm failure because event capacity is not enforced.
- [ ] Add a validator that counts active registrations for the event, excluding the current registration when updating, and raises `EVENT_CAPACITY_FULL` before writes.
- [ ] Add the safe public projection and participant-facing error message.
- [ ] Run the focused registration and contract tests and confirm they pass.
- [ ] Commit the registration enforcement change.

### Task 3: Bundles, Full Verification, and Deployment

**Files:**
- Regenerate: `source-bundles/public-backend.txt`
- Regenerate: `source-bundles/staff-admin.txt`
- Regenerate: `staff-apps-script/SourceBundles.gs`

**Interfaces:**
- Consumes: tested source files.
- Produces: deployable public and staff Apps Script bundles.

- [ ] Run the bundle generator and public package verifier.
- [ ] Run `npm.cmd run check` and confirm zero failures.
- [ ] Commit generated bundles.
- [ ] Update the existing public Apps Script deployment without changing its URL.
- [ ] Update the existing staff Apps Script deployment without changing its URL.
- [ ] Verify the live admin page shows the total-capacity field and the participant site still loads open activities.
