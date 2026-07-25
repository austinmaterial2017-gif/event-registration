import { createRegistration, getEvent } from "./api.js";
import { applyRegistrationGate, getFieldControlSpec, getSeatModeState, validateRegistrationDraft } from "./registration-flow.js";

const form = document.querySelector("#registration-form");
const state = { selectedSessions: new Set(), seatChoices: [], review: null, event: null, serverOffset: Number.NaN };

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function serverTimestamp() { return Date.now() + state.serverOffset; }
function selectedEventId() { return new URLSearchParams(window.location.search).get("event"); }

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

function renderSuccess(result) {
  const section = node("section", "success-card form-card"); section.append(node("p", "eyebrow", "REGISTRATION COMPLETE"), node("h2", "", result.demo ? "演示提交已完成。" : "你的位置已经留好。"), node("p", "", result.demo ? "演示模式：报名没有保存或发送。" : `报名编号：${result.data?.registrationId || ""}。电子凭证将发送到你的邮箱。`)); const link = node("a", "primary-button", "查看其他活动"); link.href = "index.html"; section.append(link); document.querySelector("#review-card").replaceWith(section);
}

function setRegistrationEnabled(event) {
  const availability = applyRegistrationGate(event, serverTimestamp(), form.querySelectorAll("input, textarea, select, button")); const countdown = document.querySelector("#countdown");
  if (availability.countdownTarget) { const milliseconds = Math.max(0, availability.countdownTarget - serverTimestamp()); const hours = Math.floor(milliseconds / 3_600_000); const minutes = Math.floor((milliseconds % 3_600_000) / 60_000); countdown.textContent = availability.phase === "upcoming" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : availability.phase === "open" ? `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。` : "报名已截止。"; } else countdown.textContent = availability.phase === "closed" ? "此活动目前未开放报名。" : "报名时间以服务器时间为准。";
  const reviewButton = document.querySelector("#review-registration"); if (reviewButton) reviewButton.disabled = !availability.canRegister;
  if (availability.countdownTarget && availability.phase !== "closed") window.setTimeout(() => setRegistrationEnabled(event), Math.min(30_000, Math.max(250, availability.countdownTarget - serverTimestamp() + 1)));
  return availability;
}

function validateReview(event, request) { return validateRegistrationDraft(event, request.sessionIds, request.seatChoices[0], request.answers, serverTimestamp()); }

async function initialise() {
  const eventId = selectedEventId(); const result = eventId ? await getEvent(eventId) : { ok: false, message: "未指定活动。" };
  if (!result.ok || !result.data?.event) { document.querySelector("#registration-content").hidden = true; const closed = document.querySelector("#registration-closed"); closed.hidden = false; closed.textContent = result.message || "暂时无法加载活动，请返回活动列表重试。"; return; }
  const timestamp = Date.parse(result.data.serverNow); state.serverOffset = Number.isFinite(timestamp) ? timestamp - Date.now() : Number.NaN; state.event = result.data.event;
  document.querySelector("#event-meta").textContent = state.event.title; renderSessionChoices(state.event); renderSeatOptions(state.event); renderQuestions(state.event); setRegistrationEnabled(state.event);
  form.addEventListener("submit", (submitEvent) => { submitEvent.preventDefault(); const request = { eventId: state.event.id, sessionIds: [...state.selectedSessions], seatChoices: [...state.seatChoices], answers: collectAnswers(state.event) }; const validation = validateReview(state.event, request); showErrors(validation.errors); if (validation.valid) showReview(state.event, request); });
  document.querySelector("#edit-registration").addEventListener("click", () => { state.review = null; document.querySelector("#review-card").hidden = true; form.hidden = false; form.querySelector("input, textarea, select")?.focus(); });
  document.querySelector("#final-submit").addEventListener("click", async () => { if (!state.review) return; const validation = validateReview(state.event, state.review); showErrors(validation.errors); if (!validation.valid) { document.querySelector("#edit-registration").click(); return; } const button = document.querySelector("#final-submit"); button.disabled = true; button.textContent = "正在提交…"; const result = await createRegistration(state.review); if (result.ok) renderSuccess(result); else { showErrors([result.message]); button.disabled = false; button.textContent = "06 · 确认提交报名"; } });
}

initialise();
