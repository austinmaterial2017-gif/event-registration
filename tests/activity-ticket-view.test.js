import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityTicketView,
  buildEmptyActivityView,
} from "../public/js/activity-ticket-view.js";

test("ticket view preserves event facts and the safe registration destination", () => {
  const view = buildActivityTicketView({
    id: "talk / 01",
    date: "2026-07-28 10:00",
    title: "未来教育对谈",
    description: "主讲：林老师",
    place: "A礼堂",
    status: "open",
  }, true, "报名开放");

  assert.deepEqual(view, {
    dateLabel: "2026-07-28 10:00",
    title: "未来教育对谈",
    description: "主讲：林老师",
    placeLabel: "⌖ A礼堂",
    statusLabel: "报名开放",
    actionLabel: "立即报名",
    actionHref: "register.html?event=talk%20%2F%2001",
    actionEnabled: true,
  });
});

test("activity date uses one localized date for same-day sessions", () => {
  const view = buildActivityTicketView({
    eventStartsAt: "2026-08-16T02:00:00.000Z",
    eventEndsAt: "2026-08-16T04:00:00.000Z",
  }, false, "即将开放");

  assert.equal(view.dateLabel, "2026年8月16日");
});

test("activity date uses the earliest and latest localized dates for a multi-day event", () => {
  const view = buildActivityTicketView({
    eventStartsAt: "2026-08-16T02:00:00.000Z",
    eventEndsAt: "2026-08-18T04:00:00.000Z",
  }, false, "即将开放");

  assert.equal(view.dateLabel, "2026年8月16日－2026年8月18日");
});

test("activity date remains pending when no valid session summary exists", () => {
  const view = buildActivityTicketView({
    eventStartsAt: "",
    eventEndsAt: "",
  }, false, "即将开放");

  assert.equal(view.dateLabel, "日期待定");
});

test("empty activity view directs participants without inventing events", () => {
  assert.deepEqual(buildEmptyActivityView(), {
    kicker: "稍后再来看看",
    title: "目前没有开放报名的活动",
    description: "新的讲座、课堂或工作坊开放后，会显示在这里。",
    mascotPath: "assets/owl-mascot.svg",
  });
});
