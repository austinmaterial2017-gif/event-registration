import { getBundlePlan, createBundleRegistration } from "./api.js";
import { validateBundleSelection } from "./bundle-flow.js";
import { answerMetadataForFiles, serializePhotoFiles, validatePhotoFiles } from "./photo-answers.js";

const form = document.querySelector("#bundle-form");
const events = document.querySelector("#bundle-events");
const fieldsHolder = document.querySelector("#bundle-fields");
const fieldsSection = document.querySelector("#bundle-fields-section");
const total = document.querySelector("#bundle-total");
const error = document.querySelector("#bundle-error");
const loading = document.querySelector("#bundle-loading");
const button = document.querySelector("#bundle-submit");
const planId = new URLSearchParams(location.search).get("plan") || "";
let plan = null;
let rules = [];
let fields = [];
const photoFiles = new Map();

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function showError(message = "") {
  error.hidden = !message;
  error.textContent = message;
  if (message) error.focus();
}

function selected() {
  return [...events.querySelectorAll("input:checked")].map((input) => input.value);
}

function renderTotal() {
  const result = validateBundleSelection({ rules, selectedEventIds: selected(), totalTicketLimit: plan.totalTicketLimit });
  total.textContent = `已选 ${result.totalTickets} / ${plan.totalTicketLimit} 张票`;
  if (result.error) showError(result.error); else showError("");
  button.disabled = !result.ok || !result.selectedEventIds.length;
  return result;
}

function ruleStatusText(rule) {
  if (rule.status === "full") return "名额已满";
  if (rule.status === "not_open") return "尚未开放";
  if (rule.status === "closed") return "报名已截止";
  return `固定 ${rule.fixedTicketCount} 张`;
}

function answerForField(field) {
  const controls = [...form.elements].filter((control) => control.name === field.id);
  if (field.type === "photo") return answerMetadataForFiles(photoFiles.get(field.id));
  if (field.type === "checkbox") return controls.filter((control) => control.checked).map((control) => control.value);
  if (field.type === "radio") return controls.find((control) => control.checked)?.value || "";
  return controls[0]?.value || "";
}

function renderPhotoSelection(wrapper, field, input) {
  let list = wrapper.querySelector(".photo-selection");
  if (!list) { list = node("div", "photo-selection"); wrapper.append(list); }
  list.replaceChildren();
  const files = photoFiles.get(field.id) || [];
  if (!files.length) { list.append(node("p", "helper", "尚未选择照片。")); return; }
  for (const [index, file] of files.entries()) {
    const row = node("div", "photo-selection-row");
    const remove = node("button", "secondary-button remove-photo", "删除");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const next = [...(photoFiles.get(field.id) || [])];
      next.splice(index, 1); photoFiles.set(field.id, next); input.value = "";
      renderPhotoSelection(wrapper, field, input); showError("");
    });
    row.append(node("span", "", `${file.name} · ${Math.max(1, Math.ceil(file.size / 1024))}KB`), remove);
    list.append(row);
  }
}

