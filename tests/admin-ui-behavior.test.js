import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const scriptUrl = new URL("../staff-apps-script/AdminScript.html", import.meta.url);

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.elements = {};
    this.hidden = false;
    this.listeners = new Map();
    this.style = { setProperty: (name, value) => { this.style[name] = String(value); } };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const enabled = force === undefined ? !classes.has(name) : Boolean(force);
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      }
    };
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.focusCount = 0;
    this.scrollCalls = [];
    this.valid = true;
    this.reportValidityCount = 0;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, extra = {}) {
    const event = { currentTarget: this, preventDefault() {}, ...extra };
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focusCount += 1; }
  scrollIntoView(options) { this.scrollCalls.push(options); }
  checkValidity() { return this.valid; }
  reportValidity() { this.reportValidityCount += 1; return this.valid; }
  reset() {
    for (const field of Object.values(this.elements)) {
      field.value = "";
      field.checked = false;
    }
  }
  querySelector(selector) {
    if (selector === "input[name=title]") return this.elements.title;
    if (selector === "input:not([type=hidden]), select, textarea") return this.elements.title || this.elements.status;
    return null;
  }
}

class FakeFormData {
  constructor(form) {
    this.values = Object.entries(form.elements).map(([name, field]) => [name, field.value]);
  }
  entries() { return this.values[Symbol.iterator](); }
  [Symbol.iterator]() { return this.values[Symbol.iterator](); }
}

function field(value = "") {
  const node = new FakeElement("input");
  node.value = value;
  return node;
}

function form(names) {
  const node = new FakeElement("form");
  for (const name of names) node.elements[name] = field();
  return node;
}

function dashboard(eventId, title, sheetUrl = "https://docs.google.com/spreadsheets/d/safe-id/edit") {
  const event = {
    eventId,
    title,
    description: "",
    status: "open",
    opensAt: "",
    closesAt: "",
    location: "Hall",
    selectionMode: "none",
    minChoices: 0,
    maxChoices: 0,
    seatMode: "none",
    seatZones: [],
    showOpeningCountdown: false,
    showClosingCountdown: false,
    cancellationEnabled: false,
    seatExchangeEnabled: false,
    seatHoldsEnabled: false,
    seatHoldMinutes: 5,
    registrationTimeLimitMinutes: 5,
    totalCapacity: 0,
    checkInMode: "session",
    sheetUrl
  };
  return {
    connection: { connected: true, sheetName: "Private Sheet" },
    drafts: [],
    events: [eventId === "B" ? { ...event, eventId: "A", title: "Activity A", sheetUrl: "https://docs.google.com/spreadsheets/d/a/edit" } : { ...event, eventId: "B", title: "Activity B", sheetUrl: "https://docs.google.com/spreadsheets/d/b/edit" }, event],
    sessions: [{ sessionId: `session-${eventId}`, eventId, title: `Session ${eventId}`, speaker: "Speaker", location: "Hall", startsAt: "", endsAt: "", capacity: 10, required: false, groupRule: "", status: "open" }],
    seats: [{ seatId: `seat-${eventId}`, eventId, label: "A-01", zone: "A", sessionId: "", status: "available" }],
    questions: [],
    records: [{
      eventId, registrationId: `registration-${eventId}`, ticketNumber: "EVT-TEST",
      participantName: "Test User", status: "active", email: "test@example.com",
      phone: "", sessionIds: [], seatChoices: []
    }],
    attendance: []
  };
}

function draftDashboard(draftId, title, nextStep = "questions") {
  const base = dashboard("A", "Existing activity");
  return {
    ...base,
    drafts: [{
      draftId,
      nextStep,
      draft: {
        event: {
          title,
          description: "",
          status: "draft",
          opensAt: "",
          closesAt: "",
          location: "",
          selectionMode: "none",
          minChoices: 0,
          maxChoices: 0,
          seatMode: "none",
          seatZones: [],
          seatHoldMinutes: 5
        },
        sessions: [],
        seatPlan: { mode: "none", sessionId: "", zones: [] },
        questions: []
      }
    }]
  };
}

