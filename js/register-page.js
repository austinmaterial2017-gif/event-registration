import { createRegistration, getEvent } from "./api.js?v=20260728-stable";
import { createSeatHold, releaseSeatHold } from "./api.js?v=20260728-stable";
import { applyRegistrationGate, getFieldControlSpec, getSeatModeState, validateRegistrationDraft } from "./registration-flow.js";
import { transitionToTicket } from "./registration-success.js";

const form = typeof document === "undefined" ? null : document.querySelector("#registration-form");
const state = {
  selectedSessions: new Set(),
  seatChoices: [],
  seatSelections: new Map(),
  seatHolds: new Map(),
  seatPending: new Set(),
  holdOwner: "",
  holdTimer: null,
  review: null,
  event: null,
  serverOffset: Number.NaN
};

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function serverTimestamp() { return Date.now() + state.serverOffset; }
function selectedEventId() { return new URLSearchParams(window.location.search).get("event"); }

export function createSeatHoldOwner(cryptoRef = globalThis.crypto) {
  if (typeof cryptoRef?.randomUUID === "function") return `hold-${cryptoRef.randomUUID()}`;
  if (typeof cryptoRef?.getRandomValues !== "function") {
    throw new Error("Secure browser randomness is unavailable.");
  }
  const bytes = new Uint8Array(24);
  cryptoRef.getRandomValues(bytes);
  return `hold-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function appendFieldLabel(container, field, controlId) {
  const label = node("label"); label.htmlFor = controlId; label.append(document.createTextNode(field.label));
  const marker = node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）");
  marker.setAttribute("aria-label", field.required ? "必填" : "选填"); label.append(marker); container.append(label);
}

function renderSessionChoices(event) {
  const fieldset = document.querySelector("#session-options");
  fieldset.replaceChildren(node("legend", "sr-only", "选择活动场次"));
  document.querySelector("#selection-note").textContent = event.selectionMode === "all" ? "以下场次均为必选。" : event.selectionMode === "free" ? `自由选择，最多可选 ${event.maxChoices} 场。` : `含必选与选修场次，请选择 ${event.minChoices} 至 ${event.maxChoices} 场。`;
  for (const session of event.sessions || []) {
    const mandatory = event.selectionMode === "all" || session.required;
    const label = node("label", "choice"); const input = document.createElement("input"); input.type = "checkbox"; input.name = "sessions"; input.value = session.id; input.checked = mandatory; input.disabled = mandatory;
    if (mandatory) { input.dataset.intrinsicDisabled = "true"; state.selectedSessions.add(session.id); }
    const copy = node("span"); copy.append(node("strong", "", `${session.title}${mandatory ? " · 必选" : ""}`), node("small", "", `${session.speaker || ""} · ${new Date(session.startsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}–${new Date(session.endsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`));
    label.append(input, copy); fieldset.append(label);
  }
  fieldset.addEventListener("change", ({ target }) => { if (target.name === "sessions") target.checked ? state.selectedSessions.add(target.value) : state.selectedSessions.delete(target.value); });
}

function renderSeatOptions(event) {
  const holder = document.querySelector("#seat-options"); holder.replaceChildren();
  const seatState = getSeatModeState(event.seatMode);
  if (seatState.mode === "none" || seatState.mode === "auto") { holder.append(node("p", "helper", seatState.mode === "none" ? "本活动不安排固定座位，现场自由入座。" : "提交后将由系统为你自动分配座位。")); return; }
  if (seatState.mode === "zone") {
    const group = node("div", "question"); const select = document.createElement("select"); select.name = "seat-zone"; select.id = "seat-zone";
    appendFieldLabel(group, { label: "区域", required: true }, select.id); const placeholder = node("option", "", "请选择区域"); placeholder.value = ""; select.append(placeholder);
    for (const zone of event.seatZones || ["前区", "中区", "无障碍座位区"]) { const option = node("option", "", zone); option.value = zone; select.append(option); }
    select.addEventListener("change", () => { state.seatChoices = select.value ? [select.value] : []; }); group.append(select); holder.append(group); return;
  }
  const grid = node("div", "choice-grid");
  for (const seat of event.seats || []) { const label = node("label", "seat-choice"); const input = document.createElement("input"); input.type = "radio"; input.name = "seat"; input.value = seat; input.addEventListener("change", () => { state.seatChoices = [input.value]; }); label.append(input, node("span", "", seat)); grid.append(label); }
  holder.append(grid);
}

function normalizedPublicSeats(event) {
  return (Array.isArray(event?.seats) ? event.seats : []).map((seat) =>
    typeof seat === "string"
      ? { id: seat, label: seat, zone: "", sessionId: "", available: true }
      : {
          id: String(seat?.id || seat?.seatId || ""),
          label: String(seat?.label || seat?.id || ""),
          zone: String(seat?.zone || ""),
          sessionId: String(seat?.sessionId || ""),
          available: seat?.available !== false
        }
  ).filter((seat) => seat.id);
}

function naturalSeatCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function seatGridPosition(seat) {
  const zone = String(seat.zone || "");
  const escapedZone = zone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const generated = new RegExp(`^${escapedZone ? `${escapedZone}-` : ""}(\\d+)-(\\d+)$`)
    .exec(String(seat.label || ""));
  if (generated) {
    return { row: Number(generated[1]), column: Number(generated[2]) };
  }
  const compact = /^(?:[^\d]+)?(\d+)$/.exec(String(seat.label || ""));
  return compact
    ? { row: Number(compact[1]), column: 1 }
    : { row: 1, column: 1 };
}

export function buildSeatMapGroups(seats) {
  const byZone = new Map();
  for (const source of Array.isArray(seats) ? seats : []) {
    const seat = {
      ...source,
      available: source?.available !== false,
      ...seatGridPosition(source || {})
    };
    const zone = String(seat.zone || "座位区");
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone).push(seat);
  }
  return [...byZone.entries()]
    .sort(([left], [right]) => naturalSeatCompare(left, right))
    .map(([zone, zoneSeats]) => ({
      zone,
      seats: zoneSeats.sort((left, right) =>
        left.row - right.row ||
        left.column - right.column ||
        naturalSeatCompare(left.label, right.label)
      )
    }));
}

function selectedSeatGroups(event) {
  const seats = normalizedPublicSeats(event);
  const shared = seats.filter((seat) => !seat.sessionId);
  if (shared.length) return [{ id: "shared", label: "全活动通用座位", seats: shared }];
  return [...state.selectedSessions].map((sessionId) => {
    const session = (event.sessions || []).find((candidate) => candidate.id === sessionId);
    return {
      id: sessionId,
      label: session?.title || sessionId,
      seats: seats.filter((seat) => seat.sessionId === sessionId)
    };
  }).filter((group) => group.seats.length);
}

function syncSeatChoices(event) {
  state.seatChoices = selectedSeatGroups(event)
    .map((group) => state.seatSelections.get(group.id))
    .filter(Boolean);
}

function holdStatus(message = "") {
  const status = document.querySelector("#seat-hold-status");
  if (status) status.textContent = message;
}

async function releaseGroupHold(event, groupId) {
  const hold = state.seatHolds.get(groupId);
  state.seatHolds.delete(groupId);
  if (!hold || !state.holdOwner) return;
  await releaseSeatHold({
    eventId: event.id,
    seatId: hold.seatId,
    holdOwner: state.holdOwner
  });
}

function scheduleSeatHoldCountdown(event) {
  if (state.holdTimer) window.clearTimeout(state.holdTimer);
  const active = [...state.seatHolds.entries()]
    .map(([groupId, hold]) => ({ groupId, ...hold, expiresAtMs: Date.parse(hold.expiresAt) }))
    .filter((hold) => Number.isFinite(hold.expiresAtMs));
  if (!active.length) {
    holdStatus("");
    return;
  }
  const remaining = Math.min(...active.map((hold) => hold.expiresAtMs - serverTimestamp()));
  if (remaining <= 0) {
    for (const hold of active.filter((item) => item.expiresAtMs <= serverTimestamp())) {
      state.seatHolds.delete(hold.groupId);
      state.seatSelections.delete(hold.groupId);
    }
    syncSeatChoices(event);
    holdStatus("座位保留已到期，请重新选择。");
    renderSeatOptionsV2(event);
    return;
  }
  holdStatus(`已暂时保留座位，剩余 ${Math.max(1, Math.ceil(remaining / 1000))} 秒。`);
  state.holdTimer = window.setTimeout(() => scheduleSeatHoldCountdown(event), 1000);
}

async function chooseSelfSeat(event, groupId, seatId) {
  if (state.seatPending.has(groupId)) return;
  const previous = state.seatSelections.get(groupId);
  if (previous === seatId) return;
  state.seatPending.add(groupId);
  holdStatus("正在锁定座位，请稍候…");
  renderSeatOptionsV2(event);
  try {
    if (previous) await releaseGroupHold(event, groupId);
    state.seatSelections.delete(groupId);
    syncSeatChoices(event);
    if (!event.seatHoldsEnabled) {
      state.seatSelections.set(groupId, seatId);
      syncSeatChoices(event);
      holdStatus("座位已选中，请继续填写报名资料。");
      return;
    }
    const result = await createSeatHold({
      eventId: event.id,
      seatId,
      holdOwner: state.holdOwner
    });
    if (!result.ok) {
      holdStatus(result.message || "这个座位刚刚已被选择，请重新选择。");
      const refreshed = await getEvent(event.id);
      if (refreshed.ok) {
        state.event = refreshed.data.event;
        Object.assign(event, refreshed.data.event);
      }
      return;
    }
    state.seatSelections.set(groupId, seatId);
    state.seatHolds.set(groupId, {
      seatId,
      expiresAt: result.data.expiresAt
    });
    syncSeatChoices(event);
  } catch (_error) {
    holdStatus("座位暂时无法锁定，请稍后再试。");
  } finally {
    state.seatPending.delete(groupId);
    renderSeatOptionsV2(event);
    if (state.seatHolds.size) scheduleSeatHoldCountdown(event);
  }
}

function renderSeatOptionsV2(event) {
  const holder = document.querySelector("#seat-options");
  holder.replaceChildren();
  const seatState = getSeatModeState(event.seatMode);
  if (seatState.mode === "none" || seatState.mode === "auto") {
    holder.append(node("p", "helper", seatState.label));
    state.seatSelections.clear();
    state.seatChoices = [];
    return;
  }
  const groups = selectedSeatGroups(event);
  const currentGroupIds = new Set(groups.map((group) => group.id));
  for (const groupId of [...state.seatSelections.keys()]) {
    if (!currentGroupIds.has(groupId)) {
      void releaseGroupHold(event, groupId);
      state.seatSelections.delete(groupId);
    }
  }
  for (const group of groups) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "question";
    fieldset.append(node("legend", "", group.label));
    if (seatState.mode === "zone") {
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${group.label}座位区域`);
      const placeholder = node("option", "", "请选择区域");
      placeholder.value = "";
      select.append(placeholder);
      const zones = [...new Set(group.seats.map((seat) => seat.zone).filter(Boolean))];
      for (const zone of zones) {
        const option = node("option", "", zone);
        option.value = zone;
        option.selected = state.seatSelections.get(group.id) === zone;
        select.append(option);
      }
      select.addEventListener("change", () => {
        if (select.value) state.seatSelections.set(group.id, select.value);
        else state.seatSelections.delete(group.id);
        syncSeatChoices(event);
      });
      fieldset.append(select);
    } else {
      const map = node("div", "seat-map");
      map.append(node("div", "seat-map-stage", event.seatMapLabel || "舞台 / 白板"));
      const legend = node("div", "seat-map-legend");
      legend.append(
        node("span", "seat-map-key is-available", "可选择"),
        node("span", "seat-map-key is-selected", "暂选中"),
        node("span", "seat-map-key is-unavailable", "已被选择")
      );
      map.append(legend);
      const floor = node("div", "seat-map-floor");
      for (const zoneGroup of buildSeatMapGroups(group.seats)) {
        const zone = node("div", "seat-map-zone");
        zone.append(node("strong", "seat-map-zone-name", zoneGroup.zone));
        const grid = node("div", "seat-map-grid");
        for (const seat of zoneGroup.seats) {
          const label = node("label", "seat-choice");
          const input = document.createElement("input");
          input.type = "radio";
          input.name = `seat-${group.id}`;
          input.value = seat.id;
          input.checked = state.seatSelections.get(group.id) === seat.id;
          input.disabled = !seat.available || state.seatPending.has(group.id);
          if (!seat.available) label.classList.add("is-unavailable");
          label.style.gridRow = String(seat.row);
          label.style.gridColumn = String(seat.column);
          input.addEventListener("change", () => {
            if (input.checked) void chooseSelfSeat(event, group.id, seat.id);
          });
          const seatLabel = node("span", "", seat.label || seat.id);
          seatLabel.setAttribute(
            "aria-label",
            `${seat.label || seat.id}${seat.available ? "可选择" : "已被选择"}`
          );
          label.append(input, seatLabel);
          grid.append(label);
        }
        zone.append(grid);
        floor.append(zone);
      }
      map.append(floor);
      fieldset.append(map);
    }
    holder.append(fieldset);
  }
  syncSeatChoices(event);
}

