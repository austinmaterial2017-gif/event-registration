import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createApiClient, DEMO_ENDPOINT_PLACEHOLDER } from "../public/js/api.js";

const endpoint = "https://script.google.com/macros/s/example/exec";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function clientWithResponse(body, status = 200) {
  const calls = [];
  const client = createApiClient({
    endpoint,
    timeoutMs: 100,
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse(body, status);
    }
  });
  return { client, calls };
}

test("every public method sends its JSON envelope as a CORS-safe simple POST", async () => {
  const { client, calls } = clientWithResponse({ ok: true, data: { accepted: true } });
  const expected = [
    ["listEvents", {}, () => client.listEvents()],
    ["getEvent", { eventId: "event-1" }, () => client.getEvent("event-1")],
    ["createRegistration", { eventId: "event-1", sessionIds: ["s1"], seatChoices: ["A-01"], answers: { name: "陈晓明" } }, () => client.createRegistration({ eventId: "event-1", sessionIds: ["s1"], seatChoices: ["A-01"], answers: { name: "陈晓明" } })],
    ["recoverTicket", { eventId: "event-1", name: "Alice Chan", phone: "+60123456789" }, () => client.recoverTicket({ eventId: "event-1", name: "Alice Chan", phone: "+60123456789" })],
    ["lookupTicket", { ticketNumber: "T-01", verificationValue: "13800000000" }, () => client.lookupTicket("T-01", "13800000000")],
    ["verifyTicket", { token: "signed-token" }, () => client.verifyTicket("signed-token")],
    ["createSeatHold", { eventId: "event-1", seatId: "seat-1", holdOwner: "browser-owner-0001" }, () => client.createSeatHold({ eventId: "event-1", seatId: "seat-1", holdOwner: "browser-owner-0001" })],
    ["releaseSeatHold", { eventId: "event-1", seatId: "seat-1", holdOwner: "browser-owner-0001" }, () => client.releaseSeatHold({ eventId: "event-1", seatId: "seat-1", holdOwner: "browser-owner-0001" })],
    ["cancelRegistration", { ticketNumber: "T-01", verificationValue: "13800000000" }, () => client.cancelRegistration("T-01", "13800000000")],
    ["exchangeSeat", { ticketNumber: "T-01", verificationValue: "13800000000", oldSeatId: "seat-1", newSeatId: "seat-2", seatHoldOwner: "browser-owner-0001" }, () => client.exchangeSeat({ ticketNumber: "T-01", verificationValue: "13800000000", oldSeatId: "seat-1", newSeatId: "seat-2", seatHoldOwner: "browser-owner-0001" })],
    ["updateRegistrationSessions", {
      ticketNumber: "T-01",
      verificationValue: "13800000000",
      sessionIds: ["s1", "s2"],
      seatChoices: ["seat-s2"],
      seatHoldOwner: "browser-owner-0001"
    }, () => client.updateRegistrationSessions({
      ticketNumber: "T-01",
      verificationValue: "13800000000",
      sessionIds: ["s1", "s2"],
      seatChoices: ["seat-s2"],
      seatHoldOwner: "browser-owner-0001"
    })]
  ];

  for (const [action, payload, invoke] of expected) {
    assert.deepEqual(await invoke(), { ok: true, data: { accepted: true } });
    const [url, options] = calls.at(-1);
    assert.equal(url, endpoint);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "text/plain;charset=utf-8");
    assert.deepEqual(JSON.parse(options.body), { action, payload });
  }
});

test("timeouts and offline failures are normalized into clear Chinese messages", async () => {
  const timeout = createApiClient({
    endpoint,
    timeoutMs: 1,
    fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
  });
  const offline = createApiClient({ endpoint, fetchImpl: async () => { throw new TypeError("failed to fetch"); } });

  assert.deepEqual(await timeout.listEvents(), { ok: false, code: "TIMEOUT", message: "请求超时，请检查网络后重试。" });
  assert.deepEqual(await offline.listEvents(), { ok: false, code: "NETWORK_ERROR", message: "网络连接异常，请检查网络后重试。" });
});

test("the production timeout tolerates an Apps Script cold start", async () => {
  const source = await readFile(new URL("../public/js/api.js", import.meta.url), "utf8");
  const match = source.match(/const DEFAULT_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(match, "default timeout declaration is missing");
  assert.ok(Number(match[1].replaceAll("_", "")) >= 60_000);
});

test("participant entry modules cache-bust the production API client", async () => {
  const root = new URL("../public/js/", import.meta.url);
  const modules = [
    ["index-page.js", "20260728-stable"],
    ["register-page.js", "20260728-stable"],
    ["ticket-page.js", "20260806-recovery"],
    ["verify-page.js", "20260728-stable"]
  ];
  for (const [name, version] of modules) {
    const source = await readFile(new URL(name, root), "utf8");
    assert.match(source, new RegExp(`from\\s+["']\\.\\/api\\.js\\?v=${version}["']`));
  }
});

test("participant HTML cache-busts each updated entry module", async () => {
  const root = new URL("../public/", import.meta.url);
  const pages = [
    ["index.html", "index-page.js", "20260729-dates"],
    ["register.html", "register-page.js", "20260806-review"],
    ["ticket.html", "ticket-page.js", "20260806-recovery"],
    ["verify.html", "verify-page.js", "20260728-final"],
    ["v.html", "verify-page.js", "20260728-final"]
  ];
  for (const [page, moduleName, version] of pages) {
    const source = await readFile(new URL(page, root), "utf8");
    assert.match(source, new RegExp(`src=["']js/${moduleName.replace(".", "\\.")}\\?v=${version}["']`));
  }
});

test("malformed JSON and non-success HTTP statuses are safe normalized failures", async () => {
  const malformed = createApiClient({ endpoint, fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("unexpected private detail"); } }) });
  const unavailable = createApiClient({ endpoint, fetchImpl: async () => jsonResponse({ message: "internal stack trace" }, 503) });

  assert.deepEqual(await malformed.listEvents(), { ok: false, code: "INVALID_RESPONSE", message: "服务返回的数据无效，请稍后重试。" });
  assert.deepEqual(await unavailable.listEvents(), { ok: false, code: "HTTP_ERROR", message: "服务暂时不可用，请稍后重试。" });
});

