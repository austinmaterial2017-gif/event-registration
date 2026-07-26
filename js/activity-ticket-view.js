export function buildActivityTicketView(activity, canRegister, statusLabel) {
  return {
    dateLabel: String(activity?.date || ""),
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