function renderQuestions(event) {
  const holder = document.querySelector("#dynamic-questions"); holder.replaceChildren();
  for (const field of event.fields || []) {
    const controlSpec = getFieldControlSpec(field.type); const wrapper = field.type === "radio" || field.type === "checkbox" ? document.createElement("fieldset") : node("div"); wrapper.className = "question"; wrapper.dataset.fieldType = field.type;
    const controlId = `field-${field.id}`;
    if (field.type === "radio" || field.type === "checkbox") {
      const legend = node("legend", "", field.label); legend.append(node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）")); wrapper.append(legend);
      const options = node("div", "inline-options"); for (const value of field.options || []) { const label = node("label"); const input = document.createElement("input"); input.type = field.type; input.name = field.id; input.value = value; input.required = field.required; label.append(input, document.createTextNode(value)); options.append(label); } wrapper.append(options);
    } else if (field.type === "boolean") {
      const label = node("label", "inline-options"); const input = document.createElement("input"); input.id = controlId; input.name = field.id; input.type = "checkbox"; input.value = "true"; input.required = field.required; label.append(input, document.createTextNode(field.label), node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）")); wrapper.append(label);
    } else {
      const control = document.createElement(controlSpec.tag); control.id = controlId; control.name = field.id; control.required = field.required;
      if (controlSpec.inputType) { control.type = controlSpec.inputType; control.autocomplete = field.autocomplete || ""; if (field.min !== undefined) control.min = String(field.min); }
      appendFieldLabel(wrapper, field, controlId);
      if (field.type === "select") { const placeholder = node("option", "", "请选择"); placeholder.value = ""; control.append(placeholder); for (const value of field.options || []) { const option = node("option", "", value); option.value = value; control.append(option); } }
      wrapper.append(control);
    }
    const constraints = field.constraints && typeof field.constraints === "object"
      ? field.constraints : {};
    for (const input of wrapper.querySelectorAll("input, textarea, select")) {
      if (field.type === "checkbox") input.required = false;
      if (constraints.min !== undefined) input.min = String(constraints.min);
      if (constraints.max !== undefined) input.max = String(constraints.max);
      if (constraints.minLength !== undefined) input.minLength = Number(constraints.minLength);
      if (constraints.maxLength !== undefined) input.maxLength = Number(constraints.maxLength);
      if (constraints.pattern && "pattern" in input) input.pattern = String(constraints.pattern);
      if (!input.autocomplete && ["name", "email", "phone"].includes(field.semanticRole)) {
        input.autocomplete = field.semanticRole === "phone" ? "tel" : field.semanticRole;
      }
    }
    holder.append(wrapper);
  }
}

function collectAnswers(event) {
  const answers = {};
  for (const field of event.fields || []) { const controls = [...form.elements].filter((control) => control.name === field.id); if (field.type === "checkbox") answers[field.id] = controls.filter((control) => control.checked).map((control) => control.value); else if (field.type === "boolean") answers[field.id] = controls[0]?.checked === true; else answers[field.id] = controls.find((control) => control.checked || control.type !== "radio")?.value ?? ""; }
  return answers;
}

function showErrors(messages) {
  const summary = document.querySelector("#error-summary"); summary.replaceChildren();
  if (!messages.length) { summary.hidden = true; return; }
  const title = node("strong", "", "请先处理以下问题："); const list = document.createElement("ul"); for (const message of messages) list.append(node("li", "", message)); summary.append(title, list); summary.hidden = false; summary.focus();
}

function showReview(event, request) {
  const details = document.querySelector("#review-details"); details.replaceChildren();
  const sessionNames = request.sessionIds.map((id) => event.sessions.find((session) => session.id === id)?.title || id).join("、");
  const rows = [["已选场次", sessionNames], ["座位", request.seatChoices.join("、") || getSeatModeState(event.seatMode).label], ...event.fields.map((field) => { const value = request.answers[field.id]; return [field.label, Array.isArray(value) ? value.join("、") : value === true ? "已同意" : value || "未填写"]; })];
  for (const [label, value] of rows) { const list = document.createElement("dl"); list.append(node("dt", "", label), node("dd", "", value)); details.append(list); }
  state.review = request; form.hidden = true; const card = document.querySelector("#review-card"); card.hidden = false; card.focus();
}

export function createFinalSubmitHandler({ getReview, validateReview, submitRegistration, showErrors, editReview, setSubmitting, transition }) {
  return async () => {
    const review = getReview();
    if (!review) return;
    const validation = validateReview(review);
    showErrors(validation.errors || []);
    if (!validation.valid) {
      editReview();
      return;
    }
    setSubmitting(true);
    const result = await submitRegistration(review);
    if (result.ok && transition(result)) return;
    showErrors([result.ok ? "凭证暂时无法打开，请重试。" : result.message]);
    setSubmitting(false);
  };
}

function setRegistrationEnabled(event) {
  const availability = applyRegistrationGate(event, serverTimestamp(), form.querySelectorAll("input, textarea, select, button")); const countdown = document.querySelector("#countdown");
  if (availability.countdownTarget) { const milliseconds = Math.max(0, availability.countdownTarget - serverTimestamp()); const hours = Math.floor(milliseconds / 3_600_000); const minutes = Math.floor((milliseconds % 3_600_000) / 60_000); countdown.textContent = availability.phase === "upcoming" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : availability.phase === "open" ? `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。` : "报名已截止。"; } else countdown.textContent = availability.phase === "closed" ? "此活动目前未开放报名。" : "报名时间以服务器时间为准。";
  const reviewButton = document.querySelector("#review-registration"); if (reviewButton) reviewButton.disabled = !availability.canRegister;
  if (availability.countdownTarget && availability.phase !== "closed") window.setTimeout(() => setRegistrationEnabled(event), Math.min(30_000, Math.max(250, availability.countdownTarget - serverTimestamp() + 1)));
  return availability;
}

function validateReview(event, request) {
  return validateRegistrationDraft(
    event, request.sessionIds, request.seatChoices, request.answers, serverTimestamp()
  );
}

async function initialise() {
  const eventId = selectedEventId(); const result = eventId ? await getEvent(eventId) : { ok: false, message: "未指定活动。" };
  if (!result.ok || !result.data?.event) { document.querySelector("#registration-content").hidden = true; const closed = document.querySelector("#registration-closed"); closed.hidden = false; closed.textContent = result.message || "暂时无法加载活动，请返回活动列表重试。"; return; }
  const timestamp = Date.parse(result.data.serverNow); state.serverOffset = Number.isFinite(timestamp) ? timestamp - Date.now() : Number.NaN; state.event = result.data.event;
  state.holdOwner = createSeatHoldOwner();
  document.querySelector("#event-meta").textContent = state.event.title;
  renderSessionChoices(state.event);
  document.querySelector("#session-options").addEventListener("change", () => {
    renderSeatOptionsV2(state.event);
  });
  renderSeatOptionsV2(state.event);
  renderQuestions(state.event);
  setRegistrationEnabled(state.event);
  form.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    const request = {
      eventId: state.event.id,
      sessionIds: [...state.selectedSessions],
      seatChoices: [...state.seatChoices],
      answers: collectAnswers(state.event),
      seatHoldOwner: state.holdOwner
    };
    const validation = validateReview(state.event, request);
    showErrors(validation.errors);
    if (validation.valid) showReview(state.event, request);
  });
  document.querySelector("#edit-registration").addEventListener("click", () => { state.review = null; document.querySelector("#review-card").hidden = true; form.hidden = false; form.querySelector("input, textarea, select")?.focus(); });
  const finalSubmit = document.querySelector("#final-submit");
  finalSubmit.addEventListener("click", createFinalSubmitHandler({
    getReview: () => state.review,
    validateReview: (review) => validateReview(state.event, review),
    submitRegistration: createRegistration,
    showErrors,
    editReview: () => document.querySelector("#edit-registration").click(),
    setSubmitting: (submitting) => {
      finalSubmit.disabled = submitting;
      finalSubmit.textContent = submitting ? "正在提交…" : "06 · 确认提交报名";
    },
    transition: (result) => transitionToTicket(result)
  }));
}

if (form) initialise();