async function createHarness() {
  const elements = new Map();
  const add = (selector, node = new FakeElement()) => (elements.set(selector, node), node);
  const eventForm = add("#event-form", form(["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatMapLabel", "seatZones", "showOpeningCountdown", "showClosingCountdown", "cancellationEnabled", "seatExchangeEnabled", "seatHoldsEnabled", "seatHoldMinutes", "registrationTimeLimitMinutes", "totalCapacity", "checkInMode"]));
  eventForm.elements.seatHoldMinutes.value = "5";
  eventForm.elements.registrationTimeLimitMinutes.value = "5";
  eventForm.elements.totalCapacity.value = "0";
  eventForm.elements.checkInMode.value = "session";
  const sessionForm = add("#session-form", form(["eventId", "sessionId", "title", "speaker", "startsAt", "endsAt", "location", "capacity", "required", "groupRule", "status"]));
  const seatForm = add("#seat-form", form(["eventId", "sessionId", "mode", "zoneName", "rows", "seatsPerRow"]));
  const questionForm = add("#question-form", form(["eventId", "questionId", "label", "type", "options", "validation", "sortOrder", "status", "required", "showOnTicket", "duplicateIdentity", "semanticRole"]));
  const recordSearch = add("#record-search-form", form(["search"]));
  const recordAction = add("#record-action-form", form(["registrationId", "seatId"]));
  const sheetForm = add("#sheet-form", form(["spreadsheetId"]));
  for (const selector of ["#admin-status", "#connection-status", "#event-list", "#session-list", "#seat-list", "#question-list", "#record-list", "#attendance-list", "#selected-activity", "#selected-activity-title", "#selected-activity-meta", "#selected-activity-sheet", "#finalize-draft", "#delete-draft", "#delete-empty-event", "#min-session-field", "#max-session-field", "#seat-zone-field", "#activity-empty-state", "#clear-search", "#test-sheet", "#switch-sheet", "#new-activity", "#new-session", "#session-editor-mode", "#save-event", "#save-session", "#save-seat-plan", "#save-question", "#seat-preview", "#seat-preview-stage", "#seat-preview-floor", "#seat-preview-message", "#expand-seat-preview"]) add(selector);
  const selector = add("#activity-selector", new FakeElement("select"));
  const sections = ["#sessions", "#seats", "#questions", "#records", "#attendance"].map((id) => add(id));
  const navLinks = ["#events", "#sessions", "#seats", "#questions", "#records", "#attendance"].map((href) => {
    const link = new FakeElement("a");
    link.setAttribute("href", href);
    return link;
  });
  const lifecycle = ["close", "reopen", "archive"].map((action) => {
    const button = new FakeElement("button");
    button.dataset.action = action;
    return button;
  });
  const recordActions = ["cancel_registration", "adjust_seat"].map((action) => {
    const button = new FakeElement("button");
    button.dataset.action = action;
    return button;
  });
  const document = {
    body: new FakeElement("body"),
    addEventListener() {},
    createElement: (tag) => new FakeElement(tag),
    querySelector: (query) => elements.get(query) || null,
    querySelectorAll: (query) => {
      if (query === ".selected-required") return sections;
      if (query === ".generated-required") return sections.slice(-2);
      if (query === 'nav a[href^="#"]') return navLinks;
      if (query === "#event-form [data-action]") return lifecycle;
      if (query === "#record-action-form [data-action]") return recordActions;
      if (query === "[data-copy-bundle]") return [];
      return [];
    }
  };
  const requests = [];
  const mutations = [];
  class Runner {
    withSuccessHandler(handler) { this.success = handler; return this; }
    withFailureHandler(handler) { this.failure = handler; return this; }
    getAdminDashboard(payload) { requests.push({ payload, success: this.success, failure: this.failure }); }
    saveAdminDraft(payload) {
      mutations.push({ kind: "draft", payload, success: this.success, failure: this.failure });
    }
    finalizeAdminDraft(payload) {
      mutations.push({ kind: "finalize", payload, success: this.success, failure: this.failure });
    }
    deleteAdminDraft(payload) {
      mutations.push({ kind: "deleteDraft", payload, success: this.success, failure: this.failure });
    }
    deleteEmptyAdminEvent(payload) {
      mutations.push({ kind: "deleteEvent", payload, success: this.success, failure: this.failure });
    }
    saveAdminEvent(payload) {
      mutations.push({ kind: "event", payload, success: this.success, failure: this.failure });
    }
    saveAdminSession(payload) {
      mutations.push({ kind: "session", payload, success: this.success, failure: this.failure });
    }
    deleteAdminSession(payload) {
      mutations.push({ kind: "deleteSession", payload, success: this.success, failure: this.failure });
    }
    saveAdminSeatPlan(payload) {
      mutations.push({ kind: "seat", payload, success: this.success, failure: this.failure });
    }
    saveAdminQuestion(payload) {
      mutations.push({ kind: "question", payload, success: this.success, failure: this.failure });
    }
    adminRecordAction(payload) {
      mutations.push({ kind: "record", payload, success: this.success, failure: this.failure });
    }
    testAdminSheetConnection() {} switchAdminSheet() {} getAdminSourceBundles() {}
  }
  const context = vm.createContext({
    document,
    FormData: FakeFormData,
    URL,
    console,
    google: { script: { get run() { return new Runner(); } } },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { confirm: () => true, matchMedia: () => ({ matches: false }) }
  });
  const source = (await readFile(scriptUrl, "utf8")).replace(/^<script>\s*|\s*<\/script>\s*$/g, "");
  vm.runInContext(source, context);
  return {
    elements, eventForm, sessionForm, seatForm, questionForm, recordAction,
    selector, sections, navLinks, lifecycle, recordActions, requests, mutations
  };
}

