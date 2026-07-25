import test from "node:test";
import assert from "node:assert/strict";
import { refreshActivityCountdowns } from "../public/js/activity-countdown-view.js";

test("countdown refresh updates only dedicated text nodes and preserves card actions", () => {
  const countdownNode = { textContent: "" };
  const registrationLink = { href: "register.html?event=open" };
  const entry = {
    activity: { status: "open", opensAt: "2026-07-26T09:00:00+08:00", closesAt: "2026-07-26T10:05:00+08:00" },
    countdownNode,
    actionNode: registrationLink
  };
  const originalAction = entry.actionNode;
  const nextRefresh = refreshActivityCountdowns([entry], Date.parse("2026-07-26T10:00:00+08:00"));

  assert.equal(entry.actionNode, originalAction);
  assert.equal(countdownNode.textContent, "报名将在 0 小时 5 分钟后截止（以服务器时间为准）。");
  assert.equal(nextRefresh, 300_001);
});

test("upcoming countdown hides at the exact opening boundary without claiming registration closed", () => {
  const countdownNode = { textContent: "报名将在 0 小时 0 分钟后开放（以服务器时间为准）。", hidden: false };
  const opensAt = "2026-07-26T10:05:00+08:00";
  const entry = {
    activity: { status: "upcoming", opensAt, closesAt: "2026-07-26T12:00:00+08:00" },
    countdownNode
  };

  const nextRefresh = refreshActivityCountdowns([entry], Date.parse(opensAt));

  assert.equal(countdownNode.textContent, "");
  assert.equal(countdownNode.hidden, true);
  assert.equal(nextRefresh, null);
});
