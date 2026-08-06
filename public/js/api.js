import { APPS_SCRIPT_WEB_APP_URL } from "./config.js";

export const DEMO_ENDPOINT_PLACEHOLDER = "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";

const DEFAULT_TIMEOUT_MS = 60_000;
const PUBLIC_ERROR_MESSAGES = {
  CANCELLATION_DISABLED: "This event does not allow participant cancellation.",
  SEAT_EXCHANGE_DISABLED: "This event does not allow seat exchange.",
  SEAT_HOLD_DISABLED: "Seat holds are not enabled for this event.",
  SEAT_HOLD_OWNERSHIP: "This seat is held by another browser session.",
  SEAT_UNAVAILABLE: "The selected seat is no longer available.",
  EVENT_NOT_FOUND: "未找到该活动。",
  INVALID_REQUEST: "提交信息无效，请检查后重试。",
  REGISTRATION_CLOSED: "报名已截止。",
  REGISTRATION_UPDATE_CLOSED: "已超过报名修改期限。",
  REGISTRATION_CHANGED: "报名资料已变化，请重新载入电子票。",
  EVENT_CAPACITY_FULL: "活动总名额已满。",
  DUPLICATE_REGISTRATION: "你已经报名过这个活动，请直接找回电子票。",
  REGISTRATION_FULL: "报名名额已满。",
  REGISTRATION_NOT_OPEN: "报名尚未开放。",
  REQUIRED_SESSION: "必选场次不能取消。",
  SESSION_STARTED: "已开始的场次不能取消。",
  SESSION_CHECKED_IN: "已签到的场次不能取消。",
  SESSION_FULL: "所选场次名额已满。",
  SESSION_CONFLICT: "所选场次时间冲突。",
  TICKET_ALREADY_VERIFIED: "该凭证已完成验票。",
  TICKET_NOT_FOUND: "未找到对应凭证。",
  TICKET_VERIFICATION_FAILED: "验证信息不匹配。",
  TOKEN_INVALID: "凭证无效或已过期。"
};

function failure(code, message) {
  return { ok: false, code, message };
}

function isSafeEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.trim() === "") return false;
  try {
    return new URL(endpoint).protocol === "https:";
  } catch {
    return false;
  }
}

function demoEvent() {
  return {
    id: "night-of-ideas",
    title: "夜航：创作、城市与不眠",
    status: "open",
    date: "2026 年 8 月 16 日",
    place: "吉隆坡 · 黑箱剧场",
    description: "演示活动：用于体验报名流程。",
    opensAt: "2026-07-20T10:00:00+08:00",
    closesAt: "2026-08-15T20:00:00+08:00",
    selectionMode: "mixed",
    minChoices: 1,
    maxChoices: 2,
    seatMode: "self",
    sessions: [
      { id: "opening", title: "开场：把城市写进身体", speaker: "林青", startsAt: "2026-08-16T10:00:00+08:00", endsAt: "2026-08-16T10:40:00+08:00", required: true },
      { id: "making", title: "工作坊：用限制创造", speaker: "阿南", startsAt: "2026-08-16T11:00:00+08:00", endsAt: "2026-08-16T12:20:00+08:00", required: false }
    ],
    seats: ["A-01", "A-02", "A-03", "B-01", "B-02", "B-03"],
    fields: [
      { id: "name", label: "你的姓名", type: "text", required: true, autocomplete: "name" },
      { id: "email", label: "电子邮箱", type: "email", required: true, autocomplete: "email" },
      { id: "agreement", label: "我同意报名须知", type: "boolean", required: true }
    ]
  };
}

function demoResponse(action, payload) {
  const event = demoEvent();
  const metadata = { demo: true, message: "演示模式：数据不会保存或发送。" };
  if (action === "listEvents") return { ok: true, ...metadata, data: { events: [event], serverNow: new Date().toISOString() } };
  if (action === "getEvent") return payload.eventId === event.id
    ? { ok: true, ...metadata, data: { event, serverNow: new Date().toISOString() } }
    : failure("NOT_FOUND", "未找到该活动。");
  if (action === "createRegistration") return { ok: true, demo: true, message: "演示模式：报名不会保存或发送。", data: { registrationId: "DEMO-NOT-STORED" } };
  if (action === "lookupTicket") return failure("DEMO_ONLY", "演示模式不提供凭证查询。");
  return failure("DEMO_ONLY", "演示模式不提供验票服务。");
}

