import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("phone scanner bootstrap is a public route with server-only PIN verification", async () => {
  const [code, scannerService] = await Promise.all([
    readFile(new URL("apps-script/Code.gs", root), "utf8"),
    readFile(new URL("apps-script/StaffScannerService.gs", root), "utf8")
  ]);

  assert.match(code, /'staffScannerBootstrap'\s*:\s*function\(payload\)\s*\{\s*return staffScannerBootstrap\(payload\);/);
  assert.match(scannerService, /function\s+staffScannerBootstrap\s*\(/);
  assert.match(scannerService, /STAFF_CHECKIN_PIN_DIGEST/);
  assert.match(scannerService, /function\s+staffPinMatches_\s*\(/);
  assert.match(scannerService, /internalStaffCheckInTargets_\s*\(/);
  assert.match(scannerService, /createInternalStaffScannerPass_\s*\(/);
});

test("phone scanner bootstrap source has no client-side secret or raw PIN setting", async () => {
  const [scannerService, publicFiles] = await Promise.all([
    readFile(new URL("apps-script/StaffScannerService.gs", root), "utf8"),
    readFile(new URL("public/js/api.js", root), "utf8")
  ]);

  assert.doesNotMatch(scannerService, /STAFF_CHECKIN_PIN\s*=/);
  assert.doesNotMatch(publicFiles, /INTERNAL_API_SHARED_SECRET|STAFF_CHECKIN_PIN_DIGEST/);
});
