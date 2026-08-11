import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("phone scanner passes distinguish a fixed occurrence from automatic next occurrence", async () => {
  const source = await readFile(new URL("apps-script/StaffScannerService.gs", root), "utf8");

  assert.match(source, /scannerPassMode_\s*\(/);
  assert.match(source, /mode:\s*mode/);
  assert.match(source, /mode === 'manual'/);
  assert.match(source, /mode === 'next'/);
  assert.match(source, /checkpointId = ''/);
});

test("scanner checkin forwards fixed occurrences without changing normal staff checkin", async () => {
  const [scannerService, internalService] = await Promise.all([
    readFile(new URL("apps-script/StaffScannerService.gs", root), "utf8"),
    readFile(new URL("apps-script/InternalMutationService.gs", root), "utf8")
  ]);

  assert.match(scannerService, /staffCheckpointMode:\s*pass\.mode/);
  assert.match(internalService, /staffCheckpointMode === 'manual'/);
  assert.match(internalService, /staffCheckpointMode === 'next'/);
  assert.match(internalService, /ALL_CHECK_INS_COMPLETE/);
});
