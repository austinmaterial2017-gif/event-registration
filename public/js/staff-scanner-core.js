export function extractTicketToken(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 2048) return "";
  if (/^[a-f0-9]{64}$/i.test(text)) return text;
  try {
    const url = new URL(text, globalThis.location?.href || "https://scanner.invalid/");
    const token = (url.searchParams.get("t") || url.searchParams.get("token") || "").trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : "";
  } catch {
    return "";
  }
}

export function createScanController({ checkIn, showOutcome, resumeDelayMs = 900 }) {
  let processing = false;

  async function process(token) {
    try {
      const result = await checkIn(token);
      const ok = Boolean(result?.ok);
      showOutcome({ ok, message: ok ? "\u7b7e\u5230\u6210\u529f" : (result?.message || "\u672c\u7968\u4e0d\u53ef\u7b7e\u5230"), data: result?.data || null });
    } catch {
      showOutcome({ ok: false, message: "\u7f51\u7edc\u672a\u5b8c\u6210\uff0c\u8bf7\u518d\u8bd5\u4e00\u6b21", data: null });
    } finally {
      setTimeout(() => { processing = false; }, Math.max(0, Number(resumeDelayMs) || 0));
    }
  }

  return {
    acceptScan(value) {
      const token = extractTicketToken(value);
      if (!token || processing) return "ignored";
      processing = true;
      void process(token);
      return "pending";
    },
    get processing() { return processing; }
  };
}
