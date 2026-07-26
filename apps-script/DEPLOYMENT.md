# Apps Script deployment guide

Deploy **two separate Apps Script projects**. Do not create two deployments
from one project or one manifest: the public and staff projects intentionally
have different execution identities and access policies.

## Public project: `apps-script/`

Create an Apps Script project from the files under `apps-script/`.

- Manifest: `USER_DEPLOYING` and `ANYONE_ANONYMOUS`
- Execute as: the deployer
- Access: anyone, including anonymous visitors
- Purpose: public registration API, owner ticket lookup, and read-only ticket
  verification
- GitHub config: place only this project's `/exec` URL in
  `public/js/config.js`

This project contains no staff page, staff allowlist, Session identity lookup,
or attendance mutation function.

The public project requires these Script Properties:

- `ACTIVE_SPREADSHEET_ID`: the permanent registry Sheet ID
- `SWITCH_PROBE_SHARED_SECRET`: a randomly generated secret of at least 32
  characters, identical to the value in the staff project

## Staff project: `staff-apps-script/`

Create a different Apps Script project from the files under
`staff-apps-script/`.

- Manifest: `USER_ACCESSING` and `ANYONE` (**not anonymous**)
- Execute as: the user accessing the Web App
- Access: sign-in required; restrict to the organization domain when the
  deployment controls permit it
- Purpose: authenticated staff ticket lookup, per-session attendance, and the
  separately allowlisted administrator application

The staff project requires these Script Properties:

- `ACTIVE_SPREADSHEET_ID`: the same private spreadsheet configured for the
  public project
- `ATTENDANCE_STAFF_ALLOWLIST`: JSON array of normalized staff Google-account
  emails
- `ADMIN_EMAIL_ALLOWLIST`: a separate JSON array of normalized administrator
  Google-account emails
- `PUBLIC_BACKEND_URL`: the public project's official
  `https://script.google.com/macros/s/.../exec` URL
- `SWITCH_PROBE_SHARED_SECRET`: the same randomly generated secret of at least
  32 characters configured in the public project

Example allowlist:

```json
["staff@example.com", "door-team-02@example.com"]
```

Staff accounts must be in the allowlist **and** must be granted the necessary
Sheet access to the private spreadsheet. This is required because the staff
Web App executes as the user accessing it, not as the deployer.

Administrator-controlled attendance, event, session, countdown, cancellation,
exchange, ticket-field, and duplicate-identity policies are stored as JSON in
the permanent registry Sheet's `系统设置` tab under the `ADMIN_SETTINGS` key.
The registry row is authoritative: it must contain a non-empty JSON object.
Blank, missing, or malformed registry settings fail closed in both projects;
neither project falls back to its separate Script Properties. The
administrator project writes this row and both projects read it, so policy
changes take effect in the anonymous registration project despite the
projects having separate Script Properties. `ADMIN_SETTINGS` must therefore
be populated in the registry before either deployment serves traffic.

The attendance allowlist does not grant administrator access. The attendance
and administrator allowlists are independent:
`ATTENDANCE_STAFF_ALLOWLIST` does not grant administrator access, and
`ADMIN_EMAIL_ALLOWLIST` does not grant attendance access. An account that
performs both roles must be present in both arrays and must have Sheet access.

Blank and unauthorized sessions receive the same generic access-denied page.
The server ignores any submitted identity and derives `checkedInBy` only from
`Session.getActiveUser().getEmail()`.

## Administrator view

Open the staff deployment with `?view=admin`, for example:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec?view=admin
```

The route and every administrator action independently read the active Google
Session and require membership in `ADMIN_EMAIL_ALLOWLIST`. Blank and
unauthorized administrator sessions receive the same fixed denial page.

The administrator's data-table panel shows connection status and can test a
submitted target Sheet before a switch. Switching requires explicit
confirmation and a two-phase preflight:

1. The staff project validates the target schema, creates a short-lived random
   nonce in the permanent registry, and enables registry maintenance.
2. The protected administrator page sends only that nonce to the configured
   public backend. The public deployer reads the candidate ID from the
   registry, opens it with its own execution identity, validates the schema,
   and writes a signed, nonce-matched acknowledgement.
3. The staff project verifies the unexpired acknowledgement and only then
   publishes `ACTIVE_SPREADSHEET_ID`. Missing, invalid, expired, or failed
   acknowledgements abort without publishing.

New registrations, cancellations, seat exchanges, check-ins, and
administrator mutations fail closed while maintenance is staged. Read-only
requests and mutation requests that already passed the entry maintenance
check continue on their pinned data Sheet. Both projects retain the original
Sheet as their permanent Script Property root; the active pointer and
`ADMIN_SETTINGS` policy always live in that stable registry. Old data remains
in the previous Sheet. Migration is not automatic, and the switch does not
initialize, copy, migrate, or delete business rows.

Every switch target must already contain the exact initialized data schema and
must be shared with:

- the public Apps Script deployer account, because the anonymous Web App
  executes as that deployer; and
- every staff or administrator account that needs to use the authenticated
  Web App, because it executes as the accessing user.

## Source bundles and two-project setup

The protected administrator view contains copy controls for two generated
source bundles:

1. Copy the public source, create the `apps-script/` project, and deploy it as
   `USER_DEPLOYING` / `ANYONE_ANONYMOUS`.
2. Copy the staff source, create a separate `staff-apps-script/` project, and
   deploy it as `USER_ACCESSING` / `ANYONE` with sign-in required.
3. Set Script Properties manually in each project. Both projects must
   initially point `ACTIVE_SPREADSHEET_ID` at the same initialized private
   Sheet and retain it as their stable root. Later confirmed administrator
   switches are propagated through the shared pointer. Configure the same
   `SWITCH_PROBE_SHARED_SECRET` in both projects and set `PUBLIC_BACKEND_URL`
   in the staff project. The generated source contains property names only; it
   does not contain current property values, Sheet IDs, allowlist members,
   credentials, participant rows, or answers.
4. Populate the registry Sheet's authoritative `ADMIN_SETTINGS` row.
5. Grant the public deployer and each required staff or administrator account
   access to the registry and every candidate data Sheet.

The source bundles are generated during development from the tracked files.
Run `node scripts/build-admin-source-bundles.mjs` after changing bundled Apps
Script or administrator HTML files, then deploy the updated source snapshots.

## URL handling

The staff deployment URL must not be placed in GitHub public config, public
HTML, QR payloads, or participant messages. Distribute it only through a
protected staff/admin channel.

The public and staff projects should be updated together whenever the shared
ticket or attendance sheet contract changes.
