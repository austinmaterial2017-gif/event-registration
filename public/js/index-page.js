import { getEventCapability } from "./domain.js";

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

function renderActivities() {
  const list = document.querySelector("#activity-list");
  const accessibleStatus = document.querySelector("#activity-status");
  const visibleActivities = activities.filter((activity) => getEventCapability(activity.status).visible);
  list.replaceChildren(...visibleActivities.map((activity) => {
    const capability = getEventCapability(activity.status);
    const article = document.createElement("article");
    article.className = "activity-card";
    article.innerHTML = `<div><div class="card-top"><p class="eyebrow">${activity.date}</p><span class="status ${activity.status}">${statusNames[activity.status]}</span></div><h3>${activity.title}</h3><p>${activity.description}</p></div><div class="activity-actions"><div class="meta-list"><span>⌖ ${activity.place}</span></div>${capability.canRegister ? `<a class="primary-button" href="register.html?event=${encodeURIComponent(activity.id)}">立即报名</a>` : `<span class="secondary-button" aria-label="${statusNames[activity.status]}，暂不可报名">暂不可报名</span>`}</div>`;
    return article;
  }));
  list.setAttribute("aria-busy", "false");
  accessibleStatus.textContent = `已显示 ${visibleActivities.length} 个活动。`;
}

// API 接通后由服务端返回活动及 serverNow；展示层不会自行重置倒计时。
void serverNow;
renderActivities();
