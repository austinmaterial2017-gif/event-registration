import { getActivityCountdown, getVisibleActivities } from "./event-list-flow.js";

const serverNow = "2026-07-26T10:00:00+08:00";
const activities = [
  { id: "night-of-ideas", title: "夜航：创作、城市与不眠", status: "open", date: "2026 年 8 月 16 日", place: "吉隆坡 · 黑箱剧场", description: "一整天的短讲、工作坊与对谈，给正在做点什么的人。", opensAt: "2026-07-20T10:00:00+08:00", closesAt: "2026-08-15T20:00:00+08:00" },
  { id: "paper-garden", title: "纸上花园：手工书体验", status: "upcoming", date: "2026 年 9 月 6 日", place: "河畔工作室", description: "从一张纸开始，做一本可以带走的小书。", opensAt: "2026-08-05T10:00:00+08:00", closesAt: "2026-09-04T20:00:00+08:00" },
  { id: "sound-walk", title: "城市声景漫游", status: "closed", date: "2026 年 7 月 30 日", place: "旧火车站集合", description: "戴上耳机，重新听见熟悉的街道。", opensAt: "2026-06-30T10:00:00+08:00", closesAt: "2026-07-25T20:00:00+08:00" },
  { id: "after-glow", title: "余晖放映会", status: "live", date: "2026 年 7 月 26 日", place: "星幕影院", description: "正在入场，请向现场工作人员出示报名凭证。" },
  { id: "slow-drawing", title: "慢速素描日", status: "ended", date: "2026 年 6 月 12 日", place: "白屋美术馆", description: "谢谢每一位曾经在这里安静画画的人。" },
  { id: "cancelled-event", title: "雨季露天诗会", status: "cancelled", date: "活动取消", place: "—", description: "因天气原因取消，已报名的朋友将收到后续通知。" },
  { id: "draft-event", title: "内部草稿", status: "draft", date: "", place: "", description: "" },
  { id: "archive-event", title: "已归档活动", status: "archived", date: "", place: "", description: "" }
];

const statusNames = { upcoming: "即将开放", open: "报名开放", closed: "报名截止", live: "正在进行", ended: "活动结束", cancelled: "活动取消" };
const serverOffset = Date.parse(serverNow) - Date.now();

function serverTimestamp() { return Date.now() + serverOffset; }

function countdownText(countdown) {
  if (!countdown || countdown.remainingMs <= 0) return "报名已截止。";
  const hours = Math.floor(countdown.remainingMs / 3_600_000);
  const minutes = Math.floor((countdown.remainingMs % 3_600_000) / 60_000);
  return countdown.kind === "opens" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。`;
}

function renderActivities() {
  const list = document.querySelector("#activity-list");
  const accessibleStatus = document.querySelector("#activity-status");
  const visibleActivities = getVisibleActivities(activities);
  const now = serverTimestamp();
  const activeCountdowns = [];
  list.replaceChildren(...visibleActivities.map((activity) => {
    const article = document.createElement("article");
    article.className = "activity-card";
    const copy = document.createElement("div");
    const top = document.createElement("div"); top.className = "card-top";
    const date = document.createElement("p"); date.className = "eyebrow"; date.textContent = activity.date;
    const status = document.createElement("span"); status.className = `status ${activity.status}`; status.textContent = statusNames[activity.status] || "状态未知";
    const title = document.createElement("h3"); title.textContent = activity.title;
    const description = document.createElement("p"); description.textContent = activity.description;
    const countdown = getActivityCountdown(activity, now);
    if (countdown) { const clock = document.createElement("p"); clock.className = "registration-countdown"; clock.textContent = countdownText(countdown); copy.append(top, title, description, clock); if (countdown.remainingMs > 0) activeCountdowns.push(countdown); }
    else copy.append(top, title, description);
    const actions = document.createElement("div"); actions.className = "activity-actions";
    const meta = document.createElement("div"); meta.className = "meta-list";
    const place = document.createElement("span"); place.textContent = `⌖ ${activity.place}`; meta.append(place);
    const action = document.createElement(activity.canRegister ? "a" : "span"); action.className = activity.canRegister ? "primary-button" : "secondary-button";
    action.textContent = activity.canRegister ? "立即报名" : "暂不可报名";
    if (activity.canRegister) action.href = `register.html?event=${encodeURIComponent(activity.id)}`;
    else action.setAttribute("aria-label", `${statusNames[activity.status] || "当前状态"}，暂不可报名`);
    actions.append(meta, action); article.append(copy, actions);
    return article;
  }));
  list.setAttribute("aria-busy", "false");
  accessibleStatus.textContent = `已显示 ${visibleActivities.length} 个活动。`;
  if (activeCountdowns.length) {
    const nextUpdate = Math.min(...activeCountdowns.map((countdown) => countdown.remainingMs));
    window.setTimeout(renderActivities, Math.min(30_000, Math.max(250, nextUpdate + 1)));
  }
}

// API 接通后由服务端返回活动及 serverNow；展示层以固定服务器偏移持续计算倒计时。
renderActivities();
