import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const headers = {
  "票券索引": ["ticketNumber", "tokenDigest", "eventId", "registrationId", "status", "createdAt", "updatedAt"],
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
  "签到记录": ["checkInId", "registrationId", "eventId", "sessionId", "checkpointId", "checkpointLabel", "checkedInAt", "checkedInBy", "status"],
  "操作记录": ["auditId", "action", "entityType", "entityId", "actor", "details", "createdAt"]
};

const serviceRoot = new URL("../apps-script/", import.meta.url);

class FakeSheet {
  constructor(name, rows, hook) {
    this.name = name;
    this.rows = [headers[name].slice(), ...rows.map((row) => headers[name].map((key) => row[key] ?? ""))];
    this.hook = hook;
  }

  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0].length; }
  getName() { return this.name; }

  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => Array.from({ length: rowCount }, (_, rowOffset) =>
        Array.from({ length: columnCount }, (_, columnOffset) =>
          this.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? "")),
      setValues: (values) => {
        this.hook?.({ sheet: this, row, column, values });
        for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
          const target = this.rows[row - 1 + rowOffset] || [];
          for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
            target[column - 1 + columnOffset] = values[rowOffset][columnOffset];
          }
          this.rows[row - 1 + rowOffset] = target;
        }
      }
    };
  }

  appendRow(values) {
    this.hook?.({ sheet: this, row: this.rows.length + 1, column: 1, values: [values] });
    this.rows.push(values.slice());
  }

  deleteRow(row) {
    this.hook?.({ sheet: this, operation: "delete", row, count: 1, values: [] });
    this.rows.splice(row - 1, 1);
  }
  deleteRows(row, count) {
    this.hook?.({ sheet: this, operation: "delete", row, count, values: [] });
    this.rows.splice(row - 1, count);
  }
}

function baseRows(overrides = {}) {
  const event = {
    eventId: "event-1", title: "Ideas", status: "open",
    opensAt: "2000-01-01T00:00:00Z", closesAt: "2099-01-01T00:00:00Z",
    selectionMode: "mixed", minChoices: 1, maxChoices: 2, seatMode: "none"
  };
  const sessions = [
    { sessionId: "s1", eventId: "event-1", title: "One", startsAt: "2030-01-01T09:00:00Z", endsAt: "2030-01-01T10:00:00Z", required: false, capacity: 5, status: "open" },
    { sessionId: "s2", eventId: "event-1", title: "Two", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z", required: false, capacity: 5, status: "open" }
  ];
  const questions = [
    { questionId: "name", eventId: "event-1", label: "Name", type: "text", required: true, status: "active" },
    { questionId: "email", eventId: "event-1", label: "Email", type: "email", required: true, status: "active" },
    { questionId: "age", eventId: "event-1", label: "Age", type: "number", required: false, options: JSON.stringify({ min: 1, max: 120 }), status: "active" },
    { questionId: "privateNote", eventId: "event-1", label: "Private", type: "text", required: false, status: "active" }
  ];
  return {
    "活动": [{ ...event, ...(overrides.event || {}) }],
    "场次": overrides.sessions || sessions,
    "座位": overrides.seats || [],
    "报名问题": overrides.questions || questions,
    "参加者": overrides.participants || [],
    "报名项目": overrides.registrations || [],
    "签到记录": overrides.attendance || [],
    "操作记录": overrides.audits || []
  };
}

async function createHarness({
  rows = baseRows(),
  settings,
  onWrite,
  eventRowsById,
  registryRows = { "票券索引": [] }
} = {}) {
  const sheetsBySpreadsheet = new Map();
  const makeSpreadsheet = (id, sourceRows) => {
    const spreadsheetSheets = Object.fromEntries(Object.entries(sourceRows).map(([name, values]) =>
      [name, new FakeSheet(name, values, onWrite)]));
    const spreadsheet = {
      getId: () => id,
      getSheetByName: (name) => spreadsheetSheets[name]
    };
    sheetsBySpreadsheet.set(spreadsheet, spreadsheetSheets);
    return { spreadsheet, sheets: spreadsheetSheets };
  };
  const fallback = makeSpreadsheet("event-default", rows);
  const eventSpreadsheets = {};
  const eventSheetsById = {};
  Object.entries(eventRowsById || {}).forEach(([eventId, sourceRows]) => {
    const eventHarness = makeSpreadsheet(`sheet-${eventId}`, sourceRows);
    eventSpreadsheets[eventId] = eventHarness.spreadsheet;
    eventSheetsById[eventId] = eventHarness.sheets;
  });
  const firstEventId = Object.keys(eventSpreadsheets)[0];
  const spreadsheet = firstEventId ? eventSpreadsheets[firstEventId] : fallback.spreadsheet;
  const sheets = firstEventId ? eventSheetsById[firstEventId] : fallback.sheets;
  const registryHarness = makeSpreadsheet("registry", registryRows);
  const registry = registryHarness.spreadsheet;
  const locks = [];
  const routedEventIds = [];
  const routingFailure = (code) => {
    const error = new Error("private ticket routing failed");
    error.publicCode = code;
    throw error;
  };
  const getTicketRouteByNumber = (_registry, ticketNumber) => {
    const normalized = typeof ticketNumber === "string" ? ticketNumber.trim() : "";
    if (!normalized) routingFailure("TICKET_NOT_FOUND");
    const matches = sheetObjects(registryHarness.sheets["票券索引"])
      .filter((route) => route.ticketNumber === normalized);
    if (!matches.length) routingFailure("TICKET_NOT_FOUND");
    if (matches.length !== 1) routingFailure("INTEGRITY_ERROR");
    return matches[0];
  };
  const getTicketRouteByToken = (_registry, token) => {
    const normalized = typeof token === "string" ? token.trim() : "";
    if (!normalized) routingFailure("TICKET_NOT_FOUND");
    const digest = createHash("sha256").update(normalized).digest("hex");
    const matches = sheetObjects(registryHarness.sheets["票券索引"])
      .filter((route) => route.tokenDigest === digest);
    if (!matches.length) routingFailure("TICKET_NOT_FOUND");
    if (matches.length !== 1) routingFailure("INTEGRITY_ERROR");
    return matches[0];
  };
  let lockDepth = 0;
  let uuid = 0;
  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    isFinite,
    SHEET_DEFINITIONS: headers,
    Utilities: {
      getUuid: () => `${String(++uuid).padStart(8, "0")}-0000-4000-8000-000000000000`
    },
    getRegistrySpreadsheet_: () => registry,
    getConfiguredSpreadsheet: () => spreadsheet,
    getEventSpreadsheet_: (_registry, eventId) => {
      routedEventIds.push(eventId);
      return eventSpreadsheets[eventId] || spreadsheet;
    },
    getTicketRouteByNumber_: getTicketRouteByNumber,
    getTicketRouteByToken_: getTicketRouteByToken,
    digestTicketToken_: (token) => createHash("sha256").update(String(token || "").trim()).digest("hex"),
    upsertTicketRoute_: (_registry, route) => {
      const routeSheet = registryHarness.sheets["票券索引"];
      const existing = sheetObjects(routeSheet);
      if (existing.some((candidate) =>
        candidate.ticketNumber === route.ticketNumber &&
        (candidate.eventId !== route.eventId ||
          candidate.registrationId !== route.registrationId ||
          candidate.tokenDigest !== route.tokenDigest))) {
        const error = new Error("ticket route collision");
        error.publicCode = "INTEGRITY_ERROR";
        throw error;
      }
      if (existing.some((candidate) =>
        candidate.tokenDigest === route.tokenDigest &&
        candidate.ticketNumber !== route.ticketNumber)) {
        const error = new Error("ticket digest collision");
        error.publicCode = "INTEGRITY_ERROR";
        throw error;
      }
      const values = headers["票券索引"].map((key) => route[key] ?? "");
      routeSheet.getRange(routeSheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
      return route;
    },
    getSharedSettingValue_: () => null,
    requireNoSwitchMaintenance_: () => {},
    getRequiredSheet_: (targetSpreadsheet, name) =>
      (sheetsBySpreadsheet.get(targetSpreadsheet) || sheets)[name],
    normalizeRow_: (name, row) => headers[name].map((key) => row[key] ?? ""),
    readRows: (targetSpreadsheet, name) => {
      const targetSheets = sheetsBySpreadsheet.get(targetSpreadsheet) || sheets;
      return targetSheets[name].rows.slice(1).map((values, index) => ({
        rowNumber: index + 2,
        ...Object.fromEntries(headers[name].map((key, column) => [key, values[column]]))
      }));
    },
    getAdminSettings: () => settings || {
      registration: {
        identityFields: ["email"],
        verificationField: "email",
        seatHoldsEnabled: true,
        events: {
          "event-1": {
            cancellationEnabled: true,
            seatExchangeEnabled: true,
            seatHoldsEnabled: true
          }
        }
      }
    },
    withScriptLock: (callback) => {
      assert.equal(lockDepth, 0, "service attempted a nested lock");
      lockDepth += 1;
      locks.push("acquire");
      try { return callback(); }
      finally { lockDepth -= 1; locks.push("release"); }
    }
  });
  for (const file of ["RegistrationService.gs", "TicketService.gs"]) {
    vm.runInContext(await readFile(new URL(file, serviceRoot), "utf8"), context, { filename: file });
  }
  return {
    context,
    sheets,
    locks,
    routedEventIds,
    registry,
    registrySheets: registryHarness.sheets,
    eventSheetsById
  };
}

