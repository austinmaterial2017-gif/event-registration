import { getEventCapability, validateAnswers, validateSelection } from "./domain.js";

const serverNow = "2026-07-26T10:00:00+08:00";
const demoEvents = {
  "night-of-ideas": {
    id: "night-of-ideas", title: "夜航：创作、城市与不眠", status: "open", closesAt: "2026-08-15T20:00:00+08:00", selectionMode: "mixed", minChoices: 2, maxChoices: 3, seatMode: "self",
    sessions: [
      { id: "opening", title: "开场：把城市写进身体", speaker: "林青", startsAt: "2026-08-16T10:00:00+08:00", endsAt: "2026-08-16T10:40:00+08:00", required: true },
      { id: "making", title: "工作坊：用限制创造", speaker: "阿南", startsAt: "2026-08-16T11:00:00+08:00", endsAt: "2026-08-16T12:20:00+08:00", required: false },
      { id: "listening", title: "对谈：听见陌生人的故事", speaker: "周薇 × 李远", startsAt: "2026-08-16T11:00:00+08:00", endsAt: "2026-08-16T12:00:00+08:00", required: false },
      { id: "closing", title: "闭幕分享", speaker: "全体讲者", startsAt: "2026-08-16T16:30:00+08:00", endsAt: "2026-08-16T17:10:00+08:00", required: false }
    ],
    seats: ["A-01", "A-02", "A-03", "B-01", "B-02", "B-03"],
    fields: [
      { id: "name", label: "你的姓名", type: "text", required: true, autocomplete: "name" },
      { id: "email", label: "电子邮箱", type: "email", required: true, autocomplete: "email" },
      { id: "phone", label: "联系电话", type: "tel", required: false, autocomplete: "tel" },
      { id: "birthDate", label: "出生日期", type: "date", required: false },
      { id: "tickets", label: "同行人数", type: "number", required: false, min: 0 },
      { id: "bio", label: "想带来的一句话", type: "textarea", required: false },
      { id: "role", label: "你的参与身份", type: "radio", required: true, options: ["观众", "创作者", "学生"] },
      { id: "interests", label: "你关心的话题", type: "checkbox", required: false, options: ["写作", "影像", "城市", "音乐"] },
      { id: "source", label: "从哪里得知活动", type: "select", required: false, options: ["朋友推荐", "社交媒体", "微光现场", "其他"] },
      { id: "agreement", label: "我同意报名须知与现场影像记录", type: "boolean", required: true }
    ]
  }
};
const fallbackEvent = { ...demoEvents["night-of-ideas"], status: "closed", title: "该活动目前不可报名" };
const form = document.querySelector("#registration-form");
const state = { selectedSessions: new Set(), seat: null };

function selectedEvent() {
  const eventId = new URLSearchParams(window.location.search).get("event");
  return demoEvents[eventId] || fallbackEvent;
}

function fieldLabel(field) {
  return `${field.label} ${field.required ? '<span class="required-mark" aria-label="必填">*</span>' : '<span class="optional-mark">（选填）</span>'}`;
}

