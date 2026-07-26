import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminUrl = new URL("../staff-apps-script/Admin.html", import.meta.url);
const scriptUrl = new URL("../staff-apps-script/AdminScript.html", import.meta.url);

test("administrator markup is a responsive labelled control room for every required capability", async () => {
  const [admin, script] = await Promise.all([
    readFile(adminUrl, "utf8"),
    readFile(scriptUrl, "utf8")
  ]);

  assert.match(admin, /<meta\s+name="viewport"/i);
  assert.match(admin, /#18131d|#18131D/);
  assert.match(admin, /#f8f0df|#F8F0DF/);
  assert.match(admin, /#ff4fa3|#FF4FA3/);
  assert.match(admin, /#8755ff|#8755FF/);
  assert.match(admin, /@media\s*\(/);
  assert.match(admin, /:focus-visible/);
  assert.match(admin, /prefers-reduced-motion/);
  assert.match(admin, /role="status"|aria-live="polite"/);

  for (const section of ["events", "sessions", "seats", "questions", "records", "attendance", "sheet-settings", "source-bundles"]) {
    assert.match(admin, new RegExp(`id=["']${section}["']`));
  }
  for (const status of ["draft", "upcoming", "open", "closed", "live", "ended", "cancelled", "archived"]) {
    assert.match(admin, new RegExp(`value=["']${status}["']`));
  }
  for (const mode of ["none", "self", "auto", "zone"]) {
    assert.match(admin, new RegExp(`value=["']${mode}["']`));
  }
  for (const type of ["text", "textarea", "number", "tel", "email", "date", "radio", "checkbox", "select", "boolean"]) {
    assert.match(admin, new RegExp(`value=["']${type}["']`));
  }
  for (const fieldName of [
    "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices",
    "showOpeningCountdown", "showClosingCountdown", "cancellationEnabled", "seatExchangeEnabled",
    "speaker", "startsAt", "endsAt", "capacity", "required", "groupRule",
    "showOnTicket", "duplicateIdentity", "validation", "sortOrder"
  ]) {
    assert.match(admin, new RegExp(`name=["']${fieldName}["']`));
  }
  assert.match(admin, /data-action="archive"/);
  assert.match(admin, /data-action="close"/);
  assert.match(admin, /data-action="reopen"/);
  assert.match(script, /["']reserve["']/);
  assert.match(script, /\.dataset\.action\s*=/);
  assert.match(admin, /data-action="cancel_registration"/);
  assert.match(admin, /data-action="adjust_seat"/);
  assert.match(admin, /关闭活动默认设为已结束/);
  assert.match(admin, /重新开放.*现有报名人数/);
  assert.match(admin, /旧数据.*保留/);
  assert.match(admin, /不会自动迁移/);
  assert.match(admin, /data-copy-bundle="publicBackend"/);
  assert.match(admin, /data-copy-bundle="staffAdmin"/);
  assert.match(admin, /AdminScript/);
});

test("administrator client uses only explicit RPCs, safe DOM rendering, confirmations, and copy controls", async () => {
  const script = await readFile(scriptUrl, "utf8");

  for (const rpc of [
    "getAdminDashboard", "saveAdminEvent", "saveAdminSession", "saveAdminSeatPlan",
    "saveAdminQuestion", "adminRecordAction", "testAdminSheetConnection",
    "switchAdminSheet", "getAdminSourceBundles"
  ]) {
    assert.match(script, new RegExp(`\\.${rpc}\\s*\\(`));
  }
  assert.match(script, /document\.createElement/);
  assert.match(script, /\.textContent\s*=/);
  assert.doesNotMatch(script, /\.innerHTML\s*=|document\.write\s*\(|\beval\s*\(/);
  assert.match(script, /\.withSuccessHandler\s*\(/);
  assert.match(script, /\.withFailureHandler\s*\(/);
  assert.match(script, /confirm:\s*true/);
  assert.match(script, /fetch\s*\(\s*data\.probeUrl/);
  assert.match(script, /action:\s*["']probeSheetSwitch["']/);
  assert.match(script, /payload:\s*\{\s*nonce:\s*data\.nonce\s*\}/);
  assert.match(script, /\.switchAdminSheet\(\{\s*nonce:\s*data\.nonce,\s*confirm:\s*true\s*\}\)/);
  assert.match(script, /navigator\.clipboard\.writeText\s*\(/);
  assert.match(script, /data-copy-bundle/);
  assert.match(script, /editAdminEvent\s*\(/);
  assert.match(script, /editAdminSession\s*\(/);
  assert.match(script, /editAdminQuestion\s*\(/);
  assert.match(script, /\.elements\.[A-Za-z]+\.value\s*=/);
});
