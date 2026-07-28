# Final integration fix report

Date: 2026-07-28

## Completed scope

- Admin UI payload composition now omits `eventId` entirely when there is no selected activity.  Seat-plan and registration-record mutations require a selection and carry the selected `eventId`.
- The administrator entry-point integration test exercises the same payloads through real `AdminService` mutations and shared validation.
- Ticket cancellation now resolves and verifies the unique ticket-index route before mutation, writes its `cancelled` state in the same transaction, and restores route, registration, seats, and audit state on either route or later downstream failure.
- `setupSystem` checks populated legacy tabs before registry initialization or activation.  A system without a completed catalog mapping fails with `LEGACY_MIGRATION_REQUIRED` without catalog, index, or data mutations.
- README and deployment guidance now make this preflight a mandatory step before activation and retain prior deployed versions on failure.

## TDD evidence

1. `node --test tests/admin-ui-behavior.test.js` first failed because the page emitted an `eventId: undefined` field for initial dashboard loading and new event saves.  The focused suite passes after the conditional payload composition and selected-event guards.
2. `node --test tests/apps-script-registration-vm.test.js` first failed in the injected post-index cancellation failure case: the route had not been transitioned before the downstream audit failure.  The focused suite passes after moving the indexed route transition ahead of the audit write and relying on its existing rollback snapshot.
3. `node --test tests/apps-script-admin-vm.test.js` first failed because `setupSystem` initialized the registry despite a populated legacy `活动` sheet.  The focused suite passes after the early migration preflight.

## Verification

- `node --test tests/admin-ui-behavior.test.js tests/apps-script-registration-vm.test.js tests/apps-script-admin-vm.test.js` — passed after GREEN fixes.
- `node --test tests/production-mutation-integration.test.js` — 15/15 passed.
- `node --test tests/admin-ui-contract.test.js tests/repository-attendance-migration.test.js` — 6/6 passed.
- `npm.cmd test` — 235/235 passed.  The emitted injected-failure stack traces are expected test fixtures; no test failed.
- `npm.cmd run check:bundles` — passed.
- `npm.cmd run check:public` — passed (20 approved participant files; 13 JavaScript files parsed).
- `git diff --check` — passed.

## Generated artifacts

Both source-bundle builders were re-run:

- `node scripts/build-internal-mutation-service.mjs`
- `node scripts/build-admin-source-bundles.mjs`

`InternalMutationService.gs` was regenerated but did not need a content change because the relevant generated source inputs were unchanged; the public and staff source bundles were updated.

## Review note

The legacy preflight treats a catalog row as complete when it has non-empty `eventId`, `spreadsheetId`, and legacy `活动` mapping fields.  This makes fresh systems and already-cataloged systems safe to continue while blocking unreviewed legacy data before any initialization write.  No architecture expansion was required.

## Second-review integration fixes

- Administrator cancellation now reads the ticket route through the same public repository route used by the generated service, verifies its event, registration, ticket number, and active state, then writes `cancelled` before the registration, seats, and audit. The transaction journal now snapshots both route inserts and route updates, so a route or audit failure restores all affected state.
- The migration preflight now derives every distinct event ID from every nonempty legacy business row. Blank IDs, incomplete mappings, duplicate mappings, a registry/self mapping, unreachable activity sheets, and activity rows with a different event ID all reject before writes. It uses the normal catalog resolver, which enforces the exact activity schema and a matching activity row.
- The generated advanced registry-switch gateway runs that same strict preflight against its candidate before activation, preventing the advanced path from bypassing migration review.
- A genuine administrator-page integration test now executes `AdminScript.html` against a fake DOM and real `google.script.run` transport connected to the real generated mutation gateway. It covers initial load, activity creation, seat control, reserve/close/reopen, adjustment, and cancellation.

## Second-review TDD and verification

1. `node --test tests/production-mutation-integration.test.js` first reproduced four cancellation failures: the route remained active, a route mismatch mutated records, a route-write failure mutated records, and an audit failure left the route cancelled. The focused suite passed after the canonical route verification/write and journal updates.
2. `node --test tests/apps-script-admin-vm.test.js` first accepted a partial legacy mapping. The focused suite passed after the strict row-derived migration preflight, including blank, self, duplicate, unreachable, mismatch, and fully mapped cases.
3. The advanced-switch integration test first succeeded with an unmapped legacy candidate when the candidate preflight was deliberately omitted; it rejects with `LEGACY_MIGRATION_REQUIRED` after restoring the generated-gateway preflight.
4. `npm.cmd test` — 242/242 passed. Expected injected-failure stack traces are test fixtures only.

The second-review source changes were regenerated with both source-bundle builders before the full suite. The earlier review note about accepting a merely nonempty catalog row is superseded by this stricter resolver-backed preflight.
