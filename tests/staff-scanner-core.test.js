import test from "node:test";
import assert from "node:assert/strict";
import { createScanController, extractTicketToken } from "../public/js/staff-scanner-core.js";

const token = "a".repeat(64);

test("extractTicketToken accepts an opaque ticket URL and rejects unrelated text", () => {
  assert.equal(extractTicketToken(`https://events.example/v.html?t=${token}`), token);
  assert.equal(extractTicketToken(token), token);
  assert.equal(extractTicketToken("not a ticket"), "");
});

test("scan controller ignores repeated camera frames while its request is pending", async () => {
  let resolveCheckIn;
  const completed = new Promise((resolve) => { resolveCheckIn = resolve; });
  const outcomes = [];
  const controller = createScanController({
    checkIn: () => completed,
    showOutcome: (outcome) => outcomes.push(outcome),
    resumeDelayMs: 0
  });

  assert.equal(controller.acceptScan(token), "pending");
  assert.equal(controller.acceptScan(token), "ignored");
  resolveCheckIn({ ok: true, data: { participantName: "Test" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(outcomes[0].ok, true);
  assert.equal(controller.acceptScan(token), "pending");
});
