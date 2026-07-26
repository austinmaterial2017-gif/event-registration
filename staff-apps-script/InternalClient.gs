var INTERNAL_API_SHARED_SECRET = 'INTERNAL_API_SHARED_SECRET';
var PUBLIC_BACKEND_URL = 'PUBLIC_BACKEND_URL';

function createInternalRequestEnvelope_(action, payload, actor, idempotencyKey, timestamp) {
  var request = {
    action: String(action || ''),
    payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
    actor: String(actor || '').trim().toLowerCase(),
    timestamp: timestamp === undefined ? Date.now() : Number(timestamp),
    nonce: Utilities.getUuid(),
    idempotencyKey: String(idempotencyKey || Utilities.getUuid())
  };
  request.signature = signInternalRequest_(request);
  return request;
}

function signInternalRequest_(request) {
  var secret = PropertiesService.getScriptProperties().getProperty(INTERNAL_API_SHARED_SECRET);
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Internal request configuration is unavailable.');
  }
  var signature = Utilities.computeHmacSha256Signature(
    internalRequestSigningText_(request),
    secret
  );
  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/g, '');
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

function invokeInternalBackend_(action, payload, actor, idempotencyKey) {
  var properties = PropertiesService.getScriptProperties();
  var endpoint = properties.getProperty(PUBLIC_BACKEND_URL);
  if (typeof endpoint !== 'string' || !/^https:\/\/.+\/exec(?:\?.*)?$/.test(endpoint.trim())) {
    throw new Error('Internal backend is unavailable.');
  }
  var requestId = idempotencyKey;
  if (!requestId && payload && typeof payload.requestId === 'string' &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(payload.requestId)) {
    requestId = payload.requestId;
  }
  var envelope = createInternalRequestEnvelope_(
    action,
    payload,
    actor,
    requestId || Utilities.getUuid()
  );
  var body = JSON.stringify({ action: 'internalRequest', payload: envelope });
  var lastError = null;
  for (var attempt = 0; attempt < 2; attempt += 1) {
    try {
      var response = UrlFetchApp.fetch(endpoint.trim(), {
        method: 'post',
        contentType: 'application/json',
        payload: body,
        muteHttpExceptions: true
      });
      var status = Number(response.getResponseCode());
      if (status < 200 || status >= 300) {
        lastError = new Error('Internal backend HTTP failure.');
        continue;
      }
      var result = JSON.parse(response.getContentText());
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          typeof result.ok !== 'boolean') {
        throw new Error('Internal backend response is invalid.');
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Internal backend is unavailable.');
}