function registrationPayload(overrides = {}) {
  return {
    eventId: "event-1",
    sessionIds: ["s1"],
    seatChoices: [],
    answers: { name: "Alice Chan", email: "alice@example.com", age: "", privateNote: "do not expose" },
    ...overrides
  };
}

function sheetObjects(sheet) {
  return sheet.rows.slice(1).map((values) =>
    Object.fromEntries(headers[sheet.name].map((key, index) => [key, values[index]])));
}

function sheetWithHeader(harness, header) {
  return Object.values(harness.sheets).find((sheet) => headers[sheet.name].includes(header));
}

test("registration accepts a participant-visible upcoming session", async () => {
  const rows = baseRows({
    sessions: [{
      sessionId: "s1",
      eventId: "event-1",
      title: "Upcoming Session",
      startsAt: "2030-01-01T09:00:00Z",
      endsAt: "2030-01-01T10:00:00Z",
      required: false,
      capacity: 5,
      status: "upcoming"
    }]
  });
  const harness = await createHarness({ rows });

  const result = harness.context.createRegistration(registrationPayload());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(sheetObjects(sheetWithHeader(harness, "registrationId")).length, 1);
});

test("event total capacity rejects only new active registrations after the unique limit is reached", async () => {
  const settings = {
    registration: {
      identityFields: ["email"],
      verificationField: "email",
      events: { "event-1": { totalCapacity: 1 } }
    }
  };
  const harness = await createHarness({ settings });

  const first = harness.context.createRegistration(registrationPayload());
  const second = harness.context.createRegistration(registrationPayload({
    answers: { name: "Bob", email: "bob@example.com" }
  }));

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.code, "EVENT_CAPACITY_FULL");
  assert.equal(sheetObjects(sheetWithHeader(harness, "registrationId")).length, 1);
});

test("event total capacity counts unique active registrations and zero remains unlimited", async () => {
  const sharedRegistration = {
    registrationId: "existing-1",
    eventId: "event-1",
    participantId: "participant-1",
    ticketNumber: "EVT-EXISTING",
    status: "active",
    seatChoices: "[]",
    answers: JSON.stringify({ values: { email: "existing@example.com" } }),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z"
  };
  const rows = baseRows({
    registrations: [
      { ...sharedRegistration, sessionIds: '["s1"]' },
      { ...sharedRegistration, sessionIds: '["s2"]' },
      {
        ...sharedRegistration,
        registrationId: "cancelled-1",
        participantId: "participant-2",
        ticketNumber: "EVT-CANCELLED",
        status: "cancelled",
        sessionIds: '["s1"]',
        answers: JSON.stringify({ values: { email: "cancelled@example.com" } })
      }
    ]
  });
  const limited = await createHarness({
    rows,
    settings: {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { totalCapacity: 2 } }
      }
    }
  });
  const accepted = limited.context.createRegistration(registrationPayload());
  assert.equal(accepted.ok, true, JSON.stringify(accepted));

  const unlimited = await createHarness({
    settings: {
      registration: {
        identityFields: ["email"],
        events: { "event-1": { totalCapacity: 0 } }
      }
    }
  });
  assert.equal(unlimited.context.createRegistration(registrationPayload()).ok, true);
  assert.equal(unlimited.context.createRegistration(registrationPayload({
    answers: { name: "Bob", email: "bob@example.com" }
  })).ok, true);
});

function rowsForEvent(eventId, title) {
  const rows = baseRows({
    event: { eventId, title, selectionMode: "single", minChoices: 1, maxChoices: 1 },
    sessions: [{
      sessionId: `${eventId}-session`,
      eventId,
      title: `${title} Session`,
      startsAt: "2030-01-01T09:00:00Z",
      endsAt: "2030-01-01T10:00:00Z",
      required: false,
      capacity: 5,
      status: "open"
    }],
    questions: [
      { questionId: "name", eventId, label: "Name", type: "text", required: true, status: "active" },
      { questionId: "email", eventId, label: "Email", type: "email", required: true, status: "active" }
    ]
  });
  return rows;
}

test("registrations write only to their routed activity sheets and publish digest-only ticket routes", async () => {
  const harness = await createHarness({
    eventRowsById: {
      "event-a": rowsForEvent("event-a", "Activity A"),
      "event-b": rowsForEvent("event-b", "Activity B")
    }
  });

  const ticketA = harness.context.createRegistration(registrationPayload({
    eventId: "event-a",
    sessionIds: ["event-a-session"],
    answers: { name: "Alice", email: "alice@example.com" }
  }));
  const ticketB = harness.context.createRegistration(registrationPayload({
    eventId: "event-b",
    sessionIds: ["event-b-session"],
    answers: { name: "Bob", email: "bob@example.com" }
  }));

  assert.equal(ticketA.ok, true, JSON.stringify(ticketA));
  assert.equal(ticketB.ok, true, JSON.stringify(ticketB));
  assert.deepEqual(harness.routedEventIds, ["event-a", "event-b"]);
  assert.equal(sheetObjects(harness.eventSheetsById["event-a"]["报名项目"]).length, 1);
  assert.equal(sheetObjects(harness.eventSheetsById["event-b"]["报名项目"]).length, 1);
  const routes = sheetObjects(harness.registrySheets["票券索引"]);
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map((route) => route.eventId), ["event-a", "event-b"]);
  assert.ok(routes.every((route) => route.tokenDigest.length === 64));
  const serializedRoutes = JSON.stringify(routes);
  assert.equal(serializedRoutes.includes(ticketA.data.token), false);
  assert.equal(serializedRoutes.includes(ticketB.data.token), false);
  assert.equal(serializedRoutes.includes("alice@example.com"), false);
  assert.equal(serializedRoutes.includes("bob@example.com"), false);
});

test("owner ticket lookup resolves Sheet B from the private index without reading Sheet A", async () => {
  const harness = await createHarness({
    eventRowsById: {
      "event-a": rowsForEvent("event-a", "Activity A"),
      "event-b": rowsForEvent("event-b", "Activity B")
    }
  });
  harness.context.createRegistration(registrationPayload({
    eventId: "event-a",
    sessionIds: ["event-a-session"],
    answers: { name: "Alice", email: "alice@example.com" }
  }));
  const ticketB = harness.context.createRegistration(registrationPayload({
    eventId: "event-b",
    sessionIds: ["event-b-session"],
    answers: { name: "Bob", email: "bob@example.com" }
  }));
  harness.routedEventIds.length = 0;

  const lookup = harness.context.lookupTicket({
    ticketNumber: ticketB.data.ticketNumber,
    verificationValue: "bob@example.com"
  });

  assert.equal(lookup.ok, true, JSON.stringify(lookup));
  assert.equal(lookup.data.eventId, "event-b");
  assert.deepEqual(harness.routedEventIds, ["event-b"]);
});

test("a verified ticket owner can add and remove sessions without creating another ticket", async () => {
  const harness = await createHarness();
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
  assert.equal(created.ok, true, JSON.stringify(created));
  const originalToken = created.data.token;
  const routeSheet = sheetWithHeader({ sheets: harness.registrySheets }, "tokenDigest");
  const originalRoute = sheetObjects(routeSheet)[0];

  const added = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s1", "s2"],
    seatChoices: []
  });

  assert.equal(added.ok, true, JSON.stringify(added));
  assert.deepEqual(
    Array.from(added.data.sessions, (session) => session.sessionId).sort(),
    ["s1", "s2"]
  );
  assert.equal(added.data.registrationId, created.data.registrationId);
  assert.equal(added.data.ticketNumber, created.data.ticketNumber);
  assert.equal(added.data.token, originalToken);
  assert.equal(sheetObjects(routeSheet).length, 1);
  assert.deepEqual(sheetObjects(routeSheet)[0], originalRoute);

  const removed = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s2"],
    seatChoices: []
  });

  assert.equal(removed.ok, true, JSON.stringify(removed));
  assert.deepEqual(Array.from(removed.data.sessions, (session) => session.sessionId), ["s2"]);
  const records = sheetObjects(sheetWithHeader(harness, "sessionIds"));
  const activeSessionIds = records
    .filter((record) => record.status === "active")
    .flatMap((record) => JSON.parse(record.sessionIds));
  assert.deepEqual(activeSessionIds, ["s2"]);
  assert.ok(records.some((record) =>
    record.status === "cancelled" && JSON.parse(record.sessionIds).includes("s1")));
});

