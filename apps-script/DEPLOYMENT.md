# Apps Script deployment guide

Deploy **two separate Apps Script projects**. Do not create two deployments
from one project or one manifest: the public and staff projects intentionally
have different execution identities and access policies.

## Per-activity Sheet model

The registry Sheet remains permanent. Both projects keep
`ACTIVE_SPREADSHEET_ID` pointed at that one private registry, which stores the
shared settings, activity catalog, ticket index, and registry audit.

Every new activity automatically receives its own private Google Sheet. The
public backend creates and initializes it, grants the authenticated creating
administrator editor access, and publishes the catalog entry only after
preparation succeeds. The participant site never receives its Sheet ID or
protected edit URL.

The first run after this upgrade requests one-time Google Drive authorization.
Approve the new Drive scope in the public project when running `setupSystem()`
after replacing the public source.
Creating later activities requires no Apps Script setup, edits, or redeployment.
It also requires no Sheet ID entry.

Existing nonempty legacy activity data is not split automatically.
`setupSystem()` preserves those rows but does not copy, repartition, or add
them to the new activity catalog. Back up the legacy Sheet and complete a
separately reviewed migration before removing or changing any old data.

## Updating existing protected deployments

Keep the existing protected projects and official deployment URLs.
Retain the prior public and staff deployment versions before upgrading.

1. Back up the permanent registry and keep both existing deployment URLs in
   the protected deployment record.
2. Pause participant submissions and staff or administrator mutations for a
   controlled maintenance window.
3. Replace the existing public project's files with the generated
   `source-bundles/public-backend.txt`, save, run `setupSystem()`, and approve
   the new Drive scope once.
4. Update that existing public deployment to the new version. Keep its
   official `/exec` URL unchanged.
5. Replace the existing staff project's files with
   `source-bundles/staff-admin.txt`, confirm its Script Properties still refer
   to the permanent registry and upgraded public backend, and deploy a new
   version through the same official staff deployment URL.
6. From the protected administrator page, create two test activities and
   confirm distinct private Sheet links before testing public registration,
   QR verification, and one check-in for each activity.
7. Resume participant and staff traffic only after those checks pass.

Do not create a new Apps Script project for each activity. After this upgrade,
normal activity creation is entirely automatic.

### Rollback

Keep participant and staff traffic paused. If the upgrade verification fails,
revert the staff deployment first, then revert the public deployment. This
order prevents upgraded staff code from calling per-activity actions that an
older public backend does not provide; the prior staff version can continue
using the still-upgraded public backend during the short rollback interval.

Re-test the old public registration, ticket, verification, and staff routes
before resuming traffic. Code rollback does not undo registry initialization, private Sheets, or data writes.
Review every created Sheet, catalog/index row, registration, and attendance
write manually against the backup. Never delete those Sheets or rows automatically during rollback.

## Fresh installation

The project-creation instructions below apply only when no protected public
and staff Apps Script projects exist yet. An upgrade must use the preceding
existing-deployment procedure instead.

## Public project: `apps-script/`

Create an Apps Script project from the files under `apps-script/`.

- Manifest: `USER_DEPLOYING` and `ANYONE_ANONYMOUS`
- Execute as: the deployer
- Access: anyone, including anonymous visitors
- Purpose: public registration API, owner ticket lookup, read-only ticket
  verification, and the signed internal mutation gateway used by the
  authenticated staff project
- GitHub config: place only this project's `/exec` URL in
  `public/js/config.js`

This project contains no staff page, staff allowlist, or Session identity
lookup. Its internal mutation gateway accepts only timestamped, signed,
nonce-protected requests from the staff project; no internal action is exposed
as a participant API operation.

The public project requires these Script Properties:

- `ACTIVE_SPREADSHEET_ID`: the permanent registry Sheet ID
- `SWITCH_PROBE_SHARED_SECRET`: a randomly generated secret of at least 32
  characters, identical to the value in the staff project
- `INTERNAL_API_SHARED_SECRET`: a different randomly generated secret of at
  least 32 characters, identical to the value in the staff project
- `PUBLIC_BASE_URL`: the participant GitHub Pages root URL, without a trailing
  slash; this is used to create absolute QR verification links

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

- `ACTIVE_SPREADSHEET_ID`: the same permanent private registry configured for
  the public project; never point it at an activity Sheet
- `ATTENDANCE_STAFF_ALLOWLIST`: JSON array of normalized staff Google-account
  emails
- `ADMIN_EMAIL_ALLOWLIST`: a separate JSON array of normalized administrator
  Google-account emails
