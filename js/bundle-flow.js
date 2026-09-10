export function validateBundleSelection({ rules, selectedEventIds, totalTicketLimit }) {
  const selected = Array.isArray(selectedEventIds) ? [...new Set(selectedEventIds.map(String))] : [];
  const byId = new Map((Array.isArray(rules) ? rules : []).map((rule) => [String(rule?.itemId || rule?.eventId || ""), rule]));
  let totalTickets = 0;
  for (const eventId of selected) {
    const rule = byId.get(eventId);
    if (!rule || String(rule.status || "").toLowerCase() !== "open") {
      return { ok: false, totalTickets, error: "这个活动目前不能选择。", selectedEventIds: selected };
    }
    const capacity = Number(rule.capacity || 0);
    if (capacity > 0 && Number(rule.used || 0) >= capacity) {
      return { ok: false, totalTickets, error: "所选活动名额已满。", selectedEventIds: selected };
    }
    const fixedTickets = Number(rule.fixedTicketCount);
    if (!Number.isInteger(fixedTickets) || fixedTickets < 1) {
      return { ok: false, totalTickets, error: "活动票数设置无效，请联系管理员。", selectedEventIds: selected };
    }
    totalTickets += fixedTickets;
  }
  if (!Number.isInteger(Number(totalTicketLimit)) || Number(totalTicketLimit) < 1) {
    return { ok: false, totalTickets, error: "组合总票数设置无效，请联系管理员。", selectedEventIds: selected };
  }
  if (totalTickets > Number(totalTicketLimit)) {
    return { ok: false, totalTickets, error: "所选活动合计超过总票数上限。", selectedEventIds: selected };
  }
  return { ok: true, totalTickets, error: "", selectedEventIds: selected };
}