test("ticket session updates reject closed, required, full, and conflicting choices without mutation", async (t) => {
  await t.test("closed", async () => {
    const harness = await createHarness();
    const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
    harness.sheets["活动"].rows[1][5] = "2000-01-01T00:00:00Z";
    const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));
    const result = harness.context.updateRegistrationSessions({
      ticketNumber: created.data.ticketNumber,
      verificationValue: "alice@example.com",
      sessionIds: ["s1", "s2"],
      seatChoices: []
    });
    assert.equal(result.code, "REGISTRATION_UPDATE_CLOSED");
    assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
  });

  await t.test("required", async () => {
    const rows = baseRows();
    rows["场次"][0].required = true;
    const harness = await createHarness({ rows });
    const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
    const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));
    const result = harness.context.updateRegistrationSessions({
      ticketNumber: created.data.ticketNumber,
      verificationValue: "alice@example.com",
      sessionIds: ["s2"],
      seatChoices: []
    });
    assert.equal(result.code, "REQUIRED_SESSION");
    assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
  });

  await t.test("full", async () => {
    const rows = baseRows();
    rows["场次"][1].capacity = 1;
    const harness = await createHarness({ rows });
    const first = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
    const second = harness.context.createRegistration(registrationPayload({
      sessionIds: ["s2"],
      answers: { name: "Bob", email: "bob@example.com" }
    }));
    assert.equal(second.ok, true, JSON.stringify(second));
    const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));
    const result = harness.context.updateRegistrationSessions({
      ticketNumber: first.data.ticketNumber,
      verificationValue: "alice@example.com",
      sessionIds: ["s1", "s2"],
      seatChoices: []
    });
    assert.equal(result.code, "SESSION_FULL");
    assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
  });

  await t.test("conflict", async () => {
    const rows = baseRows();
    rows["场次"][1].startsAt = "2030-01-01T09:30:00Z";
    rows["场次"][1].endsAt = "2030-01-01T10:30:00Z";
    const harness = await createHarness({ rows });
    const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
    const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));
    const result = harness.context.updateRegistrationSessions({
      ticketNumber: created.data.ticketNumber,
      verificationValue: "alice@example.com",
      sessionIds: ["s1", "s2"],
      seatChoices: []
    });
    assert.equal(result.code, "SESSION_CONFLICT");
    assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
  });
});

test("ticket session updates claim and release per-session seats on the original ticket", async () => {
  const rows = baseRows({
    event: { seatMode: "self" },
    seats: [
      { seatId: "seat-s1", eventId: "event-1", sessionId: "s1", label: "A1", zone: "front", status: "available" },
      { seatId: "seat-s2", eventId: "event-1", sessionId: "s2", label: "B1", zone: "front", status: "available" }
    ]
  });
  const harness = await createHarness({ rows });
  const created = harness.context.createRegistration(registrationPayload({
    sessionIds: ["s1"],
    seatChoices: ["seat-s1"]
  }));
  assert.equal(created.ok, true, JSON.stringify(created));

  const added = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s1", "s2"],
    seatChoices: ["seat-s1", "seat-s2"],
    seatHoldOwner: ""
  });

  assert.equal(added.ok, true, JSON.stringify(added));
  assert.deepEqual(
    Array.from(added.data.seats, (seat) => seat.seatId).sort(),
    ["seat-s1", "seat-s2"]
  );
  let seats = sheetObjects(sheetWithHeader(harness, "seatId"));
  assert.ok(seats.every((seat) =>
    seat.status === "registered" && seat.holderRegistrationId === created.data.registrationId));

  const removed = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s2"],
    seatChoices: ["seat-s2"],
    seatHoldOwner: ""
  });

  assert.equal(removed.ok, true, JSON.stringify(removed));
  seats = sheetObjects(sheetWithHeader(harness, "seatId"));
  assert.deepEqual(
    seats.map((seat) => [seat.seatId, seat.status, seat.holderRegistrationId]),
    [["seat-s1", "available", ""], ["seat-s2", "registered", created.data.registrationId]]
  );
  assert.equal(removed.data.ticketNumber, created.data.ticketNumber);
  assert.equal(removed.data.token, created.data.token);
});

test("a failed session-update audit restores the original sessions and seats", async () => {
  let failUpdateAudit = false;
  const rows = baseRows({
    event: { seatMode: "self" },
    seats: [
      { seatId: "seat-s1", eventId: "event-1", sessionId: "s1", label: "A-1-1", zone: "A", status: "available" },
      { seatId: "seat-s2", eventId: "event-1", sessionId: "s2", label: "B-1-1", zone: "B", status: "available" }
    ]
  });
  const harness = await createHarness({
    rows,
    onWrite: ({ sheet, values }) => {
      if (failUpdateAudit && sheet.name === "操作记录" &&
          values[0]?.[1] === "UPDATE_REGISTRATION_SESSIONS") {
        failUpdateAudit = false;
        throw new Error("audit write failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({
    sessionIds: ["s1"],
    seatChoices: ["seat-s1"]
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  failUpdateAudit = true;

  const result = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s2"],
    seatChoices: ["seat-s2"]
  });

  assert.equal(result.code, "INTERNAL");
  const registrations = sheetObjects(sheetWithHeader(harness, "sessionIds"));
  assert.deepEqual(
    registrations.filter((record) => record.status === "active")
      .map((record) => JSON.parse(record.sessionIds)),
    [["s1"]]
  );
  const seats = sheetObjects(sheetWithHeader(harness, "seatId"));
  assert.equal(seats.find((seat) => seat.seatId === "seat-s1").holderRegistrationId, created.data.registrationId);
  assert.equal(seats.find((seat) => seat.seatId === "seat-s2").holderRegistrationId, "");
});

test("verified ticket projection exposes safe session-management choices before closing", async () => {
  const harness = await createHarness();
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
  const lookup = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });

  assert.equal(lookup.ok, true, JSON.stringify(lookup));
  assert.equal(lookup.data.capabilities.canManageSessions, true);
  assert.equal(lookup.data.sessionManagement.seatMode, "none");
  assert.deepEqual(
    Array.from(lookup.data.sessionManagement.sessions, (session) => [
      session.sessionId, session.selected, session.required
    ]),
    [["s1", true, false], ["s2", false, false]]
  );
  const serialized = JSON.stringify(lookup.data.sessionManagement);
  assert.equal(serialized.includes("alice@example.com"), false);
  assert.equal(serialized.includes("spreadsheet"), false);
  assert.equal(serialized.includes("holderRegistrationId"), false);
});

test("verified ticket management includes participant-visible upcoming sessions", async () => {
  const rows = baseRows();
  rows["场次"][1].status = "upcoming";
  const harness = await createHarness({ rows });
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
  const lookup = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });

  assert.equal(lookup.ok, true, JSON.stringify(lookup));
  assert.deepEqual(
    Array.from(lookup.data.sessionManagement.sessions, (session) => session.sessionId),
    ["s1", "s2"]
  );
});

test("verified ticket owner can add a participant-visible upcoming session", async () => {
  const rows = baseRows();
  rows["场次"][1].status = "upcoming";
  const harness = await createHarness({ rows });
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));

  const updated = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s1", "s2"],
    seatChoices: []
  });

  assert.equal(updated.ok, true, JSON.stringify(updated));
  assert.deepEqual(
    Array.from(updated.data.sessions, (session) => session.sessionId).sort(),
    ["s1", "s2"]
  );
});

