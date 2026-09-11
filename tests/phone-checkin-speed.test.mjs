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

test("camera is tuned for phone QR recognition and keeps scanning after success", () => {
  assert.match(source, /width:\s*\{\s*ideal:\s*1280/);
  assert.match(source, /height:\s*\{\s*ideal:\s*720/);
  assert.match(source, /delayBetweenScanAttempts:\s*55/);
  assert.match(source, /TRY_HARDER/);
  assert.match(source, /正在识别二维码/);
  assert.match(source, /请继续扫下一位/);
});

test("scanner overlay exposes a processing state without changing success styling", () => {
  assert.match(page, /#result\.processing strong/);
  assert.match(page, /#result\.success strong/);
  assert.match(page, /aria-live="assertive"/);
});

test("scanner provides an image fallback when live camera recognition is difficult", () => {
  assert.match(page, /id="qr-image"/);
  assert.match(source, /decodeFromImageElement/);
  assert.match(source, /正在读取电子票 QR 图片/);
});
