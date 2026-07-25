import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readPublicFile = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

test("participant pages provide the labelled registration regions and every supported field control", async () => {
  const [index, register] = await Promise.all([readPublicFile("index.html"), readPublicFile("register.html")]);
  const markup = `${index}\n${register}`;

  for (const region of ["<main", "activity-list", "registration-form", "error-summary", "confirmation", "submit-registration"]) {
    assert.match(markup, new RegExp(region));
  }
  for (const step of ["选择活动", "选择讲座", "选择座位", "填写资料", "确认提交"]) {
    assert.match(markup, new RegExp(step));
  }
  for (const type of ["text", "textarea", "number", "tel", "email", "date", "radio", "checkbox", "select", "boolean"]) {
    assert.match(markup, new RegExp(`data-field-type=[\"']${type}[\"']`));
  }
});

test("participant scripts handle public statuses, seat modes, server clock countdowns, and domain validation", async () => {
  const [indexScript, registerScript] = await Promise.all([
    readPublicFile("js/index-page.js"),
    readPublicFile("js/register-page.js")
  ]);
  const source = `${indexScript}\n${registerScript}`;

  for (const status of ["upcoming", "open", "closed", "live", "ended", "cancelled"]) {
    assert.match(source, new RegExp(`[\"']${status}[\"']`));
  }
  for (const seatMode of ["none", "self", "auto", "zone"]) {
    assert.match(source, new RegExp(`\\b${seatMode}\\s*:`));
  }
  for (const dependency of ["getEventCapability", "validateSelection", "validateAnswers", "serverNow"]) {
    assert.match(source, new RegExp(dependency));
  }
});
