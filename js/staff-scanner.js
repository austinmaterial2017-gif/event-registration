const startButton = document.querySelector("#start-scanner");
const preview = document.querySelector("#camera-preview");
const message = document.querySelector("#scanner-message");
const parameters = new URLSearchParams(window.location.search);
const returnUrl = parameters.get("returnUrl") || "";
let reader = null;

function isSafeReturnUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" && parsed.hostname === "script.google.com" &&
      parsed.pathname.startsWith("/macros/s/") && parsed.pathname.endsWith("/exec");
  } catch (_ignored) {
    return false;
  }
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function stopScanner() {
  if (reader && typeof reader.reset === "function") {
    try { reader.reset(); } catch (_ignored) { /* camera is already closed */ }
  }
  reader = null;
}

function returnWithScan(scannedValue) {
  if (!scannedValue || String(scannedValue).length > 2048 || !isSafeReturnUrl(returnUrl)) return;
  stopScanner();
  const target = new URL(returnUrl);
  target.searchParams.set("scan", scannedValue);
  setMessage("已读取二维码，正在返回工作人员页面…");
  window.location.replace(target.href);
}

async function startScanner() {
  if (reader) return;
  if (!isSafeReturnUrl(returnUrl)) {
    setMessage("此扫码入口无效，请从工作人员页面重新打开。", true);
    return;
  }
  if (!window.ZXingBrowser || typeof window.ZXingBrowser.BrowserQRCodeReader !== "function") {
    setMessage("扫码组件未加载，请检查网络后重新打开此页。", true);
    return;
  }
  startButton.disabled = true;
  startButton.textContent = "正在请求相机权限…";
  setMessage("请在手机提示中按“允许”使用相机。");
  try {
    reader = new window.ZXingBrowser.BrowserQRCodeReader();
    preview.hidden = false;
    await reader.decodeFromVideoDevice(undefined, preview, (result) => {
      const scannedValue = result && (typeof result.getText === "function" ? result.getText() : result.text);
      if (scannedValue) returnWithScan(scannedValue);
    });
    setMessage("相机已打开，请对准参与者电子票的二维码。");
  } catch (_ignored) {
    stopScanner();
    setMessage("无法开启相机。请在 iPhone 的 Safari 相机权限中允许，或关闭此页后重新从工作人员页面打开。", true);
  } finally {
    startButton.disabled = false;
    startButton.textContent = "打开相机开始扫码";
  }
}

if (!isSafeReturnUrl(returnUrl)) {
  setMessage("此扫码入口无效，请返回工作人员页面重新开始。", true);
  startButton.disabled = true;
} else {
  startButton.addEventListener("click", startScanner);
}
