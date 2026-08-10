# Independent Staff Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an iPhone staff member to scan a ticket using a top-level HTTPS page and automatically return to the protected check-in screen.

**Architecture:** A static `staff-scanner.html` hosted by GitHub Pages requests the camera and decodes the QR. It accepts only a validated Apps Script check-in return URL and appends the decoded ticket URL as `scan`; the existing protected staff page performs the ticket lookup.

**Tech Stack:** Static HTML/JavaScript, ZXing browser QR decoder, Google Apps Script HTML Service, Node test runner.

## Global Constraints

- The standalone scanner never creates check-in rows.
- Return URLs must be HTTPS Apps Script `/macros/s/.../exec` URLs.
- QR values and participant data are not persisted by the scanner.

---

### Task 1: Prove the scanner return contract

**Files:**
- Modify: `tests/ticket-attendance-behavior.test.js`
- Modify: `staff-apps-script/StaffCheckIn.html`
- Create: `public/staff-scanner.html`
- Create: `public/js/staff-scanner.js`

- [ ] **Step 1: Write the failing test**

```js
assert.match(staffHtml, /staff-scanner\.html\?returnUrl=/);
assert.match(scannerJs, /isSafeReturnUrl/);
assert.match(scannerJs, /searchParams\.set\("scan", scannedValue\)/);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/ticket-attendance-behavior.test.js`

- [ ] **Step 3: Add the minimal standalone scanner and protected return link**

The scanner validates the `returnUrl`, opens the rear camera with ZXing, and redirects with `scan`. The protected page creates the link from its own current URL.

- [ ] **Step 4: Run the focused test and then `npm run check`**

- [ ] **Step 5: Commit and publish the static site plus staff deployment**
