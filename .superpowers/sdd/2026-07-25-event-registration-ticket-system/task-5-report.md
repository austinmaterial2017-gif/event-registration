# Task 5 Report: Atomic Registration, Seats, and Tickets

## Delivered

- Added `RegistrationService.gs` with one-script-lock registration, server-time event gating, dynamic answer validation, session selection and conflict checks, capacity enforcement, configured duplicate-identity checks, seat modes, and optional owner/expiry seat holds.
- Registration generates the required opaque ticket number and 64-character token, appends one participant plus one registration item per selected session, claims seats only after validation, and compensates partially written participant, registration, and seat rows on failure.
- Added `TicketService.gs` with verified and masked ticket lookup, status-based cancellation that preserves historical rows, and optional atomic seat exchange.
- Seat exchange validates and claims the replacement before releasing the old seat, updates every item belonging to the ticket, records an audit row, rotates the token, and restores registration/seat snapshots if a later write fails.
- Replaced the `doPost` shell with a fixed public action map and fixed public error-message allowlist. Unknown actions and internal exceptions cannot reflect implementation details.
- Extended Apps Script contracts for the lock boundary, all server-authoritative rule groups, opaque values, append/rollback behavior, no delete-based cancellation, exchange rollback/token rotation, masking, safe response fields, and the route allowlist.

## Verification

- Initial Task 5 contract run failed with four expected failures because both services and the router were absent.
- A cancellation regression assertion then failed because stored rows changed to `cancelled` while the returned projection retained `active`; the service now updates both.
- `node --test tests/apps-script-contract.test.js`: 7 passed, 0 failed.
- Apps Script syntax compilation check: `RegistrationService.gs`, `TicketService.gs`, and `Code.gs` passed.
- `npm.cmd test`: 35 passed, 0 failed, 0 skipped.
- `git diff --check`: passed.

## Self-review

- All registration validation and writes occur within one `withScriptLock` callback.
- Cancellation does not delete registration or participant rows; capacity and seats are released by status/holder updates.
- Lookup responses contain only ticket/event/session/seat data and masked participant contact fields. Raw dynamic answers, row numbers, Sheet identifiers, and exception details are not projected.
- Token disclosure is limited to ticket-owner flows that require the verification value; exchange rotates it so the prior QR token no longer matches persisted records.
- Task 3 routes for `listEvents`, `getEvent`, and `verifyTicket` are allowlisted now and remain implemented by their later plan tasks.

## Concerns

None.

## Fix round 1

- Masked participant names in every owner ticket projection; contacts remain masked and dynamic/private answers are never projected.
- Corrected seat grouping: a blank-session seat is one event-level seat shared by the registration, while session-bound seats allocate one matching label/zone per selected session. One public seat choice can drive either model.
- Registration items are now built and appended with one batched `setValues` call after validation. Participant/registration/seat compensation reports `INTEGRITY_ERROR` and records `INTEGRITY_ALERT` if restoration fails.
- Exchange snapshots cover all registration rows and both old/new seats. A normal failure restores the old seat and original token; restoration failure is no longer suppressed and produces an explicit integrity result plus audit.
- Expired seat holds are made available, stale ownership is cleared, and the same behavior applies when exchanging a seat.
- Numeric form strings use strict decimal/scientific syntax and are stored as finite numbers. Hexadecimal and other coercion-only formats are rejected.
- Unknown selection and seat modes, plus malformed nonempty event timestamps, now fail closed.
- Ticket lookup now holds the script lock while collecting its multi-sheet snapshot.
- Added `apps-script-registration-vm.test.js`, which evaluates the real Apps Script services with mocked Spreadsheet, lock, and UUID services. It covers masking, shared/session seat allocation, numeric conversion, fail-closed modes/timestamps, expired holds, partial write rollback, compensation failure auditing, batched writes, serialized duplicate calls, cancellation persistence, lookup locking, token rotation, old-seat restoration, integrity failures, and exact route rejection.

### Fix-round verification

- Target VM suite: 15 passed, 0 failed.
- Full `npm.cmd test`: 50 passed, 0 failed, 0 skipped.
- Apps Script syntax compilation check: 3 files passed.
- `git diff --check`: passed.

## Fix round 2

- Replaced creation-time active writes with a recoverable transaction state: registration items are appended as `pending`, seats are precommitted with `PENDING|<registrationId>`, and the item batch is activated only after participant, item, expired-hold, and seat writes complete.
- Pending items are excluded from capacity, duplicate detection, and ticket lookup. Pending seat markers are not public ownership and are reclaimable if cleanup cannot finish.
- Added `recoverPendingTransactions_` to clear abandoned pending items/seats and finalize logically committed seats before every locked registration, lookup, cancellation, or exchange snapshot.
- Cleanup failure now deliberately leaves identifiable pending state and an integrity/recovery audit instead of any observable partial active registration. Post-commit seat-finalization or audit failures do not convert a complete registration into a misleading client failure.
- Reordered seat exchange into a precommit and a final release: claim the new seat, persist registration choices and rotated token, then attempt the old-seat release. No rollback path contains the old seat.
- If old-seat release fails, both seats remain safely owned, the exchange result remains committed, and `SEAT_RELEASE_RETRY` is audited. Failures before release restore only the new seat and registration/token snapshots.
- Exchange audit failure never rolls back an already completed seat exchange.
- Mixed layouts now try a chosen/available event-level shared seat first and fall back to one session-bound seat per selected session. An unavailable shared seat can no longer block valid session seats.
- Expanded the executable VM suite with failure injection at pending-item, pending-seat, activation, finalization, post-commit audit, new-seat claim, registration/token update, old-seat release, and exchange-audit phases.

### Fix-round 2 verification

- Target VM suite: 22 passed, 0 failed.
- Full `npm.cmd test`: 57 passed, 0 failed, 0 skipped.
- Apps Script syntax compilation check: 3 files passed.
- `git diff --check`: passed.

## Fix round 3

- Pending seat markers are now quarantined by default and can never be selected as available. Recovery resolves each marker against committed registration items: committed markers finalize as occupied, while pending/unknown markers clear only after recovery succeeds.
- Registration, cancellation, and exchange mutations fail closed with `INTEGRITY_ERROR` when pending recovery cannot complete. Lookup may still return a committed ticket while its logically owned pending marker remains quarantined.
- Added a double-book regression that repeatedly fails seat finalization/recovery and proves a second registration cannot claim the pending seat.
- Added `cleanupStaleTicketSeats_` to every locked service entry point. It derives the current seat set from active registration choices and releases only known ticket-owned seats no longer present in those choices.
- An old-seat release failure now returns non-success `EXCHANGE_PENDING_CLEANUP`, leaves both seats owned, and writes `SEAT_RELEASE_RETRY`. Subsequent exchanges for that ticket are blocked before another seat can be claimed.
- Later service calls retry stale-seat cleanup idempotently. Success clears the stale ownership marker and records `SEAT_RELEASE_RESOLVED`, after which another exchange can proceed without seat or registration-capacity leakage.
- Unknown holders and seat holds are not treated as stale ticket ownership.
- Expanded VM failure injection to cover finalization double-book prevention and repeated exchange attempts across failed and recovered old-seat cleanup.

### Fix-round 3 verification

- Target VM suite: 24 passed, 0 failed.
- Full `npm.cmd test`: 59 passed, 0 failed, 0 skipped.
- Apps Script syntax compilation check: 3 files passed.
- `git diff --check`: passed.
