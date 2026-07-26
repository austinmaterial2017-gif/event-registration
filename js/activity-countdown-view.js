import { getActivityCountdown } from "./event-list-flow.js";

function countdownText(countdown) {
  if (!countdown || countdown.remainingMs <= 0) return "报名已截止。";
  const hours = Math.floor(countdown.remainingMs / 3_600_000);
  const minutes = Math.floor((countdown.remainingMs % 3_600_000) / 60_000);
  return countdown.kind === "opens" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。`;
}

function isAwaitingOpeningStatus(activity, serverTimestamp) {
  const now = Number(serverTimestamp);
  const opensAt = Date.parse(activity?.opensAt);
  const closesAt = Date.parse(activity?.closesAt);
  return activity?.status === "upcoming"
    && Number.isFinite(now)
    && Number.isFinite(opensAt)
    && now >= opensAt
    && (!Number.isFinite(closesAt) || now < closesAt);
}

export function refreshActivityCountdowns(entries, serverTimestamp) {
  let nextRefresh = null;
  for (const entry of entries || []) {
    const countdown = getActivityCountdown(entry.activity, serverTimestamp);
    if (entry.countdownNode) {
      const awaitingOpeningStatus = isAwaitingOpeningStatus(entry.activity, serverTimestamp);
      entry.countdownNode.textContent = awaitingOpeningStatus ? "" : countdownText(countdown);
      entry.countdownNode.hidden = awaitingOpeningStatus;
    }
    if (countdown?.remainingMs > 0) {
      const delay = countdown.remainingMs + 1;
      nextRefresh = nextRefresh === null ? delay : Math.min(nextRefresh, delay);
    }
  }
  return nextRefresh;
}