test("a participant can recover one event ticket with activity, full name, and phone", async () => {
  const rows = baseRows({
    questions: [
      { questionId: "name-q", eventId: "event-1", label: "Name", type: "text", required: true, status: "active" },
      { questionId: "phone-q", eventId: "event-1", label: "Phone", type: "tel", required: true, status: "active" }
    ]
  });
  const harness = await createHarness({
    rows,
    settings: {
      registration: {
        identityFields: ["name-q", "phone-q"],
        verificationField: "name-q",
        events: {
          "event-1": {
            cancellationEnabled: true,
            fieldRoles: { name: "name-q", phone: "phone-q" }
          }
        }
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({
    answers: { "name-q": "Alice Chan", "phone-q": "0100000020" }
  }));
  harness.sheets["参加者"].rows[1][2] = 100000020;

  const recovered = harness.context.recoverTicket({
    eventId: "event-1",
    name: "Alice Chan",
    phone: "0100000020"
  });

  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.data.ticketNumber, created.data.ticketNumber);
  assert.equal(recovered.data.ownerVerificationRole, "name");
});

test("a session that has already started cannot be removed from a ticket", async () => {
  const rows = baseRows();
  rows["场次"][0].startsAt = "2001-01-01T09:00:00Z";
  rows["场次"][0].endsAt = "2001-01-01T10:00:00Z";
  const harness = await createHarness({ rows });
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
  assert.equal(created.ok, true, JSON.stringify(created));
  const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));

  const result = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s2"],
    seatChoices: []
  });

  assert.equal(result.code, "SESSION_STARTED");
  assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
});

test("a checked-in session cannot be removed from a ticket", async () => {
  const harness = await createHarness();
  const created = harness.context.createRegistration(registrationPayload({ sessionIds: ["s1"] }));
  assert.equal(created.ok, true, JSON.stringify(created));
  const attendance = sheetWithHeader(harness, "checkedInAt");
  attendance.rows.push(headers[attendance.name].map((key) => ({
    checkInId: "checkin-1",
    registrationId: created.data.registrationId,
    eventId: "event-1",
    sessionId: "s1",
    checkedInAt: "2026-07-28T10:00:00Z",
    checkedInBy: "staff@example.com",
    status: "checked_in"
  })[key] ?? ""));
  const lookup = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(
    lookup.data.sessionManagement.sessions.find(
      (session) => session.sessionId === "s1"
    ).disabledReason,
    "已经签到"
  );
  const before = JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds")));

  const result = harness.context.updateRegistrationSessions({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    sessionIds: ["s2"],
    seatChoices: []
  });

  assert.equal(result.code, "SESSION_CHECKED_IN");
  assert.equal(JSON.stringify(sheetObjects(sheetWithHeader(harness, "sessionIds"))), before);
});

test("ticket route publication failure compensates the activity registration and restores its seat", async () => {
  const eventRows = rowsForEvent("event-a", "Activity A");
  eventRows["活动"][0].seatMode = "self";
  eventRows["座位"].push({
    seatId: "seat-a1",
    eventId: "event-a",
    sessionId: "",
    label: "A1",
    zone: "front",
    status: "available"
  });
  const harness = await createHarness({
    eventRowsById: { "event-a": eventRows },
    onWrite: ({ sheet }) => {
      if (sheet.name === "票券索引") throw new Error("route publication failed");
    }
  });

  const failed = harness.context.createRegistration(registrationPayload({
    eventId: "event-a",
    sessionIds: ["event-a-session"],
    seatChoices: ["A1"],
    answers: { name: "Alice", email: "alice@example.com" }
  }));

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INTEGRITY_ERROR");
  assert.equal(sheetObjects(harness.eventSheetsById["event-a"]["参加者"]).length, 0);
  assert.equal(sheetObjects(harness.eventSheetsById["event-a"]["报名项目"]).length, 0);
  const seat = sheetObjects(harness.eventSheetsById["event-a"]["座位"])[0];
  assert.equal(seat.status, "available");
  assert.equal(seat.holderRegistrationId, "");
  assert.equal(sheetObjects(harness.registrySheets["票券索引"]).length, 0);
});

test("ticket route collision rejects and compensates the new private registration", async () => {
  const existingRoute = {
    ticketNumber: "EVT-0000000300",
    tokenDigest: "a".repeat(64),
    eventId: "event-b",
    registrationId: "existing-registration",
    status: "active",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z"
  };
  const harness = await createHarness({
    eventRowsById: { "event-a": rowsForEvent("event-a", "Activity A") },
    registryRows: { "票券索引": [existingRoute] }
  });

  const failed = harness.context.createRegistration(registrationPayload({
    eventId: "event-a",
    sessionIds: ["event-a-session"],
    answers: { name: "Alice", email: "alice@example.com" }
  }));

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INTEGRITY_ERROR");
  assert.equal(sheetObjects(harness.eventSheetsById["event-a"]["参加者"]).length, 0);
  assert.equal(sheetObjects(harness.eventSheetsById["event-a"]["报名项目"]).length, 0);
  assert.deepEqual(sheetObjects(harness.registrySheets["票券索引"]), [existingRoute]);
});

test("failed route compensation leaves recoverable pending state and a token-safe integrity audit", async () => {
  const harness = await createHarness({
    eventRowsById: { "event-a": rowsForEvent("event-a", "Activity A") },
    onWrite: ({ sheet, operation }) => {
      if (sheet.name === "票券索引") throw new Error("route publication failed");
      if (sheet.name === "报名项目" && operation === "delete") {
        throw new Error("registration cleanup failed");
      }
    }
  });

  const failed = harness.context.createRegistration(registrationPayload({
    eventId: "event-a",
    sessionIds: ["event-a-session"],
    answers: { name: "Alice", email: "alice@example.com" }
  }));

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INTEGRITY_ERROR");
  const registrations = sheetObjects(harness.eventSheetsById["event-a"]["报名项目"]);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].status, "pending");
  assert.equal(sheetObjects(harness.registrySheets["票券索引"]).length, 0);
  const audits = sheetObjects(harness.eventSheetsById["event-a"]["操作记录"]);
  const alert = audits.find((row) => row.action === "INTEGRITY_ALERT");
  assert.ok(alert);
  assert.equal(alert.details.includes("ticketToken"), false);
  assert.equal(alert.details.includes("alice@example.com"), false);
});

test("owner ticket projections mask names and contacts and never return dynamic answers", async () => {
  const { context } = await createHarness();
  const created = context.createRegistration(registrationPayload());
  assert.equal(created.ok, true);
  assert.notEqual(created.data.participant.name, "Alice Chan");
  assert.match(created.data.participant.name, /\*/);
  assert.equal(JSON.stringify(created.data).includes("do not expose"), false);

  const lookedUp = context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(lookedUp.ok, true);
  assert.notEqual(lookedUp.data.participant.name, "Alice Chan");
  assert.match(lookedUp.data.participant.name, /\*/);
  assert.equal(JSON.stringify(lookedUp.data).includes("do not expose"), false);
});

test("owner ticket lookup includes session display details and derives ended status from the event", async () => {
  const { context, registrySheets } = await createHarness({
    rows: baseRows({
      event: { status: "ended", location: "Main Hall" },
      sessions: [{
        sessionId: "s1", eventId: "event-1", title: "One", speaker: "Lin",
        startsAt: "2030-01-01T09:00:00Z", endsAt: "2030-01-01T10:00:00Z",
        required: false, capacity: 5, status: "ended"
      }],
      participants: [{ participantId: "p1", name: "Alice", email: "alice@example.com" }],
      registrations: [{
        registrationId: "r1", eventId: "event-1", participantId: "p1", ticketNumber: "EVT-1",
        status: "active", sessionIds: JSON.stringify(["s1"]),
        answers: JSON.stringify({ ticketToken: "token-1", verificationField: "email", values: { email: "alice@example.com" } })
      }]
    }),
    registryRows: {
      "票券索引": [{
        ticketNumber: "EVT-1",
        tokenDigest: createHash("sha256").update("token-1").digest("hex"),
        eventId: "event-1",
        registrationId: "r1",
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z"
      }]
    }
  });
  const result = context.lookupTicket({ ticketNumber: "EVT-1", verificationValue: "alice@example.com" });
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "ended");
  assert.equal(result.data.location, "Main Hall");
  assert.deepEqual({ ...result.data.sessions[0] }, {
    sessionId: "s1",
    title: "One",
    speaker: "Lin",
    startsAt: "2030-01-01T09:00:00Z",
    endsAt: "2030-01-01T10:00:00Z",
    location: "Main Hall"
  });
  assert.equal(sheetObjects(registrySheets["票券索引"]).length, 1);
  assert.equal(sheetObjects(registrySheets["票券索引"])[0].status, "active");
});

