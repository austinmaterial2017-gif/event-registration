function uploadRules(field) {
  const upload = field?.upload && typeof field.upload === "object" ? field.upload : {};
  return {
    maxFiles: Math.max(1, Math.min(5, Number(upload.maxFiles) || 1)),
    maxBytes: Math.max(1, Number(upload.maxBytes) || 5 * 1024 * 1024),
    accept: Array.isArray(upload.accept) && upload.accept.length
      ? upload.accept.map(String)
      : ["image/jpeg", "image/png", "image/heic", "image/heif"]
  };
}

export function validatePhotoFiles(field, source) {
  const files = Array.from(source || []);
  const rules = uploadRules(field);
  const errors = [];
  if (files.length > rules.maxFiles) errors.push(`${field.label}最多上传 ${rules.maxFiles} 张照片。`);
  for (const file of files) {
    if (!rules.accept.includes(String(file?.type || "").toLowerCase())) {
      errors.push(`${file?.name || "照片"}的格式不支持，请上传 JPG、PNG 或手机照片。`);
    } else if (!Number.isFinite(Number(file?.size)) || Number(file.size) > rules.maxBytes) {
      errors.push(`${file?.name || "照片"}超过 ${Math.ceil(rules.maxBytes / 1024 / 1024)}MB 限制。`);
    }
  }
  return errors;
}

export function answerMetadataForFiles(source) {
  return Array.from(source || []).map((file) => ({
    originalName: String(file.name || "photo"),
    mimeType: String(file.type || "application/octet-stream").toLowerCase(),
    size: Number(file.size) || 0
  }));
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof btoa === "function") return btoa(binary);
  return Buffer.from(bytes).toString("base64");
}

export async function serializePhotoFiles(filesByQuestion) {
  const uploads = {};
  for (const [questionId, source] of Object.entries(filesByQuestion || {})) {
    const files = Array.from(source || []);
    if (!files.length) continue;
    uploads[questionId] = await Promise.all(files.map(async (file) => ({
      originalName: String(file.name || "photo"),
      mimeType: String(file.type || "application/octet-stream").toLowerCase(),
      size: Number(file.size) || 0,
      base64: bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    })));
  }
  return uploads;
}
