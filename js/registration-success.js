export const TICKET_RESULT_STORAGE_KEY = "event-ticket-system.ticket-result.v1";

function text(value) {
  return typeof value === "string" ? value : "";
}

function ticketProjection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ticketNumber = text(value.ticketNumber).trim();
  const token = text(value.token).trim();
  const eventTitle = text(value.eventTitle).trim();
  if (!ticketNumber || !token || !eventTitle) return null;
  return {
    registrationId: text(value.registrationId), ticketNumber, token, eventTitle,
    status: text(value.status) || "active",
    location: text(value.location),
    participant: { name: text(value.participant?.name) },
    sessions: Array.isArray(value.sessions) ? value.sessions.map((session) => ({
      sessionId: text(session?.sessionId), title: text(session?.title), speaker: text(session?.speaker),
      startsAt: text(session?.startsAt), endsAt: text(session?.endsAt), location: text(session?.location)
    })) : [],
    seats: Array.isArray(value.seats) ? value.seats.map((seat) => ({
      label: text(seat?.label), sessionId: text(seat?.sessionId)
    })) : []
  };
}

export function transitionToTicket(result, { storage = globalThis.sessionStorage, navigate = (target) => globalThis.location.assign(target) } = {}) {
  const projection = result?.ok === true ? ticketProjection(result.data) : null;
  if (!projection || !storage || typeof storage.setItem !== "function" || typeof navigate !== "function") return false;
  try {
    storage.setItem(TICKET_RESULT_STORAGE_KEY, JSON.stringify(projection));
    navigate("ticket.html");
    return true;
  } catch {
    return false;
  }
}

export function consumeStoredTicketResult(storage = globalThis.sessionStorage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.removeItem !== "function") return null;
  try {
    const serialized = storage.getItem(TICKET_RESULT_STORAGE_KEY);
    storage.removeItem(TICKET_RESULT_STORAGE_KEY);
    return ticketProjection(JSON.parse(serialized || "null"));
  } catch {
    return null;
  }
}
