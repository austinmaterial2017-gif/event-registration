import test from "node:test";
import assert from "node:assert/strict";
import { validateSelection, validateAnswers, getEventCapability } from "../public/js/domain.js";

test("required and optional fields are enforced", () => {
  const fields = [
    { id: "name", label: "姓名", required: true, type: "text" },
    { id: "phone", label: "电话", required: false, type: "tel" }
  ];
  assert.equal(validateAnswers(fields, { name: "", phone: "" }).valid, false);
  assert.equal(validateAnswers(fields, { name: "陈小明", phone: "" }).valid, true);
});

test("part-required selection rejects time conflicts", () => {
  const event = { selectionMode: "mixed", minChoices: 2, maxChoices: 3 };
  const sessions = [
    { id: "required", required: true, startsAt: "2026-08-01T08:00:00+08:00", endsAt: "2026-08-01T09:00:00+08:00" },
    { id: "conflict", required: false, startsAt: "2026-08-01T08:30:00+08:00", endsAt: "2026-08-01T09:30:00+08:00" }
  ];
  assert.equal(validateSelection(event, sessions, ["required", "conflict"]).valid, false);
});

test("ended events remain visible but cannot register or check in", () => {
  assert.deepEqual(getEventCapability("ended"), { visible: true, canRegister: false, canCheckIn: false });
});

test("every event status exposes only its allowed capabilities", () => {
  const expected = {
    draft: { visible: false, canRegister: false, canCheckIn: false },
    upcoming: { visible: true, canRegister: false, canCheckIn: false },
    open: { visible: true, canRegister: true, canCheckIn: false },
    closed: { visible: true, canRegister: false, canCheckIn: false },
    live: { visible: true, canRegister: false, canCheckIn: true },
    ended: { visible: true, canRegister: false, canCheckIn: false },
    cancelled: { visible: true, canRegister: false, canCheckIn: false },
    archived: { visible: false, canRegister: false, canCheckIn: false }
  };

  for (const [status, capability] of Object.entries(expected)) {
    assert.deepEqual(getEventCapability(status), capability);
  }
});

test("selection rejects duplicate and unknown session IDs", () => {
  const event = { minChoices: 0, maxChoices: 3 };
  const sessions = [{ id: "workshop", required: false }];

  const duplicate = validateSelection(event, sessions, ["workshop", "workshop"]);
  const unknown = validateSelection(event, sessions, ["missing"]);

  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join(""), /重复/);
  assert.equal(unknown.valid, false);
  assert.match(unknown.errors.join(""), /不存在/);
});

test("selection requires mandatory sessions and honors choice bounds", () => {
  const event = { minChoices: 2, maxChoices: 2 };
  const sessions = [
    { id: "opening", required: true },
    { id: "a", required: false },
    { id: "b", required: false }
  ];

  const missingRequired = validateSelection(event, sessions, ["a", "b"]);
  const belowMinimum = validateSelection(event, sessions, ["opening"]);
  const aboveMaximum = validateSelection(event, sessions, ["opening", "a", "b"]);

  assert.equal(missingRequired.valid, false);
  assert.match(missingRequired.errors.join(""), /必选/);
  assert.equal(belowMinimum.valid, false);
  assert.match(belowMinimum.errors.join(""), /至少选择 2/);
  assert.equal(aboveMaximum.valid, false);
  assert.match(aboveMaximum.errors.join(""), /最多选择 2/);
});

test("adjacent sessions do not conflict, but malformed schedules are rejected", () => {
  const event = { minChoices: 0, maxChoices: 3 };
  const adjacent = [
    { id: "first", required: false, startsAt: "2026-08-01T08:00:00+08:00", endsAt: "2026-08-01T09:00:00+08:00" },
    { id: "next", required: false, startsAt: "2026-08-01T09:00:00+08:00", endsAt: "2026-08-01T10:00:00+08:00" }
  ];
  const malformed = [{ id: "bad", required: false, startsAt: "2026-02-30T08:00:00+08:00", endsAt: "2026-02-30T09:00:00+08:00" }];

  assert.equal(validateSelection(event, adjacent, ["first", "next"]).valid, true);
  const result = validateSelection(event, malformed, ["bad"]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(""), /时间格式/);
});

test("required checkbox answers need a selection and required text ignores whitespace", () => {
  const fields = [
    { id: "agreement", label: "同意条款", required: true, type: "checkbox" },
    { id: "name", label: "姓名", required: true, type: "text" }
  ];

  const missing = validateAnswers(fields, { agreement: [], name: "   " });
  const complete = validateAnswers(fields, { agreement: ["agreed"], name: "李华" });

  assert.equal(missing.valid, false);
  assert.deepEqual(Object.keys(missing.errors).sort(), ["agreement", "name"]);
  assert.equal(complete.valid, true);
});

test("question constraints and session topic groups match the server contract", () => {
  const fields = [
    {
      id: "name", label: "Name", type: "text", required: true,
      constraints: { minLength: 3, maxLength: 8, pattern: "^[A-Za-z]+$" }
    },
    {
      id: "topics", label: "Topics", type: "checkbox", required: true,
      options: ["A", "B", "C"],
      constraints: { minSelections: 2, maxSelections: 2 }
    }
  ];
  assert.equal(validateAnswers(fields, { name: "Al", topics: ["A", "B"] }).valid, false);
  assert.equal(validateAnswers(fields, { name: "Alice1", topics: ["A", "B"] }).valid, false);
  assert.equal(validateAnswers(fields, { name: "Alice", topics: ["A"] }).valid, false);
  assert.equal(validateAnswers(fields, { name: "Alice", topics: ["A", "X"] }).valid, false);
  assert.equal(validateAnswers(fields, { name: "Alice", topics: ["A", "B"] }).valid, true);

  const sessions = [
    { id: "a1", groupRule: { id: "topic-a", min: 1, max: 1 } },
    { id: "a2", groupRule: { id: "topic-a", min: 1, max: 1 } }
  ];
  assert.equal(validateSelection({ minChoices: 1, maxChoices: 2 }, sessions, []).valid, false);
  assert.equal(validateSelection({ minChoices: 1, maxChoices: 2 }, sessions, ["a1", "a2"]).valid, false);
  assert.equal(validateSelection({ minChoices: 1, maxChoices: 2 }, sessions, ["a2"]).valid, true);
});
