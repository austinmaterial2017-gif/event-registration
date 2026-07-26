# Task 7 Design: Protected Administrator Application

## Boundary and authorization

The administrator application extends only `staff-apps-script/`. The
anonymous `apps-script/` project and the GitHub Pages site receive no
administrator routes, templates, configuration, or source bundles.

`doGet({parameter:{view:"admin"}})` checks the normalized active Google
Session email against the `ADMIN_EMAIL_ALLOWLIST` Script Property. The
attendance allowlist is independent and never grants administrator access.
Blank and unauthorized administrator sessions receive the same fixed page.

The explicit administrator RPC surface is:

- `getAdminDashboard`
- `saveAdminEvent`
- `saveAdminSession`
- `saveAdminSeatPlan`
- `saveAdminQuestion`
- `adminRecordAction`
- `testAdminSheetConnection`
- `switchAdminSheet`
- `getAdminSourceBundles`

Every RPC calls `requireAuthorizedAdminSession_()` before acquiring a lock or
opening a spreadsheet. All other server functions end in `_`.

## Data and mutations

The staff repository mirrors the shared private Sheet schema, including
questions and audit records. Mutations run under the script lock and update or
append complete rows; there is no remotely callable delete operation.

Events support the eight public lifecycle states, scheduling, location,
selection rules, seat mode, countdown controls, cancellation, and exchange
policy. Per-event policy is written to `ADMIN_SETTINGS`, while primary event
fields remain in the event row. Closing resolves to `ended` unless an explicit
allowed status is supplied. Archiving changes status only. Reopening requires
an explicit confirmation and returns the existing unique registration count.

Sessions support lecturer, time, place, capacity, required, group, and status
rules. Seat plans support `none`, `self`, `auto`, and `zone`, with generated
zone/row/seat rows plus reserve, close, and reopen operations. Questions
support every existing registration field type, validation/options, ordering,
visibility, required state, ticket display, and duplicate-identity policy.

Record lookup returns masked participant and answer data. Administrator
cancellation and seat adjustment preserve registration, participant,
attendance, seat, and audit history.

## Sheet settings

The dashboard reports only a connection state, never the active Sheet ID.
Connection testing validates an explicitly submitted target. Switching first
tests the target, then updates only `ACTIVE_SPREADSHEET_ID`; it does not delete,
copy, or migrate old data and returns a fixed warning that the previous data
remains.

## Setup bundles

The protected page exposes copy controls for public-backend and staff/admin
source bundles. Development-time generation builds tracked bundle snapshots
from the relevant source files. Tests compare each bundle against its source
set and scan for credentials, live Script Property values, Sheet IDs,
participant records, and private answers. Runtime responses require
administrator authorization and contain no current property values.

## UI and testing

`Admin.html` uses the existing charcoal, ivory, magenta, and purple system,
responsive data-dense panels, native labels, keyboard-accessible controls,
status regions, confirmation controls, and `textContent` rendering.
`AdminScript.html` calls only the explicit RPC surface.

Executable VM tests cover independent authorization before Sheet access,
CRUD and lifecycle transitions, masking, preservation, Sheet switching, and
bundle behavior. Source tests enforce the callable surface and project
isolation; UI tests enforce labels, confirmation, warnings, copy controls, and
safe rendering. Focused tests run during each red-green cycle, followed by the
full test suite and a final diff review.
