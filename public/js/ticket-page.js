import { lookupTicket } from "./api.js";
import { renderQrSvg } from "./qr.js";

const STATUS = {
  active: { code: "active", label: "有效凭证" },
  cancelled: { code: "cancelled", label: "凭证已取消" },
  ended: { code: "ended", label: "活动已结束" }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function formatDateTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(timestamp);
}

export function buildVerificationUrl(token) {
  if (typeof token !== "string" || token.trim() === "") throw new TypeError("Missing ticket token.");
  return `verify.html?token=${encodeURIComponent(token)}`;
}

export function createTicketViewModel(ticket) {
  const status = STATUS[ticket?.status] || STATUS.active;
  const seats = Array.isArray(ticket?.seats) ? ticket.seats : [];
  const sessions = (Array.isArray(ticket?.sessions) ? ticket.sessions : []).map((session) => {
    const sessionSeats = seats.filter((seat) => !seat.sessionId || seat.sessionId === session.sessionId);
    return {
      title: String(session.title || ""),
      speaker: String(session.speaker || ""),
      time: [formatDateTime(session.startsAt), formatDateTime(session.endsAt)].filter(Boolean).join(" – "),
      location: String(session.location || ticket.location || ""),
      seats: sessionSeats.map((seat) => String(seat.label || "")).filter(Boolean)
    };
  });
  return {
    eventTitle: String(ticket?.eventTitle || ""),
    ticketNumber: String(ticket?.ticketNumber || ""),
    participantName: String(ticket?.participant?.name || ""),
    status,
    sessions,
    seatSummary: seats.map((seat) => String(seat.label || "")).filter(Boolean).join(" · "),
    qrPayload: buildVerificationUrl(ticket?.token)
  };
}

export function renderTicketMarkup(view) {
  const sessionMarkup = view.sessions.map((session) => `
    <article class="ticket-session">
      <p class="ticket-session-time">${escapeHtml(session.time)}</p>
      <h3>${escapeHtml(session.title)}</h3>
      <dl>
        <div><dt>讲师</dt><dd>${escapeHtml(session.speaker || "待公布")}</dd></div>
        <div><dt>地点</dt><dd>${escapeHtml(session.location || "待公布")}</dd></div>
        <div><dt>座位</dt><dd>${escapeHtml(session.seats.join(" · ") || view.seatSummary || "自由入座")}</dd></div>
      </dl>
    </article>`).join("");
  return `
    <article class="ticket-card status-${escapeHtml(view.status.code)}">
      <header class="ticket-title-row">
        <div><p class="eyebrow">ELECTRONIC TICKET</p><h2>${escapeHtml(view.eventTitle)}</h2></div>
        <span class="ticket-status">${escapeHtml(view.status.label)}</span>
      </header>
      <section class="ticket-holder">
        <div><span>参与者</span><strong>${escapeHtml(view.participantName)}</strong></div>
        <div class="ticket-seat"><span>座位</span><strong>${escapeHtml(view.seatSummary || "自由入座")}</strong></div>
      </section>
      <section class="ticket-sessions" aria-label="已报名讲座">${sessionMarkup}</section>
      <footer class="ticket-footer">
        <div class="ticket-code"><span>凭证编号</span><strong>${escapeHtml(view.ticketNumber)}</strong><p>每场讲座将分别签到</p></div>
        <div class="ticket-qr-wrap">${renderQrSvg(view.qrPayload, { scale: 4 })}</div>
      </footer>
    </article>`;
}

async function initialiseTicketPage() {
  const form = document.querySelector("#ticket-lookup-form");
  if (!form) return;
  const resultHolder = document.querySelector("#ticket-result");
  const message = document.querySelector("#ticket-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = "正在查询凭证…";
    resultHolder.replaceChildren();
    const result = await lookupTicket(
      form.elements.ticketNumber.value.trim(),
      form.elements.verificationValue.value.trim()
    );
    button.disabled = false;
    if (!result.ok) {
      message.textContent = result.message;
      return;
    }
    message.textContent = "";
    const template = document.createElement("template");
    template.innerHTML = renderTicketMarkup(createTicketViewModel(result.data));
    resultHolder.replaceChildren(template.content);
  });
}

if (typeof document !== "undefined") initialiseTicketPage();
