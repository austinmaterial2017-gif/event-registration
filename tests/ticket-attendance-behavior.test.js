import test from "node:test";
import assert from "node:assert/strict";
import { buildVerificationUrl, createTicketViewModel, renderTicketMarkup } from "../public/js/ticket-page.js";
import { encodeQrMatrix } from "../public/js/qr.js";
import { createVerificationViewModel } from "../public/js/verify-page.js";
import { readFile } from "node:fs/promises";

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

test("QR payload is a local verification URL containing only the opaque token", () => {
  const payload = buildVerificationUrl(ticket.token);
  assert.equal(payload, "verify.html?token=opaque-token-123");
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

test("public ticket and verification pages are read-only while staff mutation stays in Apps Script HTML", async () => {
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
  assert.doesNotMatch(verifyHtml, /staff-check-in-form|confirmCheckIn|staffIdentity/);
  assert.doesNotMatch(verifyPage, /\bcheckIn\b|google\.script\.run/);
  assert.match(staffHtml, /google\.script\.run/);
  assert.match(staffHtml, /confirmCheckIn/);
  assert.match(staffHtml, /sessionId/);
  assert.doesNotMatch(staffHtml, /staffIdentity/);
});
