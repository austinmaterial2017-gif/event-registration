import { APPS_SCRIPT_WEB_APP_URL } from "./config.js";
import { createScanController } from "./staff-scanner-core.js";

const pinInput = document.querySelector("#staff-pin");
const unlockButton = document.querySelector("#unlock-targets");
const eventSelect = document.querySelector("#staff-event");
const sessionSelect = document.querySelector("#staff-session");
const occurrenceSelect = document.querySelector("#staff-occurrence");
const startButton = document.querySelector("#start-continuous-scan");
const statusNode = document.querySelector("#status");
const cameraWrap = document.querySelector("#camera-wrap");
const preview = document.querySelector("#camera-preview");
const resultPanel = document.querySelector("#result");
const resultText = resultPanel.querySelector("strong");
let staffPin = "";
let targets = [];
let reader = null;
let scannerPass = "";

function setStatus(text, error = false) {
  statusNode.textContent = text;
  statusNode.classList.toggle("error", error);
}

async function callApi(action, payload) {
  const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload })
  });
  if (!response.ok) throw new Error("network");
  return response.json();
}

function replaceOptions(select, items, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  items.forEach((item) => select.add(new Option(item.label, item.value)));
}

function selectedEvent() { return targets.find((event) => event.eventId === eventSelect.value) || null; }
function selectedSession() { return selectedEvent()?.sessions.find((session) => session.sessionId === sessionSelect.value) || null; }

function saveSelection() {
  sessionStorage.setItem("staff-checkin-selection", JSON.stringify({
    eventId: eventSelect.value, sessionId: sessionSelect.value, occurrence: occurrenceSelect.value
  }));
}

function restoreSelection() {
  try { return JSON.parse(sessionStorage.getItem("staff-checkin-selection") || "{}"); } catch { return {}; }
}

function populateEvents() {
  const saved = restoreSelection();
  replaceOptions(eventSelect, targets.map((event) => ({ value: event.eventId, label: event.title })), "\u8bf7\u9009\u62e9\u6d3b\u52a8");
  eventSelect.disabled = false;
  if (targets.some((event) => event.eventId === saved.eventId)) eventSelect.value = saved.eventId;
  populateSessions();
}

function populateSessions() {
  const saved = restoreSelection();
  const event = selectedEvent();
  const sessions = event?.sessions || [];
  replaceOptions(sessionSelect, sessions.map((session) => ({
    value: session.sessionId,
    label: [session.title, session.speaker].filter(Boolean).join(" - ")
  })), "\u8bf7\u9009\u62e9\u8bb2\u5ea7 / \u8001\u5e08");
  sessionSelect.disabled = sessions.length === 0;
  if (sessions.some((session) => session.sessionId === saved.sessionId)) sessionSelect.value = saved.sessionId;
  populateOccurrences();
}

function populateOccurrences() {
  const saved = restoreSelection();
  const session = selectedSession();
  const options = session ? [
    { value: "next", label: "\u81ea\u52a8\u4e0b\u4e00\u6b21\u7b7e\u5230" },
    ...(session.checkpoints || []).map((checkpoint) => ({ value: `manual:${checkpoint.checkpointId}`, label: checkpoint.label }))
  ] : [];
  replaceOptions(occurrenceSelect, options, "\u8bf7\u9009\u62e9\u7b7e\u5230\u6b21\u6570");
  occurrenceSelect.disabled = options.length === 0;
  if (options.some((option) => option.value === saved.occurrence)) occurrenceSelect.value = saved.occurrence;
  startButton.disabled = !eventSelect.value || !sessionSelect.value || !occurrenceSelect.value;
  saveSelection();
}

