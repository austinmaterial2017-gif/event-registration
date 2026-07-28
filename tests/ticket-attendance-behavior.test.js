import test from "node:test";
import assert from "node:assert/strict";
import {
  bindTicketActions, buildVerificationUrl, createTicketViewModel, renderTicketMarkup
} from "../public/js/ticket-page.js";
import { encodeQrMatrix } from "../public/js/qr.js";
import { createVerificationViewModel } from "../public/js/verify-page.js";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ticket = {
  ticketNumber: "EVT-ABC123",
  token: "opaque-token-123",
  eventTitle: "夜航创作节",
  status: "active",
  participant: { name: "陈**", phone: "13****88", email: "c***@example.com" },
  sessions: [
    {
      sessionId: "opening",
      title: "把城市写进身体",
      speaker: "林青",
      startsAt: "2026-08-16T10:00:00+08:00",
      endsAt: "2026-08-16T10:40:00+08:00",
      location: "黑箱剧场"
    },
    {
      sessionId: "making",
      title: "用限制创造",
      speaker: "阿南",
      startsAt: "2026-08-16T11:00:00+08:00",
      endsAt: "2026-08-16T12:20:00+08:00",
      location: "工作室 B"
    }
  ],
  seats: [
    { label: "A-01", sessionId: "opening" },
    { label: "B-08", sessionId: "making" }
  ]
};

test("ticket markup renders every registered session with speaker, time, location, and per-session check-in notice", () => {
  const markup = renderTicketMarkup(createTicketViewModel(ticket));

  for (const expected of ["把城市写进身体", "林青", "黑箱剧场", "用限制创造", "阿南", "工作室 B", "A-01", "B-08"]) {
    assert.match(markup, new RegExp(expected));
  }
  assert.match(markup, /每场讲座将分别签到/);
  assert.match(markup, /EVT-ABC123/);
});

test("ticket view model exposes only the masked participant display value", () => {
  const view = createTicketViewModel(ticket);
  assert.equal(view.participantName, "陈**");
  assert.equal(JSON.stringify(view).includes("13****88"), false);
  assert.equal(JSON.stringify(view).includes("c***@example.com"), false);
});

test("ticket status distinguishes active, cancelled, and ended states", () => {
  assert.deepEqual(createTicketViewModel(ticket).status, { code: "active", label: "有效凭证" });
  assert.deepEqual(createTicketViewModel({ ...ticket, status: "cancelled" }).status, { code: "cancelled", label: "凭证已取消" });
  assert.deepEqual(createTicketViewModel({ ...ticket, status: "ended" }).status, { code: "ended", label: "活动已结束" });
});

test("ticket renders masked configured fields and only server-authorized owner actions", () => {
  const actionable = {
    ...ticket,
    displayFields: [{ id: "badge", label: "Badge code", value: "SE****91" }],
    capabilities: { canCancel: true, canExchangeSeat: true },
    exchangeOptions: [{
      seatId: "A-02",
      label: "A-02",
      zone: "front",
      sessionId: "opening",
      replacesSeatId: "A-01"
    }]
  };
  const view = createTicketViewModel(actionable);
  const markup = renderTicketMarkup(view);
  assert.deepEqual(view.displayFields, [{ id: "badge", label: "Badge code", value: "SE****91" }]);
  assert.match(markup, /Badge code/);
  assert.match(markup, /SE\*\*\*\*91/);
  assert.match(markup, /data-ticket-action="cancel"/);
  assert.match(markup, /data-ticket-action="exchange"/);
  assert.match(markup, /A-02/);
  assert.equal(markup.includes("SECRET-7391"), false);
});

