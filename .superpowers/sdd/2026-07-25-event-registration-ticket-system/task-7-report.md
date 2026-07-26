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
  publishes a private `ACTIVE_SPREADSHEET_ID` pointer from the stable root
  Sheet. Both projects retain that same property root and follow the pointer
  on the same shared write, including when switching back to the root.
- Administrator policies are persisted under the `ADMIN_SETTINGS` key in the
  shared private `系统设置` sheet. Both the staff and anonymous projects read
  this row, with their separate Script Properties retained only as a legacy
  fallback.
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

## Fix round 1

Addressed all five findings from the first Task 7 review:

- The paste-ready staff/administrator bundle now includes
  `StaffCheckIn.html`. The bundle test discovers every literal HTML template
  loaded by the bundled runtime, requires its section, and compares that
  section byte-for-byte with the current tracked template.
- Administrator records mask boolean answers as a uniform `****` value and
  apply masking to every dynamic answer value, including collection items.
- Seat adjustment validates the target seat against the registration event
  and the union of all selected sessions before writing any seat,
  registration, or audit row. Rejected event/session mismatches leave the
  existing seat assignment untouched. The transfer keeps the old seat
  untouched through target/registration precommit, permits at most one old
  seat in the target scope, and makes its release the final critical state
  write. Precommit or release failures restore target/registration snapshots;
  even a failed rollback leaves the old seat owned and records an
  `ADMIN_SEAT_ADJUSTMENT_RECOVERY` integrity journal.
- Question updates prospectively validate the effective per-event/global
  `identityFields` list before any write. Every retained identity question
  must belong to the event and remain active and required. The last valid
  identity cannot be made optional, hidden, removed, or moved to another
  event; replacement is allowed when the same locked mutation leaves another
  valid identity question. Identity removal persists the replacement policy
  first, so a settings-storage failure cannot leave the old policy pointing
  at a newly invalid question row.
- Dashboard records now group all rows for one registration and return the
  union of their session IDs and seat choices rather than discarding rows
  after the first.

Regression coverage includes exact no-write assertions for incompatible seat
targets and rejected identity-policy changes, injected registration/release
write failures with exact seat rollback, an injected target-rollback failure
that proves the old seat and recovery journal survive, an injected
identity-policy storage failure, global-policy fallback, the cross-event
identity bypass, boolean/collection masking, and two-session record
aggregation.

Fresh verification after the fixes:

- Focused administrator/security suite: 34 passed, 0 failed.
- Full `npm.cmd test` suite: 111 passed, 0 failed.
- `node scripts/build-admin-source-bundles.mjs --check`: passed.
- `git diff --check`: passed.

## Fix round 2

The duplicate-identity policy may now be an explicit empty list. This disables
duplicate checking for the event and lets an administrator clear the final
`duplicateIdentity` flag, hide that question, or make it optional in the same
mutation. When the final identity reference is removed, the empty policy is
persisted to the shared settings row before the question row changes, so a
settings-write failure leaves both the policy and question unchanged.

Nonempty identity policies remain strict: every referenced question must
exist in the same event and remain active, visible, and required. Missing or
otherwise invalid references are rejected without silently filtering the
configuration or mutating either settings or question rows.

Regression coverage proves that:

- each supported final-flag removal persists `identityFields: []`;
- an injected shared-settings write failure preserves both settings and
  questions;
- a nonempty policy containing a missing question reference is rejected
  without mutation; and
- two registrations with identical answers both succeed when the event has an
  explicit empty identity policy, even if the global fallback is nonempty; and
- a real administrator mutation in the staff project is observed by a
  separately instantiated public registration project through the shared
  Sheet, despite each project retaining a different legacy property value;
- blank or malformed shared settings use a valid legacy settings object
  instead of silently disabling duplicate checks, while two invalid sources
  fail closed; and
- a confirmed Sheet switch publishes a private pointer that the separately
  instantiated public project and staff project observe during the same write,
  in both directions.

Fresh verification after the second fix round:

- Administrator and registration VM suites: 50 passed, 0 failed.
- Focused administrator/security suite: 65 passed, 0 failed.
- Full `npm.cmd test` suite: 118 passed, 0 failed.
- `node scripts/build-admin-source-bundles.mjs --check`: passed.
- `git diff --check`: passed.

## Fix round 3

Closed the cross-deployment consistency and switch-preflight findings.

Every public and staff RPC now resolves its stable registry and active data
Sheet once at entry, then passes those exact Spreadsheet objects through all
reads, writes, policy access, ticket cleanup, attendance, and registration
recovery helpers. Resolver and row helpers no longer have optional fallback
paths that can re-open a changed pointer. An interleaving regression changes
the registry pointer during a registration and proves that all target Sheet
rows remain byte-for-byte unchanged while the already-pinned source request
completes. A corresponding staff lookup test proves the same read behavior.

`ADMIN_SETTINGS` is authoritative only in the permanent registry Sheet.
Active data switches do not move policy. Missing, blank, malformed, array, or
otherwise invalid registry settings fail closed in both deployments, even
when their separate legacy Script Properties contain valid but conflicting
objects.

Sheet switching now uses a two-phase public-deployer preflight:

- the staff deployment validates the candidate schema, creates a short-lived
  random nonce, and stages `SWITCH_MAINTENANCE` plus a candidate record in the
  stable registry;
- the protected administrator UI sends only the nonce to the configured
  official public `/exec` endpoint;
- the public deployment reads the candidate ID only from the registry, opens
  it under the public deployer's identity, validates every exact header, and
  writes an HMAC-SHA256 signed, nonce- and expiry-matched acknowledgement;
- the staff deployment revalidates the candidate and publishes the active
  pointer only after verifying that acknowledgement; and
- missing acknowledgements, wrong or expired nonces, public open/schema
  failures, and malformed state abort without pointer publication.

The public probe always returns the same generic result and rejects payloads
containing anything other than the staged nonce, so it cannot be used as an
arbitrary Sheet-opening oracle. New registrations, cancellations, seat
exchanges, staff check-ins, and all administrator mutations fail closed while
maintenance is staged. Read-only requests and mutations that passed the entry
maintenance check keep using their pinned data Sheet through completion. The
pointer is published while maintenance remains set, and maintenance is
cleared only after that publication.

The deployment guide now requires an identical 32+-character probe secret in
both projects, the public `/exec` URL in the staff project, a populated
registry `ADMIN_SETTINGS` row, and target Sheet access for both the public
deployer and every required staff/administrator account. Generated public and
staff source bundles include the new probe service and current UI.

Regression coverage includes:

- public and staff pointer-change interleavings;
- missing, blank, and malformed authoritative settings;
- staged maintenance and no-ack abort;
- wrong and expired nonces;
- rejection of a submitted arbitrary Sheet ID;
- public-deployer open failure; and
- successful signed acknowledgement followed by pointer publication and
  switch-state cleanup.

Fresh verification after the third fix round:

- Full `npm.cmd test`: 124 passed, 0 failed, 0 skipped.
- `node scripts/build-admin-source-bundles.mjs --check`: passed.
- `git diff --check`: passed.
- Independent Critical/Important review after extending maintenance to every
  mutating RPC: clean.
