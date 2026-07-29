const activityDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Kuala_Lumpur",
  year: "numeric",
  month: "long",
  day: "numeric",
});

function activityDateLabel(activity) {
  const start = Date.parse(activity?.eventStartsAt);
  const end = Date.parse(activity?.eventEndsAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    const startLabel = activityDateFormatter.format(new Date(start));
    const endLabel = activityDateFormatter.format(new Date(end));
    return startLabel === endLabel ? startLabel : `${startLabel}－${endLabel}`;
  }
  return String(activity?.date || "") || "日期待定";
}

export function buildActivityTicketView(activity, canRegister, statusLabel) {
  return {
    dateLabel: activityDateLabel(activity),
    title: String(activity?.title || ""),
    description: String(activity?.description || ""),
    placeLabel: `⌖ ${activity?.place || ""}`,
    statusLabel,
    actionLabel: canRegister ? "立即报名" : "暂不可报名",
    actionHref: canRegister
      ? `register.html?event=${encodeURIComponent(activity.id)}`
      : "",
    actionEnabled: canRegister,
  };
}

export function buildEmptyActivityView() {
  return {
    kicker: "稍后再来看看",
    title: "目前没有开放报名的活动",
    description: "新的讲座、课堂或工作坊开放后，会显示在这里。",
    mascotPath: "assets/owl-mascot.svg",
  };
}