test("one blank-session seat is shared by all selected sessions while session seats allocate one per session", async () => {
  const shared = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{ seatId: "shared-a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    })
  });
  const sharedResult = shared.context.createRegistration(registrationPayload({
    sessionIds: ["s1", "s2"], seatChoices: ["A1"]
  }));
  assert.equal(sharedResult.ok, true);
  assert.deepEqual(Array.from(sharedResult.data.seats, (seat) => seat.seatId), ["shared-a1"]);

  const perSession = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "s1-a1", eventId: "event-1", sessionId: "s1", label: "A1", zone: "front", status: "available" },
        { seatId: "s2-a1", eventId: "event-1", sessionId: "s2", label: "A1", zone: "front", status: "available" }
      ]
    })
  });
  const perSessionResult = perSession.context.createRegistration(registrationPayload({
    sessionIds: ["s1", "s2"], seatChoices: ["A1"]
  }));
  assert.equal(perSessionResult.ok, true);
  assert.deepEqual(Array.from(perSessionResult.data.seats, (seat) => seat.seatId), ["s1-a1", "s2-a1"]);
});

test("an unavailable shared seat does not block valid session-bound seats in a mixed layout", async () => {
  const { context } = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "shared-a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "registered", holderRegistrationId: "other" },
        { seatId: "s1-a1", eventId: "event-1", sessionId: "s1", label: "A1", zone: "front", status: "available" },
        { seatId: "s2-a1", eventId: "event-1", sessionId: "s2", label: "A1", zone: "front", status: "available" }
      ]
    })
  });
  const result = context.createRegistration(registrationPayload({
    sessionIds: ["s1", "s2"], seatChoices: ["A1"]
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.data.seats, (seat) => seat.seatId), ["s1-a1", "s2-a1"]);
});

test("numeric form strings are strictly converted and invalid numeric syntax is rejected", async () => {
  const validHarness = await createHarness();
  const valid = validHarness.context.createRegistration(registrationPayload({
    answers: { name: "Alice", email: "alice@example.com", age: "42", privateNote: "" }
  }));
  assert.equal(valid.ok, true);
  const stored = JSON.parse(sheetObjects(validHarness.sheets["报名项目"])[0].answers);
  assert.equal(stored.values.age, 42);

  const invalidHarness = await createHarness();
  const invalid = invalidHarness.context.createRegistration(registrationPayload({
    answers: { name: "Alice", email: "alice@example.com", age: "0x2a", privateNote: "" }
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "INVALID_REQUEST");
});

test("unknown modes and malformed nonempty event timestamps fail closed", async () => {
  for (const event of [
    { selectionMode: "surprise" },
    { seatMode: "surprise" },
    { opensAt: "2026-02-30T08:00:00Z" }
  ]) {
    const { context } = await createHarness({ rows: baseRows({ event }) });
    const result = context.createRegistration(registrationPayload());
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_REQUEST");
  }
});

test("expired held seats are treated as available and persisted without hold ownership", async () => {
  const { context, sheets } = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{
        seatId: "shared-a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front",
        status: "held", holderRegistrationId: "HOLD|someone-else|1"
      }, {
        seatId: "shared-a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front",
        status: "held", holderRegistrationId: "HOLD|someone-else|1"
      }]
    })
  });
  const result = context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(result.ok, true);
  const [seat, expiredUnselectedSeat] = sheetObjects(sheets["座位"]);
  assert.equal(seat.status, "registered");
  assert.equal(seat.holderRegistrationId, result.data.registrationId);
  assert.equal(expiredUnselectedSeat.status, "available");
  assert.equal(expiredUnselectedSeat.holderRegistrationId, "");
});

test("a failed batched registration write removes the participant and leaves no capacity row", async () => {
  const { context, sheets } = await createHarness({
    onWrite: ({ sheet }) => {
      if (sheet.name === "报名项目") throw new Error("registration write failed");
    }
  });
  const result = context.createRegistration(registrationPayload());
  assert.equal(result.ok, false);
  assert.equal(sheetObjects(sheets["参加者"]).length, 0);
  assert.equal(sheetObjects(sheets["报名项目"]).length, 0);
});

test("failed registration compensation returns integrity error and records an alert", async () => {
  const { context, sheets } = await createHarness({
    onWrite: ({ sheet, operation }) => {
      if (sheet.name === "报名项目") throw new Error("registration write failed");
      if (sheet.name === "参加者" && operation === "delete") throw new Error("participant restore failed");
    }
  });
  const result = context.createRegistration(registrationPayload());
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTEGRITY_ERROR");
  assert.ok(sheetObjects(sheets["操作记录"]).some((row) => row.action === "INTEGRITY_ALERT"));
});

test("failed activation with failed cleanup leaves only recoverable pending state ignored by lookup and capacity", async () => {
  let phase = "create";
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      sessions: [
        { sessionId: "s1", eventId: "event-1", title: "One", startsAt: "2030-01-01T09:00:00Z", endsAt: "2030-01-01T10:00:00Z", required: false, capacity: 1, status: "open" }
      ],
      seats: [{ seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    }),
    onWrite: ({ sheet, operation, values }) => {
      if (phase !== "create") return;
      if (sheet.name === "报名项目" && values[0]?.[4] === "active") throw new Error("activation failed");
      if (operation === "delete") throw new Error("cleanup delete failed");
      if (sheet.name === "座位" && values[0]?.[5] === "available") throw new Error("seat cleanup failed");
    }
  });
  const failed = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INTEGRITY_ERROR");
  const pendingRows = sheetObjects(harness.sheets["报名项目"]);
  assert.ok(pendingRows.length > 0);
  assert.ok(pendingRows.every((row) => row.status === "pending"));
  const pendingStored = JSON.parse(pendingRows[0].answers);

  const hidden = harness.context.lookupTicket({
    ticketNumber: pendingRows[0].ticketNumber,
    verificationValue: pendingStored.values.email
  });
  assert.equal(hidden.code, "TICKET_NOT_FOUND");

  phase = "recovery";
  const retried = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(retried.ok, true);
  assert.equal(sheetObjects(harness.sheets["报名项目"]).filter((row) => row.status === "active").length, 1);
});

test("pending-seat write failure with failed cleanup leaves no active registration or owned seat", async () => {
  let phase = "create";
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{ seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    }),
    onWrite: ({ sheet, operation, values }) => {
      if (phase !== "create") return;
      if (sheet.name === "座位" && values[0]?.[5] === "pending") throw new Error("pending seat failed");
      if (operation === "delete") throw new Error("cleanup failed");
    }
  });
  const failed = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(failed.code, "INTEGRITY_ERROR");
  assert.equal(sheetObjects(harness.sheets["报名项目"]).some((row) => row.status === "active"), false);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].holderRegistrationId, "");

  phase = "recovery";
  const retried = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(retried.ok, true);
});

test("seat finalization failure stays logically owned and is finalized before lookup observes it", async () => {
  let phase = "create";
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{ seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    }),
    onWrite: ({ sheet, values }) => {
      if (phase === "create" && sheet.name === "座位" && values[0]?.[5] === "registered") {
        throw new Error("seat finalize failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(created.ok, true);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].status, "pending");
  phase = "lookup";
  const lookup = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(lookup.ok, true);
  assert.equal(lookup.data.seats.length, 1);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].status, "registered");
});

test("failed finalization recovery quarantines the pending seat and prevents double booking", async () => {
  let blockFinalization = true;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{ seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    }),
    onWrite: ({ sheet, values }) => {
      if (blockFinalization && sheet.name === "座位" && values[0]?.[5] === "registered") {
        throw new Error("seat finalize failed");
      }
    }
  });
  const first = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  assert.equal(first.ok, true);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].status, "pending");

  const second = harness.context.createRegistration(registrationPayload({
    seatChoices: ["A1"],
    answers: { name: "Bob", email: "bob@example.com", age: "", privateNote: "" }
  }));
  assert.equal(second.ok, false);
  assert.equal(second.code, "INTEGRITY_ERROR");
  assert.equal(sheetObjects(harness.sheets["报名项目"]).filter((row) => row.status === "active").length, 1);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].holderRegistrationId, `PENDING|${first.data.registrationId}`);

  blockFinalization = false;
  const recovered = harness.context.lookupTicket({
    ticketNumber: first.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(recovered.ok, true);
  assert.equal(sheetObjects(harness.sheets["座位"])[0].holderRegistrationId, first.data.registrationId);
});

