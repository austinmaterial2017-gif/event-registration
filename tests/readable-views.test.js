import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../apps-script/ReadableViews.gs", import.meta.url);

async function loadContext() {
  const context = vm.createContext({ JSON, Object, Array, String, Number, Date, Math });
  vm.runInContext(await readFile(sourceUrl, "utf8"), context, {
    filename: "ReadableViews.gs"
  });
  return context;
}

function sourceRows() {
  return {
    eventId: "event-1",
    participants: [
      { participantId: "p1", name: "Alice", phone: "0170000000" }
    ],
    questions: [
      { questionId: "q-name", label: "姓名", sortOrder: 1, status: "active" },
      { questionId: "q-phone", label: "电话号码", sortOrder: 2, status: "active" },
      { questionId: "q-transport", label: "交通", sortOrder: 3, status: "active" },
      { questionId: "q-address", label: "地址", sortOrder: 4, status: "active" }
    ],
    sessions: [
      { sessionId: "mm-a", eventId: "event-1", title: "MM A", speaker: "仲老师", status: "open" },
      { sessionId: "bi-a", eventId: "event-1", title: "BI A", speaker: "韩老师", status: "open" }
    ],
    seats: [
      { seatId: "seat-1", label: "A1", zone: "前区" }
    ],
    registrations: [
      {
        registrationId: "r1", eventId: "event-1", participantId: "p1",
        ticketNumber: "EVT-ONE", status: "active",
        sessionIds: JSON.stringify(["mm-a"]),
        seatChoices: JSON.stringify(["seat-1"]),
        answers: JSON.stringify({
          values: {
            "q-name": "Alice", "q-phone": "0170000000",
            "q-transport": "需要", "q-address": "Jalan 1"
          }
        }),
        createdAt: "2026-08-05T12:00:00.000Z"
      },
      {
        registrationId: "r1", eventId: "event-1", participantId: "p1",
        ticketNumber: "EVT-ONE", status: "active",
        sessionIds: JSON.stringify(["bi-a"]),
        seatChoices: JSON.stringify([]),
        answers: JSON.stringify({ values: {} }),
        createdAt: "2026-08-05T12:00:00.000Z"
      }
    ],
    attendance: [
      {
        registrationId: "r1", eventId: "event-1", sessionId: "mm-a",
        checkpointId: "checkpoint-1", checkpointLabel: "第一次",
        status: "checked_in", checkedInAt: "2026-08-06T01:00:00.000Z"
      }
    ],
    policy: {
      fieldRoles: { name: "q-name", phone: "q-phone" },
      sessions: {
        "mm-a": { groupRule: "MM", checkInMode: "manual", checkInCount: 2, checkInLabels: ["第一次", "第二次"] },
        "bi-a": { groupRule: "BI", checkInMode: "single", checkInCount: 1, checkInLabels: [""] }
      }
    }
  };
}

test("registration overview merges duplicated raw session rows into one readable participant row", async () => {
  const context = await loadContext();
  const view = context.buildReadableRegistrationOverview_(sourceRows());

  assert.deepEqual(Array.from(view.headers), [
    "报名状态", "姓名", "电话号码", "交通", "地址", "MM", "BI",
    "座位", "票号", "报名时间", "登记编号"
  ]);
  assert.deepEqual(Array.from(view.rows[0]), [
    "有效", "Alice", "0170000000", "需要", "Jalan 1", "仲老师", "韩老师",
    "前区 A1", "EVT-ONE", "2026-08-05T12:00:00.000Z", "r1"
  ]);
  assert.equal(view.rows.length, 1);
});

test("attendance overview creates every configured checkpoint and defaults missing ones to 未签到", async () => {
  const context = await loadContext();
  const view = context.buildReadableAttendanceOverview_(sourceRows());

  assert.deepEqual(Array.from(view.headers), [
    "报名状态", "姓名", "电话号码",
    "MM · 仲老师 · 第一次", "MM · 仲老师 · 第二次", "BI · 韩老师 · 签到",
    "票号", "登记编号"
  ]);
  assert.deepEqual(Array.from(view.rows[0]), [
    "有效", "Alice", "0170000000",
    "已签到 2026-08-06T01:00:00.000Z", "未签到", "未签到",
    "EVT-ONE", "r1"
  ]);
});

test("cancelled registrations remain visible and are clearly labelled without appearing signed in", async () => {
  const context = await loadContext();
  const rows = sourceRows();
  rows.registrations.forEach((registration) => { registration.status = "cancelled"; });

  const registrationView = context.buildReadableRegistrationOverview_(rows);
  const attendanceView = context.buildReadableAttendanceOverview_(rows);

  assert.equal(registrationView.rows[0][0], "已取消");
  assert.equal(attendanceView.rows[0][0], "已取消");
  assert.equal(attendanceView.rows[0][3], "已取消");
});
