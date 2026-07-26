import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const staffScriptRoot = new URL("../staff-apps-script/", import.meta.url);

const headers = {
  "系统设置": ["key", "value", "updatedAt"],
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "sessionId", "checkedInAt", "checkedInBy", "status"],
  "操作记录": ["auditId", "action", "entityType", "entityId", "actor", "details", "createdAt"]
};

class FakeSheet {
  constructor(name, records = []) {
    this.name = name;
    this.rows = [headers[name], ...records.map((record) => headers[name].map((key) => record[key] ?? ""))];
    this.writeCount = 0;
  }

  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return headers[this.name].length; }
  appendRow(values) {
    this.writeCount += 1;
    this.rows.push([...values]);
  }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, y) =>
        Array.from({ length: columnCount }, (_, x) => this.rows[row - 1 + y]?.[column - 1 + x] ?? "")),
      setValues: (values) => {
        this.writeCount += 1;
        values.forEach((source, y) => {
          const target = this.rows[row - 1 + y] || [];
          source.forEach((value, x) => { target[column - 1 + x] = value; });
          this.rows[row - 1 + y] = target;
        });
      }
    };
  }
}

function baseRows() {
  return {
    "系统设置": [],
    "活动": [{
      eventId: "event-1", title: "Ideas Forum", description: "Private notes stay private",
      status: "open", opensAt: "2026-08-01T00:00:00Z", closesAt: "2026-08-15T00:00:00Z",
      location: "Main Hall", selectionMode: "free", minChoices: 1, maxChoices: 2,
      seatMode: "self", seatZones: JSON.stringify(["A"]), createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    }],
    "场次": [{
      sessionId: "session-1", eventId: "event-1", title: "Opening", speaker: "Dr Lin",
      startsAt: "2026-08-16T09:00:00Z", endsAt: "2026-08-16T10:00:00Z",
      required: true, capacity: 50, status: "open",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }],
    "座位": [
      {
        seatId: "seat-old", eventId: "event-1", sessionId: "session-1", label: "A-01",
        zone: "A", status: "registered", holderRegistrationId: "registration-1",
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      },
      {
        seatId: "seat-new", eventId: "event-1", sessionId: "session-1", label: "A-02",
        zone: "A", status: "available", holderRegistrationId: "",
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    "报名问题": [{
      questionId: "email", eventId: "event-1", label: "Email", type: "email", required: true,
      options: "{}", sortOrder: 1, status: "active",
      createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
    }],
    "参加者": [{
      participantId: "person-1", name: "Alice Chan", phone: "0123456789",
      email: "alice@example.com", createdAt: "2026-07-01T00:00:00Z",
      updatedAt: "2026-07-01T00:00:00Z"
    }],
    "报名项目": [
      {
        registrationId: "registration-1", eventId: "event-1", participantId: "person-1",
        ticketNumber: "EVT-PRIVATE-001", status: "active",
        sessionIds: JSON.stringify(["session-1"]), seatChoices: JSON.stringify(["seat-old"]),
        answers: JSON.stringify({
          values: { email: "alice@example.com", privateNote: "secret answer" },
          ticketToken: "opaque-private-ticket-token",
          verificationField: "email"
        }),
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      },
      {
        registrationId: "registration-1", eventId: "event-1", participantId: "person-1",
        ticketNumber: "EVT-PRIVATE-001", status: "active",
        sessionIds: JSON.stringify(["session-1"]), seatChoices: JSON.stringify(["seat-old"]),
        answers: JSON.stringify({
          values: { email: "alice@example.com", privateNote: "secret answer" },
          ticketToken: "opaque-private-ticket-token",
          verificationField: "email"
        }),
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z"
      }
    ],
    "签到记录": [{
      checkInId: "check-1", registrationId: "registration-1", eventId: "event-1",
      sessionId: "session-1", checkedInAt: "2026-08-16T09:05:00Z",
      checkedInBy: "staff@example.com", status: "checked_in"
    }],
    "操作记录": []
  };
}

function records(sheet) {
  return sheet.rows.slice(1).map((values) =>
    Object.fromEntries(headers[sheet.name].map((key, index) => [key, values[index]])));
}

function cloneRows(rows) {
  return Object.fromEntries(Object.entries(rows).map(([name, values]) =>
    [name, values.map((value) => ({ ...value }))]));
}

async function createHarness(options = {}) {
  const properties = {
    ACTIVE_SPREADSHEET_ID: "source-sheet-id",
    ADMIN_EMAIL_ALLOWLIST: JSON.stringify(options.adminAllowlist || ["admin@example.com"]),
    ADMIN_SETTINGS: JSON.stringify({
      registration: {
        identityFields: ["email"],
        events: {
          "event-1": {
            seatExchangeEnabled: true,
            cancellationEnabled: true,
            showOpeningCountdown: true,
            showClosingCountdown: true,
            identityFields: ["email"],
            showOnTicketFields: []
          }
        }
      }
    })
  };
  const sourceSheets = Object.fromEntries(Object.entries(cloneRows(options.rows || baseRows()))
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const targetSheets = Object.fromEntries(Object.entries(cloneRows(options.targetRows || baseRows()))
    .map(([name, values]) => [name, new FakeSheet(name, values)]));
  const spreadsheets = {
    "source-sheet-id": {
      getId: () => "source-sheet-id",
      getName: () => "Source Registration Data",
      getSheetByName: (name) => sourceSheets[name] || null
    },
    "target-sheet-id": {
      getId: () => "target-sheet-id",
      getName: () => "Target Registration Data",
      getSheetByName: (name) => targetSheets[name] || null
    }
  };
  const locks = [];
  let lockDepth = 0;
  let uuid = 0;
  const RealDate = Date;
  class ServerDate extends RealDate {
    constructor(value) { super(value === undefined ? "2026-07-26T04:00:00Z" : value); }
    static now() { return RealDate.parse("2026-07-26T04:00:00Z"); }
  }
  const context = vm.createContext({
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite, Date: ServerDate,
    Session: {
      getActiveUser: () => ({ getEmail: () => options.sessionEmail || "admin@example.com" })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties[key] ?? null,
        setProperty: (key, value) => { properties[key] = value; }
      })
    },
    SpreadsheetApp: {
      openById: (spreadsheetId) => {
        if (!spreadsheets[spreadsheetId]) throw new Error("missing spreadsheet");
        return spreadsheets[spreadsheetId];
      }
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockDepth, 0, "nested lock");
          lockDepth += 1;
          locks.push("acquire");
        },
        releaseLock: () => {
          locks.push("release");
          lockDepth -= 1;
        }
      })
    },
    Utilities: {
      getUuid: () => `generated-${++uuid}`
    }
  });
  for (const file of ["Repository.gs", "AdminService.gs"]) {
    vm.runInContext(await readFile(new URL(file, staffScriptRoot), "utf8"), context, { filename: file });
  }
  return { context, properties, sourceSheets, targetSheets, locks };
}

