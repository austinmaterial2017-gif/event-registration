import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const headers = {
  "活动": ["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "createdAt", "updatedAt"],
  "场次": ["sessionId", "eventId", "title", "speaker", "startsAt", "endsAt", "required", "capacity", "status", "createdAt", "updatedAt"],
  "座位": ["seatId", "eventId", "sessionId", "label", "zone", "status", "holderRegistrationId", "createdAt", "updatedAt"],
  "报名问题": ["questionId", "eventId", "label", "type", "required", "options", "sortOrder", "status", "createdAt", "updatedAt"],
  "参加者": ["participantId", "name", "phone", "email", "createdAt", "updatedAt"],
  "报名项目": ["registrationId", "eventId", "participantId", "ticketNumber", "status", "sessionIds", "seatChoices", "answers", "createdAt", "updatedAt"],
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
    "操作记录": overrides.audits || []
  };
}

async function createHarness({ rows = baseRows(), settings, onWrite } = {}) {
  const sheets = Object.fromEntries(Object.entries(rows).map(([name, values]) =>
    [name, new FakeSheet(name, values, onWrite)]));
  const spreadsheet = { getSheetByName: (name) => sheets[name] };
  const locks = [];
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
    Utilities: { getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` },
    getConfiguredSpreadsheet: () => spreadsheet,
    getRequiredSheet_: (_spreadsheet, name) => sheets[name],
    normalizeRow_: (name, row) => headers[name].map((key) => row[key] ?? ""),
    readRows: (name) => sheets[name].rows.slice(1).map((values, index) => ({
      rowNumber: index + 2,
      ...Object.fromEntries(headers[name].map((key, column) => [key, values[column]]))
    })),
    getAdminSettings: () => settings || {
      registration: {
        identityFields: ["email"],
        verificationField: "email",
        seatHoldsEnabled: true,
        events: { "event-1": { seatExchangeEnabled: true, seatHoldsEnabled: true } }
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
  return { context, sheets, locks };
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
  const { context } = await createHarness({
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
    })
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

test("lookup takes a lock and cancellation preserves rows while releasing the seat", async () => {
  const { context, locks, sheets } = await createHarness({
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
});

test("seat exchange rotates the token so the persisted old QR is invalid", async () => {
  const { context, sheets } = await createHarness({
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
  const exchanged = context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, true);
  assert.notEqual(exchanged.data.token, oldToken);
  const stored = sheetObjects(sheets["报名项目"]).map((row) => JSON.parse(row.answers).ticketToken);
  assert.equal(stored.includes(oldToken), false);
  assert.ok(stored.every((token) => token === exchanged.data.token));
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

test("an exchange audit failure does not roll back the already committed seat and token", async () => {
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
      if (phase === "exchange" && sheet.name === "操作记录" && values[0][1] === "EXCHANGE_SEAT") {
        throw new Error("audit write failed");
      }
    }
  });
  const created = harness.context.createRegistration(registrationPayload({ seatChoices: ["A1"] }));
  phase = "exchange";
  const exchanged = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, true);
  const seats = sheetObjects(harness.sheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, "");
  assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, created.data.registrationId);
  const tokens = sheetObjects(harness.sheets["报名项目"]).map((row) => JSON.parse(row.answers).ticketToken);
  assert.ok(tokens.every((token) => token === exchanged.data.token));
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

test("old-seat release failure keeps both seats owned and audits a release retry", async () => {
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
  phase = "exchange";
  const exchanged = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a1", newSeatId: "a2"
  });
  assert.equal(exchanged.ok, false);
  assert.equal(exchanged.code, "EXCHANGE_PENDING_CLEANUP");
  const seats = sheetObjects(harness.sheets["座位"]);
  assert.equal(seats.find((seat) => seat.seatId === "a1").holderRegistrationId, created.data.registrationId);
  assert.equal(seats.find((seat) => seat.seatId === "a2").holderRegistrationId, created.data.registrationId);
  assert.ok(sheetObjects(harness.sheets["操作记录"]).some((row) => row.action === "SEAT_RELEASE_RETRY"));
});

test("unresolved old-seat cleanup blocks repeated exchanges, then resolves without seat leakage", async () => {
  let failOldRelease = false;
  const harness = await createHarness({
    rows: baseRows({
      event: { seatMode: "self" },
      seats: [
        { seatId: "a1", eventId: "event-1", sessionId: "", label: "A1", zone: "front", status: "available" },
        { seatId: "a2", eventId: "event-1", sessionId: "", label: "A2", zone: "front", status: "available" },
        { seatId: "a3", eventId: "event-1", sessionId: "", label: "A3", zone: "front", status: "available" }
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
  assert.equal(firstExchange.code, "EXCHANGE_PENDING_CLEANUP");

  const blockedExchange = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a2", newSeatId: "a3"
  });
  assert.equal(blockedExchange.code, "EXCHANGE_PENDING_CLEANUP");
  assert.equal(sheetObjects(harness.sheets["座位"]).find((seat) => seat.seatId === "a3").holderRegistrationId, "");

  failOldRelease = false;
  const recovered = harness.context.lookupTicket({
    ticketNumber: created.data.ticketNumber,
    verificationValue: "alice@example.com"
  });
  assert.equal(recovered.ok, true);
  assert.equal(sheetObjects(harness.sheets["座位"]).find((seat) => seat.seatId === "a1").holderRegistrationId, "");
  assert.ok(sheetObjects(harness.sheets["操作记录"]).some((row) => row.action === "SEAT_RELEASE_RESOLVED"));

  const finalExchange = harness.context.exchangeSeat({
    ticketNumber: created.data.ticketNumber, verificationValue: "alice@example.com",
    oldSeatId: "a2", newSeatId: "a3"
  });
  assert.equal(finalExchange.ok, true);
  const ownedSeats = sheetObjects(harness.sheets["座位"]).filter((seat) => seat.holderRegistrationId === created.data.registrationId);
  assert.deepEqual(ownedSeats.map((seat) => seat.seatId), ["a3"]);
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