test("post-commit audit failure does not turn a complete active registration into a client failure", async () => {
  const harness = await createHarness({
    onWrite: ({ sheet, values }) => {
      if (sheet.name === "操作记录" && values[0]?.[1] === "CREATE_REGISTRATION") {
        throw new Error("audit failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload());
  assert.equal(created.ok, true);
  assert.ok(sheetObjects(harness.sheets["报名项目"]).every((row) => row.status === "active"));
});

test("all registration items are appended pending and activated with two batched writes", async () => {
  const registrationWrites = [];
  const { context } = await createHarness({
    onWrite: ({ sheet, values }) => {
      if (sheet.name === "报名项目") registrationWrites.push(values.length);
    }
  });
  const result = context.createRegistration(registrationPayload({ sessionIds: ["s1", "s2"] }));
  assert.equal(result.ok, true);
  assert.deepEqual(registrationWrites, [2, 2]);
});

test("serialized registrations observe the first committed identity before the second validates", async () => {
  const { context, locks, sheets } = await createHarness();
  const first = context.createRegistration(registrationPayload());
  const second = context.createRegistration(registrationPayload());
  assert.equal(first.ok, true);
  assert.equal(second.code, "DUPLICATE_REGISTRATION");
  assert.deepEqual(locks, ["acquire", "release", "acquire", "release"]);
  assert.equal(sheetObjects(sheets["报名项目"]).length, 1);
});

test("an explicit empty event identity policy allows repeated registrations with the same answers", async () => {
  const settings = {
    registration: {
      identityFields: ["email"],
      events: {
        "event-1": {
          identityFields: []
        }
      }
    }
  };
  const { context, sheets } = await createHarness({ settings });

  const first = context.createRegistration(registrationPayload());
  const second = context.createRegistration(registrationPayload());

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(sheetObjects(sheets["报名项目"]).length, 2);
});

test("lookup takes a lock and cancellation preserves rows while releasing the seat", async () => {
  const { context, locks, sheets, registry, registrySheets } = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [{ seatId: "shared-a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }]
    })
  });
  const created = context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const beforeLookupLocks = locks.length;
  const lookup = context.lookupTicket({ ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com" });
  assert.equal(lookup.ok, true);
  assert.deepEqual(locks.slice(beforeLookupLocks), ["acquire", "release"]);

  const registrationCount = sheetObjects(sheets["报名项目"]).length;
  const participantCount = sheetObjects(sheets["参加者"]).length;
  const cancelled = context.cancelRegistration({ ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com" });
  assert.equal(cancelled.data.status, "cancelled");
  assert.equal(sheetObjects(sheets["报名项目"]).length, registrationCount);
  assert.equal(sheetObjects(sheets["参加者"]).length, participantCount);
  assert.equal(sheetObjects(sheets["报名项目"])[0].status, "cancelled");
  assert.equal(sheetObjects(sheets["座位"])[0].holderRegistrationId, "");
  assert.equal(context.getTicketRouteByNumber_(registry, created.data.ticketNumber).status, "cancelled");
  assert.equal(sheetObjects(registrySheets["票券索引"]).length, 1);
});

test("a failed cancellation index update restores the active registration and occupied seat", async () => {
  let phase = "create";
  let failRouteUpdateOnce = true;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet }) => {
      if (phase === "cancel" && failRouteUpdateOnce && sheet.name === "票券索引") {
        failRouteUpdateOnce = false;
        throw new Error("index update failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const beforeAudits = JSON.stringify(sheetObjects(harness.sheets["操作记录"]));
  phase = "cancel";

  const failed = harness.context.cancelRegistration({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });

  assert.equal(failed.ok, false);
  assert.equal(sheetObjects(harness.sheets["报名项目"])[0].status, "active");
  assert.equal(
    sheetObjects(harness.sheets["座位"])[0].holderRegistrationId,
    created.data.registrationId
  );
  assert.equal(
    harness.context.getTicketRouteByNumber_(harness.registry, created.data.ticketNumber).status,
    "active"
  );
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["操作记录"])), beforeAudits);
});

test("a downstream cancellation failure after the index write restores the route, registration, seat, and audit", async () => {
  let phase = "create";
  let routeWasCancelled = false;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet, values }) => {
      if (phase !== "cancel") return;
      if (sheet.name === "票券索引" &&
          values[0][headers["票券索引"].indexOf("status")] === "cancelled") {
        routeWasCancelled = true;
      }
      if (sheet.name === "操作记录" && values[0][1] === "CANCEL_REGISTRATION") {
        throw new Error("audit write failed after index update");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const beforeAudits = JSON.stringify(sheetObjects(harness.sheets["操作记录"]));
  phase = "cancel";

  const failed = harness.context.cancelRegistration({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });

  assert.equal(failed.ok, false);
  assert.equal(routeWasCancelled, true);
  assert.equal(sheetObjects(harness.sheets["报名项目"])[0].status, "active");
  assert.equal(sheetObjects(harness.sheets["座位"])[0].holderRegistrationId, created.data.registrationId);
  assert.equal(
    harness.context.getTicketRouteByNumber_(harness.registry, created.data.ticketNumber).status,
    "active"
  );
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["操作记录"])), beforeAudits);
  assert.equal(
    harness.context.lookupTicket({
      ticketNumber: created.data.ticketNumber,
      verificationValue: "alice@example.com"
    }).data.status,
    "active"
  );
});

test("cancellation rejects a route identity mismatch before changing ticket or seat state", async () => {
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" }
      ]
    })
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const routeSheet = harness.registrySheets["票券索引"];
  routeSheet.rows[1][headers["票券索引"].indexOf("registrationId")] = "wrong-registration";
  const beforeRegistrations = JSON.stringify(sheetObjects(harness.sheets["报名项目"]));
  const beforeSeats = JSON.stringify(sheetObjects(harness.sheets["座位"]));

  const failed = harness.context.cancelRegistration({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "INTEGRITY_ERROR");
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["报名项目"])), beforeRegistrations);
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["座位"])), beforeSeats);
});

test("seat exchange rejects a cancelled route before changing active ticket rows or seats", async () => {
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    })
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const routeSheet = harness.registrySheets["票券索引"];
  routeSheet.rows[1][headers["票券索引"].indexOf("status")] = "cancelled";
  const beforeRegistrations = JSON.stringify(sheetObjects(harness.sheets["报名项目"]));
  const beforeSeats = JSON.stringify(sheetObjects(harness.sheets["座位"]));

  const failed = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    oldSeatId: "a1",
    newSeatId: "a2"
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "TICKET_INACTIVE");
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["报名项目"])), beforeRegistrations);
  assert.equal(JSON.stringify(sheetObjects(harness.sheets["座位"])), beforeSeats);
});

test("seat exchange rotates the token so the persisted old QR is invalid", async () => {
  const { context, sheets, registry } = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    })
  });
  const created = context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const oldToken = created.data.token;
  const before = context.getTicketRouteByToken_(registry, oldToken);
  const exchanged = context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, true);
  assert.notEqual(exchanged.data.token, oldToken);
  const stored = sheetObjects(sheets["报名项目"]).map((row) => JSON.parse(row.answers).ticketToken);
  assert.equal(stored.includes(oldToken), false);
  assert.ok(stored.every((token) => token === exchanged.data.token));
  assert.equal(before.eventId, "event-1");
  assert.throws(
    () => context.getTicketRouteByToken_(registry, oldToken),
    (error) => error.publicCode === "TICKET_NOT_FOUND"
  );
  assert.equal(
    context.getTicketRouteByToken_(registry, exchanged.data.token).eventId,
    "event-1"
  );
});

test("a failed exchange index update restores the old token and both seat states", async () => {
  let phase = "create";
  let failRouteUpdateOnce = true;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet }) => {
      if (phase === "exchange" && failRouteUpdateOnce && sheet.name === "票券索引") {
        failRouteUpdateOnce = false;
        throw new Error("index update failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const oldToken = created.data.token;
  phase = "exchange";

  const failed = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    oldSeatId: "a1",
    newSeatId: "a2"
  });

  assert.equal(failed.ok, false);
  const seats = sheetObjects(harness.sheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, created.data.registrationId);
  assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, "");
  const storedTokens = sheetObjects(harness.sheets["报名项目"])
    .map((row) => JSON.parse(row.answers).ticketToken);
  assert.ok(storedTokens.every((token) => token === oldToken));
  assert.equal(
    harness.context.getTicketRouteByToken_(harness.registry, oldToken).registrationId,
    created.data.registrationId
  );
});

test("seat exchange can claim an expired hold and clears the stale owner", async () => {
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    })
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const seatSheet = harness.sheets["座位"];
  const statusColumn = headers["座位"].indexOf("status");
  const holderColumn = headers["座位"].indexOf("holderRegistrationId");
  seatSheet.rows[2][statusColumn] = "held";
  seatSheet.rows[2][holderColumn] = "HOLD|stale-owner|1";

  const exchanged = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, true);
  const newSeat = sheetObjects(seatSheet).find((seat) => seat.seatId === "a2");
  assert.equal(newSeat.holderRegistrationId, created.data.registrationId);
});

