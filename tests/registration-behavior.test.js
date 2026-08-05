import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getActivityCountdown, getVisibleActivities } from "../public/js/event-list-flow.js";
import { applyRegistrationGate, getFieldControlSpec, getRegistrationAvailability, getSeatModeState, validateRegistrationDraft } from "../public/js/registration-flow.js";
import {
  buildSeatMapGroups,
  createSeatHoldOwner,
  formatSeatChoiceLabels,
  formatSelectedSessionLabels
} from "../public/js/register-page.js";

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

test("activity cards derive opening and closing countdowns from the supplied server time", () => {
  const upcoming = getActivityCountdown({ status: "upcoming", opensAt: "2026-07-26T10:05:00+08:00", closesAt: "2026-07-26T12:00:00+08:00" }, serverNow);
  const open = getActivityCountdown({ status: "open", opensAt: "2026-07-26T09:00:00+08:00", closesAt: "2026-07-26T10:05:00+08:00" }, serverNow);
  assert.deepEqual(upcoming, { kind: "opens", target: Date.parse("2026-07-26T10:05:00+08:00"), remainingMs: 300_000 });
  assert.deepEqual(open, { kind: "closes", target: Date.parse("2026-07-26T10:05:00+08:00"), remainingMs: 300_000 });
});

test("time gating restores only controls that were not intrinsically disabled", () => {
  const event = { status: "open", opensAt: "2026-07-26T09:00:00+08:00", closesAt: "2026-07-26T12:00:00+08:00" };
  const requiredSession = { disabled: true, dataset: { intrinsicDisabled: "true" } };
  const optionalSession = { disabled: false, dataset: {} };
  applyRegistrationGate(event, serverNow, [requiredSession, optionalSession]);
  assert.equal(requiredSession.disabled, true);
  assert.equal(optionalSession.disabled, false);
  applyRegistrationGate(event, Date.parse("2026-07-26T12:00:00+08:00"), [requiredSession, optionalSession]);
  assert.equal(requiredSession.disabled, true);
  assert.equal(optionalSession.disabled, true);
});

test("question control specifications cover all dynamically rendered field types", () => {
  const expected = { text: ["input", "text"], textarea: ["textarea", null], number: ["input", "number"], tel: ["input", "tel"], email: ["input", "email"], date: ["input", "date"], radio: ["input", "radio"], checkbox: ["input", "checkbox"], select: ["select", null], boolean: ["input", "checkbox"] };
  for (const [type, [tag, inputType]] of Object.entries(expected)) assert.deepEqual(getFieldControlSpec(type), { tag, inputType });
});

test("per-session seats require one choice each and hold owners use secure browser randomness", () => {
  const event = {
    status: "open",
    seatMode: "self",
    minChoices: 2,
    maxChoices: 2,
    sessions: [{ id: "a" }, { id: "b" }],
    seats: [
      { id: "a-1", sessionId: "a" },
      { id: "b-1", sessionId: "b" }
    ],
    fields: []
  };
  assert.equal(validateRegistrationDraft(
    event, ["a", "b"], ["a-1"], {}, serverNow
  ).valid, false);
  assert.equal(validateRegistrationDraft(
    event, ["a", "b"], ["a-1", "b-1"], {}, serverNow
  ).valid, true);
  assert.equal(
    createSeatHoldOwner({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }),
    "hold-00000000-0000-4000-8000-000000000001"
  );
});

test("seat map groups irregular rows without exposing unavailable seat owners", () => {
  const groups = buildSeatMapGroups([
    { id: "b1", label: "B-1-1", zone: "B", available: true },
    { id: "b3", label: "B-3-1", zone: "B", available: false },
    { id: "c1", label: "C-1-1", zone: "C", available: true },
    { id: "c2", label: "C-1-2", zone: "C", available: true }
  ]);

  assert.deepEqual(groups.map((group) => [
    group.zone,
    group.seats.map((seat) => [seat.id, seat.row, seat.column, seat.available])
  ]), [
    ["B", [["b1", 1, 1, true], ["b3", 3, 1, false]]],
    ["C", [["c1", 1, 1, true], ["c2", 1, 2, true]]]
  ]);
});

test("registration review shows human seat labels instead of internal seat ids", () => {
  const event = {
    seats: [
      { id: "7f6c7075-internal-id", label: "A区-1-2", zone: "A区" },
      { id: "another-internal-id", label: "A区-1-3", zone: "A区" }
    ]
  };
  assert.equal(
    formatSeatChoiceLabels(event, ["7f6c7075-internal-id"]),
    "A区-1-2"
  );
});

test("registration review identifies every selected teacher instead of showing subject codes only", () => {
  const event = {
    sessions: [
      {
        id: "mm-qiu",
        title: "MM",
        speaker: "邱老师",
        startsAt: "2026-08-15T13:00:00+08:00",
        endsAt: "2026-08-15T14:30:00+08:00"
      },
      {
        id: "sn-joanne",
        title: "SN",
        speaker: "JOANNE老师",
        startsAt: "2026-09-19T13:00:00+08:00",
        endsAt: "2026-09-19T14:30:00+08:00"
      }
    ]
  };

  assert.equal(
    formatSelectedSessionLabels(event, ["mm-qiu", "sn-joanne"]),
    "MM · 邱老师 · 8月15日 13:00–14:30、SN · JOANNE老师 · 9月19日 13:00–14:30"
  );
  assert.equal(
    formatSelectedSessionLabels({ sessions: [{ id: "pending", title: "BM", speaker: "瑄老师", startsAt: "", endsAt: "" }] }, ["pending"]),
    "BM · 瑄老师 · 时间待定"
  );
});

test("public markup retains the semantic participant regions and six ordered stages", async () => {
  const [html, indexHtml] = await Promise.all([
    readFile(new URL("../public/register.html", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8")
  ]);
  assert.ok(html.includes("<main class=\"registration-shell\">"));
  assert.ok(html.includes("<form id=\"registration-form\""));
  assert.ok(html.includes("id=\"error-summary\""));
  assert.ok(html.includes("id=\"review-card\""));
  const stageLabels = ["选择活动", "选择讲座", "选择座位", "填写资料", "核对资料", "提交报名"];
  let offset = 0;
  for (const label of stageLabels) { const found = html.indexOf(label, offset); assert.notEqual(found, -1); offset = found + label.length; }
  assert.ok(indexHtml.includes('id="activity-status" class="sr-only" aria-live="polite"'));
  assert.ok(!indexHtml.includes('id="activity-list" class="activity-list" aria-live='));
});

test("the public activity homepage offers a direct ticket recovery entry", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /href="ticket\.html"/);
  assert.match(html, /找回我的电子票/);
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
