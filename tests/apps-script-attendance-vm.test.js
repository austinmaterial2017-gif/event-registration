import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const headers = {
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "sessionId", "checkedInAt", "checkedInBy", "status"]
};

class FakeSheet {
  constructor(name, records, writes) {
    this.name = name;
    this.rows = [headers[name], ...records.map((record) => headers[name].map((key) => record[key] ?? ""))];
    this.writes = writes;
  }
  getLastRow() { return this.rows.length; }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, y) =>
        Array.from({ length: columnCount }, (_, x) => this.rows[row - 1 + y]?.[column - 1 + x] ?? "")),
      setValues: (values) => {
        this.writes.push({ sheet: this.name, values });
        values.forEach((source, y) => {
          const target = this.rows[row - 1 + y] || [];
          source.forEach((value, x) => { target[column - 1 + x] = value; });
          this.rows[row - 1 + y] = target;
        });
      }
    };
  }
}

function fixture(overrides = {}) {
  const token = overrides.token || "opaque-token";
  return {
    token,
    rows: {
      "活动": [{
        eventId: "event-1", title: "Ideas", status: overrides.eventStatus || "live",
        location: "Main Hall", opensAt: "", closesAt: ""
      }],
      "场次": [
        {
          sessionId: "s1", eventId: "event-1", title: "One", speaker: "Lin",
          startsAt: "2026-08-16T09:00:00Z", endsAt: "2026-08-16T10:00:00Z",
          status: overrides.sessionStatus || "live"
        },
        {
          sessionId: "s2", eventId: "event-1", title: "Two", speaker: "Nan",
          startsAt: "2026-08-16T10:00:00Z", endsAt: "2026-08-16T11:00:00Z",
          status: overrides.sessionStatus || "live"
        }
      ],
      "座位": [
        { seatId: "seat-1", eventId: "event-1", sessionId: "s1", label: "A-01", holderRegistrationId: "reg-1", status: "registered" },
        { seatId: "seat-2", eventId: "event-1", sessionId: "s2", label: "B-02", holderRegistrationId: "reg-1", status: "registered" }
      ],
      "参加者": [{ participantId: "person-1", name: "Alice Chan", phone: "0123456789", email: "alice@example.com" }],
      "报名项目": [
        {
          registrationId: "reg-1", eventId: "event-1", participantId: "person-1", ticketNumber: "EVT-1",
          status: overrides.ticketStatus || "active", sessionIds: JSON.stringify(["s1"]),
          answers: JSON.stringify({ ticketToken: token, values: { email: "alice@example.com" } })
        },
        {
          registrationId: "reg-1", eventId: "event-1", participantId: "person-1", ticketNumber: "EVT-1",
          status: overrides.ticketStatus || "active", sessionIds: JSON.stringify(["s2"]),
          answers: JSON.stringify({ ticketToken: token, values: { email: "alice@example.com" } })
        }
      ],
      "签到记录": overrides.attendance || []
    }
  };
}

async function createHarness(options = {}) {
  const data = options.data || fixture();
  const writes = [];
  const locks = [];
  let lockDepth = 0;
  let uuid = 0;
  const sheets = Object.fromEntries(Object.entries(data.rows).map(([name, rows]) => [name, new FakeSheet(name, rows, writes)]));
  const spreadsheet = { getSheetByName: (name) => sheets[name] };
  const RealDate = Date;
  const now = options.now || "2026-08-16T09:30:00Z";
  class ServerDate extends RealDate {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return RealDate.parse(now); }
  }
  const context = vm.createContext({
    Date: ServerDate, JSON, Math, Object, Array, String, Number, RegExp, Error, isFinite,
    Utilities: { getUuid: () => `checkin-${++uuid}` },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === "ATTENDANCE_STAFF_ALLOWLIST"
          ? JSON.stringify(options.allowlist || ["staff@example.com"])
          : null
      })
    },
    getConfiguredSpreadsheet: () => spreadsheet,
    getRequiredSheet_: (_spreadsheet, name) => sheets[name],
    normalizeRow_: (name, row) => headers[name].map((key) => row[key] ?? ""),
    readRows: (name) => sheets[name].rows.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      ...Object.fromEntries(headers[name].map((key, column) => [key, values[column]]))
    })),
    withScriptLock: (callback) => {
      assert.equal(lockDepth, 0, "nested lock");
      lockDepth += 1;
      locks.push("acquire");
      try { return callback(); }
      finally { locks.push("release"); lockDepth -= 1; }
    }
  });
  vm.runInContext(await readFile(new URL("../apps-script/AttendanceService.gs", import.meta.url), "utf8"), context);
  return { context, sheets, writes, locks };
}