test("later selected dashboard response wins when older request resolves last", async () => {
  const ui = await createHarness();
  ui.selector.value = "A"; ui.selector.dispatch("change");
  ui.selector.value = "B"; ui.selector.dispatch("change");
  ui.requests[2].success({ ok: true, data: dashboard("B", "Activity B") });
  ui.requests[1].success({ ok: true, data: dashboard("A", "Activity A") });

  assert.equal(ui.sessionForm.elements.eventId.value, "B");
  assert.equal(ui.elements.get("#selected-activity-title").textContent, "正在设置：Activity B");
  assert.equal(ui.elements.get("#session-list").children[0].children[1].textContent, "Session B");
});

test("clearing activity selection resets stale editor and blocks lifecycle mutation", async () => {
  const ui = await createHarness();
  ui.selector.value = "A"; ui.selector.dispatch("change");
  ui.requests[1].success({ ok: true, data: dashboard("A", "Activity A") });
  ui.selector.value = ""; ui.selector.dispatch("change");
  ui.lifecycle[0].dispatch("click");

  assert.equal(ui.eventForm.elements.eventId.value, "");
  assert.equal(ui.eventForm.elements.title.value, "");
  assert.equal(ui.mutations.length, 0);
  assert.equal(ui.lifecycle.every((button) => button.disabled), true);
});

test("selection syncs dependent IDs, rejects unsafe sheet links, and new saves remain private drafts", async () => {
  const ui = await createHarness();
  ui.selector.value = "B"; ui.selector.dispatch("change");
  ui.requests[1].success({ ok: true, data: dashboard("B", "Activity B", "https://attacker.example/sheet") });

  assert.equal(ui.sessionForm.elements.eventId.value, "B");
  assert.equal(ui.seatForm.elements.eventId.value, "B");
  assert.equal(ui.questionForm.elements.eventId.value, "B");
  assert.equal(ui.elements.get("#selected-activity-sheet").hidden, true);
  assert.equal(ui.elements.get("#selected-activity-sheet").getAttribute("href"), null);

  ui.elements.get("#new-activity").dispatch("click");
  ui.eventForm.elements.title.value = "Created";
  ui.eventForm.dispatch("submit");
  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.mutations[0].kind, "draft");
  assert.equal(Object.hasOwn(ui.mutations[0].payload, "eventId"), false);
  const savedDraft = draftDashboard("D", "Created").drafts[0];
  ui.mutations[0].success({ ok: true, data: savedDraft });
  assert.equal(Object.hasOwn(ui.requests.at(-1).payload, "eventId"), false);
  ui.requests.at(-1).success({ ok: true, data: draftDashboard("D", "Created") });
  assert.equal(ui.selector.value, "draft:D");
  assert.equal(ui.elements.get("#selected-activity-sheet").hidden, true);
});

