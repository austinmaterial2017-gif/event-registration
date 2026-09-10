import { verifyBundleTicket } from "./api.js";
import { renderQrSvg } from "./qr.js";

const token = new URLSearchParams(location.search).get("t") || "";
const number = document.querySelector("#ticket-number");
const events = document.querySelector("#ticket-events");
const qr = document.querySelector("#ticket-qr");
const result = await verifyBundleTicket(token);

if (!result.ok) {
  number.textContent = result.message;
  throw new Error(result.message);
}

number.textContent = result.data.ticketNumber;
events.replaceChildren(...result.data.selectedEvents.map((item) => {
  const line = document.createElement("p");
  line.textContent = `${item.title || item.itemId || item.eventId} · ${item.fixedTicketCount} 张票`;
  return line;
}));

const verificationUrl = new URL("bundle-ticket.html", window.location.href);
verificationUrl.searchParams.set("t", token);
qr.innerHTML = renderQrSvg(verificationUrl.toString());
