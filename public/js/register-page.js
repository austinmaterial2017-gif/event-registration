import { applyRegistrationGate, getFieldControlSpec, getRegistrationAvailability, getSeatModeState, validateRegistrationDraft } from "./registration-flow.js";

const serverNow = "2026-07-26T10:00:00+08:00";
const demoEvents = {
  "night-of-ideas": {
    id: "night-of-ideas", title: "夜航：创作、城市与不眠", status: "open", opensAt: "2026-07-20T10:00:00+08:00", closesAt: "2026-08-15T20:00:00+08:00", selectionMode: "mixed", minChoices: 2, maxChoices: 3, seatMode: "self",
    sessions: [
      { id: "opening", title: "开场：把城市写进身体", speaker: "林青", startsAt: "2026-08-16T10:00:00+08:00", endsAt: "2026-08-16T10:40:00+08:00", required: true },
      { id: "making", title: "工作坊：用限制创造", speaker: "阿南", startsAt: "2026-08-16T11:00:00+08:00", endsAt: "2026-08-16T12:20:00+08:00", required: false },
      { id: "listening", title: "对谈：听见陌生人的故事", speaker: "周薇 × 李远", startsAt: "2026-08-16T11:00:00+08:00", endsAt: "2026-08-16T12:00:00+08:00", required: false },
      { id: "closing", title: "闭幕分享", speaker: "全体讲者", startsAt: "2026-08-16T16:30:00+08:00", endsAt: "2026-08-16T17:10:00+08:00", required: false }
    ],
    seats: ["A-01", "A-02", "A-03", "B-01", "B-02", "B-03"],
    fields: [
      { id: "name", label: "你的姓名", type: "text", required: true, autocomplete: "name" }, { id: "email", label: "电子邮箱", type: "email", required: true, autocomplete: "email" },
      { id: "phone", label: "联系电话", type: "tel", required: false, autocomplete: "tel" }, { id: "birthDate", label: "出生日期", type: "date", required: false },
      { id: "tickets", label: "同行人数", type: "number", required: false, min: 0 }, { id: "bio", label: "想带来的一句话", type: "textarea", required: false },
      { id: "role", label: "你的参与身份", type: "radio", required: true, options: ["观众", "创作者", "学生"] }, { id: "interests", label: "你关心的话题", type: "checkbox", required: false, options: ["写作", "影像", "城市", "音乐"] },
      { id: "source", label: "从哪里得知活动", type: "select", required: false, options: ["朋友推荐", "社交媒体", "微光现场", "其他"] }, { id: "agreement", label: "我同意报名须知与现场影像记录", type: "boolean", required: true }
    ]
  }
};
const fallbackEvent = { ...demoEvents["night-of-ideas"], status: "closed", title: "该活动目前不可报名" };
const form = document.querySelector("#registration-form");
const state = { selectedSessions: new Set(), seat: null, review: null };
const serverOffset = Date.parse(serverNow) - Date.now();

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function selectedEvent() { return demoEvents[new URLSearchParams(window.location.search).get("event")] || fallbackEvent; }
function serverTimestamp() { return Date.now() + serverOffset; }

function appendFieldLabel(container, field, controlId) {
  const label = node("label"); label.htmlFor = controlId; label.append(document.createTextNode(field.label));
  const marker = node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）");
  marker.setAttribute("aria-label", field.required ? "必填" : "选填"); label.append(marker); container.append(label);
}

