# Task 6 Report: Electronic Ticket, QR Verification, and Attendance

## Outcome

Implemented the participant ticket, privacy-safe public verification, and
staff-controlled per-session attendance flow.

## Participant ticket

- Added `public/ticket.html` and `public/js/ticket-page.js`.
- Ticket retrieval requires both the ticket number and the configured
  verification value.
- The dark purple/magenta ticket renders the masked participant, prominent
  seat, active/cancelled/ended state, ticket number, and every registered
  session with lecturer, time, location, and session-specific seat.
- The ticket is responsive and has a print/save layout.
- The ticket explicitly states `每场讲座将分别签到`.

## Local QR

- Added the pinned local module `public/js/qr.js`; it has no CDN or runtime
  third-party dependency.
- It implements deterministic QR Model 2 byte encoding for the generated
  verification URL range.
- The encoded payload is only `verify.html?token=<opaque-token>`. Ticket
  numbers, participant data, verification answers, email, and phone are not
  included.
- A 64-character production-sized token payload was independently decoded
  with OpenCV's QR decoder and matched the original local verification URL.

## Verification and attendance

- Added `public/verify.html`, `public/js/verify-page.js`, and
  `apps-script/AttendanceService.gs`.
- `verifyTicket({token})` runs inside the script lock, performs no writes, and
  returns only a masked name, public event/session/seat display fields, and
  ticket status.
- Scanning performs verification only. A separate protected Apps Script staff
  page requires an explicit confirmation before check-in.
- `checkIn({token, sessionId, staffIdentity})`:
  - matches the normalized staff identity against the protected
    `ATTENDANCE_STAFF_ALLOWLIST` Script Property;
  - validates active ticket, live event, permitted session status, registered
    session membership, and the server-time attendance window;
  - serializes duplicate detection and the write under the script lock;
  - stores one server timestamp per registration and session;
  - returns `ALREADY_CHECKED_IN` only for the same session, leaving other
    registered sessions independently checkable.
- Added fixed staff-service error codes/messages and an internal `checkIn`
  function that is not present in the anonymous API route allowlist.

## Data compatibility

- Added `sessionId` to the `签到记录` schema.
- Existing legacy attendance sheets are migrated in place by inserting the
  new column, preserving prior rows and timestamps.
- Ticket projections now include speaker/location display data and derive the
  ended state from the event.

## Deployment configuration

Set the Script Property `ATTENDANCE_STAFF_ALLOWLIST` to a JSON array, for
example:

```json
["staff@example.com", "door-team-02@example.com"]
```

Optional `ADMIN_SETTINGS.attendance` values:

```json
{
  "earlyMinutes": 60,
  "lateMinutes": 60
}
```

The defaults are 60 minutes before the session start and 60 minutes after its
end. Run `setupSystem()` once after deploying so an existing attendance sheet
receives the new `sessionId` column.

## Verification evidence

- `npm.cmd test`
  - 74 tests passed
  - 0 failed
- Targeted QR decode:
  - decoded a production-sized payload as
    `verify.html?token=<64-character-token>`
  - decoded value exactly matched the input
- `git diff --check`
  - no whitespace errors

Behavior coverage includes multi-session rendering, token-only QR payload,
masking, cancellation/ended states, read-only public verification, safe
response fields, staff rejection, valid check-in, same-session duplicate,
other-session success, serialized duplicate handling, time/status policy, and
legacy attendance schema migration.

## Security hardening addendum

The initial Task 6 implementation exposed `checkIn` through the anonymous
JSON `doPost` route and accepted a submitted staff identity. That design has
been removed and superseded by the following controls:

- The public GitHub `verify.html` and `verify-page.js` are strictly read-only.
  They contain no staff form, mutation import, or `google.script.run` call.
- `checkIn` is absent from the fixed public `PUBLIC_ROUTES` allowlist and from
  the public browser API client. An anonymous `doPost` request with action
  `checkIn` receives the same fixed `NOT_IMPLEMENTED` response as any unknown
  action; it never reaches authentication code.
- `staff-apps-script/StaffCheckIn.html` is the Apps Script-only staff surface.
  It calls the staff project's internal server functions through
  `google.script.run` and is returned by that project's gated `doGet()` only
  after server-side session authorization.
- The server derives the staff identity exclusively from
  `Session.getActiveUser().getEmail()`, trims it, lowercases it, rejects blank
  identities, and matches it against `ATTENDANCE_STAFF_ALLOWLIST`.
- Submitted `staffIdentity` values are ignored and are never read by
  production code. The stored `checkedInBy` value is always the normalized
  Google session identity.
- Blank and non-allowlisted sessions both receive the single generic
  `STAFF_ACTION_DENIED` response, preventing allowlist enumeration.
- The manifest now includes the `userinfo.email` scope needed for the
  protected staff surface to read the active Google identity.

The Apps Script staff page must be opened through the separately deployed,
Google-authenticated staff-project URL. The anonymous project has no staff
route or staff template.