test("ticket renders verified session management with selected, disabled, and seat controls", () => {
  const manageable = {
    ...ticket,
    capabilities: { canManageSessions: true },
    sessionManagement: {
      closesAt: "2026-08-15T20:00:00+08:00",
      seatMode: "self",
      minChoices: 1,
      maxChoices: 2,
      sessions: [
        {
          sessionId: "opening",
          title: "Opening",
          selected: true,
          required: true,
          disabledReason: "必选场次",
          seats: [{ seatId: "A-01", label: "A-01", zone: "front", selected: true, available: false }]
        },
        {
          sessionId: "making",
          title: "Making",
          selected: false,
          required: false,
          disabledReason: "",
          seats: [{ seatId: "B-08", label: "B-08", zone: "front", selected: false, available: true }]
        }
      ]
    }
  };

  const view = createTicketViewModel(manageable);
  const markup = renderTicketMarkup(view);
  assert.equal(view.capabilities.canManageSessions, true);
  assert.match(markup, /data-ticket-session-management/);
  assert.match(markup, /data-session-id="opening"[^>]*checked[^>]*disabled/);
  assert.match(markup, /data-session-id="making"/);
  assert.match(markup, /data-session-seat="making"/);
  assert.match(markup, /data-ticket-action="update-sessions"/);
  assert.match(markup, /必选场次/);
});

test("session update visibly enters one pending request and rerenders the confirmed ticket", async () => {
  let resolveUpdate;
  const calls = [];
  const listeners = {};
  const updateButton = {
    disabled: false,
    addEventListener: (type, handler) => { listeners[type] = handler; }
  };
  const checkboxes = [
    { checked: true, dataset: { sessionId: "s1" } },
    { checked: true, dataset: { sessionId: "s2" } }
  ];
  const resultHolder = {
    querySelector: (selector) => {
      if (selector === '[data-ticket-action="update-sessions"]') return updateButton;
      if (selector === '[data-session-seat="s1"]') return { value: "" };
      if (selector === '[data-session-seat="s2"]') return { value: "" };
      return null;
    },
    querySelectorAll: (selector) => selector === "[data-session-id]" ? checkboxes : []
  };
  const message = { textContent: "" };
  const rerenders = [];
  bindTicketActions(
    resultHolder,
    { ticketNumber: "T-01", sessionManagement: { sessions: [] } },
    "alice@example.com",
    message,
    (nextTicket, verification) => rerenders.push([nextTicket, verification]),
    {
      updateRegistrationSessions: (payload) => {
        calls.push(payload);
        return new Promise((resolve) => { resolveUpdate = resolve; });
      }
    }
  );

  const first = listeners.click();
  const second = listeners.click();
  assert.equal(calls.length, 1);
  assert.equal(updateButton.disabled, true);
  assert.match(message.textContent, /正在/);
  resolveUpdate({
    ok: true,
    data: { ticketNumber: "T-01", sessions: [{ sessionId: "s1" }, { sessionId: "s2" }] }
  });
  await Promise.all([first, second]);
  assert.match(message.textContent, /已更新/);
  assert.equal(rerenders.length, 1);
  assert.equal(rerenders[0][1], "alice@example.com");
});

test("QR payload is an absolute physical-camera URL containing only the opaque token", () => {
  const payload = buildVerificationUrl(ticket.token, "https://events.example.org/summer/");
  assert.equal(payload, "https://events.example.org/summer/verify.html?token=opaque-token-123");
  assert.equal(new URL(payload).protocol, "https:");
  assert.equal(payload.includes(ticket.ticketNumber), false);
  assert.equal(payload.includes(ticket.participant.name), false);

  const matrix = encodeQrMatrix(payload);
  assert.ok(Array.isArray(matrix));
  assert.ok(matrix.length >= 21);
  assert.ok(matrix.every((row) => row.length === matrix.length && row.every((cell) => typeof cell === "boolean")));
  assert.deepEqual(matrix, encodeQrMatrix(payload));
});

test("verification view offers separate sessions and never treats scanning as check-in", () => {
  const view = createVerificationViewModel({
    participantName: "陈**",
    event: { title: "夜航创作节", location: "主厅" },
    sessions: ticket.sessions,
    seats: ticket.seats,
    status: "active"
  });
  assert.equal(view.sessions.length, 2);
  assert.deepEqual(view.sessions.map((session) => session.sessionId), ["opening", "making"]);
  assert.equal(view.checkedIn, false);
});