test("an exchange audit failure after route rotation restores token, route, and both seats", async () => {
  let phase = "create";
  let attemptedNewToken = "";
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet, values }) => {
      if (phase === "exchange" && sheet.name === "报名项目" && !attemptedNewToken) {
        attemptedNewToken = JSON.parse(values[0][headers["报名项目"].indexOf("answers")]).ticketToken;
      }
      if (phase === "exchange" && sheet.name === "操作记录" && values[0][1] === "EXCHANGE_SEAT") {
        throw new Error("audit write failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const oldToken = created.data.token;
  phase = "exchange";
  const failed = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(failed.ok, false);
  assert.ok(attemptedNewToken);
  assert.notEqual(attemptedNewToken, oldToken);
  const seats = sheetObjects(harness.sheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, created.data.registrationId);
  assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, "");
  const tokens = sheetObjects(harness.sheets["报名项目"]).map((row) => JSON.parse(row.answers).ticketToken);
  assert.ok(tokens.every((token) => token === oldToken));
  assert.equal(
    harness.context.getTicketRouteByToken_(harness.registry, oldToken).registrationId,
    created.data.registrationId
  );
  assert.throws(
    () => harness.context.getTicketRouteByToken_(harness.registry, attemptedNewToken),
    (error) => error.publicCode === "TICKET_NOT_FOUND"
  );
});

test("exchange failures before old-seat release never disturb the old seat", async () => {
  for (const failAt of ["new-seat", "registration"]) {
    let phase = "create";
    const harness = await createHarness({
      rows: baseRows({
        event: { seatMode: "self" },
        seats: [
          { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
          { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
        ]
      }),
      onWrite: ({ sheet, values }) => {
        if (phase !== "exchange") return;
        if (failAt === "new-seat" && sheet.name === "座位" && values[0]?.[6] && values[0]?.[0] === "a2") {
          throw new Error("new seat failed");
        }
        if (failAt === "registration" && sheet.name === "报名项目") throw new Error("registration update failed");
      }
    });
    const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
    phase = "exchange";
    const result = harness.context.exchangeSeat({
      ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
      oldSeatId: "a1", newSeatId: "a2"
    });
    assert.equal(result.ok, false);
    const seats = sheetObjects(harness.sheets["座位"]);
    assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, created.data.registrationId);
    assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, "");
  }
});

test("old-seat release failure restores the old token, route, and both seat snapshots", async () => {
  let phase = "create";
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet, values }) => {
      if (phase === "exchange" && sheet.name === "座位" &&
          values[0]?.[0] === "a1" && values[0]?.[5] === "available") {
        throw new Error("old seat release failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  const oldToken = created.data.token;
  phase = "exchange";
  const exchanged = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, false);
  const seats = sheetObjects(harness.sheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, created.data.registrationId);
  assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, "");
  assert.ok(sheetObjects(harness.sheets["报名项目"])
    .every((row) => JSON.parse(row.answers).ticketToken === oldToken));
  assert.equal(
    harness.context.getTicketRouteByToken_(harness.registry, oldToken).registrationId,
    created.data.registrationId
  );
});