test("event lifecycle changes preserve every related history row and save advanced policy", async () => {
  const harness = await createHarness();
  const before = Object.fromEntries(Object.entries(harness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));

  const archived = harness.context.saveAdminEvent({ eventId: "event-1", action: "archive" });
  assert.equal(archived.ok, true);
  assert.equal(archived.data.status, "archived");

  const closed = harness.context.saveAdminEvent({
    eventId: "event-1",
    action: "close",
    cancellationEnabled: false,
    seatExchangeEnabled: false,
    showOpeningCountdown: false,
    showClosingCountdown: true
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.data.status, "ended");

  for (const name of ["场次", "座位", "报名问题", "参加者", "报名项目", "签到记录"]) {
    assert.equal(harness.sourceSheets[name].rows.length, before[name], name);
  }
  const eventSettings = JSON.parse(harness.properties.ADMIN_SETTINGS).registration.events["event-1"];
  assert.equal(eventSettings.cancellationEnabled, false);
  assert.equal(eventSettings.seatExchangeEnabled, false);
  assert.equal(eventSettings.showOpeningCountdown, false);
  assert.equal(eventSettings.showClosingCountdown, true);
});

test("reopen requires explicit confirmation and reports the existing unique registration count", async () => {
  const harness = await createHarness();

  const denied = harness.context.saveAdminEvent({ eventId: "event-1", action: "reopen" });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "CONFIRMATION_REQUIRED");

  const reopened = harness.context.saveAdminEvent({
    eventId: "event-1",
    action: "reopen",
    confirm: true
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.data.status, "open");
  assert.equal(reopened.data.registrationCount, 1);
  assert.equal(records(harness.sourceSheets["报名项目"]).length, 2);
});

test("event, session, and question CRUD validate supported values and retain extended rules", async () => {
  const harness = await createHarness();
  const createdEvent = harness.context.saveAdminEvent({
    title: "New Event",
    description: "Description",
    status: "draft",
    opensAt: "2026-09-01T00:00:00Z",
    closesAt: "2026-09-10T00:00:00Z",
    location: "Auditorium",
    selectionMode: "mixed",
    minChoices: 1,
    maxChoices: 3,
    seatMode: "zone",
    seatZones: ["North", "South"],
    cancellationEnabled: true,
    seatExchangeEnabled: true
  });
  assert.equal(createdEvent.ok, true);
  assert.equal(createdEvent.data.status, "draft");

  const eventId = createdEvent.data.eventId;
  const session = harness.context.saveAdminSession({
    eventId,
    title: "Keynote",
    speaker: "Professor Wu",
    startsAt: "2026-09-11T09:00:00Z",
    endsAt: "2026-09-11T10:00:00Z",
    location: "Room 3",
    capacity: 120,
    required: true,
    groupRule: "group-a",
    status: "open"
  });
  assert.equal(session.ok, true);
  assert.equal(session.data.location, "Room 3");
  assert.equal(session.data.groupRule, "group-a");

  const question = harness.context.saveAdminQuestion({
    eventId,
    label: "Meal",
    type: "select",
    required: false,
    options: ["Vegetarian", "Standard"],
    validation: { minLength: 2 },
    sortOrder: 3,
    status: "active",
    showOnTicket: true,
    duplicateIdentity: true
  });
  assert.equal(question.ok, true);
  assert.equal(question.data.type, "select");
  assert.equal(question.data.showOnTicket, true);
  assert.equal(question.data.duplicateIdentity, true);

  const invalidStatus = harness.context.saveAdminEvent({ eventId, status: "deleted" });
  const invalidType = harness.context.saveAdminQuestion({ eventId, label: "Bad", type: "password" });
  assert.equal(invalidStatus.code, "INVALID_REQUEST");
  assert.equal(invalidType.code, "INVALID_REQUEST");
});

test("seat plans cover every mode and reserve, close, and reopen seats without deleting rows", async () => {
  const harness = await createHarness();
  for (const mode of ["none", "self", "auto", "zone"]) {
    const result = harness.context.saveAdminSeatPlan({
      eventId: "event-1",
      action: "generate",
      mode,
      sessionId: "session-1",
      zones: mode === "zone"
        ? [{ name: "Balcony", rows: 1, seatsPerRow: 2 }]
        : [{ name: "", rows: mode === "none" ? 0 : 1, seatsPerRow: mode === "none" ? 0 : 1 }]
    });
    assert.equal(result.ok, true, mode);
    assert.equal(result.data.mode, mode);
  }

  const seatsAfterGeneration = records(harness.sourceSheets["座位"]);
  const generated = seatsAfterGeneration.find((seat) => seat.label === "Balcony-1-1");
  assert.ok(generated);
  const count = seatsAfterGeneration.length;

  assert.equal(harness.context.saveAdminSeatPlan({ action: "reserve", seatId: generated.seatId }).data.status, "reserved");
  assert.equal(harness.context.saveAdminSeatPlan({ action: "close", seatId: generated.seatId }).data.status, "closed");
  assert.equal(harness.context.saveAdminSeatPlan({ action: "reopen", seatId: generated.seatId }).data.status, "available");
  assert.equal(records(harness.sourceSheets["座位"]).length, count);
});

test("dashboard search masks participant fields and answers while returning attendance", async () => {
  const harness = await createHarness();
  const result = harness.context.getAdminDashboard({ search: "alice@example.com" });

  assert.equal(result.ok, true);
  assert.equal(result.data.connection.connected, true);
  assert.equal(result.data.records.length, 1);
  assert.equal(result.data.attendance.length, 1);
  const serialized = JSON.stringify(result.data);
  assert.match(result.data.records[0].participantName, /\*/);
  assert.doesNotMatch(serialized, /Alice Chan|0123456789|alice@example\.com|secret answer|opaque-private-ticket-token/);
  assert.doesNotMatch(serialized, /source-sheet-id|rowNumber/);
});

test("record cancellation and seat adjustment preserve rows and append auditable state changes", async () => {
  const cancellationHarness = await createHarness();
  const cancellationCounts = Object.fromEntries(Object.entries(cancellationHarness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));
  const cancelled = cancellationHarness.context.adminRecordAction({
    action: "cancel_registration",
    registrationId: "registration-1",
    confirm: true
  });
  assert.equal(cancelled.ok, true);
  assert.ok(records(cancellationHarness.sourceSheets["报名项目"]).every((row) => row.status === "cancelled"));
  assert.equal(records(cancellationHarness.sourceSheets["座位"])[0].status, "available");
  for (const name of ["参加者", "报名项目", "签到记录"]) {
    assert.equal(cancellationHarness.sourceSheets[name].rows.length, cancellationCounts[name], name);
  }

  const adjustmentHarness = await createHarness();
  const adjusted = adjustmentHarness.context.adminRecordAction({
    action: "adjust_seat",
    registrationId: "registration-1",
    seatId: "seat-new",
    confirm: true
  });
  assert.equal(adjusted.ok, true);
  const seats = records(adjustmentHarness.sourceSheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "seat-old").status, "available");
  assert.equal(seats.find((seat) => seat.seatId === "seat-new").holderRegistrationId, "registration-1");
  assert.ok(records(adjustmentHarness.sourceSheets["报名项目"])
    .every((row) => JSON.parse(row.seatChoices).includes("seat-new")));
  assert.ok(records(adjustmentHarness.sourceSheets["操作记录"]).length >= 1);
});

