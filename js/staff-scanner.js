import { APPS_SCRIPT_WEB_APP_URL } from "./config.js";

const startButton = document.querySelector("#start-scanner");
const preview = document.querySelector("#camera-preview");
const message = document.querySelector("#scanner-message");
const resultPanel = document.querySelector("#result");
const resultText = resultPanel.querySelector("strong");
const scannerPass = new URLSearchParams(window.location.search).get("scannerPass") || "";
let reader = null;
let processing = false;
let lastValue = "";
let lastValueAt = 0;

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function ticketToken(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 2048) return "";
  try {
    const url = new URL(text, window.location.href);
    return (url.searchParams.get("t") || url.searchParams.get("token") || "").trim();
  } catch (_ignored) {
    return /^[a-f0-9]{64}$/i.test(text) ? text : "";
  }
}

async function requestCheckIn(token) {
  const response = await fetch(APPS_SCRIPT_WEB_APP_URL, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "staffScannerCheckIn", payload: { scannerPass, token } })
  });
  if (!response.ok) throw new Error("network");
  return response.json();
}

function showResult(text, ok) {
  resultText.textContent = text;
  resultPanel.className = `visible ${ok ? "success" : "error"}`;
  window.setTimeout(() => { resultPanel.className = ""; }, ok ? 850 : 1250);
}

async function handleScan(scannedValue) {
  const token = ticketToken(scannedValue);
  if (!token || processing) return;
  const now = Date.now();
  if (token === lastValue && now - lastValueAt < 1800) return;
  processing = true; lastValue = token; lastValueAt = now;
  setMessage("正在签到…");
  try {
    const result = await requestCheckIn(token);
    if (result && result.ok) {
      showResult("签到成功", true);
      setMessage("成功，继续扫描下一位。");
    } else {
      showResult(result && result.message || "本票不能签到", false);
      setMessage("未签到，请继续扫描下一位。", true);
    }
  } catch (_ignored) {
    showResult("网络未完成，请再试一次", false);
    setMessage("网络未完成，请继续扫描或检查网络。", true);
  } finally {
    window.setTimeout(() => { processing = false; }, 900);
  }
}

async function startScanner() {
  if (reader || !/^[a-f0-9]{64}$/i.test(scannerPass)) {
    if (!/^[a-f0-9]{64}$/i.test(scannerPass)) setMessage("此签到页已失效，请回到工作人员页重新开启。", true);
    return;
  }
  if (!window.ZXingBrowser || typeof window.ZXingBrowser.BrowserQRCodeReader !== "function") {
    setMessage("扫码组件未载入，请检查网络后重新打开。", true); return;
  }
  startButton.disabled = true; startButton.textContent = "相机已开启，正在连续扫码";
  try {
    reader = new window.ZXingBrowser.BrowserQRCodeReader();
    await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, preview, (result) => {
      const text = result && (typeof result.getText === "function" ? result.getText() : result.text);
      if (text) handleScan(text);
    });
    setMessage("相机已开启，请对准电子票二维码。");
  } catch (_ignored) {
    reader = null; startButton.disabled = false; startButton.textContent = "重新打开相机";
    setMessage("无法打开相机，请在 iPhone Safari 允许相机权限后再按一次。", true);
  }
}

if (!/^[a-f0-9]{64}$/i.test(scannerPass)) {
  setMessage("此签到页已失效，请回到工作人员页重新开启。", true);
  startButton.disabled = true;
} else {
  startButton.addEventListener("click", startScanner);
}
