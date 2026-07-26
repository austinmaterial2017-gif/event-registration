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

## Staff project: `staff-apps-script/`

Create a different Apps Script project from the files under
`staff-apps-script/`.

- Manifest: `USER_ACCESSING` and `ANYONE` (**not anonymous**)
- Execute as: the user accessing the Web App
- Access: sign-in required; restrict to the organization domain when the
  deployment controls permit it
- Purpose: authenticated staff ticket lookup and per-session attendance

The staff project requires these Script Properties:

- `ACTIVE_SPREADSHEET_ID`: the same private spreadsheet configured for the
  public project
- `ATTENDANCE_STAFF_ALLOWLIST`: JSON array of normalized staff Google-account
  emails
- `ADMIN_SETTINGS`: optional attendance window configuration matching the
  public project

Example allowlist:

```json
["staff@example.com", "door-team-02@example.com"]
```

Staff accounts must be in the allowlist **and** must be granted the necessary
Sheet access to the private spreadsheet. This is required because the staff
Web App executes as the user accessing it, not as the deployer.

Blank and unauthorized sessions receive the same generic access-denied page.
The server ignores any submitted identity and derives `checkedInBy` only from
`Session.getActiveUser().getEmail()`.

## URL handling

The staff deployment URL must not be placed in GitHub public config, public
HTML, QR payloads, or participant messages. Distribute it only through a
protected staff/admin channel.

The public and staff projects should be updated together whenever the shared
ticket or attendance sheet contract changes.
