# Phone Staff Check-in Design

## Goal

Replace the unreliable Apps Script camera page with a fast, standalone phone check-in page. A staff member selects an activity, a lecture/teacher, and a check-in occurrence before scanning consecutive participant QR tickets.

## Why the current page fails

The current staff page uses `google.script.run` and expects Apps Script to identify the signed-in Google account. On iPhone and Chrome, Apps Script often returns no usable account identity. The page then cannot load activities or create a scanner pass. Camera navigation also leaves the Apps Script context, causing blank or slow pages.

## User flow

1. Staff opens one GitHub Pages URL in Safari or Chrome, outside WhatsApp's in-app browser.
2. They enter a staff access PIN once per device session.
3. They select an activity, then a lecture/teacher, then choose either:
   - `自动下一次` — the system records each participant's next unfinished check-in occurrence; or
   - `第 1 次` through `第 N 次` — the same selected occurrence is recorded for everyone.
4. The server creates a two-hour, scoped scanner pass. The phone opens its camera without any Apps Script redirect.
5. Every valid QR ticket is checked in against that one activity, lecture, and occurrence. A green success screen appears briefly, then scanning continues automatically.
6. Invalid, wrong-activity, unregistered, duplicate, expired-pass, or closed-time-window tickets show a red reason while the camera remains available for the next ticket.

## Security and data rules

- The staff PIN is verified only by Apps Script. It is never put in the GitHub Pages code or URL.
- The scan page receives a random 64-character scanner pass, not a Google-account identity or Apps Script secret.
- A pass lasts two hours and is locked to exactly one activity, session, and selected mode/checkpoint.
- Every actual check-in remains server-timestamped in the existing `签到记录` sheet.
- A participant can check in multiple times when the activity allows multiple occurrences. The same participant cannot check in twice for the same occurrence.
- The registration site, ticket recovery, participant QR, administrator tools, and existing sheets keep their current interfaces. The old staff scanner URL may remain as a link, but it will forward users to the new standalone selector rather than run the old camera logic.

## Components

| Component | Responsibility |
| --- | --- |
| `public/staff-checkin.html` | Standalone mobile selector: PIN, activity, lecture/teacher, occurrence, then starts camera mode. |
| `public/js/staff-checkin.js` | Loads permitted targets, requests a scoped pass, maintains selected target in browser storage, and runs the continuous scanner. |
| `public/js/staff-scanner-core.js` | QR-token extraction, duplicate suppression, scanner state machine, and outcome text; independently unit-testable. |
| `apps-script/StaffScannerService.gs` | Server-only PIN validation, safe target projection, pass issuance, and check-in action. |
| `apps-script/Code.gs` | Adds only the public routes required by the independent staff scanner. |
| Tests | Prove PIN/pass validation, target scope, manual and automatic multiple check-ins, duplicate rejection, and scanner state transitions. |

## Performance and mobile requirements

- The selector fetches the event/session list once and uses it until the page is refreshed.
- The camera opens only after the staff member presses `开始连续扫码`; iPhone shows the standard permission prompt the first time.
- The scanner does not navigate, reload, or reopen the camera between tickets.
- A scan response has a visible pending state; success/error overlays close automatically without stopping the stream.
- The page uses `https://austinmaterial2017-gif.github.io/event-registration/staff-checkin.html`, so it is a top-level secure page, not an Apps Script iframe or `googleusercontent.com` redirect.

## Out of scope for this change

- Changing participant registration logic, seats, ticket recovery, or current administrator forms.
- Deleting real participant registrations or existing check-in records.
- Reformatting current Google Sheet reporting layouts; that will be handled as a separate, safer task after scanning works.

## Acceptance checks

1. On iPhone Safari and iPhone Chrome, a staff member can select event/session/occurrence and get a camera permission prompt.
2. Scanning a valid test ticket records exactly one check-in and immediately returns to live scanning.
3. Scanning it again for the same occurrence is rejected without creating another record.
4. Manual occurrence and automatic-next occurrence both work for sessions configured for multiple check-ins.
5. A ticket for a different activity or an unregistered lecture is rejected.
6. Existing participant registration and ticket pages remain functional.
