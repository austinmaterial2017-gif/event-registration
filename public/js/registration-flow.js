import { getEventCapability, validateAnswers, validateSelection } from "./domain.js";

export function getRegistrationAvailability(event, serverTimestamp) {
  const now = Number(serverTimestamp);
  const opensAt = Date.parse(event?.opensAt);
  const closesAt = Date.parse(event?.closesAt);
  const capability = getEventCapability(event?.status);
  if (!capability.visible || !Number.isFinite(now)) return { phase: "closed", canRegister: false, countdownTarget: null, countdownKind: null };
  if (Number.isFinite(closesAt) && now >= closesAt) return { phase: "closed", canRegister: false, countdownTarget: closesAt, countdownKind: "closes" };
  if (event?.status === "upcoming" && Number.isFinite(opensAt) && now < opensAt) return { phase: "upcoming", canRegister: false, countdownTarget: opensAt, countdownKind: "opens" };
  if (!capability.canRegister) return { phase: "closed", canRegister: false, countdownTarget: null, countdownKind: null };
  if (Number.isFinite(opensAt) && now < opensAt) return { phase: "upcoming", canRegister: false, countdownTarget: opensAt, countdownKind: "opens" };
  return { phase: "open", canRegister: true, countdownTarget: Number.isFinite(closesAt) ? closesAt : null, countdownKind: Number.isFinite(closesAt) ? "closes" : null };
}

export function getSeatModeState(seatMode) {
  const options = {
    none: { mode: "none", requiresSelection: false, label: "自由入座" },
    auto: { mode: "auto", requiresSelection: false, label: "系统分配" },
    self: { mode: "self", requiresSelection: true, label: "自行选座" },
    zone: { mode: "zone", requiresSelection: true, label: "选择区域" }
  };
  return options[seatMode] || options.none;
}

export function getFieldControlSpec(type) {
  if (["text", "number", "tel", "email", "date", "radio", "checkbox"].includes(type)) return { tag: "input", inputType: type };
  if (type === "boolean") return { tag: "input", inputType: "checkbox" };
  if (type === "textarea" || type === "select") return { tag: type, inputType: null };
  return { tag: "input", inputType: "text" };
}

export function applyRegistrationGate(event, serverTimestamp, controls) {
  const availability = getRegistrationAvailability(event, serverTimestamp);
  for (const control of controls || []) {
    const intrinsicallyDisabled = control?.dataset?.intrinsicDisabled === "true";
    control.disabled = !availability.canRegister || intrinsicallyDisabled;
  }
  return availability;
}

export function validateRegistrationDraft(event, sessionIds, seat, answers, serverTimestamp) {
  const availability = getRegistrationAvailability(event, serverTimestamp);
  const selection = validateSelection(event, event?.sessions, sessionIds);
  const answerValidation = validateAnswers(event?.fields, answers);
  const errors = [...selection.errors, ...Object.values(answerValidation.errors)];
  if (!availability.canRegister) errors.push(availability.phase === "upcoming" ? "报名尚未开放。" : "报名已截止或未开放。");
  if (getSeatModeState(event?.seatMode).requiresSelection && !seat) errors.push(event?.seatMode === "zone" ? "请选择座位区域。" : "请选择座位。");
  return { valid: errors.length === 0, errors, availability };
}