function rows(sheet) {
  return sheet.rows.slice(1).map((values) => Object.fromEntries(headers[sheet.name].map((key, index) => [key, values[index]])));
}

test("public verification is locked, read-only, masked, and returns only safe fields", async () => {
  const harness = await createHarness();
  const result = harness.context.verifyTicket({ token: "opaque-token" });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.data).sort(), ["event", "participantName", "seats", "sessions", "status"]);
  assert.match(result.data.participantName, /\*/);
  assert.equal(JSON.stringify(result.data).includes("alice@example.com"), false);
  assert.equal(JSON.stringify(result.data).includes("0123456789"), false);
  assert.equal(JSON.stringify(result.data).includes("opaque-token"), false);
  assert.equal(JSON.stringify(result.data).includes("rowNumber"), false);
  assert.equal(harness.writes.length, 0);
  assert.deepEqual(harness.locks, ["acquire", "release"]);
});

test("public verification reports cancellation and event-ended states without mutation", async () => {
  const cancelled = await createHarness({ data: fixture({ ticketStatus: "cancelled" }) });
  const ended = await createHarness({ data: fixture({ eventStatus: "ended" }) });

  assert.equal(cancelled.context.verifyTicket({ token: "opaque-token" }).data.status, "cancelled");
  assert.equal(ended.context.verifyTicket({ token: "opaque-token" }).data.status, "ended");
  assert.equal(cancelled.writes.length + ended.writes.length, 0);
});

test("check-in rejects identities outside the protected allowlist", async () => {
  const { context, writes } = await createHarness();
  const result = context.checkIn({ token: "opaque-token", sessionId: "s1", staffIdentity: "stranger@example.com" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STAFF_NOT_AUTHORIZED");
  assert.equal(writes.length, 0);
});

test("valid check-in writes server time once, duplicates only that session, and permits another registered session", async () => {
  const harness = await createHarness();
  const request = { token: "opaque-token", sessionId: "s1", staffIdentity: "STAFF@example.com" };

  const first = harness.context.checkIn(request);
  const duplicate = harness.context.checkIn(request);
  const otherSession = harness.context.checkIn({ ...request, sessionId: "s2" });

  assert.equal(first.ok, true);
  assert.equal(first.data.status, "checked_in");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, "ALREADY_CHECKED_IN");
  assert.equal(otherSession.ok, true);
  const attendance = rows(harness.sheets["签到记录"]);
  assert.deepEqual(attendance.map((row) => row.sessionId), ["s1", "s2"]);
  assert.ok(attendance.every((row) => row.checkedInAt === "2026-08-16T09:30:00.000Z"));
  assert.ok(attendance.every((row) => row.checkedInBy === "staff@example.com"));
});

test("serialized check-ins make a concurrent duplicate observe the first committed row", async () => {
  const harness = await createHarness();
  const request = { token: "opaque-token", sessionId: "s1", staffIdentity: "staff@example.com" };
  const results = [harness.context.checkIn(request), harness.context.checkIn(request)];

  assert.deepEqual(results.map((result) => result.ok), [true, false]);
  assert.equal(results[1].code, "ALREADY_CHECKED_IN");
  assert.deepEqual(harness.locks, ["acquire", "release", "acquire", "release"]);
  assert.equal(rows(harness.sheets["签到记录"]).length, 1);
});

test("check-in rejects inactive tickets, unregistered sessions, invalid status, and outside time policy", async () => {
  const cancelled = await createHarness({ data: fixture({ ticketStatus: "cancelled" }) });
  const invalidEvent = await createHarness({ data: fixture({ eventStatus: "open" }) });
  const outsideWindow = await createHarness({ now: "2026-08-16T12:00:00Z" });
  const request = { token: "opaque-token", sessionId: "s1", staffIdentity: "staff@example.com" };

  assert.equal(cancelled.context.checkIn(request).code, "TICKET_INACTIVE");
  assert.equal(invalidEvent.context.checkIn(request).code, "CHECK_IN_CLOSED");
  assert.equal(outsideWindow.context.checkIn(request).code, "CHECK_IN_CLOSED");
  assert.equal((await createHarness()).context.checkIn({ ...request, sessionId: "missing" }).code, "SESSION_NOT_REGISTERED");
});