function renderSessionChoices(event) {
  const fieldset = document.querySelector("#session-options");
  document.querySelector("#selection-note").textContent = event.selectionMode === "all" ? "以下场次均为必选。" : event.selectionMode === "free" ? `自由选择，最多可选 ${event.maxChoices} 场。` : `含必选与选修场次，请选择 ${event.minChoices} 至 ${event.maxChoices} 场。`;
  fieldset.innerHTML = `<legend class="sr-only">选择活动场次</legend>${event.sessions.map((session) => {
    const mandatory = event.selectionMode === "all" || session.required;
    return `<label class="choice"><input type="checkbox" name="sessions" value="${session.id}" ${mandatory ? "checked disabled" : ""}><span><strong>${session.title}${mandatory ? " · 必选" : ""}</strong><small>${session.speaker} · ${new Date(session.startsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}–${new Date(session.endsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span></label>`;
  }).join("")}`;
  event.sessions.filter((session) => event.selectionMode === "all" || session.required).forEach((session) => state.selectedSessions.add(session.id));
  fieldset.addEventListener("change", (inputEvent) => {
    const input = inputEvent.target;
    if (input.name !== "sessions") return;
    input.checked ? state.selectedSessions.add(input.value) : state.selectedSessions.delete(input.value);
  });
}

function renderSeatOptions(event) {
  const holder = document.querySelector("#seat-options");
  const content = {
    none: "<p class=\"helper\">本活动不安排固定座位，现场自由入座。</p>",
    auto: "<p class=\"helper\">提交后将由系统为你自动分配座位。</p>",
    self: `<div class="choice-grid">${event.seats.map((seat) => `<label class="seat-choice"><input type="radio" name="seat" value="${seat}"><span>${seat}</span></label>`).join("")}</div>`,
    zone: "<label class=\"question\">区域<select name=\"seat-zone\"><option value=\"\">请选择区域</option><option>前区</option><option>中区</option><option>无障碍座位区</option></select></label>"
  };
  holder.innerHTML = content[event.seatMode] || content.none;
  holder.addEventListener("change", (inputEvent) => { state.seat = inputEvent.target.value || null; });
}

function renderQuestion(field) {
  const required = field.required ? " required" : "";
  const base = `<label for="field-${field.id}">${fieldLabel(field)}</label>`;
  if (["text", "number", "tel", "email", "date"].includes(field.type)) return `<div class="question" data-field-type="${field.type}">${base}<input id="field-${field.id}" name="${field.id}" type="${field.type}"${required}${field.autocomplete ? ` autocomplete="${field.autocomplete}"` : ""}${field.min !== undefined ? ` min="${field.min}"` : ""}></div>`;
  if (field.type === "textarea") return `<div class="question" data-field-type="textarea">${base}<textarea id="field-${field.id}" name="${field.id}"${required}></textarea></div>`;
  if (field.type === "select") return `<div class="question" data-field-type="select">${base}<select id="field-${field.id}" name="${field.id}"${required}><option value="">请选择</option>${field.options.map((option) => `<option value="${option}">${option}</option>`).join("")}</select></div>`;
  if (field.type === "boolean") return `<div class="question" data-field-type="boolean"><label class="inline-options"><input id="field-${field.id}" name="${field.id}" type="checkbox" value="true"${required}>${fieldLabel(field)}</label></div>`;
  const inputType = field.type === "radio" ? "radio" : "checkbox";
  return `<fieldset class="question" data-field-type="${field.type}"><legend>${fieldLabel(field)}</legend><div class="inline-options">${field.options.map((option) => `<label><input name="${field.id}" type="${inputType}" value="${option}"${required}>${option}</label>`).join("")}</div></fieldset>`;
}

function renderQuestions(event) {
  document.querySelector("#dynamic-questions").innerHTML = event.fields.map(renderQuestion).join("");
}

function collectAnswers(event) {
  const answers = {};
  for (const field of event.fields) {
    const controls = [...form.querySelectorAll(`[name="${field.id}"]`)];
    if (field.type === "checkbox") answers[field.id] = controls.filter((control) => control.checked).map((control) => control.value);
    else if (field.type === "boolean") answers[field.id] = controls[0]?.checked === true;
    else answers[field.id] = controls.find((control) => control.checked || control.type !== "radio")?.value ?? "";
  }
  return answers;
}

function showErrors(messages) {
  const summary = document.querySelector("#error-summary");
  if (messages.length === 0) { summary.hidden = true; summary.replaceChildren(); return; }
  summary.hidden = false;
  summary.innerHTML = `<strong>请先处理以下问题：</strong><ul>${messages.map((message) => `<li>${message}</li>`).join("")}</ul>`;
  summary.focus();
}

function startCountdown(event) {
  const element = document.querySelector("#countdown");
  const closeTime = Date.parse(event.closesAt);
  const offset = Date.parse(serverNow) - Date.now();
  const refresh = () => {
    const milliseconds = closeTime - (Date.now() + offset);
    if (milliseconds <= 0) { element.textContent = "报名已截止。"; return; }
    const hours = Math.floor(milliseconds / 3_600_000); const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
    element.textContent = `报名将在 ${hours} 小时 ${minutes} 分钟后截止（以服务器时间为准）。`;
    window.setTimeout(refresh, 30_000);
  };
  refresh();
}

/** @typedef {{eventId:string, sessionIds:string[], seat:string|null, answers:object}} RegistrationRequest */
async function demoRegistrationAdapter(request) {
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  return { registrationId: `MW-${request.eventId}-${Date.now().toString().slice(-6)}` };
}

async function submitRegistration(request) {
  const api = window.registrationApi?.submitRegistration || demoRegistrationAdapter;
  return api(request);
}

function initialise() {
  const event = selectedEvent();
  const capability = getEventCapability(event.status);
  document.querySelector("#event-meta").textContent = event.title;
  if (!capability.canRegister) {
    document.querySelector("#registration-content").hidden = true;
    const closed = document.querySelector("#registration-closed"); closed.hidden = false; closed.textContent = "此活动目前未开放报名。请返回活动列表选择其他活动。";
    return;
  }
  renderSessionChoices(event); renderSeatOptions(event); renderQuestions(event); startCountdown(event);
  form.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const selection = validateSelection(event, event.sessions, [...state.selectedSessions]);
    const answers = collectAnswers(event);
    const answerValidation = validateAnswers(event.fields, answers);
    const messages = [...selection.errors, ...Object.values(answerValidation.errors)];
    if (event.seatMode === "self" && !state.seat) messages.push("请选择座位。");
    if (event.seatMode === "zone" && !state.seat) messages.push("请选择座位区域。");
    showErrors(messages);
    if (messages.length) return;
    const button = document.querySelector("#submit-registration"); button.disabled = true; button.textContent = "正在提交…";
    try {
      const result = await submitRegistration({ eventId: event.id, sessionIds: [...state.selectedSessions], seat: event.seat, answers });
      form.replaceWith(Object.assign(document.createElement("section"), { className: "success-card form-card", innerHTML: `<p class="eyebrow">REGISTRATION COMPLETE</p><h2>你的位置已经留好。</h2><p>报名编号：${result.registrationId}。电子凭证将发送到你的邮箱。</p><a class="primary-button" href="index.html">查看其他活动</a>` }));
    } catch (error) { showErrors(["提交暂时失败，请稍后重试。"]); button.disabled = false; button.textContent = "确认并提交报名"; }
  });
}

initialise();
