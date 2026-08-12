import { PHONE_CHECKIN_WEB_APP_URL } from "./phone-checkin-config.js";

const codeInput = document.querySelector("#staff-code");
const unlockButton = document.querySelector("#unlock");
const eventSelect = document.querySelector("#event");
const sessionSelect = document.querySelector("#session");
const checkpointSelect = document.querySelector("#checkpoint");
const startButton = document.querySelector("#start");
const video = document.querySelector("#camera");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const resultText = result.querySelector("strong");

let staffSession = sessionStorage.getItem("phone-checkin-session") || "";
let targets = [];
let reader = null;
let controls = null;
let busy = false;
let lastTicket = "";
let lastTicketAt = 0;

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    const callback = `phoneCheckInCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const timer = window.setTimeout(fail, 15000);
    const query = new URLSearchParams({ ...params, callback });
    function clean() { window.clearTimeout(timer); delete window[callback]; script.remove(); }
    function fail() { clean(); reject(new Error("network")); }
    window[callback] = (payload) => { clean(); resolve(payload); };
    script.onerror = fail;
    script.src = `${PHONE_CHECKIN_WEB_APP_URL}?${query.toString()}`;
    document.head.append(script);
  });
}

function options(select, list, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  list.forEach((item) => select.add(new Option(item.label, item.value)));
}

function currentEvent() { return targets.find((item) => item.eventId === eventSelect.value); }
function currentSession() { return currentEvent()?.sessions.find((item) => item.sessionId === sessionSelect.value); }

function fillEvents() {
  options(eventSelect, targets.map((item) => ({ value: item.eventId, label: item.title })), "请选择活动");
  eventSelect.disabled = false;
  fillSessions();
}

function fillSessions() {
  const sessions = currentEvent()?.sessions || [];
  options(sessionSelect, sessions.map((item) => ({
    value: item.sessionId,
    label: [item.title, item.speaker].filter(Boolean).join(" · ")
  })), "请选择讲座／老师");
  sessionSelect.disabled = sessions.length === 0;
  options(checkpointSelect, [], "请先选择讲座／老师");
  checkpointSelect.disabled = true;
  startButton.disabled = true;
}

function fillCheckpoints() {
  const session = currentSession();
  if (!session) return;
  const list = session.mode === "automatic"
    ? [{ value: "auto", label: "自动签到下一次" }]
    : (session.checkpoints || []).map((item) => ({ value: item.id, label: item.label }));
  options(checkpointSelect, list, "请选择签到次数");
  checkpointSelect.disabled = list.length === 0;
  startButton.disabled = true;
}

function showResult(message, ok) {
  resultText.textContent = message;
  result.className = `visible ${ok ? "success" : "error"}`;
  window.setTimeout(() => { result.className = ""; }, ok ? 900 : 1400);
}

function ticketValue(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 4096) return "";
  return text;
}

async function unlock() {
  const code = codeInput.value.trim();
  if (!code) { setStatus("请输入工作人员密码。", true); return; }
  unlockButton.disabled = true;
  setStatus("正在读取签到活动…");
  try {
    const started = await jsonp({ action: "start", code });
    if (!started?.ok) throw new Error(started?.message || "denied");
    staffSession = started.data.session;
    sessionStorage.setItem("phone-checkin-session", staffSession);
    const loaded = await jsonp({ action: "targets", session: staffSession });
    if (!loaded?.ok || !(loaded.data?.events || []).length) throw new Error(loaded?.message || "empty");
    targets = loaded.data.events;
    fillEvents();
    setStatus("请选择活动、讲座／老师和签到次数。", false);
  } catch (error) {
    staffSession = "";
    sessionStorage.removeItem("phone-checkin-session");
    setStatus(error.message || "无法读取签到活动，请检查密码或网络。", true);
  } finally { unlockButton.disabled = false; }
}

async function recordScan(rawValue) {
  const ticket = ticketValue(rawValue);
  if (!ticket || busy) return;
  const now = Date.now();
  if (ticket === lastTicket && now - lastTicketAt < 1500) return;
  busy = true;
  lastTicket = ticket;
  lastTicketAt = now;
  try {
    const response = await jsonp({
      action: "checkin", session: staffSession, ticket,
      eventId: eventSelect.value, sessionId: sessionSelect.value,
      checkpointId: checkpointSelect.value === "auto" ? "" : checkpointSelect.value
    });
    const message = response?.ok
      ? `${response.data.name || "参与者"}：${response.data.checkpointLabel || "签到成功"}`
      : (response?.message || "本票无法签到。");
    showResult(message, Boolean(response?.ok));
    setStatus(response?.ok ? "签到成功，请继续扫下一位。" : message, !response?.ok);
  } catch {
    showResult("网络未完成，请再试一次。", false);
    setStatus("网络未完成，请继续扫描或检查网络。", true);
  } finally {
    window.setTimeout(() => { busy = false; }, 1050);
  }
}

async function startCamera() {
  if (!staffSession || !eventSelect.value || !sessionSelect.value || !checkpointSelect.value) return;
  if (!window.ZXingBrowser?.BrowserQRCodeReader) {
    setStatus("扫码组件未载入，请检查网络后刷新页面。", true); return;
  }
  startButton.disabled = true;
  setStatus("正在打开手机相机…");
  try {
    controls?.stop?.();
    reader?.reset?.();
    reader = new window.ZXingBrowser.BrowserQRCodeReader();
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: "environment" } }, audio: false },
      video,
      (scan) => {
        const text = scan && (typeof scan.getText === "function" ? scan.getText() : scan.text);
        if (text) void recordScan(text);
      }
    );
    setStatus("相机已开启，请连续扫描参与者电子票 QR 码。");
  } catch {
    startButton.disabled = false;
    setStatus("无法打开相机。请在 Safari／Chrome 的网站权限允许相机，再按一次开始连续扫码。", true);
  }
}

unlockButton.addEventListener("click", unlock);
eventSelect.addEventListener("change", fillSessions);
sessionSelect.addEventListener("change", fillCheckpoints);
checkpointSelect.addEventListener("change", () => { startButton.disabled = !checkpointSelect.value; });
startButton.addEventListener("click", startCamera);
window.addEventListener("pagehide", () => controls?.stop?.());