function appendLabel(wrapper, field, controlId) {
  const label = node("label"); label.htmlFor = controlId;
  label.append(document.createTextNode(field.label));
  label.append(node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）"));
  wrapper.append(label);
}

function renderFields() {
  fieldsHolder.replaceChildren(); fieldsSection.hidden = !fields.length;
  for (const field of fields) {
    const type = String(field.type || "text").toLowerCase();
    const wrapper = type === "radio" || type === "checkbox" ? document.createElement("fieldset") : node("div", "question");
    wrapper.classList.add("question");
    const controlId = `bundle-field-${field.id}`;
    if (type === "radio" || type === "checkbox") {
      const legend = node("legend", "", field.label);
      legend.append(node("span", field.required ? "required-mark" : "optional-mark", field.required ? " *" : "（选填）"));
      wrapper.append(legend);
      const options = node("div", "inline-options");
      for (const choice of field.options || []) {
        const label = node("label"); const input = document.createElement("input");
        input.type = type; input.name = field.id; input.value = choice;
        label.append(input, document.createTextNode(choice)); options.append(label);
      }
      wrapper.append(options);
    } else {
      const control = document.createElement(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
      control.id = controlId; control.name = field.id; appendLabel(wrapper, field, controlId);
      if (type === "select") {
        control.append(new Option("请选择", ""));
        for (const choice of field.options || []) control.append(new Option(choice, choice));
      } else if (type === "photo") {
        const upload = field.upload || {};
        control.type = "file";
        control.accept = (upload.accept || ["image/jpeg", "image/png", "image/heic", "image/heif"]).join(",");
        control.multiple = Math.max(1, Number(upload.maxFiles) || 1) > 1;
        control.addEventListener("change", () => {
          const files = Array.from(control.files || []); const errors = validatePhotoFiles(field, files);
          if (errors.length) { control.value = ""; photoFiles.set(field.id, []); showError(errors[0]); return; }
          photoFiles.set(field.id, files); renderPhotoSelection(wrapper, field, control); showError("");
        });
        renderPhotoSelection(wrapper, field, control);
      } else {
        control.type = ["number", "tel", "email", "date"].includes(type) ? type : "text";
        control.placeholder = "请填写";
      }
      if (type !== "photo") control.required = field.required === true;
      wrapper.append(control);
    }
    fieldsHolder.append(wrapper);
  }
}

function validateFields() {
  for (const field of fields) {
    const value = answerForField(field);
    const missing = Array.isArray(value) ? value.length === 0 : !String(value || "").trim();
    if (field.required && missing) return `请填写：${field.label}`;
  }
  return "";
}

async function load() {
  const timers = [
    window.setTimeout(() => { if (!loading.hidden) loading.textContent = "服务器正在唤醒，请稍候…"; }, 3500),
    window.setTimeout(() => { if (!loading.hidden) loading.textContent = "仍在读取组合活动资料，请不要重复刷新…"; }, 9000)
  ];
  if (!planId) { timers.forEach(window.clearTimeout); loading.hidden = true; showError("缺少组合计划链接。"); return; }
  let result;
  try { result = await getBundlePlan(planId); } catch (_error) { result = { ok: false, message: "网络连接异常，请检查网络后重试。" }; }
  timers.forEach(window.clearTimeout); loading.hidden = true;
  if (!result.ok) { showError(result.message); return; }
  plan = result.data.plan;
  rules = result.data.items?.length ? result.data.items : (result.data.rules || []);
  fields = Array.isArray(result.data.fields) ? result.data.fields : [];
  document.querySelector("#bundle-title").textContent = plan.title;
  document.querySelector("#bundle-description").textContent = plan.description;
  events.replaceChildren(...rules.map((rule) => {
    const label = document.createElement("label"); const input = document.createElement("input");
    input.type = "checkbox"; input.value = rule.itemId || rule.eventId; input.disabled = rule.available === false;
    input.addEventListener("change", renderTotal);
    label.append(input, document.createTextNode(`${rule.title || rule.itemId || rule.eventId} · ${ruleStatusText(rule)}`));
    if (input.disabled) label.classList.add("is-unavailable");
    return label;
  }));
  renderFields(); form.hidden = false; renderTotal();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selection = renderTotal(); if (!selection.ok) return;
  const fieldError = validateFields(); if (fieldError) { showError(fieldError); return; }
  button.disabled = true;
  button.textContent = [...photoFiles.values()].some((files) => files.length) ? "正在上传照片并生成电子凭证…" : "正在生成电子凭证…";
  let result;
  try {
    result = await createBundleRegistration({
      planId, itemIds: selection.selectedEventIds,
      answers: Object.fromEntries(fields.map((field) => [field.id, answerForField(field)])),
      uploads: await serializePhotoFiles(Object.fromEntries(photoFiles))
    });
  } catch (_error) {
    button.disabled = false; button.textContent = "核对并生成电子凭证";
    showError("照片读取失败，请重新选择后再试。"); return;
  }
  if (result.ok) {
    button.textContent = "报名成功，正在打开电子凭证…";
    location.assign(`bundle-ticket.html?t=${encodeURIComponent(result.data.token)}`); return;
  }
  button.disabled = false; button.textContent = "核对并生成电子凭证"; showError(result.message);
});

load();
