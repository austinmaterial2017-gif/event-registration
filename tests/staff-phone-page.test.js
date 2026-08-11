import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("standalone phone page contains PIN, target choices, and one continuous camera control", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("public/staff-checkin.html", root), "utf8"),
    readFile(new URL("public/js/staff-checkin.js", root), "utf8")
  ]);

  for (const id of ["staff-pin", "staff-event", "staff-session", "staff-occurrence", "start-continuous-scan", "camera-preview"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /facingMode:\s*\{\s*ideal:\s*"environment"\s*\}/);
  assert.match(script, /decodeFromConstraints/);
  assert.doesNotMatch(script, /location\.replace|window\.top|returnUrl/);
});