test("an activity save ignores repeated clicks until the current request settles", async () => {
  const ui = await createHarness();
  ui.eventForm.elements.title.value = "One activity";

  ui.eventForm.dispatch("submit");
  ui.eventForm.dispatch("submit");

  assert.equal(ui.mutations.length, 1);
  assert.equal(ui.elements.get("#save-event").disabled, true);

  ui.mutations[0].failure(new Error("temporary failure"));
  assert.equal(ui.elements.get("#save-event").disabled, false);

  ui.eventForm.dispatch("submit");
  assert.equal(ui.mutations.length, 2);
});

test("an invalid activity edit explains the exact field and stale errors clear after editing", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  ui.eventForm.elements.minChoices.value = "4";
  ui.eventForm.elements.maxChoices.value = "2";
  ui.eventForm.dispatch("submit");

  assert.equal(ui.mutations.length, 0);
  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "最多场次不能少于最少场次。"
  );

  ui.eventForm.elements.maxChoices.value = "5";
  ui.eventForm.dispatch("input");
  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "内容已修改，请按“保存活动”确认。"
  );
});

test("a successful activity draft save announces the next required setup section", async () => {
  const ui = await createHarness();
  ui.eventForm.elements.title.value = "Created activity";

  ui.eventForm.dispatch("submit");
  const savedDraft = draftDashboard("D", "Created activity").drafts[0];
  ui.mutations[0].success({ ok: true, data: savedDraft });
  ui.requests.at(-1).success({ ok: true, data: draftDashboard("D", "Created activity") });

  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "草稿保存成功，下一步请建立报名问题。"
  );
  assert.equal(ui.elements.get("#questions").scrollCalls.length, 1);
});

test("a confirmed draft generates one activity and does not open registration", async () => {
  const ui = await createHarness();
  ui.selector.value = "draft:D";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({
    ok: true,
    data: draftDashboard("D", "Ready activity", "confirm")
  });

  const finalize = ui.elements.get("#finalize-draft");
  finalize.dispatch("click");
  finalize.dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "finalize").length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations.at(-1).payload)),
    { draftId: "D", confirm: true }
  );
  ui.mutations.at(-1).success({
    ok: true,
    data: {
      draftId: "D",
      eventId: "C",
      sheetUrl: "https://docs.google.com/spreadsheets/d/c/edit",
      status: "draft",
      alreadyFinalized: false
    }
  });
  const generatedDashboard = dashboard("C", "Ready activity");
  generatedDashboard.events.find((item) => item.eventId === "C").status = "draft";
  ui.requests.at(-1).success({ ok: true, data: generatedDashboard });

  assert.equal(ui.elements.get("#admin-status").textContent,
    "数据表建立成功；请检查后再开放报名。");
  assert.equal(ui.eventForm.elements.status.value, "draft");
});

test("draft and empty-event deletion require one confirmed pending action", async () => {
  const draftUi = await createHarness();
  draftUi.selector.value = "draft:D";
  draftUi.selector.dispatch("change");
  draftUi.requests.at(-1).success({
    ok: true,
    data: draftDashboard("D", "Disposable draft", "confirm")
  });
  const deleteDraft = draftUi.elements.get("#delete-draft");
  deleteDraft.dispatch("click");
  deleteDraft.dispatch("click");
  assert.equal(draftUi.mutations.filter((item) => item.kind === "deleteDraft").length, 1);
  assert.equal(deleteDraft.disabled, true);

  const eventUi = await createHarness();
  eventUi.selector.value = "B";
  eventUi.selector.dispatch("change");
  const emptyEventDashboard = dashboard("B", "Empty generated activity");
  emptyEventDashboard.events.find((item) => item.eventId === "B").canDelete = true;
  eventUi.requests.at(-1).success({ ok: true, data: emptyEventDashboard });
  const deleteEvent = eventUi.elements.get("#delete-empty-event");
  assert.equal(deleteEvent.hidden, false);
  deleteEvent.dispatch("click");
  deleteEvent.dispatch("click");
  assert.equal(eventUi.mutations.filter((item) => item.kind === "deleteEvent").length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(eventUi.mutations.at(-1).payload)),
    { eventId: "B", confirm: true }
  );
});

