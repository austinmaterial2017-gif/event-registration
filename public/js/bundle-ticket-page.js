import { verifyBundleTicket } from "./api.js";
import { renderQrSvg } from "./qr.js";

const token = new URLSearchParams(location.search).get("t") || "";
const number = document.querySelector("#ticket-number");
const events = document.querySelector("#ticket-events");
const qr = document.querySelector("#ticket-qr");
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
    events.replaceChildren(...result.data.selectedEvents.map((item) => {
      const line = document.createElement("p");
      line.textContent = `${item.title || item.itemId || item.eventId} · ${item.fixedTicketCount} 张票`;
      return line;
    }));
    // Staff scanner accepts a raw 64-character token.  Unlike a long URL it
    // fits the local QR encoder and scans more reliably on phones.
    qr.innerHTML = renderQrSvg(token);
  } catch (_error) {
    number.textContent = "电子凭证读取失败，请重新找回电子票。";
  }
}

loadBundleTicket();
