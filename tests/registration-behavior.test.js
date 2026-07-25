import test from "node:test";
import assert from "node:assert/strict";
import { getVisibleActivities } from "../public/js/event-list-flow.js";
import { getRegistrationAvailability, getSeatModeState, validateRegistrationDraft } from "../public/js/registration-flow.js";

const serverNow = Date.parse("2026-07-26T10:00:00+08:00");

test("activity visibility hides private statuses and only open activities can register", () => {
  const activities = [
    { id: "draft", status: "draft" }, { id: "archive", status: "archived" },
    { id: "open", status: "open" }, { id: "live", status: "live" }, { id: "cancelled", status: "cancelled" }
  ];
  assert.deepEqual(getVisibleActivities(activities).map(({ id, canRegister }) => [id, canRegister]), [
    ["open", true], ["live", false], ["cancelled", false]
  ]);
});

test("server-timed registration gates upcoming, open, and expired events without resetting the clock", () => {
  const event = { status: "upcoming", opensAt: "2026-07-26T10:10:00+08:00", closesAt: "2026-07-26T12:00:00+08:00" };
  assert.deepEqual(getRegistrationAvailability(event, serverNow), {
    phase: "upcoming", canRegister: false, countdownTarget: Date.parse(event.opensAt), countdownKind: "opens"
  });
  assert.equal(getRegistrationAvailability({ ...event, status: "open", opensAt: "2026-07-26T09:00:00+08:00" }, serverNow).canRegister, true);
  assert.deepEqual(getRegistrationAvailability({ ...event, status: "open", closesAt: "2026-07-26T09:59:00+08:00" }, serverNow).phase, "closed");
});

test("seat modes expose whether a participant must make a choice", () => {
  assert.deepEqual(getSeatModeState("none"), { mode: "none", requiresSelection: false, label: "自由入座" });
  assert.deepEqual(getSeatModeState("auto"), { mode: "auto", requiresSelection: false, label: "系统分配" });
  assert.equal(getSeatModeState("self").requiresSelection, true);
  assert.equal(getSeatModeState("zone").requiresSelection, true);
});

test("review validation delegates session and answer rules and fails closed after closing time", () => {
  const event = {
    status: "open", opensAt: "2026-07-26T09:00:00+08:00", closesAt: "2026-07-26T12:00:00+08:00", minChoices: 1, maxChoices: 1, seatMode: "self",
    sessions: [{ id: "talk", required: true }], fields: [{ id: "name", label: "姓名", required: true, type: "text" }]
  };
  const invalid = validateRegistrationDraft(event, [], null, { name: "" }, serverNow);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /至少选择|必选/);
  assert.match(invalid.errors.join(" "), /姓名/);
  assert.match(invalid.errors.join(" "), /座位/);
  const expired = validateRegistrationDraft(event, ["talk"], "A-01", { name: "陈晓明" }, Date.parse("2026-07-26T12:00:00+08:00"));
  assert.equal(expired.valid, false);
  assert.match(expired.errors.join(" "), /未开放|截止/);
});