function renderSessionChoices(event) {
  const fieldset = document.querySelector("#session-options");
  fieldset.replaceChildren(node("legend", "sr-only", "选择活动场次"));
  document.querySelector("#selection-note").textContent = event.selectionMode === "all" ? "以下场次均为必选。" : event.selectionMode === "free" ? `自由选择，最多可选 ${event.maxChoices} 场。` : `含必选与选修场次，请选择 ${event.minChoices} 至 ${event.maxChoices} 场。`;
  for (const session of event.sessions) {
    const mandatory = event.selectionMode === "all" || session.required;
    const label = node("label", "choice"); const input = document.createElement("input"); input.type = "checkbox"; input.name = "sessions"; input.value = session.id; input.checked = mandatory; input.disabled = mandatory; if (mandatory) input.dataset.intrinsicDisabled = "true";
    const copy = node("span"); const heading = node("strong", "", `${session.title}${mandatory ? " · 必选" : ""}`); const time = node("small", "", `${session.speaker} · ${new Date(session.startsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}–${new Date(session.endsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    copy.append(heading, time); label.append(input, copy); fieldset.append(label);
    if (mandatory) state.selectedSessions.add(session.id);
  }
  fieldset.addEventListener("change", ({ target }) => { if (target.name === "sessions") target.checked ? state.selectedSessions.add(target.value) : state.selectedSessions.delete(target.value); });
}

function renderSeatOptions(event) {
  const holder = document.querySelector("#seat-options"); holder.replaceChildren();
  const seatState = getSeatModeState(event.seatMode);
  if (seatState.mode === "none" || seatState.mode === "auto") { holder.append(node("p", "helper", seatState.mode === "none" ? "本活动不安排固定座位，现场自由入座。" : "提交后将由系统为你自动分配座位。")); return; }
  if (seatState.mode === "zone") {
    const group = node("div", "question"); const select = document.createElement("select"); select.name = "seat-zone"; select.id = "seat-zone";
    appendFieldLabel(group, { label: "区域", required: true }, select.id); select.append(node("option", "", "请选择区域")); select.options[0].value = "";
    for (const zone of ["前区", "中区", "无障碍座位区"]) { const option = node("option", "", zone); option.value = zone; select.append(option); }
    select.addEventListener("change", () => { state.seat = select.value || null; }); group.append(select); holder.append(group); return;
  }
  const grid = node("div", "choice-grid");
  for (const seat of event.seats || []) { const label = node("label", "seat-choice"); const input = document.createElement("input"); input.type = "radio"; input.name = "seat"; input.value = seat; input.addEventListener("change", () => { state.seat = input.value; }); label.append(input, node("span", "", seat)); grid.append(label); }
  holder.append(grid);
}

function renderQuestions(event) {
  const holder = document.querySelector("#dynamic-questions"); holder.replaceChildren();
  for (const field of event.fields) {
    const controlSpec = getFieldControlSpec(field.type);
    const wrapper = field.type === "radio" || field.type === "checkbox" ? document.createElement("fieldset") : node("div"); wrapper.className = "question"; wrapper.dataset.fieldType = field.type;
    const controlId = `field-${field.id}`;
    if (field.type === "radio" || field.type === "checkbox") {
      const legend = node("legend", "", field.label); const marker = node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）"); legend.append(marker); wrapper.append(legend);
      const options = node("div", "inline-options"); for (const value of field.options || []) { const label = node("label"); const input = document.createElement("input"); input.type = field.type; input.name = field.id; input.value = value; input.required = field.required; label.append(input, document.createTextNode(value)); options.append(label); } wrapper.append(options);
    } else if (field.type === "boolean") {
      const label = node("label", "inline-options"); const input = document.createElement("input"); input.id = controlId; input.name = field.id; input.type = "checkbox"; input.value = "true"; input.required = field.required; label.append(input, document.createTextNode(field.label)); const marker = node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）"); label.append(marker); wrapper.append(label);
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
  for (const field of event.fields) {
    const controls = [...form.elements].filter((control) => control.name === field.id);
    if (field.type === "checkbox") answers[field.id] = controls.filter((control) => control.checked).map((control) => control.value);
    else if (field.type === "boolean") answers[field.id] = controls[0]?.checked === true;
    else answers[field.id] = controls.find((control) => control.checked || control.type !== "radio")?.value ?? "";
  }
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
  const rows = [["已选场次", sessionNames], ["座位", request.seat || getSeatModeState(event.seatMode).label], ...event.fields.map((field) => {
    const value = request.answers[field.id]; return [field.label, Array.isArray(value) ? value.join("、") : value === true ? "已同意" : value || "未填写"];
  })];
  for (const [label, value] of rows) { const list = document.createElement("dl"); list.append(node("dt", "", label), node("dd", "", value)); details.append(list); }
  state.review = request; form.hidden = true; const card = document.querySelector("#review-card"); card.hidden = false; card.focus();
}

function renderSuccess(result) {
  const section = node("section", "success-card form-card"); section.append(node("p", "eyebrow", "REGISTRATION COMPLETE"), node("h2", "", "你的位置已经留好。"), node("p", "", `报名编号：${result.registrationId}。电子凭证将发送到你的邮箱。`));
  const link = node("a", "primary-button", "查看其他活动"); link.href = "index.html"; section.append(link); document.querySelector("#review-card").replaceWith(section);
}

function setRegistrationEnabled(event) {
  const now = serverTimestamp(); const availability = applyRegistrationGate(event, now, form.querySelectorAll("input, textarea, select, button")); const countdown = document.querySelector("#countdown");
  if (availability.countdownTarget) {
    const milliseconds = Math.max(0, availability.countdownTarget - serverTimestamp()); const hours = Math.floor(milliseconds / 3_600_000); const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    countdown.textContent = availability.phase === "upcoming" ? `报名将在 ${hours} 小时 ${minutes} 分钟后开放（以服务器时间为准）。` : availability.phase === "open" ? `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。` : "报名已截止。";
  } else countdown.textContent = availability.phase === "closed" ? "此活动目前未开放报名。" : "报名时间以服务器时间为准。";
  const reviewButton = document.querySelector("#final-submit"); if (reviewButton) reviewButton.disabled = !availability.canRegister;
  if (availability.countdownTarget && availability.phase !== "closed") window.setTimeout(() => setRegistrationEnabled(event), Math.min(30_000, Math.max(250, availability.countdownTarget - serverTimestamp() + 1)));
  return availability;
}

/** @typedef {{eventId:string, sessionIds:string[], seat:string|null, answers:object}} RegistrationRequest */
async function demoRegistrationAdapter(request) { await new Promise((resolve) => window.setTimeout(resolve, 350)); return { registrationId: `MW-${request.eventId}-${Date.now().toString().slice(-6)}` }; }
async function submitRegistration(request) { return (window.registrationApi?.submitRegistration || demoRegistrationAdapter)(request); }

function initialise() {
  const event = selectedEvent(); document.querySelector("#event-meta").textContent = event.title;
  renderSessionChoices(event); renderSeatOptions(event); renderQuestions(event); setRegistrationEnabled(event);
  form.addEventListener("submit", (submitEvent) => { submitEvent.preventDefault(); const request = { eventId: event.id, sessionIds: [...state.selectedSessions], seat: state.seat, answers: collectAnswers(event) }; const validation = validateRegistrationDraft(event, request.sessionIds, request.seat, request.answers, serverTimestamp()); showErrors(validation.errors); if (validation.valid) showReview(event, request); });
  document.querySelector("#edit-registration").addEventListener("click", () => { state.review = null; document.querySelector("#review-card").hidden = true; form.hidden = false; form.querySelector("input, textarea, select")?.focus(); });
  document.querySelector("#final-submit").addEventListener("click", async () => {
    if (!state.review) return; const validation = validateRegistrationDraft(event, state.review.sessionIds, state.review.seat, state.review.answers, serverTimestamp()); showErrors(validation.errors); if (!validation.valid) { document.querySelector("#edit-registration").click(); return; }
    const button = document.querySelector("#final-submit"); button.disabled = true; button.textContent = "正在提交…";
    try { renderSuccess(await submitRegistration(state.review)); } catch { showErrors(["提交暂时失败，请稍后重试。"]); button.disabled = false; button.textContent = "06 · 确认提交报名"; }
  });
}

initialise();
