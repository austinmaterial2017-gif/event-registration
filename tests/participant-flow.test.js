import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../public/js/api.js";
import { getRegistrationAvailability, getSeatModeState, validateRegistrationDraft } from "../public/js/registration-flow.js";
import { createTicketViewModel, renderTicketMarkup } from "../public/js/ticket-page.js";

const serverNow = "2026-07-26T10:00:00+08:00";
const event = {
  id: "open-event", title: "多场次报名", status: "open", opensAt: "2026-07-26T09:00:00+08:00", closesAt: "2026-07-26T12:00:00+08:00",
  minChoices: 2, maxChoices: 2, seatMode: "self",
  sessions: [
    { id: "a", title: "场次 A", startsAt: "2026-08-01T09:00:00+08:00", endsAt: "2026-08-01T10:00:00+08:00", required: true },
    { id: "b", title: "场次 B", startsAt: "2026-08-01T10:00:00+08:00", endsAt: "2026-08-01T11:00:00+08:00", required: false }
  ],
  fields: [{ id: "name", label: "姓名", type: "text", required: true }, { id: "agree", label: "同意", type: "boolean", required: true }]
};

test("participant flow validates an open multi-session seat registration, confirms submission, and renders the returned ticket", async () => {
  const requests = [];
  const client = createApiClient({
    endpoint: "https://script.google.com/macros/s/public-deployment/exec",
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body); requests.push(request);
      if (request.action === "getEvent") return { ok: true, json: async () => ({ ok: true, data: { event, serverNow } }) };
      return { ok: true, json: async () => ({ ok: true, data: {
        registrationId: "registration-1", ticketNumber: "EVT-001", token: "opaque-ticket-token", eventTitle: event.title,
        status: "active", participant: { name: "陈**" },
        sessions: [{ sessionId: "a", title: "场次 A", speaker: "讲者 A", startsAt: event.sessions[0].startsAt, endsAt: event.sessions[0].endsAt, location: "大厅" }, { sessionId: "b", title: "场次 B", speaker: "讲者 B", startsAt: event.sessions[1].startsAt, endsAt: event.sessions[1].endsAt, location: "工作坊" }],
        seats: [{ label: "A-01", sessionId: "a" }, { label: "B-02", sessionId: "b" }]
      } }) };
    }
  });

  const loaded = await client.getEvent(event.id);
  assert.equal(loaded.ok, true);
  assert.deepEqual(getRegistrationAvailability(loaded.data.event, Date.parse(serverNow)).phase, "open");
  assert.deepEqual(getSeatModeState(loaded.data.event.seatMode).requiresSelection, true);

  const confirmedRequest = { eventId: event.id, sessionIds: ["a", "b"], seatChoices: ["A-01"], answers: { name: "陈明", agree: true } };
  assert.equal(validateRegistrationDraft(loaded.data.event, confirmedRequest.sessionIds, confirmedRequest.seatChoices[0], confirmedRequest.answers, Date.parse(serverNow)).valid, true);
  const created = await client.createRegistration(confirmedRequest);
  assert.equal(created.ok, true);
  assert.deepEqual(requests, [{ action: "getEvent", payload: { eventId: "open-event" } }, { action: "createRegistration", payload: confirmedRequest }]);

  const ticket = createTicketViewModel(created.data);
  const markup = renderTicketMarkup(ticket);
  assert.equal(ticket.sessions.length, 2);
  assert.match(markup, /EVT-001/);
  assert.match(markup, /场次 A/);
  assert.match(markup, /场次 B/);
  assert.match(markup, /A-01/);
  assert.match(markup, /B-02/);
});
