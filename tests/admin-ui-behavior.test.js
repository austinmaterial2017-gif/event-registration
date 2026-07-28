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
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.focusCount = 0;
    this.scrollCalls = [];
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
    sheetUrl
  };
  return {
    connection: { connected: true, sheetName: "Private Sheet" },
    events: [eventId === "B" ? { ...event, eventId: "A", title: "Activity A", sheetUrl: "https://docs.google.com/spreadsheets/d/a/edit" } : { ...event, eventId: "B", title: "Activity B", sheetUrl: "https://docs.google.com/spreadsheets/d/b/edit" }, event],
    sessions: [{ eventId, title: `Session ${eventId}`, speaker: "Speaker", location: "Hall", startsAt: "", endsAt: "", capacity: 10, required: false, groupRule: "", status: "open" }],
    seats: [], questions: [], records: [], attendance: []
  };
}

async function createHarness() {
  const elements = new Map();
  const add = (selector, node = new FakeElement()) => (elements.set(selector, node), node);
  const eventForm = add("#event-form", form(["eventId", "title", "description", "status", "opensAt", "closesAt", "location", "selectionMode", "minChoices", "maxChoices", "seatMode", "seatZones", "showOpeningCountdown", "showClosingCountdown", "cancellationEnabled", "seatExchangeEnabled", "seatHoldsEnabled", "seatHoldMinutes"]));
  const sessionForm = add("#session-form", form(["eventId", "sessionId", "title", "speaker", "startsAt", "endsAt", "location", "capacity", "required", "groupRule", "status"]));
  const seatForm = add("#seat-form", form(["eventId", "sessionId", "mode", "zoneName", "rows", "seatsPerRow"]));
  const questionForm = add("#question-form", form(["eventId", "questionId", "label", "type", "options", "validation", "sortOrder", "status", "required", "showOnTicket", "duplicateIdentity", "semanticRole"]));
  const recordSearch = add("#record-search-form", form(["search"]));
  const recordAction = add("#record-action-form", form(["registrationId", "seatId"]));
  const sheetForm = add("#sheet-form", form(["spreadsheetId"]));
  for (const selector of ["#admin-status", "#connection-status", "#event-list", "#session-list", "#seat-list", "#question-list", "#record-list", "#attendance-list", "#selected-activity", "#selected-activity-title", "#selected-activity-meta", "#selected-activity-sheet", "#activity-empty-state", "#clear-search", "#test-sheet", "#switch-sheet", "#new-activity"]) add(selector);
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
  const document = {
    createElement: (tag) => new FakeElement(tag),
    querySelector: (query) => elements.get(query) || null,
    querySelectorAll: (query) => {
      if (query === ".selected-required") return sections;
      if (query === 'nav a[href^="#"]') return navLinks;
      if (query === "#event-form [data-action]") return lifecycle;
      if (query === "#record-action-form [data-action]" || query === "[data-copy-bundle]") return [];
      return [];
    }
  };
  const requests = [];
  const mutations = [];
  class Runner {
    withSuccessHandler(handler) { this.success = handler; return this; }
    withFailureHandler(handler) { this.failure = handler; return this; }
    getAdminDashboard(payload) { requests.push({ payload, success: this.success, failure: this.failure }); }
    saveAdminEvent(payload) { mutations.push({ kind: "event", payload, success: this.success }); }
    saveAdminSession() {} saveAdminSeatPlan() {} saveAdminQuestion() {} adminRecordAction() {}
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
  return { elements, eventForm, sessionForm, seatForm, questionForm, selector, sections, navLinks, lifecycle, requests, mutations };
}

test("later selected dashboard response wins when older request resolves last", async () => {
  const ui = await createHarness();
  ui.selector.value = "A"; ui.selector.dispatch("change");
  ui.selector.value = "B"; ui.selector.dispatch("change");
  ui.requests[2].success({ ok: true, data: dashboard("B", "Activity B") });
  ui.requests[1].success({ ok: true, data: dashboard("A", "Activity A") });

  assert.equal(ui.sessionForm.elements.eventId.value, "B");
  assert.equal(ui.elements.get("#selected-activity-title").textContent, "Activity B");
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

test("selection syncs dependent IDs, rejects unsafe sheet links, and create success selects the new activity", async () => {
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
  ui.mutations[0].success({ ok: true, data: { eventId: "C" } });
  assert.equal(ui.requests.at(-1).payload.eventId, "C");
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
