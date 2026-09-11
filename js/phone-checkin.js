import { PHONE_CHECKIN_WEB_APP_URL } from "./phone-checkin-config.js";

const codeInput = document.querySelector("#staff-code");
const unlockButton = document.querySelector("#unlock");
const eventSelect = document.querySelector("#event");
const sessionSelect = document.querySelector("#session");
const checkpointSelect = document.querySelector("#checkpoint");
const startButton = document.querySelector("#start");
const qrImageInput = document.querySelector("#qr-image");
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
let progressTimer = 0;
let cameraHintTimer = 0;
let audioContext = null;

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function jsonp(params) {
  // The phone service exposes CORS headers. Fetch is more reliable than a
  // dynamically injected JSONP script on mobile browsers and still keeps the
  // request read-only.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 60_000);
  const query = new URLSearchParams(params);
  return fetch(`${PHONE_CHECKIN_WEB_APP_URL}?${query.toString()}`, {
    method: "GET",
    cache: "no-store",
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok) throw new Error("network");
    return response.json();
  }).finally(() => window.clearTimeout(timer));
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
  window.clearTimeout(progressTimer);
  resultText.textContent = message;
  result.className = `visible ${ok ? "success" : "error"}`;
  // A successful scan needs to stay visible long enough for the worker to
  // confirm it before the camera accepts the next ticket.
  window.setTimeout(() => { result.className = ""; }, ok ? 2200 : 1400);
}

function playTone(frequency = 880, duration = 70) {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration / 1000);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration / 1000);
  } catch {
    // Sound is optional; visible feedback remains available.
  }
}

function showScanningFeedback() {
  resultText.textContent = "已扫到二维码，正在核对报名资料…";
  result.className = "visible processing";
  setStatus("已扫到二维码，正在核对报名资料…");
  navigator.vibrate?.(45);
  playTone();
}

function startProgressFeedback() {
  window.clearTimeout(progressTimer);
  progressTimer = window.setTimeout(() => {
    if (!busy) return;
    resultText.textContent = "资料已找到，正在写入签到记录…";
    setStatus("资料已找到，正在写入签到记录…");
  }, 2300);
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
  setStatus("正在连接签到系统…");
  const wakeTimer = window.setTimeout(() => {
    setStatus("系统正在启动，正在读取活动资料，请不要重复按。");
  }, 3000);
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
  } finally {
    window.clearTimeout(wakeTimer);
    unlockButton.disabled = false;
  }
}

async function readQrImage() {
  const file = qrImageInput.files?.[0];
  if (!file) return;
  if (!staffSession || !eventSelect.value || !sessionSelect.value || !checkpointSelect.value) {
    setStatus("请先选择活动、讲座／老师和签到次数。", true);
    qrImageInput.value = "";
    return;
  }
  if (!window.ZXingBrowser?.BrowserQRCodeReader) {
    setStatus("扫码组件未载入，请检查网络后刷新页面。", true);
    qrImageInput.value = "";
    return;
  }
  setStatus("正在读取电子票 QR 图片…");
  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageUrl;
    });
    const imageReader = new window.ZXingBrowser.BrowserQRCodeReader();
    const scan = await imageReader.decodeFromImageElement(image);
    const text = scan && (typeof scan.getText === "function" ? scan.getText() : scan.text);
    if (!text) throw new Error("empty");
    void recordScan(text);
  } catch {
    showResult("这张图片没有读到 QR 码，请选清楚的电子票截图。", false);
    setStatus("图片未读到 QR 码，请选清楚的电子票截图。", true);
  } finally {
    URL.revokeObjectURL(imageUrl);
    qrImageInput.value = "";
  }
}

async function recordScan(rawValue) {
  const ticket = ticketValue(rawValue);
  if (!ticket || busy) return;
  const now = Date.now();
  if (ticket === lastTicket && now - lastTicketAt < 1500) return;
  busy = true;
  window.clearTimeout(cameraHintTimer);
  let scanSucceeded = false;
  lastTicket = ticket;
  lastTicketAt = now;
  showScanningFeedback();
  startProgressFeedback();
  try {
    const response = await jsonp({
      action: "checkin", session: staffSession, ticket,
      eventId: eventSelect.value, sessionId: sessionSelect.value,
      checkpointId: checkpointSelect.value === "auto" ? "" : checkpointSelect.value
    });
    const message = response?.ok
      ? `${response.data.name || "参与者"}：${response.data.checkpointLabel || "签到成功"}（签到成功）`
      : (response?.message || "本票无法签到。");
    showResult(message, Boolean(response?.ok));
    scanSucceeded = Boolean(response?.ok);
    if (response?.ok) {
      navigator.vibrate?.([55, 35, 55]);
      playTone(1180, 95);
    }
    setStatus(response?.ok ? "签到成功，请继续扫下一位。" : message, !response?.ok);
  } catch {
    showResult("网络未完成，请再试一次。", false);
    setStatus("网络未完成，请继续扫描或检查网络。", true);
  } finally {
    window.setTimeout(() => { busy = false; }, scanSucceeded ? 2250 : 1050);
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
    const hints = new Map();
    const { DecodeHintType, BarcodeFormat } = window.ZXingBrowser;
    if (DecodeHintType?.TRY_HARDER) hints.set(DecodeHintType.TRY_HARDER, true);
    if (DecodeHintType?.POSSIBLE_FORMATS && BarcodeFormat?.QR_CODE) {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    }
    reader = new window.ZXingBrowser.BrowserQRCodeReader(hints, {
      delayBetweenScanAttempts: 55,
      delayBetweenScanSuccess: 250
    });
    controls = await reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      },
      video,
      (scan) => {
        const text = scan && (typeof scan.getText === "function" ? scan.getText() : scan.text);
        if (text) void recordScan(text);
      }
    );
    setStatus("相机已开启，请连续扫描参与者电子票 QR 码。");
    cameraHintTimer = window.setTimeout(() => {
      if (!busy) setStatus("正在识别二维码…请把电子票放大，让 QR 码占画面约一半，并保持清楚、不要反光。");
    }, 1600);
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
qrImageInput.addEventListener("change", () => { void readQrImage(); });
window.addEventListener("pagehide", () => { window.clearTimeout(cameraHintTimer); controls?.stop?.(); });
