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