test("connection testing validates the target without returning or activating its Sheet ID", async () => {
  const harness = await createHarness();
  const sourceId = harness.properties.ACTIVE_SPREADSHEET_ID;

  const result = harness.context.testAdminSheetConnection({ spreadsheetId: "target-sheet-id" });

  assert.equal(result.ok, true);
  assert.equal(result.data.connected, true);
  assert.equal(result.data.sheetName, "Target Registration Data");
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, sourceId);
  assert.equal(JSON.stringify(result).includes("target-sheet-id"), false);
  assert.equal(harness.context.testAdminSheetConnection({ spreadsheetId: "missing" }).code, "SHEET_CONNECTION_FAILED");
});

test("Sheet switching requires confirmation and changes only the active property", async () => {
  const harness = await createHarness();
  const sourceCounts = Object.fromEntries(Object.entries(harness.sourceSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));
  const targetCounts = Object.fromEntries(Object.entries(harness.targetSheets)
    .map(([name, sheet]) => [name, sheet.rows.length]));

  const denied = harness.context.switchAdminSheet({ spreadsheetId: "target-sheet-id" });
  assert.equal(denied.code, "CONFIRMATION_REQUIRED");
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, "source-sheet-id");

  const switched = harness.context.switchAdminSheet({
    spreadsheetId: "target-sheet-id",
    confirm: true
  });
  assert.equal(switched.ok, true);
  assert.equal(switched.data.connected, true);
  assert.match(switched.data.warning, /旧数据.*保留/);
  assert.match(switched.data.warning, /不会自动迁移/);
  assert.equal(harness.properties.ACTIVE_SPREADSHEET_ID, "target-sheet-id");
  assert.equal(JSON.stringify(switched).includes("target-sheet-id"), false);

  for (const [name, count] of Object.entries(sourceCounts)) {
    assert.equal(harness.sourceSheets[name].rows.length, count, `source ${name}`);
  }
  for (const [name, count] of Object.entries(targetCounts)) {
    assert.equal(harness.targetSheets[name].rows.length, count, `target ${name}`);
  }
});
