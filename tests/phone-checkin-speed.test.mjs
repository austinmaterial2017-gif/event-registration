import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../js/phone-checkin.js", import.meta.url),
  "utf8"
);
const page = await readFile(
  new URL("../staff-checkin.html", import.meta.url),
  "utf8"
);

test("scanner gives immediate visible and tactile feedback after detecting a QR", () => {
  assert.match(source, /已扫到二维码，正在核对报名资料/);
  assert.match(source, /navigator\.vibrate/);
  assert.match(source, /showScanningFeedback/);
});

test("scanner reports staged progress while the server is still working", () => {
  assert.match(source, /正在写入签到记录/);
  assert.match(source, /startProgressFeedback/);
});

test("a decoded ticket gets a clear timeout response within five seconds", () => {
  assert.match(source, /function request\(params, timeoutMs = 60_000\)/);
  assert.match(source, /await request\(\{[\s\S]*action: "checkin"[\s\S]*\}, 5_000\)/);
  assert.match(source, /签到系统超过 5 秒没有回应/);
});

test("the phone blocks an early or finished session before it sends a check-in request", () => {
  assert.match(source, /function selectedTimeMessage\(\)/);
  assert.match(source, /还未到这个项目的签到时间。/);
  assert.match(source, /这个项目的签到时间已结束。/);
  assert.match(source, /const timeMessage = selectedTimeMessage\(\);/);
  assert.match(source, /if \(timeMessage\) \{[\s\S]*showResult\(timeMessage, false\)/);
});

test("camera uses the proven direct camera decoder and keeps scanning after success", () => {
  assert.match(source, /new window\.ZXingBrowser\.BrowserQRCodeReader\(\)/);
  assert.match(source, /decodeFromConstraints\(\s*\{ video: \{ facingMode: \{ ideal: "environment" \} \}, audio: false \}/);
  assert.doesNotMatch(source, /TRY_HARDER/);
  assert.doesNotMatch(source, /POSSIBLE_FORMATS/);
  assert.match(source, /请继续扫下一位/);
});

test("scanner overlay exposes a processing state without changing success styling", () => {
  assert.match(page, /#result\.processing strong/);
  assert.match(page, /#result\.success strong/);
  assert.match(page, /aria-live="assertive"/);
});

test("scanner is camera-only and does not show an image-upload fallback", () => {
  assert.doesNotMatch(page, /id="qr-image"/);
  assert.doesNotMatch(source, /decodeFromImageElement/);
  assert.doesNotMatch(source, /readQrImage/);
});
