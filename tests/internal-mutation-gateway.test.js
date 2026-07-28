import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

const secret = "shared-internal-mutation-secret-32-bytes";
const publicRoot = new URL("../apps-script/", import.meta.url);
const staffRoot = new URL("../staff-apps-script/", import.meta.url);

function utilities() {
  let uuid = 0;
  return {
    getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
    computeHmacSha256Signature: (value, key) =>
      Array.from(createHmac("sha256", key).update(value).digest()),
    base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString("base64url")
  };
}

test("gateway releases its script lock before a mutation takes the same public lock", async () => {
  const [clientSource, gatewaySource] = await Promise.all([
    readFile(new URL("InternalClient.gs", staffRoot), "utf8"),
    readFile(new URL("InternalGateway.gs", publicRoot), "utf8")
  ]);
  const properties = { INTERNAL_API_SHARED_SECRET: secret };
  const scriptProperties = {
    getProperty: (key) => properties[key] ?? null,
    setProperty: (key, value) => { properties[key] = value; },
    deleteProperty: (key) => { delete properties[key]; },
    getProperties: () => ({ ...properties })
  };
  const lockEvents = [];
  let lockDepth = 0;
  let now = 1_800_000_000_000;
  class ServerDate extends Date {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  const common = {
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    Utilities: utilities(),
    PropertiesService: { getScriptProperties: () => scriptProperties }
  };
  const staff = vm.createContext({ ...common });
  vm.runInContext(clientSource, staff, { filename: "InternalClient.gs" });

  let executions = 0;
  const publicContext = vm.createContext({
    ...common,
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockDepth, 0, "internal mutation must not nest the public lock");
          lockDepth += 1;
          lockEvents.push("acquire");
        },
        releaseLock: () => {
          lockDepth -= 1;
          lockEvents.push("release");
        }
      })
    },
    executeInternalActionLocked_: (action, payload, actor) => {
      assert.equal(
        lockDepth,
        0,
        "gateway must release the public script lock before the mutation acquires it"
      );
      executions += 1;
      return { ok: true, data: { action, payload, actor, execution: executions } };
    }
  });
  vm.runInContext(gatewaySource, publicContext, { filename: "InternalGateway.gs" });

  const first = staff.createInternalRequestEnvelope_(
    "admin.saveEvent",
    { eventId: "event-1", status: "closed" },
    "admin@example.com",
    "event-save-1",
    now
  );
  const accepted = publicContext.handleInternalRequest_(first);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.execution, 1);

  const retryWithFreshNonce = staff.createInternalRequestEnvelope_(
    "admin.saveEvent",
    { eventId: "event-1", status: "closed" },
    "admin@example.com",
    "event-save-1",
    now + 1
  );
  const retried = publicContext.handleInternalRequest_(retryWithFreshNonce);
  assert.deepEqual(
    JSON.parse(JSON.stringify(retried)),
    JSON.parse(JSON.stringify(accepted))
  );
  assert.equal(executions, 1, "idempotent retry executed the mutation twice");

  const tampered = JSON.parse(JSON.stringify(staff.createInternalRequestEnvelope_(
    "admin.saveEvent",
    { eventId: "event-1", status: "closed" },
    "admin@example.com",
    "event-save-2",
    now + 2
  )));
  tampered.payload.status = "archived";
  assert.equal(publicContext.handleInternalRequest_(tampered).code, "INTERNAL_REQUEST_DENIED");
  assert.equal(executions, 1);

  const replay = staff.createInternalRequestEnvelope_(
    "admin.saveEvent",
    { eventId: "event-1", status: "open" },
    "admin@example.com",
    "event-save-3",
    now + 3
  );
  assert.equal(publicContext.handleInternalRequest_(replay).ok, true);
  replay.idempotencyKey = "event-save-4";
  replay.signature = staff.signInternalRequest_(replay);
  assert.equal(publicContext.handleInternalRequest_(replay).code, "INTERNAL_REQUEST_DENIED");

  const expired = staff.createInternalRequestEnvelope_(
    "admin.saveEvent",
    { eventId: "event-1", status: "open" },
    "admin@example.com",
    "event-save-5",
    now - 300_000
  );
  assert.equal(publicContext.handleInternalRequest_(expired).code, "INTERNAL_REQUEST_DENIED");
  assert.deepEqual(lockEvents, [
    "acquire", "release",
    "acquire", "release",
    "acquire", "release",
    "acquire", "release",
    "acquire", "release",
    "acquire", "release"
  ]);
});

