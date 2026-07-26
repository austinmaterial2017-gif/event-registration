var INTERNAL_API_SHARED_SECRET = 'INTERNAL_API_SHARED_SECRET';
var INTERNAL_REQUEST_MAX_SKEW_MS_ = 120000;
var INTERNAL_NONCE_TTL_MS_ = 600000;
var INTERNAL_IDEMPOTENCY_TTL_MS_ = 86400000;
var INTERNAL_NONCE_PREFIX_ = 'INTERNAL_NONCE_';
var INTERNAL_IDEMPOTENCY_PREFIX_ = 'INTERNAL_IDEMPOTENCY_';

function handleInternalRequest_(request) {
  if (!isValidInternalRequest_(request)) return internalRequestDenied_();
  return withInternalGatewayLock_(function() {
    purgeInternalRequestState_();
    var properties = PropertiesService.getScriptProperties();
    var nonceKey = INTERNAL_NONCE_PREFIX_ + request.nonce;
    if (properties.getProperty(nonceKey) !== null) return internalRequestDenied_();
    properties.setProperty(nonceKey, String(Date.now() + INTERNAL_NONCE_TTL_MS_));

    var idempotencyKey = INTERNAL_IDEMPOTENCY_PREFIX_ + request.idempotencyKey;
    var fingerprint = canonicalInternalJson_({
      action: request.action,
      actor: request.actor,
      payload: request.payload
    });
    var stored = parseInternalStoredResult_(properties.getProperty(idempotencyKey));
    if (stored) {
      if (stored.fingerprint !== fingerprint) return internalRequestDenied_();
      return stored.result;
    }

    var result;
    try {
      result = executeInternalActionLocked_(request.action, request.payload, request.actor);
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
        result = { ok: false, code: 'INTERNAL', message: '请求未能完成，请稍后重试。' };
      }
    } catch (_ignored) {
      result = { ok: false, code: 'INTERNAL', message: '请求未能完成，请稍后重试。' };
    }
    properties.setProperty(idempotencyKey, JSON.stringify({
      fingerprint: fingerprint,
      expiresAt: Date.now() + INTERNAL_IDEMPOTENCY_TTL_MS_,
      result: result
    }));
    return result;
  });
}

function isValidInternalRequest_(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.action !== 'string' || !/^[a-z][A-Za-z0-9.]{2,63}$/.test(request.action) ||
      !request.payload || typeof request.payload !== 'object' || Array.isArray(request.payload) ||
      typeof request.actor !== 'string' || request.actor.length > 254 ||
      !Number.isFinite(Number(request.timestamp)) ||
      typeof request.nonce !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(request.nonce) ||
      typeof request.idempotencyKey !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(request.idempotencyKey) ||
      typeof request.signature !== 'string' || request.signature.length > 256) {
    return false;
  }
  if (Math.abs(Date.now() - Number(request.timestamp)) > INTERNAL_REQUEST_MAX_SKEW_MS_) {
    return false;
  }
  var secret = PropertiesService.getScriptProperties().getProperty(INTERNAL_API_SHARED_SECRET);
  if (typeof secret !== 'string' || secret.length < 32) return false;
  var expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(internalRequestSigningText_(request), secret)
  ).replace(/=+$/g, '');
  return constantTimeInternalEquals_(expected, request.signature);
}

function internalRequestSigningText_(request) {
  return [
    String(request.action || ''),
    String(request.actor || '').trim().toLowerCase(),
    String(request.timestamp),
    String(request.nonce || ''),
    String(request.idempotencyKey || ''),
    canonicalInternalJson_(request.payload)
  ].join('\n');
}

function canonicalInternalJson_(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalInternalJson_).join(',') + ']';
  }
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + canonicalInternalJson_(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function constantTimeInternalEquals_(left, right) {
  var a = String(left || '');
  var b = String(right || '');
  var mismatch = a.length ^ b.length;
  var length = Math.max(a.length, b.length);
  for (var index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function parseInternalStoredResult_(serialized) {
  if (typeof serialized !== 'string' || !serialized) return null;
  try {
    var parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        typeof parsed.fingerprint !== 'string' ||
        !parsed.result || typeof parsed.result !== 'object' ||
        Number(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch (_ignored) {
    return null;
  }
}

function purgeInternalRequestState_() {
  var properties = PropertiesService.getScriptProperties();
  var all = properties.getProperties();
  Object.keys(all).forEach(function(key) {
    if (key.indexOf(INTERNAL_NONCE_PREFIX_) !== 0 &&
        key.indexOf(INTERNAL_IDEMPOTENCY_PREFIX_) !== 0) return;
    var expiresAt = Number(all[key]);
    if (key.indexOf(INTERNAL_IDEMPOTENCY_PREFIX_) === 0) {
      var stored = parseInternalStoredResult_(all[key]);
      if (stored) return;
      expiresAt = 0;
    }
    if (!isFinite(expiresAt) || expiresAt <= Date.now()) properties.deleteProperty(key);
  });
}

function withInternalGatewayLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function internalRequestDenied_() {
  return {
    ok: false,
    code: 'INTERNAL_REQUEST_DENIED',
    message: '受保护操作不可用。'
  };
}
