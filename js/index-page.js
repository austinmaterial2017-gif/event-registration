import { listEvents } from "./api.js";
import { refreshActivityCountdowns } from "./activity-countdown-view.js";
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
  list.replaceChildren(...visibleActivities.map((activity) => {
    const article = node("article", "activity-card");
    const copy = node("div");
    const top = node("div", "card-top");
    const date = node("p", "eyebrow", activity.date);
    const status = node("span", `status ${activity.status}`, statusNames[activity.status] || "状态未知");
    const title = node("h3", "", activity.title);
    const description = node("p", "", activity.description);
    top.append(date, status);
    const countdown = getActivityCountdown(activity, serverTimestamp());
    const clock = countdown ? node("p", "registration-countdown") : null;
    if (clock) clock.setAttribute("aria-live", "polite");
    copy.append(top, title, description);
    if (clock) copy.append(clock);
    const actions = node("div", "activity-actions");
    const meta = node("div", "meta-list"); meta.append(node("span", "", `⌖ ${activity.place || ""}`));
    const action = node(activity.canRegister ? "a" : "span", activity.canRegister ? "primary-button" : "secondary-button", activity.canRegister ? "立即报名" : "暂不可报名");
    if (activity.canRegister) action.href = `register.html?event=${encodeURIComponent(activity.id)}`;
    else action.setAttribute("aria-label", `${statusNames[activity.status] || "当前状态"}，暂不可报名`);
    if (clock) countdownEntries.push({ activity, countdownNode: clock, actionNode: action });
    actions.append(meta, action); article.append(copy, actions);
    return article;
  }));
  list.setAttribute("aria-busy", "false");
  accessibleStatus.textContent = `已显示 ${visibleActivities.length} 个活动。`;
  refreshCountdownText();
}

async function initialise() {
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