test("session, seat-plan, and question saves show progress and ignore repeated clicks", async () => {
  const ui = await createHarness();

  ui.sessionForm.elements.title.value = "Valid session";
  ui.sessionForm.elements.capacity.value = "0";
  ui.sessionForm.dispatch("submit");
  ui.sessionForm.dispatch("submit");
  ui.seatForm.elements.mode.value = "none";
  ui.seatForm.dispatch("submit");
  ui.seatForm.dispatch("submit");
  ui.questionForm.elements.label.value = "Name";
  ui.questionForm.elements.type.value = "text";
  ui.questionForm.elements.sortOrder.value = "0";
  ui.questionForm.elements.validation.value = "{}";
  ui.questionForm.dispatch("submit");
  ui.questionForm.dispatch("submit");

  assert.equal(ui.mutations.filter((item) => item.kind === "session").length, 1);
  assert.equal(ui.mutations.filter((item) => item.kind === "seat").length, 1);
  assert.equal(ui.mutations.filter((item) => item.kind === "question").length, 1);
  assert.equal(ui.elements.get("#save-session").disabled, true);
  assert.equal(ui.elements.get("#save-seat-plan").disabled, true);
  assert.equal(ui.elements.get("#save-question").disabled, true);

  const sessionSave = ui.mutations.find((item) => item.kind === "session");
  sessionSave.success({ ok: true, data: {} });
  assert.equal(ui.elements.get("#admin-status").textContent, "场次保存成功。");
  assert.equal(ui.elements.get("#save-session").disabled, false);
});

test("a draft question can be deleted once and the remaining draft is persisted", async () => {
  const ui = await createHarness();
  const data = draftDashboard("D", "Question draft");
  data.drafts[0].draft.questions = [
    {
      draftKey: "draft-question-1",
      label: "电话号码",
      type: "tel",
      options: [],
      validation: {},
      sortOrder: 1,
      status: "active",
      required: true,
      showOnTicket: false,
      duplicateIdentity: true,
      semanticRole: "phone"
    },
    {
      draftKey: "draft-question-2",
      label: "交通",
      type: "text",
      options: [],
      validation: {},
      sortOrder: 2,
      status: "active",
      required: false,
      showOnTicket: false,
      duplicateIdentity: false,
      semanticRole: ""
    }
  ];
  ui.selector.value = "draft:D";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data });

  const firstRow = ui.elements.get("#question-list").children[0];
  const deleteButton = firstRow.children.at(-1).children
    .find((button) => button.textContent === "删除问题");
  deleteButton.dispatch("click");
  deleteButton.dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "draft").length, 1);
  assert.equal(deleteButton.disabled, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations.at(-1).payload.questions)),
    [data.drafts[0].draft.questions[1]]
  );
});