- `PUBLIC_BACKEND_URL`: the public project's official
  `https://script.google.com/macros/s/.../exec` URL
- `SWITCH_PROBE_SHARED_SECRET`: the same randomly generated secret of at least
  32 characters configured in the public project
- `INTERNAL_API_SHARED_SECRET`: the same second secret of at least 32
  characters configured in the public project; do not reuse the switch secret

Example allowlist:

```json
["staff@example.com", "door-team-02@example.com"]
```

Staff accounts must be in the relevant allowlist. Staff and administrator
actions are signed by this authenticated project and executed by the public
backend against the registry-selected activity Sheet. The administrator who
creates an activity is automatically granted editor access to its Sheet;
other people need explicit sharing only when they must open that Sheet
directly.

Administrator-controlled attendance, event, session, countdown, cancellation,
exchange, ticket-field, and duplicate-identity policies are stored as JSON in
the permanent registry Sheet's `系统设置` tab under the `ADMIN_SETTINGS` key.
The registry row is authoritative: it must contain a non-empty JSON object.
Blank, missing, or malformed registry settings fail closed in both projects;
neither project falls back to its separate Script Properties. The
administrator project writes this row and both projects read it, so policy
changes take effect in the anonymous registration project despite the
projects having separate Script Properties. `setupSystem()` in the public
project seeds a valid, conservative `ADMIN_SETTINGS` object in the registry
on first initialization (empty registration/attendance policy maps, with
optional capabilities disabled). The administrator project can then update
that shared row. A subsequently blank, missing, or malformed row still fails
closed; neither project uses a Script Property fallback.

The attendance allowlist does not grant administrator access. The attendance
and administrator allowlists are independent:
`ATTENDANCE_STAFF_ALLOWLIST` does not grant administrator access, and
`ADMIN_EMAIL_ALLOWLIST` does not grant attendance access. An account that
performs both roles must be present in both arrays.

Gateway operations do not require direct sharing of the registry or activity Sheets.
Direct editor access is required only for a user who follows the protected
`sheetUrl` and views or edits that activity in Google Sheets.

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

Creating an activity from the ordinary administrator workflow requires only
its activity details. It automatically creates its private Sheet and returns a
protected edit link to the authorized administrator.

The advanced-maintenance data-table panel can still test a submitted whole
system target Sheet before a legacy switch. This is not the per-activity
creation path. Switching requires explicit confirmation and a two-phase
preflight:

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

Every legacy switch target must already contain the exact initialized data
schema and must be shared with:

- the public Apps Script deployer account, because registry and activity data
  operations execute in the signed public backend; and
- any administrator who must open that target Sheet directly in Google
  Sheets. Authenticated staff operations themselves do not require direct
  Sheet sharing.

## Source bundles and two-project setup

The protected administrator view contains copy controls for two generated
source bundles:

1. Copy the public source, create the `apps-script/` project, and deploy it as
   `USER_DEPLOYING` / `ANYONE_ANONYMOUS`.
2. Copy the staff source, create a separate `staff-apps-script/` project, and
   deploy it as `USER_ACCESSING` / `ANYONE` with sign-in required.
3. Set Script Properties manually in each project. Both projects must point
   `ACTIVE_SPREADSHEET_ID` at the same initialized private registry and retain
   it as their stable root. Never use an automatically created activity Sheet
   as this property. Configure the same
   `SWITCH_PROBE_SHARED_SECRET` and `INTERNAL_API_SHARED_SECRET` in both
   projects, set `PUBLIC_BASE_URL` in the public project, and set
   `PUBLIC_BACKEND_URL` in the staff project. The generated source contains
   property names only; it does not contain current property values, Sheet
   IDs, allowlist members, credentials, participant rows, or answers.
4. Verify the public project's `setupSystem()` seeded the registry's
   authoritative `ADMIN_SETTINGS` row, then use the protected administrator
   project to configure the required policies.
5. Keep the registry private. The public deployer must retain access. The
   creating administrator is automatically added to each new activity Sheet;
   share direct Sheet access with additional people only when required.

The source bundles are generated during development from the tracked files.
Run `node scripts/build-internal-mutation-service.mjs` first, then
`node scripts/build-admin-source-bundles.mjs` after changing bundled Apps
Script or administrator HTML files. Deploy both updated snapshots for this
one-time upgrade. Future activities use the deployed code and require no new
Apps Script project or version.

## URL handling

The staff deployment URL must not be placed in GitHub public config, public
HTML, QR payloads, or participant messages. Distribute it only through a
protected staff/admin channel.

The public and staff projects should be updated together whenever the shared
ticket or attendance sheet contract changes.
