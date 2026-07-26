# Apps Script deployment guide

Create **two Web App deployments from the same Apps Script version**. The
deployments have different access settings and URLs, but run identical server
code.

## 1. Public API deployment

Use this deployment for the GitHub Pages browser client.

- Execute as: **Me (the deployer)**
- Who has access: **Anyone, even anonymous**
- URL usage: the normal `/exec` URL without `?view=staff`
- GitHub public configuration: place only this public `/exec` URL in
  `public/js/config.js`

The default `GET` response is the public health page. Public JSON actions use
`POST` and the fixed `PUBLIC_ROUTES` allowlist. `checkIn` is not a public
action.

## 2. Authenticated staff deployment

Create a second Web App deployment from the **same Apps Script version**.

- Execute as: **User accessing the web app**
- Who has access: restrict to signed-in **Google accounts** or, preferably,
  the organization **domain**
- Staff URL: append `?view=staff` to this deployment's `/exec` URL

Example:

```text
https://script.google.com/macros/s/STAFF_DEPLOYMENT_ID/exec?view=staff
```

Before returning `StaffCheckIn.html`, the server derives the active email from
`Session.getActiveUser().getEmail()` and requires a nonblank normalized match
in the `ATTENDANCE_STAFF_ALLOWLIST` Script Property. Blank and unauthorized
sessions receive the same generic access-denied page.

The staff deployment URL **must not be placed in GitHub public config**, public
HTML, QR payloads, or participant communications. Distribute it only through
the organization's protected staff/admin channel.

## Script Property

Configure `ATTENDANCE_STAFF_ALLOWLIST` as a JSON array of normalized staff
Google-account emails:

```json
["staff@example.com", "door-team-02@example.com"]
```

After changing code, update both deployments to the same new Apps Script
version so public verification and staff check-in evaluate the same ticket
data contract.
