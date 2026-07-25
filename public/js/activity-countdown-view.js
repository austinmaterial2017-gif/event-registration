import { getActivityCountdown } from "./event-list-flow.js";

function countdownText(countdown) {
  if (!countdown || countdown.remainingMs <= 0) return "报名已截止。";
  const hours = Math.floor(countdown.remainingMs / 3_600_000);
  const minutes = Math.floor((countdown.remainingMs % 3_600_000) / 60_000);
  return countdown.kind === "opens" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。`;
}

export function refreshActivityCountdowns(entries, serverTimestamp) {
  let nextRefresh = null;
  for (const entry of entries || []) {
    const countdown = getActivityCountdown(entry.activity, serverTimestamp);
    if (entry.countdownNode) entry.countdownNode.textContent = countdownText(countdown);
    if (countdown?.remainingMs > 0) {
      const delay = countdown.remainingMs + 1;
      nextRefresh = nextRefresh === null ? delay : Math.min(nextRefresh, delay);
    }
  }
  return nextRefresh;
}