test("a rolled-back old-seat release failure permits a clean exchange retry", async () => {
  let failOldRelease = false;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
      ]
    }),
    onWrite: ({ sheet, values }) => {
      if (failOldRelease && sheet.name === "座位" &&
          values[0]?.[0] === "a1" && values[0]?.[5] === "available") {
        throw new Error("old seat release failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  failOldRelease = true;
  const firstExchange = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(firstExchange.ok, false);
  assert.equal(sheetObjects(harness.sheets["座位"]).find((seat) => seat.seatId === "a2").holderRegistrationId, "");

  failOldRelease = false;
  const finalExchange = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(finalExchange.ok, true);
  const ownedSeats = sheetObjects(harness.sheets["座位"]).filter((seat) => seat.holderRegistrationId === created.data.registrationId);
  assert.deepEqual(ownedSeats.map((seat) => seat.seatId), ["a2"]);
  assert.equal(sheetObjects(harness.sheets["报名项目"]).filter((row) => row.status === "active").length, 1);
});

test("pre-release rollback failure returns integrity error while the old seat remains owned", async () => {
  let phase = "create";
  let seatWrites = 0;
  const rows = baseRows({
    event: { seatMode: "self" },
    seats: [
      { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
      { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" }
    ]
  });
  const harness = await createHarness({
    rows,
    onWrite: ({ sheet, values }) => {
      if (phase !== "exchange") return;
      if (sheet.name === "座位") {
        seatWrites += 1;
        if (seatWrites >= 2) throw new Error("restore failed");
      }
      if (sheet.name === "报名项目") throw new Error("registration update failed");
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  phase = "exchange";
  const exchanged = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, false);
  assert.equal(exchanged.code, "INTEGRITY_ERROR");
  const oldSeat = sheetObjects(harness.sheets["座位"]).find((seat) => seat.seatId === "a1");
  assert.equal(oldSeat.holderRegistrationId, created.data.registrationId);
  assert.ok(sheetObjects(harness.sheets["操作记录"]).some((row) => row.action === "INTEGRITY_ALERT"));
});

test("event policy blocks participant cancellation and exposes truthful ticket capabilities", async () => {
  const settings = {
    registration: {
      identityFields: ["email"],
      verificationField: "email",
      events: {
        "event-1": {
          cancellationEnabled: false,
          seatExchangeEnabled: false
        }
      }
    }
  };
  const harness = await createHarness({ settings });
  const created = harness.context.createRegistration(registrationPayload());
  assert.equal(created.ok, true);
  assert.deepEqual({ ...created.data.capabilities }, {
    canCancel: false,
    canExchangeSeat: false
  });

  const cancelled = harness.context.cancelRegistration({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.code, "CANCELLATION_DISABLED");
  assert.ok(sheetObjects(sheetWithHeader(harness, "registrationId"))
    .every((row) => row.status === "active"));
});

test("semantic field roles populate participant columns and configured ticket fields stay masked", async () => {
  const rows = baseRows({
    questions: [
      { questionId: "q-name", eventId: "event-1", label: "Display name", type: "text", required: true, status: "active" },
      { questionId: "q-mail", eventId: "event-1", label: "Contact email", type: "email", required: true, status: "active" },
      { questionId: "q-phone", eventId: "event-1", label: "Mobile", type: "tel", required: true, status: "active" },
      { questionId: "q-badge", eventId: "event-1", label: "Badge code", type: "text", required: true, status: "active" }
    ]
  });
  const settings = {
    registration: {
      events: {
        "event-1": {
          identityFields: ["q-mail"],
          verificationField: "q-mail",
          fieldRoles: { name: "q-name", email: "q-mail", phone: "q-phone" },
          showOnTicketFields: ["q-badge"],
          cancellationEnabled: true
        }
      }
    }
  };
  const harness = await createHarness({ rows, settings });
  const created = harness.context.createRegistration(registrationPayload({
    answers: {
      "q-name": "Alice Chan",
      "q-mail": "alice@example.com",
      "q-phone": "+60 12-345 6789",
      "q-badge": "SECRET-7391"
    }
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  const participant = sheetObjects(sheetWithHeader(harness, "participantId"))[0];
  assert.equal(participant.name, "Alice Chan");
  assert.equal(participant.email, "alice@example.com");
  assert.equal(participant.phone, "+60 12-345 6789");
  assert.deepEqual(JSON.parse(JSON.stringify(created.data.displayFields)), [{
    id: "q-badge",
    label: "Badge code",
    value: "SE****91"
  }]);
  assert.equal(JSON.stringify(created.data).includes("SECRET-7391"), false);

  const lookedUp = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(lookedUp.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(lookedUp.data.displayFields)),
    JSON.parse(JSON.stringify(created.data.displayFields))
  );
});

test("admin-shaped nested validation enforces text, choices, and checkbox selection bounds", async () => {
  const rows = baseRows({
    questions: [
      {
        questionId: "name", eventId: "event-1", label: "Name", type: "text",
        required: true,
        options: JSON.stringify({ choices: [], validation: { minLength: 3, maxLength: 10 } }),
        status: "active"
      },
      {
        questionId: "email", eventId: "event-1", label: "Email", type: "email",
        required: true, status: "active"
      },
      {
        questionId: "topics", eventId: "event-1", label: "Topics", type: "checkbox",
        required: true,
        options: JSON.stringify({
          choices: ["A", "B", "C"],
          validation: { minSelections: 2, maxSelections: 2 }
        }),
        status: "active"
      }
    ]
  });
  const harness = await createHarness({ rows });
  assert.equal(harness.context.createRegistration(registrationPayload({
    answers: { name: "Al", email: "alice@example.com", topics: ["A", "B"] }
  })).code, "INVALID_REQUEST");
  assert.equal(harness.context.createRegistration(registrationPayload({
    answers: { name: "Alice", email: "alice@example.com", topics: ["A"] }
  })).code, "INVALID_REQUEST");
  assert.equal(harness.context.createRegistration(registrationPayload({
    answers: { name: "Alice", email: "alice@example.com", topics: ["A", "X"] }
  })).code, "INVALID_REQUEST");
  assert.equal(harness.context.createRegistration(registrationPayload({
    answers: { name: "Alice", email: "alice@example.com", topics: ["A", "B"] }
  })).ok, true);
});

test("only active or open sessions can register and topic groups enforce their configured maximum", async () => {
  const rows = baseRows({
    sessions: [
      { sessionId: "s1", eventId: "event-1", title: "One", startsAt: "2030-01-01T09:00:00Z", endsAt: "2030-01-01T10:00:00Z", required: false, capacity: 5, status: "open" },
      { sessionId: "s2", eventId: "event-1", title: "Two", startsAt: "2030-01-01T10:00:00Z", endsAt: "2030-01-01T11:00:00Z", required: false, capacity: 5, status: "active" },
      { sessionId: "draft", eventId: "event-1", title: "Hidden", startsAt: "2030-01-01T11:00:00Z", endsAt: "2030-01-01T12:00:00Z", required: false, capacity: 5, status: "draft" }
    ],
    event: { maxChoices: 3 }
  });
  const settings = {
    registration: {
      identityFields: [],
      events: {
        "event-1": {
          sessions: {
            s1: { groupRule: { id: "topic-a", min: 0, max: 1 } },
            s2: { groupRule: { id: "topic-a", min: 0, max: 1 } }
          }
        }
      }
    }
  };
  const harness = await createHarness({ rows, settings });
  assert.equal(harness.context.createRegistration(registrationPayload({
    sessionIds: ["draft"]
  })).code, "INVALID_REQUEST");
  assert.equal(harness.context.createRegistration(registrationPayload({
    sessionIds: ["s1", "s2"]
  })).code, "INVALID_REQUEST");
  assert.equal(harness.context.createRegistration(registrationPayload({
    sessionIds: ["s2"],
    answers: { name: "Bob", email: "bob@example.com" }
  })).ok, true);
});

test("seat holds are owner-bound, submit-compatible, releasable, and policy controlled", async () => {
  const rows = baseRows({
    event: { seatMode: "self" },
    seats: [
      {
        seatId: "seat-a", eventId: "event-1", sessionId: "",
        label: "A-01", zone: "front", status: "available"
      }
    ]
  });
  const settings = {
    registration: {
      identityFields: ["email"],
      verificationField: "email",
      events: {
        "event-1": {
          cancellationEnabled: true,
          seatHoldsEnabled: true,
          seatHoldMinutes: 2
        }
      }
    }
  };
  const harness = await createHarness({ rows, settings });
  const held = harness.context.createSeatHold({
    eventId: "event-1",
    seatId: "seat-a",
    holdOwner: "browser-owner-0001"
  });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.equal(held.data.seatId, "seat-a");
  assert.equal(held.data.holdOwner, "browser-owner-0001");
  assert.ok(Date.parse(held.data.expiresAt) > Date.parse(held.data.serverNow));
  assert.match(
    sheetObjects(sheetWithHeader(harness, "seatId"))[0].holderRegistrationId,
    /^HOLD\|browser-owner-0001\|\d+$/
  );

  const stolen = harness.context.createSeatHold({
    eventId: "event-1",
    seatId: "seat-a",
    holdOwner: "browser-owner-0002"
  });
  assert.equal(stolen.code, "SEAT_UNAVAILABLE");
  const wrongRelease = harness.context.releaseSeatHold({
    eventId: "event-1",
    seatId: "seat-a",
    holdOwner: "browser-owner-0002"
  });
  assert.equal(wrongRelease.code, "SEAT_HOLD_OWNERSHIP");
  assert.deepEqual(harness.routedEventIds, ["event-1", "event-1", "event-1"]);

  const created = harness.context.createRegistration(registrationPayload({
    seatChoices: ["seat-a"],
    seatHoldOwner: "browser-owner-0001"
  }));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(
    sheetObjects(sheetWithHeader(harness, "seatId"))[0].holderRegistrationId,
    created.data.registrationId
  );

  const releaseHarness = await createHarness({ rows: baseRows({
    event: { seatMode: "self" },
    seats: [{
      seatId: "seat-b", eventId: "event-1", sessionId: "",
      label: "B-01", zone: "front", status: "available"
    }]
  }), settings });
  assert.equal(releaseHarness.context.createSeatHold({
    eventId: "event-1", seatId: "seat-b", holdOwner: "browser-owner-0003"
  }).ok, true);
  assert.equal(releaseHarness.context.releaseSeatHold({
    eventId: "event-1", seatId: "seat-b", holdOwner: "browser-owner-0003"
  }).ok, true);
  const releasedSeat = sheetObjects(sheetWithHeader(releaseHarness, "seatId"))[0];
  assert.equal(releasedSeat.status, "available");
  assert.equal(releasedSeat.holderRegistrationId, "");

  const disabled = await createHarness({ rows, settings: {
    registration: { identityFields: [], events: { "event-1": { seatHoldsEnabled: false } } }
  } });
  assert.equal(disabled.context.createSeatHold({
    eventId: "event-1", seatId: "seat-a", holdOwner: "browser-owner-0004"
  }).code, "SEAT_HOLD_DISABLED");
});

test("seat exchange never crosses between shared and session-bound seat scopes", async () => {
  const rows = baseRows({
    event: { seatMode: "self" },
    seats: [
      { seatId: "shared-old", eventId: "event-1", sessionId: "", label: "S-01", zone: "main", status: "available" },
      { seatId: "session-new", eventId: "event-1", sessionId: "s1", label: "A-02", zone: "main", status: "available" },
      { seatId: "shared-new", eventId: "event-1", sessionId: "", label: "S-02", zone: "main", status: "available" }
    ]
  });
  const harness = await createHarness({ rows });
  const created = harness.context.createRegistration(registrationPayload({
    seatChoices: ["shared-old"]
  }));
  assert.equal(created.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(created.data.exchangeOptions)),
    [{
      seatId: "shared-new", label: "S-02", zone: "main",
      sessionId: "", replacesSeatId: "shared-old"
    }]
  );
  assert.equal(harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    oldSeatId: "shared-old",
    newSeatId: "session-new"
  }).code, "SEAT_UNAVAILABLE");
  assert.equal(harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com",
    oldSeatId: "shared-old",
    newSeatId: "shared-new"
  }).ok, true);
});

test("router rejects non-exact and inherited action names with the fixed public envelope", async () => {
  const code = await readFile(new URL("Code.gs", serviceRoot), "utf8");
  const context = vm.createContext({
    JSON,
    Object,
    Array,
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } })
    },
    listEvents: () => ({ ok: true, data: [] }),
    getEvent: () => ({ ok: true, data: {} }),
    createRegistration: () => ({ ok: true, data: {} }),
    lookupTicket: () => ({ ok: true, data: {} }),
    verifyTicket: () => ({ ok: true, data: {} }),
    cancelRegistration: () => ({ ok: true, data: {} }),
    exchangeSeat: () => ({ ok: true, data: {} })
  });
  vm.runInContext(code, context, { filename: "Code.gs" });
  for (const action of [" ListEvents", "listEvents ", "LISTEVENTS", "toString"]) {
    const response = context.doPost({ postData: { contents: JSON.stringify({ action, payload: {} }) } });
    assert.deepEqual(JSON.parse(response.text), {
      ok: false, code: "NOT_IMPLEMENTED", message: "请求暂不可用。"
    });
  }
  const checkInResponse = context.doPost({
    postData: { contents: JSON.stringify({ action: "checkIn", payload: { token: "secret", sessionId: "s1" } }) }
  });
  assert.deepEqual(JSON.parse(checkInResponse.text), {
    ok: false, code: "NOT_IMPLEMENTED", message: "请求暂不可用。"
  });
});