test("large draft retries fit within the Apps Script property value limit", async () => {
  const [clientSource, gatewaySource] = await Promise.all([
    readFile(new URL("InternalClient.gs", staffRoot), "utf8"),
    readFile(new URL("InternalGateway.gs", publicRoot), "utf8")
  ]);
  const properties = { INTERNAL_API_SHARED_SECRET: secret };
  const scriptProperties = {
    getProperty: (key) => properties[key] ?? null,
    setProperty: (key, value) => {
      if (String(value).length > 9_216) {
        throw new Error("Property value too large");
      }
      properties[key] = value;
    },
    deleteProperty: (key) => { delete properties[key]; },
    getProperties: () => ({ ...properties })
  };
  let now = 1_800_000_000_000;
  class ServerDate extends Date {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  const common = {
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    Utilities: utilities(),
    PropertiesService: { getScriptProperties: () => scriptProperties }
  };
  const staff = vm.createContext({ ...common });
  vm.runInContext(clientSource, staff, { filename: "InternalClient.gs" });

  let executions = 0;
  const publicContext = vm.createContext({
    ...common,
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    executeInternalActionLocked_: (_action, payload) => {
      executions += 1;
      return { ok: true, data: { draft: payload, execution: executions } };
    }
  });
  vm.runInContext(gatewaySource, publicContext, { filename: "InternalGateway.gs" });

  const payload = {
    event: { title: "Large draft", description: "x".repeat(7_000) },
    sessions: [],
    questions: []
  };
  const first = staff.createInternalRequestEnvelope_(
    "admin.saveDraft",
    payload,
    "admin@example.com",
    "large-draft-save-1",
    now
  );
  const accepted = publicContext.handleInternalRequest_(first);
  assert.equal(accepted.ok, true);

  const retry = staff.createInternalRequestEnvelope_(
    "admin.saveDraft",
    payload,
    "admin@example.com",
    "large-draft-save-1",
    now + 1
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(publicContext.handleInternalRequest_(retry))),
    JSON.parse(JSON.stringify(accepted))
  );
  assert.equal(executions, 1);
});

test("dashboard reads do not fill script properties with large cached responses", async () => {
  const [clientSource, gatewaySource] = await Promise.all([
    readFile(new URL("InternalClient.gs", staffRoot), "utf8"),
    readFile(new URL("InternalGateway.gs", publicRoot), "utf8")
  ]);
  let now = 1_800_000_000_000;
  const legacyKey = "INTERNAL_IDEMPOTENCY_legacy-dashboard";
  const properties = {
    INTERNAL_API_SHARED_SECRET: secret,
    [legacyKey]: JSON.stringify({
      fingerprint: "legacy",
      expiresAt: now + 86_400_000,
      result: {
        ok: true,
        data: {
          connection: { connected: true },
          drafts: [{ payload: "x".repeat(12_000) }],
          events: []
        }
      }
    })
  };
  const scriptProperties = {
    getProperty: (key) => properties[key] ?? null,
    setProperty: (key, value) => {
      const next = { ...properties, [key]: String(value) };
      const total = Object.values(next).reduce((sum, entry) => sum + entry.length, 0);
      if (total > 18_000) throw new Error("Script property storage full");
      properties[key] = String(value);
    },
    deleteProperty: (key) => { delete properties[key]; },
    getProperties: () => ({ ...properties })
  };
  class ServerDate extends Date {
    constructor(value) { super(value === undefined ? now : value); }
    static now() { return now; }
  }
  const common = {
    JSON, Object, Array, String, Number, RegExp, Error, Math, isFinite,
    Date: ServerDate,
    Utilities: utilities(),
    PropertiesService: { getScriptProperties: () => scriptProperties }
  };
  const staff = vm.createContext({ ...common });
  vm.runInContext(clientSource, staff, { filename: "InternalClient.gs" });

  let executions = 0;
  const publicContext = vm.createContext({
    ...common,
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    executeInternalActionLocked_: () => {
      executions += 1;
      return {
        ok: true,
        data: {
          connection: { connected: true },
          drafts: [{ payload: "y".repeat(12_000) }],
          events: []
        }
      };
    }
  });
  vm.runInContext(gatewaySource, publicContext, { filename: "InternalGateway.gs" });

  const first = staff.createInternalRequestEnvelope_(
    "admin.getDashboard",
    {},
    "admin@example.com",
    "dashboard-read-1",
    now
  );
  const accepted = publicContext.handleInternalRequest_(first);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.drafts[0].payload.length, 12_000);
  assert.equal(properties[legacyKey], undefined);
  assert.equal(
    Object.keys(properties).some((key) => key === "INTERNAL_IDEMPOTENCY_dashboard-read-1"),
    false
  );

  const retry = staff.createInternalRequestEnvelope_(
    "admin.getDashboard",
    {},
    "admin@example.com",
    "dashboard-read-1",
    now + 1
  );
  assert.equal(publicContext.handleInternalRequest_(retry).ok, true);
  assert.equal(executions, 2, "read-only dashboard retries should execute a fresh read");
});