test("a draft session can be deleted once and a matching draft seat-plan link is cleared", async () => {
  const ui = await createHarness();
  const data = draftDashboard("D", "Session draft");
  data.drafts[0].draft.sessions = [
    {
      draftKey: "draft-session-1",
      title: "Disposable session",
      speaker: "Speaker A",
      startsAt: "",
      endsAt: "",
      location: "Room A",
      capacity: 0,
      required: false,
      groupRule: "",
      status: "draft"
    },
    {
      draftKey: "draft-session-2",
      title: "Remaining session",
      speaker: "Speaker B",
      startsAt: "",
      endsAt: "",
      location: "Room B",
      capacity: 0,
      required: false,
      groupRule: "",
      status: "draft"
    }
  ];
  data.drafts[0].draft.seatPlan.sessionId = "draft-session-1";
  ui.selector.value = "draft:D";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data });

  const firstRow = ui.elements.get("#session-list").children[0];
  const deleteButton = firstRow.children.at(-1).children
    .find((button) => button.textContent === "删除场次");
  deleteButton.dispatch("click");
  deleteButton.dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "draft").length, 1);
  assert.equal(deleteButton.disabled, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations.at(-1).payload.sessions)),
    [data.drafts[0].draft.sessions[1]]
  );
  assert.equal(ui.mutations.at(-1).payload.seatPlan.sessionId, "");
});

test("a generated session delete sends one confirmed request and gives visible feedback", async () => {
  const ui = await createHarness();
  const data = dashboard("B", "Generated activity");
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data });

  const sessionRow = ui.elements.get("#session-list").children[0];
  const deleteButton = sessionRow.children.at(-1).children
    .find((button) => button.textContent === "删除场次");
  deleteButton.dispatch("click");
  deleteButton.dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "deleteSession").length, 1);
  assert.equal(deleteButton.disabled, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations.at(-1).payload)),
    { eventId: "B", sessionId: "session-B", confirm: true }
  );
  ui.mutations.at(-1).success({
    ok: true,
    data: { eventId: "B", sessionId: "session-B", deleted: true }
  });
  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "场次已删除。"
  );
});

test("a generated question is hidden instead of deleting its registration history", async () => {
  const ui = await createHarness();
  const data = dashboard("B", "Generated activity");
  data.questions = [{
    eventId: "B",
    questionId: "question-B",
    label: "电话号码",
    type: "tel",
    options: [],
    validation: {},
    sortOrder: 1,
    status: "active",
    required: true,
    showOnTicket: false,
    duplicateIdentity: true,
    semanticRole: "phone"
  }];
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data });

  const questionRow = ui.elements.get("#question-list").children[0];
  const hideButton = questionRow.children.at(-1).children
    .find((button) => button.textContent === "隐藏问题");
  hideButton.dispatch("click");
  hideButton.dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "question").length, 1);
  assert.equal(hideButton.disabled, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations.at(-1).payload)),
    {
      eventId: "B",
      questionId: "question-B",
      action: "hide",
      duplicateIdentity: false,
      showOnTicket: false
    }
  );
});

test("session, seat, question, and record forms reject invalid fields with exact guidance", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  ui.sessionForm.elements.title.value = "";
  ui.sessionForm.dispatch("submit");
  assert.equal(ui.mutations.length, 0);
  assert.equal(ui.elements.get("#admin-status").textContent, "请填写场次标题。");

  ui.seatForm.elements.mode.value = "self";
  ui.seatForm.elements.rows.value = "0";
  ui.seatForm.elements.seatsPerRow.value = "5";
  ui.seatForm.dispatch("submit");
  assert.equal(ui.mutations.length, 0);
  assert.equal(ui.elements.get("#admin-status").textContent, "座位行数必须是 1 或以上的整数。");

  ui.questionForm.elements.label.value = "选择班级";
  ui.questionForm.elements.type.value = "select";
  ui.questionForm.elements.options.value = "";
  ui.questionForm.elements.validation.value = "{}";
  ui.questionForm.dispatch("submit");
  assert.equal(ui.mutations.length, 0);
  assert.equal(ui.elements.get("#admin-status").textContent, "这个问题类型需要至少一个选项（每行一个）。");

  ui.recordActions[0].dispatch("click");
  assert.equal(ui.mutations.length, 0);
  assert.equal(ui.elements.get("#admin-status").textContent, "请填写要处理的报名 ID。");
});

test("question form explains incompatible semantic roles before sending", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  ui.questionForm.elements.label.value = "电邮";
  ui.questionForm.elements.type.value = "text";
  ui.questionForm.elements.semanticRole.value = "email";
  ui.questionForm.elements.sortOrder.value = "0";
  ui.questionForm.elements.validation.value = "{}";
  ui.questionForm.dispatch("submit");

  assert.equal(ui.mutations.length, 0);
  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "资料用途“电邮栏”必须使用 email 字段类型。"
  );
});

