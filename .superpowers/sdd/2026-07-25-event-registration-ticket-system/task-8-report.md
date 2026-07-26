# Task 8 report: documentation, verification, and delivery package

## Scope completed

- Added a Chinese `README.md` covering the required two-project Google Apps Script setup journey, URL separation, activity lifecycle, secure Sheet switching, source-bundle regeneration, troubleshooting, and owner delivery checklist.
- Added `public/404.html` for GitHub Pages; it offers only a participant-facing return link.
- Added `scripts/check-public-package.mjs` and package scripts:
  - `npm.cmd run check:bundles` verifies generated Apps Script source bundles are current.
  - `npm.cmd run check:public` locks the Pages payload to its approved participant-facing file list, parses each public JavaScript module, and rejects staff/admin endpoints, Sheet IDs, passwords, allowlists, Apps Script server source, admin HTML, and hard-coded participant contact/token data.
  - `npm.cmd run check` runs all tests plus both package checks.

## Verification run

Command run locally on 2026-07-26:

```text
npm.cmd run check
```

Result: pass.

- `npm test`: 144 passed, 0 failed.
- Source bundle freshness: passed.
- Public package/privacy and JavaScript syntax check: passed (17 approved participant files; 11 JavaScript files parsed).

The behavior suite covers the required representative paths: open-event session/seat/required-field registration validation, ticket generation and read-only verification, independent per-session check-in, lifecycle status behavior, staged/abandoned Sheet switches, exact and elapsed maintenance expiry, and recovery after failed maintenance-marker cleanup.

## Delivery boundary

No Google Apps Script deployment, Google Sheet change, GitHub Pages publication, or other external publication was performed. The owner must follow the README setup checklist, configure private values and account access in Google, then publish only `public/`.

## Remaining operational consideration

The automated public scan intentionally allows code references needed for participant registration and read-only ticket verification; it rejects embedded private values/configuration. Before every real deployment, run `npm.cmd run check` after setting only the public `/exec` URL in `public/js/config.js`.
