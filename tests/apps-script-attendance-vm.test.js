import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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
  const eventId = overrides.eventId || "event-1";
  const registrationId = overrides.registrationId || "reg-1";
  const participantId = overrides.participantId || "person-1";
  const ticketNumber = overrides.ticketNumber || "EVT-1";
  return {
    token,
    rows: {
      "活动": [{
        eventId, title: overrides.title || "Ideas", status: overrides.eventStatus || "live",
        location: "Main Hall", opensAt: "", closesAt: ""
      }],
      "场次": [
        {
          sessionId: "s1", eventId, title: "One", speaker: "Lin",
          startsAt: "2026-08-16T09:00:00Z", endsAt: "2026-08-16T10:00:00Z",
          status: overrides.sessionStatus || "live"
        },
        {
          sessionId: "s2", eventId, title: "Two", speaker: "Nan",
          startsAt: "2026-08-16T10:00:00Z", endsAt: "2026-08-16T11:00:00Z",
          status: overrides.sessionStatus || "live"
        }
      ],
      "座位": [
        { seatId: "seat-1", eventId, sessionId: "s1", label: "A-01", holderRegistrationId: registrationId, status: "registered" },
        { seatId: "seat-2", eventId, sessionId: "s2", label: "B-02", holderRegistrationId: registrationId, status: "registered" }
      ],
      "参加者": [{ participantId, name: "Alice Chan", phone: "0123456789", email: "alice@example.com" }],
      "报名项目": [
        {
          registrationId, eventId, participantId, ticketNumber,
          status: overrides.ticketStatus || "active", sessionIds: JSON.stringify(["s1"]),
          answers: JSON.stringify({ ticketToken: token, values: { email: "alice@example.com" } })
        },
        {
          registrationId, eventId, participantId, ticketNumber,
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
  const openedEventIds = [];
  let lockDepth = 0;
  let uuid = 0;
  const sheetsBySpreadsheet = new Map();
  const eventSpreadsheets = {};
  const eventSheetsById = {};
  const eventDataById = options.eventDataById || {
    [data.rows["活动"][0].eventId]: data
  };
  Object.entries(eventDataById).forEach(([eventId, eventData]) => {
    const activitySheets = Object.fromEntries(Object.entries(eventData.rows)
      .map(([name, records]) => [name, new FakeSheet(name, records, writes)]));
    const activitySpreadsheet = { getSheetByName: (name) => activitySheets[name] };
    sheetsBySpreadsheet.set(activitySpreadsheet, activitySheets);
    eventSpreadsheets[eventId] = activitySpreadsheet;
    eventSheetsById[eventId] = activitySheets;
  });
  const firstEventId = Object.keys(eventSpreadsheets)[0];
  const spreadsheet = eventSpreadsheets[firstEventId];
  const sheets = eventSheetsById[firstEventId];
  const registry = {};
  const routes = options.routes || Object.entries(eventDataById).map(([eventId, eventData]) => ({
    ticketNumber: eventData.rows["报名项目"][0].ticketNumber,
    tokenDigest: createHash("sha256").update(eventData.token.trim()).digest("hex"),
    eventId,
    registrationId: eventData.rows["报名项目"][0].registrationId,
    status: eventData.rows["报名项目"][0].status,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  }));
  const RealDate = Date;
  const now = options.now || "2026-08-16T09:30:00Z";
  class ServerDate extends RealDate {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return RealDate.parse(now); }
  }
  const getConfiguredSpreadsheet = () => spreadsheet;
  const getRequiredSheet = (targetSpreadsheet, name) =>
    (sheetsBySpreadsheet.get(targetSpreadsheet) || sheets)[name];
  const normalizeRow = (name, row) => headers[name].map((key) => row[key] ?? "");
  const readRows = (targetSpreadsheet, name) =>
    (sheetsBySpreadsheet.get(targetSpreadsheet) || sheets)[name].rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    ...Object.fromEntries(headers[name].map((key, column) => [key, values[column]]))
  }));
  const routingError = (code) => {
    const error = new Error("private ticket routing failed");
    error.publicCode = code;
    throw error;
  };
  const getTicketRouteByToken = (_registry, token) => {
    const normalized = typeof token === "string" ? token.trim() : "";
    if (!normalized) routingError("TICKET_NOT_FOUND");
    const digest = createHash("sha256").update(normalized).digest("hex");
    const matches = routes.filter((route) => route.tokenDigest === digest);
    if (!matches.length) routingError("TICKET_NOT_FOUND");
    if (matches.length !== 1) routingError("INTEGRITY_ERROR");
    return matches[0];
  };
  const getEventSpreadsheet = (_registry, eventId) => {
    openedEventIds.push(eventId);
    const routed = eventSpreadsheets[eventId];
    if (!routed) routingError("INTEGRITY_ERROR");
    return routed;
  };
  const withScriptLock = (callback) => {
    assert.equal(lockDepth, 0, "nested lock");
    lockDepth += 1;
    locks.push("acquire");
    try { return callback(); }
    finally { locks.push("release"); lockDepth -= 1; }
  };
  const repositoryBindings = options.staffProject
      ? {
        getRegistrySpreadsheet_: () => registry,
        getConfiguredSpreadsheet,
        getRootConfiguredSpreadsheet_: getConfiguredSpreadsheet,
        getConfiguredSpreadsheet_: getConfiguredSpreadsheet,
        getEventSpreadsheet_: getEventSpreadsheet,
        getTicketRouteByToken_: getTicketRouteByToken,
        digestTicketToken_: (token) => createHash("sha256").update(String(token || "").trim()).digest("hex"),
        getRequiredSheet_: getRequiredSheet,
        normalizeRow_: normalizeRow,
        readRows,
        readRows_: readRows,
        getAdminSettings: () => options.adminSettings || {},
        requireNoSwitchMaintenance_: () => {},
        withScriptLock_: withScriptLock
      }
      : {
        getRegistrySpreadsheet_: () => registry,
        getConfiguredSpreadsheet,
        getEventSpreadsheet_: getEventSpreadsheet,
        getTicketRouteByToken_: getTicketRouteByToken,
        digestTicketToken_: (token) => createHash("sha256").update(String(token || "").trim()).digest("hex"),
        getRequiredSheet_: getRequiredSheet,
        normalizeRow_: normalizeRow,
        readRows,
        withScriptLock
      };
  const context = vm.createContext({
    Date: ServerDate, JSON, Math, Object, Array, String, Number, RegExp, Error, isFinite,
    SHEET_DEFINITIONS: headers,
    Utilities: { getUuid: () => `checkin-${++uuid}` },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockDepth, 0, "nested lock");
          lockDepth += 1;
          locks.push("acquire");
        },
        releaseLock: () => {
          assert.equal(lockDepth, 1, "release without lock");
          locks.push("release");
          lockDepth -= 1;
        }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === "ATTENDANCE_STAFF_ALLOWLIST"
          ? JSON.stringify(options.allowlist || ["staff@example.com"])
          : null
      })
    },
    Session: {
      getActiveUser: () => ({ getEmail: () => options.sessionEmail || "" })
    },
    ...repositoryBindings
  });
  const publicServiceUrl = new URL("../apps-script/AttendanceService.gs", import.meta.url);
  vm.runInContext(await readFile(publicServiceUrl, "utf8"), context);
  if (options.staffProject) {
    const internalServiceUrl = new URL("../apps-script/InternalMutationService.gs", import.meta.url);
    vm.runInContext(await readFile(internalServiceUrl, "utf8"), context);
    context.invokeInternalBackend_ = (action, payload, actor) =>
      context.executeInternalActionLocked_(action, payload, actor);
    const staffServiceUrl = new URL("../staff-apps-script/AttendanceService.gs", import.meta.url);
    vm.runInContext(await readFile(staffServiceUrl, "utf8"), context);
  }
  return {
    context,
    sheets,
    writes,
    locks,
    registry,
    routes,
    openedEventIds,
    eventSpreadsheets,
    eventSheetsById
  };
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