function normalizeServerResult(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.ok !== "boolean") {
    return failure("INVALID_RESPONSE", "服务返回的数据无效，请稍后重试。");
  }
  if (body.ok === true) return { ok: true, data: body.data };

  const code = typeof body.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.code) ? body.code : "REQUEST_REJECTED";
  return failure(code, PUBLIC_ERROR_MESSAGES[code] || "请求未能完成，请稍后重试。");
}

export function createApiClient({ endpoint = APPS_SCRIPT_WEB_APP_URL, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  async function request(action, payload) {
    if (endpoint === DEMO_ENDPOINT_PLACEHOLDER) return demoResponse(action, payload);
    if (!isSafeEndpoint(endpoint)) return failure("UNSAFE_ENDPOINT", "服务地址配置无效。");
    if (typeof fetchImpl !== "function") return failure("NETWORK_ERROR", "网络连接异常，请检查网络后重试。");

    const controller = new AbortController();
    const delay = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), delay);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal
      });
      if (!response || !response.ok) return failure("HTTP_ERROR", "服务暂时不可用，请稍后重试。");
      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return failure("TIMEOUT", "请求超时，请检查网络后重试。");
        return failure("INVALID_RESPONSE", "服务返回的数据无效，请稍后重试。");
      }
      return normalizeServerResult(body);
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) return failure("TIMEOUT", "请求超时，请检查网络后重试。");
      return failure("NETWORK_ERROR", "网络连接异常，请检查网络后重试。");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    listEvents: () => request("listEvents", {}),
    getEvent: (eventId) => request("getEvent", { eventId }),
    createRegistration: (requestData) => request("createRegistration", {
      eventId: requestData?.eventId,
      sessionIds: requestData?.sessionIds,
      seatChoices: requestData?.seatChoices,
      answers: requestData?.answers,
      seatHoldOwner: requestData?.seatHoldOwner
    }),
    recoverTicket: (requestData) => request("recoverTicket", {
      eventId: requestData?.eventId,
      name: requestData?.name,
      phone: requestData?.phone
    }),
    lookupTicket: (ticketNumber, verificationValue) => request("lookupTicket", { ticketNumber, verificationValue }),
    verifyTicket: (token) => request("verifyTicket", { token }),
    createSeatHold: (requestData) => request("createSeatHold", {
      eventId: requestData?.eventId,
      seatId: requestData?.seatId,
      holdOwner: requestData?.holdOwner
    }),
    releaseSeatHold: (requestData) => request("releaseSeatHold", {
      eventId: requestData?.eventId,
      seatId: requestData?.seatId,
      holdOwner: requestData?.holdOwner
    }),
    cancelRegistration: (ticketNumber, verificationValue) =>
      request("cancelRegistration", { ticketNumber, verificationValue }),
    exchangeSeat: (requestData) => request("exchangeSeat", {
      ticketNumber: requestData?.ticketNumber,
      verificationValue: requestData?.verificationValue,
      oldSeatId: requestData?.oldSeatId,
      newSeatId: requestData?.newSeatId,
      seatHoldOwner: requestData?.seatHoldOwner
    }),
    updateRegistrationSessions: (requestData) => request("updateRegistrationSessions", {
      ticketNumber: requestData?.ticketNumber,
      verificationValue: requestData?.verificationValue,
      sessionIds: requestData?.sessionIds,
      seatChoices: requestData?.seatChoices,
      seatHoldOwner: requestData?.seatHoldOwner
    })
  };
}

const publicClient = createApiClient();

export const listEvents = () => publicClient.listEvents();
export const getEvent = (eventId) => publicClient.getEvent(eventId);
export const createRegistration = (request) => publicClient.createRegistration(request);
export const recoverTicket = (request) => publicClient.recoverTicket(request);
export const lookupTicket = (ticketNumber, verificationValue) => publicClient.lookupTicket(ticketNumber, verificationValue);
export const verifyTicket = (token) => publicClient.verifyTicket(token);
export const createSeatHold = (request) => publicClient.createSeatHold(request);
export const releaseSeatHold = (request) => publicClient.releaseSeatHold(request);
export const cancelRegistration = (ticketNumber, verificationValue) =>
  publicClient.cancelRegistration(ticketNumber, verificationValue);
export const exchangeSeat = (request) => publicClient.exchangeSeat(request);
export const updateRegistrationSessions = (request) =>
  publicClient.updateRegistrationSessions(request);