test("a server error and successful response use the public result contract without internals", async () => {
  const rejected = clientWithResponse({ ok: false, code: "REGISTRATION_CLOSED", message: "报名已截止" }).client;
  const unsafeMessage = clientWithResponse({ ok: false, code: "INTERNAL", message: "Error: stack trace / private implementation" }).client;
  const databaseMessage = clientWithResponse({ ok: false, code: "INTERNAL", message: "SQLSTATE[42S02]: private database details" }).client;
  const successful = clientWithResponse({ ok: true, data: { serverNow: "2026-07-26T10:00:00+08:00", events: [] } }).client;

  assert.deepEqual(await rejected.createRegistration({}), { ok: false, code: "REGISTRATION_CLOSED", message: "报名已截止。" });
  assert.deepEqual(await unsafeMessage.listEvents(), { ok: false, code: "INTERNAL", message: "请求未能完成，请稍后重试。" });
  assert.deepEqual(await databaseMessage.listEvents(), { ok: false, code: "INTERNAL", message: "请求未能完成，请稍后重试。" });
  assert.deepEqual(await successful.listEvents(), { ok: true, data: { serverNow: "2026-07-26T10:00:00+08:00", events: [] } });
});

test("only allowlisted public error codes receive fixed Chinese messages", async () => {
  const closed = clientWithResponse({ ok: false, code: "REGISTRATION_CLOSED", message: "a different short message" }).client;
  const unknown = clientWithResponse({ ok: false, code: "UNEXPECTED_FAILURE", message: "也不能公开这段服务端信息" }).client;

  assert.deepEqual(await closed.listEvents(), { ok: false, code: "REGISTRATION_CLOSED", message: "报名已截止。" });
  assert.deepEqual(await unknown.listEvents(), { ok: false, code: "UNEXPECTED_FAILURE", message: "请求未能完成，请稍后重试。" });
});

test("an abort while parsing JSON is normalized as a timeout", async () => {
  const client = createApiClient({
    endpoint,
    timeoutMs: 1,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    })
  });

  assert.deepEqual(await client.listEvents(), { ok: false, code: "TIMEOUT", message: "请求超时，请检查网络后重试。" });
});

test("unsafe endpoints are rejected before a network request", async () => {
  let called = false;
  const client = createApiClient({ endpoint: "javascript:alert(1)", fetchImpl: async () => { called = true; } });
  assert.deepEqual(await client.listEvents(), { ok: false, code: "UNSAFE_ENDPOINT", message: "服务地址配置无效。" });
  assert.equal(called, false);
});

test("the exact placeholder enables an explicit non-persistent demonstration adapter", async () => {
  const client = createApiClient({ endpoint: DEMO_ENDPOINT_PLACEHOLDER, fetchImpl: async () => { throw new Error("network must not run in demo"); } });
  const listed = await client.listEvents();
  const created = await client.createRegistration({ eventId: "night-of-ideas", sessionIds: [], seatChoices: [], answers: {} });

  assert.equal(listed.ok, true);
  assert.equal(listed.demo, true);
  assert.match(listed.message, /演示模式/);
  assert.deepEqual(created, { ok: true, demo: true, message: "演示模式：报名不会保存或发送。", data: { registrationId: "DEMO-NOT-STORED" } });
});

test("public client files contain no forbidden configuration strings", async () => {
  const root = new URL("../public/js/", import.meta.url);
  const [config, api] = await Promise.all([readFile(new URL("config.js", root), "utf8"), readFile(new URL("api.js", root), "utf8")]);
  assert.match(config, /^export const APPS_SCRIPT_WEB_APP_URL = "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";\s*export const PUBLIC_BASE_URL = "PASTE_PUBLIC_BASE_URL_HERE";\s*$/);
  for (const forbidden of [/spreadsheet/i, /sheetId/i, /password/i, /allowlist/i, /administrator/i, /doGet/i, /doPost/i, /innerHTML/]) {
    assert.doesNotMatch(`${config}\n${api}`, forbidden);
  }
});

test("participant controllers use the public client instead of temporary registration adapters", async () => {
  const root = new URL("../public/js/", import.meta.url);
  const [indexPage, registerPage] = await Promise.all([
    readFile(new URL("index-page.js", root), "utf8"),
    readFile(new URL("register-page.js", root), "utf8")
  ]);

  assert.match(indexPage, /import\s*\{\s*listEvents\s*\}\s*from\s*["']\.\/api\.js(?:\?[^"']+)?["']/);
  assert.match(registerPage, /import\s*\{\s*createRegistration\s*,\s*getEvent\s*\}\s*from\s*["']\.\/api\.js(?:\?[^"']+)?["']/);
  assert.doesNotMatch(registerPage, /demoRegistrationAdapter|registrationApi/);
  assert.doesNotMatch(`${indexPage}\n${registerPage}`, /const\s+serverNow\s*=/);
});

test("the public browser client exposes no attendance mutation", () => {
  const client = createApiClient({ endpoint, fetchImpl: async () => jsonResponse({ ok: true, data: {} }) });
  assert.equal("checkIn" in client, false);
});