test("token verification and check-in open only the indexed activity Sheet, while unknown tokens open none", async () => {
  const eventDataById = {
    "event-a": fixture({
      eventId: "event-a",
      registrationId: "reg-a",
      participantId: "person-a",
      ticketNumber: "EVT-A",
      token: "token-a",
      title: "Activity A"
    }),
    "event-b": fixture({
      eventId: "event-b",
      registrationId: "reg-b",
      participantId: "person-b",
      ticketNumber: "EVT-B",
      token: "token-b",
      title: "Activity B"
    })
  };
  const publicHarness = await createHarness({ eventDataById });
  const verified = publicHarness.context.verifyTicket({ token: "token-a" });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.equal(verified.data.event.title, "Activity A");
  assert.deepEqual(publicHarness.openedEventIds, ["event-a"]);

  const staffHarness = await createHarness({
    eventDataById,
    staffProject: true,
    sessionEmail: "staff@example.com"
  });
  const checkedIn = staffHarness.context.checkIn({ token: "token-a", sessionId: "s1" });
  assert.equal(checkedIn.ok, true, JSON.stringify(checkedIn));
  assert.deepEqual(staffHarness.openedEventIds, ["event-a"]);
  assert.equal(rows(staffHarness.eventSheetsById["event-a"]["签到记录"]).length, 1);
  assert.equal(rows(staffHarness.eventSheetsById["event-b"]["签到记录"]).length, 0);

  const unknown = await createHarness({ eventDataById });
  const invalid = unknown.context.verifyTicket({ token: "unknown-token" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "TOKEN_INVALID");
  assert.deepEqual(unknown.openedEventIds, []);
  assert.equal(unknown.writes.length, 0);
});

test("public and staff ticket readers reject a route that does not match the activity registration", async () => {
  const data = fixture();
  const wrongRoute = {
    ticketNumber: "EVT-1",
    tokenDigest: createHash("sha256").update(data.token).digest("hex"),
    eventId: "event-1",
    registrationId: "wrong-registration",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
  const publicHarness = await createHarness({ data, routes: [wrongRoute] });
  const result = publicHarness.context.verifyTicket({ token: data.token });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INTERNAL");
  assert.equal(publicHarness.writes.length, 0);

  const staffHarness = await createHarness({
    data,
    routes: [wrongRoute],
    staffProject: true,
    sessionEmail: "staff@example.com"
  });
  assert.throws(
    () => staffHarness.context.findStaffTicket_(
      staffHarness.eventSpreadsheets["event-1"],
      data.token,
      wrongRoute
    ),
    (error) => error.publicCode === "INTEGRITY_ERROR"
  );
});

test("a cancelled route cannot authorize stale active verification or staff check-in", async () => {
  const data = fixture();
  const cancelledRoute = {
    ticketNumber: "EVT-1",
    tokenDigest: createHash("sha256").update(data.token).digest("hex"),
    eventId: "event-1",
    registrationId: "reg-1",
    status: "cancelled",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };
  const publicHarness = await createHarness({ data, routes: [cancelledRoute] });
  const verified = publicHarness.context.verifyTicket({ token: data.token });
  assert.equal(verified.ok, false);
  assert.equal(verified.code, "INTERNAL");
  assert.equal(publicHarness.writes.length, 0);

  const staffHarness = await createHarness({
    data,
    routes: [cancelledRoute],
    staffProject: true,
    sessionEmail: "staff@example.com"
  });
  const checkedIn = staffHarness.context.checkIn({ token: data.token, sessionId: "s1" });
  assert.equal(checkedIn.ok, false);
  assert.equal(checkedIn.code, "TICKET_INACTIVE");
  assert.deepEqual(staffHarness.openedEventIds, []);
  assert.equal(staffHarness.writes.length, 0);
  assert.throws(
    () => staffHarness.context.findStaffTicket_(
      staffHarness.eventSpreadsheets["event-1"],
      data.token,
      cancelledRoute
    ),
    (error) => error.publicCode === "INTEGRITY_ERROR"
  );
});

test("blank and non-allowlisted Google sessions receive the same generic rejection", async () => {
  const blank = await createHarness({ staffProject: true });
  const stranger = await createHarness({ staffProject: true, sessionEmail: "stranger@example.com" });
  const submitted = { token: "opaque-token", sessionId: "s1", staffIdentity: "staff@example.com" };
  const blankResult = blank.context.checkIn(submitted);
  const strangerResult = stranger.context.checkIn(submitted);
  assert.deepEqual({ ...blankResult }, { ...strangerResult });
  assert.equal(blankResult.ok, false);
  assert.equal(blankResult.code, "STAFF_ACTION_DENIED");
  assert.equal(blank.writes.length + stranger.writes.length, 0);
});

test("a submitted staff email is ignored and the allowlisted Google session identity is stored", async () => {
  const { context, writes, sheets } = await createHarness({ staffProject: true, sessionEmail: " Staff@Example.com " });
  const result = context.checkIn({
    token: "opaque-token",
    sessionId: "s1",
    staffIdentity: "attacker@example.com"
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(rows(sheets["签到记录"])[0].checkedInBy, "staff@example.com");
});

test("check-in rejects a Google session outside the protected allowlist", async () => {
  const { context, writes } = await createHarness({ staffProject: true, sessionEmail: "stranger@example.com" });
  const result = context.checkIn({ token: "opaque-token", sessionId: "s1" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "STAFF_ACTION_DENIED");
  assert.equal(writes.length, 0);
});

test("valid check-in writes server time once, duplicates only that session, and permits another registered session", async () => {
  const harness = await createHarness({ staffProject: true, sessionEmail: "STAFF@example.com" });
  const request = { token: "opaque-token", sessionId: "s1" };

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

test("event check-in mode writes one reserved attendance row and ignores submitted sessions", async () => {
  const harness = await createHarness({
    staffProject: true,
    sessionEmail: "staff@example.com",
    adminSettings: {
      registration: { events: { "event-1": { checkInMode: "event" } } }
    }
  });
  const first = harness.context.checkIn({ token: "opaque-token", sessionId: "s2" });
  const duplicate = harness.context.checkIn({ token: "opaque-token" });

  assert.equal(first.ok, true);
  assert.equal(first.data.sessionId, "__EVENT__");
  assert.equal(duplicate.code, "ALREADY_CHECKED_IN");
  assert.deepEqual(rows(harness.sheets["签到记录"]).map((row) => row.sessionId), ["__EVENT__"]);
});

test("none check-in mode keeps verification readable but rejects attendance writes", async () => {
  const publicHarness = await createHarness();
  const harness = await createHarness({
    staffProject: true,
    sessionEmail: "staff@example.com",
    adminSettings: {
      registration: { events: { "event-1": { checkInMode: "none" } } }
    }
  });
  assert.equal(publicHarness.context.verifyTicket({ token: "opaque-token" }).ok, true);
  const result = harness.context.checkIn({ token: "opaque-token", sessionId: "s1" });
  assert.equal(result.code, "CHECK_IN_DISABLED");
  assert.equal(rows(harness.sheets["签到记录"]).length, 0);
});

test("serialized check-ins make a concurrent duplicate observe the first committed row", async () => {
  const harness = await createHarness({ staffProject: true, sessionEmail: "staff@example.com" });
  const request = { token: "opaque-token", sessionId: "s1" };
  const results = [harness.context.checkIn(request), harness.context.checkIn(request)];

  assert.deepEqual(results.map((result) => result.ok), [true, false]);
  assert.equal(results[1].code, "ALREADY_CHECKED_IN");
  assert.deepEqual(harness.locks, ["acquire", "release", "acquire", "release"]);
  assert.equal(rows(harness.sheets["签到记录"]).length, 1);
});

test("check-in rejects inactive tickets, unregistered sessions, invalid status, and outside time policy", async () => {
  const cancelled = await createHarness({ staffProject: true, data: fixture({ ticketStatus: "cancelled" }), sessionEmail: "staff@example.com" });
  const invalidEvent = await createHarness({ staffProject: true, data: fixture({ eventStatus: "open" }), sessionEmail: "staff@example.com" });
  const outsideWindow = await createHarness({ staffProject: true, now: "2026-08-16T12:00:00Z", sessionEmail: "staff@example.com" });
  const request = { token: "opaque-token", sessionId: "s1" };

  assert.equal(cancelled.context.checkIn(request).code, "TICKET_INACTIVE");
  assert.equal(invalidEvent.context.checkIn(request).code, "CHECK_IN_CLOSED");
  assert.equal(outsideWindow.context.checkIn(request).code, "CHECK_IN_CLOSED");
  assert.equal((await createHarness({ staffProject: true, sessionEmail: "staff@example.com" })).context.checkIn({ ...request, sessionId: "missing" }).code, "SESSION_NOT_REGISTERED");
});
