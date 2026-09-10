import { getBundlePlan, createBundleRegistration } from "./api.js";
import { validateBundleSelection } from "./bundle-flow.js";
import { serializePhotoFiles, validatePhotoFiles } from "./photo-answers.js";

const form = document.querySelector("#bundle-form");
const events = document.querySelector("#bundle-events");
const total = document.querySelector("#bundle-total");
const error = document.querySelector("#bundle-error");
const button = document.querySelector("#bundle-submit");
const planId = new URLSearchParams(location.search).get("plan") || "";
let plan = null;
let rules = [];
let photoFiles = [];

function showError(message = "") {
  error.hidden = !message;
  error.textContent = message;
}

function selected() {
  return [...events.querySelectorAll("input:checked")].map((input) => input.value);
}

function renderTotal() {
  const result = validateBundleSelection({ rules, selectedEventIds: selected(), totalTicketLimit: plan.totalTicketLimit });
  total.textContent = `已选 ${result.totalTickets} / ${plan.totalTicketLimit} 张票`;
  showError(result.error);
  button.disabled = !result.ok || !result.selectedEventIds.length;
  return result;
}

function ruleStatusText(rule) {
  if (rule.status === "full") return "名额已满";
  if (rule.status === "not_open") return "尚未开放";
  if (rule.status === "closed") return "报名已截止";
  return `固定 ${rule.fixedTicketCount} 张`;
}

async function load() {
  if (!planId) { showError("缺少组合计划链接。"); return; }
  const result = await getBundlePlan(planId);
  if (!result.ok) { showError(result.message); return; }
  plan = result.data.plan;
  rules = result.data.items?.length ? result.data.items : (result.data.rules || []);
  document.querySelector("#bundle-title").textContent = plan.title;
  document.querySelector("#bundle-description").textContent = plan.description;
  events.replaceChildren(...rules.map((rule) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = rule.itemId || rule.eventId;
    input.disabled = rule.available === false;
    input.addEventListener("change", renderTotal);
    label.append(input, document.createTextNode(`${rule.title || rule.itemId || rule.eventId} · ${ruleStatusText(rule)}`));
    if (input.disabled) label.classList.add("is-unavailable");
    return label;
  }));
  renderTotal();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selection = renderTotal();
  if (!selection.ok) return;
  button.disabled = true;
  button.textContent = "正在生成电子凭证…";
  let result;
  try {
    result = await createBundleRegistration({
      planId, itemIds: selection.selectedEventIds,
      answers: { name: form.elements.name.value, phone: form.elements.phone.value },
      uploads: await serializePhotoFiles({ photo: photoFiles })
    });
  } catch (_error) {
    button.disabled = false;
    button.textContent = "核对并生成电子凭证";
    showError("照片读取失败，请重新选择后再试。");
    return;
  }
  if (result.ok) {
    location.assign(`bundle-ticket.html?t=${encodeURIComponent(result.data.token)}`);
    return;
  }
  button.disabled = false;
  button.textContent = "核对并生成电子凭证";
  showError(result.message);
});

const photoInput = form.elements.photo;
photoInput.addEventListener("change", () => {
  const field = {
    label: "付款证明／相关照片（如需要）",
    upload: { maxFiles: 3, maxBytes: 5 * 1024 * 1024, accept: ["image/jpeg", "image/png", "image/heic", "image/heif"] }
  };
  const errors = validatePhotoFiles(field, photoInput.files);
  if (errors.length) {
    photoFiles = [];
    photoInput.value = "";
    showError(errors[0]);
    return;
  }
  photoFiles = Array.from(photoInput.files || []);
  showError("");
});

load();