test("public verification stays read-only, ticket mutations require owner verification, and staff check-in stays protected", async () => {
  const [ticketHtml, verifyHtml, verifyPage, staffHtml] = await Promise.all([
    readFile(new URL("../public/ticket.html", import.meta.url), "utf8"),
    readFile(new URL("../public/verify.html", import.meta.url), "utf8"),
    readFile(new URL("../public/js/verify-page.js", import.meta.url), "utf8"),
    readFile(new URL("../staff-apps-script/StaffCheckIn.html", import.meta.url), "utf8")
  ]);
  assert.match(ticketHtml, /ticket-lookup-form/);
  assert.match(ticketHtml, /ticketNumber/);
  assert.match(ticketHtml, /verificationValue/);
  assert.match(ticketHtml, /print-ticket/);
  const ticketPage = await readFile(new URL("../public/js/ticket-page.js", import.meta.url), "utf8");
  assert.match(ticketPage, /cancelRegistration/);
  assert.match(ticketPage, /exchangeSeat/);
  assert.doesNotMatch(ticketPage, /\bcheckIn\b|google\.script\.run/);
  assert.doesNotMatch(verifyHtml, /staff-check-in-form|confirmCheckIn|staffIdentity/);
  assert.doesNotMatch(verifyPage, /\bcheckIn\b|google\.script\.run/);
  assert.match(staffHtml, /google\.script\.run/);
  assert.match(staffHtml, /confirmCheckIn/);
  assert.match(staffHtml, /sessionId/);
  assert.doesNotMatch(staffHtml, /staffIdentity/);
});

test("staff check-in accepts a raw token or scanned verification URL and auto-loads a token query", async () => {
  const staffHtml = await readFile(
    new URL("../staff-apps-script/StaffCheckIn.html", import.meta.url),
    "utf8"
  );
  const script = [...staffHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
  assert.ok(script, "staff script missing");
  const calls = [];
  const listeners = {};
  const lookupButton = { disabled: false, textContent: "读取凭证" };
  const checkInButton = { disabled: false, textContent: "确认本场签到" };
  const lookupForm = {
    elements: { token: { value: "" } },
    querySelector: (selector) => selector === 'button[type="submit"]' ? lookupButton : null,
    addEventListener: (type, handler) => { listeners[`lookup:${type}`] = handler; }
  };
  const checkInForm = {
    hidden: true,
    elements: {
      sessionId: { value: "", length: 1, append() {} },
      confirmCheckIn: { checked: false }
    },
    querySelector: (selector) => selector === 'button[type="submit"]' ? checkInButton : null,
    addEventListener: (type, handler) => { listeners[`checkin:${type}`] = handler; }
  };
  const nodes = {
    "#lookup-form": lookupForm,
    "#check-in-form": checkInForm,
    "#message": { textContent: "" },
    "#ticket-summary": { textContent: "" }
  };
  const runner = {
    withSuccessHandler() { return this; },
    withFailureHandler() { return this; },
    getStaffTicketForCheckIn(payload) { calls.push(payload); return this; },
    checkIn() { return this; }
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    document: {
      querySelector: (selector) => nodes[selector],
      createElement: () => ({ value: "", textContent: "" })
    },
    window: {
      location: {
        href: "https://script.google.com/macros/s/staff/exec?token=query-token-123",
        search: "?token=query-token-123"
      }
    },
    google: { script: { run: runner } }
  });
  vm.runInContext(script, context, { filename: "StaffCheckIn.inline.js" });

  assert.equal(
    context.parseScannedTicketToken(
      "https://events.example.org/summer/verify.html?token=scanned-token-456"
    ),
    "scanned-token-456"
  );
  assert.equal(context.parseScannedTicketToken("raw-token-789"), "raw-token-789");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ token: "query-token-123" }]);
  assert.equal(lookupForm.elements.token.value, "query-token-123");
  assert.equal(lookupButton.disabled, true);
  listeners["lookup:submit"]({ preventDefault() {} });
  listeners["lookup:submit"]({ preventDefault() {} });
  assert.equal(calls.length, 1);
});
