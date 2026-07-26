import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../public/js/api.js";
import { createFinalSubmitHandler } from "../public/js/register-page.js";
import { TICKET_RESULT_STORAGE_KEY, transitionToTicket } from "../public/js/registration-success.js";
import { consumeInitialTicketResult, createTicketViewModel, renderTicketMarkup } from "../public/js/ticket-page.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("the actual final-submit controller stores a successful ticket projection and transitions to ticket.html", async () => {
  const ticket = {
    registrationId: "registration-1", ticketNumber: "EVT-001", token: "opaque-ticket-token", eventTitle: "报名完成", status: "active",
    participant: { name: "陈**" }, sessions: [{ sessionId: "a", title: "场次 A", startsAt: "2026-08-01T09:00:00+08:00", endsAt: "2026-08-01T10:00:00+08:00" }], seats: [{ label: "A-01", sessionId: "a" }]
  };
  const client = createApiClient({
    endpoint: "https://script.google.com/macros/s/public-deployment/exec",
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, data: ticket }) })
  });
  const storage = memoryStorage();
  const navigations = [];
  const errors = [];
  const request = { eventId: "open-event", sessionIds: ["a"], seatChoices: ["A-01"], answers: { name: "陈明" } };
  const handler = createFinalSubmitHandler({
    getReview: () => request,
    validateReview: () => ({ valid: true, errors: [] }),
    submitRegistration: client.createRegistration,
    showErrors: (messages) => errors.push(messages),
    editReview: () => assert.fail("valid final submit must not return to editing"),
    setSubmitting: () => {},
    transition: (result) => transitionToTicket(result, { storage, navigate: (target) => navigations.push(target) })
  });

  await handler();
  assert.deepEqual(errors, [[]]);
  assert.equal(navigations[0], "ticket.html");
  assert.ok(storage.getItem(TICKET_RESULT_STORAGE_KEY));
  const stored = consumeInitialTicketResult(storage);
  assert.equal(storage.getItem(TICKET_RESULT_STORAGE_KEY), null);
  assert.match(renderTicketMarkup(createTicketViewModel(stored)), /EVT-001/);
});