function showOutcome(outcome) {
  resultText.textContent = outcome.message;
  resultPanel.className = `visible ${outcome.ok ? "success" : "error"}`;
  setTimeout(() => { resultPanel.className = ""; }, outcome.ok ? 900 : 1200);
  setStatus(outcome.ok ? "\u7b7e\u5230\u6210\u529f\uff0c\u8bf7\u7ee7\u7eed\u626b\u4e0b\u4e00\u4f4d\u3002" : "\u672a\u7b7e\u5230\uff0c\u8bf7\u7ee7\u7eed\u626b\u4e0b\u4e00\u4f4d\u3002", !outcome.ok);
}

const controller = createScanController({
  checkIn: (token) => callApi("staffScannerCheckIn", { scannerPass, token }),
  showOutcome,
  resumeDelayMs: 900
});

async function unlockTargets() {
  staffPin = pinInput.value.trim();
  if (!staffPin) { setStatus("\u8bf7\u8f93\u5165\u5de5\u4f5c\u4eba\u5458\u5bc6\u7801\u3002", true); return; }
  unlockButton.disabled = true;
  setStatus("\u6b63\u5728\u8bfb\u53d6\u6d3b\u52a8\u2026");
  try {
    const result = await callApi("staffScannerBootstrap", { staffPin });
    if (!result?.ok) throw new Error(result?.message || "denied");
    targets = result.data?.targets || [];
    if (!targets.length) throw new Error("empty");
    populateEvents();
    setStatus("\u8bf7\u9009\u62e9\u6d3b\u52a8\u3001\u8bb2\u5ea7\u548c\u7b7e\u5230\u6b21\u6570\u3002");
  } catch {
    staffPin = "";
    setStatus("\u65e0\u6cd5\u8bfb\u53d6\u7b7e\u5230\u6d3b\u52a8\uff0c\u8bf7\u68c0\u67e5\u5bc6\u7801\u540e\u91cd\u8bd5\u3002", true);
  } finally { unlockButton.disabled = false; }
}

async function startContinuousScan() {
  const session = selectedSession();
  const occurrence = occurrenceSelect.value;
  if (!session || !occurrence || !staffPin) return;
  startButton.disabled = true;
  setStatus("\u6b63\u5728\u51c6\u5907\u76f8\u673a\u2026");
  try {
    const payload = { staffPin, eventId: eventSelect.value, sessionId: session.sessionId, mode: occurrence === "next" ? "next" : "manual" };
    if (payload.mode === "manual") payload.checkpointId = occurrence.slice("manual:".length);
    const result = await callApi("staffScannerBootstrap", payload);
    if (!result?.ok || !/^[a-f0-9]{64}$/i.test(result.data?.scannerPass || "")) throw new Error("pass");
    scannerPass = result.data.scannerPass;
    cameraWrap.classList.remove("hidden");
    if (!window.ZXingBrowser?.BrowserQRCodeReader) throw new Error("reader");
    reader = new window.ZXingBrowser.BrowserQRCodeReader();
    reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, preview, (result) => {
      const value = result && (typeof result.getText === "function" ? result.getText() : result.text);
      if (value) controller.acceptScan(value);
    }).catch(() => {
      startButton.disabled = false;
      setStatus("\u65e0\u6cd5\u6253\u5f00\u76f8\u673a\uff0c\u8bf7\u5728\u6d4f\u89c8\u5668\u5141\u8bb8\u76f8\u673a\u540e\u91cd\u8bd5\u3002", true);
    });
    setStatus("\u76f8\u673a\u5df2\u5f00\u542f\uff0c\u8bf7\u8fde\u7eed\u626b\u7535\u5b50\u7968 QR \u7801\u3002");
  } catch {
    startButton.disabled = false;
    setStatus("\u65e0\u6cd5\u5f00\u59cb\u626b\u7801\uff0c\u8bf7\u91cd\u8bd5\u3002", true);
  }
}

unlockButton.addEventListener("click", unlockTargets);
eventSelect.addEventListener("change", populateSessions);
sessionSelect.addEventListener("change", populateOccurrences);
occurrenceSelect.addEventListener("change", () => { startButton.disabled = !occurrenceSelect.value; saveSelection(); });
startButton.addEventListener("click", startContinuousScan);
