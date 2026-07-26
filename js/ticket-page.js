import { cancelRegistration, exchangeSeat, lookupTicket } from "./api.js";
import { renderQrSvg } from "./qr.js";
import { consumeStoredTicketResult } from "./registration-success.js";
import { PUBLIC_BASE_URL } from "./config.js";

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

export function buildVerificationUrl(token, publicBaseUrl = PUBLIC_BASE_URL) {
  if (typeof token !== "string" || token.trim() === "") throw new TypeError("Missing ticket token.");
  if (typeof publicBaseUrl !== "string" || publicBaseUrl.trim() === "") {
    throw new TypeError("Missing public base URL.");
  }
  const base = new URL(publicBaseUrl);
  if (base.protocol !== "https:") throw new TypeError("Public base URL must use HTTPS.");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const verificationUrl = new URL("verify.html", base);
  verificationUrl.searchParams.set("token", token);
  return verificationUrl.href;
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
    displayFields: (Array.isArray(ticket?.displayFields) ? ticket.displayFields : []).map((field) => ({
      id: String(field?.id || ""),
      label: String(field?.label || ""),
      value: String(field?.value || "")
    })),
    capabilities: {
      canCancel: ticket?.capabilities?.canCancel === true,
      canExchangeSeat: ticket?.capabilities?.canExchangeSeat === true
    },
    exchangeOptions: (Array.isArray(ticket?.exchangeOptions) ? ticket.exchangeOptions : []).map((option) => ({
      seatId: String(option?.seatId || ""),
      label: String(option?.label || ""),
      zone: String(option?.zone || ""),
      sessionId: String(option?.sessionId || ""),
      replacesSeatId: String(option?.replacesSeatId || "")
    })).filter((option) => option.seatId && option.replacesSeatId),
    sessions,
    seatSummary: seats.map((seat) => String(seat.label || "")).filter(Boolean).join(" · "),
    qrPayload: typeof ticket?.verifyUrl === "string" && /^https:\/\//.test(ticket.verifyUrl)
      ? ticket.verifyUrl
      : buildVerificationUrl(
        ticket?.token,
        PUBLIC_BASE_URL !== "PASTE_PUBLIC_BASE_URL_HERE"
          ? PUBLIC_BASE_URL
          : typeof globalThis.location?.href === "string"
          ? new URL(".", globalThis.location.href).href
          : "https://example.invalid/"
      )
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
  const displayFieldMarkup = view.displayFields.length
    ? `<dl class="ticket-display-fields">${view.displayFields.map((field) => `
        <div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`
      ).join("")}</dl>`
    : "";
  const exchangeOptions = view.exchangeOptions.map((option) => `
      <option value="${escapeHtml(`${option.replacesSeatId}|${option.seatId}`)}">
        ${escapeHtml(`${option.label}${option.zone ? ` · ${option.zone}` : ""}`)}
      </option>`).join("");
  const actionMarkup = view.capabilities.canCancel || view.capabilities.canExchangeSeat
    ? `<section class="ticket-actions" aria-label="凭证操作">
        ${view.capabilities.canCancel
          ? '<button class="secondary-button" type="button" data-ticket-action="cancel">取消报名</button>'
          : ""}
        ${view.capabilities.canExchangeSeat
          ? `<label>更换座位
              <select data-ticket-exchange-option ${exchangeOptions ? "" : "disabled"}>
                <option value="">${exchangeOptions ? "请选择新座位" : "目前没有可换座位"}</option>
                ${exchangeOptions}
              </select>
            </label>
            <button class="secondary-button" type="button" data-ticket-action="exchange"
              ${exchangeOptions ? "" : "disabled"}>确认换座</button>`
          : ""}
      </section>`
    : "";
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
      ${displayFieldMarkup}
      ${actionMarkup}
      <footer class="ticket-footer">
        <div class="ticket-code"><span>凭证编号</span><strong>${escapeHtml(view.ticketNumber)}</strong><p>每场讲座将分别签到</p></div>
        <div class="ticket-qr-wrap">${renderQrSvg(view.qrPayload, { scale: 4 })}</div>
      </footer>
    </article>`;
}

export function renderTicketProjection(resultHolder, ticket, documentRef = document) {
  const template = documentRef.createElement("template");
  template.innerHTML = renderTicketMarkup(createTicketViewModel(ticket));
  resultHolder.replaceChildren(template.content);
}

function bindTicketActions(resultHolder, ticket, verificationValue, message, rerender) {
  const requireVerification = () => {
    if (verificationValue) return true;
    message.textContent = "请先在上方填写验证资料并重新查询凭证。";
    return false;
  };
  const cancelButton = resultHolder.querySelector?.('[data-ticket-action="cancel"]');
  cancelButton?.addEventListener("click", async () => {
    if (!requireVerification() ||
        !globalThis.confirm("确认取消这项报名？原有记录会保留。")) return;
    cancelButton.disabled = true;
    message.textContent = "正在取消报名…";
    const result = await cancelRegistration(ticket.ticketNumber, verificationValue);
    if (!result.ok) {
      cancelButton.disabled = false;
      message.textContent = result.message;
      return;
    }
    message.textContent = "报名已取消。";
    rerender(result.data, verificationValue);
  });

  const exchangeButton = resultHolder.querySelector?.('[data-ticket-action="exchange"]');
  exchangeButton?.addEventListener("click", async () => {
    if (!requireVerification()) return;
    const select = resultHolder.querySelector('[data-ticket-exchange-option]');
    const [oldSeatId, newSeatId] = String(select?.value || "").split("|");
    if (!oldSeatId || !newSeatId) {
      message.textContent = "请选择要更换的新座位。";
      return;
    }
    if (!globalThis.confirm("确认更换座位？旧二维码会立即失效。")) return;
    exchangeButton.disabled = true;
    message.textContent = "正在更换座位…";
    const result = await exchangeSeat({
      ticketNumber: ticket.ticketNumber,
      verificationValue,
      oldSeatId,
      newSeatId
    });
    if (!result.ok) {
      exchangeButton.disabled = false;
      message.textContent = result.message;
      return;
    }
    message.textContent = "座位已更新，请重新保存电子凭证。";
    rerender(result.data, verificationValue);
  });
}

export function consumeInitialTicketResult(storage = globalThis.sessionStorage) {
  return consumeStoredTicketResult(storage);
}

async function initialiseTicketPage() {
  const form = document.querySelector("#ticket-lookup-form");
  if (!form) return;
  const resultHolder = document.querySelector("#ticket-result");
  const message = document.querySelector("#ticket-message");
  const showTicket = (ticket, verificationValue = "") => {
    renderTicketProjection(resultHolder, ticket);
    bindTicketActions(resultHolder, ticket, verificationValue, message, showTicket);
  };
  const storedTicket = consumeInitialTicketResult();
  if (storedTicket) {
    message.textContent = "报名成功，以下是你的电子凭证。";
    showTicket(storedTicket);
    return;
  }
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
    showTicket(result.data, form.elements.verificationValue.value.trim());
  });
}

if (typeof document !== "undefined") initialiseTicketPage();
