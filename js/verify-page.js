import { verifyTicket } from "./api.js?v=20260728-stable";

const STATUS_LABELS = {
  active: "凭证有效",
  cancelled: "凭证已取消",
  ended: "活动已结束"
};

function formatTime(startsAt, endsAt) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  });
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start)) return "";
  return `${formatter.format(start)}${Number.isFinite(end) ? ` – ${formatter.format(end)}` : ""}`;
}

export function createVerificationViewModel(ticket) {
  const seats = Array.isArray(ticket?.seats) ? ticket.seats : [];
  return {
    participantName: String(ticket?.participantName || ""),
    eventTitle: String(ticket?.event?.title || ""),
    eventLocation: String(ticket?.event?.location || ""),
    status: String(ticket?.status || "ended"),
    statusLabel: STATUS_LABELS[ticket?.status] || "凭证状态未知",
    checkedIn: false,
    sessions: (Array.isArray(ticket?.sessions) ? ticket.sessions : []).map((session) => ({
      sessionId: String(session.sessionId || ""),
      title: String(session.title || ""),
      speaker: String(session.speaker || ""),
      time: formatTime(session.startsAt, session.endsAt),
      location: String(session.location || ticket?.event?.location || ""),
      seats: seats
        .filter((seat) => !seat.sessionId || seat.sessionId === session.sessionId)
        .map((seat) => String(seat.label || ""))
        .filter(Boolean)
    }))
  };
}

export function readVerificationToken(search = "") {
  const parameters = new URLSearchParams(String(search || ""));
  return (parameters.get("t") || parameters.get("token") || "").trim();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderVerification(view) {
  const holder = document.querySelector("#verification-result");
  holder.replaceChildren();
  const card = element("article", `verification-card status-${view.status}`);
  const heading = element("div", "verification-heading");
  heading.append(element("p", "eyebrow", "TICKET VERIFICATION"), element("h1", "", view.statusLabel));
  heading.append(element("span", "ticket-status", view.statusLabel));
  card.append(heading);

  const identity = element("dl", "verification-identity");
  for (const [label, value] of [["参与者", view.participantName], ["活动", view.eventTitle], ["地点", view.eventLocation]]) {
    const group = element("div");
    group.append(element("dt", "", label), element("dd", "", value || "待公布"));
    identity.append(group);
  }
  card.append(identity);

  const sessions = element("section", "verification-sessions");
  view.sessions.forEach((session) => {
    const item = element("article", "verification-session");
    item.append(
      element("h2", "", session.title),
      element("p", "", `${session.speaker || "讲师待公布"} · ${session.time}`),
      element("p", "", `${session.location || "地点待公布"} · ${session.seats.join(" · ") || "自由入座"}`)
    );
    sessions.append(item);
  });
  card.append(sessions);
  holder.append(card);
}

async function initialiseVerificationPage() {
  const status = document.querySelector("#verification-message");
  if (!status) return;
  const token = readVerificationToken(window.location.search);
  if (!token) {
    status.textContent = "二维码缺少有效凭证资料。";
    return;
  }

  status.textContent = "正在验证凭证…";
  const result = await verifyTicket(token);
  if (!result.ok) {
    status.textContent = result.message;
    return;
  }
  const view = createVerificationViewModel(result.data);
  renderVerification(view);
  status.textContent = "已读取凭证；此步骤不会自动签到。";
}

if (typeof document !== "undefined") initialiseVerificationPage();
