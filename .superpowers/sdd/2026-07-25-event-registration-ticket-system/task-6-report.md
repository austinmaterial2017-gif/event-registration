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
- `apps-script/StaffCheckIn.html` is the Apps Script-only staff surface. It
  calls the internal server functions through `google.script.run` and is
  returned only by `getStaffCheckInPage()`, which is not connected to the
  anonymous public routes.
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

The Apps Script staff page must be hosted only in a Google-authenticated,
restricted staff/admin context. It must not be added to the anonymous
`doGet`/`doPost` deployment.

Security regression tests explicitly prove that the public route rejects
`checkIn`, the public page has no mutation UI, a submitted allowlisted email
cannot authenticate a blank or non-allowlisted session, and an allowlisted
Google session succeeds while ignoring a forged submitted email.