test("question form explains duplicate identity requirements before sending", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  ui.questionForm.elements.label.value = "姓名";
  ui.questionForm.elements.type.value = "text";
  ui.questionForm.elements.semanticRole.value = "name";
  ui.questionForm.elements.status.value = "active";
  ui.questionForm.elements.required.checked = false;
  ui.questionForm.elements.duplicateIdentity.checked = true;
  ui.questionForm.elements.sortOrder.value = "0";
  ui.questionForm.elements.validation.value = "{}";
  ui.questionForm.dispatch("submit");

  assert.equal(ui.mutations.length, 0);
  assert.equal(
    ui.elements.get("#admin-status").textContent,
    "用于重复身份判断的问题必须设为“显示”并勾选“必填”。"
  );
});

test("question form automatically keeps semantic role and identity settings compatible", async () => {
  const ui = await createHarness();

  ui.questionForm.elements.semanticRole.value = "email";
  ui.questionForm.elements.semanticRole.dispatch("change");
  assert.equal(ui.questionForm.elements.type.value, "email");

  ui.questionForm.elements.required.checked = false;
  ui.questionForm.elements.status.value = "inactive";
  ui.questionForm.elements.duplicateIdentity.checked = true;
  ui.questionForm.elements.duplicateIdentity.dispatch("change");
  assert.equal(ui.questionForm.elements.required.checked, true);
  assert.equal(ui.questionForm.elements.status.value, "active");
});

test("seat preview updates from form fields, toggles locally, and never sends a mutation", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  const data = dashboard("B", "Activity B");
  ui.requests.at(-1).success({ ok: true, data });

  ui.eventForm.elements.seatMapLabel.value = "WHITE BOARD";
  ui.seatForm.elements.mode.value = "self";
  ui.seatForm.elements.zoneName.value = "A";
  ui.seatForm.elements.rows.value = "2";
  ui.seatForm.elements.seatsPerRow.value = "3";
  ui.seatForm.dispatch("input");

  const floor = ui.elements.get("#seat-preview-floor");
  assert.equal(ui.elements.get("#seat-preview-stage").textContent, "WHITE BOARD");
  assert.equal(floor.children.length, 1);
  const grid = floor.children[0].children[1];
  assert.equal(grid.children.length, 6);
  assert.equal(grid.children[0].textContent, "A-1-1");

  grid.children[0].dispatch("click");
  const selectedGrid = floor.children[0].children[1];
  assert.equal(selectedGrid.children[0].classList.contains("is-selected"), true);
  assert.equal(ui.mutations.length, 0);

  ui.seatForm.elements.mode.value = "none";
  ui.seatForm.dispatch("change");
  assert.equal(
    ui.elements.get("#seat-preview-message").textContent,
    "参与者会看到自由入座，不需要选择座位。"
  );
});

test("a successful session save clears editing state and reports the current session total", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });
  ui.sessionForm.elements.sessionId.value = "session-B";
  ui.sessionForm.elements.title.value = "Updated session";

  ui.sessionForm.dispatch("submit");
  const sessionSave = ui.mutations.find((item) => item.kind === "session");
  sessionSave.success({ ok: true, data: {} });
  const refreshed = dashboard("B", "Activity B");
  refreshed.sessions.push({
    eventId: "B", sessionId: "session-B-2", title: "Session B2",
    speaker: "Speaker 2", location: "Hall", startsAt: "", endsAt: "",
    capacity: 10, required: false, groupRule: "", status: "open"
  });
  ui.requests.at(-1).success({ ok: true, data: refreshed });

  assert.equal(ui.sessionForm.elements.eventId.value, "B");
  assert.equal(ui.sessionForm.elements.sessionId.value, "");
  assert.equal(ui.sessionForm.elements.title.value, "");
  assert.equal(ui.elements.get("#session-editor-mode").textContent, "正在新增场次");
  assert.equal(ui.elements.get("#save-session").textContent, "保存新场次");
  assert.equal(ui.elements.get("#admin-status").textContent, "场次保存成功，目前已有 2 个场次。");
});

