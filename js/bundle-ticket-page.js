import { verifyBundleTicket } from "./api.js";
import { renderQrSvg } from "./qr.js";

const token = new URLSearchParams(location.search).get("t") || "";
const number = document.querySelector("#ticket-number");
const events = document.querySelector("#ticket-events");
const details = document.querySelector("#ticket-details");
const qr = document.querySelector("#ticket-qr");

function renderBundleTicketDetails(ticketDisplay) {
  if (!details) return;
  const fields = Array.isArray(ticketDisplay && ticketDisplay.fields) ? ticketDisplay.fields : [];
  details.hidden = fields.length === 0;
  const container = details.querySelector("div");
  container.replaceChildren(...fields.map((field) => {
    const line = document.createElement("p");
    line.textContent = `${field.label}：${field.value}`;
    return line;
  }));
}

function renderBundleTicketItems(ticketDisplay, selectedEvents) {
  const items = Array.isArray(ticketDisplay && ticketDisplay.items) && ticketDisplay.items.length
    ? ticketDisplay.items : (selectedEvents || []);
  events.replaceChildren(...items.map((item) => {
    const line = document.createElement("p");
    const bits = [item.title || item.itemId || item.eventId];
    if (item.fixedTicketCount !== undefined) bits.push(`${item.fixedTicketCount} 张票`);
    if (item.schedule) bits.push(item.schedule);
    if (item.location) bits.push(item.location);
    line.textContent = bits.filter(Boolean).join(" · ");
    return line;
  }));
}
async function loadBundleTicket() {
  if (!token) {
    number.textContent = "缺少电子凭证资料";
    return;
  }
  try {
    const result = await verifyBundleTicket(token);
    if (!result.ok) {
      number.textContent = result.message;
      return;
    }
    number.textContent = result.data.ticketNumber;
    renderBundleTicketDetails(result.data.ticketDisplay);
    renderBundleTicketItems(result.data.ticketDisplay, result.data.selectedEvents);
    // Staff scanner accepts a raw 64-character token.  Unlike a long URL it
    // fits the local QR encoder and scans more reliably on phones.
    qr.innerHTML = renderQrSvg(token);
  } catch (_error) {
    number.textContent = "电子凭证读取失败，请重新找回电子票。";
  }
}

loadBundleTicket();
