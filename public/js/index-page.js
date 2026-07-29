import { listEvents } from "./api.js?v=20260728-stable";
import { refreshActivityCountdowns } from "./activity-countdown-view.js";
import {
  buildActivityTicketView,
  buildEmptyActivityView,
} from "./activity-ticket-view.js?v=20260729-dates";
import { getActivityCountdown, getVisibleActivities } from "./event-list-flow.js";
import { getRegistrationAvailability } from "./registration-flow.js";

const statusNames = { upcoming: "即将开放", open: "报名开放", closed: "报名截止", live: "正在进行", ended: "活动结束", cancelled: "活动取消" };
const countdownEntries = [];
let serverOffset = Number.NaN;

function serverTimestamp() { return Date.now() + serverOffset; }

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function showPageNotice() {
  const notice = document.querySelector("#page-notice");
  if (!notice) return;
  if (new URLSearchParams(window.location.search).get("notice") !== "registration-expired") return;
  notice.textContent = "报名时间已结束，请重新进入。";
  notice.hidden = false;
}

function refreshCountdownText() {
  const nextRefresh = refreshActivityCountdowns(countdownEntries, serverTimestamp());
  if (nextRefresh !== null) window.setTimeout(refreshCountdownText, Math.min(30_000, Math.max(250, nextRefresh)));
}

function renderActivities(activities) {
  const list = document.querySelector("#activity-list");
  const accessibleStatus = document.querySelector("#activity-status");
  const visibleActivities = getVisibleActivities(activities).map((activity) => ({
    ...activity,
    canRegister: getRegistrationAvailability(activity, serverTimestamp()).canRegister
  }));
  countdownEntries.length = 0;

  if (visibleActivities.length === 0) {
    const empty = buildEmptyActivityView();
    const article = node("article", "empty-ticket");
    const mascot = node("img", "empty-ticket-mascot");
    mascot.src = empty.mascotPath;
    mascot.alt = "";
    const copy = node("div", "empty-ticket-copy");
    copy.append(
      node("p", "hero-kicker", empty.kicker),
      node("h3", "", empty.title),
      node("p", "", empty.description),
    );
    article.append(mascot, copy);
    list.replaceChildren(article);
    list.setAttribute("aria-busy", "false");
    accessibleStatus.textContent = "已显示 0 个活动。";
    return;
  }

  list.replaceChildren(...visibleActivities.map((activity) => {
    const statusLabel = statusNames[activity.status] || "状态未知";
    const view = buildActivityTicketView(activity, activity.canRegister, statusLabel);
    const article = node("article", `activity-ticket ticket-${activity.status}`);
    const dateBlock = node("div", "ticket-date");
    dateBlock.append(node("span", "", "活动日期"), node("strong", "", view.dateLabel || "日期待定"));
    const copy = node("div", "ticket-copy");
    const status = node("span", `status ${activity.status}`, view.statusLabel);
    const title = node("h3", "", view.title);
    const description = node("p", "", view.description);
    const countdown = getActivityCountdown(activity, serverTimestamp());
    const clock = countdown ? node("p", "registration-countdown") : null;
    if (clock) clock.setAttribute("aria-live", "polite");
    copy.append(status, title, description);
    if (clock) copy.append(clock);
    const actions = node("div", "ticket-action");
    const meta = node("p", "ticket-place", view.placeLabel);
    const action = node(
      view.actionEnabled ? "a" : "span",
      view.actionEnabled ? "ticket-button" : "ticket-button disabled",
      view.actionLabel,
    );
    if (view.actionEnabled) action.href = view.actionHref;
    else action.setAttribute("aria-label", `${view.statusLabel || "当前状态"}，暂不可报名`);
    if (clock) countdownEntries.push({ activity, countdownNode: clock, actionNode: action });
    actions.append(meta, action);
    article.append(dateBlock, copy, actions);
    return article;
  }));
  list.setAttribute("aria-busy", "false");
  accessibleStatus.textContent = `已显示 ${visibleActivities.length} 个活动。`;
  refreshCountdownText();
}

async function initialise() {
  showPageNotice();
  const result = await listEvents();
  const list = document.querySelector("#activity-list");
  const status = document.querySelector("#activity-status");
  if (!result.ok || !Array.isArray(result.data?.events)) {
    list.replaceChildren(node("p", "notice", result.message || "暂时无法加载活动，请稍后重试。"));
    list.setAttribute("aria-busy", "false");
    status.textContent = "活动列表暂时无法加载。";
    return;
  }
  const timestamp = Date.parse(result.data.serverNow);
  serverOffset = Number.isFinite(timestamp) ? timestamp - Date.now() : Number.NaN;
  renderActivities(result.data.events);
}

initialise();