test("administrator UI omits an absent event ID and attaches the selected ID to seat and record actions", async () => {
  const ui = await createHarness();

  assert.equal(Object.hasOwn(ui.requests[0].payload, "eventId"), false);

  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  const seatActions = ui.elements.get("#seat-list").children[0].children.at(-1).children;
  seatActions.forEach((button) => button.dispatch("click"));
  ui.recordAction.elements.registrationId.value = "registration-B";
  ui.recordAction.elements.seatId.value = "seat-B";
  ui.recordActions.forEach((button) => button.dispatch("click"));

  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations
      .filter((mutation) => mutation.kind === "seat")
      .map((mutation) => mutation.payload))),
    [
      { eventId: "B", action: "reserve", seatId: "seat-B" },
      { eventId: "B", action: "close", seatId: "seat-B" },
      { eventId: "B", action: "reopen", seatId: "seat-B" }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(ui.mutations
      .filter((mutation) => mutation.kind === "record")
      .map((mutation) => mutation.payload))),
    [
      { eventId: "B", action: "cancel_registration", registrationId: "registration-B", seatId: "seat-B", confirm: true },
      { eventId: "B", action: "adjust_seat", registrationId: "registration-B", seatId: "seat-B", confirm: true }
    ]
  );

  ui.selector.value = "";
  ui.selector.dispatch("change");
  const mutationCount = ui.mutations.length;
  seatActions[0].dispatch("click");
  ui.recordActions[0].dispatch("click");
  assert.equal(ui.mutations.length, mutationCount);
});

test("seat and registration action buttons show progress and ignore repeated clicks", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  const seatButton = ui.elements.get("#seat-list").children[0].children.at(-1).children[0];
  seatButton.dispatch("click");
  seatButton.dispatch("click");
  ui.recordAction.elements.registrationId.value = "registration-B";
  ui.recordActions[0].dispatch("click");
  ui.recordActions[0].dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "seat").length, 1);
  assert.equal(ui.mutations.filter((item) => item.kind === "record").length, 1);
  assert.equal(seatButton.disabled, true);
  assert.equal(ui.recordActions[0].disabled, true);
});

test("activity lifecycle buttons visibly enter a single pending operation", async () => {
  const ui = await createHarness();
  ui.selector.value = "B";
  ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("B", "Activity B") });

  ui.lifecycle[0].textContent = "关闭为已结束";
  ui.lifecycle[0].dispatch("click");
  ui.lifecycle[0].dispatch("click");

  assert.equal(ui.mutations.filter((item) => item.kind === "event").length, 1);
  assert.equal(ui.lifecycle[0].disabled, true);
  assert.equal(ui.lifecycle[0].textContent, "处理中…");
});

test("navigation declines hidden sections until an activity is selected", async () => {
  const ui = await createHarness();
  ui.requests[0].success({ ok: true, data: { connection: {}, events: [], sessions: [], seats: [], questions: [], records: [], attendance: [] } });
  const sessionsLink = ui.navLinks.find((link) => link.getAttribute("href") === "#sessions");
  sessionsLink.dispatch("click");

  assert.equal(ui.elements.get("#sessions").scrollCalls.length, 0);
  assert.equal(sessionsLink.getAttribute("aria-current"), null);
  assert.equal(ui.selector.focusCount, 1);

  ui.selector.value = "A"; ui.selector.dispatch("change");
  ui.requests.at(-1).success({ ok: true, data: dashboard("A", "Activity A") });
  sessionsLink.dispatch("click");
  assert.equal(ui.elements.get("#sessions").scrollCalls.length, 1);
  assert.equal(sessionsLink.getAttribute("aria-current"), "page");

  ui.selector.value = ""; ui.selector.dispatch("change");
  assert.equal(sessionsLink.getAttribute("aria-disabled"), "true");
  assert.equal(sessionsLink.getAttribute("aria-current"), null);
});
