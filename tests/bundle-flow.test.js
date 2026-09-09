import test from "node:test";
import assert from "node:assert/strict";
import { validateBundleSelection } from "../public/js/bundle-flow.js";

const rules = [
  { eventId: "science", fixedTicketCount: 2, capacity: 70, used: 10, status: "open" },
  { eventId: "parents", fixedTicketCount: 1, capacity: 0, used: 0, status: "open" },
  { eventId: "degree", fixedTicketCount: 3, capacity: 30, used: 30, status: "open" }
];

test("bundle selection totals administrator-defined tickets without participant quantities", () => {
  assert.deepEqual(validateBundleSelection({ rules, selectedEventIds: ["science", "parents"], totalTicketLimit: 6 }), {
    ok: true, totalTickets: 3, error: "", selectedEventIds: ["science", "parents"]
  });
});

test("bundle selection rejects an over-limit or full activity", () => {
  const availableDegree = rules.map((rule) => rule.eventId === "degree" ? { ...rule, used: 1 } : rule);
  assert.equal(validateBundleSelection({ rules: availableDegree, selectedEventIds: ["science", "parents", "degree"], totalTicketLimit: 5 }).error, "所选活动合计超过总票数上限。");
  assert.equal(validateBundleSelection({ rules, selectedEventIds: ["degree"], totalTicketLimit: 6 }).error, "所选活动名额已满。" );
});