Security regression tests explicitly prove that the public route rejects
`checkIn`, the public page has no mutation UI, a submitted allowlisted email
cannot authenticate a blank or non-allowlisted session, and an allowlisted
Google session succeeds while ignoring a forged submitted email.

## Superseded: same-project staff deployment

The same-project/two-deployment approach described in this section was
superseded after reviewing the manifest-level execution policy. The final
architecture uses two separate Apps Script projects; see the Round 3 addendum
below.

The staff UI is reachable without publishing a privileged URL in the GitHub
site:

1. Deploy the Apps Script version as the public API, executing as the deployer
   and allowing anonymous access. Only this URL belongs in
   `public/js/config.js`.
2. From the same Apps Script version, create a second Web App deployment that
   executes as the user accessing the app and is restricted to signed-in
   Google accounts or the organization domain.
3. Staff open the second deployment at `/exec?view=staff`.

`doGet(e)` keeps the default public health response unchanged. For
`view=staff`, it derives the active Google email and checks the protected
allowlist before loading `StaffCheckIn.html`. Blank and unauthorized sessions
receive the same generic `Staff access unavailable` page with no identity or
allowlist detail.

The staff deployment URL must not appear in GitHub public configuration,
public HTML, QR payloads, or participant-facing messages. Full operational
steps are recorded in `apps-script/DEPLOYMENT.md`.

Regression coverage now also proves:

- default `doGet` stays public and performs no staff-property lookup;
- blank and unauthorized staff sessions receive identical denial content and
  never load the staff template;
- an allowlisted active session receives the `StaffCheckIn` template; and
- the deployment guide requires two deployments from the same script version
  with distinct execution/access settings.

## Round 3: separate staff Apps Script project

The final security architecture separates the anonymous and staff surfaces at
the Apps Script **project and manifest** boundary:

- `apps-script/` is the anonymous public project. Its manifest remains
  `USER_DEPLOYING` / `ANYONE_ANONYMOUS`, and its only scope is spreadsheet
  access. It contains the public registration API and read-only ticket
  verification, but no staff HTML, Session identity lookup, allowlist code, or
  attendance mutation function.
- `staff-apps-script/` is the signed-in staff project. Its independent
  manifest is `USER_ACCESSING` / `ANYONE`, with spreadsheet and
  `userinfo.email` scopes. Its `doGet()` validates the active Google email
  against its own Script Property allowlist before returning
  `StaffCheckIn.html`.
- The staff project has a minimal repository that opens the configured private
  spreadsheet from its own `ACTIVE_SPREADSHEET_ID` Script Property. It does
  not include public setup, registration, ticket-management, or routing code.
- Both staff ticket lookup and attendance mutation re-check the active Session
  identity server-side. Submitted identities are ignored, and
  `checkedInBy` always records the normalized Session email.

Because the staff Web App executes as the accessing user, every staff account
must satisfy both conditions:

1. its normalized Google email is present in the staff project's
   `ATTENDANCE_STAFF_ALLOWLIST`; and
2. it has the required access to the private Google Sheet.

The staff project also needs `ACTIVE_SPREADSHEET_ID` and, when customized,
`ADMIN_SETTINGS` Script Properties. Its deployment URL must never appear in
GitHub public configuration, participant pages, QR payloads, or public
messages.

The canonical deployment procedure is now
`apps-script/DEPLOYMENT.md`. Regression tests enforce the distinct manifest
settings, absence of staff code from the anonymous project, generic
unauthorized denial, Session-only identity, forged submitted identity
rejection, allowlisted check-in behavior, and the minimal staff repository
boundary.

## Round 4: closed the staff server-function surface

The separate staff project now exposes exactly three remotely callable
top-level functions:

- `doGet`
- `getStaffTicketForCheckIn`
- `checkIn`

Every internal server helper has a trailing underscore, including the
repository helpers formerly named `getConfiguredSpreadsheet`,
`getAdminSettings`, `withScriptLock`, and `readRows`. All service and
repository callers use the private names, so signed-in but non-allowlisted
users cannot invoke those helpers directly through `google.script.run`.

Both staff data entry points continue to call
`requireAuthorizedStaffSession_()` independently before acquiring a lock,
opening the configured spreadsheet, reading rows, or writing attendance.
Regression coverage loads the real staff repository and attendance service
with instrumented Sheet and lock boundaries, calls both entry points as a
non-allowlisted session, and proves both return `STAFF_ACTION_DENIED` with
zero Sheet or lock access.

The staff server-surface test enumerates top-level declarations from every
`.gs` file in `staff-apps-script/` and fails if the remotely callable set
differs from the exact three-function allowlist above. The test was observed
failing against the prior implementation, where it detected all four leaked
repository helpers.

Round 4 verification:

- `node --test tests/apps-script-staff-route-vm.test.js tests/apps-script-attendance-vm.test.js`
  - 14 tests passed
  - 0 failed
- `npm.cmd test`
  - 83 tests passed
  - 0 failed
