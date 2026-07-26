# Task 7 Report: Protected Administrator Application

## Outcome

Implemented the protected administrator application inside the separate
`staff-apps-script/` project. No administrator route, service, template, or
callable function was added to the anonymous Apps Script project or the
GitHub Pages application.

The signed-in staff deployment now serves:

- the existing attendance view at its default URL; and
- the protected administrator view at `?view=admin`.

## Security boundary

- Administrator identity is derived only from
  `Session.getActiveUser().getEmail()`.
- The administrator route requires membership in the
  `ADMIN_EMAIL_ALLOWLIST` Script Property.
- `ATTENDANCE_STAFF_ALLOWLIST` and `ADMIN_EMAIL_ALLOWLIST` are independent.
  Attendance membership does not grant administrator access.
- Blank and unauthorized administrator sessions receive the same fixed
  generic denial page.
- The staff project exposes exactly 12 remotely callable functions:
  `doGet`, two attendance functions, and nine explicit administrator RPCs.
  Every other repository and service helper ends in `_`.
- Every administrator RPC independently calls
  `requireAuthorizedAdminSession_()` before acquiring a lock or opening a
  Sheet. Executable tests prove all nine functions reject an unauthorized
  session with zero lock and Sheet access.
- Administrator service failures use fixed codes and messages; allowlist
  entries, property values, Sheet IDs, exceptions, and row numbers are not
  returned.

## Administrator capabilities

### Events

- Create and edit all lifecycle states: `draft`, `upcoming`, `open`, `closed`,
  `live`, `ended`, `cancelled`, and `archived`.
- Configure opening/closing times, location, selection rules, choice bounds,
  seat mode and zones, countdown switches, cancellation, and seat exchange.
- Closing defaults to `ended`.
- Archiving updates only the event status and preserves every related row.
- Reopening requires explicit confirmation, returns to `open`, and reports the
  unique existing registration count.

### Sessions, seats, and questions

- Sessions support title, lecturer, start/end times, place, capacity, required
  state, group rule, and status.
- Seat plans support `none`, `self`, `auto`, and `zone`, including generated
  zone/row/seat labels and reserve, close, and reopen transitions.
- Seat plan regeneration appends missing seats and retains existing rows.
- Questions support add/edit/reorder/show/hide, required/optional state, all
  ten existing registration field types, choices, validation, ticket display,
  and duplicate-identity flags.

### Records

- Dashboard search can match private participant data server-side but returns
  one masked result per registration.
- Names, phone numbers, email addresses, dynamic answers, and staff identities
  are masked. Ticket tokens and Sheet row numbers are omitted.
- Cancellation changes registration status and releases its seats without
  deleting registration, participant, attendance, or audit rows.
- Seat adjustment transfers the selected seat and updates registration seat
  choices without deleting history.
- Attendance history is available in the dashboard with masked staff identity.

## Sheet settings

- The dashboard reports connection status and Sheet name without returning the
  active Sheet ID.
- Target testing validates every required Sheet and exact header without
  activating or mutating the target.
- Switching requires explicit confirmation, validates the target first, and
  changes only `ACTIVE_SPREADSHEET_ID`.
- The interface and response warn that old data remains and migration is not
  automatic. No initialization, copying, migration, or deletion occurs during
  switching.

## Protected UI

Added `Admin.html` and `AdminScript.html` with the established charcoal,
ivory, magenta, and purple visual system.

- A lifecycle rail anchors a dense control-room layout for event operators.
- Every input has a native label; keyboard focus is visible; status messages
  use live regions; mobile and reduced-motion rules are included.
- Existing event, session, and question cards populate their edit forms.
- Reopen, cancellation, seat adjustment, and Sheet switching require explicit
  client confirmation, backed by independent server confirmation fields.
- Server data is rendered with `createElement` and `textContent`; the client
  does not assign `innerHTML`, call `document.write`, or use `eval`.

## Source bundles and deployment

Added deterministic development-time bundle generation:

- `source-bundles/public-backend.txt`
- `source-bundles/staff-admin.txt`
- generated runtime constants in `staff-apps-script/SourceBundles.gs`

The protected page has separate copy buttons for the anonymous public backend
and the signed-in staff/administrator project. The staff snapshot includes a
generated `SourceBundles.gs` section so the copied project is paste-ready.

Tests rebuild the expected bundles from fixed tracked-source lists and compare
them byte-for-byte with the snapshots and runtime constants. Redaction checks
reject email addresses, assigned credentials, private keys, and hard-coded
opaque identifiers. Test fixtures also prove that Sheet IDs, participant
contacts, private answers, ticket tokens, and allowlist members do not appear
in either bundle.

`apps-script/DEPLOYMENT.md` now documents:

- the two separate Apps Script projects and manifests;
- the independent attendance and administrator allowlists;
- the protected `?view=admin` URL;
- required Sheet access for accounts;
- the non-destructive switch warning; and
- the source-copy workflow.

After changing any bundled Apps Script or administrator HTML file, regenerate
and verify the snapshots with:

```text
node scripts/build-admin-source-bundles.mjs
node scripts/build-admin-source-bundles.mjs --check
```

## Verification evidence

- Focused administrator/security suite:
  - 22 tests passed
  - 0 failed
- Full `npm.cmd test` suite:
  - 99 tests passed
  - 0 failed
- `git diff --check`:
  - no whitespace errors
- Manual source review:
  - exact 12-function callable surface confirmed
  - nine administrator authorization calls confirmed
  - no staff/admin delete API found
  - no administrator surface found in anonymous or public code
  - generated source bundles current
